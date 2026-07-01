// ============================================================
// server/routes/products.js — 크리에이터 스토어(굿즈) 상품 관리
// ============================================================
const db = require('../db');
const { readJsonBody, sendJson, sendError } = require('../helpers');
const { getCreatorFromRequest } = require('../auth');

const MAX_PRICE = 5_000_000;

function mapProductRow(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    imageUrl: p.image_url,
    stock: p.stock, // null = 무제한
    isActive: !!p.is_active,
    createdAt: p.created_at,
  };
}

function isValidImageUrl(url) {
  if (!url) return true; // 이미지는 선택 사항
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

module.exports = function registerProductRoutes(router) {
  // 공개 스토어 — 특정 크리에이터의 활성 상품 목록
  router.get('/api/creators/:handle/products', async (req, res, params) => {
    const creator = db.prepare("SELECT id, display_name FROM creators WHERE handle = ? AND role = 'creator'").get(params.handle);
    if (!creator) return sendError(res, 404, '크리에이터를 찾을 수 없어요.');
    const rows = db.prepare(`
      SELECT * FROM products WHERE creator_id = ? AND is_active = 1
      ORDER BY created_at DESC
    `).all(creator.id);
    sendJson(res, 200, { products: rows.map(mapProductRow), creatorDisplayName: creator.display_name });
  });

  // 내 상품 관리 (활성/비활성 모두) — 로그인 필요. /:handle 패턴보다 먼저 등록.
  router.get('/api/products/me', async (req, res) => {
    const auth = getCreatorFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const rows = db.prepare('SELECT * FROM products WHERE creator_id = ? ORDER BY created_at DESC').all(auth.uid);
    sendJson(res, 200, { products: rows.map(mapProductRow) });
  });

  // 상품 등록
  router.post('/api/products', async (req, res) => {
    const auth = getCreatorFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const body = await readJsonBody(req);

    const name = String(body.name || '').trim().slice(0, 60);
    const description = String(body.description || '').trim().slice(0, 500);
    const price = parseInt(body.price, 10);
    const imageUrl = body.imageUrl ? String(body.imageUrl).trim() : null;
    const stock = body.stock === '' || body.stock === null || body.stock === undefined
      ? null
      : parseInt(body.stock, 10);

    if (!name) return sendError(res, 400, '상품명을 입력해주세요.');
    if (!Number.isInteger(price) || price <= 0 || price > MAX_PRICE) {
      return sendError(res, 400, '가격을 다시 확인해주세요.');
    }
    if (!isValidImageUrl(imageUrl)) return sendError(res, 400, '유효한 이미지 주소를 입력해주세요.');
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      return sendError(res, 400, '재고 수량을 다시 확인해주세요.');
    }

    const result = db.prepare(`
      INSERT INTO products (creator_id, name, description, price, image_url, stock, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(auth.uid, name, description, price, imageUrl, stock);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    sendJson(res, 201, { product: mapProductRow(product) });
  });

  // 상품 수정 (가격/재고/활성 여부 등)
  router.put('/api/products/:id', async (req, res, params) => {
    const auth = getCreatorFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const id = parseInt(params.id, 10);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) return sendError(res, 404, '상품을 찾을 수 없어요.');
    if (existing.creator_id !== auth.uid) return sendError(res, 403, '본인 상품만 수정할 수 있어요.');

    const body = await readJsonBody(req);
    const fields = [];
    const values = [];

    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 60);
      if (!name) return sendError(res, 400, '상품명을 입력해주세요.');
      fields.push('name = ?'); values.push(name);
    }
    if (body.description !== undefined) {
      fields.push('description = ?'); values.push(String(body.description).trim().slice(0, 500));
    }
    if (body.price !== undefined) {
      const price = parseInt(body.price, 10);
      if (!Number.isInteger(price) || price <= 0 || price > MAX_PRICE) {
        return sendError(res, 400, '가격을 다시 확인해주세요.');
      }
      fields.push('price = ?'); values.push(price);
    }
    if (body.imageUrl !== undefined) {
      const imageUrl = body.imageUrl ? String(body.imageUrl).trim() : null;
      if (!isValidImageUrl(imageUrl)) return sendError(res, 400, '유효한 이미지 주소를 입력해주세요.');
      fields.push('image_url = ?'); values.push(imageUrl);
    }
    if (body.stock !== undefined) {
      const stock = body.stock === '' || body.stock === null ? null : parseInt(body.stock, 10);
      if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
        return sendError(res, 400, '재고 수량을 다시 확인해주세요.');
      }
      fields.push('stock = ?'); values.push(stock);
    }
    if (body.isActive !== undefined) {
      fields.push('is_active = ?'); values.push(body.isActive ? 1 : 0);
    }
    if (!fields.length) return sendError(res, 400, '변경할 내용이 없어요.');

    db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    sendJson(res, 200, { product: mapProductRow(product) });
  });

  // 상품 삭제 — 이미 주문이 있는 상품은 주문 내역 보존을 위해 비활성화만 합니다.
  router.delete('/api/products/:id', async (req, res, params) => {
    const auth = getCreatorFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const id = parseInt(params.id, 10);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) return sendError(res, 404, '상품을 찾을 수 없어요.');
    if (existing.creator_id !== auth.uid) return sendError(res, 403, '본인 상품만 삭제할 수 있어요.');

    const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE product_id = ?').get(id).c;
    if (orderCount > 0) {
      db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(id);
      return sendJson(res, 200, { deactivated: true, message: '이미 주문된 상품이라 완전 삭제 대신 비활성화 처리했어요.' });
    }
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    sendJson(res, 200, { deleted: true });
  });
};
