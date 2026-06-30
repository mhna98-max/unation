// ============================================================
// server/rateLimit.js — 의존성 없는 초경량 레이트 리미터
// 로그인/회원가입/문자인증 같은 무차별 대입(brute force) 공격에
// 취약한 엔드포인트를 IP 기준으로 제한합니다.
//
// 주의: 메모리에만 저장되므로 서버를 여러 대(클러스터) 운영하면
// 인스턴스별로 따로 카운트됩니다. 단일 서버(지금 구조)에서는 충분합니다.
// 더 강력한 보호가 필요하면 Nginx/Cloudflare 레벨의 레이트 리밋도 함께 쓰는 걸 권장합니다.
// ============================================================
const buckets = new Map(); // key -> { count, resetAt }

function getClientIp(req) {
  // 리버스 프록시(Nginx) 뒤에서는 X-Forwarded-For의 첫 IP를 사용합니다.
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// windowMs 동안 max회까지 허용. 초과하면 false 반환.
function consume(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

// 주기적으로 만료된 버킷 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

// 미들웨어 팩토리: 라우트 핸들러 안에서 호출해 통과 여부를 확인합니다.
// 사용 예: if (!rateLimit(req, res, 'login', 10, 60_000)) return;
function rateLimit(req, res, bucketName, max, windowMs) {
  const ip = getClientIp(req);
  const ok = consume(`${bucketName}:${ip}`, max, windowMs);
  if (!ok) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': Math.ceil(windowMs / 1000) });
    res.end(JSON.stringify({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' }));
    return false;
  }
  return true;
}

module.exports = { rateLimit, getClientIp };
