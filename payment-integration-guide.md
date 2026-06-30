# 결제(PG) 연동 가이드 — 유네이션(UNATION) 프로토타입

이 문서는 앞서 제작한 HTML 데모(랜딩 / 크리에이터 페이지 / 후원 페이지 / 대시보드)를
실제로 돈이 오가는 서비스로 발전시키기 위해 필요한 작업을 정리한 가이드입니다.
현재 `donate.html`의 "후원하기" 버튼은 **결제창을 열지 않는 데모 상태**이며,
실제 결제를 붙이려면 별도의 서버와 PG(전자결제대행) 연동이 반드시 필요합니다.

> 이 문서는 일반적인 기술 가이드이며 법률·세무·금융 자문이 아닙니다. 사업자 등록, 통신판매업 신고,
> 전자금융업 관련 법규 적용 여부는 실제 운영 형태에 따라 달라질 수 있으므로, 서비스를 출시하기 전
> 변호사·세무사 또는 각 PG사 가맹점 담당자와 반드시 확인하시기 바랍니다.

---

## 1. 전체 아키텍처

지금의 HTML 파일들은 정적 프론트엔드일 뿐이라, 실제 결제를 처리하려면 그 뒤에
**서버 한 대(API)** 와 **PG사**가 추가로 필요합니다. 전체 흐름은 다음과 같습니다.

1. 후원자가 `donate.html`에서 금액·메시지를 입력하고 "후원하기"를 누른다.
2. 브라우저가 우리 서버에 "결제를 시작하겠다"는 요청을 보내고, 서버는 주문번호(merchant_uid)를 발급한다.
3. 브라우저가 PG사가 제공하는 결제창(SDK)을 연다. 카드/카카오페이/토스페이 등 선택한 수단으로 결제가 진행된다.
4. 결제가 끝나면 PG사가 우리 서버로 **웹훅(서버 간 알림)** 을 보내고, 동시에 브라우저도 결과를 받는다.
5. 서버는 웹훅으로 받은 결제 금액이 처음 요청한 금액과 같은지 다시 한번 검증한 뒤, 후원 내역을 데이터베이스에 저장한다.
6. 서버가 실시간 채널(웹소켓 또는 SSE)로 크리에이터의 방송 알림 위젯에 "후원 도착" 이벤트를 보낸다.
7. 정해진 주기(예: 매주 또는 매월)에 맞춰 누적된 후원금에서 수수료를 제외한 금액을 크리에이터 계좌로 정산한다.

```
[브라우저: donate.html]
        |  1) 결제 요청 + 주문 생성
        v
[우리 서버 (API)] ----3) 결제 검증---- [PG사]
        |                                  |
        | 5) DB에 후원 내역 저장      4) 결제 완료 웹훅
        v                                  |
[실시간 알림 채널] ------------------------+
        |
        v
[OBS 방송 알림 위젯]            [정산 배치] --> [크리에이터 계좌]
```

핵심은 **"결제 금액의 최종 확인은 항상 서버에서, PG사로부터 직접" 받는다는 점**입니다.
브라우저가 보낸 금액은 절대 신뢰해서는 안 됩니다(사용자가 개발자 도구로 조작할 수 있기 때문입니다).

---

## 2. PG사 선택 시 고려할 점

국내에서 자주 쓰이는 결제대행 옵션은 대략 아래와 같은 성격을 가집니다. 정확한 수수료·정산 주기·심사 조건은
시점과 가맹점 형태에 따라 계속 바뀌므로, 아래는 일반적인 특징 정리이며 **계약 전 반드시 각 사에 최신 조건을 직접 확인**해야 합니다.

| 구분 | 특징 |
|---|---|
| 포트원(PortOne, 구 아임포트) | 여러 PG사를 하나의 SDK/API로 연동할 수 있게 묶어주는 결제 연동 서비스. 직접 PG는 아니고, 실제 결제는 제휴된 PG사를 통해 일어남. 개발 문서가 잘 정리되어 있어 소규모 서비스가 빠르게 시작하기 좋은 편. |
| 토스페이먼츠 | 카드·간편결제(토스페이 포함)를 직접 제공하는 PG사. 위젯 형태의 결제 UI를 제공해 프론트엔드 작업량이 적은 편. |
| NHN KCP / 나이스페이먼츠 / KG이니시스 | 국내에서 오래 운영된 대형 PG사. 카드, 가상계좌, 휴대폰 결제 등 다양한 수단을 폭넓게 지원. |
| 카카오페이 / 네이버페이 (간편결제 단독 연동) | PG사를 거치지 않고 자체 가맹점 계약으로 직접 연동하는 방식도 존재. |

소규모로 빠르게 시작한다면 통합 연동 서비스로 먼저 띄워보고, 거래량이 늘어나면 직접 PG사와 계약하는 식으로
단계를 나누는 경우가 많습니다.

---

## 3. 사업자 측 준비사항 (일반적인 체크리스트)

- 사업자등록 (개인사업자 또는 법인)
- 통신판매업 신고 — 온라인으로 결제를 받는 형태라면 통상 필요
- PG사 가맹점 심사 — 서비스 내용, 운영 주체, 정산 계좌 등 서류 제출
- 후원금이 "기부"가 아닌 "콘텐츠/리워드성 결제"임을 이용약관에 명확히 표기 (기부금 영수증 발행 여부와 혼동되지 않도록)
- 미성년자 결제, 환불·취소 정책을 약관에 명시
- 개인정보처리방침에 결제 과정에서 수집되는 정보(이름, 연락처, 결제수단 일부 등) 명시

---

## 4. 클라이언트 측 연동 예시 (개념 코드)

아래는 `donate.html`의 제출 버튼을 실제 결제 SDK 호출로 바꾸는 예시입니다.
실제 SDK의 함수명·파라미터는 사용하는 PG/연동 서비스의 최신 공식 문서를 기준으로 맞춰야 합니다.

```html
<!-- 결제 SDK 스크립트는 각 서비스의 공식 문서에 안내된 주소를 사용하세요 -->
<script src="https://cdn.example-pg.com/v1/payment-sdk.js"></script>

<script>
document.getElementById('donate-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  // 1) 우리 서버에 주문 생성을 요청해서 merchantUid(주문번호)를 받아온다
  const order = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creatorId: 'lunajam',
      amount: currentAmount,
      nickname: document.getElementById('nickname').value || '익명',
      message: document.getElementById('message').value,
    }),
  }).then(res => res.json());

  // 2) PG 결제창 호출 (실제 함수명은 사용하는 SDK 문서를 따른다)
  PaymentSDK.requestPay({
    merchantUid: order.merchantUid,
    amount: order.amount,          // 서버가 계산한 금액을 그대로 사용 (클라이언트 값 재사용 금지)
    payMethod: selectedPayMethod,  // 'card' | 'kakaopay' | 'tosspay' ...
    buyerName: document.getElementById('nickname').value || '익명',
    onSuccess: (result) => {
      window.location.href = `/donate/complete?merchantUid=${order.merchantUid}`;
    },
    onFail: (err) => {
      showToast('결제가 취소되었거나 실패했어요');
    },
  });
});
</script>
```

---

## 5. 서버 측 검증 / 웹훅 처리 예시 (Node.js + Express)

서버는 최소 두 가지 역할을 합니다: **주문 생성**과 **결제 검증/웹훅 수신**.

```javascript
// server.js (개념 예시 — 실제 PG API 경로/파라미터는 공식 문서 기준으로 작성)
import express from 'express';
const app = express();
app.use(express.json());

// 1) 주문 생성: 금액은 반드시 서버(DB·설정값) 기준으로 계산
app.post('/api/orders', async (req, res) => {
  const { creatorId, amount, nickname, message } = req.body;

  if (!Number.isInteger(amount) || amount < 100) {
    return res.status(400).json({ error: '유효하지 않은 금액입니다' });
  }

  const merchantUid = `donate_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

  await db.orders.insert({
    merchantUid, creatorId, amount, nickname, message,
    status: 'pending', createdAt: new Date(),
  });

  res.json({ merchantUid, amount });
});

// 2) PG사 웹훅 수신: 결제 완료 통지가 오면 금액을 재검증한다
app.post('/api/webhooks/payment', async (req, res) => {
  // 웹훅 서명(signature) 검증은 반드시 PG사가 제공하는 방식대로 수행해야 위변조를 막을 수 있다
  const verified = verifyWebhookSignature(req);
  if (!verified) return res.status(401).end();

  const { merchantUid, status, paidAmount } = req.body;
  const order = await db.orders.findOne({ merchantUid });

  if (!order) return res.status(404).end();
  if (order.amount !== paidAmount) {
    // 금액이 다르면 절대 정상 처리하지 않고 별도로 검토
    await db.orders.update({ merchantUid }, { status: 'amount_mismatch' });
    return res.status(409).end();
  }

  await db.orders.update({ merchantUid }, { status: 'paid', paidAt: new Date() });

  // 후원 내역 저장 + 실시간 알림 전송
  await db.donations.insert({ ...order, paidAt: new Date() });
  realtimeChannel.emit(`widget:${order.creatorId}`, {
    nickname: order.nickname,
    amount: order.amount,
    message: order.message,
  });

  res.status(200).end();
});

app.listen(3000);
```

체크포인트:

- 멱등성(idempotency) — 같은 웹훅이 중복으로 와도 두 번 처리되지 않도록 `merchantUid` 기준 상태값을 확인합니다.
- 금액 재검증 — 클라이언트가 보낸 금액이 아니라, PG사가 웹훅으로 알려준 실제 결제 금액을 기준으로 처리합니다.
- 웹훅 서명 검증 — 누구나 그 URL로 가짜 요청을 보낼 수 있으므로, PG사가 제공하는 서명 검증 로직은 반드시 적용합니다.

---

## 6. 알림 위젯(OBS) 연동

대시보드의 "방송 알림 위젯" 카드에 표시된 주소(`/widget/:creatorId`)는 OBS의 브라우저 소스로 등록하는 페이지입니다.

- 서버에서 웹훅 처리 후 `realtimeChannel.emit(...)`으로 보낸 이벤트를 위젯 페이지가 웹소켓 또는
  Server-Sent Events(SSE)로 구독하고 있다가, 이벤트가 오면 화면에 알림 애니메이션을 띄우고
  필요하다면 TTS 음성으로 메시지를 읽어주는 방식입니다.
- 위젯 페이지는 투명 배경(`background: transparent`)으로 만들어야 OBS 화면에 자연스럽게 합성됩니다.

---

## 7. 정산(Payout) 로직 개념

1. 결제 완료된 후원 건들을 `donations` 테이블에 누적한다.
2. 정산 주기(예: 매주 월요일)마다 배치 작업이 크리에이터별로 미정산 후원금 합계를 계산한다.
3. 플랫폼 수수료(및 PG 결제 수수료)를 차감한 금액을 "정산 가능 금액"으로 확정한다.
4. 크리에이터가 정산을 신청하면(또는 자동 정산이라면 즉시), 등록된 계좌로 이체한다 — 은행 이체 API를 직접 연동하거나, 수동으로 처리할 수도 있다.
5. 정산이 끝난 건은 `settled` 상태로 변경해 다음 배치에서 중복 계산되지 않도록 한다.

---

## 8. 보안 체크리스트

- 모든 결제 관련 통신은 HTTPS로만 처리한다.
- 카드 번호 등 결제 정보는 직접 저장하지 않는다 (PG사가 토큰화해서 관리하도록 위임).
- 웹훅 엔드포인트는 서명 검증 없이는 절대 신뢰하지 않는다.
- 결제 금액은 항상 서버에서 재계산·재검증한다.
- 관리자/정산 관련 API는 별도 인증(2단계 인증 권장)으로 보호한다.

---

## 9. 테스트 단계

- 대부분의 PG/연동 서비스는 테스트(샌드박스) 키를 제공합니다. 실제 카드 정보 없이도 결제 성공/실패/취소 시나리오를 미리 점검할 수 있습니다.
- 테스트 체크리스트 예시: 결제 성공 → 위젯 알림 표시 / 결제 실패 → 에러 메시지 표시 / 웹훅 중복 수신 → 중복 정산 방지 / 금액 위조 시도 → 서버에서 거부되는지 확인.

---

## 10. 다음 단계 제안

1. 연동 서비스(또는 PG사) 한 곳을 선택하고 테스트 계정을 발급받는다.
2. 위 예시를 참고해 `/api/orders`, `/api/webhooks/payment` 두 엔드포인트만 먼저 만들어 최소 기능으로 결제를 붙여본다.
3. `donate.html`의 제출 이벤트를 실제 SDK 호출로 교체한다.
4. 알림 위젯 페이지(`/widget/:creatorId`)를 만들어 실시간 채널을 연결한다.
5. 정산 배치를 붙이기 전까지는 대시보드의 "정산 신청" 버튼을 비활성화해 사용자 혼란을 막는다.
