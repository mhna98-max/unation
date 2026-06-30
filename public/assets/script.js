// ============================================================
// UNATION — 공통 스크립트
// ============================================================

// ── API 헬퍼 ──
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch(e) {}
  if (!res.ok) {
    const err = new Error(data.error || `오류가 발생했어요. (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── SSE 구독 ──
function connectStream(key, onEvent) {
  const es = new EventSource(`/api/stream/${encodeURIComponent(key)}`);
  es.addEventListener('donation', e => {
    try { onEvent(JSON.parse(e.data)); } catch(err) {}
  });
  es.onerror = () => {
    // 연결 끊기면 3초 후 재연결
    es.close();
    setTimeout(() => connectStream(key, onEvent), 3000);
  };
  return es;
}

// ── 포매터 ──
function formatWon(n) {
  return '₩' + Number(n || 0).toLocaleString('ko-KR');
}

// ── 후원자 등급 (사이트 전체 단일 기준) ──
// 후원 금액에 따라 5단계 등급을 부여합니다. 이 함수가 등급의 유일한 기준이며,
// donate.html / widget.html / creator.html 어디서든 이 함수만 사용해야 합니다.
const TIER_LEVELS = [
  { key: 'platinum', min: 500000, label: '플래티넘 시민', short: 'PLATINUM', icon: '💎', cls: 'tier-platinum' },
  { key: 'gold',      min: 100000, label: '골드 시민',     short: 'GOLD',     icon: '🥇', cls: 'tier-gold' },
  { key: 'silver',    min: 50000,  label: '실버 시민',     short: 'SILVER',   icon: '🥈', cls: 'tier-silver' },
  { key: 'bronze',    min: 10000,  label: '브론즈 시민',   short: 'BRONZE',   icon: '🥉', cls: 'tier-bronze' },
  { key: 'new',       min: 0,      label: '뉴 시민',       short: 'NEW',      icon: '🎫', cls: 'tier-new' },
];
function getTier(amount) {
  const n = Number(amount) || 0;
  return TIER_LEVELS.find(t => n >= t.min) || TIER_LEVELS[TIER_LEVELS.length - 1];
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

function formatNationName(name) {
  const clean = String(name || '').trim();
  return clean ? `${clean} NATION` : 'UNATION';
}

async function applyPublicConfig() {
  try {
    const config = await apiFetch('/api/public/config');
    document.documentElement.dataset.paymentMode = config.mockPayments ? 'mock' : 'live';
    document.documentElement.dataset.paymentProvider = config.paymentMode || 'mock';
  } catch (e) {
    document.documentElement.dataset.paymentMode = 'mock';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyPublicConfig);
} else {
  applyPublicConfig();
}

function fixHomeCtaCopy() {
  document.querySelectorAll('h2.h-display').forEach((heading) => {
    const text = heading.textContent || '';
    if (text.includes('오늘') && text.includes('만들어보세요')) {
      heading.innerHTML = '당신의 유네이션을<br>오늘 만들어보세요.';
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fixHomeCtaCopy);
} else {
  fixHomeCtaCopy();
}

// ── 피드 아이템 ──
function buildFeedItem(donation) {
  const li = document.createElement('li');
  li.className = 'feed-item';
  const name = donation.nickname || '익명의 시민';
  const msg = donation.message
    || (donation.creatorDisplayName ? `${donation.creatorDisplayName} 네이션의 시민이 되었습니다` : '시민이 되었습니다');
  const tier = getTier(donation.amount);
  li.innerHTML = `
    <span class="feed-dot"></span>
    <div class="feed-body">
      <div class="feed-top">
        <span class="feed-name">${escapeHtml(name)}</span>
        <span class="cc-tier ${tier.cls}" style="font-size:8.5px;padding:2px 6px;">${tier.icon} ${tier.short}</span>
        <span class="chip-amount">${formatWon(donation.amount)}</span>
      </div>
      <p class="feed-msg">${escapeHtml(msg)}</p>
    </div>`;
  return li;
}

function prependFeedItem(listEl, donation, max = 6) {
  const item = buildFeedItem(donation);
  listEl.insertBefore(item, listEl.firstChild);
  while (listEl.children.length > max) listEl.removeChild(listEl.lastChild);
}

// ── 토스트 ──
let toastTimer;
function showToast(msg) {
  let toast = document.getElementById('__toast__');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '__toast__';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ── 클립보드 복사 ──
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn ? btn.textContent : '';
    if (btn) btn.textContent = '복사됨 ✓';
    showToast('클립보드에 복사됐어요!');
    if (btn) setTimeout(() => { btn.textContent = orig; }, 2000);
  }).catch(() => showToast('복사에 실패했어요.'));
}

// 참고: .reveal 애니메이션은 순수 CSS(@keyframes)로 처리되어 JS 실행 여부와 무관하게
// 항상 콘텐츠가 보입니다. (style.css의 .reveal 규칙 참고)
