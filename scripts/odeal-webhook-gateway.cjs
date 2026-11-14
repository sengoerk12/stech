'use strict';

const http = require('node:http');
const callbacks = new Set([
  '/api/v1/webhooks/odeal/payment-succeeded',
  '/api/v1/webhooks/odeal/payment-cancelled',
  '/api/v1/webhooks/odeal/basket-cancelled',
  '/api/v1/webhooks/odeal/payment-failed',
]);

http.createServer((req, res) => {
  if (req.method !== 'POST' || !callbacks.has(req.url)) {
    res.writeHead(404).end();
    return;
  }
  const requestKey = req.headers['x-odeal-request-key'];
  if (!requestKey) {
    res.writeHead(401).end();
    return;
  }
  const upstream = http.request({
    host: '127.0.0.1',
    port: 3091,
    method: 'POST',
    path: req.url,
    headers: {
      'content-type': req.headers['content-type'] || 'application/json',
      'x-odeal-request-key': requestKey,
    },
    timeout: 15000,
  }, reply => {
    res.writeHead(reply.statusCode, { 'content-type': 'application/json' });
    reply.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(503);
    res.end();
  });
  res.on('close', () => upstream.destroy());
  req.on('error', () => upstream.destroy());
  req.pipe(upstream);
}).listen(3011, '127.0.0.1');
