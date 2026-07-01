// ============================================================
// server/routes/settlements.js — 정산 신청 / 정산 내역
// ============================================================
const db = require('../db');
const { sendJson, sendError } = require('../helpers');
const { getCreatorFromRequest } = require('../auth');
const { computeBalance, MIN_SETTLEMENT_AMOUNT } = require('../ledger');
const { rateLimit } = require('../rateLimit');

module.exports = function registerSettlementRoutes(router) {
  router.post('/api/settlements', async (req, res) => {
    if (!rateLimit(req, res, 'settlement-request', 10, 60 * 60 * 1000)) return; // 1시간에 10회

    const auth = getCreatorFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');

    const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(auth.uid);
    if (!creator.bank_name || !creator.bank_account || !creator.bank_holder) {
      return sendError(res, 400, '정산받을 계좌 정보를 먼저 등록해주세요.');
    }

    // 클라이언트 값을 믿지 않고 서버에서 다시 계산
    const balance = computeBalance(auth.uid);
    if (balance.available <= 0) {
      return sendError(res, 400, '정산 가능한 금액이 없어요.');
    }
    if (balance.available < MIN_SETTLEMENT_AMOUNT) {
      return sendError(res, 400, `최소 정산 금액은 ${MIN_SETTLEMENT_AMOUNT.toLocaleString()}원이에요. 후원이 더 쌓이면 신청할 수 있어요.`);
    }

    const result = db.prepare(`
      INSERT INTO settlements (creator_id, amount, status) VALUES (?, ?, 'requested')
    `).run(auth.uid, balance.available);

    const settlement = db.prepare('SELECT * FROM settlements WHERE id = ?').get(result.lastInsertRowid);
    sendJson(res, 201, {
      settlement: {
        id: settlement.id,
        amount: settlement.amount,
        status: settlement.status,
        requestedAt: settlement.requested_at,
      },
    });
  });

  router.get('/api/settlements/me', async (req, res) => {
    const auth = getCreatorFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const rows = db.prepare(`
      SELECT * FROM settlements WHERE creator_id = ? ORDER BY requested_at DESC LIMIT 50
    `).all(auth.uid);
    sendJson(res, 200, {
      settlements: rows.map((s) => ({
        id: s.id, amount: s.amount, status: s.status, requestedAt: s.requested_at, paidAt: s.paid_at,
      })),
    });
  });
};
