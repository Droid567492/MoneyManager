'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_FX_RATES, parseFxRates } = require('./fx');

function initDatabase(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  createSchema(db);
  seedDefaults(db);

  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      currency TEXT NOT NULL DEFAULT 'HUF',
      color TEXT NOT NULL DEFAULT '#3b82f6',
      icon TEXT NOT NULL DEFAULT 'bank',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pockets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'HUF',
      initial_balance REAL NOT NULL DEFAULT 0,
      live_anchor_balance REAL,
      live_anchor_date TEXT,
      current_balance REAL NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#6366f1',
      icon TEXT NOT NULL DEFAULT 'wallet',
      is_default INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer')),
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      auto_note_template TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer', 'adjustment')),
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'HUF',
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      pocket_id INTEGER NOT NULL REFERENCES pockets(id),
      dest_account_id INTEGER REFERENCES accounts(id),
      dest_pocket_id INTEGER REFERENCES pockets(id),
      dest_amount REAL,
      category_id INTEGER REFERENCES categories(id),
      category_name TEXT NOT NULL,
      merchant TEXT DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      note_source TEXT NOT NULL DEFAULT 'manual' CHECK(note_source IN ('manual', 'auto', 'import')),
      items_json TEXT DEFAULT '[]',
      receipt_path TEXT,
      store_address TEXT DEFAULT '',
      is_historical INTEGER NOT NULL DEFAULT 0,
      needs_approval INTEGER NOT NULL DEFAULT 0,
      auto_source TEXT DEFAULT NULL,
      exclude_from_analytics INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recorded_pocket_balance_after REAL,
      recorded_dest_pocket_balance_after REAL,
      pocket_balance_before REAL,
      account_balance_before REAL,
      dest_pocket_balance_before REAL,
      dest_account_balance_before REAL,
      pocket_balance_after REAL,
      account_balance_after REAL,
      dest_pocket_balance_after REAL,
      dest_account_balance_after REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counterparties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
      default_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      use_count INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT NOT NULL,
      UNIQUE(name, direction)
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      last_sent_at TEXT DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tx_date_id ON transactions(date, id);
    CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_tx_pocket ON transactions(pocket_id);
    CREATE INDEX IF NOT EXISTS idx_tx_dest_pocket ON transactions(dest_pocket_id);
    CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_counterparties_dir ON counterparties(direction, use_count DESC);
  `);

  // Safe migration if upgrading an existing SQLite DB
  const cols = db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name);
  if (!cols.includes('recorded_pocket_balance_after')) {
    db.exec('ALTER TABLE transactions ADD COLUMN recorded_pocket_balance_after REAL;');
  }
  if (!cols.includes('recorded_dest_pocket_balance_after')) {
    db.exec('ALTER TABLE transactions ADD COLUMN recorded_dest_pocket_balance_after REAL;');
  }
  if (!cols.includes('needs_approval')) {
    db.exec('ALTER TABLE transactions ADD COLUMN needs_approval INTEGER NOT NULL DEFAULT 0;');
  }
  if (!cols.includes('auto_source')) {
    db.exec('ALTER TABLE transactions ADD COLUMN auto_source TEXT DEFAULT NULL;');
  }
  if (!cols.includes('exclude_from_analytics')) {
    db.exec('ALTER TABLE transactions ADD COLUMN exclude_from_analytics INTEGER NOT NULL DEFAULT 0;');
  }
  if (!cols.includes('is_hidden')) {
    db.exec('ALTER TABLE transactions ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;');
  }
  if (!cols.includes('is_recurring')) {
    db.exec('ALTER TABLE transactions ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0;');
  }
  if (!cols.includes('store_address')) {
    db.exec("ALTER TABLE transactions ADD COLUMN store_address TEXT DEFAULT '';");
  }
  if (!cols.includes('pocket_balance_before')) {
    db.exec('ALTER TABLE transactions ADD COLUMN pocket_balance_before REAL;');
  }
  if (!cols.includes('account_balance_before')) {
    db.exec('ALTER TABLE transactions ADD COLUMN account_balance_before REAL;');
  }
  if (!cols.includes('dest_pocket_balance_before')) {
    db.exec('ALTER TABLE transactions ADD COLUMN dest_pocket_balance_before REAL;');
  }
  if (!cols.includes('dest_account_balance_before')) {
    db.exec('ALTER TABLE transactions ADD COLUMN dest_account_balance_before REAL;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_needs_approval ON transactions(needs_approval);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_props ON transactions(is_hidden, exclude_from_analytics, is_recurring);');

  const accountCols = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  if (!accountCols.includes('is_archived')) {
    db.exec('ALTER TABLE accounts ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;');
  }
  const pocketCols = db.prepare('PRAGMA table_info(pockets)').all().map((c) => c.name);
  if (!pocketCols.includes('is_archived')) {
    db.exec('ALTER TABLE pockets ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;');
  }

  // Migrate any legacy pockets whose current_balance came from recorded historical checkpoints
  // without any live transactions so flag-based recalculation preserves their balance.
  db.exec(`
    UPDATE pockets
    SET initial_balance = current_balance
    WHERE initial_balance = 0
      AND current_balance != 0
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE (t.pocket_id = pockets.id OR t.dest_pocket_id = pockets.id)
          AND t.is_historical = 0
      );

    UPDATE transactions
    SET recorded_pocket_balance_after = NULL,
        recorded_dest_pocket_balance_after = NULL
    WHERE recorded_pocket_balance_after IS NOT NULL
       OR recorded_dest_pocket_balance_after IS NOT NULL;

    DELETE FROM counterparties
    WHERE LOWER(TRIM(REPLACE(REPLACE(name, '!', ''), '.', ''))) IN (
      'sikeres vásárlás',
      'sikeres online vásárlás',
      'sikeres fizetés',
      'kártyás vásárlás',
      'bankkártyás vásárlás',
      'kártyás fizetés',
      'azonnali átutalás',
      'beérkező utalás'
    );
  `);
}

function seedDefaults(db) {
  const defaultSettings = [
    ['base_currency', 'HUF'],
    ['gemini_api_key', process.env.GEMINI_API_KEY || ''],
    ['gemini_model', process.env.GEMINI_MODEL || 'gemini-4-hydrogen'],
    ['fx_rates', JSON.stringify(DEFAULT_FX_RATES)],
    ['notification_webhook_token', crypto.randomBytes(16).toString('hex')],
    ['session_timeout_minutes', '10'],
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaultSettings) {
    insertSetting.run(k, v);
  }

  // Migrate deprecated Gemini 1.x / 2.x model defaults to gemini-4-hydrogen
  db.prepare(
    "UPDATE settings SET value = 'gemini-4-hydrogen' WHERE key = 'gemini_model' AND (value LIKE 'gemini-2.%' OR value LIKE 'gemini-1.%' OR value = '')"
  ).run();

  const accountCount = db.prepare('SELECT COUNT(*) AS cnt FROM accounts').get().cnt;
  if (accountCount === 0) {
    const insertAccount = db.prepare(
      'INSERT INTO accounts (name, slug, currency, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertPocket = db.prepare(
      'INSERT INTO pockets (account_id, name, currency, initial_balance, current_balance, color, icon, is_default) VALUES (?, ?, ?, 0, 0, ?, ?, ?)'
    );

    const mainBankId = insertAccount.run('Main Bank', 'main-bank', 'HUF', '#3b82f6', 'landmark', 1).lastInsertRowid;
    insertPocket.run(mainBankId, 'Main', 'HUF', '#3b82f6', 'wallet', 1);
    insertPocket.run(mainBankId, 'Savings', 'HUF', '#10b981', 'piggy-bank', 0);
  }

  const seedCategories = [
    // Income
    ['Work / Salary', 'income', 'briefcase', '#10b981', 'Work income credited{merchant} ({account} · {pocket})'],
    ['Scholarship', 'income', 'graduation-cap', '#06b6d4', 'Scholarship payment received{merchant} ({account} · {pocket})'],
    ['Family & Gifts', 'income', 'gift', '#8b5cf6', 'Family support / gift received{merchant} ({account} · {pocket})'],
    ['Other Income', 'income', 'plus-circle', '#22c55e', 'Income received{merchant} ({account} · {pocket})'],
    // Expense
    ['Shopping', 'expense', 'shopping-bag', '#f59e0b', 'General shopping{merchant} ({account} · {pocket})'],
    ['Tech & Electronics', 'expense', 'cpu', '#6366f1', 'Tech & electronics purchase{merchant} ({account} · {pocket})'],
    ['Fuel & Transport', 'expense', 'fuel', '#ef4444', 'Fueling up / transport expense{merchant} ({account} · {pocket})'],
    ['University & Dorm', 'expense', 'graduation-cap', '#0ea5e9', 'University / dorm expense{merchant} ({account} · {pocket})'],
    ['Food & Dining', 'expense', 'utensils', '#f97316', 'Food & dining{merchant} ({account} · {pocket})'],
    ['Bills & Subscriptions', 'expense', 'receipt', '#64748b', 'Bills & subscription payment{merchant} ({account} · {pocket})'],
    ['Entertainment', 'expense', 'film', '#ec4899', 'Entertainment & leisure{merchant} ({account} · {pocket})'],
    ['Health & Fitness', 'expense', 'heart-pulse', '#14b8a6', 'Health & fitness expense{merchant} ({account} · {pocket})'],
    ['Other Expense', 'expense', 'tag', '#94a3b8', 'General expense{merchant} ({account} · {pocket})'],
    // Transfer (3rd top-level category)
    ['Bank-to-Bank Transfer', 'transfer', 'arrow-left-right', '#3b82f6', 'Bank transfer from {account} ({pocket}) to {destAccount} ({destPocket})'],
    ['Pocket-to-Pocket Transfer', 'transfer', 'repeat', '#0ea5e9', 'Pocket transfer from {account} ({pocket}) to {destAccount} ({destPocket})'],
    ['Savings / Set Aside', 'transfer', 'piggy-bank', '#6366f1', 'Set aside from {account} ({pocket}) into {destAccount} ({destPocket})'],
    ['Pocket Reimbursement', 'transfer', 'rotate-ccw', '#14b8a6', 'Reimbursed {destAccount} ({destPocket}) from {account} ({pocket})'],
    ['Internal Transfer', 'transfer', 'arrow-left-right', '#38bdf8', 'Transfer from {account} ({pocket}) to {destAccount} ({destPocket})'],
  ];

  const categoryCount = db.prepare('SELECT COUNT(*) AS cnt FROM categories').get().cnt;
  if (categoryCount === 0) {
    const insertCat = db.prepare(
      'INSERT INTO categories (name, type, icon, color, auto_note_template) VALUES (?, ?, ?, ?, ?)'
    );
    for (const row of seedCategories) {
      insertCat.run(...row);
    }
  }
}

function seedCounterpartiesFromTransactions(db) {
  if (getSetting(db, 'counterparties_seeded', '0') === '1') return;

  const now = new Date().toISOString();

  const upsert = db.prepare(`
    INSERT INTO counterparties (name, direction, default_category_id, use_count, last_used_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name, direction) DO UPDATE SET
      use_count = MAX(counterparties.use_count, excluded.use_count),
      last_used_at = CASE WHEN excluded.last_used_at > counterparties.last_used_at THEN excluded.last_used_at ELSE counterparties.last_used_at END,
      default_category_id = COALESCE(excluded.default_category_id, counterparties.default_category_id)
  `);

  const txRows = db
    .prepare(
      `SELECT type, TRIM(merchant) AS name, category_id, MAX(date) AS last_date, COUNT(*) AS cnt
       FROM transactions
       WHERE type IN ('income', 'expense')
         AND TRIM(merchant) NOT IN ('', '?')
       GROUP BY type, TRIM(merchant) COLLATE NOCASE`
    )
    .all();

  for (const r of txRows) {
    const dir = r.type === 'income' ? 'in' : 'out';
    upsert.run(r.name, dir, r.category_id, r.cnt, r.last_date || now);
  }

  setSetting(db, 'counterparties_seeded', '1');
}

function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value)
  );
}

function getFxRates(db) {
  return parseFxRates(getSetting(db, 'fx_rates'));
}

module.exports = {
  initDatabase,
  seedCounterpartiesFromTransactions,
  getSetting,
  setSetting,
  getFxRates,
};
