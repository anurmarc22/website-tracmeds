require('dotenv').config();
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3001;

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('Warning: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set in environment');
}

const razor = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

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
    totalAmount: `₹${amountInRupees.toFixed(2)}`,
    taxableValue: `₹${taxableValueNum.toFixed(2)}`,
    taxTotal: `₹${taxTotalNum.toFixed(2)}`,
    cgstAmount: `₹${cgstAmountNum.toFixed(2)}`,
    sgstAmount: `₹${sgstAmountNum.toFixed(2)}`,
    igstAmount: `₹${igstAmountNum.toFixed(2)}`,
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
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('Email credentials not configured; skipping invoice email send.');
    return { success: false, reason: 'missing_email_credentials' };
  }

  const html = buildInvoiceEmailHtml(invoice);

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: invoice.customerEmail,
    subject: `TracMeds Invoice ${invoice.invoiceNumber}`,
    html,
  });

  return { success: true };
}

app.post('/api/create-order', async (req, res) => {
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
});

app.post('/api/verify-payment', async (req, res) => {
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
    await sendInvoiceEmail(invoice);
    return res.json({ success: true, invoice });
  }
  return res.status(400).json({ success: false, error: 'Signature mismatch' });
});

app.post('/api/payment-callback', (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  const returnUrl = req.query.return_url || 'tracmeds://payment/complete';
  const cancelUrl = req.query.cancel_url || 'tracmeds://payment/cancel';
  const checkoutPageUrl = 'https://www.tracmeds.com/razorpay/';

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.redirect(302, checkoutPageUrl + '?callback_status=failed&return_url=' + encodeURIComponent(returnUrl) + '&cancel_url=' + encodeURIComponent(cancelUrl));
  }

  const generated_signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  if (generated_signature === razorpay_signature) {
    return res.redirect(302, checkoutPageUrl + '?callback_status=success&return_url=' + encodeURIComponent(returnUrl) + '&cancel_url=' + encodeURIComponent(cancelUrl));
  }
  return res.redirect(302, checkoutPageUrl + '?callback_status=failed&return_url=' + encodeURIComponent(returnUrl) + '&cancel_url=' + encodeURIComponent(cancelUrl));
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
