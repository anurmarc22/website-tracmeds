const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildOrderOptions, buildInvoiceData, buildInvoiceEmailHtml, appendLedgerEntry, getLedgerEntries, calculatePayoutEstimate } = require('./server');

test('buildOrderOptions includes sanitized Razorpay notes', () => {
  const options = buildOrderOptions({
    amount: 14900,
    currency: 'INR',
    receipt: 'receipt#1',
    notes: {
      name: '  Anurag Sinha  ',
      phone: '9999999999',
      email: 'user@example.com',
      gst_required: 'yes',
      gstin: '27ABCDE1234F1Z5',
      plan: 'monthly'
    }
  });

  assert.equal(options.amount, 14900);
  assert.deepEqual(options.notes, {
    name: 'Anurag Sinha',
    phone: '9999999999',
    email: 'user@example.com',
    gst_required: 'yes',
    gstin: '27ABCDE1234F1Z5',
    plan: 'monthly'
  });
});

test('buildInvoiceData continues invoice series from existing ledger entries', () => {
  const ledgerPath = path.join(__dirname, 'tmp-ledger-sequence.json');
  process.env.LEDGER_FILE_PATH = ledgerPath;
  fs.writeFileSync(ledgerPath, JSON.stringify([
    { invoiceNumber: 'TRACMEDS-2026-5855' },
    { invoiceNumber: 'TRACMEDS-2026-5856' }
  ], null, 2), 'utf8');

  const invoice = buildInvoiceData({
    name: 'Series User',
    phone: '9999999999',
    email: 'series@example.com',
    gstRequired: false,
    gstin: '',
    amount: 14900,
    currency: 'INR',
    plan: 'monthly',
    paymentId: 'pay_999',
    orderId: 'order_999',
    receipt: 'receipt#999'
  });

  assert.equal(invoice.invoiceNumber, 'TRACMEDS-2026-5857');
  fs.unlinkSync(ledgerPath);
  delete process.env.LEDGER_FILE_PATH;
});

test('buildInvoiceData includes customer and tax details', () => {
  const invoice = buildInvoiceData({
    name: 'Anurag Sinha',
    phone: '9999999999',
    email: 'user@example.com',
    gstRequired: true,
    gstin: '27ABCDE1234F1Z5',
    amount: 14900,
    currency: 'INR',
    plan: 'monthly',
    paymentId: 'pay_123',
    orderId: 'order_123',
    receipt: 'receipt#1'
  });

  assert.equal(invoice.customerName, 'Anurag Sinha');
  assert.equal(invoice.gstRequired, true);
  assert.equal(invoice.gstin, '27ABCDE1234F1Z5');
  assert.equal(invoice.totalAmount, '₹149.00');
  assert.match(invoice.invoiceNumber, /^TRACMEDS-2026-\d{4}$/);
});

test('buildInvoiceData computes IGST for out-of-state place of supply', () => {
  const invoice = buildInvoiceData({
    name: 'Test User',
    phone: '9999999999',
    email: 'test@example.com',
    gstRequired: true,
    gstin: '27ABCDE1234F1Z5',
    amount: 14900,
    currency: 'INR',
    plan: 'monthly',
    paymentId: 'pay_789',
    orderId: 'order_789',
    receipt: 'receipt#3',
    placeOfSupply: 'Karnataka'
  });

  assert.equal(invoice.placeOfSupply, 'Karnataka');
  assert.equal(invoice.gstBreakup, 'IGST 18%');
  assert.equal(invoice.cgstAmount, '₹0.00');
  assert.equal(invoice.sgstAmount, '₹0.00');
  assert.equal(invoice.igstAmount, '₹22.73');
});

test('buildInvoiceData creates export invoice data for outside India with LUT wording', () => {
  const invoice = buildInvoiceData({
    name: 'Export User',
    phone: '9999999999',
    email: 'export@example.com',
    gstRequired: false,
    gstin: '',
    amount: 14900,
    currency: 'INR',
    plan: 'monthly',
    paymentId: 'pay_export_001',
    orderId: 'order_export_001',
    receipt: 'receipt_export_001',
    placeOfSupply: 'Outside India'
  });

  assert.equal(invoice.placeOfSupply, 'Outside India');
  assert.equal(invoice.exportSupply, true);
  assert.equal(invoice.gstBreakup, 'Export under Letter of Undertaking without payment of Integrated Tax');
  assert.equal(invoice.taxableValue, '₹149.00');
  assert.equal(invoice.taxTotal, '₹0.00');
  assert.equal(invoice.cgstAmount, '₹0.00');
  assert.equal(invoice.sgstAmount, '₹0.00');
  assert.equal(invoice.igstAmount, '₹0.00');
  assert.equal(invoice.exportNote, 'Supply meant for Export Under Letter of Undertaking Without Payment of Integrated Tax.');
});

test('buildInvoiceEmailHtml uses GST wording when requested', () => {
  const invoice = buildInvoiceData({
    name: 'Anurag Sinha',
    phone: '9999999999',
    email: 'user@example.com',
    gstRequired: true,
    gstin: '27ABCDE1234F1Z5',
    amount: 14900,
    currency: 'INR',
    plan: 'monthly',
    paymentId: 'pay_123',
    orderId: 'order_123',
    receipt: 'receipt#1'
  });

  const html = buildInvoiceEmailHtml(invoice);
  assert.match(html, /GST Invoice/i);
  assert.match(html, /GSTIN:/i);
});

test('appendLedgerEntry stores a payment record for bookkeeping', () => {
  const ledgerPath = path.join(__dirname, 'tmp-ledger-test.json');
  process.env.LEDGER_FILE_PATH = ledgerPath;
  if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);

  const invoice = buildInvoiceData({
    name: 'Anurag Sinha',
    phone: '9999999999',
    email: 'user@example.com',
    gstRequired: false,
    gstin: '',
    amount: 14900,
    currency: 'INR',
    plan: 'monthly',
    paymentId: 'pay_456',
    orderId: 'order_456',
    receipt: 'receipt#2'
  });

  const entry = appendLedgerEntry(invoice);
  const entries = getLedgerEntries();

  assert.equal(entry.paymentId, 'pay_456');
  assert.equal(entries[0].paymentId, 'pay_456');
  assert.equal(entries[0].gstRequired, false);
  fs.unlinkSync(ledgerPath);
  delete process.env.LEDGER_FILE_PATH;
});

test('calculatePayoutEstimate returns merchant net amount for standard Razorpay fees', () => {
  const estimate = calculatePayoutEstimate({ amount: 14900 });
  assert.equal(estimate.grossAmount, 149);
  assert.equal(estimate.netPayout.toFixed(2), '145.48');
});
