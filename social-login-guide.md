# 소셜 로그인 & 휴대폰 인증 연동 가이드 — 유네이션(UNATION) 프로토타입

이 문서는 현재 데모에 구현된 **모의(가짜) 소셜 로그인 / 휴대폰 인증번호**를
실제 서비스로 발전시키기 위해 필요한 작업을 정리한 가이드입니다.

현재 상태: `signup.html` / `login.html`의 구글·카카오·네이버·애플·마이크로소프트 버튼과
휴대폰 인증번호 입력은 **실제 해당 서비스와 연결되어 있지 않은 데모 상태**입니다.
버튼을 누르면 서버가 가짜 계정을 만들어 바로 로그인시켜주고, 인증번호는 실제 문자
발송 없이 화면에 직접 표시됩니다(`server/routes/auth.js`의 `/api/auth/social`,
`/api/auth/phone/*` 참고).

> 이 문서는 일반적인 기술 가이드이며 법률 자문이 아닙니다. 각 플랫폼의 개발자 약관,
> 개인정보 제3자 제공 동의 절차, 통신판매업/전자금융업 관련 규제는 서비스 운영 형태에
> 따라 달라지므로 출시 전 반드시 각 플랫폼의 최신 정책을 확인하시기 바랍니다.

---

## 1. 소셜 로그인 — 공통 흐름 (OAuth 2.0)

다섯 개 제공자 모두 기본 원리는 동일한 **OAuth 2.0 인가 코드 흐름**입니다.

1. 사용자가 "Google로 시작하기" 버튼을 누른다.
2. 브라우저가 해당 플랫폼의 로그인/동의 화면으로 이동한다 (우리 서버가 아님).
3. 사용자가 동의하면, 플랫폼이 우리가 미리 등록해둔 **콜백 주소**로 "인가 코드"를 담아 돌려보낸다.
4. 우리 서버가 그 인가 코드를 플랫폼 서버에 보내 "액세스 토큰"으로 교환한다.
5. 액세스 토큰으로 사용자의 프로필(이메일, 이름, 고유 ID)을 받아온다.
6. 그 고유 ID(`social_id`)로 기존 계정이 있는지 찾고, 없으면 신규 가입 처리한다.

현재 데모의 `social_id`는 `mock_{provider}_demo`로 고정되어 있어 항상 같은 가짜
계정으로 연결됩니다. 실제 연동 시에는 이 부분을 각 플랫폼이 내려주는 진짜 고유 ID로
교체해야 합니다.

---

## 2. 제공자별 준비물

| 제공자 | 개발자 콘솔 | 필요한 키 | 비고 |
|---|---|---|---|
| Google | [Google Cloud Console](https://console.cloud.google.com) → API 및 서비스 → OAuth 동의 화면 | Client ID, Client Secret | 동의 화면 심사 필요 (민감한 권한 요청 시) |
| 카카오 | [Kakao Developers](https://developers.kakao.com) | REST API 키, Client Secret(선택) | 카카오 비즈니스 채널 연결 시 추가 심사 |
| 네이버 | [Naver Developers](https://developers.naver.com) | Client ID, Client Secret | 서비스 URL 사전 등록 필요 |
| Apple | [Apple Developer](https://developer.apple.com) (유료 멤버십 필요) | Services ID, Key ID, Team ID, 개인키(.p8) | "Sign in with Apple"은 JWT 기반 client secret을 직접 생성해야 함 |
| Microsoft | [Azure Portal](https://portal.azure.com) → App registrations | Application(client) ID, Client Secret | 개인 계정만 받을지, 회사 계정도 받을지 설정 필요 |

각 콘솔에서 공통으로 등록해야 하는 것: **리디렉션(콜백) URI**. 예를 들어
`https://yourdomain.com/api/auth/callback/google` 형태로, 로컬 개발 중에는
`http://localhost:3000/api/auth/callback/google`도 별도로 등록해야 합니다.

---

## 3. 서버에 추가해야 할 것

```
[브라우저] --1) 버튼 클릭--> [플랫폼 로그인 화면]
                                    |
                          2) 동의 후 콜백(인가 코드)
                                    v
                          [우리 서버: /api/auth/callback/:provider]
                                    |
                          3) 코드 -> 토큰 교환 (서버 간 통신)
                                    |
                          4) 토큰으로 프로필 조회
                                    v
                          [DB: social_provider + social_id로 계정 조회/생성]
```

- `.env` 파일에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 등 제공자별 키를 저장 (이미 있는 `.env.example` 참고해 항목 추가)
- `server/routes/auth.js`의 `/api/auth/social` 모의 라우트를 실제 OAuth 콜백 라우트(`/api/auth/callback/:provider`)로 교체
- 토큰 교환·프로필 조회는 각 플랫폼이 제공하는 REST API를 `fetch`로 직접 호출하거나, `openid-client` 같은 검증된 라이브러리 사용을 권장
- 동일한 이메일로 이미 이메일 가입된 계정이 있을 경우 어떻게 처리할지(자동 연결 vs 별도 계정) 정책을 정해두는 게 좋습니다

---

## 4. 휴대폰 번호 인증 (SMS)

현재 `/api/auth/phone/request-otp`는 인증번호를 생성만 하고 실제로 보내지 않은 채
응답에 그대로 포함시켜 화면에 보여주는 **개발용 임시 방식**입니다. 실제 SMS 발송을
위해서는 SMS 발송 서비스 연동이 필요합니다. 국내에서 많이 쓰이는 선택지:

- **네이버 클라우드 플랫폼 SENS** — 국내 발신 품질이 좋고 카카오/네이버와 같은 생태계라 정산도 편한 편
- **알리고(Aligo)**, **쿨SMS(Coolsms)** — 소규모 서비스에서 흔히 쓰는 국내 SMS 중계 업체, 가입이 간단
- **Twilio** — 해외 서비스, 국내 발송 시 발신번호 사전 등록 등 절차가 추가로 필요할 수 있음

공통적으로 필요한 절차:
1. 사업자 등록 및 SMS 발송 서비스 가입
2. 발신번호 사전 등록(통신사 심사, 보통 1~3일 소요)
3. 서버에서 `request-otp` 호출 시 실제 SMS API를 호출하도록 교체하고, 응답에서 `devCode`는 제거
4. 인증번호는 절대 클라이언트로 내려주지 말고, 서버 메모리/Redis 등에만 저장 (현재 코드의 `otpStore`는 데모용 in-memory Map이라 서버 재시작 시 초기화되며, 다중 서버 환경에서는 Redis 등 공유 저장소로 교체 필요)

---

## 5. 우선순위 제안

사업자 등록 전이라면 굳이 서두를 필요는 없지만, 등록 이후 우선순위를 정한다면:

1. **카카오 로그인** — 국내 이용자 비중이 높아 가장 먼저 붙이면 효과가 큽니다
2. **네이버 로그인** — 카카오와 함께 국내 대표 소셜 로그인
3. **휴대폰 SMS 인증** — 소셜 계정이 없는 이용자를 위한 보편적인 가입 수단
4. **Google** — 해외 이용자 또는 개발자 친화적 사용자층
5. **Apple / Microsoft** — 필요에 따라 우선순위를 낮춰도 무방
