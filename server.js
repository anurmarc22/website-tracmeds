const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getStaticFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { success: false, error: 'Not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function createRazorpayOrder(payload) {
  return new Promise((resolve, reject) => {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      reject(new Error('Razorpay credentials are not configured in the .env file.'));
      return;
    }

    const body = JSON.stringify({
      amount: payload.amount,
      currency: payload.currency || 'INR',
      receipt: payload.receipt || `tracmeds-${Date.now()}`,
      notes: payload.notes || {}
    });

    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const req = https.request({
      hostname: 'api.razorpay.com',
      path: '/v1/orders',
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (error) {
            reject(new Error('Failed to parse Razorpay order response.'));
          }
        } else {
          reject(new Error(`Razorpay order creation failed (${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function verifyRazorpaySignature(payload) {
  const { order_id, payment_id, signature } = payload;
  const generatedSignature = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${order_id}|${payment_id}`)
    .digest('hex');

  return generatedSignature === signature;
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'POST' && reqUrl.pathname === '/api/checkout/create-order') {
    try {
      const body = await readBody(req);
      const order = await createRazorpayOrder(body);
      sendJson(res, 200, {
        success: true,
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: RAZORPAY_KEY_ID,
        receipt: order.receipt
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message || 'Unable to create Razorpay order.' });
    }
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/checkout/verify-payment') {
    try {
      const body = await readBody(req);
      const isValid = verifyRazorpaySignature(body);
      sendJson(res, 200, {
        success: isValid,
        verified: isValid,
        message: isValid ? 'Payment signature verified.' : 'Payment signature verification failed.'
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message || 'Unable to verify payment.' });
    }
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/health') {
    sendJson(res, 200, {
      success: true,
      message: 'Backend is running.',
      key_id_configured: Boolean(RAZORPAY_KEY_ID),
      key_secret_configured: Boolean(RAZORPAY_KEY_SECRET)
    });
    return;
  }

  const requestedPath = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const normalizedPath = path.normalize(requestedPath).replace(/^\/+/, '');
  const absolutePath = path.join(ROOT_DIR, normalizedPath);

  if (!absolutePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { success: false, error: 'Forbidden' });
    return;
  }

  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
    getStaticFile(res, absolutePath);
  } else {
    sendJson(res, 404, { success: false, error: 'Not found' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`);
});
