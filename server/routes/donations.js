// ============================================================
// server/routes/donations.js — 후원 생성 / 피드 / 내 후원내역 / 대시보드 통계
// ============================================================
const db = require('../db');
const { readJsonBody, sendJson, sendError, parseRouletteSegments } = require('../helpers');
const { getCreatorFromRequest } = require('../auth');
const { getPaymentProvider, assertPaymentProviderSafeForRequest } = require('../paymentProvider');
const { computeBalance, MIN_SETTLEMENT_AMOUNT } = require('../ledger');
const { rateLimit } = require('../rateLimit');
const sse = require('../sse');

const PAYMENT_METHODS = new Set(['card', 'kakaopay', 'tosspay', 'mobile', 'transfer']);
const MAX_AMOUNT = 5_000_000;
const MIN_AMOUNT = 1000;       // 일반 후원 최소 금액
const MIN_AMOUNT_MINI = 100;   // 미니후원 최소 금액 (투네이션 기준 참고)

// 스티커 후원 — 임의 이미지 URL 대신 정해진 이모지 세트만 허용해서
// (이전 이미지 후원과 달리) 외부 콘텐츠 핫링크 없이 안전하게 처리합니다.
const STICKER_EMOJIS = new Set(['🎉','💜','🔥','⭐','🎊','💎','👑','🍀','🌈','💌','🐰','🐱']);

// weight 기반 가중치 추첨 — segments: [{label, weight}]
function weightedPick(segments) {
  const total = segments.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * total;
  for (const s of segments) {
    if (r < s.weight) return s.label;
    r -= s.weight;
  }
  return segments[segments.length - 1].label;
}

function mapDonationRow(d) {
  return {
    id: d.id,
    citizenNumber: d.citizen_number,
    nickname: d.nickname,
    amount: d.amount,
    message: d.message,
    donationType: d.donation_type,
    videoUrl: d.video_url,
    imageUrl: d.image_url,
    rouletteResult: d.roulette_result,
    stickerEmoji: d.sticker_emoji,
    posX: d.pos_x,
    posY: d.pos_y,
    createdAt: d.created_at,
  };
}

// YouTube URL에서 영상 ID 추출 (watch, shorts, live, embed, youtu.be, m.youtube.com 형태 지원)
function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const raw = String(url).trim();
    const normalized = raw.startsWith('http') ? raw : `https://${raw}`;
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null;
    }
    if (host.endsWith('youtube.com')) {
      const fromQuery = u.searchParams.get('v');
      if (/^[a-zA-Z0-9_-]{11}$/.test(fromQuery || '')) return fromQuery;
      const parts = u.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex((part) => ['shorts', 'embed', 'live'].includes(part));
      const id = marker >= 0 ? parts[marker + 1] : null;
      return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null;
    }
  } catch (e) {
    const m = String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  return null;
}

// 이미지 후원용 URL 형식 검증 (http/https + 합리적인 URL 형태)
function isValidImageUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function normalizeDonationType(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    text: '일반',
    normal: '일반',
    tts: '음성',
    voice: '음성',
    video: '영상',
    image: '이미지',
    quiz: '퀴즈',
    mini: '미니',
    roulette: '룰렛',
    sticker: '스티커',
    emoji: '스티커',
  };
  if (aliases[raw]) return aliases[raw];
  return ['일반', '음성', '영상', '이미지', '퀴즈', '미니', '룰렛', '스티커'].includes(value) ? value : '일반';
}

module.exports = function registerDonationRoutes(router) {
  router.post('/api/donations/test', async (req, res) => {
    const auth = getCreatorFromRequest(req);
    if (!auth) return sendError(res, 401, '크리에이터 로그인이 필요해요.');

    const body = await readJsonBody(req);
    const donationType = normalizeDonationType(body.donationType);
    const amount = Math.min(Math.max(parseInt(body.amount, 10) || 5000, 100), MAX_AMOUNT);
    const message = String(body.message || '유네이션 테스트 알림입니다.').trim().slice(0, 150);
    const nickname = String(body.nickname || '테스트시민').trim().slice(0, 20) || '테스트시민';
    const id = `test-${Date.now()}`;
    let videoUrl = null;
    let imageUrl = null;
    let rouletteResult = null;
    let stickerEmoji = null;
    let posX = null;
    let posY = null;

    if (donationType === '영상') {
      const youtubeId = extractYouTubeId(body.videoUrl) || 'dQw4w9WgXcQ';
      videoUrl = `https://www.youtube.com/embed/${youtubeId}`;
    }
    if (donationType === '이미지') {
      imageUrl = isValidImageUrl(body.imageUrl) ? String(body.imageUrl).trim() : 'https://picsum.photos/seed/unation-test/640/360';
    }
    if (donationType === '룰렛') {
      rouletteResult = '테스트 성공';
    }
    if (donationType === '스티커') {
      stickerEmoji = STICKER_EMOJIS.has(body.stickerEmoji) ? body.stickerEmoji : '🎉';
      posX = Number.isFinite(Number(body.posX)) ? Number(body.posX) : 50;
      posY = Number.isFinite(Number(body.posY)) ? Number(body.posY) : 50;
    }

    const payload = {
      id,
      citizenNumber: 0,
      nickname,
      amount,
      message,
      donationType,
      videoUrl,
      imageUrl,
      rouletteResult,
      stickerEmoji,
      posX,
      posY,
      createdAt: new Date().toISOString(),
      test: true,
    };
    sse.publish(auth.handle, 'donation', payload);
    sendJson(res, 200, { ok: true, donation: payload });
  });

  // 후원 생성 (모의 결제를 통과해야 실제로 기록됨)
  router.post('/api/donations', async (req, res) => {
    if (!rateLimit(req, res, 'donation-create', 20, 10 * 60 * 1000)) return; // 10분에 20회

    const body = await readJsonBody(req);
    const handle = String(body.handle || '').trim().toLowerCase();
    const nickname = String(body.nickname || '').trim().slice(0, 20) || '익명의 시민';
    const amount = parseInt(body.amount, 10);
    const message = String(body.message || '').trim().slice(0, 150);
    const donationType = normalizeDonationType(body.donationType);
    const paymentMethod = PAYMENT_METHODS.has(body.paymentMethod) ? body.paymentMethod : null;

    let videoUrl = null;
    let imageUrl = null;
    if (donationType === '영상') {
      const youtubeId = extractYouTubeId(body.videoUrl);
      if (!youtubeId) return sendError(res, 400, '유효한 유튜브 영상 주소를 입력해주세요.');
      videoUrl = `https://www.youtube.com/embed/${youtubeId}`;
    }
    if (donationType === '이미지') {
      if (!isValidImageUrl(body.imageUrl)) return sendError(res, 400, '유효한 이미지 주소를 입력해주세요.');
      imageUrl = String(body.imageUrl).trim();
    }
    if (donationType === '퀴즈' && !message) {
      return sendError(res, 400, '퀴즈 후원은 메시지에 문제를 입력해주세요.');
    }

    let stickerEmoji = null;
    let posX = null;
    let posY = null;
    if (donationType === '스티커') {
      if (!STICKER_EMOJIS.has(body.stickerEmoji)) {
        return sendError(res, 400, '스티커를 선택해주세요.');
      }
      stickerEmoji = body.stickerEmoji;
      posX = Number(body.posX);
      posY = Number(body.posY);
      if (!Number.isFinite(posX) || !Number.isFinite(posY) || posX < 0 || posX > 100 || posY < 0 || posY > 100) {
        return sendError(res, 400, '스티커 위치를 화면 안에서 선택해주세요.');
      }
    }

    const creator = db.prepare('SELECT * FROM creators WHERE handle = ?').get(handle);
    if (!creator) return sendError(res, 404, '크리에이터를 찾을 수 없어요.');
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return sendError(res, 400, '후원 금액을 다시 확인해주세요.');
    }
    const minRequired = donationType === '미니' ? MIN_AMOUNT_MINI : MIN_AMOUNT;
    if (amount < minRequired) {
      return sendError(res, 400, `최소 후원 금액은 ${minRequired.toLocaleString()}원이에요.`);
    }
    if (!paymentMethod) return sendError(res, 400, '결제 수단을 선택해주세요.');

    // 룰렛 결과는 결제가 성공한 뒤, 서버에서만 결정합니다 (클라이언트가 결과를 보낼 수 없음).
    // 중요: 룰렛 결과는 연출용 등급일 뿐이며 실제 정산 금액에는 영향을 주지 않습니다 —
    // 후원자가 낸 금액 그대로 크리에이터에게 정산됩니다 (사행성 요소 배제).
    let rouletteResult = null;

    try {
      assertPaymentProviderSafeForRequest(req);
    } catch (e) {
      return sendError(res, e.status || 503, e.message);
    }

    const provider = getPaymentProvider();
    let result;
    try {
      result = await provider.charge({ amount, method: paymentMethod, meta: { handle } });
    } catch (e) {
      return sendError(res, 502, e.message || '결제 처리 중 오류가 발생했어요.');
    }
    if (!result.success) {
      return sendError(res, 402, result.message || '결제에 실패했어요.');
    }

    if (donationType === '룰렛') {
      const segments = parseRouletteSegments(creator.roulette_segments);
      rouletteResult = weightedPick(segments);
    }

    const citizenNumber = db.prepare(
      "SELECT COUNT(*) AS c FROM donations WHERE creator_id = ? AND status = 'completed'"
    ).get(creator.id).c + 1;

    const insert = db.prepare(`
      INSERT INTO donations (creator_id, citizen_number, nickname, amount, message, donation_type, video_url, image_url, roulette_result, sticker_emoji, pos_x, pos_y, payment_method, status, tx_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(creator.id, citizenNumber, nickname, amount, message, donationType, videoUrl, imageUrl, rouletteResult, stickerEmoji, posX, posY, paymentMethod, result.txId);

    const donation = db.prepare('SELECT * FROM donations WHERE id = ?').get(insert.lastInsertRowid);
    const payload = mapDonationRow(donation);

    sse.publish(handle, 'donation', payload);
    sse.publish('global', 'donation', { ...payload, creatorHandle: handle, creatorDisplayName: creator.display_name });

    sendJson(res, 201, { donation: payload, txId: result.txId, mock: !!result.message });
  });

  // 공개 후원 피드/랭킹 (핸들 기준)
  router.get('/api/creators/:handle/donations', async (req, res, params) => {
    const creator = db.prepare('SELECT id, show_donations_publicly FROM creators WHERE handle = ?').get(params.handle);
    if (!creator) return sendError(res, 404, '크리에이터를 찾을 수 없어요.');

    if (creator.show_donations_publicly === 0) {
      return sendJson(res, 200, { donations: [], hidden: true });
    }

    const url = new URL(req.url, 'http://x');
    const sort = url.searchParams.get('sort') === 'top' ? 'top' : 'recent';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '5', 10) || 5, 20);

    let rows;
    if (sort === 'top') {
      rows = db.prepare(`
        SELECT * FROM donations
        WHERE creator_id = ? AND status='completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')
        ORDER BY amount DESC, created_at ASC
        LIMIT ?
      `).all(creator.id, limit);
    } else {
      rows = db.prepare(`
        SELECT * FROM donations WHERE creator_id = ? AND status='completed'
        ORDER BY created_at DESC LIMIT ?
      `).all(creator.id, limit);
    }
    sendJson(res, 200, { donations: rows.map(mapDonationRow) });
  });

  // 내 후원내역 (대시보드 테이블)
  router.get('/api/donations/me', async (req, res) => {
    const auth = getCreatorFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 100);
    const rows = db.prepare(`
      SELECT * FROM donations WHERE creator_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(auth.uid, limit);
    sendJson(res, 200, { donations: rows.map(mapDonationRow) });
  });

  // 대시보드 통계 (이번 달/저번 달 비교, 최근 7일 차트, 정산 가능 금액)
  router.get('/api/me/stats', async (req, res) => {
    const auth = getCreatorFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const id = auth.uid;

    const thisMonth = db.prepare(`
      SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM donations
      WHERE creator_id = ? AND status='completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')
    `).get(id);
    const lastMonth = db.prepare(`
      SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM donations
      WHERE creator_id = ? AND status='completed'
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', date('now','start of month','-1 day'))
    `).get(id);

    const totalCitizens = db.prepare(
      "SELECT COUNT(*) AS c FROM donations WHERE creator_id = ? AND status='completed'"
    ).get(id).c;
    const citizensLast7d = db.prepare(`
      SELECT COUNT(*) AS c FROM donations
      WHERE creator_id = ? AND status='completed' AND created_at >= datetime('now','-7 days')
    `).get(id).c;

    const pct = (curr, prev) => (prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0));

    const avgThis = thisMonth.cnt > 0 ? Math.round(thisMonth.total / thisMonth.cnt) : 0;
    const avgLast = lastMonth.cnt > 0 ? Math.round(lastMonth.total / lastMonth.cnt) : 0;

    // 최근 7일 일별 합계 (0으로 채움)
    const dayRows = db.prepare(`
      SELECT date(created_at) AS d, COALESCE(SUM(amount),0) AS total FROM donations
      WHERE creator_id = ? AND status='completed' AND created_at >= datetime('now','-6 days','start of day')
      GROUP BY d
    `).all(id);
    const byDate = Object.fromEntries(dayRows.map((r) => [r.d, r.total]));
    const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      last7.push({ date: key, label: dayLabels[d.getDay()], total: byDate[key] || 0 });
    }

    const balance = computeBalance(id);

    sendJson(res, 200, {
      thisMonthTotal: thisMonth.total,
      thisMonthDeltaPct: pct(thisMonth.total, lastMonth.total),
      totalCitizens,
      citizensLast7d,
      avgDonation: avgThis,
      avgDeltaPct: pct(avgThis, avgLast),
      last7,
      availableSettlement: balance.available,
      minSettlementAmount: MIN_SETTLEMENT_AMOUNT,
    });
  });
};
