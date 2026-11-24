'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { getFxRates, getSetting, setSetting, seedCounterpartiesFromTransactions } = require('./db');
const { convertCurrency, normalizeCurrency, roundCurrency } = require('./fx');
const { parseFxRates } = require('./fx');
const {
  ensureTransactionNote,
  recalculateAllBalances,
  normalizeTxDate,
  upsertCounterparty,
} = require('./ledger');

function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Minimal pure-Node ZIP extractor using Central Directory + zlib.inflateRawSync.
 */
function unzipEntries(buffer) {
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid .xlsx file: ZIP directory not found.');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > buffer.length) break;
    const sig = buffer.readUInt32LE(cursor);
    if (sig !== 0x02014b50) break;

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    const fileName = buffer.slice(cursor + 46, cursor + 46 + fileNameLen).toString('utf8');
    cursor += 46 + fileNameLen + extraLen + commentLen;

    if (localHeaderOffset + 30 <= buffer.length && buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const lNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const lExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const compressedData = buffer.slice(dataStart, dataStart + compressedSize);

      if (method === 0) {
        entries.set(fileName, compressedData);
      } else if (method === 8) {
        try {
          entries.set(fileName, zlib.inflateRawSync(compressedData));
        } catch {
          // ignore malformed entry
        }
      }
    }
  }

  return entries;
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const strings = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRegex.exec(xmlText)) !== null) {
    const inner = match[1];
    const parts = [];
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      parts.push(decodeXmlEntities(tMatch[1]));
    }
    strings.push(parts.join(''));
  }
  return strings;
}

function parseDateStyleIndices(stylesXml) {
  const dateStyleIndices = new Set();
  if (!stylesXml) return dateStyleIndices;

  const customDateFmtIds = new Set();
  const numFmtRegex = /<numFmt\b([^>]*?)\/?>/g;
  let m;
  while ((m = numFmtRegex.exec(stylesXml)) !== null) {
    const attrs = m[1];
    const idM = /numFmtId="(\d+)"/.exec(attrs);
    const codeM = /formatCode="([^"]*)"/.exec(attrs);
    if (idM && codeM) {
      const code = codeM[1].toLowerCase();
      if ((code.includes('yy') || code.includes('dd')) && !code.includes('#') && !code.includes('0.0')) {
        customDateFmtIds.add(Number(idM[1]));
      }
    }
  }

  const cellXfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (cellXfsMatch) {
    const xfRegex = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
    let idx = 0;
    let xf;
    while ((xf = xfRegex.exec(cellXfsMatch[1])) !== null) {
      const numFmtM = /numFmtId="(\d+)"/.exec(xf[1]);
      if (numFmtM) {
        const fid = Number(numFmtM[1]);
        if ((fid >= 14 && fid <= 22) || customDateFmtIds.has(fid)) {
          dateStyleIndices.add(idx);
        }
      }
      idx += 1;
    }
  }
  return dateStyleIndices;
}

function colRefToIndex(ref) {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, col - 1);
}

function excelSerialToIsoDate(serial) {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseWorksheetRows(sheetXml, sharedStrings, dateStyleIndices) {
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rMatch;

  while ((rMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowCells = [];
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cMatch;
    let fallbackCol = 0;

    while ((cMatch = cellRegex.exec(rMatch[1])) !== null) {
      const attrs = cMatch[1];
      const inner = cMatch[2] || '';

      const rAttr = /\br="([A-Z]+\d+)"/i.exec(attrs);
      const colIdx = rAttr ? colRefToIndex(rAttr[1]) : fallbackCol;
      fallbackCol = colIdx + 1;

      const tAttr = /\bt="([^"]+)"/.exec(attrs);
      const sAttr = /\bs="(\d+)"/.exec(attrs);
      const cellType = tAttr ? tAttr[1] : 'n';
      const styleIdx = sAttr ? Number(sAttr[1]) : -1;

      let value = '';
      if (cellType === 'inlineStr') {
        const parts = [];
        const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tm;
        while ((tm = tRegex.exec(inner)) !== null) parts.push(decodeXmlEntities(tm[1]));
        value = parts.join('');
      } else {
        const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        const rawV = vMatch ? decodeXmlEntities(vMatch[1]) : '';
        if (cellType === 's') {
          const idx = Number(rawV);
          value = sharedStrings[idx] ?? '';
        } else if (cellType === 'b') {
          value = rawV === '1' ? 'TRUE' : 'FALSE';
        } else if (cellType === 'str' || cellType === 'e') {
          value = rawV;
        } else {
          const num = Number(rawV);
          if (rawV !== '' && Number.isFinite(num) && dateStyleIndices.has(styleIdx)) {
            value = excelSerialToIsoDate(num) || rawV;
          } else {
            value = rawV;
          }
        }
      }

      while (rowCells.length <= colIdx) rowCells.push('');
      rowCells[colIdx] = String(value ?? '').trim();
    }

    if (rowCells.some((cell) => cell !== '')) {
      rows.push(rowCells);
    }
  }

  return rows;
}

function parseXlsxBuffer(buffer) {
  const entries = unzipEntries(buffer);
  const sharedStringsXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const stylesXml = entries.get('xl/styles.xml')?.toString('utf8') || '';
  const dateStyleIndices = parseDateStyleIndices(stylesXml);

  const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8') || '';
  const relsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';

  const relMap = new Map();
  const relRegex = /<Relationship\b([^>]*?)\/?>/g;
  let rm;
  while ((rm = relRegex.exec(relsXml)) !== null) {
    const idM = /\bId="([^"]+)"/.exec(rm[1]);
    const targetM = /\bTarget="([^"]+)"/.exec(rm[1]);
    if (idM && targetM) {
      let target = targetM[1].replace(/^\/+/, '');
      if (!target.startsWith('xl/')) target = `xl/${target}`;
      relMap.set(idM[1], target);
    }
  }

  const sheets = [];
  const sheetRegex = /<sheet\b([^>]*?)\/?>/g;
  let sm;
  while ((sm = sheetRegex.exec(workbookXml)) !== null) {
    const nameM = /\bname="([^"]+)"/.exec(sm[1]);
    const ridM = /\br:id="([^"]+)"/.exec(sm[1]);
    const sheetName = nameM ? decodeXmlEntities(nameM[1]) : `Sheet ${sheets.length + 1}`;
    const targetPath = ridM ? relMap.get(ridM[1]) : null;
    if (targetPath && entries.has(targetPath)) {
      const sheetXml = entries.get(targetPath).toString('utf8');
      const rows = parseWorksheetRows(sheetXml, sharedStrings, dateStyleIndices);
      sheets.push({ name: sheetName, rows });
    }
  }

  if (sheets.length === 0) {
    for (const [name, buf] of entries.entries()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) {
        const rows = parseWorksheetRows(buf.toString('utf8'), sharedStrings, dateStyleIndices);
        sheets.push({ name: name.split('/').pop(), rows });
      }
    }
  }

  return sheets;
}

function detectDelimiter(text) {
  const sampleLines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  const candidates = [',', ';', '\t'];
  let bestDelim = ',';
  let bestScore = -1;

  for (const delim of candidates) {
    const counts = [];
    for (const line of sampleLines) {
      let inQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === delim && !inQuotes) count += 1;
      }
      counts.push(count);
    }
    const total = counts.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const consistent = counts.every((c) => c === counts[0]) ? 10 : 0;
      const score = total + consistent;
      if (score > bestScore) {
        bestScore = score;
        bestDelim = delim;
      }
    }
  }
  return bestDelim;
}

function parseCsvText(rawText) {
  const text = rawText.replace(/^\uFEFF/, '');
  const delim = detectDelimiter(text);
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentField.trim());
      if (currentRow.some((c) => c !== '')) rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentField.trim());
      if (currentRow.some((c) => c !== '')) rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((c) => c !== '')) rows.push(currentRow);
  }

  return rows;
}

function parseSpreadsheetFile(buffer, filename = 'import.csv') {
  const lower = String(filename || '').toLowerCase();
  const isZipMagic = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

  if (lower.endsWith('.xlsx') || isZipMagic) {
    const sheets = parseXlsxBuffer(buffer);
    if (sheets.length === 0) throw new Error('No worksheets found inside .xlsx file.');
    return { format: 'xlsx', sheets };
  }

  const text = buffer.toString('utf8');
  const rows = parseCsvText(text);
  return { format: 'csv', sheets: [{ name: 'Sheet1', rows }] };
}

function parseRecordedBalance(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw || raw === '-') return null;
  const parsed = parseAmountAndCurrency(raw);
  if (!Number.isFinite(parsed.amount)) return null;
  return parsed.isNegative ? -parsed.amount : parsed.amount;
}

/**
 * Parse international currency strings like "-12 450,50 Ft", "€24.99", "(3 500)"
 */
function parseAmountAndCurrency(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return { amount: NaN, isNegative: false, detectedCurrency: null };

  let detectedCurrency = null;
  if (/€|\beur\b/i.test(raw)) detectedCurrency = 'EUR';
  else if (/\$|\busd\b/i.test(raw)) detectedCurrency = 'USD';
  else if (/£|\bgbp\b/i.test(raw)) detectedCurrency = 'GBP';
  else if (/ft\b|\bhuf\b|forint/i.test(raw)) detectedCurrency = 'HUF';

  const isAccountingNegative = /^\(.*\)$/.test(raw);
  const hasMinus = raw.includes('-');
  const isNegative = isAccountingNegative || hasMinus;

  let cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return { amount: NaN, isNegative, detectedCurrency };

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    const decimals = cleaned.length - lastComma - 1;
    if (decimals === 1 || decimals === 2) {
      cleaned = cleaned.replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastDot !== -1) {
    const decimals = cleaned.length - lastDot - 1;
    if (decimals === 3 && cleaned.split('.').length > 1) {
      cleaned = cleaned.replace(/\./g, '');
    }
  }

  const num = Number(cleaned);
  return {
    amount: Number.isFinite(num) ? Math.abs(num) : NaN,
    isNegative,
    detectedCurrency,
  };
}

function parseFlexibleDate(rawDate) {
  const s = String(rawDate || '').trim();
  if (!s) return null;

  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const iso = excelSerialToIsoDate(Number(s));
    if (iso) return iso;
  }

  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const yyyy = m[1];
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    if (m[4] && m[5]) {
      return `${yyyy}-${mm}-${dd}T${m[4].padStart(2, '0')}:${m[5]}`;
    }
    return `${yyyy}-${mm}-${dd}`;
  }

  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[T\s]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    if (m[4] && m[5]) {
      return `${yyyy}-${mm}-${dd}T${m[4].padStart(2, '0')}:${m[5]}`;
    }
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeImportedCategory(rawCategory, type, categories) {
  const raw = String(rawCategory || '').trim();
  if (!raw) {
    const fallbackName =
      type === 'income' ? 'Other Income' : type === 'transfer' ? 'Internal Transfer' : 'Other Expense';
    return categories.find((c) => c.name === fallbackName) || null;
  }
  const lower = raw.toLowerCase();
  const direct =
    categories.find((c) => c.name.toLowerCase() === lower && c.type === type) ||
    categories.find((c) => c.name.toLowerCase() === lower);
  if (direct) return direct;

  const findByName = (name) => categories.find((c) => c.name === name) || null;

  if (type === 'transfer') {
    if (lower.includes('reimb') || lower.includes('vissza')) return findByName('Pocket Reimbursement');
    if (lower.includes('sav') || lower.includes('felre') || lower.includes('megtakar')) return findByName('Savings / Set Aside');
    if (lower.includes('bank')) return findByName('Bank-to-Bank Transfer');
    if (lower.includes('pocket') || lower.includes('zseb')) return findByName('Pocket-to-Pocket Transfer');
    return findByName('Internal Transfer');
  }

  if (lower.includes('work') || lower.includes('salary') || lower.includes('fizetés') || lower.includes('fizetes') || lower.includes('munka') || lower.includes('bér')) {
    return findByName('Work / Salary');
  }
  if (lower.includes('scholar') || lower.includes('ösztöndíj') || lower.includes('osztondij')) {
    return findByName('Scholarship');
  }
  if (lower.includes('family') || lower.includes('gift') || lower.includes('család') || lower.includes('csalad') || lower.includes('ajándék') || lower.includes('ajandek')) {
    return findByName('Family & Gifts');
  }
  if (lower.includes('tech') || lower.includes('gadget') || lower.includes('elektron') || lower.includes('pc') || lower.includes('laptop') || lower.includes('phone')) {
    return findByName('Tech & Electronics');
  }
  if (lower.includes('fuel') || lower.includes('gas') || lower.includes('benzin') || lower.includes('üzemanyag') || lower.includes('uzemanyag') || lower.includes('transport')) {
    return findByName('Fuel & Transport');
  }
  if (lower.includes('shop') || lower.includes('bevasarl') || lower.includes('bevásárl') || lower.includes('grocer') || lower.includes('bolt')) {
    return findByName('Shopping');
  }
  if (lower.includes('food') || lower.includes('étel') || lower.includes('etel') || lower.includes('dining') || lower.includes('restaur')) {
    return findByName('Food & Dining');
  }
  if (lower.includes('bill') || lower.includes('rezsi') || lower.includes('subscr') || lower.includes('előfizetés')) {
    return findByName('Bills & Subscriptions');
  }
  if (lower.includes('entertain') || lower.includes('szórakoz') || lower.includes('mozi')) {
    return findByName('Entertainment');
  }
  if (lower.includes('health') || lower.includes('egészség') || lower.includes('patika') || lower.includes('gym')) {
    return findByName('Health & Fitness');
  }

  return findByName(type === 'income' ? 'Other Income' : 'Other Expense');
}

function normStr(val) {
  return String(val || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function suggestColumnMapping(headers) {
  const mapping = {
    date: -1,
    amount: -1,
    type: -1,
    category: -1,
    account: -1,
    pocket: -1,
    destAccount: -1,
    destPocket: -1,
    destAmount: -1,
    merchant: -1,
    note: -1,
    currency: -1,
    storeAddress: -1,
    itemsJson: -1,
    isHistorical: -1,
    isRecurring: -1,
    excludeFromAnalytics: -1,
    isHidden: -1,
    pocketBalanceAfter: -1,
  };

  const normalizedHeaders = headers.map((header) =>
    String(header || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .trim()
  );

  const usedCols = new Set();

  // Pass 1: exact / compound headers first so they never collide with short names
  const exactOrder = [
    ['destAccount', ['destbank', 'destaccount', 'destinationbank', 'destinationaccount', 'tobank', 'toaccount']],
    ['destPocket', ['destpocket', 'destinationpocket', 'topocket']],
    ['destAmount', ['destamount', 'destinationamount', 'receivedamount']],
    ['pocketBalanceAfter', ['pocketbalanceafter', 'balanceafter', 'recordedpocketbalanceafter', 'closingbalance']],
    ['storeAddress', ['storeaddress', 'address', 'cim']],
    ['itemsJson', ['itemsjson', 'items']],
    ['isHistorical', ['ishistorical', 'historical']],
    ['isRecurring', ['isrecurring', 'recurring']],
    ['excludeFromAnalytics', ['excludefromanalytics']],
    ['isHidden', ['ishidden', 'hidden']],
  ];

  for (const [field, exactNames] of exactOrder) {
    const idx = normalizedHeaders.findIndex((norm, i) => !usedCols.has(i) && exactNames.includes(norm));
    if (idx !== -1) {
      mapping[field] = idx;
      usedCols.add(idx);
    }
  }

  // Pass 2: primary fields
  const matchers = {
    date: ['date', 'datum', 'time', 'idopont', 'timestamp', 'when'],
    amount: ['amount', 'osszeg', 'sum', 'value', 'price', 'ar', 'total', 'ertek'],
    type: ['type', 'tipus', 'kind', 'direction', 'irany'],
    category: ['category', 'kategoria', 'cat', 'group', 'csoport'],
    account: ['bank', 'account', 'szamla'],
    pocket: ['pocket', 'zseb', 'vault', 'alszamla', 'subaccount'],
    merchant: ['merchant', 'partner', 'store', 'bolt', 'uzlet', 'payee', 'sender', 'recipient', 'title', 'megnevezes'],
    note: ['note', 'notes', 'megjegyzes', 'comment', 'description', 'leiras', 'memo'],
    currency: ['currency', 'deviza', 'penznem', 'curr'],
  };

  normalizedHeaders.forEach((norm, idx) => {
    if (!norm || usedCols.has(idx)) return;
    for (const [field, keywords] of Object.entries(matchers)) {
      if (mapping[field] !== -1) continue;
      if (keywords.some((kw) => norm === kw || norm.includes(kw))) {
        mapping[field] = idx;
        usedCols.add(idx);
        break;
      }
    }
  });

  return mapping;
}

function previewImport(buffer, filename, sheetIndex = 0) {
  const parsed = parseSpreadsheetFile(buffer, filename);
  const idx = Math.max(0, Math.min(Number(sheetIndex) || 0, parsed.sheets.length - 1));
  const activeSheet = parsed.sheets[idx];
  const rows = activeSheet.rows || [];
  if (rows.length === 0) {
    throw new Error('Selected worksheet is empty.');
  }

  const headers = rows[0].map((h, i) => h || `Column ${i + 1}`);
  const dataRows = rows.slice(1);
  const suggestedMapping = suggestColumnMapping(headers);

  return {
    format: parsed.format,
    sheets: parsed.sheets.map((s, i) => ({ index: i, name: s.name, rowCount: Math.max(0, s.rows.length - 1) })),
    selectedSheetIndex: idx,
    headers,
    suggestedMapping,
    totalRows: dataRows.length,
    previewRows: dataRows.slice(0, 25),
  };
}

function parseBoolCell(val, fallback = 0) {
  const raw = String(val ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'igen') return 1;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'nem') return 0;
  return fallback;
}

function makeUniqueSlug(name, existingSlugsSet) {
  const base = normStr(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bank';
  let candidate = base;
  let counter = 2;
  while (existingSlugsSet.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  existingSlugsSet.add(candidate);
  return candidate;
}

function commitImport(db, buffer, filename, options = {}) {
  const parsed = parseSpreadsheetFile(buffer, filename);
  const idx = Math.max(0, Math.min(Number(options.sheetIndex) || 0, parsed.sheets.length - 1));
  const rows = parsed.sheets[idx].rows || [];
  if (rows.length < 2) {
    throw new Error('No data rows to import.');
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const mapping = options.mapping || suggestColumnMapping(headers);
  const defaultPocketId = Number(options.defaultPocketId);

  const accounts = db.prepare('SELECT * FROM accounts').all();
  const pockets = db.prepare('SELECT * FROM pockets').all();
  const categories = db.prepare('SELECT * FROM categories').all();
  const existingSlugs = new Set(accounts.map((a) => String(a.slug || '').toLowerCase()));

  const defaultPocket =
    pockets.find((p) => p.id === defaultPocketId) ||
    pockets.find((p) => p.is_default === 1 && !p.is_archived) ||
    pockets[0];
  if (!defaultPocket) {
    throw new Error('Default pocket not found.');
  }
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const fxRates = getFxRates(db);

  const insertAccountStmt = db.prepare(
    'INSERT INTO accounts (name, slug, currency, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertPocketStmt = db.prepare(
    'INSERT INTO pockets (account_id, name, currency, initial_balance, current_balance, color, icon, is_default) VALUES (?, ?, ?, 0, 0, ?, ?, ?)'
  );
  let nextAccountSort = accounts.reduce((m, a) => Math.max(m, Number(a.sort_order || 0)), 0) + 1;

  const getOrCreateAccountAndPocket = (accNameRaw, pocketNameRaw, rowCurrency) => {
    const cleanAcc = String(accNameRaw || '').trim();
    const cleanPocket = String(pocketNameRaw || '').trim();

    if (!cleanAcc && !cleanPocket) {
      return { account: accountById.get(defaultPocket.account_id), pocket: defaultPocket };
    }

    let targetAccount = null;
    if (cleanAcc) {
      const nAcc = normStr(cleanAcc);
      targetAccount =
        accounts.find((a) => normStr(a.name) === nAcc || normStr(a.slug) === nAcc) ||
        accounts.find((a) => nAcc.includes(normStr(a.name)));
      if (!targetAccount) {
        const slug = makeUniqueSlug(cleanAcc, existingSlugs);
        const cur = normalizeCurrency(rowCurrency || defaultPocket.currency, defaultPocket.currency);
        const r = insertAccountStmt.run(cleanAcc, slug, cur, '#6366f1', 'landmark', nextAccountSort++);
        targetAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(r.lastInsertRowid));
        accounts.push(targetAccount);
        accountById.set(targetAccount.id, targetAccount);

        const defName = cleanPocket || 'Main';
        const pRes = insertPocketStmt.run(targetAccount.id, defName, cur, targetAccount.color, 'wallet', 1);
        const createdPocket = db.prepare('SELECT * FROM pockets WHERE id = ?').get(Number(pRes.lastInsertRowid));
        pockets.push(createdPocket);
        return { account: targetAccount, pocket: createdPocket };
      }
    }

    let targetPocket = null;
    if (cleanPocket) {
      const nPocket = normStr(cleanPocket);
      const pool = targetAccount ? pockets.filter((p) => p.account_id === targetAccount.id) : pockets;
      targetPocket =
        pool.find((p) => normStr(p.name) === nPocket) ||
        pool.find((p) => normStr(p.name).includes(nPocket));
      if (!targetPocket) {
        const parentAcc = targetAccount || accountById.get(defaultPocket.account_id);
        const cur = normalizeCurrency(rowCurrency || parentAcc.currency, parentAcc.currency);
        const hasAnyPocket = pockets.some((p) => p.account_id === parentAcc.id);
        const pRes = insertPocketStmt.run(parentAcc.id, cleanPocket, cur, parentAcc.color || '#6366f1', 'wallet', hasAnyPocket ? 0 : 1);
        targetPocket = db.prepare('SELECT * FROM pockets WHERE id = ?').get(Number(pRes.lastInsertRowid));
        pockets.push(targetPocket);
        targetAccount = parentAcc;
      }
    }

    if (!targetPocket && targetAccount) {
      targetPocket =
        pockets.find((p) => p.account_id === targetAccount.id && p.is_default === 1) ||
        pockets.find((p) => p.account_id === targetAccount.id);
    }

    if (!targetPocket) {
      targetPocket = defaultPocket;
    }
    if (!targetAccount) {
      targetAccount = accountById.get(targetPocket.account_id);
    }
    return { account: targetAccount, pocket: targetPocket };
  };

  let importedCount = 0;
  let skippedCount = 0;
  const skippedReasons = [];
  const countsByType = { income: 0, expense: 0, transfer: 0, adjustment: 0 };

  const insertStmt = db.prepare(
    `INSERT INTO transactions (
      date, type, amount, currency, account_id, pocket_id,
      dest_account_id, dest_pocket_id, dest_amount,
      category_id, category_name, merchant, note, note_source,
      items_json, receipt_path, store_address, is_historical, is_recurring,
      exclude_from_analytics, is_hidden,
      recorded_pocket_balance_after, recorded_dest_pocket_balance_after, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    for (let rIdx = 0; rIdx < dataRows.length; rIdx += 1) {
      const row = dataRows[rIdx];
      const getVal = (colIdx) => (colIdx !== undefined && colIdx >= 0 && colIdx < row.length ? row[colIdx] : '');

      const rawDate = getVal(mapping.date);
      const rawAmount = getVal(mapping.amount);
      const parsedAmt = parseAmountAndCurrency(rawAmount);

      const rawType = String(getVal(mapping.type) || '').toLowerCase();
      let type = options.defaultType === 'income' ? 'income' : 'expense';
      if (rawType.includes('adjust') || rawType.includes('sync')) {
        type = 'adjustment';
      } else if (rawType.includes('trans') || rawType.includes('atvezet') || rawType.includes('átvezet')) {
        type = 'transfer';
      } else if (
        rawType.includes('inc') ||
        rawType.includes('bevetel') ||
        rawType.includes('bevétel') ||
        rawType.includes('credit') ||
        rawType === '+'
      ) {
        type = 'income';
      } else if (
        rawType.includes('exp') ||
        rawType.includes('kiadas') ||
        rawType.includes('kiadás') ||
        rawType.includes('out') ||
        rawType.includes('debit') ||
        rawType === '-'
      ) {
        type = 'expense';
      } else if (parsedAmt.isNegative) {
        type = 'expense';
      } else if (!rawType && !parsedAmt.isNegative && options.defaultType !== 'expense') {
        const catHint = String(getVal(mapping.category) || '').toLowerCase();
        if (
          catHint.includes('work') ||
          catHint.includes('salary') ||
          catHint.includes('scholar') ||
          catHint.includes('gift') ||
          catHint.includes('family') ||
          catHint.includes('income') ||
          catHint.includes('bevétel') ||
          catHint.includes('fizetés') ||
          catHint.includes('ösztöndíj')
        ) {
          type = 'income';
        }
      }

      if (!Number.isFinite(parsedAmt.amount) || (type !== 'adjustment' && parsedAmt.amount <= 0)) {
        skippedCount += 1;
        skippedReasons.push(`Row ${rIdx + 2}: missing/zero amount ("${rawAmount}")`);
        continue;
      }

      const date = parseFlexibleDate(rawDate) || normalizeTxDate(null);
      const rawNoteVal = getVal(mapping.note) || '';
      const rawNote = rawNoteVal.trim() === '-' ? '' : rawNoteVal.trim();
      const rawCurrency = getVal(mapping.currency);
      const detectedCur = normalizeCurrency(rawCurrency || parsedAmt.detectedCurrency || defaultPocket.currency);

      const resolved = getOrCreateAccountAndPocket(getVal(mapping.account), getVal(mapping.pocket), detectedCur);
      const account = resolved.account;
      const pocket = resolved.pocket;

      let destAccount = null;
      let destPocket = null;
      let destAmount = null;

      if (type === 'transfer') {
        const rawDestAcc = getVal(mapping.destAccount);
        const rawDestPocket = getVal(mapping.destPocket);
        if (rawDestAcc || rawDestPocket) {
          const dst = getOrCreateAccountAndPocket(rawDestAcc, rawDestPocket, detectedCur);
          if (dst.pocket && dst.pocket.id !== pocket.id) {
            destAccount = dst.account;
            destPocket = dst.pocket;
          }
        }
        if (!destPocket) {
          const fallbackAlt = pockets.find((p) => p.id !== pocket.id && !p.is_archived);
          if (fallbackAlt) {
            destPocket = fallbackAlt;
            destAccount = accountById.get(fallbackAlt.account_id);
          } else {
            type = 'expense';
          }
        }
      }

      const rawCat = getVal(mapping.category);
      const category = normalizeImportedCategory(rawCat, type, categories);
      const merchant = String(getVal(mapping.merchant) || '').trim();

      const categoryId = category ? category.id : null;
      const categoryName =
        type === 'adjustment'
          ? 'Balance Sync'
          : category?.name || (type === 'income' ? 'Other Income' : type === 'transfer' ? 'Internal Transfer' : 'Other Expense');

      const rowCurrency = normalizeCurrency(rawCurrency || parsedAmt.detectedCurrency || pocket.currency, pocket.currency);
      let finalAmount = parsedAmt.amount;
      if (rowCurrency !== pocket.currency && type !== 'adjustment') {
        finalAmount = convertCurrency(parsedAmt.amount, rowCurrency, pocket.currency, fxRates);
      }
      finalAmount = roundCurrency(finalAmount, pocket.currency);

      if (type === 'transfer' && destPocket) {
        const rawDestAmt = parseAmountAndCurrency(getVal(mapping.destAmount));
        destAmount =
          Number.isFinite(rawDestAmt.amount) && rawDestAmt.amount > 0
            ? roundCurrency(rawDestAmt.amount, destPocket.currency)
            : convertCurrency(finalAmount, pocket.currency, destPocket.currency, fxRates);
      }

      let itemsArr = [];
      const rawItems = getVal(mapping.itemsJson);
      if (rawItems) {
        try {
          const parsedItems = JSON.parse(rawItems);
          if (Array.isArray(parsedItems)) itemsArr = parsedItems;
        } catch {
          itemsArr = [];
        }
      }
      const storeAddress = String(getVal(mapping.storeAddress) || '').trim();
      const defaultHist = options.markAsHistorical ? 1 : 0;
      const isHistorical =
        type === 'adjustment' ? 0 : parseBoolCell(getVal(mapping.isHistorical), defaultHist);
      const isRecurring = parseBoolCell(getVal(mapping.isRecurring), 0);
      const excludeFromAnalytics = parseBoolCell(getVal(mapping.excludeFromAnalytics), 0);
      const isHidden = parseBoolCell(getVal(mapping.isHidden), 0);

      const { note, noteSource } = ensureTransactionNote({
        note: rawNote,
        noteSource: rawNote ? 'import' : 'auto',
        type,
        categoryName,
        categoryTemplate: category?.auto_note_template || '',
        merchant,
        accountName: account.name,
        pocketName: pocket.name,
        destAccountName: destAccount?.name || '',
        destPocketName: destPocket?.name || '',
        items: itemsArr,
        storeAddress,
        currency: pocket.currency,
      });

      insertStmt.run(
        date,
        type,
        finalAmount,
        pocket.currency,
        account.id,
        pocket.id,
        destAccount ? destAccount.id : null,
        destPocket ? destPocket.id : null,
        destAmount,
        categoryId,
        categoryName,
        merchant,
        note,
        noteSource,
        JSON.stringify(itemsArr),
        storeAddress,
        isHistorical,
        isRecurring,
        excludeFromAnalytics,
        isHidden,
        null,
        null,
        now
      );

      if ((type === 'income' || type === 'expense') && merchant) {
        upsertCounterparty(db, merchant, type === 'income' ? 'in' : 'out', categoryId);
      }

      importedCount += 1;
      countsByType[type] = (countsByType[type] || 0) + 1;
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

  return {
    importedCount,
    skippedCount,
    countsByType,
    skippedReasons: skippedReasons.slice(0, 10),
  };
}

function safeReceiptBasename(rawName) {
  const base = path.basename(String(rawName || '').trim());
  if (!base || base === '.' || base === '..') return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) {
    return base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  }
  return base;
}

function exportFullBackup(db, receiptsDir = null, options = {}) {
  const includeReceipts = options.includeReceipts !== false;
  let dashboardLayout = null;
  try {
    const rawLayout = getSetting(db, 'dashboard_layout', '');
    if (rawLayout) dashboardLayout = JSON.parse(rawLayout);
  } catch {
    dashboardLayout = null;
  }

  const accounts = db.prepare('SELECT * FROM accounts ORDER BY id ASC').all();
  const pockets = db.prepare('SELECT * FROM pockets ORDER BY id ASC').all();
  const categories = db.prepare('SELECT * FROM categories ORDER BY id ASC').all();
  const counterparties = db.prepare('SELECT * FROM counterparties ORDER BY id ASC').all();
  const transactions = db.prepare('SELECT * FROM transactions ORDER BY date ASC, id ASC').all();

  const receipts = [];
  const seenFiles = new Set();
  if (includeReceipts && receiptsDir && fs.existsSync(receiptsDir)) {
    const addReceiptFile = (fname) => {
      const safe = safeReceiptBasename(fname);
      if (!safe || seenFiles.has(safe)) return;
      const fullPath = path.join(receiptsDir, safe);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        seenFiles.add(safe);
        receipts.push({
          filename: safe,
          dataBase64: fs.readFileSync(fullPath).toString('base64'),
        });
      }
    };

    for (const tx of transactions) {
      if (tx.receipt_path) addReceiptFile(tx.receipt_path);
    }
    try {
      for (const f of fs.readdirSync(receiptsDir)) {
        addReceiptFile(f);
      }
    } catch {
      // ignore directory scan failures
    }
  }

  return {
    format: 'moneymanager-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: {
      base_currency: getSetting(db, 'base_currency', 'HUF'),
      gemini_model: getSetting(db, 'gemini_model', 'gemini-4-hydrogen'),
      fx_rates: getFxRates(db),
      session_timeout_minutes: Number(getSetting(db, 'session_timeout_minutes', '10')) || 10,
      dashboard_layout: dashboardLayout,
    },
    accounts,
    pockets,
    categories,
    counterparties,
    transactions,
    receipts,
  };
}

function parseBackupObject(rawBackup) {
  let obj = rawBackup;
  if (Buffer.isBuffer(obj)) {
    if (obj.length >= 2 && obj[0] === 0x1f && obj[1] === 0x8b) {
      try {
        obj = zlib.gunzipSync(obj);
      } catch {
        const err = new Error('Invalid gzipped JSON backup file.');
        err.statusCode = 400;
        throw err;
      }
    }
    obj = obj.toString('utf8');
  }
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      const err = new Error('Invalid JSON backup file.');
      err.statusCode = 400;
      throw err;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    const err = new Error('Backup payload must be a JSON object.');
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(obj.accounts) || !Array.isArray(obj.pockets) || !Array.isArray(obj.transactions)) {
    const err = new Error('Invalid MoneyManager backup: accounts, pockets, and transactions arrays are required.');
    err.statusCode = 400;
    throw err;
  }
  return obj;
}

function previewBackupPayload(rawBackup) {
  const obj = parseBackupObject(rawBackup);
  return {
    format: obj.format || 'moneymanager-backup',
    version: Number(obj.version) || (obj.format === 'moneymanager-backup' ? 2 : 1),
    exportedAt: obj.exportedAt || null,
    counts: {
      accounts: obj.accounts.length,
      pockets: obj.pockets.length,
      categories: Array.isArray(obj.categories) ? obj.categories.length : 0,
      counterparties: Array.isArray(obj.counterparties) ? obj.counterparties.length : 0,
      transactions: obj.transactions.length,
      receipts: Array.isArray(obj.receipts) ? obj.receipts.length : 0,
    },
  };
}

function writeBackupReceipts(receiptsDir, receiptsList) {
  if (!receiptsDir || !Array.isArray(receiptsList) || receiptsList.length === 0) return 0;
  if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
  }
  let written = 0;
  for (const r of receiptsList) {
    if (!r || !r.filename || !r.dataBase64) continue;
    const safe = safeReceiptBasename(r.filename);
    if (!safe) continue;
    const cleanB64 = String(r.dataBase64).includes(',') ? String(r.dataBase64).split(',').pop() : String(r.dataBase64);
    const buf = Buffer.from(cleanB64, 'base64');
    if (buf.length === 0) continue;
    fs.writeFileSync(path.join(receiptsDir, safe), buf);
    written += 1;
  }
  return written;
}

function restoreFullBackup(db, receiptsDir, rawBackup, { mode = 'replace' } = {}) {
  const backup = parseBackupObject(rawBackup);
  const restoreMode = mode === 'merge' ? 'merge' : 'replace';

  if (backup.accounts.length === 0 || backup.pockets.length === 0) {
    const err = new Error('Backup must contain at least one bank account and one pocket.');
    err.statusCode = 400;
    throw err;
  }

  const inCategories = Array.isArray(backup.categories) ? backup.categories : [];
  const inCounterparties = Array.isArray(backup.counterparties) ? backup.counterparties : null;
  const inReceipts = Array.isArray(backup.receipts) ? backup.receipts : [];
  const now = new Date().toISOString();

  let restoredCounts = {
    accounts: 0,
    pockets: 0,
    categories: 0,
    counterparties: 0,
    transactions: 0,
    receipts: 0,
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    if (restoreMode === 'replace') {
      db.prepare('DELETE FROM transactions').run();
      db.prepare('DELETE FROM counterparties').run();
      db.prepare('DELETE FROM pockets').run();
      db.prepare('DELETE FROM accounts').run();
      db.prepare('DELETE FROM categories').run();

      const validCatIds = new Set();
      const insCat = db.prepare(
        'INSERT INTO categories (id, name, type, icon, color, auto_note_template) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const c of inCategories) {
        if (!c || !c.name) continue;
        const type = ['income', 'expense', 'transfer'].includes(String(c.type)) ? c.type : 'expense';
        const cid = Number(c.id);
        const r = Number.isInteger(cid) && cid > 0
          ? insCat.run(cid, String(c.name).trim(), type, c.icon || 'tag', c.color || '#6366f1', c.auto_note_template || '')
          : db
              .prepare('INSERT INTO categories (name, type, icon, color, auto_note_template) VALUES (?, ?, ?, ?, ?)')
              .run(String(c.name).trim(), type, c.icon || 'tag', c.color || '#6366f1', c.auto_note_template || '');
        const insertedId = Number.isInteger(cid) && cid > 0 ? cid : Number(r.lastInsertRowid);
        validCatIds.add(insertedId);
        restoredCounts.categories += 1;
      }

      const validAccIds = new Set();
      const usedSlugs = new Set();
      const insAcc = db.prepare(
        'INSERT INTO accounts (id, name, slug, currency, color, icon, sort_order, is_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const a of backup.accounts) {
        if (!a || !a.name) continue;
        const aid = Number(a.id);
        const rawSlug = String(a.slug || '').trim().toLowerCase();
        const slug = rawSlug && !usedSlugs.has(rawSlug) ? (usedSlugs.add(rawSlug), rawSlug) : makeUniqueSlug(a.name, usedSlugs);
        insAcc.run(
          Number.isInteger(aid) && aid > 0 ? aid : null,
          String(a.name).trim(),
          slug,
          normalizeCurrency(a.currency || 'HUF'),
          a.color || '#3b82f6',
          a.icon || 'landmark',
          Number(a.sort_order) || 0,
          a.is_archived ? 1 : 0
        );
        const realAccId = Number.isInteger(aid) && aid > 0 ? aid : Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
        validAccIds.add(realAccId);
        restoredCounts.accounts += 1;
      }

      const validPocketIds = new Set();
      const insPocket = db.prepare(
        `INSERT INTO pockets (
          id, account_id, name, currency, initial_balance, live_anchor_balance, live_anchor_date,
          current_balance, color, icon, is_default, is_archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of backup.pockets) {
        if (!p || !p.name) continue;
        const pid = Number(p.id);
        const accId = Number(p.account_id);
        if (!validAccIds.has(accId)) continue;
        insPocket.run(
          Number.isInteger(pid) && pid > 0 ? pid : null,
          accId,
          String(p.name).trim(),
          normalizeCurrency(p.currency || 'HUF'),
          Number(p.initial_balance) || 0,
          p.live_anchor_balance !== undefined && p.live_anchor_balance !== null ? Number(p.live_anchor_balance) : null,
          p.live_anchor_date || null,
          Number(p.current_balance) || 0,
          p.color || '#6366f1',
          p.icon || 'wallet',
          p.is_default ? 1 : 0,
          p.is_archived ? 1 : 0
        );
        const realPid = Number.isInteger(pid) && pid > 0 ? pid : Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
        validPocketIds.add(realPid);
        restoredCounts.pockets += 1;
      }

      if (inCounterparties) {
        const insCp = db.prepare(
          'INSERT INTO counterparties (id, name, direction, default_category_id, use_count, last_used_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        for (const cp of inCounterparties) {
          if (!cp || !cp.name || !['in', 'out'].includes(cp.direction)) continue;
          const defCatId =
            cp.default_category_id && validCatIds.has(Number(cp.default_category_id))
              ? Number(cp.default_category_id)
              : null;
          const cpid = Number(cp.id);
          insCp.run(
            Number.isInteger(cpid) && cpid > 0 ? cpid : null,
            String(cp.name).trim(),
            cp.direction,
            defCatId,
            Math.max(1, Number(cp.use_count) || 1),
            cp.last_used_at || now
          );
          restoredCounts.counterparties += 1;
        }
      }

      const insTx = db.prepare(
        `INSERT INTO transactions (
          id, date, type, amount, currency, account_id, pocket_id,
          dest_account_id, dest_pocket_id, dest_amount,
          category_id, category_name, merchant, note, note_source,
          items_json, receipt_path, store_address, is_historical, needs_approval,
          auto_source, exclude_from_analytics, is_hidden, is_recurring,
          recorded_pocket_balance_after, recorded_dest_pocket_balance_after, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const tx of backup.transactions) {
        if (!tx) continue;
        const accId = Number(tx.account_id);
        const pocketId = Number(tx.pocket_id);
        if (!validAccIds.has(accId) || !validPocketIds.has(pocketId)) continue;
        const txId = Number(tx.id);
        const dstAccId = tx.dest_account_id && validAccIds.has(Number(tx.dest_account_id)) ? Number(tx.dest_account_id) : null;
        const dstPocketId = tx.dest_pocket_id && validPocketIds.has(Number(tx.dest_pocket_id)) ? Number(tx.dest_pocket_id) : null;
        const catId = tx.category_id && validCatIds.has(Number(tx.category_id)) ? Number(tx.category_id) : null;
        const itemsJson = typeof tx.items_json === 'string' ? tx.items_json : JSON.stringify(tx.items_json || []);
        const noteSource = ['manual', 'auto', 'import'].includes(String(tx.note_source)) ? tx.note_source : 'manual';

        insTx.run(
          Number.isInteger(txId) && txId > 0 ? txId : null,
          String(tx.date || normalizeTxDate(null)),
          ['income', 'expense', 'transfer', 'adjustment'].includes(String(tx.type)) ? tx.type : 'expense',
          Number(tx.amount) || 0,
          normalizeCurrency(tx.currency || 'HUF'),
          accId,
          pocketId,
          dstAccId,
          dstPocketId,
          tx.dest_amount !== undefined && tx.dest_amount !== null ? Number(tx.dest_amount) : null,
          catId,
          String(tx.category_name || 'Other Expense'),
          String(tx.merchant || ''),
          String(tx.note || ''),
          noteSource,
          itemsJson,
          tx.receipt_path ? safeReceiptBasename(tx.receipt_path) : null,
          String(tx.store_address || ''),
          tx.is_historical ? 1 : 0,
          tx.needs_approval ? 1 : 0,
          tx.auto_source || null,
          tx.exclude_from_analytics ? 1 : 0,
          tx.is_hidden ? 1 : 0,
          tx.is_recurring ? 1 : 0,
          tx.recorded_pocket_balance_after !== undefined && tx.recorded_pocket_balance_after !== null
            ? Number(tx.recorded_pocket_balance_after)
            : null,
          tx.recorded_dest_pocket_balance_after !== undefined && tx.recorded_dest_pocket_balance_after !== null
            ? Number(tx.recorded_dest_pocket_balance_after)
            : null,
          tx.created_at || now
        );
        restoredCounts.transactions += 1;
      }

      if (backup.settings && typeof backup.settings === 'object') {
        if (typeof backup.settings.base_currency === 'string' && backup.settings.base_currency.trim()) {
          setSetting(db, 'base_currency', backup.settings.base_currency.trim().toUpperCase());
        }
        if (typeof backup.settings.gemini_model === 'string' && backup.settings.gemini_model.trim()) {
          setSetting(db, 'gemini_model', backup.settings.gemini_model.trim());
        }
        if (backup.settings.fx_rates && typeof backup.settings.fx_rates === 'object') {
          setSetting(db, 'fx_rates', JSON.stringify(parseFxRates(backup.settings.fx_rates)));
        }
        if (backup.settings.session_timeout_minutes !== undefined) {
          const mins = Math.max(1, Math.min(1440, Math.round(Number(backup.settings.session_timeout_minutes) || 10)));
          setSetting(db, 'session_timeout_minutes', String(mins));
        }
        if (backup.settings.dashboard_layout && typeof backup.settings.dashboard_layout === 'object') {
          setSetting(db, 'dashboard_layout', JSON.stringify(backup.settings.dashboard_layout));
        }
      }

      if (!inCounterparties) {
        setSetting(db, 'counterparties_seeded', '0');
        seedCounterpartiesFromTransactions(db);
        restoredCounts.counterparties = db.prepare('SELECT COUNT(*) AS cnt FROM counterparties').get().cnt;
      }
    } else {
      // MERGE mode: preserve existing rows and map IDs cleanly
      const existingCats = db.prepare('SELECT * FROM categories').all();
      const catIdMap = new Map();
      const insCat = db.prepare(
        'INSERT INTO categories (name, type, icon, color, auto_note_template) VALUES (?, ?, ?, ?, ?)'
      );
      for (const c of inCategories) {
        if (!c || !c.name) continue;
        const type = ['income', 'expense', 'transfer'].includes(String(c.type)) ? c.type : 'expense';
        let match = existingCats.find(
          (ec) => ec.name.toLowerCase() === String(c.name).trim().toLowerCase() && ec.type === type
        );
        if (!match) {
          const r = insCat.run(
            String(c.name).trim(),
            type,
            c.icon || 'tag',
            c.color || '#6366f1',
            c.auto_note_template || ''
          );
          match = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(r.lastInsertRowid));
          existingCats.push(match);
          restoredCounts.categories += 1;
        }
        if (c.id !== undefined) catIdMap.set(Number(c.id), match.id);
      }

      const existingAccs = db.prepare('SELECT * FROM accounts').all();
      const existingSlugs = new Set(existingAccs.map((a) => String(a.slug || '').toLowerCase()));
      const accIdMap = new Map();
      const insAcc = db.prepare(
        'INSERT INTO accounts (name, slug, currency, color, icon, sort_order, is_archived) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      let maxSort = existingAccs.reduce((m, a) => Math.max(m, Number(a.sort_order || 0)), 0) + 1;

      for (const a of backup.accounts) {
        if (!a || !a.name) continue;
        let match = existingAccs.find(
          (ea) =>
            normStr(ea.name) === normStr(a.name) ||
            (a.slug && String(ea.slug || '').toLowerCase() === String(a.slug).toLowerCase())
        );
        if (!match) {
          const slug = makeUniqueSlug(a.name, existingSlugs);
          const r = insAcc.run(
            String(a.name).trim(),
            slug,
            normalizeCurrency(a.currency || 'HUF'),
            a.color || '#3b82f6',
            a.icon || 'landmark',
            maxSort++,
            a.is_archived ? 1 : 0
          );
          match = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(r.lastInsertRowid));
          existingAccs.push(match);
          restoredCounts.accounts += 1;
        }
        if (a.id !== undefined) accIdMap.set(Number(a.id), match.id);
      }

      const existingPockets = db.prepare('SELECT * FROM pockets').all();
      const pocketIdMap = new Map();
      const insPocket = db.prepare(
        `INSERT INTO pockets (
          account_id, name, currency, initial_balance, live_anchor_balance, live_anchor_date,
          current_balance, color, icon, is_default, is_archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const p of backup.pockets) {
        if (!p || !p.name) continue;
        const mappedAccId = accIdMap.get(Number(p.account_id));
        if (!mappedAccId) continue;
        let match = existingPockets.find(
          (ep) => ep.account_id === mappedAccId && normStr(ep.name) === normStr(p.name)
        );
        if (!match) {
          const hasDefault = existingPockets.some((ep) => ep.account_id === mappedAccId && ep.is_default === 1);
          const r = insPocket.run(
            mappedAccId,
            String(p.name).trim(),
            normalizeCurrency(p.currency || 'HUF'),
            Number(p.initial_balance) || 0,
            p.live_anchor_balance !== undefined && p.live_anchor_balance !== null ? Number(p.live_anchor_balance) : null,
            p.live_anchor_date || null,
            Number(p.current_balance) || 0,
            p.color || '#6366f1',
            p.icon || 'wallet',
            hasDefault ? 0 : p.is_default ? 1 : 0,
            p.is_archived ? 1 : 0
          );
          match = db.prepare('SELECT * FROM pockets WHERE id = ?').get(Number(r.lastInsertRowid));
          existingPockets.push(match);
          restoredCounts.pockets += 1;
        }
        if (p.id !== undefined) pocketIdMap.set(Number(p.id), match.id);
      }

      if (inCounterparties) {
        const upsertCp = db.prepare(`
          INSERT INTO counterparties (name, direction, default_category_id, use_count, last_used_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(name, direction) DO UPDATE SET
            use_count = MAX(counterparties.use_count, excluded.use_count),
            last_used_at = CASE WHEN excluded.last_used_at > counterparties.last_used_at THEN excluded.last_used_at ELSE counterparties.last_used_at END,
            default_category_id = COALESCE(counterparties.default_category_id, excluded.default_category_id)
        `);
        for (const cp of inCounterparties) {
          if (!cp || !cp.name || !['in', 'out'].includes(cp.direction)) continue;
          const mappedCatId = cp.default_category_id ? catIdMap.get(Number(cp.default_category_id)) || null : null;
          upsertCp.run(
            String(cp.name).trim(),
            cp.direction,
            mappedCatId,
            Math.max(1, Number(cp.use_count) || 1),
            cp.last_used_at || now
          );
          restoredCounts.counterparties += 1;
        }
      }

      const insTx = db.prepare(
        `INSERT INTO transactions (
          date, type, amount, currency, account_id, pocket_id,
          dest_account_id, dest_pocket_id, dest_amount,
          category_id, category_name, merchant, note, note_source,
          items_json, receipt_path, store_address, is_historical, needs_approval,
          auto_source, exclude_from_analytics, is_hidden, is_recurring,
          recorded_pocket_balance_after, recorded_dest_pocket_balance_after, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const tx of backup.transactions) {
        if (!tx) continue;
        const mappedAccId = accIdMap.get(Number(tx.account_id));
        const mappedPocketId = pocketIdMap.get(Number(tx.pocket_id));
        if (!mappedAccId || !mappedPocketId) continue;
        const mappedDstAccId = tx.dest_account_id ? accIdMap.get(Number(tx.dest_account_id)) || null : null;
        const mappedDstPocketId = tx.dest_pocket_id ? pocketIdMap.get(Number(tx.dest_pocket_id)) || null : null;
        let mappedCatId = tx.category_id ? catIdMap.get(Number(tx.category_id)) || null : null;
        if (!mappedCatId && tx.category_name) {
          const catMatch = existingCats.find(
            (c) => c.name.toLowerCase() === String(tx.category_name).trim().toLowerCase()
          );
          if (catMatch) mappedCatId = catMatch.id;
        }
        const itemsJson = typeof tx.items_json === 'string' ? tx.items_json : JSON.stringify(tx.items_json || []);
        const noteSource = ['manual', 'auto', 'import'].includes(String(tx.note_source)) ? tx.note_source : 'manual';

        insTx.run(
          String(tx.date || normalizeTxDate(null)),
          ['income', 'expense', 'transfer', 'adjustment'].includes(String(tx.type)) ? tx.type : 'expense',
          Number(tx.amount) || 0,
          normalizeCurrency(tx.currency || 'HUF'),
          mappedAccId,
          mappedPocketId,
          mappedDstAccId,
          mappedDstPocketId,
          tx.dest_amount !== undefined && tx.dest_amount !== null ? Number(tx.dest_amount) : null,
          mappedCatId,
          String(tx.category_name || 'Other Expense'),
          String(tx.merchant || ''),
          String(tx.note || ''),
          noteSource,
          itemsJson,
          tx.receipt_path ? safeReceiptBasename(tx.receipt_path) : null,
          String(tx.store_address || ''),
          tx.is_historical ? 1 : 0,
          tx.needs_approval ? 1 : 0,
          tx.auto_source || null,
          tx.exclude_from_analytics ? 1 : 0,
          tx.is_hidden ? 1 : 0,
          tx.is_recurring ? 1 : 0,
          tx.recorded_pocket_balance_after !== undefined && tx.recorded_pocket_balance_after !== null
            ? Number(tx.recorded_pocket_balance_after)
            : null,
          tx.recorded_dest_pocket_balance_after !== undefined && tx.recorded_dest_pocket_balance_after !== null
            ? Number(tx.recorded_dest_pocket_balance_after)
            : null,
          tx.created_at || now
        );
        restoredCounts.transactions += 1;
      }
    }

    restoredCounts.receipts = writeBackupReceipts(receiptsDir, inReceipts);
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

  return {
    ok: true,
    mode: restoreMode,
    restoredCounts,
  };
}

module.exports = {
  parseSpreadsheetFile,
  suggestColumnMapping,
  parseAmountAndCurrency,
  parseFlexibleDate,
  previewImport,
  commitImport,
  exportFullBackup,
  previewBackupPayload,
  restoreFullBackup,
};
