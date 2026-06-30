// ============================================================
// server/paymentProvider.js — 결제 공급자 어댑터
//
// 지금은 PG 연동 전이라 MockPaymentProvider만 사용합니다.
// 실제 PG(포트원/아임포트, 토스페이먼츠 등) 연동 시에는:
//   1) 이 파일에 새 클래스(예: PortOnePaymentProvider)를 추가하고
//      charge() 메서드를 실제 SDK/REST 호출로 구현합니다.
//   2) 결제는 반드시 "서버에서 금액을 다시 검증"해야 합니다 —
//      클라이언트가 보낸 금액을 그대로 믿으면 위변조 위험이 있습니다.
//      (PG사가 제공하는 결제 단건 조회 API로 실제 승인 금액을 대조하세요.)
//   3) .env 의 PAYMENT_PROVIDER 값을 mock → 실제 PG 이름으로 바꾸면
//      나머지 비즈니스 로직(라우트, 정산 등)은 수정할 필요가 없습니다.
// ============================================================

class PaymentProvider {
  // amount: 정수(원), method: 'card'|'kakaopay'|'tosspay'|'mobile'|'transfer', meta: 부가정보
  // 반환값: { success: boolean, txId: string, message?: string }
  async charge({ amount, method, meta }) {
    throw new Error('charge() not implemented');
  }
}

class MockPaymentProvider extends PaymentProvider {
  async charge({ amount, method, meta }) {
    // 실제 결제 없이 항상 성공 처리 — 구조/플로우 검증용 모의 결제
    return {
      success: true,
      txId: `MOCK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      message: '모의 결제 성공 (실제 금액이 청구되지 않았습니다)',
    };
  }
}

// 실제 PG 연동 시 구현할 자리 — 지금은 호출되지 않습니다.
class RealPgPaymentProvider extends PaymentProvider {
  async charge() {
    throw new Error(
      '실제 PG 연동이 아직 구성되지 않았습니다. .env의 PAYMENT_PROVIDER=mock 으로 두고 사용해주세요.'
    );
  }
}

function getPaymentProvider() {
  const mode = process.env.PAYMENT_PROVIDER || 'mock';
  if (mode === 'mock') return new MockPaymentProvider();
  return new RealPgPaymentProvider();
}

function getPaymentMode() {
  return process.env.PAYMENT_PROVIDER || 'mock';
}

function isLocalHost(host) {
  const hostname = String(host || '').split(':')[0].toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function assertPaymentProviderSafeForRequest(req) {
  const mode = getPaymentMode();
  if (mode !== 'mock') return;
  const allowPublicMock = process.env.ALLOW_MOCK_PUBLIC_PAYMENTS === 'true';
  if (allowPublicMock || isLocalHost(req.headers.host)) return;
  const err = new Error('실제 결제 연동이 아직 설정되지 않았습니다. 운영 도메인에서는 모의 결제를 완료 처리할 수 없습니다.');
  err.status = 503;
  throw err;
}

// 서버 시작 시 1회 호출 — NODE_ENV=production인데 결제가 여전히 mock이면
// "진짜 운영 중인 줄 알았는데 사실 돈을 안 받고 있었다"는 사고를 막기 위해
// 서버를 아예 띄우지 않습니다. 의도적으로 무료 체험판처럼 운영하고 싶다면
// .env에 ALLOW_MOCK_IN_PRODUCTION=true 를 명시적으로 추가해야 합니다.
function assertPaymentProviderSafeToBoot() {
  const mode = process.env.PAYMENT_PROVIDER || 'mock';
  const isProd = process.env.NODE_ENV === 'production';
  const allowMock = process.env.ALLOW_MOCK_IN_PRODUCTION === 'true';
  if (isProd && mode === 'mock' && !allowMock) {
    console.error(
      '\n  [실행 중단] NODE_ENV=production 인데 PAYMENT_PROVIDER가 여전히 mock 이에요.\n' +
      '  이 상태로 운영하면 실제 결제 없이도 후원이 "완료"로 기록되고 크리에이터가\n' +
      '  정산을 신청할 수 있어요 (실존하지 않는 돈에 대한 정산).\n\n' +
      '  실제 PG(포트원/토스페이먼츠 등) 연동을 마친 뒤 .env의 PAYMENT_PROVIDER 값을\n' +
      '  바꿔주세요. 자세한 절차는 payment-integration-guide.md를 참고하세요.\n\n' +
      '  (테스트 목적으로 정말 mock 결제 그대로 운영 환경에 띄우고 싶다면, 그 위험을\n' +
      '  이해했다는 뜻으로 .env에 ALLOW_MOCK_IN_PRODUCTION=true 를 추가하세요.)\n'
    );
    process.exit(1);
  }
}

module.exports = {
  getPaymentProvider,
  getPaymentMode,
  assertPaymentProviderSafeToBoot,
  assertPaymentProviderSafeForRequest,
  PaymentProvider,
  MockPaymentProvider,
};
