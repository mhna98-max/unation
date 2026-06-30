# 24시간 운영 배포 가이드 — 유네이션(UNATION)

이 문서는 지금까지 만든 유네이션을 **집 PC가 아닌 클라우드 서버에 올려서
365일 24시간 켜져 있는 진짜 서비스**로 만드는 방법을 정리한 가이드입니다.

## 왜 클라우드인가

지금 코드는 외부 npm 패키지 없이 Node.js 내장 기능 + SQLite만으로 만들어져 있어서
**노트북 한 대에서도, 클라우드 서버에서도 완전히 똑같이 작동**합니다. 즉:

- **로컬(내 컴퓨터)**: 테스트하거나 코드를 고칠 때 `node launcher.js`로 바로 실행
- **클라우드 서버(VPS)**: 같은 코드를 그대로 올려서 24시간 켜둔 채 운영

집 PC를 서버로 쓰면 정전, 공유기 재시작, ISP가 IP를 바꾸는 일(가정용 회선은 보통
고정IP가 아닙니다) 등으로 사이트가 예고 없이 끊깁니다. 손님이 결제하러 들어왔는데
사이트가 죽어있으면 신뢰를 잃기 쉬우니, 결제가 오가는 "상점"은 처음부터 클라우드에
올리는 걸 권장합니다.

---

## 1. 서버(VPS) 고르기

월 5천~2만원대 사양이면 충분히 시작할 수 있습니다. 트래픽이 늘면 그때 사양만 올리면 됩니다.

| 선택지 | 특징 |
|---|---|
| **가비아 클라우드 서버** | 국내 업체, 한글 지원/상담이 편함, 국내망이라 응답속도 좋음 |
| **Cafe24 클라우드** | 마찬가지로 국내 업체, 호스팅 경험 많아 가이드 자료가 많음 |
| **AWS Lightsail** | 해외(아마존)지만 정액 요금제라 비용 예측이 쉬움, 글로벌 트래픽에 유리 |
| **네이버 클라우드 플랫폼** | 국내 업체, 추후 SENS(SMS) 등 다른 네이버 서비스와 연동이 편함 |

운영체제는 **Ubuntu 22.04 LTS**를 추천합니다 (자료가 가장 많고 안정적).
사양은 시작 단계라면 1 vCPU / 1~2GB RAM 정도로 충분합니다.

---

## 2. 서버 기본 설정

VPS를 만들고 SSH로 접속한 뒤:

```bash
# 패키지 업데이트
sudo apt update && sudo apt upgrade -y

# Node.js 22 설치 (NodeSource 공식 저장소 이용)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# 설치 확인 (22.5 이상이어야 함 — node:sqlite 내장 모듈 사용)
node --version

# 방화벽: SSH, HTTP, HTTPS만 허용
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

---

## 3. 코드 업로드 + 24시간 실행 (systemd)

### 코드 올리기

로컬에서 압축한 `unation.zip`을 서버로 전송합니다 (터미널에서):

```bash
scp unation.zip ubuntu@서버IP주소:/home/ubuntu/
ssh ubuntu@서버IP주소
unzip unation.zip && cd unation
```

(또는 Git을 쓰고 있다면 `git clone` 후 `git pull`로 업데이트하는 방식도 좋습니다.)

### .env 파일 만들기

```bash
cp .env.example .env
nano .env
```

최소한 아래 항목은 꼭 채워주세요:

```
PORT=3000
NODE_ENV=production
SESSION_SECRET=여기에-openssl-rand--hex-32-로-만든-랜덤-문자열
```

`SESSION_SECRET`은 아래 명령으로 안전한 랜덤 값을 만들 수 있습니다.

```bash
openssl rand -hex 32
```

> 참고: `.env`에 `SESSION_SECRET`을 안 넣어도 서버가 알아서 임의의 키를 만들어
> `data/.session-secret`에 저장해두긴 합니다. 다만 운영 서버는 직접 지정하고
> 안전하게 백업해두는 걸 권장합니다 — 이 값이 바뀌면 모든 로그인 세션이 풀립니다.

### systemd로 24시간 자동 실행 설정

`deploy/unation.service` 파일을 참고해서 (이미 만들어져 있습니다) 본인 서버 경로에 맞게
`User`, `WorkingDirectory`, `ExecStart` 줄을 수정한 뒤:

```bash
sudo cp deploy/unation.service /etc/systemd/system/unation.service
sudo systemctl daemon-reload
sudo systemctl enable unation   # 재부팅해도 자동 시작
sudo systemctl start unation    # 지금 바로 시작

# 상태 확인
sudo systemctl status unation

# 실시간 로그 확인
sudo journalctl -u unation -f
```

이제 서버가 죽거나(에러로 프로세스 종료), 서버를 재부팅해도 **자동으로 다시 켜집니다.**
이게 집 PC와의 가장 큰 차이입니다.

---

## 4. 도메인 연결 + HTTPS (Nginx)

지금은 `서버IP:3000`으로만 접속되는 상태입니다. `https://yourdomain.com`처럼 깔끔한
주소로 접속되게 하려면 Nginx를 앞단에 둡니다.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

`deploy/unation.nginx.conf` 파일(이미 만들어져 있습니다)에서 `yourdomain.com` 부분을
실제 보유한 도메인으로 바꾼 뒤:

```bash
sudo cp deploy/unation.nginx.conf /etc/nginx/sites-available/unation
sudo ln -s /etc/nginx/sites-available/unation /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 무료 SSL 인증서 자동 발급 (가입한 도메인의 DNS가 이 서버 IP를 가리키고 있어야 함)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

도메인의 DNS 설정(가비아/Cafe24/가입한 도메인 등록업체)에서 **A 레코드**를 서버의
공인 IP로 미리 연결해둬야 인증서 발급이 됩니다.

---

## 5. 배포 후 운영 체크리스트

- [ ] `https://yourdomain.com` 접속해서 정상적으로 사이트가 뜨는지 확인
- [ ] 회원가입 → 로그인 → 후원 → 위젯까지 실제로 한 번씩 눌러서 끝까지 테스트
- [ ] 결제는 아직 **모의(mock) 결제**입니다 — 실제 돈을 받으려면 `payment-integration-guide.md` 참고해서 PG 연동 필요 (사업자 등록 먼저 필요)
- [ ] 소셜 로그인도 아직 **모의** 상태입니다 — `social-login-guide.md` 참고
- [ ] `data/unation.sqlite` 파일은 정기적으로 백업하세요 (`scp`로 로컬에 주기적으로 받아두거나, cron으로 자동 백업 스크립트 설정 권장)
- [ ] 서버 재부팅 테스트: `sudo reboot` 후 `sudo systemctl status unation`으로 자동 복구되는지 확인

---

## 6. 나중에 트래픽이 늘어나면

이 구조의 장점은 **트래픽이 늘어도 코드를 거의 안 고쳐도 된다는 것**입니다.

1. **서버 사양만 올리기** — VPS 콘솔에서 vCPU/RAM을 늘리는 게 가장 쉬운 첫 단계
2. **SQLite 한계가 보이면** — 동시 접속이 아주 많아지면 SQLite도 충분히 버티는 편이지만,
   언젠가 PostgreSQL/MySQL 같은 별도 DB 서버로 옮기고 싶어질 수 있습니다. 그때는
   `server/db.js`의 쿼리 부분만 교체하면 되고, 나머지 구조(라우터, 인증, SSE 등)는
   그대로 재사용할 수 있게 설계되어 있습니다.
3. **서버를 여러 대로 늘리고 싶다면** — 지금은 SSE 연결을 메모리에서 관리하고 있어서
   서버를 2대 이상으로 늘리려면(로드밸런싱) Redis 같은 공유 메시지 브로커가 필요해집니다.
   트래픽이 정말 많아지기 전까지는 서버 1대 + 사양 업그레이드로 충분합니다.

---

## 요약: 로컬 vs 운영 서버

| | 로컬(테스트용) | 클라우드 서버(운영용) |
|---|---|---|
| 실행 방법 | `node launcher.js` 더블클릭/PowerShell | `systemctl start unation` (자동 시작 설정됨) |
| 접속 주소 | `http://localhost:3000` | `https://yourdomain.com` |
| 켜져 있는 시간 | 내가 컴퓨터를 켜둔 동안만 | 24시간 365일 |
| 코드 | **완전히 동일** | **완전히 동일** |
