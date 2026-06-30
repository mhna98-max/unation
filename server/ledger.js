// ============================================================
// server/ledger.js — 정산 가능 금액 계산 (공용 로직)
//
// available = 누적 후원금 * (1 - 플랫폼 수수료) - (이미 요청했거나 지급된 정산 금액 합)
// 수수료율은 데모용 가정치이며, 실제 운영 시에는 PG사 수수료 + 플랫폼 수수료를
// 정확히 반영해야 합니다.
// ============================================================
const db = require('./db');

const PLATFORM_FEE_RATE = 0.03; // 3% — 데모용 가정치
// 투네이션(40,000원) 등 업계 기준을 참고한 최소 정산 금액 — 너무 적은 금액이
// 매번 정산 신청/처리되는 걸 막아 운영 부담을 줄입니다. .env로 조정 가능합니다.
const MIN_SETTLEMENT_AMOUNT = parseInt(process.env.MIN_SETTLEMENT_AMOUNT, 10) || 10000;

function computeBalance(creatorId) {
  const donationTotal = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS total FROM donations WHERE creator_id = ? AND status = 'completed'"
  ).get(creatorId).total;

  // 스토어(굿즈) 판매 매출도 후원금과 동일하게 정산 대상에 포함합니다.
  const orderTotal = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS total FROM orders WHERE creator_id = ? AND status = 'completed'"
  ).get(creatorId).total;

  const lifetimeTotal = donationTotal + orderTotal;

  const alreadySettled = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS total FROM settlements WHERE creator_id = ? AND status IN ('requested','paid')"
  ).get(creatorId).total;

  const netLifetime = Math.floor(lifetimeTotal * (1 - PLATFORM_FEE_RATE));
  const available = Math.max(0, netLifetime - alreadySettled);

  return { lifetimeTotal, donationTotal, orderTotal, netLifetime, alreadySettled, available, feeRate: PLATFORM_FEE_RATE };
}

module.exports = { computeBalance, PLATFORM_FEE_RATE, MIN_SETTLEMENT_AMOUNT };
