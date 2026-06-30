// ============================================================
// server/routes/auth.js — 회원가입 / 로그인 / 로그아웃 / 내 정보
// + 소셜 로그인(모의) / 휴대폰 번호 로그인(모의 인증번호)
//   실제 구글/카카오/네이버/애플/마이크로소프트 연동과 실제 SMS 발송은
//   사업자 등록 및 각 플랫폼 개발자 앱 등록 이후 진행해야 합니다.
//   social-login-guide.md 파일을 참고해주세요.
// ============================================================
const db = require('../db');
const { hashPassword, verifyPassword, signToken, setSessionCookie, clearSessionCookie, getAuthFromRequest } = require('../auth');
const { readJsonBody, sendJson, sendError, privateCreator } = require('../helpers');
const { rateLimit } = require('../rateLimit');

const HANDLE_RE = /^[a-z0-9][a-z0-9_]{2,19}$/;
const RESERVED_HANDLES = new Set(['me', 'api', 'admin', 'global', 'www', 'unation', 'null', 'undefined']);
const SOCIAL_PROVIDERS = new Set(['google', 'kakao', 'naver', 'apple', 'microsoft']);
const SOCIAL_LABELS = { google: 'Google', kakao: '카카오', naver: '네이버', apple: 'Apple', microsoft: 'Microsoft' };

// 휴대폰 인증번호 — 메모리 저장 (데모용, 실서비스는 SMS 발송 + Redis 등 사용 권장)
const otpStore = new Map(); // phone -> { code, expiresAt }
const PHONE_RE = /^01[0-9]-?\d{3,4}-?\d{4}$/;

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function logCreatorIn(res, creator) {
  const token = signToken({ uid: creator.id, handle: creator.handle });
  setSessionCookie(res, token);
}

module.exports = function registerAuthRoutes(router) {
  router.post('/api/auth/signup', async (req, res) => {
    if (!rateLimit(req, res, 'signup', 10, 10 * 60 * 1000)) return; // 10분에 10회

    const body = await readJsonBody(req);
    const handle = String(body.handle || '').trim().toLowerCase();
    const displayName = String(body.displayName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!HANDLE_RE.test(handle) || RESERVED_HANDLES.has(handle)) {
      return sendError(res, 400, '핸들은 영문 소문자/숫자/언더스코어 3~20자로 입력해주세요 (일부 단어는 예약되어 있어요).');
    }
    if (!displayName) return sendError(res, 400, '표시 이름(방송명)을 입력해주세요.');
    if (!email.includes('@')) return sendError(res, 400, '올바른 이메일을 입력해주세요.');
    if (password.length < 8) return sendError(res, 400, '비밀번호는 8자 이상이어야 해요.');

    const existing = db.prepare('SELECT id FROM creators WHERE handle = ? OR email = ?').get(handle, email);
    if (existing) return sendError(res, 409, '이미 사용 중인 핸들 또는 이메일이에요.');

    const passwordHash = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO creators (handle, display_name, email, password_hash)
      VALUES (?, ?, ?, ?)
    `).run(handle, displayName, email, passwordHash);

    const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(result.lastInsertRowid);
    logCreatorIn(res, creator);
    sendJson(res, 201, { creator: privateCreator(creator) });
  });

  router.post('/api/auth/login', async (req, res) => {
    if (!rateLimit(req, res, 'login', 10, 10 * 60 * 1000)) return; // 10분에 10회

    const body = await readJsonBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    const creator = db.prepare('SELECT * FROM creators WHERE email = ?').get(email);
    if (!creator || !creator.password_hash || !verifyPassword(password, creator.password_hash)) {
      return sendError(res, 401, '이메일 또는 비밀번호가 올바르지 않아요.');
    }
    logCreatorIn(res, creator);
    sendJson(res, 200, { creator: privateCreator(creator) });
  });

  // ── 소셜 로그인 (모의) ──
  // provider만 보내면: 이미 가입된 데모 계정이 있는지 확인 후 있으면 바로 로그인,
  // 없으면 needsHandle:true 를 내려줘서 프론트에서 핸들 선택 화면을 보여줌.
  // handle/displayName까지 보내면: 그 정보로 신규 계정을 생성하고 로그인.
  router.post('/api/auth/social', async (req, res) => {
    const body = await readJsonBody(req);
    const provider = String(body.provider || '');
    if (!SOCIAL_PROVIDERS.has(provider)) return sendError(res, 400, '지원하지 않는 소셜 로그인이에요.');

    // 데모 환경: 같은 서버에서는 항상 같은 모의 계정으로 연결됩니다 (실제 OAuth 미연동).
    const socialId = `mock_${provider}_demo`;
    const existing = db.prepare('SELECT * FROM creators WHERE social_provider = ? AND social_id = ?').get(provider, socialId);
    if (existing) {
      logCreatorIn(res, existing);
      return sendJson(res, 200, { creator: privateCreator(existing), isNew: false });
    }

    const handle = String(body.handle || '').trim().toLowerCase();
    const displayName = String(body.displayName || '').trim();

    if (!handle && !displayName) {
      return sendJson(res, 200, {
        needsHandle: true,
        providerLabel: SOCIAL_LABELS[provider],
        suggestedDisplayName: `${SOCIAL_LABELS[provider]} 사용자`,
      });
    }

    if (!HANDLE_RE.test(handle) || RESERVED_HANDLES.has(handle)) {
      return sendError(res, 400, '핸들은 영문 소문자/숫자/언더스코어 3~20자로 입력해주세요 (일부 단어는 예약되어 있어요).');
    }
    if (!displayName) return sendError(res, 400, '표시 이름(방송명)을 입력해주세요.');
    const dupHandle = db.prepare('SELECT id FROM creators WHERE handle = ?').get(handle);
    if (dupHandle) return sendError(res, 409, '이미 사용 중인 핸들이에요.');

    const result = db.prepare(`
      INSERT INTO creators (handle, display_name, social_provider, social_id)
      VALUES (?, ?, ?, ?)
    `).run(handle, displayName, provider, socialId);

    const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(result.lastInsertRowid);
    logCreatorIn(res, creator);
    sendJson(res, 201, { creator: privateCreator(creator), isNew: true });
  });

  // ── 휴대폰 번호 로그인 (모의 인증번호) ──
  router.post('/api/auth/phone/request-otp', async (req, res) => {
    if (!rateLimit(req, res, 'otp-request', 5, 10 * 60 * 1000)) return; // 10분에 5회 — 문자폭탄 방지

    const body = await readJsonBody(req);
    const phone = normalizePhone(body.phone);
    if (!PHONE_RE.test(body.phone || '')) return sendError(res, 400, '올바른 휴대폰 번호를 입력해주세요. (예: 010-1234-5678)');

    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(phone, { code, expiresAt: Date.now() + 3 * 60 * 1000 });

    // 데모 환경: 실제 SMS를 발송하지 않고 인증번호를 응답에 직접 포함합니다.
    sendJson(res, 200, { sent: true, devCode: code, demoNotice: '데모 모드 — 실제 SMS는 발송되지 않으며, 위 번호를 입력하면 인증됩니다.' });
  });

  router.post('/api/auth/phone/verify', async (req, res) => {
    if (!rateLimit(req, res, 'otp-verify', 15, 10 * 60 * 1000)) return; // 6자리 코드 무차별 대입 방지

    const body = await readJsonBody(req);
    const phone = normalizePhone(body.phone);
    const code = String(body.code || '').trim();

    const entry = otpStore.get(phone);
    if (!entry || entry.expiresAt < Date.now()) return sendError(res, 400, '인증번호가 만료됐어요. 다시 요청해주세요.');
    if (entry.code !== code) return sendError(res, 400, '인증번호가 올바르지 않아요.');

    const existing = db.prepare('SELECT * FROM creators WHERE phone = ?').get(phone);
    if (existing) {
      otpStore.delete(phone);
      logCreatorIn(res, existing);
      return sendJson(res, 200, { creator: privateCreator(existing), isNew: false });
    }

    const handle = String(body.handle || '').trim().toLowerCase();
    const displayName = String(body.displayName || '').trim();
    if (!handle && !displayName) {
      return sendJson(res, 200, { needsHandle: true, suggestedDisplayName: '새 크리에이터' });
    }
    if (!HANDLE_RE.test(handle) || RESERVED_HANDLES.has(handle)) {
      return sendError(res, 400, '핸들은 영문 소문자/숫자/언더스코어 3~20자로 입력해주세요 (일부 단어는 예약되어 있어요).');
    }
    if (!displayName) return sendError(res, 400, '표시 이름(방송명)을 입력해주세요.');
    const dupHandle = db.prepare('SELECT id FROM creators WHERE handle = ?').get(handle);
    if (dupHandle) return sendError(res, 409, '이미 사용 중인 핸들이에요.');

    const result = db.prepare(`
      INSERT INTO creators (handle, display_name, phone)
      VALUES (?, ?, ?)
    `).run(handle, displayName, phone);

    otpStore.delete(phone);
    const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(result.lastInsertRowid);
    logCreatorIn(res, creator);
    sendJson(res, 201, { creator: privateCreator(creator), isNew: true });
  });

  router.post('/api/auth/logout', async (req, res) => {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/auth/me', async (req, res) => {
    const auth = getAuthFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(auth.uid);
    if (!creator) return sendError(res, 401, '로그인이 필요해요.');
    sendJson(res, 200, { creator: privateCreator(creator) });
  });
};
