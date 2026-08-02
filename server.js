require('dotenv').config();
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const bodyParser = require('body-parser');

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

app.post('/api/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt = 'receipt#1' } = req.body;
    const amountInt = parseInt(amount, 10);
    if (isNaN(amountInt) || amountInt < 100) {
      return res.status(400).json({ error: 'Invalid amount. Minimum is 100 paise.' });
    }

    const options = {
      amount: amountInt,
      currency,
      receipt,
      payment_capture: 1,
    };

    const order = await razor.orders.create(options);
    return res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    if (err.statusCode === 401) return res.status(401).json({ error: 'Authentication with Razorpay failed.' });
    console.error('Create order error', err);
    return res.status(500).json({ error: 'Unable to create order' });
  }
});

app.post('/api/verify-payment', (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const generated_signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  if (generated_signature === razorpay_signature) {
    return res.json({ success: true });
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

app.listen(PORT, () => console.log(`Razorpay server listening on port ${PORT}`));
