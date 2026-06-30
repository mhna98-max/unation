// ============================================================
// server/env.js — 의존성 없는 초소형 .env 로더
// dotenv 같은 npm 패키지 없이, 프로젝트 루트의 .env 파일을 읽어
// process.env에 채워줍니다. 이미 설정된 환경변수(예: systemd, PM2,
// 쉘에서 직접 export한 값)는 덮어쓰지 않습니다.
// ============================================================
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 따옴표로 감싼 값은 따옴표 제거
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadEnv };
