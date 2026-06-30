// ============================================================
// server/helpers.js — 요청/응답 공용 유틸
// ============================================================

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) { // 2MB 제한
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return resolve({});
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

// 크리에이터가 룰렛 후원을 따로 설정하지 않았을 때 쓰는 기본 룰렛 구성
const DEFAULT_ROULETTE_SEGMENTS = [
  { label: '꽝', weight: 35 },
  { label: '하트 200%', weight: 25 },
  { label: '리액션 약속', weight: 20 },
  { label: '대박! 한 마디 더', weight: 12 },
  { label: '잭팟 — 노래 한 곡', weight: 8 },
];

// roulette_segments 컬럼(JSON 문자열)을 안전하게 파싱. 형식이 깨졌거나 없으면 기본값 사용
function parseRouletteSegments(raw) {
  if (!raw) return DEFAULT_ROULETTE_SEGMENTS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_ROULETTE_SEGMENTS;
    const cleaned = parsed
      .filter((s) => s && typeof s.label === 'string' && Number.isFinite(s.weight) && s.weight > 0)
      .map((s) => ({ label: s.label.slice(0, 20), weight: Math.min(s.weight, 1000) }))
      .slice(0, 8);
    return cleaned.length ? cleaned : DEFAULT_ROULETTE_SEGMENTS;
  } catch (e) {
    return DEFAULT_ROULETTE_SEGMENTS;
  }
}

// creator row에서 비밀번호 해시 등 민감 정보를 제외한 공개용 객체 생성
function publicCreator(c) {
  if (!c) return null;
  return {
    id: c.id,
    handle: c.handle,
    displayName: c.display_name,
    bio: c.bio,
    goalLabel: c.goal_label,
    goalAmount: c.goal_amount,
    platform: c.platform,
    platformChannel: c.platform_channel,
    chatEmbedUrl: c.chat_embed_url,
    role: c.role || 'creator',
    showDonationsPublicly: c.show_donations_publicly === undefined ? true : !!c.show_donations_publicly,
    rouletteSegments: parseRouletteSegments(c.roulette_segments),
    createdAt: c.created_at,
  };
}

// 본인 대시보드용 — 정산 계좌 등 비공개 정보 포함 (비밀번호 해시는 제외)
function privateCreator(c) {
  if (!c) return null;
  return {
    ...publicCreator(c),
    email: c.email,
    bankName: c.bank_name,
    bankAccount: c.bank_account,
    bankHolder: c.bank_holder,
  };
}

module.exports = { readJsonBody, sendJson, sendError, publicCreator, privateCreator, DEFAULT_ROULETTE_SEGMENTS, parseRouletteSegments };
