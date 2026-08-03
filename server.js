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

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3001;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  ? process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;
const GOOGLE_SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'Sheet1!A1:AA1';

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

function getNextInvoiceNumber(prefix = 'TRACMEDS', year = new Date().getFullYear()) {
  const entries = getLedgerEntries();
  const invoicePrefix = `${prefix}-${year}-`;
  let highest = 0;

  entries.forEach((entry) => {
    const raw = String(entry.invoiceNumber || '');
    if (!raw.startsWith(invoicePrefix)) return;
    const sequencePart = raw.slice(invoicePrefix.length).replace(/^0+/, '') || '0';
    const sequence = parseInt(sequencePart, 10);
    if (!Number.isNaN(sequence) && sequence > highest) {
      highest = sequence;
    }
  });

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

function buildInvoiceData({ name, phone, email, address, gstRequired, gstin, amount, currency = 'INR', plan, paymentId, orderId, receipt, placeOfSupply = 'Maharashtra' }) {
  const normalizedPlace = sanitizeText(placeOfSupply) || 'Maharashtra';
  const amountInRupees = parseInt(amount, 10) / 100;
  const exportSupply = isExportSupply(normalizedPlace);
  const intraState = !exportSupply && normalizedPlace.toLowerCase().includes('mahar');
  const taxableValueNum = exportSupply ? amountInRupees : Number((amountInRupees / 1.18).toFixed(2));
  const taxTotalNum = exportSupply ? 0 : Number((amountInRupees - taxableValueNum).toFixed(2));
  const cgstAmountNum = exportSupply ? 0 : intraState ? Number((taxTotalNum / 2).toFixed(2)) : 0;
  const sgstAmountNum = exportSupply ? 0 : intraState ? Number((taxTotalNum / 2).toFixed(2)) : 0;
  const igstAmountNum = exportSupply ? 0 : intraState ? 0 : Number(taxTotalNum.toFixed(2));
  const payoutEstimate = calculatePayoutEstimate({ amount });
  const invoiceNumber = getNextInvoiceNumber('TRACMEDS', new Date().getFullYear());

  return {
    invoiceNumber,
    customerName: sanitizeText(name),
    customerPhone: sanitizeText(phone),
    customerEmail: sanitizeText(email),
    customerAddress: sanitizeText(address),
    gstRequired: Boolean(gstRequired),
    gstin: sanitizeText(gstin),
    plan: sanitizeText(plan),
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
      : intraState
      ? 'CGST 9% + SGST 9%'
      : 'IGST 18%',
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
  const isExportInvoice = Boolean(invoice.exportSupply);
  const gstInvoiceLabel = isExportInvoice ? 'Invoice' : invoice.gstRequired ? 'GST Invoice' : 'Invoice';
  const gstInvoiceHint = isExportInvoice
    ? `<p style="margin: 6px 0 0; color: #5c6785;">${invoice.exportNote}</p>`
    : invoice.gstRequired
    ? '<p style="margin: 6px 0 0; color: #5c6785;">This is a GST-compliant invoice issued for the paid subscription service.</p>'
    : '<p style="margin: 6px 0 0; color: #5c6785;">This invoice is issued for payment received for the TracMeds app service.</p>';

  return `
    <div style="font-family: Arial, sans-serif; color: #12193a; max-width: 720px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="https://www.tracmeds.com/icon.png" alt="TracMeds" style="width: 48px; height: 48px; border-radius: 12px;" />
          <div>
            <h1 style="margin: 0 0 4px; font-size: 28px;">TracMeds</h1>
            <p style="margin: 0; color: #5c6785;">Tax ${gstInvoiceLabel}</p>
          </div>
        </div>
        <div style="text-align: right; min-width: 220px;">
          <p style="margin: 0 0 4px; font-weight: 700;">Invoice Details</p>
          <p style="margin: 0;">Invoice No: <strong>${invoice.invoiceNumber}</strong></p>
          <p style="margin: 0;">Date: ${new Date(invoice.issuedAt).toLocaleDateString('en-IN')}</p>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin-bottom: 16px;">
        <div style="flex: 1; min-width: 280px;">
          <p style="margin: 0 0 6px; font-weight: 700;">Issued By</p>
          <p style="margin: 0;">Anurag Sinha</p>
          <p style="margin: 0;">2G 505, Indiabulls Greens, Lavender, Sector-2, Kon, Raigad, Maharashtra - 410221</p>
          <p style="margin: 0;">GSTIN: 27BIQPS9199K1ZW</p>
          <p style="margin: 0;">Email: support@tracmeds.com</p>
          <p style="margin: 0;">Website: https://www.tracmeds.com</p>
        </div>
        <div style="flex: 1; min-width: 280px;">
          <p style="margin: 0 0 6px; font-weight: 700;">Bill To</p>
          <p style="margin: 0;">${invoice.customerName || 'Customer'}</p>
          <p style="margin: 0;">${invoice.customerEmail || 'N/A'}</p>
          <p style="margin: 0;">${invoice.customerPhone || 'N/A'}</p>
          <p style="margin: 0;">${invoice.customerAddress || 'N/A'}</p>
          ${invoice.gstRequired ? `<p style="margin: 0;">GSTIN: ${invoice.gstin || 'N/A'}</p>` : ''}
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin-bottom: 16px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fcfcfe;">
        <div>
          <p style="margin: 0 0 4px; font-weight: 700;">Place of Supply</p>
          <p style="margin: 0;">${invoice.placeOfSupply || 'Maharashtra'}</p>
        </div>
        <div>
          <p style="margin: 0 0 4px; font-weight: 700;">Payment Ref.</p>
          <p style="margin: 0;">${invoice.paymentId || 'N/A'}</p>
        </div>
        <div>
          <p style="margin: 0 0 4px; font-weight: 700;">Order Ref.</p>
          <p style="margin: 0;">${invoice.orderId || 'N/A'}</p>
        </div>
      </div>

      <div style="border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 16px;">
        <div style="background: #f7f8fd; padding: 12px 14px; font-weight: 700;">Description</div>
        <div style="padding: 14px;">Premium access / subscription for the TracMeds app service</div>
      </div>

      <div style="border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 16px;">
        <div style="background: #f7f8fd; padding: 12px 14px; font-weight: 700;">Sales Breakup</div>
        <div style="padding: 14px;">
          <p style="margin: 0 0 6px;">Taxable Value: ${invoice.taxableValue}</p>
          ${invoice.exportSupply ? `<p style="margin: 0 0 6px;">${invoice.exportNote}</p>` : `
            <p style="margin: 0 0 6px;">GST Breakup: ${invoice.gstBreakup}</p>
            ${invoice.cgstAmount !== '₹0.00' ? `<p style="margin: 0 0 6px;">CGST: ${invoice.cgstAmount}</p>` : ''}
            ${invoice.sgstAmount !== '₹0.00' ? `<p style="margin: 0 0 6px;">SGST: ${invoice.sgstAmount}</p>` : ''}
            ${invoice.igstAmount !== '₹0.00' ? `<p style="margin: 0 0 6px;">IGST: ${invoice.igstAmount}</p>` : ''}
            <p style="margin: 0 0 6px;">Total Tax: ${invoice.taxTotal}</p>
          `}
          <p style="margin: 0 0 6px;">SAC: ${invoice.serviceAccountingCode}</p>
          <p style="margin: 0;">Place of Supply: ${invoice.placeOfSupply}</p>
        </div>
      </div>

      <div style="text-align: right; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 18px; font-weight: 700;">Total Amount: ${invoice.totalAmount} INR</p>
      </div>

      ${gstInvoiceHint}
      <p style="margin: 12px 0 0; color: #5c6785; font-size: 12px; line-height: 1.4;">TracMeds is a health-tracking service, not a medical device or substitute for professional medical advice.</p>
    </div>
  `;
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

async function handleCreateOrder(req, res) {
  try {
    const { amount, currency = 'INR', receipt = 'receipt#1', notes = {} } = req.body;
    const amountInt = parseInt(amount, 10);
    if (isNaN(amountInt) || amountInt < 100) {
      return res.status(400).json({ error: 'Invalid amount. Minimum is 100 paise.' });
    }
    const options = buildOrderOptions({ amount: amountInt, currency, receipt, notes });
    const order = await razor.orders.create(options);
    return res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
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
  const checkoutPageUrl = 'https://www.tracmeds.com/';

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.redirect(302, checkoutPageUrl + '?callback_status=failed&return_url=' + encodeURIComponent(returnUrl) + '&cancel_url=' + encodeURIComponent(cancelUrl));
  }

  const generated_signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  if (generated_signature !== razorpay_signature) {
    return res.redirect(302, checkoutPageUrl + '?callback_status=failed&return_url=' + encodeURIComponent(returnUrl) + '&cancel_url=' + encodeURIComponent(cancelUrl));
  }

  // Signature verified — now build the invoice/ledger/email, same as /api/verify-payment,
  // since this redirect-flow path bypasses that route entirely.
  try {
    let notes = {};
    if (req.query.customer_data) {
      notes = JSON.parse(Buffer.from(decodeURIComponent(req.query.customer_data), 'base64').toString('utf8'));
    }

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

  return res.redirect(302, checkoutPageUrl + '?callback_status=success&return_url=' + encodeURIComponent(returnUrl) + '&cancel_url=' + encodeURIComponent(cancelUrl));
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
    } catch { /* sheet may not exist yet — let append create it */ }

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
    const { user, plan, purchasedAt, expiresAt, status, isRenewal } = req.body || {};
    if (!plan || !status) return res.status(400).json({ success: false, error: 'Missing plan or status field' });

    const result = await appendSubscriptionEventToSheet({ user, plan, purchasedAt, expiresAt, status, isRenewal });
    if (!result.success) console.warn('Subscription event sheet append failed', result);

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
};
