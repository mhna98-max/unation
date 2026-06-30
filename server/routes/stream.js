// ============================================================
// server/routes/stream.js — 실시간 알림 구독 (SSE)
// /api/stream/:key  — key는 크리에이터 handle 또는 'global'
// ============================================================
const sse = require('../sse');

module.exports = function registerStreamRoutes(router) {
  router.get('/api/stream/:key', async (req, res, params) => {
    sse.subscribe(req, res, params.key);
  });
};
