# 유네이션 UNATION

크리에이터와 팬이 함께 만드는 후원 플랫폼.

> 💡 **24시간 365일 운영하는 실제 서비스로 띄우고 싶다면** → [`deployment-guide.md`](./deployment-guide.md)를 먼저 읽어주세요.
> 아래 "실행하기"는 **내 컴퓨터에서 잠깐 테스트해볼 때** 쓰는 방법이고, 실제 손님이 들어오는
> 서비스는 클라우드 서버(VPS)에 올려서 24시간 켜두는 걸 권장합니다. 코드는 완전히 동일하게
> 작동하니, 지금은 로컬에서 테스트하고 준비되면 그대로 서버에 올리면 됩니다.

---

## 🚀 실행하기 (가장 확실한 방법 — 명령 프롬프트 직접 사용)

더블클릭 방식은 컴퓨터 환경에 따라 창이 바로 닫혀버리는 경우가 있어서, **아래 방법이 가장 확실합니다.**

1. **Node.js 설치** (이미 설치되어 있다면 생략) — https://nodejs.org 에서 LTS 버전 다운로드 후 설치, 설치 후 **컴퓨터 재시작**
2. 압축을 푼 `unation` 폴더를 엽니다
3. 폴더 안의 빈 공간에서 **Shift 키를 누른 채 마우스 오른쪽 클릭** → "여기에 PowerShell 창 열기" 또는 "여기에 명령 프롬프트 열기" 선택
   (Windows 11이면 그냥 마우스 오른쪽 클릭 → "터미널에서 열기")
4. 열린 검은 창에 아래를 그대로 입력하고 엔터:
   ```
   node launcher.js
   ```
5. 화면에 안내 메시지가 뜨고, 3초 후 브라우저가 자동으로 열립니다

이 방법은 창이 본인이 직접 연 창이기 때문에, **무슨 일이 있어도 명령어가 끝나기 전까지 절대 저절로 닫히지 않습니다.** 오류가 나도 그 자리에서 메시지를 바로 읽을 수 있어요.

### 더블클릭으로 실행하고 싶다면

`start.bat` 파일을 더블클릭해도 됩니다 (Mac은 `start.sh`). 다만 일부 Windows 환경에서는 창이 빨리 닫힐 수 있어, 그런 경우 **위의 명령 프롬프트 방법을 사용해주세요.**

> 검은 창(서버)이 켜져 있는 동안에만 사이트가 작동합니다. 브라우저에서 새로고침해도 항상 같은 데이터가 유지됩니다.

데모 로그인 계정: `lunajam@unation.kr` / `demo1234`

### ❓ 문제가 있나요?

실행할 때마다 폴더 안에 **`launcher-log.txt`** 파일이 자동으로 생성/갱신됩니다. 창이 너무 빨리 닫혀서 메시지를 못 읽었다면, 이 파일을 메모장으로 열어서 무슨 내용이 있었는지 확인할 수 있어요.

1. **그래도 안 된다면** → 위의 "명령 프롬프트 직접 사용" 방법으로 실행해보세요. 창이 안 닫히기 때문에 오류를 확실히 볼 수 있습니다.
2. **"Node.js was not found" 메시지가 뜬다** → https://nodejs.org 에서 LTS 버전을 설치하고 **컴퓨터를 재시작**한 뒤 다시 시도해주세요.
3. **포트 충돌(3000 포트 사용 중) 메시지가 뜬다** → 컴퓨터를 재시작한 뒤 다시 시도하거나, 다른 프로그램이 3000번 포트를 쓰고 있지 않은지 확인해주세요.
4. **브라우저가 안 열리거나 빈 화면이다** → 브라우저 주소창에 직접 `http://localhost:3000` 을 입력해보세요.
5. 그래도 해결이 안 되면 `launcher-log.txt` 내용을 복사해서 알려주시면 정확히 짚어드릴게요.

---

## 요구사항

- **Node.js 22.5 이상** — `node:sqlite` 내장 모듈 사용 (22.5부터 안정화, Node 22 LTS 권장)
- npm 패키지 의존성 **없음** — `npm install` 불필요

---

## 빠른 시작

```bash
# 1. 저장소 클론 후 이동
cd unation

# 2. (선택) .env 파일 생성 — 없으면 기본값 사용
cp .env.example .env   # .env.example은 아래 참고

# 3. 서버 실행 (데이터베이스가 자동으로 생성됩니다)
npm start
# 또는 개발 중 파일 변경 감지 자동재시작:
npm run dev

# 4. 브라우저에서 열기
open http://localhost:3000
```

### .env 설정 (선택)

```
PORT=3000
SESSION_SECRET=여기에-긴-랜덤-문자열을-넣으세요-프로덕션에서는-반드시-변경
NODE_ENV=development
PAYMENT_PROVIDER=mock
```

> **중요**: `SESSION_SECRET`은 프로덕션 배포 전 반드시 강력한 랜덤 값으로 교체하세요.

---

## 데모 계정

서버 첫 실행 시 아래 계정이 자동으로 생성됩니다.

| 항목 | 값 |
|------|---|
| 이메일 | `lunajam@unation.kr` |
| 비밀번호 | `demo1234` |
| 핸들 | `lunajam` |
| 후원 페이지 | `/creator.html?handle=lunajam` |
| OBS 위젯 | `/widget.html?handle=lunajam` |
| 위젯 테스트 | `/widget.html?handle=lunajam&test=1` |

---

## 실제로 동작하는 기능

| 기능 | 상태 |
|------|------|
| 회원가입 / 로그인 / 로그아웃 | ✅ 실제 동작 |
| 세션 쿠키 인증 (HMAC-SHA256 서명) | ✅ 실제 동작 |
| 크리에이터 프로필 · 목표 설정 | ✅ 실제 동작 |
| 후원 생성 · DB 저장 | ✅ 실제 동작 |
| 실시간 SSE 후원 알림 | ✅ 실제 동작 |
| OBS 위젯 오버레이 | ✅ 실제 동작 |
| 정산 신청 · 내역 조회 | ✅ 실제 동작 |
| 정산 가능 금액 계산 (수수료 3%) | ✅ 실제 동작 |
| 대시보드 통계 · 7일 차트 | ✅ 실제 동작 |
| **실제 카드/간편결제 청구** | ⏳ 모의 결제 (아래 참고) |

---

## 실제 PG(결제) 연동 방법

현재는 `server/paymentProvider.js`의 `MockPaymentProvider`가 사용됩니다.  
결제가 발생하는 것처럼 보이지만 **실제 금액이 청구되지 않습니다**.

실제 PG 연동 순서:

1. **PG 계약 체결** — 포트원(구 아임포트) 또는 토스페이먼츠 추천
   - 개인 사업자 등록 후 PG사에 가입 신청
   - 마켓플레이스형(크리에이터 → 팬) 정산이 필요하면 "파트너 정산" 또는 "지급대행" 상품 필요
2. **API 키 발급** — PG 대시보드에서 클라이언트 키 + 시크릿 키 발급
3. **`server/paymentProvider.js` 수정** — `RealPgPaymentProvider` 클래스에 실제 SDK 호출 구현
   ```js
   class PortOnePaymentProvider extends PaymentProvider {
     async charge({ amount, method, meta }) {
       // 1) 포트원 결제창 호출은 프론트엔드에서 (임포트 SDK)
       // 2) 여기서는 서버에서 imp_uid로 결제 단건 조회 후 금액 검증
       const response = await fetch('https://api.iamport.kr/payments/' + meta.impUid, {
         headers: { Authorization: await getPortOneToken() }
       });
       const data = await response.json();
       if (data.response.amount !== amount) throw new Error('결제 금액 불일치');
       return { success: true, txId: data.response.imp_uid };
     }
   }
   ```
4. **`.env` 수정**
   ```
   PAYMENT_PROVIDER=portone
   PORTONE_IMP_KEY=imp_XXXXXXXX
   PORTONE_IMP_SECRET=XXXXXXXX
   ```
5. 나머지 비즈니스 로직(라우트, 정산, SSE)은 **수정 불필요**

---

## 프로젝트 구조

```
unation/
├── server/
│   ├── index.js          # 진입점 · HTTP 서버 · 정적 파일 서빙
│   ├── db.js             # SQLite 스키마 · 데모 시드
│   ├── auth.js           # 비밀번호 해시 · 세션 토큰 · 쿠키
│   ├── sse.js            # 실시간 SSE 채널 pub/sub
│   ├── ledger.js         # 정산 가능 금액 계산
│   ├── router.js         # 경량 HTTP 라우터
│   ├── helpers.js        # JSON 응답 헬퍼
│   ├── paymentProvider.js # 결제 어댑터 (여기서 PG 교체)
│   └── routes/
│       ├── auth.js       # 회원가입 · 로그인 · 로그아웃
│       ├── creators.js   # 프로필 조회 · 수정 · 목록
│       ├── donations.js  # 후원 생성 · 피드 · 통계
│       ├── settlements.js# 정산 신청 · 내역
│       └── stream.js     # SSE 스트림 엔드포인트
├── public/
│   ├── index.html        # 랜딩 페이지 (실시간 통계 · 피드)
│   ├── login.html        # 로그인
│   ├── signup.html       # 회원가입
│   ├── creator.html      # 크리에이터 공개 프로필
│   ├── donate.html       # 후원 폼 (모의결제)
│   ├── dashboard.html    # 크리에이터 대시보드
│   ├── widget.html       # OBS 브라우저 소스 오버레이
│   └── assets/
│       ├── style.css     # 전체 스타일
│       └── script.js     # 공통 JS (apiFetch, SSE, 포맷터)
├── data/                 # SQLite DB 파일 (자동 생성, gitignore)
├── package.json
├── .gitignore
└── README.md
```

---

## API 엔드포인트 요약

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/auth/signup` | 회원가입 |
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/logout` | 로그아웃 |
| GET  | `/api/auth/me` | 로그인 정보 확인 |
| GET  | `/api/stats` | 플랫폼 전체 통계 |
| GET  | `/api/creators` | 크리에이터 목록 |
| GET  | `/api/creators/:handle` | 크리에이터 공개 프로필 |
| PUT  | `/api/creators/me` | 내 프로필 수정 (인증 필요) |
| POST | `/api/donations` | 후원 생성 |
| GET  | `/api/creators/:handle/donations` | 후원 피드/랭킹 |
| GET  | `/api/donations/me` | 내 후원 내역 (인증) |
| GET  | `/api/me/stats` | 내 대시보드 통계 (인증) |
| POST | `/api/settlements` | 정산 신청 (인증) |
| GET  | `/api/settlements/me` | 정산 내역 (인증) |
| GET  | `/api/stream/:key` | SSE 실시간 스트림 |

---

## 보안 참고사항

- 프로덕션에서는 반드시 HTTPS를 사용하세요 (Nginx/Caddy로 SSL 종단 권장)
- `SESSION_SECRET`은 최소 32자 이상의 무작위 문자열 사용
- `NODE_ENV=production` 설정 시 쿠키에 `Secure` 플래그가 자동 추가됩니다
- 정산 금액은 클라이언트 값을 무시하고 서버에서 재계산합니다

---

## 더 읽어보기

- [`deployment-guide.md`](./deployment-guide.md) — 클라우드 서버(VPS)에 올려서 24시간 운영하는 방법
- [`payment-integration-guide.md`](./payment-integration-guide.md) — 모의 결제를 실제 PG 결제로 전환하는 방법
- [`social-login-guide.md`](./social-login-guide.md) — 모의 소셜 로그인/휴대폰 인증을 실제로 연동하는 방법
