// ============================================================
// launcher.js — UNATION 실행 도우미
// start.bat / start.sh 에서 호출됩니다.
// 한글 메시지를 안전하게 출력하기 위해 모든 안내 문구를
// (배치 파일이 아닌) 이 Node.js 스크립트에서 처리합니다.
// 모든 출력은 launcher-log.txt 파일에도 함께 기록되어,
// 창이 바로 닫히더라도 무슨 일이 있었는지 나중에 확인할 수 있습니다.
// ============================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT, 10) || 3000;
const LOG_PATH = path.join(ROOT, 'launcher-log.txt');

// ── 로그 파일에도 동시에 기록하는 console.log ──
let logStream;
try {
  logStream = fs.createWriteStream(LOG_PATH, { flags: 'w' });
} catch (e) {
  // 로그 파일을 못 만들어도 실행 자체는 계속 진행
}
const realLog = console.log;
const realError = console.error;
console.log = (...args) => {
  realLog(...args);
  if (logStream) logStream.write(args.join(' ') + '\n');
};
console.error = (...args) => {
  realError(...args);
  if (logStream) logStream.write(args.join(' ') + '\n');
};

console.log(`[시작 시각] ${new Date().toLocaleString('ko-KR')}`);
console.log(`[실행 위치] ${ROOT}`);
console.log(`[Node 경로] ${process.execPath}`);
console.log('');

function line() {
  console.log('  ============================================');
}

// 어떤 경우든 절대 조용히 종료되지 않도록 하는 안전장치
process.on('exit', (code) => {
  console.log('');
  console.log(`[프로세스 종료] 코드: ${code}`);
});

// 비동기 오류(예: 포트 충돌로 인한 EADDRINUSE)도 놓치지 않고 안내
process.on('uncaughtException', (err) => {
  console.log('');
  line();
  if (err && err.code === 'EADDRINUSE') {
    console.log(`  [오류] ${PORT} 포트를 사용할 수 없습니다. (이미 사용 중)`);
    console.log('  다른 프로그램을 종료하거나 컴퓨터를 재시작한 뒤 다시 시도해주세요.');
  } else {
    console.log('  [오류] 서버 실행 중 문제가 발생했습니다.');
    console.log('  아래 기술적인 오류 내용을 확인해주세요:');
    console.log('');
    console.error(String(err && err.stack ? err.stack : err));
  }
  console.log('');
  console.log(`  자세한 기록은 launcher-log.txt 파일에서도 확인할 수 있습니다.`);
  line();
  waitForKeyThenExit(1);
});

main();

function main() {
  console.log('');
  line();
  console.log('    유네이션 UNATION 서버를 시작합니다');
  line();
  console.log('');

  // 1. server/index.js 존재 확인 (zip 압축을 안 풀고 실행한 경우 감지)
  const serverEntry = path.join(ROOT, 'server', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    console.log('  [오류] 필요한 파일을 찾을 수 없습니다.');
    console.log(`  (확인한 경로: ${serverEntry})`);
    console.log('');
    console.log('  zip 압축 파일 안에서 바로 실행하신 것 같습니다.');
    console.log('  먼저 압축을 전부 풀어준 다음, 풀린 폴더 안의');
    console.log('  start.bat 파일을 다시 더블클릭해주세요.');
    console.log('');
    console.log('  (압축 풀기: zip 파일을 마우스 오른쪽 클릭 -> "압축 풀기")');
    console.log('');
    waitForKeyThenExit(1);
    return;
  }

  // 2. Node.js 버전 확인 (22.5 이상 필요 — node:sqlite 내장 모듈 사용)
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 5);
  console.log(`  현재 Node.js 버전: v${process.versions.node}`);

  if (!nodeOk) {
    console.log('');
    console.log('  [오류] Node.js 버전이 너무 낮습니다. (22.5 이상 필요)');
    console.log('');
    console.log('  아래 주소에서 최신 LTS 버전을 새로 설치해주세요:');
    console.log('  https://nodejs.org');
    console.log('');
    waitForKeyThenExit(1);
    return;
  }

  // 3. 포트 사용 여부 확인 후 서버 시작
  checkPort(PORT, (inUse) => {
    if (inUse) {
      console.log('');
      console.log(`  [안내] ${PORT} 포트가 이미 사용 중입니다.`);
      console.log('  다른 프로그램이 사용 중이거나, 이전 서버가 아직 켜져 있을 수 있어요.');
      console.log('  계속 진행하면 오류가 날 수 있습니다.');
      console.log('');
    }

    console.log('');
    console.log('  모든 확인 완료. 서버를 시작합니다...');
    console.log('  3초 후 브라우저가 자동으로 열립니다.');
    console.log('  (이 창을 닫으면 서버가 종료됩니다. 닫지 말고 그대로 두세요)');
    console.log('');
    line();
    console.log('');

    setTimeout(() => openBrowser(`http://localhost:${PORT}`), 3000);

    // 실제 서버 실행 (같은 프로세스에서 바로 require)
    try {
      require(serverEntry);
    } catch (err) {
      console.log('');
      line();
      console.log('  [오류] 서버 실행 중 문제가 발생했습니다.');
      console.log('  아래 기술적인 오류 내용을 확인해주세요:');
      console.log('');
      console.error(String(err && err.stack ? err.stack : err));
      console.log('');
      line();
      waitForKeyThenExit(1);
    }
  });
}

function checkPort(port, cb) {
  const tester = http.createServer();
  tester.once('error', () => cb(true));
  tester.once('listening', () => tester.close(() => cb(false)));
  tester.listen(port, '127.0.0.1');
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') cmd = `start "" "${url}"`;
  else if (platform === 'darwin') cmd = `open "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.log(`  [참고] 브라우저 자동 실행에 실패했습니다. 직접 ${url} 주소로 접속해주세요.`);
  });
}

function waitForKeyThenExit(code) {
  console.log('  엔터 키를 눌러 종료...');
  try {
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(code));
  } catch (e) {
    process.exit(code);
  }
}
