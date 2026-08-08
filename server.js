require('dotenv').config();
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Resend } = require('resend');
const { google } = require('googleapis');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// The app already opens the branded checkout URL directly, so avoid adding an
// extra Render 302 hop on checkout entry points. This preserves the rest of the
// payment flow and leaves all other routes untouched.
app.use(express.static(__dirname));

const restoreRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many restore attempts. Please try again shortly.',
  },
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'razorpay-checkout.html'));
});

app.get('/razorpay-checkout.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'razorpay-checkout.html'));
});

const PORT = process.env.PORT || 3001;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  ? process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;
const GOOGLE_SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'Sheet1!A1:AA1';
const SERVER_BASE = process.env.SERVER_BASE || 'https://website-tracmeds-backend-on-render.onrender.com';

if (GOOGLE_SHEET_ID && GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
  console.log('Google Sheets bookkeeping enabled.');
} else {
  console.log('Google Sheets bookkeeping disabled; set GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY to enable it.');
}

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('Warning: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment');
}

const razor = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function getLedgerPath() {
  return process.env.LEDGER_FILE_PATH || path.join(__dirname, 'ledger.json');
}

function ensureLedgerFile() {
  const ledgerFilePath = getLedgerPath();
  if (!fs.existsSync(ledgerFilePath)) {
    fs.writeFileSync(ledgerFilePath, '[]', 'utf8');
  }
}

function getLedgerEntries() {
  const ledgerFilePath = getLedgerPath();
  ensureLedgerFile();
  try {
    return JSON.parse(fs.readFileSync(ledgerFilePath, 'utf8'));
  } catch (error) {
    console.warn('Unable to read ledger file, resetting it.', error);
    fs.writeFileSync(ledgerFilePath, '[]', 'utf8');
    return [];
  }
}

function highestSequenceFromInvoiceNumbers(invoiceNumbers, invoicePrefix) {
  let highest = 0;
  invoiceNumbers.forEach((raw) => {
    const value = String(raw || '');
    if (!value.startsWith(invoicePrefix)) return;
    const sequencePart = value.slice(invoicePrefix.length).replace(/^0+/, '') || '0';
    const sequence = parseInt(sequencePart, 10);
    if (!Number.isNaN(sequence) && sequence > highest) {
      highest = sequence;
    }
  });
  return highest;
}

// Render's local disk is NOT persistent across redeploys/restarts — ledger.json
// resets, which would silently restart invoice numbering at 0001. Google Sheets
// is the durable record, so the real next-number lookup reads the Sheet's
// "Invoice Number" column and takes the max against the local ledger too (in
// case a very recent entry hasn't made it into the Sheet yet for any reason).
async function getNextInvoiceNumber(prefix = 'TRACMEDS', year = new Date().getFullYear()) {
  const invoicePrefix = `${prefix}-${year}-`;
  let highestFromSheet = 0;

  const sheets = getSheetsClient();
  if (sheets) {
    try {
      const sheetName = GOOGLE_SHEET_RANGE.split('!')[0] || 'Sheet1';
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!A:Z`,
      });
      const rows = response.data.values || [];
      if (rows.length > 1) {
        const header = rows[0] || [];
        const invoiceIndex = header.findIndex(
          (col) => String(col || '').trim().toLowerCase() === 'invoice number'
        );
        if (invoiceIndex !== -1) {
          const invoiceNumbers = rows.slice(1).map((row) => row[invoiceIndex]);
          highestFromSheet = highestSequenceFromInvoiceNumbers(invoiceNumbers, invoicePrefix);
        }
      }
    } catch (error) {
      console.warn('Unable to read invoice numbers from Google Sheet; falling back to local ledger only.', error.message);
    }
  }

  const entries = getLedgerEntries();
  const highestFromLedger = highestSequenceFromInvoiceNumbers(
    entries.map((entry) => entry.invoiceNumber),
    invoicePrefix
  );

  const highest = Math.max(highestFromSheet, highestFromLedger);
  const nextSequence = String(highest + 1).padStart(4, '0');
  return `${invoicePrefix}${nextSequence}`;
}

function appendLedgerEntry(invoice) {
  const ledgerFilePath = getLedgerPath();
  ensureLedgerFile();
  const entries = getLedgerEntries();
  const entry = {
    id: `${invoice.paymentId || invoice.orderId || 'txn'}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    paymentId: invoice.paymentId,
    orderId: invoice.orderId,
    receipt: invoice.receipt,
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    customerPhone: invoice.customerPhone,
    customerAddress: invoice.customerAddress,
    gstRequired: Boolean(invoice.gstRequired),
    gstin: invoice.gstin,
    plan: invoice.plan,
    amount: invoice.totalAmount,
    payoutEstimate: invoice.payoutEstimate,
    currency: invoice.currency,
    invoiceNumber: invoice.invoiceNumber,
    placeOfSupply: invoice.placeOfSupply,
    gstBreakup: invoice.gstBreakup,
    exportSupply: Boolean(invoice.exportSupply),
  };
  entries.push(entry);
  fs.writeFileSync(ledgerFilePath, JSON.stringify(entries, null, 2), 'utf8');
  return entry;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  // Match by last 10 digits so +91 prefixes do not break restore.
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function getPlanDurationDays(plan) {
  const raw = String(plan || '').toLowerCase();
  return raw.includes('annual') ? 365 : 30;
}

function evaluateDeviceAccessPolicy(existingDeviceIds, incomingDeviceId) {
  const normalizedExisting = Array.isArray(existingDeviceIds)
    ? existingDeviceIds.filter(Boolean).map((value) => String(value))
    : [];
  const normalizedIncoming = String(incomingDeviceId || '').trim();
  const uniqueDevices = Array.from(new Set([...normalizedExisting, normalizedIncoming].filter(Boolean)));
  const alreadyExists = normalizedExisting.includes(normalizedIncoming);

  if (normalizedIncoming && alreadyExists) {
    return { allowed: true, added: false, deviceIds: uniqueDevices };
  }

  if (!normalizedIncoming) {
    return { allowed: true, added: false, deviceIds: uniqueDevices };
  }

  if (!alreadyExists && normalizedExisting.length >= 3) {
    return {
      allowed: false,
      added: false,
      error: 'This plan has reached its device limit (3). Please purchase a new subscription to continue.',
      deviceIds: uniqueDevices,
    };
  }

  return { allowed: true, added: !alreadyExists, deviceIds: uniqueDevices };
}

async function ensureSheetExists(sheets, sheetName) {
  try {
    const response = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
    const exists = (response.data.sheets || []).some((sheet) => sheet.properties && sheet.properties.title === sheetName);
    if (exists) return;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
  } catch (error) {
    console.warn(`Unable to ensure Google Sheet exists: ${sheetName}`, error.message);
  }
}

async function ensureDevicesHeaderRow(sheets) {
  const sheetName = 'Devices';
  await ensureSheetExists(sheets, sheetName);
  const headerRange = `${sheetName}!A1:C1`;
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: headerRange });
    const rows = response.data.values || [];
    if (rows.length === 0 || rows[0].every((cell) => cell === '')) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: headerRange,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['AccessKey', 'DeviceId', 'AddedAt']],
        },
      });
    }
  } catch (err) {
    // ignore — sheet may not exist or client not configured
  }
}

async function getDevicesFromSheet(accessKey) {
  const sheets = getSheetsClient();
  if (!sheets || !accessKey) return [];

  const sheetName = 'Devices';
  const lookupRange = `${sheetName}!A:C`;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: lookupRange,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return [];

    const header = rows[0] || [];
    const keyIndex = header.findIndex((col) => String(col || '').trim().toLowerCase() === 'accesskey');
    const deviceIndex = header.findIndex((col) => String(col || '').trim().toLowerCase() === 'deviceid');
    if (keyIndex === -1 || deviceIndex === -1) return [];

    return rows.slice(1).reduce((devices, row) => {
      if (String(row[keyIndex] || '').trim().toLowerCase() === accessKey.toLowerCase()) {
        const deviceId = String(row[deviceIndex] || '').trim();
        if (deviceId) devices.push(deviceId);
      }
      return devices;
    }, []);
  } catch (error) {
    console.warn('Unable to read devices from Google Sheet', error.message);
    return [];
  }
}

async function appendDeviceToSheet(accessKey, deviceId) {
  const sheets = getSheetsClient();
  if (!sheets) return { success: false, reason: 'missing_google_sheets_configuration' };

  try {
    await ensureDevicesHeaderRow(sheets);
    const sheetName = 'Devices';
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A1:C1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[accessKey, deviceId, new Date().toISOString()]],
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Unable to append device to Google Sheet', error);
    return { success: false, reason: 'google_sheets_error', error: error.message };
  }
}

async function findLedgerEntryInSheet(email, phone) {
  const sheets = getSheetsClient();
  if (!sheets) return null;

  const wantedEmail = normalizeEmail(email);
  const wantedPhone = normalizePhone(phone);

  if (!wantedEmail || !wantedPhone) return null;

  const sheetName = (GOOGLE_SHEET_RANGE.split('!')[0] || 'Sheet1');
  const lookupRange = `${sheetName}!A:Z`;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: lookupRange,
    });

    const rows = response.data.values || [];
    if (!rows.length) return null;

    const header = rows[0] || [];
    const headerMap = new Map();
    header.forEach((col, index) => {
      const key = String(col || '').trim().toLowerCase();
      if (key) headerMap.set(key, index);
    });

    const emailIndex = headerMap.get('customer email');
    const phoneIndex = headerMap.get('customer phone');
    const timestampIndex = headerMap.get('timestamp');
    const planIndex = headerMap.get('plan');
    const invoiceIndex = headerMap.get('invoice number');
    const paymentIdIndex = headerMap.get('payment id');
    const customerNameIndex = headerMap.get('customer name');

    if (emailIndex === undefined || phoneIndex === undefined) {
      return null;
    }

    const matches = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const rowEmail = normalizeEmail(row[emailIndex] || '');
      const rowPhone = normalizePhone(row[phoneIndex] || '');

      if (!rowEmail || !rowPhone) continue;
      if (rowEmail !== wantedEmail || rowPhone !== wantedPhone) continue;

      matches.push({
        timestamp: row[timestampIndex] || '',
        plan: row[planIndex] || '',
        invoiceNumber: row[invoiceIndex] || '',
        paymentId: row[paymentIdIndex] || '',
        customerName: row[customerNameIndex] || '',
      });
    }

    if (!matches.length) return null;

    matches.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    return matches[0];
  } catch (error) {
    console.warn('restore lookup from sheet failed', error);
    return null;
  }
}

function getSheetsClient() {
  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return null;
  }

  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

async function ensureSheetHeaderRow(sheets) {
  const sheetName = GOOGLE_SHEET_RANGE.split('!')[0] || 'Sheet1';
  const headerRange = `${sheetName}!A1:AA1`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: headerRange,
  });

  const rows = response.data.values || [];
  if (rows.length === 0 || rows[0].every((cell) => cell === '')) {
    const headerRow = [
      'Timestamp',
      'Invoice Number',
      'Payment ID',
      'Order ID',
      'Receipt',
      'Customer Name',
      'Customer Email',
      'Customer Phone',
      'Customer Address',
      'Place of Supply',
      'GST Required',
      'GSTIN',
      'Plan',
      'Amount (INR)',
      'Taxable Value (INR)',
      'Tax Total (INR)',
      'CGST (INR)',
      'SGST (INR)',
      'IGST (INR)',
      'Export Supply',
      'GST Breakup',
      'Payout Gross (INR)',
      'Payout Fee (INR)',
      'Payout Net (INR)',
      'Currency',
      'Seller Name',
      'Seller GSTIN',
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: headerRange,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headerRow],
      },
    });
  }
}

async function appendTransactionToSheet(invoice) {
  const sheets = getSheetsClient();
  if (!sheets) {
    return { success: false, reason: 'missing_google_sheets_configuration' };
  }

  try {
    await ensureSheetHeaderRow(sheets);

    const values = [
      new Date().toISOString(),
      invoice.invoiceNumber,
      invoice.paymentId,
      invoice.orderId,
      invoice.receipt,
      invoice.customerName,
      invoice.customerEmail,
      invoice.customerPhone,
      invoice.customerAddress,
      invoice.placeOfSupply,
      invoice.gstRequired ? 'Yes' : 'No',
      invoice.gstin,
      invoice.plan,
      invoice.amountValue,
      invoice.taxableValueNum,
      invoice.taxTotalNum,
      invoice.cgstAmountNum,
      invoice.sgstAmountNum,
      invoice.igstAmountNum,
      invoice.exportSupply ? 'Yes' : 'No',
      invoice.gstBreakup,
      invoice.payoutEstimateGross,
      invoice.payoutEstimateFee,
      invoice.payoutEstimateNet,
      invoice.currency,
      invoice.sellerName,
      invoice.sellerGstin,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: GOOGLE_SHEET_RANGE,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [values],
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Unable to append transaction to Google Sheet', error);
    return { success: false, reason: 'google_sheets_error', error: error.message };
  }
}

// Append an arbitrary report/summary row to a separate sheet range
async function ensureReportHeaderRow(sheets) {
  const sheetName = (GOOGLE_SHEET_RANGE.split('!')[0] || 'Sheet1') + '_reports';
  const headerRange = `${sheetName}!A1:Z1`;
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: headerRange });
    const rows = response.data.values || [];
    if (rows.length === 0 || rows[0].every((cell) => cell === '')) {
      const headerRow = [
        'Timestamp',
        'User',
        'From',
        'To',
        'Categories',
        'Row Count',
        'Summary',
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: headerRange,
        valueInputOption: 'RAW',
        requestBody: { values: [headerRow] },
      });
    }
  } catch (err) {
    // ignore — sheet may not exist or client not configured
  }
}

async function appendReportToSheet(report) {
  const sheets = getSheetsClient();
  if (!sheets) return { success: false, reason: 'missing_google_sheets_configuration' };
  try {
    await ensureReportHeaderRow(sheets);
    const sheetName = (GOOGLE_SHEET_RANGE.split('!')[0] || 'Sheet1') + '_reports';
    const values = [
      new Date().toISOString(),
      report.user || '',
      report.from || '',
      report.to || '',
      (report.categories || []).join(','),
      report.rowCount || 0,
      report.summary || '',
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A1:G1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });
    return { success: true };
  } catch (error) {
    console.error('Unable to append report to Google Sheet', error);
    return { success: false, reason: 'google_sheets_error', error: error.message };
  }
}

// POST endpoint to accept report data from the mobile app
app.post('/api/append-report', async (req, res) => {
  try {
    const { user, from, to, categories, rowCount, summary } = req.body || {};
    if (!categories || !Array.isArray(categories)) return res.status(400).json({ success: false, error: 'Invalid categories' });
    const result = await appendReportToSheet({ user, from, to, categories, rowCount, summary });
    if (!result.success) return res.status(500).json({ success: false, error: result.reason || 'append_failed' });
    return res.json({ success: true });
  } catch (err) {
    console.error('append-report error', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isExportSupply(placeOfSupply) {
  const normalized = String(placeOfSupply || '').trim().toLowerCase();
  return normalized === 'outside india' || normalized.includes('outside india') || normalized.includes('export');
}

function buildOrderOptions({ amount, currency = 'INR', receipt = 'receipt#1', notes = {} }) {
  const sanitizedNotes = {};
  Object.entries(notes).forEach(([key, value]) => {
    const cleanValue = sanitizeText(value);
    if (cleanValue) {
      sanitizedNotes[key] = cleanValue;
    }
  });

  return {
    amount: parseInt(amount, 10),
    currency,
    receipt,
    payment_capture: 1,
    notes: sanitizedNotes,
  };
}

function calculatePayoutEstimate({ amount, feeRatePercent = 2.0, gstPercent = 18.0, fixedFee = 0.0 }) {
  const grossAmount = parseInt(amount, 10) / 100;
  const feeBeforeGst = (grossAmount * feeRatePercent) / 100 + fixedFee;
  const fee = feeBeforeGst + (feeBeforeGst * gstPercent) / 100;
  const netPayout = grossAmount - fee;
  return {
    grossAmount,
    feeRatePercent,
    gstPercent,
    fixedFee,
    fee,
    netPayout,
  };
}

function buildInvoiceData({ name, phone, email, address, gstRequired, gstin, amount, currency = 'INR', plan, paymentId, orderId, receipt, placeOfSupply = 'Maharashtra', invoiceNumber }) {
  const normalizedPlace = sanitizeText(placeOfSupply) || 'Maharashtra';
  const amountInRupees = parseInt(amount, 10) / 100;
  const exportSupply = isExportSupply(normalizedPlace);
  const intraState = !exportSupply && normalizedPlace.toLowerCase().includes('mahar');

  // Three-path mode: an "Outside India" place of supply always produces the
  // export invoice — it overrides gstRequired entirely, since export sales
  // are zero-rated under LUT regardless of whether the customer ticked the
  // GST box. Otherwise it's a normal domestic GST invoice (CGST+SGST for
  // Maharashtra, IGST elsewhere) or, if gstRequired is false, a plain
  // no-GST payment receipt with no tax breakup at all.
  // gstRequired alone isn't enough — if the box was checked but no GSTIN
  // actually came through (e.g. a direct API call bypassing the frontend's
  // conditional-required field), fall back to the plain receipt rather than
  // emailing a "GST invoice" with GSTIN: N/A on it.
  const gstApplies = !exportSupply && Boolean(gstRequired) && Boolean(sanitizeText(gstin));
  const invoiceMode = exportSupply ? 'export' : gstApplies ? 'gst' : 'no-gst';

  const taxableValueNum = gstApplies ? Number((amountInRupees / 1.18).toFixed(2)) : amountInRupees;
  const taxTotalNum = gstApplies ? Number((amountInRupees - taxableValueNum).toFixed(2)) : 0;
  const cgstAmountNum = gstApplies && intraState ? Number((taxTotalNum / 2).toFixed(2)) : 0;
  const sgstAmountNum = gstApplies && intraState ? Number((taxTotalNum / 2).toFixed(2)) : 0;
  const igstAmountNum = gstApplies && !intraState ? Number(taxTotalNum.toFixed(2)) : 0;
  const payoutEstimate = calculatePayoutEstimate({ amount });
  // invoiceNumber is computed by the caller (async, via getNextInvoiceNumber
  // against the Google Sheet + local ledger) and passed in here. The local-only
  // fallback below only fires if a caller forgets to pass one in.
  const resolvedInvoiceNumber = invoiceNumber || (() => {
    const entries = getLedgerEntries();
    const invoicePrefix = `TRACMEDS-${new Date().getFullYear()}-`;
    const highest = highestSequenceFromInvoiceNumbers(
      entries.map((entry) => entry.invoiceNumber),
      invoicePrefix
    );
    return `${invoicePrefix}${String(highest + 1).padStart(4, '0')}`;
  })();

  const isAnnual = String(plan || '').toLowerCase().includes('annual');
  const planLabel = isAnnual ? 'Annual' : 'Monthly';
  const planPriceDisplay = `₹${Math.round(amountInRupees)}`;

  const description = exportSupply
    ? (isAnnual ? 'Family unlock access - TracMeds annual subscription' : 'Family unlock access - TracMeds app subscription')
    : (isAnnual ? 'Annual premium access / subscription for the TracMeds app service' : 'Premium access / subscription for the TracMeds app service');

  return {
    invoiceNumber: resolvedInvoiceNumber,
    invoiceMode,
    customerName: sanitizeText(name),
    customerPhone: sanitizeText(phone),
    customerEmail: sanitizeText(email),
    customerAddress: sanitizeText(address),
    gstRequired: Boolean(gstRequired),
    gstin: sanitizeText(gstin),
    plan: sanitizeText(plan),
    planLabel,
    planPriceDisplay,
    description,
    paymentId: sanitizeText(paymentId),
    orderId: sanitizeText(orderId),
    receipt: sanitizeText(receipt),
    amountValue: amountInRupees,
    totalAmount: `₹${amountInRupees.toFixed(2)}`,
    taxableValue: `₹${taxableValueNum.toFixed(2)}`,
    taxableValueNum,
    taxTotal: `₹${taxTotalNum.toFixed(2)}`,
    taxTotalNum,
    cgstAmount: `₹${cgstAmountNum.toFixed(2)}`,
    cgstAmountNum,
    sgstAmount: `₹${sgstAmountNum.toFixed(2)}`,
    sgstAmountNum,
    igstAmount: `₹${igstAmountNum.toFixed(2)}`,
    igstAmountNum,
    gstBreakup: exportSupply
      ? 'Export under Letter of Undertaking without payment of Integrated Tax'
      : gstApplies
      ? (intraState ? 'CGST 9% + SGST 9% (Maharashtra)' : 'IGST 18%')
      : '',
    serviceAccountingCode: '998319',
    placeOfSupply: normalizedPlace,
    exportSupply,
    exportNote: exportSupply
      ? 'Supply meant for Export Under Letter of Undertaking Without Payment of Integrated Tax.'
      : '',
    payoutEstimate: {
      grossAmount: `₹${payoutEstimate.grossAmount.toFixed(2)}`,
      fee: `₹${payoutEstimate.fee.toFixed(2)}`,
      netPayout: `₹${payoutEstimate.netPayout.toFixed(2)}`,
    },
    payoutEstimateGross: payoutEstimate.grossAmount,
    payoutEstimateFee: payoutEstimate.fee,
    payoutEstimateNet: payoutEstimate.netPayout,
    currency,
    issuedAt: new Date().toISOString(),
    sellerName: 'Anurag Sinha',
    sellerAddress: '2G 505, Indiabulls Greens, Lavender, Sector-2, Kon, Raigad, Maharashtra - 410221',
    sellerGstin: '27BIQPS9199K1ZW',
    sellerEmail: 'support@tracmeds.com',
    sellerWebsite: 'https://www.tracmeds.com',
  };
}

function buildInvoiceEmailHtml(invoice) {
  // invoiceMode is set by buildInvoiceData: 'export' | 'gst' | 'no-gst'.
  const mode = invoice.invoiceMode || (invoice.exportSupply ? 'export' : invoice.gstRequired ? 'gst' : 'no-gst');
  const isReceipt = mode === 'no-gst';
  const isExport = mode === 'export';
  const isGst = mode === 'gst';

  const headerTagline = isGst ? 'Tax GST Invoice' : isExport ? 'Tax Invoice' : 'Payment Receipt';
  const detailsLabel = isReceipt ? 'Receipt Details' : 'Invoice Details';
  const numberLabel = isReceipt ? 'Receipt No' : 'Invoice No';
  const dateDisplay = new Date(invoice.issuedAt).toLocaleDateString('en-IN');

  const billToLabel = isReceipt ? 'Received From' : 'Bill To';
  const billToAddressLine = isReceipt
    ? ''
    : `<p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.customerAddress || 'N/A'}</p>`;
  const billToGstinLine = isGst
    ? `<p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">GSTIN: ${invoice.gstin || 'N/A'}</p>`
    : '';

  // Place of Supply / Payment Ref / Order Ref strip — no-GST receipts drop
  // the Place of Supply cell since it isn't relevant to a plain receipt.
  const placeOfSupplyCell = isReceipt
    ? ''
    : `<td valign="top" style="padding:0 18px 0 0;">
              <p style="margin:0 0 4px 0; font-weight:700; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Place of Supply</p>
              <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.placeOfSupply}</p>
            </td>`;

  const refBlock = `
      <tr>
        <td style="padding-bottom:16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb; border-radius:10px; background:#fcfcfe;">
            <tr>
              <td style="padding:12px 14px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  ${placeOfSupplyCell}<td valign="top" style="padding:0 18px 0 0;">
              <p style="margin:0 0 4px 0; font-weight:700; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Payment Ref.</p>
              <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.paymentId || 'N/A'}</p>
            </td><td valign="top" style="padding:0 18px 0 0;">
              <p style="margin:0 0 4px 0; font-weight:700; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Order Ref.</p>
              <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.orderId || 'N/A'}</p>
            </td>
                </tr></table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;

  // Sales Breakup — omitted entirely for no-GST receipts (the whole point of
  // unchecking the GST box is to skip the tax breakup and show a plain
  // amount paid instead).
  let salesBreakupBlock = '';
  if (isExport) {
    salesBreakupBlock = `
      <tr>
        <td style="padding-bottom:16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb; border-radius:10px;">
            <tr>
              <td style="background:#f7f8fd; padding:12px 14px; font-weight:700; font-family:Arial, sans-serif; color:#12193a; font-size:14px; border-radius:10px 10px 0 0;">Sales Breakup</td>
            </tr>
            <tr>
              <td style="padding:14px;">
                <p style="margin:0 0 6px 0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Taxable Value: ${invoice.taxableValue}</p>
                <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.exportNote}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  } else if (isGst) {
    const intraState = invoice.cgstAmountNum > 0;
    const taxLines = intraState
      ? `<p style="margin:0 0 6px 0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">CGST: ${invoice.cgstAmount}</p>
                <p style="margin:0 0 6px 0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">SGST: ${invoice.sgstAmount}</p>`
      : `<p style="margin:0 0 6px 0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">IGST: ${invoice.igstAmount}</p>`;
    const footnote = intraState
      ? `<p style="margin:12px 0 0 0; color:#5c6785; font-size:12px; line-height:1.5; font-family:Arial, sans-serif;">For customers outside Maharashtra (within India) or outside India, the invoice will show IGST 18% instead of CGST + SGST.</p>`
      : '';
    salesBreakupBlock = `
      <tr>
        <td style="padding-bottom:16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb; border-radius:10px;">
            <tr>
              <td style="background:#f7f8fd; padding:12px 14px; font-weight:700; font-family:Arial, sans-serif; color:#12193a; font-size:14px; border-radius:10px 10px 0 0;">Sales Breakup</td>
            </tr>
            <tr>
              <td style="padding:14px;">
                <p style="margin:0 0 6px 0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Taxable Value: ${invoice.taxableValue}</p>
                <p style="margin:0 0 6px 0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">GST Breakup: ${invoice.gstBreakup}</p>
                ${taxLines}
                <p style="margin:0 0 6px 0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Total Tax: ${invoice.taxTotal}</p>
                <p style="margin:0 0 6px 0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">SAC: ${invoice.serviceAccountingCode}</p>
                ${footnote}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  const totalBlock = isReceipt
    ? `
              <tr>
                <td align="right" style="padding-bottom:20px;">
                  <p style="margin:0; font-size:18px; font-weight:700; font-family:Arial, sans-serif; color:#12193a;">Amount Paid: ${invoice.totalAmount} INR</p>
                  <p style="margin:4px 0 0 0; color:#5c6785; font-size:12px; font-family:Arial, sans-serif;">Inclusive of applicable GST, where chargeable.</p>
                </td>
              </tr>`
    : `
              <tr>
                <td align="right" style="padding-bottom:20px;">
                  <p style="margin:0; font-size:18px; font-weight:700; font-family:Arial, sans-serif; color:#12193a;">Total Amount: ${invoice.totalAmount} INR</p>
                </td>
              </tr>`;

  const footerNote = isExport
    ? 'This is an export of service under LUT without payment of integrated tax.'
    : isGst
    ? 'This is a GST-compliant invoice issued for the paid subscription service.'
    : 'This is a payment receipt issued for the paid subscription service and is not a GST tax invoice.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TracMeds Invoice</title>
</head>
<body style="margin:0; padding:24px; background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:720px; margin:0 auto; border-collapse:collapse;">
  <tr>
    <td style="border:1px solid #e5e7eb; border-radius:12px; background:#ffffff;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

              <!-- Header -->
              <tr>
                <td style="border-bottom:1px solid #e5e7eb; padding-bottom:12px; margin-bottom:16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td valign="middle" width="60%">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                          <td valign="middle" style="padding-right:12px;">
                            <img src="https://www.tracmeds.com/icon.png" width="48" height="48" alt="TracMeds" style="display:block; width:48px; height:48px; border-radius:12px;" />
                          </td>
                          <td valign="middle">
                            <p style="margin:0 0 4px 0; font-family:Arial, sans-serif; font-size:26px; font-weight:700; color:#12193a;">TracMeds</p>
                            <p style="margin:0; font-family:Arial, sans-serif; color:#5c6785; font-size:14px;">${headerTagline}</p>
                          </td>
                        </tr></table>
                      </td>
                      <td valign="top" align="right" width="40%">
                        <p style="margin:0 0 4px 0; font-weight:700; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${detailsLabel}</p>
                        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${numberLabel}: <strong>${invoice.invoiceNumber}</strong></p>
                        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Date: ${dateDisplay}</p>
                        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Plan: ${invoice.planLabel} ${invoice.planPriceDisplay}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr><td style="line-height:16px; font-size:16px;">&nbsp;</td></tr>

              <!-- Issued By / Bill To -->
              <tr>
                <td style="padding-bottom:16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td valign="top" width="50%" style="padding-right:16px;">
                        <p style="margin:0 0 6px 0; font-weight:700; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Issued By</p>
                        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.sellerName}</p>
                        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.sellerAddress}</p>
                        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">GSTIN: ${invoice.sellerGstin}</p>
                        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Email: ${invoice.sellerEmail}</p>
                        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">Website: ${invoice.sellerWebsite}</p>
                      </td>
                      <td valign="top" width="50%">
                        <p style="margin:0 0 6px 0; font-weight:700; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${billToLabel}</p>
        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.customerName || 'Customer'}</p>
        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.customerEmail || 'N/A'}</p>
        <p style="margin:0; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.customerPhone || 'N/A'}</p>
        ${billToAddressLine}
        ${billToGstinLine}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              ${refBlock}
              ${salesBreakupBlock}

              <!-- Description -->
              <tr>
                <td style="padding-bottom:16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb; border-radius:10px;">
                    <tr>
                      <td style="background:#f7f8fd; padding:12px 14px; font-weight:700; font-family:Arial, sans-serif; color:#12193a; font-size:14px; border-radius:10px 10px 0 0;">Description</td>
                    </tr>
                    <tr>
                      <td style="padding:14px; font-family:Arial, sans-serif; color:#12193a; font-size:14px;">${invoice.description}</td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Total -->
              ${totalBlock}

              <!-- Footer -->
              <tr>
                <td>
                  <p style="margin:6px 0 0 0; color:#5c6785; font-family:Arial, sans-serif; font-size:14px;">${footerNote}</p>
                  <p style="margin:12px 0 0 0; color:#5c6785; font-size:12px; line-height:1.4; font-family:Arial, sans-serif;">TracMeds is a health-tracking service, not a medical device or substitute for professional medical advice.</p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

async function sendInvoiceEmail(invoice) {
  if (!resend) {
    console.warn('RESEND_API_KEY not configured; skipping invoice email send.');
    return { success: false, reason: 'missing_resend_api_key' };
  }
  if (!invoice.customerEmail) {
    console.warn('No customer email provided; skipping invoice email send.');
    return { success: false, reason: 'missing_customer_email' };
  }

  const html = buildInvoiceEmailHtml(invoice);

  try {
    const result = await resend.emails.send({
  from: process.env.EMAIL_FROM || 'TracMeds <invoices@tracmeds.com>',
  to: invoice.customerEmail,
  bcc: process.env.INVOICE_BCC_EMAIL,
  subject: `TracMeds Invoice ${invoice.invoiceNumber}`,
  html,
});

    if (result.error) {
      console.error('Resend API returned an error sending invoice email', result.error);
      return { success: false, reason: 'resend_api_error', error: result.error };
    }

    return { success: true };
  } catch (error) {
    console.error('Error sending invoice email via Resend', error);
    return { success: false, reason: 'send_exception', error: error.message };
  }
}

// Fields required to build and email an invoice. Enforced here, before an
// order is even created, so incomplete checkout data can't reach Razorpay —
// this is a server-side backstop for the same validation the checkout page
// does client-side, in case that's ever bypassed (direct API call, JS
// disabled, etc).
function findMissingInvoiceFields(notes = {}) {
  const missing = [];
  if (!sanitizeText(notes.name)) missing.push('name');
  if (!sanitizeText(notes.email)) missing.push('email');
  if (!sanitizeText(notes.phone)) missing.push('phone');
  if (!sanitizeText(notes.place_of_supply)) missing.push('place_of_supply');
  if (notes.gst_required === 'yes' && !sanitizeText(notes.gstin)) missing.push('gstin');
  return missing;
}

// Server-side source of truth for plan pricing (in paise). The client sends
// `amount` and `notes.plan` together, but neither is trusted on its own —
// without this, a direct API call could request a valid-looking amount
// (e.g. 100 paise) for a real subscription and bypass the actual price
// shown in the checkout UI. Keep this in sync with PLAN_DETAILS in
// razorpay-checkout.html and DEFAULT_PACKAGES in SubscriptionContext.tsx.
const PLAN_PRICES = {
  monthly: 14900,
  annual: 129900,
};

async function handleCreateOrder(req, res) {
  try {
    const { amount, currency = 'INR', receipt = 'receipt#1', notes = {} } = req.body;
    const amountInt = parseInt(amount, 10);
    if (isNaN(amountInt) || amountInt < 100) {
      return res.status(400).json({ error: 'Invalid amount. Minimum is 100 paise.' });
    }

    const planKey = String(notes.plan || '').toLowerCase().includes('annual') ? 'annual' : 'monthly';
    const expectedAmount = PLAN_PRICES[planKey];
    if (amountInt !== expectedAmount) {
      return res.status(400).json({ error: 'Amount does not match the selected plan.' });
    }

    const missingFields = findMissingInvoiceFields(notes);
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required invoice details: ${missingFields.join(', ')}` });
    }
    const options = buildOrderOptions({ amount: amountInt, currency, receipt, notes });
    const order = await razor.orders.create(options);
    return res.json({ order_id: order.id, amount: order.amount, currency: order.currency, key_id: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    if (err.statusCode === 401) return res.status(401).json({ error: 'Authentication with Razorpay failed.' });
    console.error('Create order error', err);
    return res.status(500).json({ error: 'Unable to create order' });
  }
}

async function handleVerifyPayment(req, res) {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature, notes = {} } = req.body;
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const generated_signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  if (generated_signature === razorpay_signature) {
    const invoiceNumber = await getNextInvoiceNumber('TRACMEDS', new Date().getFullYear());
    const invoice = buildInvoiceData({
      name: notes.name,
      phone: notes.phone,
      email: notes.email,
      address: notes.address,
      placeOfSupply: notes.place_of_supply,
      gstRequired: notes.gst_required === 'yes',
      gstin: notes.gstin,
      amount: notes.amount || 0,
      currency: notes.currency || 'INR',
      plan: notes.plan,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      receipt: notes.receipt,
      invoiceNumber,
    });
    appendLedgerEntry(invoice);
    const sheetResult = await appendTransactionToSheet(invoice);
    if (!sheetResult.success) {
      console.warn('Google Sheets bookkeeping record could not be appended.', sheetResult);
    }
    await sendInvoiceEmail(invoice);
    return res.json({ success: true, invoice });
  }
  return res.status(400).json({ success: false, error: 'Signature mismatch' });
}

// /api/checkout/* are aliases used by index.html; both paths share the same handler.
app.post('/api/create-order', handleCreateOrder);
app.post('/api/checkout/create-order', handleCreateOrder);

app.post('/api/verify-payment', handleVerifyPayment);
app.post('/api/checkout/verify-payment', handleVerifyPayment);


app.post('/api/payment-callback', async (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  const returnUrl = req.query.return_url || 'tracmeds://payment/complete';
  const cancelUrl = req.query.cancel_url || 'tracmeds://payment/cancel';

  // Redirect back through razorpay-checkout.html instead of straight to the
  // tracmeds:// deep link. That page already has success/fail card UI and
  // the JS that attempts the app handoff — a raw server-side 302 straight
  // to a custom URL scheme is what was causing "Safari can't open the page".
  const checkoutPageUrl = (status, extra = {}) => {
    const url = new URL('/razorpay-checkout.html', SERVER_BASE);
    url.searchParams.set('callback_status', status);
    url.searchParams.set('return_url', returnUrl);
    url.searchParams.set('cancel_url', cancelUrl);
    // Carry the customer's email/phone through the redirect so the app can
    // report them back with the subscription event — the Devices sheet
    // needs deviceId + (email or phone) to record a device, and the app
    // has no other way to know which customer this checkout belonged to.
    if (extra.email) url.searchParams.set('customer_email', extra.email);
    if (extra.phone) url.searchParams.set('customer_phone', extra.phone);
    return url.toString();
  };

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.redirect(302, checkoutPageUrl('failed'));
  }

  const generated_signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  if (generated_signature !== razorpay_signature) {
    return res.redirect(302, checkoutPageUrl('failed'));
  }

  // Signature verified — now build the invoice/ledger/email, same as /api/verify-payment,
  // since this redirect-flow path bypasses that route entirely.
  let notes = {};
  try {
    if (req.query.customer_data) {
      notes = JSON.parse(Buffer.from(decodeURIComponent(req.query.customer_data), 'base64').toString('utf8'));
    }

    const invoiceNumber = await getNextInvoiceNumber('TRACMEDS', new Date().getFullYear());
    const invoice = buildInvoiceData({
      name: notes.name,
      phone: notes.phone,
      email: notes.email,
      address: notes.address,
      placeOfSupply: notes.place_of_supply,
      gstRequired: notes.gst_required === 'yes',
      gstin: notes.gstin,
      amount: notes.amount || 0,
      currency: notes.currency || 'INR',
      plan: notes.plan,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      receipt: notes.receipt,
      invoiceNumber,
    });

    appendLedgerEntry(invoice);
    const sheetResult = await appendTransactionToSheet(invoice);
    if (!sheetResult.success) {
      console.warn('Google Sheets bookkeeping record could not be appended.', sheetResult);
    }
    await sendInvoiceEmail(invoice);
  } catch (error) {
    console.error('Error building invoice during payment-callback redirect flow', error);
    // Don't block the user's redirect just because invoice/ledger logging failed —
    // the payment itself is already verified and successful at this point.
  }

  return res.redirect(302, checkoutPageUrl('success', { email: notes.email, phone: notes.phone }));
});

// Appends a subscription lifecycle event (active, renewed, expired) to the
// reports sheet in Google Sheets. Client-initiated from the app (fire-and-forget).
// NOTE: One-time-charge setup — not recurring billing. These events are for
// bookkeeping visibility only; they do not grant or revoke server-side access.
async function appendSubscriptionEventToSheet(event) {
  const sheets = getSheetsClient();
  if (!sheets) return { success: false, reason: 'missing_google_sheets_configuration' };
  try {
    const sheetName = (GOOGLE_SHEET_RANGE.split('!')[0] || 'Sheet1') + '_subscriptions';
    await ensureSheetExists(sheets, sheetName);
    const headerRange = `${sheetName}!A1:H1`;

    // Ensure header row on first use.
    try {
      const existing = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: headerRange });
      if (!existing.data.values || existing.data.values.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: GOOGLE_SHEET_ID,
          range: headerRange,
          valueInputOption: 'RAW',
          requestBody: {
            values: [['Timestamp', 'User', 'Plan', 'Status', 'Is Renewal', 'Purchased At', 'Expires At', 'Note']],
          },
        });
      }
    } catch {
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: headerRange,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Timestamp', 'User', 'Plan', 'Status', 'Is Renewal', 'Purchased At', 'Expires At', 'Note']],
        },
      });
    }

    const note = event.status === 'active' && !event.isRenewal
      ? 'New subscriber'
      : event.status === 'renewed'
      ? 'Renewal after prior expiry'
      : event.status === 'expired'
      ? 'Access lapsed (client-side expiry)'
      : event.status;

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A1:H1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          new Date().toISOString(),
          event.user || '',
          event.plan || '',
          event.status || '',
          event.isRenewal ? 'Yes' : 'No',
          event.purchasedAt || '',
          event.expiresAt || '',
          note,
        ]],
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Unable to append subscription event to Google Sheet', error);
    return { success: false, reason: 'google_sheets_error', error: error.message };
  }
}

// Single endpoint for all subscription lifecycle events: active, renewed, expired.
// Replaces the earlier /api/subscription-expired route.
app.post('/api/subscription-event', async (req, res) => {
  try {
    const { user, plan, purchasedAt, expiresAt, status, isRenewal, deviceId, email, phone } = req.body || {};
    console.log('[subscription-event] received', { plan, status, deviceId, hasEmail: Boolean(email), hasPhone: Boolean(phone) });
    if (!plan || !status) return res.status(400).json({ success: false, error: 'Missing plan or status field' });

    const result = await appendSubscriptionEventToSheet({ user, plan, purchasedAt, expiresAt, status, isRenewal });
    if (!result.success) console.warn('Subscription event sheet append failed', result);

    if (deviceId && (email || phone)) {
      const accessKey = `${normalizeEmail(email || '')}:${normalizePhone(phone || '')}`;
      const currentDevices = await getDevicesFromSheet(accessKey);
      const policy = evaluateDeviceAccessPolicy(currentDevices, deviceId);
      if (policy.allowed && policy.added) {
        const appendResult = await appendDeviceToSheet(accessKey, deviceId);
        if (!appendResult.success) {
          console.warn('Device tracking sheet append failed', appendResult);
        }
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('subscription-event error', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

// Legacy alias kept so any existing clients using the old endpoint still work.
app.post('/api/subscription-expired', async (req, res) => {
  const { user, plan, purchasedAt, expiresAt } = req.body || {};
  req.body = { user, plan, purchasedAt, expiresAt, status: 'expired', isRenewal: false };
  const result = await appendSubscriptionEventToSheet(req.body);
  if (!result.success) console.warn('Subscription expired sheet append failed', result);
  return res.json({ success: true });
});

// Restore endpoint for website-APK users who reinstall, clear data, or move devices.
// Matches by email/phone against successful payment ledger entries and restores if
// the latest matching purchase is still within its plan period.
app.post('/api/restore-subscription', restoreRateLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const deviceId = String(req.body?.deviceId || '').trim();

    if (!email || !phone) {
      return res.status(400).json({ success: false, error: 'Both email and phone are required.' });
    }

    const latest = await findLedgerEntryInSheet(email, phone);

    if (!latest) {
      return res.status(404).json({ success: false, error: 'No matching purchase found for these details.' });
    }

    const accessKey = `${email}:${phone}`;
    const currentDevices = await getDevicesFromSheet(accessKey);
    const policy = evaluateDeviceAccessPolicy(currentDevices, deviceId);

    if (deviceId && policy.allowed && policy.added) {
      const appendResult = await appendDeviceToSheet(accessKey, deviceId);
      if (!appendResult.success) {
        console.warn('Device tracking sheet append failed', appendResult);
      }
    }

    if (deviceId && !policy.allowed) {
      return res.status(403).json({ success: false, error: policy.error });
    }

    const plan = String(latest.plan || 'monthly').toLowerCase();
    const startedAt = latest.timestamp ? new Date(latest.timestamp) : new Date();
    const expiresAt = new Date(startedAt.getTime() + getPlanDurationDays(plan) * 24 * 60 * 60 * 1000);
    const now = Date.now();

    if (expiresAt.getTime() <= now) {
      return res.json({
        success: false,
        expired: true,
        plan,
        startedAt: startedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        error: 'Plan found, but it has expired.',
      });
    }

    return res.json({
      success: true,
      plan,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      customerName: latest.customerName || '',
      invoiceNumber: latest.invoiceNumber || '',
      paymentId: latest.paymentId || '',
    });
  } catch (err) {
    console.error('restore-subscription error', err);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Razorpay server listening on port ${PORT}`));
}

module.exports = {
  app,
  buildOrderOptions,
  buildInvoiceData,
  buildInvoiceEmailHtml,
  appendLedgerEntry,
  getLedgerEntries,
  calculatePayoutEstimate,
  evaluateDeviceAccessPolicy,
};
