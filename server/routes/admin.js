// ============================================================
// server/routes/admin.js — 관리자(운영자) 전용 API
// 일반 크리에이터 계정과 분리된 role='admin' 계정만 접근할 수 있습니다.
// ============================================================
const db = require('../db');
const { sendJson, sendError } = require('../helpers');
const { getAdminFromRequest } = require('../auth');
const { computeBalance } = require('../ledger');

function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    sendError(res, 403, '관리자 권한이 필요해요.');
    return null;
  }
  return admin;
}

module.exports = function registerAdminRoutes(router) {
  // ── 플랫폼 전체 개요 ──
  router.get('/api/admin/overview', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const creatorCount = db.prepare(
      "SELECT COUNT(*) AS c FROM creators WHERE role != 'admin'"
    ).get().c;

    const lifetime = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM donations WHERE status='completed'"
    ).get();

    const thisMonth = db.prepare(`
      SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM donations
      WHERE status='completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')
    `).get();

    const lastMonth = db.prepare(`
      SELECT COALESCE(SUM(amount),0) AS total FROM donations
      WHERE status='completed'
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', date('now','start of month','-1 day'))
    `).get();

    const pendingSettlements = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM settlements WHERE status='requested'"
    ).get();

    const paidSettlements = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM settlements WHERE status='paid'"
    ).get();

    const pct = (curr, prev) => (prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0));

    // 최근 7일 일별 합계
    const dayRows = db.prepare(`
      SELECT date(created_at) AS d, COALESCE(SUM(amount),0) AS total FROM donations
      WHERE status='completed' AND created_at >= datetime('now','-6 days','start of day')
      GROUP BY d
    `).all();
    const byDate = Object.fromEntries(dayRows.map((r) => [r.d, r.total]));
    const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      last7.push({ date: key, label: dayLabels[d.getDay()], total: byDate[key] || 0 });
    }

    // 크리에이터 랭킹 Top 5 (이번 달)
    const topCreators = db.prepare(`
      SELECT c.id, c.handle, c.display_name AS displayName, COALESCE(SUM(d.amount),0) AS total
      FROM creators c
      LEFT JOIN donations d ON d.creator_id = c.id AND d.status='completed'
        AND strftime('%Y-%m', d.created_at) = strftime('%Y-%m','now')
      WHERE c.role != 'admin'
      GROUP BY c.id
      ORDER BY total DESC
      LIMIT 5
    `).all();

    sendJson(res, 200, {
      creatorCount,
      lifetimeTotal: lifetime.total,
      lifetimeCount: lifetime.cnt,
      thisMonthTotal: thisMonth.total,
      thisMonthCount: thisMonth.cnt,
      thisMonthDeltaPct: pct(thisMonth.total, lastMonth.total),
      pendingSettlementTotal: pendingSettlements.total,
      pendingSettlementCount: pendingSettlements.cnt,
      paidSettlementTotal: paidSettlements.total,
      paidSettlementCount: paidSettlements.cnt,
      last7,
      topCreators,
    });
  });

  // ── 크리에이터 목록 ──
  router.get('/api/admin/creators', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const rows = db.prepare(`
      SELECT id, handle, display_name, email, phone, platform, created_at
      FROM creators WHERE role != 'admin' ORDER BY created_at DESC
    `).all();

    const creators = rows.map((c) => {
      const balance = computeBalance(c.id);
      return {
        id: c.id,
        handle: c.handle,
        displayName: c.display_name,
        email: c.email,
        phone: c.phone,
        platform: c.platform,
        createdAt: c.created_at,
        lifetimeTotal: balance.lifetimeTotal,
        availableSettlement: balance.available,
      };
    });

    sendJson(res, 200, { creators });
  });

  // ── 특정 크리에이터 상세 (후원/정산 내역 포함) ──
  router.get('/api/admin/creators/:id', async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(params.id, 10);
    const creator = db.prepare('SELECT * FROM creators WHERE id = ? AND role != \'admin\'').get(id);
    if (!creator) return sendError(res, 404, '크리에이터를 찾을 수 없어요.');

    const donations = db.prepare(
      'SELECT * FROM donations WHERE creator_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(id);
    const settlements = db.prepare(
      'SELECT * FROM settlements WHERE creator_id = ? ORDER BY requested_at DESC LIMIT 50'
    ).all(id);
    const balance = computeBalance(id);

    sendJson(res, 200, {
      creator: {
        id: creator.id,
        handle: creator.handle,
        displayName: creator.display_name,
        email: creator.email,
        phone: creator.phone,
        bio: creator.bio,
        platform: creator.platform,
        bankName: creator.bank_name,
        bankAccount: creator.bank_account,
        bankHolder: creator.bank_holder,
        createdAt: creator.created_at,
      },
      balance,
      donations: donations.map((d) => ({
        id: d.id, nickname: d.nickname, amount: d.amount, message: d.message,
        donationType: d.donation_type, paymentMethod: d.payment_method, createdAt: d.created_at,
      })),
      settlements: settlements.map((s) => ({
        id: s.id, amount: s.amount, status: s.status, requestedAt: s.requested_at, paidAt: s.paid_at,
      })),
    });
  });

  // ── 전체 후원 내역 (플랫폼 전체) ──
  router.get('/api/admin/donations', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

    const rows = db.prepare(`
      SELECT d.*, c.handle AS creator_handle, c.display_name AS creator_name
      FROM donations d JOIN creators c ON c.id = d.creator_id
      ORDER BY d.created_at DESC LIMIT ?
    `).all(limit);

    sendJson(res, 200, {
      donations: rows.map((d) => ({
        id: d.id,
        creatorHandle: d.creator_handle,
        creatorName: d.creator_name,
        nickname: d.nickname,
        amount: d.amount,
        message: d.message,
        donationType: d.donation_type,
        paymentMethod: d.payment_method,
        status: d.status,
        createdAt: d.created_at,
      })),
    });
  });

  // ── 전체 정산 목록 ──
  router.get('/api/admin/settlements', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const url = new URL(req.url, 'http://x');
    const status = url.searchParams.get('status'); // requested | paid | rejected | (없으면 전체)

    let rows;
    if (status) {
      rows = db.prepare(`
        SELECT s.*, c.handle AS creator_handle, c.display_name AS creator_name,
               c.bank_name, c.bank_account, c.bank_holder
        FROM settlements s JOIN creators c ON c.id = s.creator_id
        WHERE s.status = ?
        ORDER BY s.requested_at DESC LIMIT 200
      `).all(status);
    } else {
      rows = db.prepare(`
        SELECT s.*, c.handle AS creator_handle, c.display_name AS creator_name,
               c.bank_name, c.bank_account, c.bank_holder
        FROM settlements s JOIN creators c ON c.id = s.creator_id
        ORDER BY s.requested_at DESC LIMIT 200
      `).all();
    }

    sendJson(res, 200, {
      settlements: rows.map((s) => ({
        id: s.id,
        creatorHandle: s.creator_handle,
        creatorName: s.creator_name,
        bankName: s.bank_name,
        bankAccount: s.bank_account,
        bankHolder: s.bank_holder,
        amount: s.amount,
        status: s.status,
        requestedAt: s.requested_at,
        paidAt: s.paid_at,
      })),
    });
  });

  // ── 정산 승인(지급 완료 처리) ──
  router.post('/api/admin/settlements/:id/approve', async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(params.id, 10);
    const settlement = db.prepare('SELECT * FROM settlements WHERE id = ?').get(id);
    if (!settlement) return sendError(res, 404, '정산 신청을 찾을 수 없어요.');
    if (settlement.status !== 'requested') return sendError(res, 400, '이미 처리된 정산 신청이에요.');

    db.prepare("UPDATE settlements SET status='paid', paid_at = datetime('now') WHERE id = ?").run(id);
    const updated = db.prepare('SELECT * FROM settlements WHERE id = ?').get(id);
    sendJson(res, 200, {
      settlement: { id: updated.id, amount: updated.amount, status: updated.status, paidAt: updated.paid_at },
    });
  });

  // ── 정산 반려 ──
  router.post('/api/admin/settlements/:id/reject', async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(params.id, 10);
    const settlement = db.prepare('SELECT * FROM settlements WHERE id = ?').get(id);
    if (!settlement) return sendError(res, 404, '정산 신청을 찾을 수 없어요.');
    if (settlement.status !== 'requested') return sendError(res, 400, '이미 처리된 정산 신청이에요.');

    db.prepare("UPDATE settlements SET status='rejected' WHERE id = ?").run(id);
    sendJson(res, 200, { settlement: { id, status: 'rejected' } });
  });
};
