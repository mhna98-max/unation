// ============================================================
// server/router.js — 의존성 없는 초경량 라우터
// (express 없이 동작 — :param 패턴 매칭만 지원)
// ============================================================
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const regexStr = pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    const regex = new RegExp(`^${regexStr}$`);
    this.routes.push({ method, regex, keys, handler });
  }

  get(pattern, handler) { this.add('GET', pattern, handler); }
  post(pattern, handler) { this.add('POST', pattern, handler); }
  put(pattern, handler) { this.add('PUT', pattern, handler); }
  delete(pattern, handler) { this.add('DELETE', pattern, handler); }

  // 매칭되면 핸들러를 실행하고 true, 아니면 false
  async handle(req, res, pathname) {
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = r.regex.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        await r.handler(req, res, params);
        return true;
      }
    }
    return false;
  }
}

module.exports = Router;
