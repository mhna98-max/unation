// ============================================================
// server/routes/admin.js — 관리자(운영자) 전용 API
// 일반 크리에이터 계정과 분리된 role='admin' 계정만 접근할 수 있습니다.
// ============================================================
const db = require('../db');
const { readJsonBody, sendJson, sendError } = require('../helpers');
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

function mapNotice(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body || '',
    isPublished: !!row.is_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

    const unators = db.prepare(
      "SELECT COUNT(DISTINCT LOWER(TRIM(nickname))) AS c FROM donations WHERE status='completed' AND TRIM(nickname) != ''"
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
      unatorCount: unators.c,
      receivedTotal: lifetime.total,
      chargedTotal: lifetime.total,
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

    const url = new URL(req.url, 'http://x');
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 40);
    const params = [];
    let where = "WHERE role != 'admin'";
    if (q) {
      where += " AND (LOWER(handle) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(COALESCE(email,'')) LIKE ? OR LOWER(COALESCE(phone,'')) LIKE ?)";
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    const rows = db.prepare(`
      SELECT id, handle, display_name, email, phone, password_hash, social_provider, platform, created_at
      FROM creators ${where} ORDER BY created_at DESC
    `).all(...params);

    const creators = rows.map((c) => {
      const balance = computeBalance(c.id);
      return {
        id: c.id,
        handle: c.handle,
        displayName: c.display_name,
        email: c.email,
        phone: c.phone,
        loginProvider: c.social_provider || (c.password_hash ? 'email' : (c.phone ? 'phone' : 'unknown')),
        platform: c.platform,
        createdAt: c.created_at,
        lifetimeTotal: balance.lifetimeTotal,
        availableSettlement: balance.available,
      };
    });

    sendJson(res, 200, { creators });
  });

  router.get('/api/admin/notices', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const rows = db.prepare('SELECT * FROM notices ORDER BY created_at DESC LIMIT 100').all();
    sendJson(res, 200, { notices: rows.map(mapNotice) });
  });

  router.post('/api/admin/notices', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readJsonBody(req);
    const title = String(body.title || '').trim().slice(0, 80);
    const noticeBody = String(body.body || '').trim().slice(0, 1000);
    const isPublished = body.isPublished === false ? 0 : 1;
    if (!title) return sendError(res, 400, '공지 제목을 입력해주세요.');
    const result = db.prepare(`
      INSERT INTO notices (title, body, is_published, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(title, noticeBody, isPublished);
    const notice = db.prepare('SELECT * FROM notices WHERE id = ?').get(result.lastInsertRowid);
    sendJson(res, 201, { notice: mapNotice(notice) });
  });

  router.put('/api/admin/notices/:id', async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(params.id, 10);
    const body = await readJsonBody(req);
    const title = String(body.title || '').trim().slice(0, 80);
    const noticeBody = String(body.body || '').trim().slice(0, 1000);
    const isPublished = body.isPublished === false ? 0 : 1;
    if (!Number.isInteger(id)) return sendError(res, 400, '공지 ID를 확인해주세요.');
    if (!title) return sendError(res, 400, '공지 제목을 입력해주세요.');
    const updated = db.prepare(`
      UPDATE notices
      SET title = ?, body = ?, is_published = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(title, noticeBody, isPublished, id);
    if (!updated.changes) return sendError(res, 404, '공지사항을 찾을 수 없습니다.');
    const notice = db.prepare('SELECT * FROM notices WHERE id = ?').get(id);
    sendJson(res, 200, { notice: mapNotice(notice) });
  });

  router.delete('/api/admin/notices/:id', async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(params.id, 10);
    if (!Number.isInteger(id)) return sendError(res, 400, '공지 ID를 확인해주세요.');
    const deleted = db.prepare('DELETE FROM notices WHERE id = ?').run(id);
    if (!deleted.changes) return sendError(res, 404, '공지사항을 찾을 수 없습니다.');
    sendJson(res, 200, { ok: true });
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
  router.get('/api/admin/unators', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const url = new URL(req.url, 'http://x');
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 40);
    const params = [];
    let where = "WHERE d.status='completed' AND TRIM(d.nickname) != ''";
    if (q) {
      where += " AND LOWER(d.nickname) LIKE ?";
      params.push(`%${q}%`);
    }

    const rows = db.prepare(`
      SELECT
        LOWER(TRIM(d.nickname)) AS unator_key,
        MIN(d.nickname) AS nickname,
        COUNT(d.id) AS donation_count,
        COALESCE(SUM(d.amount),0) AS donation_total,
        COUNT(DISTINCT d.creator_id) AS creator_count,
        MAX(d.created_at) AS last_donation_at,
        (
          SELECT d2.message FROM donations d2
          WHERE d2.status='completed' AND LOWER(TRIM(d2.nickname)) = LOWER(TRIM(d.nickname))
          ORDER BY d2.created_at DESC LIMIT 1
        ) AS last_message,
        (
          SELECT GROUP_CONCAT(DISTINCT c.display_name)
          FROM donations dx JOIN creators c ON c.id = dx.creator_id
          WHERE dx.status='completed' AND LOWER(TRIM(dx.nickname)) = LOWER(TRIM(d.nickname))
        ) AS creator_names
      FROM donations d
      ${where}
      GROUP BY LOWER(TRIM(d.nickname))
      ORDER BY donation_total DESC, last_donation_at DESC
      LIMIT 200
    `).all(...params);

    const orderRows = db.prepare(`
      SELECT
        LOWER(TRIM(buyer_nickname)) AS unator_key,
        COALESCE(SUM(amount),0) AS order_total,
        COUNT(*) AS order_count,
        MAX(created_at) AS last_order_at,
        MAX(NULLIF(TRIM(buyer_contact),'')) AS last_contact
      FROM orders
      WHERE status='completed' AND TRIM(buyer_nickname) != ''
      GROUP BY LOWER(TRIM(buyer_nickname))
    `).all();
    const orderMap = new Map(orderRows.map((o) => [o.unator_key, o]));

    sendJson(res, 200, {
      unators: rows.map((u) => {
        const order = orderMap.get(u.unator_key) || {};
        return {
          key: u.unator_key,
          nickname: u.nickname,
          donationCount: u.donation_count,
          donationTotal: u.donation_total,
          creatorCount: u.creator_count,
          creatorNames: u.creator_names ? String(u.creator_names).split(',').slice(0, 8) : [],
          lastDonationAt: u.last_donation_at,
          lastMessage: u.last_message || '',
          orderCount: order.order_count || 0,
          orderTotal: order.order_total || 0,
          lastOrderAt: order.last_order_at || null,
          lastContact: order.last_contact || '',
        };
      }),
    });
  });

  router.get('/api/admin/unators/:key', async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const key = decodeURIComponent(params.key || '').trim().toLowerCase();
    if (!key) return sendError(res, 400, '유네이터 키를 확인해주세요.');

    const donations = db.prepare(`
      SELECT d.*, c.handle AS creator_handle, c.display_name AS creator_name
      FROM donations d JOIN creators c ON c.id = d.creator_id
      WHERE d.status='completed' AND LOWER(TRIM(d.nickname)) = ?
      ORDER BY d.created_at DESC LIMIT 100
    `).all(key);

    const orders = db.prepare(`
      SELECT o.*, p.name AS product_name, c.handle AS creator_handle, c.display_name AS creator_name
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN creators c ON c.id = o.creator_id
      WHERE o.status='completed' AND LOWER(TRIM(o.buyer_nickname)) = ?
      ORDER BY o.created_at DESC LIMIT 100
    `).all(key);

    const donationTotal = donations.reduce((sum, d) => sum + Number(d.amount || 0), 0);
    const orderTotal = orders.reduce((sum, o) => sum + Number(o.amount || 0), 0);

    sendJson(res, 200, {
      unator: {
        key,
        nickname: donations[0]?.nickname || orders[0]?.buyer_nickname || key,
        donationTotal,
        donationCount: donations.length,
        orderTotal,
        orderCount: orders.length,
        lastContact: orders.find((o) => o.buyer_contact)?.buyer_contact || '',
      },
      donations: donations.map((d) => ({
        id: d.id,
        creatorName: d.creator_name,
        creatorHandle: d.creator_handle,
        amount: d.amount,
        message: d.message,
        donationType: d.donation_type,
        paymentMethod: d.payment_method,
        createdAt: d.created_at,
      })),
      orders: orders.map((o) => ({
        id: o.id,
        creatorName: o.creator_name,
        creatorHandle: o.creator_handle,
        productName: o.product_name,
        amount: o.amount,
        quantity: o.quantity,
        contact: o.buyer_contact,
        paymentMethod: o.payment_method,
        createdAt: o.created_at,
      })),
    });
  });

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
