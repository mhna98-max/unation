// ============================================================
// server/routes/creators.js — 크리에이터 목록 / 프로필 / 설정
// ============================================================
const db = require('../db');
const { readJsonBody, sendJson, sendError, publicCreator, privateCreator } = require('../helpers');
const { getAuthFromRequest } = require('../auth');

module.exports = function registerCreatorRoutes(router) {
  // 플랫폼 전체 현황 (랜딩 페이지 통계용 — 실제 DB 값)
  router.get('/api/stats', async (req, res) => {
    const totalCreators = db.prepare("SELECT COUNT(*) AS c FROM creators WHERE role != 'admin'").get().c;
    const totalCitizens = db.prepare("SELECT COUNT(*) AS c FROM donations WHERE status='completed'").get().c;
    const thisMonth = db.prepare(`
      SELECT COALESCE(SUM(amount),0) AS total FROM donations
      WHERE status='completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
    `).get().total;
    sendJson(res, 200, { totalCreators, totalCitizens, thisMonthTotal: thisMonth });
  });

  // 성장 중인 크리에이터 목록 (시민 수 기준 상위 N명)
  router.get('/api/creators', async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '6', 10) || 6, 20);
    const rows = db.prepare(`
      SELECT c.*, COUNT(d.id) AS citizen_count, COALESCE(SUM(d.amount),0) AS total_amount
      FROM creators c
      LEFT JOIN donations d ON d.creator_id = c.id AND d.status = 'completed'
      WHERE c.role != 'admin'
      GROUP BY c.id
      ORDER BY citizen_count DESC, c.created_at DESC
      LIMIT ?
    `).all(limit);
    sendJson(res, 200, {
      creators: rows.map((c) => ({ ...publicCreator(c), citizenCount: c.citizen_count, totalAmount: c.total_amount })),
    });
  });

  // 내 프로필 수정 (로그인 필요) — /:handle 패턴보다 먼저 등록되어야 'me'가 핸들로 오인되지 않음
  router.put('/api/creators/me', async (req, res) => {
    const auth = getAuthFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const body = await readJsonBody(req);

    const VALID_PLATFORMS = new Set(['twitch', 'soop', 'chzzk', 'youtube', '']);
    if (body.platform !== undefined && !VALID_PLATFORMS.has(body.platform)) {
      return sendError(res, 400, '지원하지 않는 플랫폼이에요.');
    }

    const fields = [];
    const values = [];
    const map = {
      displayName: 'display_name',
      bio: 'bio',
      goalLabel: 'goal_label',
      goalAmount: 'goal_amount',
      bankName: 'bank_name',
      bankAccount: 'bank_account',
      bankHolder: 'bank_holder',
      platform: 'platform',
      platformChannel: 'platform_channel',
      chatEmbedUrl: 'chat_embed_url',
    };
    for (const [key, col] of Object.entries(map)) {
      if (body[key] !== undefined) {
        fields.push(`${col} = ?`);
        values.push(body[key] === '' ? null : body[key]);
      }
    }

    // 후원 내역 공개 여부 (불리언)
    if (body.showDonationsPublicly !== undefined) {
      fields.push('show_donations_publicly = ?');
      values.push(body.showDonationsPublicly ? 1 : 0);
    }

    // 룰렛 후원 구성 — [{label, weight}] 형태만 허용, 최대 8개 항목
    if (body.rouletteSegments !== undefined) {
      if (!Array.isArray(body.rouletteSegments) || !body.rouletteSegments.length) {
        return sendError(res, 400, '룰렛 항목을 1개 이상 설정해주세요.');
      }
      if (body.rouletteSegments.length > 8) {
        return sendError(res, 400, '룰렛 항목은 최대 8개까지 설정할 수 있어요.');
      }
      const cleaned = [];
      for (const seg of body.rouletteSegments) {
        const label = String(seg.label || '').trim().slice(0, 20);
        const weight = Number(seg.weight);
        if (!label) return sendError(res, 400, '룰렛 항목 이름을 입력해주세요.');
        if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) {
          return sendError(res, 400, '룰렛 확률 가중치는 1~1000 사이 숫자로 입력해주세요.');
        }
        cleaned.push({ label, weight });
      }
      fields.push('roulette_segments = ?');
      values.push(JSON.stringify(cleaned));
    }

    if (!fields.length) return sendError(res, 400, '변경할 내용이 없어요.');

    db.prepare(`UPDATE creators SET ${fields.join(', ')} WHERE id = ?`).run(...values, auth.uid);
    const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(auth.uid);
    sendJson(res, 200, { creator: privateCreator(creator) });
  });

  // 공개 프로필 (핸들 기준) — 통계 포함
  router.get('/api/creators/:handle', async (req, res, params) => {
    const creator = db.prepare('SELECT * FROM creators WHERE handle = ?').get(params.handle);
    if (!creator) return sendError(res, 404, '크리에이터를 찾을 수 없어요.');

    const citizenCount = db.prepare(
      "SELECT COUNT(*) AS c FROM donations WHERE creator_id = ? AND status='completed'"
    ).get(creator.id).c;
    const thisMonthTotal = db.prepare(`
      SELECT COALESCE(SUM(amount),0) AS total FROM donations
      WHERE creator_id = ? AND status='completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
    `).get(creator.id).total;
    const lifetimeTotal = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total FROM donations WHERE creator_id = ? AND status='completed'"
    ).get(creator.id).total;

    sendJson(res, 200, {
      creator: publicCreator(creator),
      stats: { citizenCount, thisMonthTotal, lifetimeTotal },
    });
  });
};
