// ============================================================
// server/auth.js — 인증 유틸리티 (전부 Node 내장 crypto만 사용)
// ============================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const SESSION_SECRET = resolveSessionSecret();
const TOKEN_MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14일

// SESSION_SECRET이 환경변수로 설정되어 있지 않으면, 매 서버 재시작마다
// 모든 로그인이 풀리는 걸 막기 위해 무작위 키를 생성해 data/.session-secret
// 파일에 저장하고 재사용합니다. 운영 서버에서는 .env에 직접 SESSION_SECRET을
// 지정하는 걸 강력히 권장합니다 (자세한 내용은 deployment-guide.md 참고).
function resolveSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }

  const dataDir = path.join(__dirname, '..', 'data');
  const secretPath = path.join(dataDir, '.session-secret');
  try {
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, 'utf8').trim();
    }
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
    console.warn(
      '\n  [경고] SESSION_SECRET 환경변수가 설정되지 않아 임의의 키를 생성해 data/.session-secret 에 저장했습니다.\n' +
      '  운영 서버에서는 .env 파일에 SESSION_SECRET을 직접 지정하는 걸 권장합니다. (deployment-guide.md 참고)\n'
    );
    return generated;
  } catch (e) {
    console.warn('\n  [경고] SESSION_SECRET을 저장할 수 없어 이번 실행에서만 쓰이는 임시 키를 사용합니다.\n');
    return crypto.randomBytes(48).toString('hex');
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signToken(payloadObj, maxAgeSec = TOKEN_MAX_AGE_SEC) {
  const payload = { ...payloadObj, exp: Date.now() + maxAgeSec * 1000 };
  const json = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(crypto.createHmac('sha256', SESSION_SECRET).update(json).digest());
  return `${json}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [json, sig] = token.split('.');
  const expected = base64url(crypto.createHmac('sha256', SESSION_SECRET).update(json).digest());
  if (sig !== expected) return null;
  try {
    const padded = json.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `unation_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${TOKEN_MAX_AGE_SEC}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'unation_session=; Path=/; HttpOnly; Max-Age=0');
}

// 요청에서 로그인한 creator 정보(id, handle)를 반환, 없으면 null
function getAuthFromRequest(req) {
  const cookies = parseCookies(req);
  return verifyToken(cookies.unation_session);
}

// 관리자 권한 확인 — 세션의 role만 믿지 않고 DB에서 현재 role을 다시 확인합니다
// (관리자 권한이 회수된 뒤에도 예전 토큰으로 접근하는 것을 막기 위함)
function getAdminFromRequest(req) {
  const auth = getAuthFromRequest(req);
  if (!auth) return null;
  const creator = db.prepare('SELECT id, handle, role FROM creators WHERE id = ?').get(auth.uid);
  if (!creator || creator.role !== 'admin') return null;
  return { uid: creator.id, handle: creator.handle, role: creator.role };
}

function getCreatorFromRequest(req) {
  const auth = getAuthFromRequest(req);
  if (!auth) return null;
  const creator = db.prepare('SELECT id, handle, role FROM creators WHERE id = ?').get(auth.uid);
  if (!creator || creator.role !== 'creator') return null;
  return { uid: creator.id, handle: creator.handle, role: creator.role };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getAuthFromRequest,
  getAdminFromRequest,
  getCreatorFromRequest,
};
