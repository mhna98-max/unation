// ============================================================
// server/routes/orders.js — 스토어 상품 주문(구매) / 내 주문내역
// ============================================================
const db = require('../db');
const { readJsonBody, sendJson, sendError } = require('../helpers');
const { getAuthFromRequest } = require('../auth');
const { getPaymentProvider, assertPaymentProviderSafeForRequest } = require('../paymentProvider');
const { rateLimit } = require('../rateLimit');

const PAYMENT_METHODS = new Set(['card', 'kakaopay', 'tosspay', 'mobile', 'transfer']);
const MAX_QUANTITY = 20;

function mapOrderRow(o) {
  return {
    id: o.id,
    productId: o.product_id,
    buyerNickname: o.buyer_nickname,
    buyerContact: o.buyer_contact,
    quantity: o.quantity,
    amount: o.amount,
    message: o.message,
    paymentMethod: o.payment_method,
    status: o.status,
    createdAt: o.created_at,
  };
}

module.exports = function registerOrderRoutes(router) {
  // 상품 구매 — 재고 확인 → 모의 결제 → 재고 차감 → 주문 기록 (트랜잭션으로 묶어 동시 구매 시 재고가 음수로 내려가지 않도록 함)
  router.post('/api/orders', async (req, res) => {
    if (!rateLimit(req, res, 'order-create', 20, 10 * 60 * 1000)) return; // 10분에 20회

    const body = await readJsonBody(req);
    const productId = parseInt(body.productId, 10);
    const buyerNickname = String(body.buyerNickname || '').trim().slice(0, 20) || '익명의 시민';
    const buyerContact = String(body.buyerContact || '').trim().slice(0, 100);
    const message = String(body.message || '').trim().slice(0, 150);
    const quantity = parseInt(body.quantity, 10) || 1;
    const paymentMethod = PAYMENT_METHODS.has(body.paymentMethod) ? body.paymentMethod : null;

    if (!Number.isInteger(productId)) return sendError(res, 400, '상품을 다시 확인해주세요.');
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      return sendError(res, 400, `수량은 1~${MAX_QUANTITY}개 사이로 입력해주세요.`);
    }
    if (!paymentMethod) return sendError(res, 400, '결제 수단을 선택해주세요.');
    if (!buyerContact) return sendError(res, 400, '상품 전달을 위한 연락처(이메일 또는 전화번호)를 입력해주세요.');

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product || !product.is_active) return sendError(res, 404, '판매 중인 상품이 아니에요.');
    if (product.stock !== null && product.stock < quantity) {
      return sendError(res, 400, '재고가 부족해요.');
    }

    const amount = product.price * quantity;
    try {
      assertPaymentProviderSafeForRequest(req);
    } catch (e) {
      return sendError(res, e.status || 503, e.message);
    }

    const provider = getPaymentProvider();
    let result;
    try {
      result = await provider.charge({ amount, method: paymentMethod, meta: { productId } });
    } catch (e) {
      return sendError(res, 502, e.message || '결제 처리 중 오류가 발생했어요.');
    }
    if (!result.success) {
      return sendError(res, 402, result.message || '결제에 실패했어요.');
    }

    // 재고가 있는 상품이면, 결제 성공 이후 재고를 다시 한번 확인하면서 원자적으로 차감합니다.
    // (동시 구매로 인한 재고 음수화 방지 — UPDATE의 WHERE 조건으로 체크합니다)
    if (product.stock !== null) {
      const stockUpdate = db.prepare(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?'
      ).run(quantity, productId, quantity);
      if (stockUpdate.changes === 0) {
        // 결제는 성공했지만 그 사이 재고가 소진된 극히 드문 경우 — 환불 처리가 필요하다는 안내
        return sendError(res, 409, '결제 처리 중 재고가 모두 소진됐어요. 고객센터로 문의해주시면 환불해드릴게요.');
      }
    }

    const insert = db.prepare(`
      INSERT INTO orders (creator_id, product_id, buyer_nickname, buyer_contact, quantity, amount, message, payment_method, status, tx_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(product.creator_id, productId, buyerNickname, buyerContact, quantity, amount, message, paymentMethod, result.txId);

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(insert.lastInsertRowid);
    sendJson(res, 201, { order: mapOrderRow(order), txId: result.txId, mock: !!result.message });
  });

  // 내 주문내역 (크리에이터 대시보드용)
  router.get('/api/orders/me', async (req, res) => {
    const auth = getAuthFromRequest(req);
    if (!auth) return sendError(res, 401, '로그인이 필요해요.');
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
    const rows = db.prepare(`
      SELECT o.*, p.name AS product_name FROM orders o
      JOIN products p ON p.id = o.product_id
      WHERE o.creator_id = ? ORDER BY o.created_at DESC LIMIT ?
    `).all(auth.uid, limit);
    sendJson(res, 200, {
      orders: rows.map((o) => ({ ...mapOrderRow(o), productName: o.product_name })),
    });
  });
};
