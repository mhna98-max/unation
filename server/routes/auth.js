// ============================================================
// server/routes/auth.js — 회원가입 / 로그인 / 로그아웃 / 내 정보
// + 소셜 로그인(모의) / 휴대폰 번호 로그인(모의 인증번호)
//   실제 구글/카카오/네이버/애플/마이크로소프트 연동과 실제 SMS 발송은
//   사업자 등록 및 각 플랫폼 개발자 앱 등록 이후 진행해야 합니다.
//   social-login-guide.md 파일을 참고해주세요.
// ============================================================
const db = require('../db');
const crypto = require('crypto');
const { hashPassword, verifyPassword, signToken, setSessionCookie, clearSessionCookie, getAuthFromRequest, parseCookies } = require('../auth');
const { readJsonBody, sendJson, sendError, privateCreator } = require('../helpers');
const { rateLimit } = require('../rateLimit');

const HANDLE_RE = /^[a-z0-9][a-z0-9_]{2,19}$/;
const RESERVED_HANDLES = new Set(['me', 'api', 'admin', 'global', 'www', 'unation', 'null', 'undefined']);
const SOCIAL_PROVIDERS = new Set(['google', 'kakao', 'naver']);
const SOCIAL_LABELS = { google: 'Google', kakao: 'Kakao', naver: 'Naver' };
const OAUTH_STATE_COOKIE = 'unation_oauth_state';

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

function getBaseUrl(req) {
  return (process.env.BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/+$/, '');
}

function getOAuthConfig(provider, req) {
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/oauth/${provider}/callback`;
  const configs = {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri,
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
    },
    kakao: {
      clientId: process.env.KAKAO_CLIENT_ID || process.env.KAKAO_REST_API_KEY,
      clientSecret: process.env.KAKAO_CLIENT_SECRET,
      redirectUri,
      authUrl: 'https://kauth.kakao.com/oauth/authorize',
      tokenUrl: 'https://kauth.kakao.com/oauth/token',
      scope: 'profile_nickname,account_email',
    },
    naver: {
      clientId: process.env.NAVER_CLIENT_ID,
      clientSecret: process.env.NAVER_CLIENT_SECRET,
      redirectUri,
      authUrl: 'https://nid.naver.com/oauth2.0/authorize',
      tokenUrl: 'https://nid.naver.com/oauth2.0/token',
      scope: '',
    },
  };
  return configs[provider];
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function redirectWithError(res, req, message, role = 'creator') {
  const target = role === 'unator' ? 'signup.html?type=unator' : 'login.html';
  const joiner = target.includes('?') ? '&' : '?';
  redirect(res, `${getBaseUrl(req)}/${target}${joiner}oauth_error=${encodeURIComponent(message)}`);
}

function setOAuthStateCookie(res, state) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function normalizeHandleBase(value, fallback) {
  const base = String(value || '')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const cleaned = base && /^[a-z0-9]/.test(base) ? base : fallback;
  return cleaned.slice(0, 16) || fallback;
}

function makeUniqueHandle(seed, provider) {
  const base = normalizeHandleBase(seed, `${provider}_${crypto.randomBytes(3).toString('hex')}`);
  for (let i = 0; i < 50; i += 1) {
    const suffix = i === 0 ? '' : String(i + 1);
    const handle = `${base}${suffix}`.slice(0, 20);
    if (HANDLE_RE.test(handle) && !RESERVED_HANDLES.has(handle) && !db.prepare('SELECT id FROM creators WHERE handle = ?').get(handle)) {
      return handle;
    }
  }
  return `${provider}_${crypto.randomBytes(5).toString('hex')}`.slice(0, 20);
}

async function postForm(url, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || 'OAuth token request failed');
  }
  return data;
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || 'OAuth profile request failed');
  return data;
}

async function exchangeOAuthProfile(provider, code, config) {
  if (!config.clientId) throw new Error(`${provider} client id is not configured`);
  if ((provider === 'google' || provider === 'naver') && !config.clientSecret) {
    throw new Error(`${provider} client secret is not configured`);
  }

  const tokenParams = {
    grant_type: 'authorization_code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code,
  };
  if (config.clientSecret) tokenParams.client_secret = config.clientSecret;
  const token = await postForm(config.tokenUrl, tokenParams);
  if (!token.access_token) throw new Error('OAuth access token was not returned');

  if (provider === 'google') {
    const profile = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
      Authorization: `Bearer ${token.access_token}`,
    });
    return {
      provider,
      socialId: profile.sub,
      email: profile.email || null,
      displayName: profile.name || profile.email || 'Google User',
    };
  }

  if (provider === 'kakao') {
    const profile = await fetchJson('https://kapi.kakao.com/v2/user/me', {
      Authorization: `Bearer ${token.access_token}`,
    });
    const account = profile.kakao_account || {};
    const kakaoProfile = account.profile || {};
    return {
      provider,
      socialId: String(profile.id || ''),
      email: account.email || null,
      displayName: kakaoProfile.nickname || account.email || 'Kakao User',
    };
  }

  if (provider === 'naver') {
    const profile = await fetchJson('https://openapi.naver.com/v1/nid/me', {
      Authorization: `Bearer ${token.access_token}`,
    });
    const naverProfile = profile.response || {};
    return {
      provider,
      socialId: naverProfile.id,
      email: naverProfile.email || null,
      displayName: naverProfile.nickname || naverProfile.name || naverProfile.email || 'Naver User',
    };
  }

  throw new Error('Unsupported OAuth provider');
}

function getPostLoginPath(account) {
  if (account?.role === 'admin') return '/admin.html';
  if (account?.role === 'unator') return '/unator.html';
  return '/dashboard.html';
}

function assertRequestedRole(account, requestedRole) {
  if (!account || !requestedRole || !account.role || account.role === requestedRole) return;
  const labels = { admin: '관리자', creator: '크리에이터', unator: '유네이터' };
  const currentLabel = labels[account.role] || '기존';
  const requestedLabel = labels[requestedRole] || '요청한';
  throw new Error(`이미 ${currentLabel} 계정으로 가입된 이메일입니다. ${requestedLabel} 가입이 아니라 ${currentLabel} 로그인으로 이용해주세요.`);
}

function findOrCreateSocialCreator(profile, requestedRole = 'creator') {
  if (!profile.socialId) throw new Error('Social profile id was not returned');
  const role = requestedRole === 'unator' ? 'unator' : 'creator';

  const existingSocial = db.prepare('SELECT * FROM creators WHERE social_provider = ? AND social_id = ?').get(profile.provider, profile.socialId);
  if (existingSocial) {
    assertRequestedRole(existingSocial, role);
    return existingSocial;
  }

  const email = profile.email ? String(profile.email).toLowerCase() : null;
  if (email) {
    const existingEmail = db.prepare('SELECT * FROM creators WHERE email = ?').get(email);
    if (existingEmail) {
      assertRequestedRole(existingEmail, role);
      if (!existingEmail.social_provider && !existingEmail.social_id) {
        db.prepare('UPDATE creators SET social_provider = ?, social_id = ? WHERE id = ?').run(profile.provider, profile.socialId, existingEmail.id);
        return db.prepare('SELECT * FROM creators WHERE id = ?').get(existingEmail.id);
      }
      return existingEmail;
    }
  }

  const handle = makeUniqueHandle(email || profile.displayName, profile.provider);
  const displayName = String(profile.displayName || `${SOCIAL_LABELS[profile.provider]} User`).trim().slice(0, 40);
  const result = db.prepare(`
    INSERT INTO creators (handle, display_name, email, social_provider, social_id, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(handle, displayName || handle, email, profile.provider, profile.socialId, role);
  return db.prepare('SELECT * FROM creators WHERE id = ?').get(result.lastInsertRowid);
}

module.exports = function registerAuthRoutes(router) {
  router.get('/api/auth/oauth/:provider/start', async (req, res, params) => {
    const provider = String(params.provider || '');
    const url = new URL(req.url, getBaseUrl(req));
    const role = url.searchParams.get('role') === 'unator' ? 'unator' : 'creator';
    if (!SOCIAL_PROVIDERS.has(provider)) return redirectWithError(res, req, '지원하지 않는 SNS 로그인입니다.', role);
    const config = getOAuthConfig(provider, req);
    if (!config || !config.clientId) return redirectWithError(res, req, `${SOCIAL_LABELS[provider]} 로그인 설정이 아직 완료되지 않았습니다.`, role);

    const state = `${provider}:${role}:${crypto.randomBytes(18).toString('hex')}`;
    setOAuthStateCookie(res, state);
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
    });
    if (config.scope) query.set('scope', config.scope);
    if (provider === 'google') {
      query.set('access_type', 'offline');
      query.set('prompt', 'select_account');
    }
    redirect(res, `${config.authUrl}?${query.toString()}`);
  });

  router.get('/api/auth/oauth/:provider/callback', async (req, res, params) => {
    const provider = String(params.provider || '');
    if (!SOCIAL_PROVIDERS.has(provider)) return redirectWithError(res, req, '지원하지 않는 SNS 로그인입니다.');

    try {
      const url = new URL(req.url, getBaseUrl(req));
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      if (error) throw new Error(url.searchParams.get('error_description') || error);
      if (!code) throw new Error('OAuth authorization code was not returned');

      const cookies = parseCookies(req);
      if (!state || cookies[OAUTH_STATE_COOKIE] !== state || !state.startsWith(`${provider}:`)) {
        throw new Error('OAuth state verification failed');
      }
      const role = state.split(':')[1] === 'unator' ? 'unator' : 'creator';

      const config = getOAuthConfig(provider, req);
      const profile = await exchangeOAuthProfile(provider, code, config);
      const creator = findOrCreateSocialCreator(profile, role);
      logCreatorIn(res, creator);
      redirect(res, `${getBaseUrl(req)}${getPostLoginPath(creator)}`);
    } catch (e) {
      redirectWithError(res, req, e.message || 'SNS 로그인에 실패했습니다.');
    }
  });

  router.post('/api/auth/signup', async (req, res) => {
    if (!rateLimit(req, res, 'signup', 10, 10 * 60 * 1000)) return; // 10분에 10회

    const body = await readJsonBody(req);
    const handle = String(body.handle || '').trim().toLowerCase();
    const displayName = String(body.displayName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = body.role === 'unator' ? 'unator' : 'creator';
    const finalHandle = role === 'unator' ? makeUniqueHandle(email || displayName, 'unator') : handle;

    if (!HANDLE_RE.test(finalHandle) || RESERVED_HANDLES.has(finalHandle)) {
      return sendError(res, 400, '핸들은 영문 소문자/숫자/언더스코어 3~20자로 입력해주세요 (일부 단어는 예약되어 있어요).');
    }
    if (!displayName) return sendError(res, 400, '표시 이름(방송명)을 입력해주세요.');
    if (!email.includes('@')) return sendError(res, 400, '올바른 이메일을 입력해주세요.');
    if (password.length < 8) return sendError(res, 400, '비밀번호는 8자 이상이어야 해요.');

    const existing = db.prepare('SELECT id FROM creators WHERE handle = ? OR email = ?').get(finalHandle, email);
    if (existing) return sendError(res, 409, '이미 사용 중인 핸들 또는 이메일이에요.');

    const passwordHash = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO creators (handle, display_name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(finalHandle, displayName, email, passwordHash, role);

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
    const role = body.role === 'unator' ? 'unator' : 'creator';
    if (!SOCIAL_PROVIDERS.has(provider)) return sendError(res, 400, '지원하지 않는 소셜 로그인이에요.');

    // 데모 환경: 같은 서버에서는 항상 같은 모의 계정으로 연결됩니다 (실제 OAuth 미연동).
    const socialId = `mock_${provider}_demo`;
    const existing = db.prepare('SELECT * FROM creators WHERE social_provider = ? AND social_id = ?').get(provider, socialId);
    if (existing) {
      assertRequestedRole(existing, role);
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
      INSERT INTO creators (handle, display_name, social_provider, social_id, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(handle, displayName, provider, socialId, role);

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
      const requestedRole = body.role === 'unator' ? 'unator' : 'creator';
      assertRequestedRole(existing, requestedRole);
      otpStore.delete(phone);
      logCreatorIn(res, existing);
      return sendJson(res, 200, { creator: privateCreator(existing), isNew: false });
    }

    const handle = String(body.handle || '').trim().toLowerCase();
    const displayName = String(body.displayName || '').trim();
    const role = body.role === 'unator' ? 'unator' : 'creator';
    const finalHandle = role === 'unator' ? makeUniqueHandle(phone || displayName, 'unator') : handle;
    if (!handle && !displayName) {
      return sendJson(res, 200, { needsHandle: true, suggestedDisplayName: '새 크리에이터' });
    }
    if (!HANDLE_RE.test(finalHandle) || RESERVED_HANDLES.has(finalHandle)) {
      return sendError(res, 400, '핸들은 영문 소문자/숫자/언더스코어 3~20자로 입력해주세요 (일부 단어는 예약되어 있어요).');
    }
    if (!displayName) return sendError(res, 400, '표시 이름(방송명)을 입력해주세요.');
    const dupHandle = db.prepare('SELECT id FROM creators WHERE handle = ?').get(finalHandle);
    if (dupHandle) return sendError(res, 409, '이미 사용 중인 핸들이에요.');

    const result = db.prepare(`
      INSERT INTO creators (handle, display_name, phone, role)
      VALUES (?, ?, ?, ?)
    `).run(finalHandle, displayName, phone, role);

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
