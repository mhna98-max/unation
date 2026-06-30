// ============================================================
// server/index.js — 유네이션(UNATION) 서버 진입점
// 외부 npm 패키지 없이 Node.js 내장 모듈만 사용합니다.
// 실행: node server/index.js  (또는 npm start / npm run dev)
// ============================================================
require('./env').loadEnv();

const http = require('http');
const fs = require('fs');
const path = require('path');

const Router = require('./router');
const registerAuthRoutes = require('./routes/auth');
const registerCreatorRoutes = require('./routes/creators');
const registerDonationRoutes = require('./routes/donations');
const registerSettlementRoutes = require('./routes/settlements');
const registerStreamRoutes = require('./routes/stream');
const registerAdminRoutes = require('./routes/admin');
const registerProductRoutes = require('./routes/products');
const registerOrderRoutes = require('./routes/orders');
const { assertPaymentProviderSafeToBoot, getPaymentMode } = require('./paymentProvider');

assertPaymentProviderSafeToBoot();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const router = new Router();
registerAuthRoutes(router);
registerCreatorRoutes(router);
registerDonationRoutes(router);
registerSettlementRoutes(router);
registerStreamRoutes(router);
registerAdminRoutes(router);
registerProductRoutes(router);
registerOrderRoutes(router);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(base)) return null; // path traversal 방지
  return targetPath;
}

function serveStatic(req, res, pathname) {
  // 브라우저가 자동으로 요청하는 /favicon.ico 를 SVG 파비콘으로 응답 (불필요한 404 방지)
  if (pathname === '/favicon.ico') {
    const svgPath = path.join(PUBLIC_DIR, 'favicon.svg');
    if (fs.existsSync(svgPath)) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      fs.createReadStream(svgPath).pipe(res);
      return;
    }
  }

  let rel = pathname === '/' ? '/index.html' : pathname;
  const candidates = [rel];
  if (!path.extname(rel)) candidates.push(`${rel}.html`, `${rel}/index.html`);

  for (const candidate of candidates) {
    const filePath = safeJoin(PUBLIC_DIR, candidate);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  // 존재하지 않는 페이지 — 브랜드에 맞는 404 페이지로 응답
  const notFoundPath = path.join(PUBLIC_DIR, '404.html');
  if (fs.existsSync(notFoundPath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(notFoundPath).pipe(res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

const server = http.createServer(async (req, res) => {
  // 기본 보안 헤더 — MIME 스니핑/클릭재킹/리퍼러 유출 방지
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/public/config' && req.method === 'GET') {
        const paymentMode = getPaymentMode();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          paymentMode,
          mockPayments: paymentMode === 'mock',
        }));
        return;
      }
      const matched = await router.handle(req, res, pathname);
      if (!matched) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '존재하지 않는 API 경로예요.' }));
      }
      return;
    }
    serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[server error]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '서버 오류가 발생했어요.' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n  유네이션(UNATION) 서버가 http://localhost:${PORT} 에서 실행 중입니다.\n`);
});
