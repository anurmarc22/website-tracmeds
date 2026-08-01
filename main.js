const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

let mainWindow;
let server;
const port = 8000;
const rootDir = __dirname;

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.apk': 'application/vnd.android.package-archive'
  };
  return types[ext] || 'application/octet-stream';
}

function startServer() {
  server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(requestUrl.pathname);
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(rootDir, safePath.replace(/^\//, ''));

    fs.readFile(filePath, (error, data) => {
      if (error || !fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      res.writeHead(200, { 'Content-Type': getContentType(filePath) });
      res.end(data);
    });
  });

  server.listen(port, '127.0.0.1');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'TracMeds',
    icon: path.join(rootDir, 'icon.png'),
    backgroundColor: '#6f4fd8',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (server) {
    server.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server) {
    server.close();
  }
});
