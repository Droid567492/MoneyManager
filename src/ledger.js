'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getFxRates, getSetting, setSetting } = require('./db');
const { convertCurrency, normalizeCurrency, roundCurrency } = require('./fx');

function formatItemAmountText(price, currency = 'HUF') {
  const num = Number(price);
  if (!Number.isFinite(num) || num <= 0) return '';
  const cur = String(currency || 'HUF').trim().toUpperCase();
  const formatted =
    cur === 'HUF' || Math.abs(num - Math.round(num)) < 0.005
      ? Math.round(num).toLocaleString('en-US')
      : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur ? `${formatted} ${cur}` : formatted;
}

function formatReceiptItemText(it, currency = 'HUF') {
  if (typeof it === 'string') return it.trim();
  if (!it || typeof it.name !== 'string' || !it.name.trim()) return '';
  const name = it.name.trim();
  const qty = Number(it.qty);
  const qtyPart = Number.isFinite(qty) && qty > 1 ? ` x${qty}` : '';
  const amtPart = formatItemAmountText(it.price, currency);
  return amtPart ? `${name}${qtyPart} (${amtPart})` : `${name}${qtyPart}`;
}

function buildReceiptDetailsFragment({ items, storeAddress, currency }) {
  const itemEntries = Array.isArray(items)
    ? items.map((it) => formatReceiptItemText(it, currency)).filter(Boolean)
    : [];
  const cleanAddress = typeof storeAddress === 'string' ? storeAddress.trim() : '';
  const parts = [];
  if (itemEntries.length > 0) {
    const maxItems = 25;
    const listed = itemEntries.slice(0, maxItems).join(', ');
    const extra = itemEntries.length > maxItems ? ` (+${itemEntries.length - maxItems} more)` : '';
    parts.push(`${listed}${extra}`);
  }
  if (cleanAddress) {
    parts.push(`Address: ${cleanAddress}`);
  }
  return parts.join(' | ');
}

function buildReceiptAutoNote({ categoryName, merchant, items, storeAddress, currency }) {
  const cleanMerchant = typeof merchant === 'string' ? merchant.trim() : '';
  const cleanCategory = typeof categoryName === 'string' && categoryName.trim() ? categoryName.trim() : 'Shopping';
  const cleanAddress = typeof storeAddress === 'string' ? storeAddress.trim() : '';
  const itemEntries = Array.isArray(items)
    ? items.map((it) => formatReceiptItemText(it, currency)).filter(Boolean)
    : [];

  const prefix = cleanMerchant ? `${cleanCategory} at ${cleanMerchant}` : cleanCategory;
  let note = prefix;
  if (itemEntries.length > 0) {
    const maxItems = 25;
    const listed = itemEntries.slice(0, maxItems).join(', ');
    const extra = itemEntries.length > maxItems ? ` (+${itemEntries.length - maxItems} more)` : '';
    note = `${prefix}: ${listed}${extra}`;
  }
  if (cleanAddress) {
    note = `${note} | Address: ${cleanAddress}`;
  }
  return note;
}

function expandNoteWithReceiptDetails({ existingNote, items, storeAddress, currency, merchant, categoryName, receiptAutoNote }) {
  const base = typeof existingNote === 'string' ? existingNote.trim() : '';
  const details = buildReceiptDetailsFragment({ items, storeAddress, currency });
  if (!base) {
    if (details) return buildReceiptAutoNote({ categoryName, merchant, items, storeAddress, currency });
    return typeof receiptAutoNote === 'string' ? receiptAutoNote.trim() : '';
  }
  if (!details) {
    const fallback = typeof receiptAutoNote === 'string' ? receiptAutoNote.trim() : '';
    if (!fallback || base.toLowerCase().includes(fallback.toLowerCase())) return base;
    return `${base} | ${fallback}`;
  }
  if (base.toLowerCase().includes(details.toLowerCase())) return base;
  return `${base} | ${details}`;
}

/**
 * Generate a descriptive note automatically when the user leaves the note blank
 * (or uses receipt scanning). Preserves manual notes intact.
 */
function ensureTransactionNote({
  note,
  noteSource,
  type,
  categoryName,
  categoryTemplate,
  merchant,
  accountName,
  pocketName,
  destAccountName,
  destPocketName,
  items,
  storeAddress,
  currency,
  receiptAutoNote,
}) {
  const trimmed = typeof note === 'string' ? note.trim() : '';
  if (trimmed) {
    return {
      note: trimmed,
      noteSource: noteSource === 'auto' || noteSource === 'import' ? noteSource : 'manual',
    };
  }

  const cleanMerchant = typeof merchant === 'string' ? merchant.trim() : '';
  const cleanAddress = typeof storeAddress === 'string' ? storeAddress.trim() : '';
  const itemEntries = Array.isArray(items)
    ? items.map((it) => formatReceiptItemText(it, currency)).filter(Boolean)
    : [];

  if (itemEntries.length > 0 || cleanAddress) {
    const firstName =
      itemEntries.length > 0
        ? String(typeof items[0] === 'string' ? items[0] : items[0]?.name || '').trim().toLowerCase()
        : '';
    if (receiptAutoNote && typeof receiptAutoNote === 'string' && receiptAutoNote.trim()) {
      const rTrim = receiptAutoNote.trim();
      const hasAddress = !cleanAddress || rTrim.toLowerCase().includes(cleanAddress.toLowerCase());
      const firstAmt = itemEntries.length > 0 ? formatItemAmountText(items[0]?.price, currency) : '';
      const hasFirstAmt = !firstAmt || rTrim.toLowerCase().includes(firstAmt.toLowerCase());
      if (firstName && rTrim.toLowerCase().includes(firstName) && hasAddress && hasFirstAmt && !/\(\+\d+\s+more\)/i.test(rTrim)) {
        return { note: rTrim, noteSource: 'auto' };
      }
    }
    return {
      note: buildReceiptAutoNote({
        categoryName,
        merchant: cleanMerchant,
        items,
        storeAddress: cleanAddress,
        currency,
      }),
      noteSource: 'auto',
    };
  }

  if (receiptAutoNote && typeof receiptAutoNote === 'string' && receiptAutoNote.trim()) {
    return { note: receiptAutoNote.trim(), noteSource: 'auto' };
  }

  if (type === 'transfer') {
    const src = `${accountName || 'Account'} (${pocketName || 'Pocket'})`;
    const dst = `${destAccountName || 'Account'} (${destPocketName || 'Pocket'})`;
    return { note: `Transfer from ${src} to ${dst}`, noteSource: 'auto' };
  }

  if (type === 'adjustment') {
    return {
      note: `Live balance synced on ${accountName || 'Account'} · ${pocketName || 'Pocket'}`,
      noteSource: 'auto',
    };
  }

  if (categoryTemplate) {
    const merchantPart = cleanMerchant
      ? type === 'income'
        ? ` from ${cleanMerchant}`
        : ` at ${cleanMerchant}`
      : '';
    const filled = categoryTemplate
      .replace('{merchant}', merchantPart)
      .replace('{account}', accountName || '')
      .replace('{pocket}', pocketName || '')
      .replace('{destAccount}', destAccountName || '')
      .replace('{destPocket}', destPocketName || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (filled) {
      return { note: filled, noteSource: 'auto' };
    }
  }

  const fallbackVerb = type === 'income' ? 'received' : 'logged';
  const loc = cleanMerchant ? ` (${cleanMerchant})` : '';
  return {
    note: `${categoryName || 'Transaction'} ${fallbackVerb}${loc} (${accountName || ''} · ${pocketName || ''})`.trim(),
    noteSource: 'auto',
  };
}

/**
 * Deterministically recalculate pocket_balance_after and account_balance_after
 * for EVERY transaction in chronological order (date ASC, id ASC),
 * and update pockets.current_balance.
 */
function recalculateAllBalances(db, fxRatesOverride = null, { insideTx = false } = {}) {
  const fxRates = fxRatesOverride || getFxRates(db);

  const work = () => {
    const accounts = db.prepare('SELECT id, name, currency FROM accounts').all();
    const pockets = db.prepare('SELECT id, account_id, name, currency, initial_balance FROM pockets').all();

    const accountMap = new Map();
    const accountPocketsMap = new Map();
    for (const acc of accounts) {
      accountMap.set(acc.id, acc);
      accountPocketsMap.set(acc.id, []);
    }

    const pocketMap = new Map();
    const pocketBalances = new Map();

    for (const p of pockets) {
      pocketMap.set(p.id, p);
      const initBal = roundCurrency(Number(p.initial_balance) || 0, p.currency);
      pocketBalances.set(p.id, initBal);
      if (accountPocketsMap.has(p.account_id)) {
        accountPocketsMap.get(p.account_id).push(p);
      }
    }

    const computeAccountTotal = (accountId) => {
      const acc = accountMap.get(accountId);
      if (!acc) return 0;
      const list = accountPocketsMap.get(accountId) || [];
      let sum = 0;
      for (const p of list) {
        const bal = pocketBalances.get(p.id) || 0;
        sum += convertCurrency(bal, p.currency, acc.currency, fxRates);
      }
      return roundCurrency(sum, acc.currency);
    };

    const transactions = db
      .prepare(
        `SELECT id, date, type, amount, currency, account_id, pocket_id,
                dest_account_id, dest_pocket_id, dest_amount,
                is_historical
         FROM transactions
         ORDER BY date ASC, id ASC`
      )
      .all();

    const updateTxStmt = db.prepare(
      `UPDATE transactions
       SET pocket_balance_before = ?,
           account_balance_before = ?,
           dest_pocket_balance_before = ?,
           dest_account_balance_before = ?,
           pocket_balance_after = ?,
           account_balance_after = ?,
           dest_pocket_balance_after = ?,
           dest_account_balance_after = ?
       WHERE id = ?`
    );

    for (const tx of transactions) {
      const srcPocket = pocketMap.get(tx.pocket_id);
      if (!srcPocket) continue;

      if (tx.is_historical === 1) {
        updateTxStmt.run(null, null, null, null, null, null, null, null, tx.id);
        continue;
      }

      const amt = Number(tx.amount) || 0;
      const dstPocket = tx.type === 'transfer' && tx.dest_pocket_id ? pocketMap.get(tx.dest_pocket_id) : null;

      const prevSrcPocketBal = pocketBalances.get(tx.pocket_id) || 0;
      const prevSrcAccountBal = computeAccountTotal(tx.account_id);
      const prevDstPocketBal = dstPocket ? pocketBalances.get(dstPocket.id) || 0 : null;
      const prevDstAccountBal = dstPocket ? computeAccountTotal(dstPocket.account_id) : null;

      if (tx.type === 'income') {
        pocketBalances.set(tx.pocket_id, roundCurrency(prevSrcPocketBal + amt, srcPocket.currency));
      } else if (tx.type === 'expense') {
        pocketBalances.set(tx.pocket_id, roundCurrency(prevSrcPocketBal - amt, srcPocket.currency));
      } else if (tx.type === 'adjustment') {
        pocketBalances.set(tx.pocket_id, roundCurrency(amt, srcPocket.currency));
      } else if (tx.type === 'transfer') {
        pocketBalances.set(tx.pocket_id, roundCurrency(prevSrcPocketBal - amt, srcPocket.currency));
        if (dstPocket) {
          const transferCredit =
            tx.dest_amount !== null && tx.dest_amount !== undefined
              ? Number(tx.dest_amount)
              : convertCurrency(amt, srcPocket.currency, dstPocket.currency, fxRates);
          const curDstBal = pocketBalances.get(dstPocket.id) || 0;
          pocketBalances.set(dstPocket.id, roundCurrency(curDstBal + transferCredit, dstPocket.currency));
        }
      }

      const pocketBalAfter = pocketBalances.get(tx.pocket_id) ?? null;
      const accountBalAfter = computeAccountTotal(tx.account_id);
      const destPocketBalAfter = dstPocket ? pocketBalances.get(dstPocket.id) ?? null : null;
      const destAccountBalAfter = dstPocket ? computeAccountTotal(dstPocket.account_id) : null;

      updateTxStmt.run(
        prevSrcPocketBal,
        prevSrcAccountBal,
        prevDstPocketBal,
        prevDstAccountBal,
        pocketBalAfter,
        accountBalAfter,
        destPocketBalAfter,
        destAccountBalAfter,
        tx.id
      );
    }

    const updatePocketStmt = db.prepare('UPDATE pockets SET current_balance = ? WHERE id = ?');
    for (const p of pockets) {
      updatePocketStmt.run(pocketBalances.get(p.id) || 0, p.id);
    }
  };

  if (insideTx) {
    work();
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    work();
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}

/**
 * Local YYYY-MM-DD and YYYY-MM-DDTHH:mm helpers (respects Raspberry Pi local timezone).
 */
function getLocalIsoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getLocalIsoDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${getLocalIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Normalize date input to YYYY-MM-DD or YYYY-MM-DDTHH:mm
 */
function normalizeTxDate(input) {
  if (!input || typeof input !== 'string') {
    return getLocalIsoDateTime();
  }
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return s.slice(0, 16);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return getLocalIsoDateTime(parsed);
  }
  return getLocalIsoDateTime();
}

/**
 * Create a transaction and recalculate balances.
 */
function createTransaction(db, input) {
  const fxRates = getFxRates(db);
  const type = String(input.type || 'expense').toLowerCase();
  if (!['income', 'expense', 'transfer', 'adjustment'].includes(type)) {
    throw new Error(`Invalid transaction type: ${type}`);
  }

  const pocket = db
    .prepare(
      `SELECT p.*, a.name AS account_name, a.currency AS account_currency
       FROM pockets p
       JOIN accounts a ON a.id = p.account_id
       WHERE p.id = ?`
    )
    .get(Number(input.pocketId || input.pocket_id));
  if (!pocket) {
    throw new Error('Source pocket not found.');
  }

  let amount = Number(input.amount);
  if (!Number.isFinite(amount) || (type !== 'adjustment' && amount <= 0)) {
    throw new Error('Amount must be a positive number.');
  }

  // Convert if caller specifies a receipt currency different from the pocket's currency
  const inputCurrency = normalizeCurrency(input.currency || pocket.currency, pocket.currency);
  if (inputCurrency !== pocket.currency && type !== 'adjustment') {
    amount = convertCurrency(amount, inputCurrency, pocket.currency, fxRates);
  }
  amount = roundCurrency(amount, pocket.currency);

  let destPocket = null;
  let destAmount = null;
  if (type === 'transfer') {
    destPocket = db
      .prepare(
        `SELECT p.*, a.name AS account_name, a.currency AS account_currency
         FROM pockets p
         JOIN accounts a ON a.id = p.account_id
         WHERE p.id = ?`
      )
      .get(Number(input.destPocketId || input.dest_pocket_id));
    if (!destPocket) {
      throw new Error('Destination pocket not found for transfer.');
    }
    if (destPocket.id === pocket.id) {
      throw new Error('Source and destination pockets must be different.');
    }
    if (input.destAmount !== undefined && input.destAmount !== null && input.destAmount !== '') {
      const da = Number(input.destAmount);
      if (!Number.isFinite(da) || da <= 0) {
        throw new Error('Destination amount must be positive.');
      }
      destAmount = roundCurrency(da, destPocket.currency);
    } else {
      destAmount = convertCurrency(amount, pocket.currency, destPocket.currency, fxRates);
    }
  }

  let category = null;
  if (input.categoryId || input.category_id) {
    category = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(input.categoryId || input.category_id));
  }
  if (!category && input.categoryName) {
    category = db
      .prepare('SELECT * FROM categories WHERE LOWER(name) = LOWER(?)')
      .get(String(input.categoryName).trim());
  }
  if (!category) {
    const defaultCatName =
      type === 'income'
        ? 'Other Income'
        : type === 'transfer'
        ? 'Internal Transfer'
        : type === 'adjustment'
        ? 'Balance Sync'
        : 'Other Expense';
    category = db.prepare('SELECT * FROM categories WHERE name = ?').get(defaultCatName);
  }

  const categoryId = category ? category.id : null;
  const categoryName =
    type === 'adjustment'
      ? 'Balance Sync'
      : category
      ? category.name
      : String(input.categoryName || 'Other Expense').trim();

  const items = Array.isArray(input.items) ? input.items : [];
  const storeAddress =
    typeof (input.storeAddress ?? input.store_address) === 'string'
      ? String(input.storeAddress ?? input.store_address).trim()
      : '';
  const { note, noteSource } = ensureTransactionNote({
    note: input.note,
    noteSource: input.noteSource || input.note_source,
    type,
    categoryName,
    categoryTemplate: category?.auto_note_template || '',
    merchant: input.merchant || '',
    accountName: pocket.account_name,
    pocketName: pocket.name,
    destAccountName: destPocket?.account_name || '',
    destPocketName: destPocket?.name || '',
    items,
    storeAddress,
    currency: pocket.currency,
    receiptAutoNote: input.receiptAutoNote || '',
  });

  const date = normalizeTxDate(input.date);
  const now = new Date().toISOString();

  const isHistorical = type === 'adjustment' ? 0 : input.isHistorical || input.is_historical ? 1 : 0;
  const needsApproval = input.needsApproval || input.needs_approval ? 1 : 0;
  const excludeFromAnalytics = input.excludeFromAnalytics || input.exclude_from_analytics ? 1 : 0;
  const isRecurring = input.isRecurring || input.is_recurring ? 1 : 0;
  const autoSourceRaw = input.autoSource ?? input.auto_source ?? null;
  const autoSource = autoSourceRaw ? String(autoSourceRaw).trim() : null;

  let newId;
  db.exec('BEGIN IMMEDIATE');
  try {
    const cleanMerchant = String(input.merchant || '').trim();
    const res = db
      .prepare(
        `INSERT INTO transactions (
          date, type, amount, currency, account_id, pocket_id,
          dest_account_id, dest_pocket_id, dest_amount,
          category_id, category_name, merchant, note, note_source,
          items_json, receipt_path, store_address, is_historical, needs_approval, auto_source,
          exclude_from_analytics, is_recurring, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        date,
        type,
        amount,
        pocket.currency,
        pocket.account_id,
        pocket.id,
        destPocket ? destPocket.account_id : null,
        destPocket ? destPocket.id : null,
        destAmount,
        categoryId,
        categoryName,
        cleanMerchant,
        note,
        noteSource,
        JSON.stringify(items),
        input.receiptPath || input.receipt_path || null,
        storeAddress,
        isHistorical,
        needsApproval,
        autoSource,
        excludeFromAnalytics,
        isRecurring,
        now
      );
    newId = Number(res.lastInsertRowid);
    if ((type === 'income' || type === 'expense') && cleanMerchant) {
      upsertCounterparty(db, cleanMerchant, type === 'income' ? 'in' : 'out', categoryId);
    }
    recalculateAllBalances(db, fxRates, { insideTx: true });
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  return getTransactionById(db, newId);
}

function getTransactionById(db, id) {
  return db
    .prepare(
      `SELECT t.*,
              a.name AS account_name, a.color AS account_color, a.currency AS account_currency,
              p.name AS pocket_name, p.color AS pocket_color, p.currency AS pocket_currency,
              da.name AS dest_account_name, da.color AS dest_account_color, da.currency AS dest_account_currency,
              dp.name AS dest_pocket_name, dp.color AS dest_pocket_color, dp.currency AS dest_pocket_currency,
              c.icon AS category_icon, c.color AS category_color
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       JOIN pockets p ON p.id = t.pocket_id
       LEFT JOIN accounts da ON da.id = t.dest_account_id
       LEFT JOIN pockets dp ON dp.id = t.dest_pocket_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id = ?`
    )
    .get(Number(id));
}

function updateTransaction(db, id, patch) {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(id));
  if (!existing) {
    throw new Error('Transaction not found.');
  }

  const fxRates = getFxRates(db);
  const type = patch.type ? String(patch.type).toLowerCase() : existing.type;
  if (!['income', 'expense', 'transfer', 'adjustment'].includes(type)) {
    throw new Error('Invalid transaction type.');
  }

  const pocketId = Number(patch.pocketId || patch.pocket_id || existing.pocket_id);
  const pocket = db
    .prepare(
      `SELECT p.*, a.name AS account_name
       FROM pockets p JOIN accounts a ON a.id = p.account_id
       WHERE p.id = ?`
    )
    .get(pocketId);
  if (!pocket) throw new Error('Pocket not found.');

  let amount = patch.amount !== undefined ? Number(patch.amount) : existing.amount;
  if (!Number.isFinite(amount) || (type !== 'adjustment' && amount <= 0)) {
    throw new Error('Amount must be positive.');
  }
  amount = roundCurrency(amount, pocket.currency);

  let destPocket = null;
  let destAmount = existing.dest_amount;
  if (type === 'transfer') {
    const destId = Number(patch.destPocketId || patch.dest_pocket_id || existing.dest_pocket_id);
    destPocket = db
      .prepare(
        `SELECT p.*, a.name AS account_name
         FROM pockets p JOIN accounts a ON a.id = p.account_id
         WHERE p.id = ?`
      )
      .get(destId);
    if (!destPocket || destPocket.id === pocket.id) {
      throw new Error('Valid destination pocket required for transfer.');
    }
    if (patch.destAmount !== undefined && patch.destAmount !== null && patch.destAmount !== '') {
      destAmount = roundCurrency(Number(patch.destAmount), destPocket.currency);
    } else if (patch.amount !== undefined || patch.pocketId !== undefined || patch.destPocketId !== undefined) {
      destAmount = convertCurrency(amount, pocket.currency, destPocket.currency, fxRates);
    }
  } else {
    destAmount = null;
  }

  let category = null;
  if (patch.categoryId !== undefined || patch.category_id !== undefined) {
    category = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(patch.categoryId ?? patch.category_id));
  } else if (patch.categoryName) {
    category = db
      .prepare('SELECT * FROM categories WHERE LOWER(name) = LOWER(?)')
      .get(String(patch.categoryName).trim());
  } else if (existing.category_id) {
    category = db.prepare('SELECT * FROM categories WHERE id = ?').get(existing.category_id);
  }

  const categoryId = category ? category.id : existing.category_id;
  const categoryName = category ? category.name : patch.categoryName || existing.category_name;
  const merchant = patch.merchant !== undefined ? String(patch.merchant).trim() : existing.merchant;
  const date = patch.date !== undefined ? normalizeTxDate(patch.date) : existing.date;
  const items = patch.items !== undefined ? patch.items : JSON.parse(existing.items_json || '[]');
  const receiptPath =
    patch.receiptPath !== undefined || patch.receipt_path !== undefined
      ? patch.receiptPath || patch.receipt_path || null
      : existing.receipt_path;
  const storeAddress =
    patch.storeAddress !== undefined || patch.store_address !== undefined
      ? String(patch.storeAddress ?? patch.store_address ?? '').trim()
      : String(existing.store_address || '').trim();

  let finalNote = existing.note;
  let finalNoteSource = existing.note_source;
  if (patch.expandWithReceipt) {
    finalNote = expandNoteWithReceiptDetails({
      existingNote: existing.note,
      items,
      storeAddress,
      currency: pocket.currency,
      merchant,
      categoryName,
      receiptAutoNote: patch.receiptAutoNote || '',
    });
    finalNoteSource = existing.note_source === 'manual' ? 'manual' : 'auto';
  } else if (patch.note !== undefined) {
    const ensured = ensureTransactionNote({
      note: patch.note,
      noteSource: patch.noteSource,
      type,
      categoryName,
      categoryTemplate: category?.auto_note_template || '',
      merchant,
      accountName: pocket.account_name,
      pocketName: pocket.name,
      destAccountName: destPocket?.account_name || '',
      destPocketName: destPocket?.name || '',
      items,
      storeAddress,
      currency: pocket.currency,
      receiptAutoNote: patch.receiptAutoNote || '',
    });
    finalNote = ensured.note;
    finalNoteSource = ensured.noteSource;
  } else if (
    (patch.items !== undefined || patch.receiptAutoNote !== undefined || patch.storeAddress !== undefined) &&
    existing.note_source !== 'manual'
  ) {
    const ensured = ensureTransactionNote({
      note: '',
      noteSource: 'auto',
      type,
      categoryName,
      categoryTemplate: category?.auto_note_template || '',
      merchant,
      accountName: pocket.account_name,
      pocketName: pocket.name,
      destAccountName: destPocket?.account_name || '',
      destPocketName: destPocket?.name || '',
      items,
      storeAddress,
      currency: pocket.currency,
      receiptAutoNote: patch.receiptAutoNote || '',
    });
    finalNote = ensured.note;
    finalNoteSource = ensured.noteSource;
  }

  const isHistorical =
    type === 'adjustment'
      ? 0
      : patch.isHistorical !== undefined || patch.is_historical !== undefined
      ? (patch.isHistorical ?? patch.is_historical)
        ? 1
        : 0
      : existing.is_historical
      ? 1
      : 0;

  const needsApproval =
    patch.needsApproval !== undefined || patch.needs_approval !== undefined
      ? patch.needsApproval || patch.needs_approval
        ? 1
        : 0
      : existing.needs_approval;

  const excludeFromAnalytics =
    patch.excludeFromAnalytics !== undefined || patch.exclude_from_analytics !== undefined
      ? (patch.excludeFromAnalytics ?? patch.exclude_from_analytics)
        ? 1
        : 0
      : existing.exclude_from_analytics
      ? 1
      : 0;

  const isHidden =
    patch.isHidden !== undefined || patch.is_hidden !== undefined
      ? (patch.isHidden ?? patch.is_hidden)
        ? 1
        : 0
      : existing.is_hidden
      ? 1
      : 0;

  const isRecurring =
    patch.isRecurring !== undefined || patch.is_recurring !== undefined
      ? (patch.isRecurring ?? patch.is_recurring)
        ? 1
        : 0
      : existing.is_recurring
      ? 1
      : 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE transactions
       SET date = ?, type = ?, amount = ?, currency = ?, account_id = ?, pocket_id = ?,
           dest_account_id = ?, dest_pocket_id = ?, dest_amount = ?,
           category_id = ?, category_name = ?, merchant = ?, note = ?, note_source = ?,
           items_json = ?, receipt_path = ?, store_address = ?, is_historical = ?, needs_approval = ?,
           exclude_from_analytics = ?, is_hidden = ?, is_recurring = ?
       WHERE id = ?`
    ).run(
      date,
      type,
      amount,
      pocket.currency,
      pocket.account_id,
      pocket.id,
      destPocket ? destPocket.account_id : null,
      destPocket ? destPocket.id : null,
      destAmount,
      categoryId,
      categoryName,
      merchant,
      finalNote,
      finalNoteSource,
      JSON.stringify(items),
      receiptPath,
      storeAddress,
      isHistorical,
      needsApproval,
      excludeFromAnalytics,
      isHidden,
      isRecurring,
      existing.id
    );
    const merchantChanged =
      patch.merchant !== undefined &&
      merchant.toLowerCase() !== String(existing.merchant || '').trim().toLowerCase();
    if ((type === 'income' || type === 'expense') && merchant && merchantChanged) {
      upsertCounterparty(db, merchant, type === 'income' ? 'in' : 'out', categoryId);
    }
    recalculateAllBalances(db, fxRates, { insideTx: true });
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  return getTransactionById(db, existing.id);
}

function deleteTransaction(db, id) {
  const existing = db.prepare('SELECT id FROM transactions WHERE id = ?').get(Number(id));
  if (!existing) throw new Error('Transaction not found.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(existing.id);
    recalculateAllBalances(db, null, { insideTx: true });
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}

function approveTransaction(db, id) {
  const existing = db.prepare('SELECT id FROM transactions WHERE id = ?').get(Number(id));
  if (!existing) throw new Error('Transaction not found.');
  db.prepare('UPDATE transactions SET needs_approval = 0 WHERE id = ?').run(existing.id);
  return getTransactionById(db, existing.id);
}

function approveAllTransactions(db, ids = null) {
  if (Array.isArray(ids) && ids.length > 0) {
    const cleanIds = ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
    if (cleanIds.length === 0) return { approvedCount: 0 };
    const placeholders = cleanIds.map(() => '?').join(',');
    const res = db
      .prepare(`UPDATE transactions SET needs_approval = 0 WHERE needs_approval = 1 AND id IN (${placeholders})`)
      .run(...cleanIds);
    return { approvedCount: Number(res.changes || 0) };
  }
  const res = db.prepare('UPDATE transactions SET needs_approval = 0 WHERE needs_approval = 1').run();
  return { approvedCount: Number(res.changes || 0) };
}

function bulkManageTransactions(db, { ids, action, categoryId = null, receiptsDir = null } = {}) {
  const cleanIds = Array.from(
    new Set((Array.isArray(ids) ? ids : []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))
  );
  if (cleanIds.length === 0) {
    const err = new Error('Please select at least one transaction.');
    err.statusCode = 400;
    throw err;
  }

  const placeholders = cleanIds.map(() => '?').join(',');
  const validActions = new Set([
    'delete',
    'hide',
    'unhide',
    'exclude_analytics',
    'include_analytics',
    'approve',
    'needs_approval',
    'mark_recurring',
    'unmark_recurring',
    'mark_live',
    'mark_historical',
    'set_category',
  ]);
  const act = String(action || '').trim();
  if (!validActions.has(act)) {
    const err = new Error(`Unsupported bulk action: ${act}`);
    err.statusCode = 400;
    throw err;
  }

  if (act === 'delete') {
    const receiptRows = db
      .prepare(`SELECT DISTINCT receipt_path FROM transactions WHERE receipt_path IS NOT NULL AND id IN (${placeholders})`)
      .all(...cleanIds);

    let affectedCount = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      const delRes = db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...cleanIds);
      affectedCount = Number(delRes.changes || 0);
      recalculateAllBalances(db, null, { insideTx: true });
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }

    if (receiptsDir) {
      for (const r of receiptRows) {
        if (!r.receipt_path) continue;
        const stillUsed = db
          .prepare('SELECT COUNT(*) AS cnt FROM transactions WHERE receipt_path = ?')
          .get(r.receipt_path).cnt;
        if (stillUsed === 0) {
          const safePath = path.join(receiptsDir, path.basename(r.receipt_path));
          if (fs.existsSync(safePath)) fs.unlinkSync(safePath);
        }
      }
    }

    return { ok: true, action: act, affectedCount };
  }

  if (act === 'mark_live' || act === 'mark_historical') {
    const targetHist = act === 'mark_historical' ? 1 : 0;
    let affectedCount = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      const updRes = db
        .prepare(`UPDATE transactions SET is_historical = ? WHERE type != 'adjustment' AND id IN (${placeholders})`)
        .run(targetHist, ...cleanIds);
      affectedCount = Number(updRes.changes || 0);
      recalculateAllBalances(db, null, { insideTx: true });
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
    return { ok: true, action: act, affectedCount };
  }

  if (act === 'set_category') {
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(categoryId));
    if (!cat) {
      const err = new Error('Category not found.');
      err.statusCode = 400;
      throw err;
    }
    const rows = db
      .prepare(
        `SELECT t.*, a.name AS account_name, p.name AS pocket_name,
                da.name AS dest_account_name, dp.name AS dest_pocket_name
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         JOIN pockets p ON p.id = t.pocket_id
         LEFT JOIN accounts da ON da.id = t.dest_account_id
         LEFT JOIN pockets dp ON dp.id = t.dest_pocket_id
         WHERE t.id IN (${placeholders})`
      )
      .all(...cleanIds);

    const matching = rows.filter((r) => r.type === cat.type);
    if (matching.length === 0) {
      const err = new Error(`None of the selected entries have type "${cat.type}" matching "${cat.name}".`);
      err.statusCode = 400;
      throw err;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const stmt = db.prepare('UPDATE transactions SET category_id = ?, category_name = ?, note = ?, note_source = ? WHERE id = ?');
      for (const tx of matching) {
        let nextNote = tx.note;
        let nextNoteSource = tx.note_source;
        if (tx.note_source === 'auto') {
          let parsedItems = [];
          try {
            parsedItems = JSON.parse(tx.items_json || '[]');
          } catch {
            parsedItems = [];
          }
          const ensured = ensureTransactionNote({
            note: '',
            noteSource: 'auto',
            type: tx.type,
            categoryName: cat.name,
            categoryTemplate: cat.auto_note_template || '',
            merchant: tx.merchant,
            accountName: tx.account_name,
            pocketName: tx.pocket_name,
            destAccountName: tx.dest_account_name || '',
            destPocketName: tx.dest_pocket_name || '',
            items: parsedItems,
          });
          nextNote = ensured.note;
          nextNoteSource = ensured.noteSource;
        }
        stmt.run(cat.id, cat.name, nextNote, nextNoteSource, tx.id);
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
    return { ok: true, action: act, affectedCount: matching.length };
  }

  const sqlByAction = {
    hide: `UPDATE transactions SET is_hidden = 1 WHERE id IN (${placeholders})`,
    unhide: `UPDATE transactions SET is_hidden = 0 WHERE id IN (${placeholders})`,
    exclude_analytics: `UPDATE transactions SET exclude_from_analytics = 1 WHERE id IN (${placeholders})`,
    include_analytics: `UPDATE transactions SET exclude_from_analytics = 0 WHERE id IN (${placeholders})`,
    approve: `UPDATE transactions SET needs_approval = 0 WHERE id IN (${placeholders})`,
    needs_approval: `UPDATE transactions SET needs_approval = 1 WHERE id IN (${placeholders})`,
    mark_recurring: `UPDATE transactions SET is_recurring = 1 WHERE id IN (${placeholders})`,
    unmark_recurring: `UPDATE transactions SET is_recurring = 0 WHERE id IN (${placeholders})`,
  };
  const res = db.prepare(sqlByAction[act]).run(...cleanIds);
  return { ok: true, action: act, affectedCount: Number(res.changes || 0) };
}

function sortLedgerTransactions(rows, sortKey = 'date_desc', fxRates = {}) {
  const key = String(sortKey || 'date_desc');
  if (key === 'date_desc') return rows;

  const list = [...rows];
  const cmpTie = (a, b) => b.date.localeCompare(a.date) || b.id - a.id;
  const cmpNumNullable = (va, vb, desc) => {
    const na = va !== null && va !== undefined && Number.isFinite(Number(va));
    const nb = vb !== null && vb !== undefined && Number.isFinite(Number(vb));
    if (!na && !nb) return 0;
    if (!na) return 1;
    if (!nb) return -1;
    return desc ? Number(vb) - Number(va) : Number(va) - Number(vb);
  };

  list.sort((a, b) => {
    switch (key) {
      case 'date_asc':
        return a.date.localeCompare(b.date) || a.id - b.id;
      case 'amount_desc': {
        const ha = convertCurrency(a.amount, a.currency, 'HUF', fxRates);
        const hb = convertCurrency(b.amount, b.currency, 'HUF', fxRates);
        return hb - ha || cmpTie(a, b);
      }
      case 'amount_asc': {
        const ha = convertCurrency(a.amount, a.currency, 'HUF', fxRates);
        const hb = convertCurrency(b.amount, b.currency, 'HUF', fxRates);
        return ha - hb || cmpTie(a, b);
      }
      case 'merchant_asc':
        return String(a.merchant || a.category_name || '').localeCompare(String(b.merchant || b.category_name || '')) || cmpTie(a, b);
      case 'merchant_desc':
        return String(b.merchant || b.category_name || '').localeCompare(String(a.merchant || a.category_name || '')) || cmpTie(a, b);
      case 'category_asc':
        return String(a.category_name || '').localeCompare(String(b.category_name || '')) || cmpTie(a, b);
      case 'category_desc':
        return String(b.category_name || '').localeCompare(String(a.category_name || '')) || cmpTie(a, b);
      case 'account_asc':
        return `${a.account_name} ${a.pocket_name}`.localeCompare(`${b.account_name} ${b.pocket_name}`) || cmpTie(a, b);
      case 'account_desc':
        return `${b.account_name} ${b.pocket_name}`.localeCompare(`${a.account_name} ${a.pocket_name}`) || cmpTie(a, b);
      case 'pocket_before_desc':
      case 'pocket_before_asc': {
        const va = a.pocket_balance_before != null ? convertCurrency(a.pocket_balance_before, a.currency, 'HUF', fxRates) : null;
        const vb = b.pocket_balance_before != null ? convertCurrency(b.pocket_balance_before, b.currency, 'HUF', fxRates) : null;
        return cmpNumNullable(va, vb, key === 'pocket_before_desc') || cmpTie(a, b);
      }
      case 'pocket_after_desc':
      case 'pocket_after_asc': {
        const va = a.pocket_balance_after != null ? convertCurrency(a.pocket_balance_after, a.currency, 'HUF', fxRates) : null;
        const vb = b.pocket_balance_after != null ? convertCurrency(b.pocket_balance_after, b.currency, 'HUF', fxRates) : null;
        return cmpNumNullable(va, vb, key === 'pocket_after_desc') || cmpTie(a, b);
      }
      case 'bank_before_desc':
      case 'bank_before_asc': {
        const va = a.account_balance_before != null ? convertCurrency(a.account_balance_before, a.account_currency, 'HUF', fxRates) : null;
        const vb = b.account_balance_before != null ? convertCurrency(b.account_balance_before, b.account_currency, 'HUF', fxRates) : null;
        return cmpNumNullable(va, vb, key === 'bank_before_desc') || cmpTie(a, b);
      }
      case 'bank_after_desc':
      case 'bank_after_asc': {
        const va = a.account_balance_after != null ? convertCurrency(a.account_balance_after, a.account_currency, 'HUF', fxRates) : null;
        const vb = b.account_balance_after != null ? convertCurrency(b.account_balance_after, b.account_currency, 'HUF', fxRates) : null;
        return cmpNumNullable(va, vb, key === 'bank_after_desc') || cmpTie(a, b);
      }
      default:
        return 0;
    }
  });
  return list;
}

/**
 * Sync or set a pocket's balance.
 * - mode === 'initial': sets initial_balance directly (ideal when no transactions exist or setting opening balance).
 * - mode === 'sync': inserts an explicit 'adjustment' transaction on `date` so historical imported data stays untouched
 *   and live tracking from today forward has the exact real-world balance.
 */
function syncPocketBalance(db, pocketId, targetBalance, { mode = 'auto', date = null, note = '' } = {}) {
  const pocket = db
    .prepare(
      `SELECT p.*, a.name AS account_name
       FROM pockets p JOIN accounts a ON a.id = p.account_id
       WHERE p.id = ?`
    )
    .get(Number(pocketId));
  if (!pocket) throw new Error('Pocket not found.');

  const num = roundCurrency(Number(targetBalance), pocket.currency);
  if (!Number.isFinite(num)) throw new Error('Invalid target balance.');

  const txCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM transactions WHERE pocket_id = ? OR dest_pocket_id = ?')
    .get(pocket.id, pocket.id).cnt;

  const resolvedMode = mode === 'auto' ? (txCount === 0 ? 'initial' : 'sync') : mode;

  if (resolvedMode === 'initial') {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE pockets SET initial_balance = ? WHERE id = ?').run(num, pocket.id);
      recalculateAllBalances(db, null, { insideTx: true });
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
    return { mode: 'initial', pocket: db.prepare('SELECT * FROM pockets WHERE id = ?').get(pocket.id) };
  }

  const syncDate = normalizeTxDate(date || getLocalIsoDateTime());
  const finalNote =
    note && note.trim()
      ? note.trim()
      : `Live balance anchored to ${num} ${pocket.currency} (${pocket.account_name} · ${pocket.name})`;

  db.prepare('UPDATE pockets SET live_anchor_balance = ?, live_anchor_date = ? WHERE id = ?').run(
    num,
    syncDate,
    pocket.id
  );

  const tx = createTransaction(db, {
    date: syncDate,
    type: 'adjustment',
    amount: num,
    currency: pocket.currency,
    pocketId: pocket.id,
    categoryName: 'Balance Sync',
    merchant: pocket.account_name,
    note: finalNote,
    noteSource: note && note.trim() ? 'manual' : 'auto',
    isHistorical: 0,
  });

  return { mode: 'sync', transaction: tx, pocket: db.prepare('SELECT * FROM pockets WHERE id = ?').get(pocket.id) };
}

/**
 * Aggregate full dashboard view: accounts, pockets, KPIs, SVG chart datasets, and filtered ledger rows.
 */
function getDashboardData(db, filters = {}) {
  const fxRates = getFxRates(db);
  const needsBeforeBackfill = db
    .prepare('SELECT 1 FROM transactions WHERE pocket_balance_after IS NOT NULL AND pocket_balance_before IS NULL LIMIT 1')
    .get();
  if (needsBeforeBackfill) {
    recalculateAllBalances(db, fxRates);
  }
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY is_archived ASC, sort_order ASC, id ASC').all();
  const pockets = db.prepare('SELECT * FROM pockets ORDER BY is_archived ASC, is_default DESC, id ASC').all();
  const categories = db.prepare('SELECT * FROM categories ORDER BY type ASC, id ASC').all();

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const pocketsByAccount = new Map();
  for (const acc of accounts) pocketsByAccount.set(acc.id, []);

  let totalNetWorthHuf = 0;
  const totalsByCurrency = {};

  for (const p of pockets) {
    const bal = Number(p.current_balance) || 0;
    const balHuf = convertCurrency(bal, p.currency, 'HUF', fxRates);
    p.balance_huf = balHuf;
    const parentAcc = accountById.get(p.account_id);
    if (!p.is_archived && parentAcc && !parentAcc.is_archived) {
      totalNetWorthHuf += balHuf;
      totalsByCurrency[p.currency] = roundCurrency((totalsByCurrency[p.currency] || 0) + bal, p.currency);
    }
    if (pocketsByAccount.has(p.account_id)) {
      pocketsByAccount.get(p.account_id).push(p);
    }
  }

  for (const acc of accounts) {
    const accPockets = pocketsByAccount.get(acc.id) || [];
    const activePockets = accPockets.filter((p) => !p.is_archived);
    let accTotal = 0;
    let accTotalHuf = 0;
    if (!acc.is_archived) {
      for (const p of activePockets) {
        accTotal += convertCurrency(p.current_balance, p.currency, acc.currency, fxRates);
        accTotalHuf += p.balance_huf;
      }
    }
    acc.pockets = accPockets;
    acc.active_pocket_count = activePockets.length;
    acc.archived_pocket_count = accPockets.length - activePockets.length;
    acc.total_balance = roundCurrency(accTotal, acc.currency);
    acc.total_balance_huf = roundCurrency(accTotalHuf, 'HUF');
  }

  totalNetWorthHuf = roundCurrency(totalNetWorthHuf, 'HUF');

  // Available months for month selector
  let monthQuery = 'SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions';
  if (filters.historical === 'live') {
    monthQuery += ' WHERE is_historical = 0';
  } else if (filters.historical === 'historical') {
    monthQuery += ' WHERE is_historical = 1';
  }
  monthQuery += ' ORDER BY month DESC';
  const monthRows = db.prepare(monthQuery).all();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const availableMonths = Array.from(new Set([currentMonth, ...monthRows.map((r) => r.month)])).sort((a, b) =>
    b.localeCompare(a)
  );

  // Selected month filter ('all' or 'YYYY-MM')
  const selectedMonth = filters.month || 'all';

  // Fetch all transactions joined with metadata for analytics & filtering
  const allTx = db
    .prepare(
      `SELECT t.*,
              a.name AS account_name, a.color AS account_color, a.currency AS account_currency, a.is_archived AS account_is_archived,
              p.name AS pocket_name, p.color AS pocket_color, p.currency AS pocket_currency,
              da.name AS dest_account_name, da.color AS dest_account_color, da.is_archived AS dest_account_is_archived,
              dp.name AS dest_pocket_name, dp.color AS dest_pocket_color,
              c.icon AS category_icon, c.color AS category_color
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       JOIN pockets p ON p.id = t.pocket_id
       LEFT JOIN accounts da ON da.id = t.dest_account_id
       LEFT JOIN pockets dp ON dp.id = t.dest_pocket_id
       LEFT JOIN categories c ON c.id = t.category_id
       ORDER BY t.date DESC, t.id DESC`
    )
    .all();

  const matchesBaseScope = (tx, ignoreMonth = false) => {
    if (tx.account_is_archived === 1 || tx.dest_account_is_archived === 1) return false;
    if (!ignoreMonth && selectedMonth !== 'all' && !tx.date.startsWith(selectedMonth)) return false;
    if (filters.historical === 'live' && tx.is_historical === 1) return false;
    if (filters.historical === 'historical' && tx.is_historical === 0) return false;
    if (tx.is_hidden === 1) return false;
    return true;
  };

  const matchesScope = (tx, ignoreMonth = false) => {
    if (tx.account_is_archived === 1 || tx.dest_account_is_archived === 1) return false;
    if (!ignoreMonth && selectedMonth !== 'all' && !tx.date.startsWith(selectedMonth)) return false;
    if (filters.accountId) {
      const aid = Number(filters.accountId);
      if (tx.account_id !== aid && tx.dest_account_id !== aid) return false;
    }
    if (filters.pocketId) {
      const pid = Number(filters.pocketId);
      if (tx.pocket_id !== pid && tx.dest_pocket_id !== pid) return false;
    }
    if (filters.type && filters.type !== 'all' && tx.type !== filters.type) return false;
    if (filters.categoryName && filters.categoryName !== 'all' && tx.category_name !== filters.categoryName) {
      return false;
    }
    if (filters.historical === 'live' && tx.is_historical === 1) return false;
    if (filters.historical === 'historical' && tx.is_historical === 0) return false;
    if (filters.approval === 'needs_approval' && tx.needs_approval !== 1) return false;
    if (filters.approval === 'approved' && tx.needs_approval === 1) return false;
    const vis = filters.visibility || 'visible';
    if (vis === 'visible' && tx.is_hidden === 1) return false;
    if (vis === 'hidden' && tx.is_hidden !== 1) return false;
    if (filters.recurring === '1' || filters.recurring === true || filters.recurring === 'true') {
      if (tx.is_recurring !== 1) return false;
    }
    if (filters.excludedStats === '1' || filters.excludedStats === true || filters.excludedStats === 'true') {
      if (tx.exclude_from_analytics !== 1) return false;
    }
    if (filters.hasReceipt === '1' || filters.hasReceipt === true || filters.hasReceipt === 'true') {
      if (!tx.receipt_path) return false;
    }
    if (filters.autoSource && tx.auto_source !== filters.autoSource) return false;
    if (filters.search) {
      const q = String(filters.search).toLowerCase();
      const hay = `${tx.merchant} ${tx.note} ${tx.category_name} ${tx.account_name} ${tx.pocket_name} ${tx.dest_account_name || ''} ${tx.dest_pocket_name || ''} ${tx.items_json || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const filteredTx = allTx.filter((tx) => matchesScope(tx, false));
  const scopeAllMonthsTx = allTx.filter((tx) => matchesScope(tx, true));

  const selectedIdList = Array.isArray(filters.selectedIds)
    ? filters.selectedIds
    : String(filters.selectedIds || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  const selectedIdSet = new Set(
    selectedIdList.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
  );
  const chartsScope = filters.chartsScope === 'all' ? 'all' : 'ledger';
  const hasExcludedFilter =
    filters.excludedStats === '1' || filters.excludedStats === true || filters.excludedStats === 'true';
  const hasLedgerFilters = Boolean(
    filters.accountId ||
      filters.pocketId ||
      (filters.type && filters.type !== 'all') ||
      (filters.categoryName && filters.categoryName !== 'all') ||
      (filters.approval && filters.approval !== 'all') ||
      (filters.visibility && filters.visibility !== 'visible') ||
      filters.recurring === '1' ||
      filters.recurring === true ||
      filters.recurring === 'true' ||
      hasExcludedFilter ||
      filters.hasReceipt === '1' ||
      filters.hasReceipt === true ||
      filters.hasReceipt === 'true' ||
      filters.autoSource ||
      filters.search
  );

  let analyticsTx;
  let analyticsAllMonthsTx;
  let includeExcluded = false;
  let analyticsMode = 'all';

  if (chartsScope !== 'all' && selectedIdSet.size > 0) {
    analyticsTx = allTx.filter(
      (tx) => tx.account_is_archived !== 1 && tx.dest_account_is_archived !== 1 && selectedIdSet.has(tx.id)
    );
    analyticsAllMonthsTx = analyticsTx;
    includeExcluded = true;
    analyticsMode = 'selected';
  } else if (chartsScope === 'all') {
    analyticsTx = allTx.filter((tx) => matchesBaseScope(tx, false));
    analyticsAllMonthsTx = allTx.filter((tx) => matchesBaseScope(tx, true));
    includeExcluded = false;
    analyticsMode = 'all';
  } else {
    analyticsTx = filteredTx;
    analyticsAllMonthsTx = scopeAllMonthsTx;
    includeExcluded = hasExcludedFilter;
    analyticsMode = hasLedgerFilters ? 'filtered' : 'all';
  }

  // KPIs & chart series over analyticsTx (excluding transfer & adjustment from spending/income, tracking transfers separately)
  let periodIncomeHuf = 0;
  let periodExpenseHuf = 0;
  let periodTransferHuf = 0;
  let transferCount = 0;
  let inCount = 0;
  let outCount = 0;
  let receiptCount = 0;
  let recurringExpenseHuf = 0;
  let recurringCount = 0;
  let biggestExpense = null;
  const expenseCatMap = new Map();
  const incomeCatMap = new Map();
  const transferCatMap = new Map();
  const merchantExpMap = new Map();
  const merchantIncMap = new Map();
  const dailyExpMap = new Map();
  const weekdayBuckets = Array.from({ length: 7 }, (_, dow) => ({ dow, expenseHuf: 0, count: 0 }));

  for (const tx of analyticsTx) {
    if (!includeExcluded && tx.exclude_from_analytics) continue;
    if (tx.receipt_path) receiptCount += 1;
    if (tx.type !== 'income' && tx.type !== 'expense' && tx.type !== 'transfer') continue;
    const hufAmt = convertCurrency(tx.amount, tx.currency, 'HUF', fxRates);
    const txLabel = String(tx.merchant || tx.category_name || '').trim() || tx.category_name;
    const txDay = String(tx.date || '').slice(0, 10);

    if (tx.type === 'income') {
      periodIncomeHuf += hufAmt;
      inCount += 1;
      const entry = incomeCatMap.get(tx.category_name) || {
        category: tx.category_name,
        color: tx.category_color || '#10b981',
        amountHuf: 0,
        count: 0,
      };
      entry.amountHuf += hufAmt;
      entry.count += 1;
      incomeCatMap.set(tx.category_name, entry);

      const mInc = merchantIncMap.get(txLabel) || {
        name: txLabel,
        category: tx.category_name,
        color: tx.category_color || '#10b981',
        amountHuf: 0,
        count: 0,
      };
      mInc.amountHuf += hufAmt;
      mInc.count += 1;
      merchantIncMap.set(txLabel, mInc);
    } else if (tx.type === 'expense') {
      periodExpenseHuf += hufAmt;
      outCount += 1;
      if (tx.is_recurring === 1) {
        recurringExpenseHuf += hufAmt;
        recurringCount += 1;
      }
      if (!biggestExpense || hufAmt > biggestExpense.amountHuf) {
        biggestExpense = {
          id: tx.id,
          amountHuf: roundCurrency(hufAmt, 'HUF'),
          amount: tx.amount,
          currency: tx.currency,
          merchant: tx.merchant || tx.category_name,
          categoryName: tx.category_name,
          date: txDay,
        };
      }

      const entry = expenseCatMap.get(tx.category_name) || {
        category: tx.category_name,
        color: tx.category_color || '#f59e0b',
        amountHuf: 0,
        count: 0,
      };
      entry.amountHuf += hufAmt;
      entry.count += 1;
      expenseCatMap.set(tx.category_name, entry);

      const mExp = merchantExpMap.get(txLabel) || {
        name: txLabel,
        category: tx.category_name,
        color: tx.category_color || '#f43f5e',
        amountHuf: 0,
        count: 0,
      };
      mExp.amountHuf += hufAmt;
      mExp.count += 1;
      merchantExpMap.set(txLabel, mExp);

      if (txDay.length === 10) {
        const dEntry = dailyExpMap.get(txDay) || { date: txDay, expenseHuf: 0, count: 0 };
        dEntry.expenseHuf += hufAmt;
        dEntry.count += 1;
        dailyExpMap.set(txDay, dEntry);

        const dObj = new Date(`${txDay}T12:00:00`);
        const dow = Number.isNaN(dObj.getTime()) ? 0 : (dObj.getDay() + 6) % 7;
        weekdayBuckets[dow].expenseHuf += hufAmt;
        weekdayBuckets[dow].count += 1;
      }
    } else if (tx.type === 'transfer') {
      periodTransferHuf += hufAmt;
      transferCount += 1;
      const entry = transferCatMap.get(tx.category_name) || {
        category: tx.category_name,
        color: tx.category_color || '#3b82f6',
        amountHuf: 0,
        count: 0,
      };
      entry.amountHuf += hufAmt;
      entry.count += 1;
      transferCatMap.set(tx.category_name, entry);
    }
  }

  periodIncomeHuf = roundCurrency(periodIncomeHuf, 'HUF');
  periodExpenseHuf = roundCurrency(periodExpenseHuf, 'HUF');
  periodTransferHuf = roundCurrency(periodTransferHuf, 'HUF');
  recurringExpenseHuf = roundCurrency(recurringExpenseHuf, 'HUF');
  const periodNetHuf = roundCurrency(periodIncomeHuf - periodExpenseHuf, 'HUF');
  const savingsRate =
    periodIncomeHuf > 0 ? Math.round(((periodIncomeHuf - periodExpenseHuf) / periodIncomeHuf) * 1000) / 10 : 0;
  const activeExpenseDays = dailyExpMap.size;
  const avgDailyExpenseHuf = activeExpenseDays > 0 ? roundCurrency(periodExpenseHuf / activeExpenseDays, 'HUF') : 0;
  const avgExpenseTxHuf = outCount > 0 ? roundCurrency(periodExpenseHuf / outCount, 'HUF') : 0;
  const recurringPct =
    periodExpenseHuf > 0 ? Math.round((recurringExpenseHuf / periodExpenseHuf) * 1000) / 10 : 0;

  const finalizeBreakdown = (map, total) =>
    Array.from(map.values())
      .map((item) => ({
        ...item,
        amountHuf: roundCurrency(item.amountHuf, 'HUF'),
        pct: total > 0 ? Math.round((item.amountHuf / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amountHuf - a.amountHuf);

  const expenseByCategory = finalizeBreakdown(expenseCatMap, periodExpenseHuf);
  const incomeByCategory = finalizeBreakdown(incomeCatMap, periodIncomeHuf);
  const transferByCategory = finalizeBreakdown(transferCatMap, periodTransferHuf);
  const topMerchants = finalizeBreakdown(merchantExpMap, periodExpenseHuf).slice(0, 10);
  const topIncomeSources = finalizeBreakdown(merchantIncMap, periodIncomeHuf).slice(0, 8);

  const dailySpending = Array.from(dailyExpMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-31)
    .map((d) => ({
      date: d.date,
      expenseHuf: roundCurrency(d.expenseHuf, 'HUF'),
      count: d.count,
    }));

  const weekdaySpending = weekdayBuckets.map((w) => ({
    dow: w.dow,
    expenseHuf: roundCurrency(w.expenseHuf, 'HUF'),
    count: w.count,
    pct: periodExpenseHuf > 0 ? Math.round((w.expenseHuf / periodExpenseHuf) * 1000) / 10 : 0,
  }));

  const selectedPocketIds = new Set();
  if (analyticsMode === 'selected') {
    for (const tx of analyticsTx) {
      if (tx.pocket_id) selectedPocketIds.add(tx.pocket_id);
      if (tx.dest_pocket_id) selectedPocketIds.add(tx.dest_pocket_id);
    }
  }
  const activeAccountId = filters.accountId ? Number(filters.accountId) : null;
  const activePocketId = filters.pocketId ? Number(filters.pocketId) : null;
  const wealthDistribution = [];
  for (const acc of accounts) {
    if (acc.is_archived) continue;
    if (chartsScope !== 'all' && analyticsMode !== 'selected' && activeAccountId && acc.id !== activeAccountId) continue;
    for (const p of acc.pockets || []) {
      if (p.is_archived || !(Number(p.balance_huf) > 0)) continue;
      if (analyticsMode === 'selected' && selectedPocketIds.size > 0 && !selectedPocketIds.has(p.id)) continue;
      if (chartsScope !== 'all' && analyticsMode !== 'selected' && activePocketId && p.id !== activePocketId) continue;
      const balHuf = roundCurrency(p.balance_huf, 'HUF');
      wealthDistribution.push({
        pocketId: p.id,
        pocketName: p.name,
        accountId: acc.id,
        accountName: acc.name,
        color: p.color || acc.color || '#6366f1',
        currency: p.currency,
        balance: p.current_balance,
        balanceHuf: balHuf,
        pct: 0,
      });
    }
  }
  const scopedWealthTotalHuf = wealthDistribution.reduce((sum, item) => sum + item.balanceHuf, 0);
  for (const item of wealthDistribution) {
    item.pct = scopedWealthTotalHuf > 0 ? Math.round((item.balanceHuf / scopedWealthTotalHuf) * 1000) / 10 : 0;
  }
  wealthDistribution.sort((a, b) => b.balanceHuf - a.balanceHuf);

  // Monthly Cashflow across analyticsAllMonthsTx (last 12 months with data)
  const monthlyMap = new Map();
  for (const tx of analyticsAllMonthsTx) {
    if (!includeExcluded && tx.exclude_from_analytics) continue;
    if (tx.type !== 'income' && tx.type !== 'expense' && tx.type !== 'transfer') continue;
    const m = tx.date.slice(0, 7);
    const entry = monthlyMap.get(m) || { month: m, incomeHuf: 0, expenseHuf: 0, transferHuf: 0, netHuf: 0 };
    const hufAmt = convertCurrency(tx.amount, tx.currency, 'HUF', fxRates);
    if (tx.type === 'income') entry.incomeHuf += hufAmt;
    else if (tx.type === 'expense') entry.expenseHuf += hufAmt;
    else if (tx.type === 'transfer') entry.transferHuf += hufAmt;
    entry.netHuf = entry.incomeHuf - entry.expenseHuf;
    monthlyMap.set(m, entry);
  }
  let runningNetHuf = 0;
  const monthlyCashflow = Array.from(monthlyMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map((m) => {
      const inc = roundCurrency(m.incomeHuf, 'HUF');
      const exp = roundCurrency(m.expenseHuf, 'HUF');
      const trf = roundCurrency(m.transferHuf, 'HUF');
      const net = roundCurrency(m.netHuf, 'HUF');
      runningNetHuf = roundCurrency(runningNetHuf + net, 'HUF');
      const mSavingsRate = inc > 0 ? Math.round(((inc - exp) / inc) * 1000) / 10 : 0;
      return {
        month: m.month,
        incomeHuf: inc,
        expenseHuf: exp,
        transferHuf: trf,
        netHuf: net,
        cumulativeNetHuf: runningNetHuf,
        savingsRate: mSavingsRate,
      };
    });

  // Balance history chart (chronological anchored points from analyticsTx)
  const chronTx = [...analyticsTx].reverse().filter((tx) => tx.pocket_balance_after !== null && tx.pocket_balance_after !== undefined);
  const balanceSeries = chronTx.slice(-60).map((tx) => ({
    id: tx.id,
    date: tx.date,
    accountName: tx.account_name,
    pocketName: tx.pocket_name,
    currency: tx.currency,
    pocketBalanceAfter: tx.pocket_balance_after,
    accountBalanceAfter: tx.account_balance_after,
    pocketBalanceAfterHuf: convertCurrency(tx.pocket_balance_after, tx.currency, 'HUF', fxRates),
    accountBalanceAfterHuf: convertCurrency(tx.account_balance_after, tx.account_currency, 'HUF', fxRates),
  }));

  const rawLimit = Number(filters.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.round(rawLimit), 1000) : 250;
  const sortedTransactions = sortLedgerTransactions(filteredTx, filters.sort, fxRates);
  const totalMatchingTransactions = sortedTransactions.length;
  const totalPages = Math.max(1, Math.ceil(totalMatchingTransactions / limit));
  const rawPage = Number(filters.page);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(Math.round(rawPage), totalPages) : 1;
  const pageOffset = (page - 1) * limit;
  const pagedTransactions = sortedTransactions.slice(pageOffset, pageOffset + limit);

  let dashboardLayout = null;
  try {
    const rawLayout = getSetting(db, 'dashboard_layout', '');
    if (rawLayout) dashboardLayout = JSON.parse(rawLayout);
  } catch {
    dashboardLayout = null;
  }

  const activeBankTx = allTx.filter(
    (tx) => tx.account_is_archived !== 1 && tx.dest_account_is_archived !== 1
  );
  const pendingApprovalCount = activeBankTx.filter((tx) => tx.needs_approval === 1).length;
  const hiddenTxCount = activeBankTx.filter((tx) => tx.is_hidden === 1).length;
  const filterCounts = {
    hidden: hiddenTxCount,
    needsApproval: pendingApprovalCount,
    recurring: activeBankTx.filter((tx) => tx.is_hidden !== 1 && tx.is_recurring === 1).length,
    excludedStats: activeBankTx.filter((tx) => tx.is_hidden !== 1 && tx.exclude_from_analytics === 1).length,
    hasReceipt: activeBankTx.filter((tx) => tx.is_hidden !== 1 && Boolean(tx.receipt_path)).length,
    fromNotif: activeBankTx.filter((tx) => tx.is_hidden !== 1 && tx.auto_source === 'notification').length,
  };

  return {
    fxRates,
    totalNetWorthHuf,
    totalsByCurrency,
    accounts,
    categories,
    counterparties: listCounterparties(db, { hideHistorical: filters.historical === 'live' }),
    availableMonths,
    selectedMonth,
    dashboardLayout,
    pendingApprovalCount,
    hiddenTxCount,
    filterCounts,
    selectedSort: filters.sort || 'date_desc',
    analyticsScope: {
      mode: analyticsMode,
      chartsScope,
      txCount: analyticsTx.length,
      selectedCount: selectedIdSet.size,
      includeExcluded,
    },
    kpis: {
      periodIncomeHuf,
      periodExpenseHuf,
      periodTransferHuf,
      transferCount,
      periodNetHuf,
      savingsRate,
      txCount: analyticsTx.length,
      inCount,
      outCount,
      receiptCount,
      activeExpenseDays,
      avgDailyExpenseHuf,
      avgExpenseTxHuf,
      topMerchant: topMerchants[0] || null,
      biggestExpense,
      recurringExpenseHuf,
      recurringCount,
      recurringPct,
    },
    charts: {
      monthlyCashflow,
      expenseByCategory,
      incomeByCategory,
      transferByCategory,
      topMerchants,
      topIncomeSources,
      dailySpending,
      weekdaySpending,
      wealthDistribution,
      balanceSeries,
    },
    transactions: pagedTransactions,
    totalMatchingTransactions,
    page,
    pageSize: limit,
    totalPages,
  };
}

const GENERIC_COUNTERPARTY_REGEX =
  /^(?:otp(?:\s+bank|\s+mobilbank|\s+smartbank)?|erste(?:\s+bank|\s+george)?|george|revolut|wise|kártyás\s+vásárlás|bankkártyás\s+vásárlás|kártyás\s+fizetés|sikeres\s+(?:online\s+|kártyás\s+|bankkártyás\s+|pos\s+)?(?:vásárlás|fizetés|tranzakció|átutalás|utalás|jóváírás|terhelés)|(?:online|sikeres)\s+(?:vásárlás|fizetés|tranzakció)|vásárlás|fizetés|tranzakció|értesítés|azonnali\s+átutalás|átutalás|utalás|jóváírás|terhelés|fizetés\s+érkezett|beérkező\s+utalás|kimenő\s+utalás|card\s+payment|bank\s+card\s+payment|incoming\s+bank\s+transfer|internal\s+bank\s+transfer|instant\s+transfer|payment(?:\s+(?:received|sent))?|transfer|transaction|alert|notification|money\s+(?:received|sent))$/i;

const CORPORATE_NOISE_TOKENS = new Set([
  'zrt',
  'nyrt',
  'kft',
  'bt',
  'kkt',
  'ev',
  'ltd',
  'plc',
  'inc',
  'llc',
  'gmbh',
  'ag',
  'sa',
  'sro',
  'co',
  'corp',
  'company',
  'group',
  'holding',
  'global',
  'international',
  'intl',
  'magyarorszag',
  'hungary',
  'hungaria',
  'hu',
  'com',
  'eu',
  'net',
  'org',
]);

const DESCRIPTOR_TOKENS = new Set([
  'kereskedo',
  'kereskedonel',
  'webshop',
  'webshopjaban',
  'webaruhaz',
  'webaruhazaban',
  'aruhaz',
  'uzlet',
  'bolt',
  'etterem',
  'bistro',
  'bisztro',
  'cafe',
  'kavezo',
  'gyorsetterem',
  'pekseg',
  'patika',
  'gyogyszertar',
  'benzinkut',
  'station',
  'store',
  'shop',
  'market',
  'supermarket',
  'hypermarket',
  'express',
  'center',
  'centrum',
  'plaza',
  'mall',
  'outlet',
  'online',
]);

function isGenericCounterpartyName(name) {
  const stripped = String(name || '')
    .replace(/^[\s!?.:;,\-–—]+|[\s!?.:;,\-–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped || stripped === '?') return true;
  return GENERIC_COUNTERPARTY_REGEX.test(stripped);
}

function cleanRawMerchantString(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/^(?:CRV|CURVE|SUMUP|SQ|PAYPAL|PP|BARION|SIMPLEPAY|SIMPLE|GOPAY|VPOS|OTP\s*MOBIL|NYX)\s*\*\s*/i, '');
  s = s.replace(/^(?:sikeresen\s+)?(?:vásároltál|fizettél|költöttél)\s+a(?:\(z\)|z)?\s+/i, '');
  s = s.replace(
    /\s+(?:kereskedőnél|webshopjában|webshopban|webáruházában|webáruházban|üzletében|üzletben|boltjában|boltban|étteremben|alkalmazásban|helyszínén|helyen|elfogadóhelyen|terminálon)[.!,;\s]*$/i,
    ''
  );
  s = s.replace(/\s+\d{3,}\s+ONKISZ(?:OLG[AÁ]L[OÓ])?\b.*$/i, '');
  s = s.replace(/\s+ONKISZ(?:OLG[AÁ]L[OÓ])?\b.*$/i, '');
  const trailingDigits = /^([A-Za-zÀ-ž0-9.&'/\- ]{2,}?)\s+#?\d{4,}$/.exec(s);
  if (trailingDigits && /[A-Za-zÀ-ž]{2,}/.test(trailingDigits[1])) {
    s = trailingDigits[1];
  }
  return s.replace(/^[.,;:\-\s]+|[.,;:\-\s]+$/g, '').trim();
}

function normalizeForMatch(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '');
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}

function analyzeCounterpartyName(rawName) {
  const cleaned = cleanRawMerchantString(rawName);
  const lower = String(cleaned || '').trim().toLowerCase();
  const hasSlash = /\//.test(cleaned);
  const norm = normalizeForMatch(cleaned);
  const allTokens = norm.split(/[^a-z0-9]+/g).filter(Boolean);
  const filteredBrand = allTokens.filter((tok) => !CORPORATE_NOISE_TOKENS.has(tok) && !/^\d{3,}$/.test(tok));
  const brandTokens = filteredBrand.length > 0 ? filteredBrand : allTokens;
  const filteredCore = brandTokens.filter((tok) => !DESCRIPTOR_TOKENS.has(tok));
  const coreTokens = filteredCore.length > 0 ? filteredCore : brandTokens;
  const sortedBrand = [...brandTokens].sort().join(' ');
  const sortedCore = [...coreTokens].sort().join(' ');
  return {
    cleaned,
    lower,
    hasSlash,
    normFull: allTokens.join(' '),
    allTokens,
    brandTokens,
    coreTokens,
    brandStr: brandTokens.join(' '),
    coreStr: coreTokens.join(' '),
    sortedBrand,
    sortedCore,
    compactBrand: brandTokens.join(''),
    compactCore: coreTokens.join(''),
  };
}

function scoreCounterpartySimilarity(queryName, candidateName) {
  if (!queryName || !candidateName) return 0;
  if (isGenericCounterpartyName(queryName) || isGenericCounterpartyName(candidateName)) return 0;

  const qRaw = String(queryName).trim().toLowerCase();
  const cRaw = String(candidateName).trim().toLowerCase();
  if (qRaw && cRaw && qRaw === cRaw) return 1.0;

  const a = analyzeCounterpartyName(queryName);
  const b = analyzeCounterpartyName(candidateName);
  if (!a.allTokens.length || !b.allTokens.length) return 0;

  if (a.lower && a.lower === b.lower) return 0.995;
  if (a.normFull && a.normFull === b.normFull) return 0.99;

  const slashMismatch = a.hasSlash !== b.hasSlash;

  if (!slashMismatch) {
    const tokenLenPenalty = Math.min(0.03, Math.abs(a.allTokens.length - b.allTokens.length) * 0.01);
    if (a.brandStr && a.brandStr === b.brandStr) {
      return 0.96 - tokenLenPenalty;
    }
    if (a.compactBrand && a.compactBrand === b.compactBrand) {
      return 0.95 - tokenLenPenalty;
    }
    if (a.coreStr && a.coreStr === b.coreStr) {
      return 0.93 - tokenLenPenalty;
    }
    if (a.compactCore && a.compactCore === b.compactCore && a.compactCore.length >= 4) {
      return 0.92 - tokenLenPenalty;
    }
    if (a.brandTokens.length >= 2 && a.sortedBrand === b.sortedBrand) {
      return 0.94;
    }
    if (a.coreTokens.length >= 2 && a.sortedCore === b.sortedCore) {
      return 0.92;
    }

    if (a.coreTokens.length === 1 && b.coreTokens.length === 1) {
      const tA = a.coreTokens[0];
      const tB = b.coreTokens[0];
      if (!/\d/.test(tA) && !/\d/.test(tB)) {
        const minLen = Math.min(tA.length, tB.length);
        const maxLen = Math.max(tA.length, tB.length);
        if (minLen >= 6) {
          const dist = levenshteinDistance(tA, tB);
          if (dist === 1) return 0.89;
          if (minLen >= 8 && maxLen >= 8 && dist === 2) return 0.85;
        }
      }
    }
  }

  let matchedCount = 0;
  const usedB = new Set();
  for (const tA of a.coreTokens) {
    let bestIdx = -1;
    for (let j = 0; j < b.coreTokens.length; j += 1) {
      if (usedB.has(j)) continue;
      const tB = b.coreTokens[j];
      if (tA === tB) {
        bestIdx = j;
        break;
      }
      if (tA.length >= 4 && tB.length >= 4 && (tA.startsWith(tB) || tB.startsWith(tA))) {
        bestIdx = j;
      }
    }
    if (bestIdx !== -1) {
      usedB.add(bestIdx);
      matchedCount += 1;
    }
  }

  if (matchedCount === 0) return 0;

  const coverage = matchedCount / Math.max(a.coreTokens.length, b.coreTokens.length);
  if (slashMismatch) {
    return Math.min(0.68, 0.5 + 0.18 * coverage);
  }
  if (coverage >= 0.75) {
    return 0.74 + 0.14 * coverage;
  }
  return 0.55 * coverage;
}

function findBestMatchingCounterparty(db, rawName, direction, options = {}) {
  const minScore = options.minScore ?? 0.82;
  const cleanedName = cleanRawMerchantString(rawName);
  if (!cleanedName || isGenericCounterpartyName(cleanedName)) {
    return null;
  }
  if (direction !== 'in' && direction !== 'out') {
    return { counterparty: null, score: 0, cleanedName, suggestions: [] };
  }

  const candidates = db.prepare('SELECT * FROM counterparties WHERE direction = ?').all(direction);
  const queryMeta = analyzeCounterpartyName(cleanedName);
  const scored = [];

  for (const cp of candidates) {
    const score = scoreCounterpartySimilarity(cleanedName, cp.name);
    if (score > 0) {
      const cpMeta = analyzeCounterpartyName(cp.name);
      scored.push({
        counterparty: cp,
        score,
        hasSlash: cpMeta.hasSlash,
        tokenDiff: Math.abs(queryMeta.allTokens.length - cpMeta.allTokens.length),
      });
    }
  }

  scored.sort((x, y) => {
    if (Math.abs(y.score - x.score) > 0.005) return y.score - x.score;
    if (x.hasSlash !== y.hasSlash) return x.hasSlash ? 1 : -1;
    if (x.tokenDiff !== y.tokenDiff) return x.tokenDiff - y.tokenDiff;
    const useDiff = Number(y.counterparty.use_count || 0) - Number(x.counterparty.use_count || 0);
    if (useDiff !== 0) return useDiff;
    return String(y.counterparty.last_used_at || '').localeCompare(String(x.counterparty.last_used_at || ''));
  });

  const top = scored[0] || null;
  const suggestions = scored.slice(0, 10).map((s) => ({
    ...s.counterparty,
    score: Number(s.score.toFixed(4)),
  }));

  if (top && top.score >= minScore) {
    return {
      counterparty: top.counterparty,
      score: top.score,
      cleanedName,
      suggestions,
    };
  }

  return {
    counterparty: null,
    score: top ? top.score : 0,
    cleanedName,
    suggestions,
  };
}

function upsertCounterparty(db, name, direction, categoryId = null) {
  const cleanName = String(name || '').trim();
  if (!cleanName || isGenericCounterpartyName(cleanName)) return null;
  if (direction !== 'in' && direction !== 'out') {
    throw new Error('Counterparty direction must be "in" or "out".');
  }
  const now = new Date().toISOString();
  const existingCi = db
    .prepare('SELECT * FROM counterparties WHERE name = ? COLLATE NOCASE AND direction = ? LIMIT 1')
    .get(cleanName, direction);

  if (existingCi) {
    db.prepare(
      `UPDATE counterparties
       SET use_count = use_count + 1,
           last_used_at = ?,
           default_category_id = COALESCE(?, default_category_id)
       WHERE id = ?`
    ).run(now, categoryId || null, existingCi.id);
    return db.prepare('SELECT * FROM counterparties WHERE id = ?').get(existingCi.id);
  }

  db.prepare(
    `INSERT INTO counterparties (name, direction, default_category_id, use_count, last_used_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(name, direction) DO UPDATE SET
       name = excluded.name,
       use_count = counterparties.use_count + 1,
       last_used_at = excluded.last_used_at,
       default_category_id = COALESCE(excluded.default_category_id, counterparties.default_category_id)`
  ).run(cleanName, direction, categoryId || null, now);
  return db
    .prepare('SELECT * FROM counterparties WHERE name = ? AND direction = ?')
    .get(cleanName, direction);
}

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateCounterparty(db, id, patch = {}) {
  const existing = db.prepare('SELECT * FROM counterparties WHERE id = ?').get(Number(id));
  if (!existing) {
    const err = new Error('Saved origin/destination not found.');
    err.statusCode = 404;
    throw err;
  }

  const nextName = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!nextName || nextName === '?') {
    const err = new Error('Name cannot be empty.');
    err.statusCode = 400;
    throw err;
  }

  const categoryProvided =
    patch.categoryId !== undefined || patch.defaultCategoryId !== undefined || patch.default_category_id !== undefined;
  const expectedCatType = existing.direction === 'in' ? 'income' : 'expense';
  let nextCategoryId = existing.default_category_id;
  let nextCategory = nextCategoryId ? db.prepare('SELECT * FROM categories WHERE id = ?').get(nextCategoryId) : null;

  if (categoryProvided) {
    const rawCat = patch.categoryId ?? patch.defaultCategoryId ?? patch.default_category_id;
    if (rawCat === null || rawCat === '' || Number(rawCat) <= 0) {
      nextCategoryId = null;
      nextCategory = null;
    } else {
      const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(rawCat));
      if (!cat || cat.type !== expectedCatType) {
        const err = new Error('Invalid default category for this direction.');
        err.statusCode = 400;
        throw err;
      }
      nextCategoryId = cat.id;
      nextCategory = cat;
    }
  }

  const nameChanged = nextName !== existing.name;
  const categoryChanged = categoryProvided && Number(nextCategoryId || 0) !== Number(existing.default_category_id || 0);
  const updatePrevious = Boolean(patch.updatePrevious || patch.updatePreviousEntries);

  let targetId = existing.id;
  let updatedTransactions = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    const conflict = db
      .prepare('SELECT * FROM counterparties WHERE name = ? COLLATE NOCASE AND direction = ? AND id != ?')
      .get(nextName, existing.direction, existing.id);

    if (conflict) {
      const mergedCatId = categoryProvided ? nextCategoryId : existing.default_category_id || conflict.default_category_id || null;
      const mergedUseCount = Number(conflict.use_count || 0) + Number(existing.use_count || 0);
      const mergedLastUsed =
        String(existing.last_used_at || '') > String(conflict.last_used_at || '')
          ? existing.last_used_at
          : conflict.last_used_at;

      db.prepare('DELETE FROM counterparties WHERE id = ?').run(existing.id);
      db.prepare(
        'UPDATE counterparties SET name = ?, default_category_id = ?, use_count = ?, last_used_at = ? WHERE id = ?'
      ).run(nextName, mergedCatId, mergedUseCount, mergedLastUsed, conflict.id);
      targetId = conflict.id;
    } else {
      db.prepare('UPDATE counterparties SET name = ?, default_category_id = ? WHERE id = ?').run(
        nextName,
        nextCategoryId,
        existing.id
      );
      targetId = existing.id;
    }

    if (updatePrevious) {
      const txType = existing.direction === 'in' ? 'income' : 'expense';
      const matchingRows = db
        .prepare(
          `SELECT t.*, a.name AS account_name, p.name AS pocket_name,
                  da.name AS dest_account_name, dp.name AS dest_pocket_name,
                  c.auto_note_template AS category_template
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           JOIN pockets p ON p.id = t.pocket_id
           LEFT JOIN accounts da ON da.id = t.dest_account_id
           LEFT JOIN pockets dp ON dp.id = t.dest_pocket_id
           LEFT JOIN categories c ON c.id = t.category_id
           WHERE t.type = ? AND TRIM(t.merchant) = TRIM(?) COLLATE NOCASE`
        )
        .all(txType, existing.name);

      const updTxStmt = db.prepare(
        'UPDATE transactions SET merchant = ?, category_id = ?, category_name = ?, note = ?, note_source = ? WHERE id = ?'
      );

      for (const tx of matchingRows) {
        const effCatId = categoryChanged && nextCategory ? nextCategory.id : tx.category_id;
        const effCatName = categoryChanged && nextCategory ? nextCategory.name : tx.category_name;
        const effCatTemplate =
          categoryChanged && nextCategory ? nextCategory.auto_note_template || '' : tx.category_template || '';

        let nextNote = tx.note;
        const nextNoteSource = tx.note_source;

        if (tx.note_source === 'auto') {
          let items = [];
          try {
            items = JSON.parse(tx.items_json || '[]');
          } catch {
            items = [];
          }
          const ensured = ensureTransactionNote({
            note: '',
            noteSource: 'auto',
            type: tx.type,
            categoryName: effCatName,
            categoryTemplate: effCatTemplate,
            merchant: nextName,
            accountName: tx.account_name,
            pocketName: tx.pocket_name,
            destAccountName: tx.dest_account_name || '',
            destPocketName: tx.dest_pocket_name || '',
            items,
            storeAddress: tx.store_address || '',
            currency: tx.currency,
          });
          nextNote = ensured.note;
        } else if (tx.note_source === 'import' && nameChanged && existing.name) {
          const escapedOld = escapeRegExp(existing.name);
          nextNote = String(nextNote || '')
            .replace(new RegExp(` at ${escapedOld} \\(`, 'gi'), ` at ${nextName} (`)
            .replace(new RegExp(` from ${escapedOld} \\(`, 'gi'), ` from ${nextName} (`)
            .replace(new RegExp(`\\(${escapedOld}\\)`, 'gi'), `(${nextName})`);
        }

        updTxStmt.run(nextName, effCatId, effCatName, nextNote, nextNoteSource, tx.id);
      }

      updatedTransactions = matchingRows.length;
    }

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }

  const item = db
    .prepare(
      `SELECT cp.*, c.name AS default_category_name,
              (SELECT COUNT(*) FROM transactions t
               WHERE t.type = CASE WHEN cp.direction = 'in' THEN 'income' ELSE 'expense' END
                 AND TRIM(t.merchant) = TRIM(cp.name) COLLATE NOCASE) AS tx_count
       FROM counterparties cp
       LEFT JOIN categories c ON c.id = cp.default_category_id
       WHERE cp.id = ?`
    )
    .get(targetId);

  return { item, updatedTransactions };
}

function deleteCounterparty(db, id) {
  const res = db.prepare('DELETE FROM counterparties WHERE id = ?').run(Number(id));
  if (res.changes === 0) throw new Error('Saved origin/destination not found.');
}

function listCounterparties(db, options = {}) {
  const hideHistorical = Boolean(options && options.hideHistorical);
  const hideFlag = hideHistorical ? 1 : 0;
  const rows = db
    .prepare(
      `SELECT cp.*, c.name AS default_category_name,
              (SELECT COUNT(*) FROM transactions t
               WHERE t.type = CASE WHEN cp.direction = 'in' THEN 'income' ELSE 'expense' END
                 AND TRIM(t.merchant) = TRIM(cp.name) COLLATE NOCASE
                 AND (? = 0 OR t.is_historical = 0)) AS tx_count
       FROM counterparties cp
       LEFT JOIN categories c ON c.id = cp.default_category_id
       WHERE (
         ? = 0
         OR NOT EXISTS (
           SELECT 1 FROM transactions t
           WHERE t.type = CASE WHEN cp.direction = 'in' THEN 'income' ELSE 'expense' END
             AND TRIM(t.merchant) = TRIM(cp.name) COLLATE NOCASE
             AND t.is_historical = 1
         )
         OR EXISTS (
           SELECT 1 FROM transactions t
           WHERE t.type = CASE WHEN cp.direction = 'in' THEN 'income' ELSE 'expense' END
             AND TRIM(t.merchant) = TRIM(cp.name) COLLATE NOCASE
             AND t.is_historical = 0
         )
       )
       ORDER BY cp.use_count DESC, cp.last_used_at DESC, cp.name COLLATE NOCASE ASC`
    )
    .all(hideFlag, hideFlag);
  return {
    in: rows.filter((r) => r.direction === 'in'),
    out: rows.filter((r) => r.direction === 'out'),
  };
}

function updateAccount(db, accountId, patch) {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(accountId));
  if (!existing) throw new Error('Bank account not found.');
  const name = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!name) throw new Error('Bank account name cannot be empty.');
  const currency = patch.currency !== undefined ? normalizeCurrency(patch.currency, existing.currency) : existing.currency;
  const color = patch.color && /^#[0-9a-fA-F]{6}$/.test(patch.color) ? patch.color : existing.color;
  const isArchived = patch.isArchived !== undefined ? (patch.isArchived ? 1 : 0) : existing.is_archived;

  if (isArchived === 1 && existing.is_archived !== 1) {
    const otherActive = db.prepare('SELECT COUNT(*) AS cnt FROM accounts WHERE is_archived = 0 AND id != ?').get(existing.id).cnt;
    if (otherActive <= 0) throw new Error('Cannot hide or archive the only remaining active bank account.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE accounts SET name = ?, currency = ?, color = ?, is_archived = ? WHERE id = ?').run(
      name,
      currency,
      color,
      isArchived,
      existing.id
    );
    if (isArchived === 1 && existing.is_archived !== 1) {
      db.prepare('UPDATE pockets SET is_archived = 1, is_default = 0 WHERE account_id = ?').run(existing.id);
    } else if (isArchived === 0 && existing.is_archived === 1) {
      db.prepare('UPDATE pockets SET is_archived = 0 WHERE account_id = ?').run(existing.id);
      const hasDef = db.prepare('SELECT id FROM pockets WHERE account_id = ? AND is_default = 1 LIMIT 1').get(existing.id);
      if (!hasDef) {
        const firstPocket = db.prepare('SELECT id FROM pockets WHERE account_id = ? ORDER BY id ASC LIMIT 1').get(existing.id);
        if (firstPocket) db.prepare('UPDATE pockets SET is_default = 1 WHERE id = ?').run(firstPocket.id);
      }
    }
    recalculateAllBalances(db, null, { insideTx: true });
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(existing.id);
}

function deleteAccount(db, accountId, { action, moveToPocketId = null } = {}) {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(accountId));
  if (!existing) throw new Error('Bank account not found.');
  const resolvedAction = action || (moveToPocketId ? 'move' : 'archive');

  if (resolvedAction === 'archive') {
    const otherActive = db.prepare('SELECT COUNT(*) AS cnt FROM accounts WHERE is_archived = 0 AND id != ?').get(existing.id).cnt;
    if (otherActive <= 0) throw new Error('Cannot hide or archive the only remaining active bank account.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE accounts SET is_archived = 1 WHERE id = ?').run(existing.id);
      db.prepare('UPDATE pockets SET is_archived = 1, is_default = 0 WHERE account_id = ?').run(existing.id);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
    return { ok: true, action: 'archive' };
  }

  const totalAcc = db.prepare('SELECT COUNT(*) AS cnt FROM accounts').get().cnt;
  if (totalAcc <= 1) throw new Error('Cannot delete the only remaining bank account.');
  if (!existing.is_archived) {
    const otherActive = db.prepare('SELECT COUNT(*) AS cnt FROM accounts WHERE is_archived = 0 AND id != ?').get(existing.id).cnt;
    if (otherActive <= 0) throw new Error('Cannot delete the only remaining active bank account.');
  }

  const accPockets = db.prepare('SELECT id FROM pockets WHERE account_id = ?').all(existing.id);
  const pocketIds = accPockets.map((p) => p.id);

  let targetPocket = null;
  if (resolvedAction === 'move') {
    targetPocket = moveToPocketId ? db.prepare('SELECT * FROM pockets WHERE id = ?').get(Number(moveToPocketId)) : null;
    if (!targetPocket || targetPocket.account_id === existing.id) {
      throw new Error('Target pocket for moving transactions must belong to another bank account.');
    }
  } else if (resolvedAction !== 'purge') {
    throw new Error('Invalid delete action.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    if (pocketIds.length > 0) {
      const placeholders = pocketIds.map(() => '?').join(',');
      if (targetPocket) {
        db.prepare(`UPDATE transactions SET account_id = ?, pocket_id = ? WHERE pocket_id IN (${placeholders})`).run(
          targetPocket.account_id,
          targetPocket.id,
          ...pocketIds
        );
        db.prepare(`UPDATE transactions SET dest_account_id = ?, dest_pocket_id = ? WHERE dest_pocket_id IN (${placeholders})`).run(
          targetPocket.account_id,
          targetPocket.id,
          ...pocketIds
        );
        db.prepare("DELETE FROM transactions WHERE type = 'transfer' AND pocket_id = dest_pocket_id").run();
      } else {
        db.prepare(
          `DELETE FROM transactions WHERE pocket_id IN (${placeholders}) OR dest_pocket_id IN (${placeholders})`
        ).run(...pocketIds, ...pocketIds);
      }
    }
    db.prepare('DELETE FROM accounts WHERE id = ?').run(existing.id);
    recalculateAllBalances(db, null, { insideTx: true });
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
  return { ok: true, action: resolvedAction };
}

function updatePocket(db, pocketId, patch) {
  const existing = db.prepare('SELECT * FROM pockets WHERE id = ?').get(Number(pocketId));
  if (!existing) throw new Error('Pocket not found.');
  const name = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!name) throw new Error('Pocket name cannot be empty.');
  const currency = patch.currency !== undefined ? normalizeCurrency(patch.currency, existing.currency) : existing.currency;
  const initialBalance =
    patch.initialBalance !== undefined && patch.initialBalance !== ''
      ? roundCurrency(Number(patch.initialBalance), currency)
      : existing.initial_balance;
  if (!Number.isFinite(initialBalance)) throw new Error('Invalid starting balance.');
  const color = patch.color && /^#[0-9a-fA-F]{6}$/.test(patch.color) ? patch.color : existing.color;
  const isArchived = patch.isArchived !== undefined ? (patch.isArchived ? 1 : 0) : existing.is_archived;
  let isDefault = patch.isDefault !== undefined ? (patch.isDefault ? 1 : 0) : existing.is_default;
  if (isArchived === 1) {
    isDefault = 0;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    if (isArchived === 0 && existing.is_archived === 1) {
      db.prepare('UPDATE accounts SET is_archived = 0 WHERE id = ?').run(existing.account_id);
      const hasActiveDefault = db
        .prepare('SELECT id FROM pockets WHERE account_id = ? AND is_archived = 0 AND is_default = 1 AND id != ? LIMIT 1')
        .get(existing.account_id, existing.id);
      if (!hasActiveDefault) {
        isDefault = 1;
      }
    }
    if (isDefault === 1) {
      db.prepare('UPDATE pockets SET is_default = 0 WHERE account_id = ?').run(existing.account_id);
    }
    db.prepare(
      'UPDATE pockets SET name = ?, currency = ?, initial_balance = ?, color = ?, is_default = ?, is_archived = ? WHERE id = ?'
    ).run(name, currency, initialBalance, color, isDefault, isArchived, existing.id);

    if (isArchived === 1 && existing.is_default === 1) {
      const next = db
        .prepare('SELECT id FROM pockets WHERE account_id = ? AND is_archived = 0 AND id != ? ORDER BY id ASC LIMIT 1')
        .get(existing.account_id, existing.id);
      if (next) db.prepare('UPDATE pockets SET is_default = 1 WHERE id = ?').run(next.id);
    }

    if (currency !== existing.currency) {
      db.prepare('UPDATE transactions SET currency = ? WHERE pocket_id = ?').run(currency, existing.id);
    }
    recalculateAllBalances(db, null, { insideTx: true });
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
  return db.prepare('SELECT * FROM pockets WHERE id = ?').get(existing.id);
}

function deletePocket(db, pocketId, { action, moveToPocketId = null } = {}) {
  const existing = db.prepare('SELECT * FROM pockets WHERE id = ?').get(Number(pocketId));
  if (!existing) throw new Error('Pocket not found.');
  const resolvedAction = action || (moveToPocketId ? 'move' : 'archive');

  if (resolvedAction === 'archive') {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE pockets SET is_archived = 1, is_default = 0 WHERE id = ?').run(existing.id);
      if (existing.is_default === 1) {
        const next = db
          .prepare('SELECT id FROM pockets WHERE account_id = ? AND is_archived = 0 AND id != ? ORDER BY id ASC LIMIT 1')
          .get(existing.account_id, existing.id);
        if (next) db.prepare('UPDATE pockets SET is_default = 1 WHERE id = ?').run(next.id);
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
    return { ok: true, action: 'archive' };
  }

  const siblingCount = db.prepare('SELECT COUNT(*) AS cnt FROM pockets WHERE account_id = ?').get(existing.account_id).cnt;
  if (siblingCount <= 1) {
    throw new Error('Cannot permanently delete the only pocket of a bank account. Hide it or delete the bank instead.');
  }

  let targetPocket = null;
  if (resolvedAction === 'move') {
    targetPocket = moveToPocketId ? db.prepare('SELECT * FROM pockets WHERE id = ?').get(Number(moveToPocketId)) : null;
    if (!targetPocket || targetPocket.id === existing.id) {
      throw new Error('Choose another valid pocket to move transactions to.');
    }
  } else if (resolvedAction !== 'purge') {
    throw new Error('Invalid delete action.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    if (targetPocket) {
      db.prepare('UPDATE transactions SET account_id = ?, pocket_id = ? WHERE pocket_id = ?').run(
        targetPocket.account_id,
        targetPocket.id,
        existing.id
      );
      db.prepare('UPDATE transactions SET dest_account_id = ?, dest_pocket_id = ? WHERE dest_pocket_id = ?').run(
        targetPocket.account_id,
        targetPocket.id,
        existing.id
      );
      db.prepare("DELETE FROM transactions WHERE type = 'transfer' AND pocket_id = dest_pocket_id").run();
    } else {
      db.prepare('DELETE FROM transactions WHERE pocket_id = ? OR dest_pocket_id = ?').run(existing.id, existing.id);
    }

    db.prepare('DELETE FROM pockets WHERE id = ?').run(existing.id);
    if (existing.is_default === 1) {
      const next =
        db
          .prepare('SELECT id FROM pockets WHERE account_id = ? AND is_archived = 0 ORDER BY id ASC LIMIT 1')
          .get(existing.account_id) ||
        db.prepare('SELECT id FROM pockets WHERE account_id = ? ORDER BY id ASC LIMIT 1').get(existing.account_id);
      if (next) db.prepare('UPDATE pockets SET is_default = 1 WHERE id = ?').run(next.id);
    }
    recalculateAllBalances(db, null, { insideTx: true });
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
  return { ok: true, action: resolvedAction };
}

function sanitizeStringArray(arr, allowedSet = null) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const s = String(item || '').trim();
    if (!s || seen.has(s)) continue;
    if (allowedSet && !allowedSet.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function sanitizeSpanMap(obj, allowedSet) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (allowedSet.has(k) && (v === 2 || v === 'full')) {
      out[k] = 2;
    }
  }
  return out;
}

function sanitizeSectionSpanMap(obj, allowedSet) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (allowedSet.has(k) && (v === 1 || v === 'half')) {
      out[k] = 1;
    }
  }
  return out;
}

function sanitizeBankSpanMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const idNum = Number(k);
    if (Number.isInteger(idNum) && idNum > 0 && (v === 2 || v === 3)) {
      out[String(idNum)] = v;
    }
  }
  return out;
}

function sanitizeRowList(rawRows, allIds, defaultPerRow = 1) {
  const validSet = new Set(allIds.map(String));
  const seen = new Set();
  const rows = [];

  if (Array.isArray(rawRows)) {
    for (const rawRow of rawRows) {
      if (!Array.isArray(rawRow)) continue;
      const cleanRow = [];
      for (const cell of rawRow) {
        const id = String(typeof cell === 'object' && cell !== null ? cell.id : cell || '').trim();
        if (!id || !validSet.has(id) || seen.has(id)) continue;
        seen.add(id);
        const wRaw = typeof cell === 'object' && cell !== null ? Number(cell.w) : 1;
        const w = Number.isFinite(wRaw) && wRaw > 0 ? Math.round(Math.max(0.15, Math.min(10, wRaw)) * 1000) / 1000 : 1;
        cleanRow.push({ id, w });
      }
      if (cleanRow.length > 0) rows.push(cleanRow);
    }
  }

  const missing = allIds.map(String).filter((id) => !seen.has(id));
  for (const id of missing) {
    if (defaultPerRow > 1 && rows.length > 0 && rows[rows.length - 1].length < defaultPerRow) {
      rows[rows.length - 1].push({ id, w: 1 });
    } else {
      rows.push([{ id, w: 1 }]);
    }
  }
  return rows;
}

function migrateFlatToRows(orderIds, spansMap = {}, mode = 'single', defaultPerRow = 1) {
  const rows = [];
  if (mode === 'section') {
    let curPair = [];
    for (const id of orderIds) {
      if (spansMap?.[id] === 1) {
        curPair.push({ id: String(id), w: 1 });
        if (curPair.length === 2) {
          rows.push(curPair);
          curPair = [];
        }
      } else {
        if (curPair.length > 0) {
          rows.push(curPair);
          curPair = [];
        }
        rows.push([{ id: String(id), w: 1 }]);
      }
    }
    if (curPair.length > 0) rows.push(curPair);
    return rows;
  }

  let curRow = [];
  const cap = defaultPerRow;
  for (const id of orderIds) {
    const sid = String(id);
    const span = Number(spansMap?.[sid] || 1);
    if (span >= cap) {
      if (curRow.length > 0) {
        rows.push(curRow);
        curRow = [];
      }
      rows.push([{ id: sid, w: 1 }]);
    } else {
      if (curRow.reduce((s, x) => s + x.w, 0) + span > cap && curRow.length > 0) {
        rows.push(curRow);
        curRow = [];
      }
      curRow.push({ id: sid, w: span });
    }
  }
  if (curRow.length > 0) {
    rows.push(curRow);
  }
  return rows;
}

function sanitizeHeightMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k || '').trim();
    const h = Number(v);
    if (key && Number.isFinite(h) && h >= 80 && h <= 1600) {
      out[key] = Math.round(h);
    }
  }
  return out;
}

function sanitizeWidthMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k || '').trim();
    const pct = Number(v);
    if (key && Number.isFinite(pct) && pct >= 20 && pct < 99.5) {
      out[key] = Math.round(pct * 10) / 10;
    }
  }
  return out;
}

function sanitizeManualSizes(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k || '').trim();
    if (!key || !v || typeof v !== 'object') continue;
    const wRaw = v.w === null || v.w === undefined || v.w === '' ? null : Number(v.w);
    const hRaw = v.h === null || v.h === undefined || v.h === '' ? null : Number(v.h);
    const w = wRaw !== null && Number.isFinite(wRaw) ? Math.round(Math.max(60, Math.min(3840, wRaw))) : null;
    const h = hRaw !== null && Number.isFinite(hRaw) ? Math.round(Math.max(48, Math.min(2000, hRaw))) : null;
    if (w !== null || h !== null) {
      out[key] = { w, h };
    }
  }
  return out;
}

function sanitizePageSize(val, fallback = 25) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.max(1, Math.min(500, Math.round(n)));
}

function sanitizePalette(raw) {
  const validPresets = new Set(['indigo', 'slate', 'sand', 'taupe', 'sage', 'sky', 'ocean', 'custom']);
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {
    preset: validPresets.has(src.preset) ? src.preset : 'indigo',
  };
  for (const k of ['primary', 'accent', 'positive', 'negative', 'bg', 'card']) {
    if (typeof src[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(src[k])) {
      out[k] = src[k].toLowerCase();
    }
  }
  return out;
}

function saveDashboardLayout(db, layoutPayload = {}) {
  const defaultSections = ['kpis', 'banks', 'charts', 'ledger'];
  const coreKpis = ['kpi-networth', 'kpi-income', 'kpi-expense', 'kpi-cashflow'];
  const extraKpis = [
    'kpi-savings-rate',
    'kpi-daily-avg',
    'kpi-top-merchant',
    'kpi-biggest-expense',
    'kpi-recurring',
    'kpi-tx-activity',
  ];
  const defaultKpis = [...coreKpis, ...extraKpis];
  const coreCharts = ['chart-monthly', 'chart-donut', 'chart-income', 'chart-balance'];
  const extraCharts = ['chart-net-trend', 'chart-daily-spend', 'chart-weekday', 'chart-bank-dist'];
  const defaultCharts = [...coreCharts, ...extraCharts];

  const validSections = new Set(defaultSections);
  const validKpis = new Set(defaultKpis);
  const validCharts = new Set(defaultCharts);

  const collectRowIds = (rows) => {
    const out = new Set();
    if (Array.isArray(rows)) {
      for (const r of rows) {
        if (!Array.isArray(r)) continue;
        for (const c of r) {
          const id = String(typeof c === 'object' && c !== null ? c.id : c || '').trim();
          if (id) out.add(id);
        }
      }
    }
    return out;
  };

  const mentionedKpis = new Set([
    ...sanitizeStringArray(layoutPayload.kpiOrder, validKpis),
    ...collectRowIds(layoutPayload.kpiRows),
  ]);
  const mentionedCharts = new Set([
    ...sanitizeStringArray(layoutPayload.chartOrder, validCharts),
    ...collectRowIds(layoutPayload.chartRows),
  ]);

  const rawSectionOrder = sanitizeStringArray(layoutPayload.sectionOrder, validSections);
  for (const s of defaultSections) {
    if (!rawSectionOrder.includes(s)) rawSectionOrder.push(s);
  }
  const rawKpiOrder = sanitizeStringArray(layoutPayload.kpiOrder, validKpis);
  for (const k of coreKpis) {
    if (!rawKpiOrder.includes(k)) rawKpiOrder.push(k);
  }
  for (const k of extraKpis) {
    if (mentionedKpis.has(k) && !rawKpiOrder.includes(k)) rawKpiOrder.push(k);
  }
  const rawChartOrder = sanitizeStringArray(layoutPayload.chartOrder, validCharts);
  for (const c of coreCharts) {
    if (!rawChartOrder.includes(c)) rawChartOrder.push(c);
  }
  for (const c of extraCharts) {
    if (mentionedCharts.has(c) && !rawChartOrder.includes(c)) rawChartOrder.push(c);
  }

  const allAccIds = db.prepare('SELECT id FROM accounts ORDER BY sort_order ASC, id ASC').all().map((a) => Number(a.id));
  const rawBankOrder = Array.isArray(layoutPayload.bankOrder)
    ? layoutPayload.bankOrder.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const mergedBankIds = [...rawBankOrder];
  for (const id of allAccIds) {
    if (!mergedBankIds.includes(id)) mergedBankIds.push(id);
  }

  const cleanSectionSpans = sanitizeSectionSpanMap(layoutPayload.sectionSpans, validSections);
  const cleanKpiSpans = sanitizeSpanMap(layoutPayload.kpiSpans, validKpis);
  const cleanChartSpans = sanitizeSpanMap(layoutPayload.chartSpans, validCharts);
  const cleanBankSpans = sanitizeBankSpanMap(layoutPayload.bankSpans);

  const sectionRows = Array.isArray(layoutPayload.sectionRows)
    ? sanitizeRowList(layoutPayload.sectionRows, rawSectionOrder, 1)
    : migrateFlatToRows(rawSectionOrder, cleanSectionSpans, 'section', 2);

  const kpiRows = Array.isArray(layoutPayload.kpiRows)
    ? sanitizeRowList(layoutPayload.kpiRows, rawKpiOrder, 4)
    : migrateFlatToRows(rawKpiOrder, cleanKpiSpans, 'kpi', 4);

  const chartRows = Array.isArray(layoutPayload.chartRows)
    ? sanitizeRowList(layoutPayload.chartRows, rawChartOrder, 2)
    : migrateFlatToRows(rawChartOrder, cleanChartSpans, 'chart', 2);

  const bankRows = Array.isArray(layoutPayload.bankRows)
    ? sanitizeRowList(layoutPayload.bankRows, mergedBankIds.map(String), 3)
    : migrateFlatToRows(mergedBankIds.map(String), cleanBankSpans, 'bank', 3);

  const sectionOrder = sectionRows.flatMap((r) => r.map((c) => c.id));
  const kpiOrder = kpiRows.flatMap((r) => r.map((c) => c.id));
  const chartOrder = chartRows.flatMap((r) => r.map((c) => c.id));
  const bankOrder = bankRows.flatMap((r) => r.map((c) => Number(c.id))).filter((n) => Number.isInteger(n) && n > 0);

  const hiddenKpis = sanitizeStringArray(layoutPayload.hiddenKpis, validKpis);
  for (const k of extraKpis) {
    if (!mentionedKpis.has(k) && !hiddenKpis.includes(k)) {
      hiddenKpis.push(k);
    }
  }
  const hiddenCharts = sanitizeStringArray(layoutPayload.hiddenCharts, validCharts);
  for (const c of extraCharts) {
    if (!mentionedCharts.has(c) && !hiddenCharts.includes(c)) {
      hiddenCharts.push(c);
    }
  }

  const cleanLayout = {
    lang: layoutPayload.lang === 'hu' ? 'hu' : 'en',
    palette: sanitizePalette(layoutPayload.palette),
    sectionRows,
    kpiRows,
    chartRows,
    bankRows,
    autoSize: layoutPayload.autoSize !== false,
    manualSizes: sanitizeManualSizes(layoutPayload.manualSizes),
    itemHeights: sanitizeHeightMap(layoutPayload.itemHeights),
    itemWidths: sanitizeWidthMap(layoutPayload.itemWidths),
    sectionOrder,
    hiddenSections: sanitizeStringArray(layoutPayload.hiddenSections, validSections),
    sectionSpans: cleanSectionSpans,
    kpiOrder,
    hiddenKpis,
    kpiSpans: cleanKpiSpans,
    chartOrder,
    hiddenCharts,
    chartSpans: cleanChartSpans,
    bankOrder,
    bankSpans: cleanBankSpans,
    hideHistorical: Boolean(layoutPayload.hideHistorical),
    ledgerPageSize: sanitizePageSize(layoutPayload.ledgerPageSize, 25),
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    if (bankOrder.length > 0) {
      const stmt = db.prepare('UPDATE accounts SET sort_order = ? WHERE id = ?');
      bankOrder.forEach((accId, idx) => {
        stmt.run(idx, accId);
      });
      const allAcc = db.prepare('SELECT id FROM accounts ORDER BY sort_order ASC, id ASC').all();
      let nextOrder = bankOrder.length;
      const mentioned = new Set(bankOrder);
      for (const row of allAcc) {
        if (!mentioned.has(row.id)) {
          stmt.run(nextOrder++, row.id);
        }
      }
    }
    setSetting(db, 'dashboard_layout', JSON.stringify(cleanLayout));
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
  return cleanLayout;
}

module.exports = {
  ensureTransactionNote,
  formatReceiptItemText,
  buildReceiptAutoNote,
  expandNoteWithReceiptDetails,
  recalculateAllBalances,
  getLocalIsoDate,
  getLocalIsoDateTime,
  normalizeTxDate,
  createTransaction,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
  approveTransaction,
  approveAllTransactions,
  bulkManageTransactions,
  syncPocketBalance,
  getDashboardData,
  saveDashboardLayout,
  upsertCounterparty,
  updateCounterparty,
  deleteCounterparty,
  listCounterparties,
  isGenericCounterpartyName,
  cleanRawMerchantString,
  scoreCounterpartySimilarity,
  findBestMatchingCounterparty,
  updateAccount,
  deleteAccount,
  updatePocket,
  deletePocket,
};
