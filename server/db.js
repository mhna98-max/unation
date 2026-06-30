// ============================================================
// server/db.js — 데이터베이스 레이어
// Node.js 내장 node:sqlite 모듈만 사용 (npm install 불필요, Node 22.5+ 필요)
// ============================================================
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'unation.sqlite'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS creators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT,
    phone TEXT UNIQUE,
    social_provider TEXT DEFAULT NULL,
    social_id TEXT DEFAULT NULL,
    bio TEXT DEFAULT '',
    goal_label TEXT DEFAULT NULL,
    goal_amount INTEGER DEFAULT NULL,
    bank_name TEXT DEFAULT NULL,
    bank_account TEXT DEFAULT NULL,
    bank_holder TEXT DEFAULT NULL,
    platform TEXT DEFAULT NULL,
    platform_channel TEXT DEFAULT NULL,
    chat_embed_url TEXT DEFAULT NULL,
    role TEXT NOT NULL DEFAULT 'creator',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creators(id),
    citizen_number INTEGER NOT NULL,
    nickname TEXT NOT NULL DEFAULT '익명의 시민',
    amount INTEGER NOT NULL,
    message TEXT DEFAULT '',
    donation_type TEXT DEFAULT '일반',
    video_url TEXT DEFAULT NULL,
    image_url TEXT DEFAULT NULL,
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    tx_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creators(id),
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',
    requested_at TEXT DEFAULT (datetime('now')),
    paid_at TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creators(id),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price INTEGER NOT NULL,
    image_url TEXT DEFAULT NULL,
    stock INTEGER DEFAULT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creators(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    buyer_nickname TEXT NOT NULL DEFAULT '익명의 시민',
    buyer_contact TEXT DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 1,
    amount INTEGER NOT NULL,
    message TEXT DEFAULT '',
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    tx_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    is_published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_donations_creator ON donations(creator_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_settlements_creator ON settlements(creator_id);
  CREATE INDEX IF NOT EXISTS idx_products_creator ON products(creator_id);
  CREATE INDEX IF NOT EXISTS idx_orders_creator ON orders(creator_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_notices_published ON notices(is_published, created_at);
`);

// ---------- 기존 DB 마이그레이션 (이미 만들어진 DB에 새 컬럼 추가) ----------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('creators', 'platform', 'platform TEXT DEFAULT NULL');
ensureColumn('creators', 'platform_channel', 'platform_channel TEXT DEFAULT NULL');
ensureColumn('creators', 'chat_embed_url', 'chat_embed_url TEXT DEFAULT NULL');
ensureColumn('creators', 'phone', 'phone TEXT');
ensureColumn('creators', 'social_provider', 'social_provider TEXT DEFAULT NULL');
ensureColumn('creators', 'social_id', 'social_id TEXT DEFAULT NULL');
ensureColumn('donations', 'video_url', 'video_url TEXT DEFAULT NULL');
ensureColumn('donations', 'image_url', 'image_url TEXT DEFAULT NULL');
ensureColumn('creators', 'role', "role TEXT NOT NULL DEFAULT 'creator'");
ensureColumn('creators', 'show_donations_publicly', 'show_donations_publicly INTEGER NOT NULL DEFAULT 1');
ensureColumn('creators', 'roulette_segments', 'roulette_segments TEXT DEFAULT NULL');
ensureColumn('donations', 'roulette_result', 'roulette_result TEXT DEFAULT NULL');
ensureColumn('donations', 'sticker_emoji', 'sticker_emoji TEXT DEFAULT NULL');
ensureColumn('donations', 'pos_x', 'pos_x REAL DEFAULT NULL');
ensureColumn('donations', 'pos_y', 'pos_y REAL DEFAULT NULL');

// ---------- 데모 계정 시드 (최초 실행 시 1회) ----------
const creatorCount = db.prepare('SELECT COUNT(*) AS c FROM creators').get().c;
if (creatorCount === 0) {
  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }
  const insertCreator = db.prepare(`
    INSERT INTO creators (handle, display_name, email, password_hash, bio, goal_label, goal_amount, bank_name, bank_account, bank_holder)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertCreator.run(
    'unation_official',
    'UNATION 공식',
    'official@unation.kr',
    hashPassword('demo1234'),
    '유네이션의 공식 네이션입니다. 크리에이터와 시민이 함께 만들어가는 후원 경험을 소개합니다.',
    '공식 네이션 운영',
    500000,
    '신한은행',
    '110-***-123456',
    '유네이션'
  );
  console.log('[seed] 공식 크리에이터 계정 생성됨 — official@unation.kr / demo1234');
}

const legacyDemo = db.prepare("SELECT id FROM creators WHERE handle = 'lunajam' AND email = 'lunajam@unation.kr'").get();
const officialExists = db.prepare("SELECT id FROM creators WHERE handle = 'unation_official'").get();
if (legacyDemo && !officialExists) {
  db.prepare(`
    UPDATE creators
    SET handle = 'unation_official',
        display_name = 'UNATION 공식',
        email = 'official@unation.kr',
        bio = '유네이션의 공식 네이션입니다. 크리에이터와 시민이 함께 만들어가는 후원 경험을 소개합니다.',
        goal_label = '공식 네이션 운영',
        bank_holder = '유네이션'
    WHERE id = ?
  `).run(legacyDemo.id);
}

// ---------- 관리자 계정 시드 (admin role 계정이 하나도 없으면 항상 1개 생성) ----------
// 주의: creatorCount===0 조건과 묶어두면, 기존 DB에 이미 일반 크리에이터가 있는
// 상태에서 관리자 기능을 새로 추가했을 때 관리자 계정이 영영 생성되지 않는 문제가
// 있었습니다 (관리자 페이지 로그인이 안 되던 원인). 그래서 별도 조건으로 분리합니다.
const adminCount = db.prepare("SELECT COUNT(*) AS c FROM creators WHERE role = 'admin'").get().c;
if (adminCount === 0) {
  function hashPasswordForAdmin(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }
  const adminEmail = process.env.ADMIN_SEED_EMAIL || 'admin@unation.kr';
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'admin1234';
  const adminHandle = process.env.ADMIN_SEED_HANDLE || 'unation_admin';

  const insertAdmin = db.prepare(`
    INSERT INTO creators (handle, display_name, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'admin')
  `);
  insertAdmin.run(adminHandle, 'UNATION 운영팀', adminEmail, hashPasswordForAdmin(adminPassword));
  console.log(`[seed] 관리자 계정 생성됨 — ${adminEmail} / ${process.env.ADMIN_SEED_PASSWORD ? '(.env에 지정된 비밀번호)' : adminPassword + ' (운영 환경에서는 즉시 비밀번호를 변경하세요)'}`);
}

module.exports = db;
