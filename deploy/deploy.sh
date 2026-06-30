#!/bin/bash
# ============================================================
# deploy.sh — 유네이션(UNATION) 안전 재배포 스크립트
#
# 이 스크립트는 "내 컴퓨터(로컬)"에서 실행합니다. (서버 안에서 실행하는 게 아닙니다)
# 새로 받은 unation_with_admin.zip을 서버에 올리고, 실제 후원/정산 데이터가
# 들어있는 data/ 폴더는 절대 건드리지 않은 채 코드만 안전하게 교체합니다.
#
# 사용 전 준비:
#   1. 아래 "설정" 부분을 본인 서버 정보에 맞게 수정하세요.
#   2. 이 스크립트와 unation_with_admin.zip을 같은 폴더에 두세요.
#   3. 최초 1회만: chmod +x deploy.sh
#
# 사용법:
#   ./deploy.sh
# ============================================================
set -euo pipefail

# ───────────── 설정 (본인 서버에 맞게 수정) ─────────────
REMOTE_USER="ubuntu"                  # 서버 SSH 사용자명 (Cafe24 클라우드는 보통 ubuntu)
REMOTE_HOST="여기에-서버IP-또는-도메인"   # 예: 123.45.67.89 또는 yourdomain.com
REMOTE_DIR="/home/ubuntu/unation"     # 서버에서 실제로 서비스가 돌아가는 폴더 경로
SERVICE_NAME="unation"                # systemd 서비스 이름 (deploy/unation.service의 이름과 동일해야 함)
LOCAL_ZIP="unation_with_admin.zip"    # 로컬에 있는 압축 파일 이름
# ──────────────────────────────────────────────────────

if [ ! -f "$LOCAL_ZIP" ]; then
  echo "[오류] $LOCAL_ZIP 파일을 찾을 수 없어요. 이 스크립트와 같은 폴더에 두었는지 확인해주세요."
  exit 1
fi

if [ "$REMOTE_HOST" = "여기에-서버IP-또는-도메인" ]; then
  echo "[오류] deploy.sh 상단의 REMOTE_HOST 값을 실제 서버 주소로 먼저 수정해주세요."
  exit 1
fi

REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

echo "▶ [1/5] 새 코드를 서버로 업로드하는 중..."
scp "$LOCAL_ZIP" "${REMOTE}:/home/${REMOTE_USER}/"

echo "▶ [2/5] 서버에서 압축 해제 중..."
ssh "$REMOTE" "rm -rf /home/${REMOTE_USER}/unation_new && unzip -oq /home/${REMOTE_USER}/${LOCAL_ZIP} -d /home/${REMOTE_USER}/unation_new"

echo "▶ [3/5] data 폴더(실제 후원·정산 DB)는 보존한 채 코드만 동기화하는 중..."
# --exclude='data' 가 핵심입니다 — 이게 없으면 실서비스 DB가 빈 DB로 덮어써질 수 있어요.
ssh "$REMOTE" "rsync -a --delete --exclude='data' --exclude='.env' /home/${REMOTE_USER}/unation_new/ ${REMOTE_DIR}/ && rm -rf /home/${REMOTE_USER}/unation_new /home/${REMOTE_USER}/${LOCAL_ZIP}"

echo "▶ [4/5] 서비스 재시작 중..."
ssh "$REMOTE" "sudo systemctl restart ${SERVICE_NAME}"
sleep 2

echo "▶ [5/5] 상태 확인 중..."
ssh "$REMOTE" "sudo systemctl is-active --quiet ${SERVICE_NAME} && echo '✅ 서비스 정상 실행 중' || (echo '❌ 서비스가 시작되지 않았어요 — 아래 로그를 확인하세요' && sudo journalctl -u ${SERVICE_NAME} -n 30 --no-pager && exit 1)"

echo
echo "🎉 배포 완료! https://${REMOTE_HOST} 에서 정상 반영됐는지 확인해보세요."
