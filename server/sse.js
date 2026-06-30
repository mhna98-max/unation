// ============================================================
// server/sse.js — 실시간 알림 (Server-Sent Events)
// 외부 라이브러리 없이 순수 HTTP로 구현. 채널(key) 단위로 구독/발행.
// ============================================================
const channels = new Map(); // key -> Set<res>

function subscribe(req, res, key) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  if (!channels.has(key)) channels.set(key, new Set());
  channels.get(key).add(res);

  // 30초마다 ping을 보내 연결 유지 (일부 프록시/브라우저의 idle timeout 방지)
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { /* noop */ }
  }, 30000);

  const cleanup = () => {
    clearInterval(ping);
    const set = channels.get(key);
    if (set) {
      set.delete(res);
      if (set.size === 0) channels.delete(key);
    }
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

function publish(key, event, data) {
  const set = channels.get(key);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (e) { /* 연결이 끊긴 클라이언트는 무시 */ }
  }
}

module.exports = { subscribe, publish };
