'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const http = require('node:http');

const { createApp } = require('../src/server');
const { getGeminiUsageStats, recordGeminiUsage, normalizeGeminiPayload } = require('../src/gemini');
const { getSetting, setSetting } = require('../src/db');

/**
 * Helper: Build a real compressed .xlsx (OOXML ZIP) buffer using Node's zlib.
 */
function buildTestXlsxBuffer(entriesMap) {
  const localChunks = [];
  const cdChunks = [];
  let offset = 0;

  for (const [name, contentStr] of Object.entries(entriesMap)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const rawBuf = Buffer.from(contentStr, 'utf8');
    const compressedBuf = zlib.deflateRawSync(rawBuf);
    const crc = crc32(rawBuf);

    // Local File Header (30 bytes)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(8, 8); // method 8 = deflate
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc >>> 0, 14);
    lfh.writeUInt32LE(compressedBuf.length, 18);
    lfh.writeUInt32LE(rawBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    localChunks.push(lfh, nameBuf, compressedBuf);

    // Central Directory Header (46 bytes)
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc >>> 0, 16);
    cdh.writeUInt32LE(compressedBuf.length, 20);
    cdh.writeUInt32LE(rawBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);

    cdChunks.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + compressedBuf.length;
  }

  const cdBuf = Buffer.concat(cdChunks);
  const count = Object.keys(entriesMap).length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

test('MoneyManager End-to-End Verification Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-test-'));
  const { server, db } = createApp({
    dataDir: tmpDir,
    dbPath: path.join(tmpDir, 'test.db'),
    receiptsDir: path.join(tmpDir, 'receipts'),
    skipInitialCsvImport: true,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  let sessionCookie = '';

  async function reqJson(pathname, { method = 'GET', body, cookie = sessionCookie } = {}) {
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, setCookie, headers: res.headers };
  }

  // 1. Auth setup, guard & login
  await t.test('Auth setup, session cookie, protected API guard, and login', async () => {
    const st1 = await reqJson('/api/auth/status');
    assert.equal(st1.status, 200);
    assert.equal(st1.data.initialized, false);
    assert.equal(st1.data.authenticated, false);
    assert.ok(st1.data.appVersion && st1.data.appVersion.version);
    assert.match(st1.data.appVersion.label, /^v\d+\.\d+\.\d+/);

    // Unauthenticated dashboard must return 401
    const unauth = await reqJson('/api/dashboard');
    assert.equal(unauth.status, 401);

    // First-run setup
    const setup = await reqJson('/api/auth/setup', {
      method: 'POST',
      body: { username: 'piuser', password: 'StrongPassword123!' },
    });
    assert.equal(setup.status, 201);
    assert.equal(setup.data.user.username, 'piuser');
    assert.ok(setup.setCookie && setup.setCookie.includes('mm_session='));
    sessionCookie = setup.setCookie.split(';')[0];

    // Double setup must be blocked
    const setupAgain = await reqJson('/api/auth/setup', {
      method: 'POST',
      body: { username: 'hacker', password: 'password123' },
    });
    assert.equal(setupAgain.status, 403);

    // Logout & Re-login
    await reqJson('/api/auth/logout', { method: 'POST' });
    const afterLogout = await reqJson('/api/dashboard');
    assert.equal(afterLogout.status, 401);

    const badLogin = await reqJson('/api/auth/login', {
      method: 'POST',
      body: { username: 'piuser', password: 'WrongPassword' },
      cookie: '',
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await reqJson('/api/auth/login', {
      method: 'POST',
      body: { username: 'piuser', password: 'StrongPassword123!' },
      cookie: '',
    });
    assert.equal(goodLogin.status, 200);
    sessionCookie = goodLogin.setCookie.split(';')[0];
  });

  // 2. Seeded Banks, Pockets & Categories
  let ersteMainId;
  let otpMainId;
  let revolutEurId;
  let shoppingCatId;
  let salaryCatId;

  await t.test('Seeded starter bank (Main Bank), pockets, and categories exist without personal data', async () => {
    const dash = await reqJson('/api/dashboard');
    assert.equal(dash.status, 200);
    const names = dash.data.accounts.map((a) => a.name);
    assert.deepEqual(names, ['Main Bank']);
    assert.deepEqual(
      dash.data.accounts[0].pockets.map((p) => p.name),
      ['Main', 'Savings']
    );
    assert.equal(dash.data.transactions.length, 0);
    assert.equal(dash.data.counterparties.in.length, 0);
    assert.equal(dash.data.counterparties.out.length, 0);

    // Create additional test banks/pockets via API for multi-bank ledger, notification, and FX tests
    const ersteAccRes = await reqJson('/api/accounts', {
      method: 'POST',
      body: { name: 'Erste', currency: 'HUF', initialBalance: 0, color: '#0052cc' },
    });
    assert.equal(ersteAccRes.status, 201);
    const otpAccRes = await reqJson('/api/accounts', {
      method: 'POST',
      body: { name: 'OTP', currency: 'HUF', initialBalance: 0, color: '#52ae30' },
    });
    assert.equal(otpAccRes.status, 201);
    const revAccRes = await reqJson('/api/accounts', {
      method: 'POST',
      body: { name: 'Revolut', currency: 'HUF', initialBalance: 0, color: '#0075eb' },
    });
    assert.equal(revAccRes.status, 201);

    const dashWithBanks = await reqJson('/api/dashboard');
    const erste = dashWithBanks.data.accounts.find((a) => a.name === 'Erste');
    const otp = dashWithBanks.data.accounts.find((a) => a.name === 'OTP');
    const revolut = dashWithBanks.data.accounts.find((a) => a.name === 'Revolut');

    ersteMainId = erste.pockets.find((p) => p.is_default === 1).id;
    otpMainId = otp.pockets.find((p) => p.is_default === 1).id;
    await reqJson(`/api/pockets/${ersteMainId}`, { method: 'PATCH', body: { name: 'fo számla' } });
    await reqJson(`/api/pockets/${otpMainId}`, { method: 'PATCH', body: { name: 'fo számla' } });
    await reqJson('/api/pockets', {
      method: 'POST',
      body: { accountId: otp.id, name: 'persely számla', currency: 'HUF', initialBalance: 0 },
    });
    const revEurRes = await reqJson('/api/pockets', {
      method: 'POST',
      body: { accountId: revolut.id, name: 'Euro Vault', currency: 'EUR', initialBalance: 0 },
    });
    assert.equal(revEurRes.status, 201);
    revolutEurId = revEurRes.data.pocket.id;

    assert.ok(ersteMainId);
    assert.ok(otpMainId);
    assert.ok(revolutEurId);

    const catNames = dashWithBanks.data.categories.map((c) => c.name).sort();
    assert.deepEqual(catNames, [
      'Bank-to-Bank Transfer',
      'Bills & Subscriptions',
      'Entertainment',
      'Family & Gifts',
      'Food & Dining',
      'Fuel & Transport',
      'Health & Fitness',
      'Internal Transfer',
      'Other Expense',
      'Other Income',
      'Pocket-to-Pocket Transfer',
      'Savings / Set Aside',
      'Shopping',
      'Work / Salary',
    ]);
    assert.equal(catNames.includes('Scholarship'), false);
    assert.equal(catNames.includes('University & Dorm'), false);
    assert.equal(catNames.includes('Tech & Electronics'), false);
    assert.equal(catNames.includes('Pocket Reimbursement'), false);

    shoppingCatId = dashWithBanks.data.categories.find((c) => c.name === 'Shopping').id;
    salaryCatId = dashWithBanks.data.categories.find((c) => c.name === 'Work / Salary').id;
  });

  // 3. Running Balance After & Auto-Note vs Manual Note & Transfers & Backdating
  await t.test('Transactions, auto-notes, manual notes, cross-FX transfer & backdated recalculation', async () => {
    // Income: Work / Salary +120,000 HUF into OTP Main
    const tx1 = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-05T10:00',
        type: 'income',
        amount: 120000,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryId: salaryCatId,
        merchant: 'Mock Employer Org',
        note: '',
      },
    });
    assert.equal(tx1.status, 201);
    assert.equal(tx1.data.transaction.note_source, 'auto');
    assert.match(tx1.data.transaction.note, /Work \/ Salary|Mock Employer Org/i);
    assert.equal(tx1.data.transaction.pocket_balance_after, 120000);
    assert.equal(tx1.data.transaction.account_balance_after, 120000);

    // Expense with BLANK note in Shopping -> Auto-generated note
    const tx2 = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-08T14:30',
        type: 'expense',
        amount: 14500,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryId: shoppingCatId,
        merchant: 'Mock Grocery',
        note: '',
      },
    });
    assert.equal(tx2.status, 201);
    assert.equal(tx2.data.transaction.note_source, 'auto');
    assert.match(tx2.data.transaction.note, /Mock Grocery/i);
    assert.equal(tx2.data.transaction.pocket_balance_after, 105500);
    assert.equal(tx2.data.transaction.account_balance_after, 105500);

    // Expense with MANUAL note in Shopping -> Manual note preserved
    const tx3 = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-10T18:00',
        type: 'expense',
        amount: 25500,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryName: 'Shopping',
        merchant: 'Mock Electronics Shop',
        note: 'Mechanical keyboard switches',
      },
    });
    assert.equal(tx3.status, 201);
    assert.equal(tx3.data.transaction.note_source, 'manual');
    assert.equal(tx3.data.transaction.note, 'Mechanical keyboard switches');
    assert.equal(tx3.data.transaction.pocket_balance_after, 80000);
    assert.equal(tx3.data.transaction.account_balance_after, 80000);

    // Transfer 40,500 HUF from OTP Main to Revolut Euro Vault (default rate 405 => 100 EUR)
    const tx4 = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-12T09:00',
        type: 'transfer',
        amount: 40500,
        currency: 'HUF',
        pocketId: otpMainId,
        destPocketId: revolutEurId,
        note: 'Moving savings to Revolut EUR',
      },
    });
    assert.equal(tx4.status, 201);
    assert.equal(tx4.data.transaction.pocket_balance_after, 39500);
    assert.equal(tx4.data.transaction.account_balance_after, 39500);
    assert.equal(tx4.data.transaction.dest_pocket_balance_after, 100);
    assert.equal(tx4.data.transaction.dest_account_balance_after, 40500);

    // Backdated expense on 2026-11-06 (-5,000 HUF) -> ALL subsequent balances on OTP Main must drop by 5,000!
    const txBack = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-06T12:00',
        type: 'expense',
        amount: 5000,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryName: 'Fuel & Transport',
        merchant: 'Mock Fuel Station',
        note: '',
      },
    });
    assert.equal(txBack.status, 201);
    assert.equal(txBack.data.transaction.pocket_balance_after, 115000);

    const dashAfterBackdate = await reqJson('/api/dashboard');
    const otpPocket = dashAfterBackdate.data.accounts.find((a) => a.name === 'OTP').pockets.find((p) => p.id === otpMainId);
    assert.equal(otpPocket.current_balance, 34500);

    // Verify transfer does not inflate KPI income/expense totals
    assert.equal(dashAfterBackdate.data.kpis.periodIncomeHuf, 120000);
    assert.equal(dashAfterBackdate.data.kpis.periodExpenseHuf, 45000); // 14500 + 25500 + 5000
  });

  // 4. Sync Live Balance (Anchor) + CSV & XLSX Import
  await t.test('Google Sheets CSV & XLSX historical import + live balance sync', async () => {
    // CSV with Hungarian formatting (semicolon delimiter, Ft suffix, comma decimals)
    const csvContent = [
      'Dátum;Típus;Összeg;Kategória;Bank;Megjegyzés',
      '2025-10-01;Bevétel;150 000 Ft;Munka;Erste;October salary',
      '2025-10-05;Kiadás;-22 500 Ft;Bevásárlás;Erste;Big grocery haul',
    ].join('\n');

    const csvB64 = Buffer.from(csvContent, 'utf8').toString('base64');
    const prevCsv = await reqJson('/api/import/preview', {
      method: 'POST',
      body: { fileBase64: csvB64, filename: 'history.csv' },
    });
    assert.equal(prevCsv.status, 200);
    assert.equal(prevCsv.data.format, 'csv');
    assert.equal(prevCsv.data.totalRows, 2);

    const commitCsv = await reqJson('/api/import/commit', {
      method: 'POST',
      body: {
        fileBase64: csvB64,
        filename: 'history.csv',
        mapping: prevCsv.data.suggestedMapping,
        defaultPocketId: ersteMainId,
        markAsHistorical: true,
      },
    });
    assert.equal(commitCsv.status, 200);
    assert.equal(commitCsv.data.importedCount, 2);

    const afterCsvDash = await reqJson('/api/dashboard?historical=historical&limit=50');
    assert.ok(afterCsvDash.data.transactions.some((tx) => tx.note === 'October salary' && tx.is_historical === 1));
    assert.ok(afterCsvDash.data.transactions.some((tx) => tx.note === 'Big grocery haul' && tx.is_historical === 1));

    // CSV with explicit IsHistorical column overrides markAsHistorical default
    const flagCsvContent = [
      'Date,Type,Amount,Category,Bank,Note,IsHistorical',
      '2025-10-08,expense,-1500,Shopping,Erste,Explicit live flag row,0',
      '2025-10-09,expense,-2500,Shopping,Erste,Explicit hist flag row,1',
    ].join('\n');
    const flagCsvB64 = Buffer.from(flagCsvContent, 'utf8').toString('base64');
    const prevFlagCsv = await reqJson('/api/import/preview', {
      method: 'POST',
      body: { fileBase64: flagCsvB64, filename: 'flags.csv' },
    });
    assert.equal(prevFlagCsv.status, 200);
    assert.ok(prevFlagCsv.data.suggestedMapping.isHistorical >= 0);
    const commitFlagCsv = await reqJson('/api/import/commit', {
      method: 'POST',
      body: {
        fileBase64: flagCsvB64,
        filename: 'flags.csv',
        mapping: prevFlagCsv.data.suggestedMapping,
        defaultPocketId: ersteMainId,
        markAsHistorical: false,
      },
    });
    assert.equal(commitFlagCsv.status, 200);
    assert.equal(commitFlagCsv.data.importedCount, 2);

    const afterFlagDash = await reqJson('/api/dashboard?limit=100');
    assert.equal(afterFlagDash.data.transactions.find((tx) => tx.note === 'Explicit live flag row')?.is_historical, 0);
    assert.equal(afterFlagDash.data.transactions.find((tx) => tx.note === 'Explicit hist flag row')?.is_historical, 1);

    // Build real compressed XLSX with 2 sheets
    const xlsxBuf = buildTestXlsxBuffer({
      'xl/workbook.xml':
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml':
        '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6"><si><t>Date</t></si><si><t>Amount</t></si><si><t>Category</t></si><si><t>Bank</t></si><si><t>Family &amp; Gifts</t></si><si><t>Erste</t></si></sst>',
      'xl/styles.xml':
        '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml':
        '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" s="1"><v>45945</v></c><c r="B2"><v>30000</v></c><c r="C2" t="s"><v>4</v></c><c r="D2" t="s"><v>5</v></c></row></sheetData></worksheet>',
    });

    const xlsxB64 = xlsxBuf.toString('base64');
    const prevXlsx = await reqJson('/api/import/preview', {
      method: 'POST',
      body: { fileBase64: xlsxB64, filename: 'workbook.xlsx' },
    });
    assert.equal(prevXlsx.status, 200);
    assert.equal(prevXlsx.data.format, 'xlsx');
    assert.equal(prevXlsx.data.sheets[0].name, 'Transactions');
    assert.equal(prevXlsx.data.totalRows, 1);
    assert.equal(prevXlsx.data.previewRows[0][0], '2025-10-15');

    const commitXlsx = await reqJson('/api/import/commit', {
      method: 'POST',
      body: {
        fileBase64: xlsxB64,
        filename: 'workbook.xlsx',
        mapping: prevXlsx.data.suggestedMapping,
        defaultPocketId: ersteMainId,
        markAsHistorical: false,
      },
    });
    assert.equal(commitXlsx.status, 200);
    assert.equal(commitXlsx.data.importedCount, 1);
    const afterXlsxDash = await reqJson('/api/dashboard?limit=100');
    const xlsxTx = afterXlsxDash.data.transactions.find((tx) => tx.date === '2025-10-15' && tx.amount === 30000);
    assert.equal(xlsxTx?.is_historical, 0);

    // Sync Erste Main pocket live balance to 500,000 Ft without deleting historical rows
    const syncRes = await reqJson(`/api/pockets/${ersteMainId}/sync`, {
      method: 'POST',
      body: {
        targetBalance: 500000,
        mode: 'sync',
        date: '2026-11-16T00:50',
        note: 'Verified Erste mobile app balance',
      },
    });
    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.data.pocket.current_balance, 500000);
  });

  // 5. Receipt upload & auto-log + static PWA assets
  await t.test('Receipt scan & auto-log updates pocket balance, plus PWA assets serve properly', async () => {
    // Minimal 1x1 JPEG bytes
    const dummyImgB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
    const scanRes = await reqJson('/api/receipts/scan', {
      method: 'POST',
      body: {
        imageBase64: `data:image/jpeg;base64,${dummyImgB64}`,
        mimeType: 'image/jpeg',
        filename: 'mock-grocery-receipt.jpg',
        pocketId: ersteMainId,
        autoLog: true,
      },
    });
    assert.equal(scanRes.status, 200);
    assert.equal(scanRes.data.autoLogged, true);
    assert.ok(scanRes.data.receiptPath);
    assert.equal(scanRes.data.transaction.merchant, 'Mock Grocery');
    assert.ok(scanRes.data.transaction.note.includes('Milk & Dairy x2'));
    assert.ok(scanRes.data.transaction.note.includes('Fresh Bakery Bread'));
    assert.ok(scanRes.data.transaction.note.includes('Chicken Breast'));
    assert.ok(scanRes.data.transaction.note.includes('Coffee & Snacks'));
    assert.equal(scanRes.data.transaction.pocket_balance_after, 500000 - 8450);
    assert.equal(scanRes.data.transaction.needs_approval, 1);
    assert.equal(scanRes.data.transaction.auto_source, 'receipt_autolog');
    assert.ok(scanRes.data.stats && scanRes.data.stats.imageBytes > 0);
    assert.ok(typeof scanRes.data.stats.durationMs === 'number');
    assert.ok(scanRes.data.usage);
    assert.equal(typeof scanRes.data.usage.requestsToday, 'number');
    assert.equal(typeof scanRes.data.usage.dailyLimitEstimate, 'number');
    assert.equal(typeof scanRes.data.usage.rpmUsed, 'number');
    assert.equal(typeof scanRes.data.usage.rpmLimitEstimate, 'number');

    const settingsRes = await reqJson('/api/settings');
    assert.equal(settingsRes.status, 200);
    assert.ok(settingsRes.data.webhookToken && settingsRes.data.webhookToken.length >= 16);
    assert.ok(settingsRes.data.appVersion && /^v\d+\.\d+\.\d+/.test(settingsRes.data.appVersion.label));
    assert.ok(settingsRes.data.geminiUsage);
    assert.equal(typeof settingsRes.data.geminiUsage.nearLimit, 'boolean');
    assert.ok(['ok', 'warning', 'rate_limited'].includes(settingsRes.data.geminiUsage.status));

    // Fetch saved receipt image with session cookie
    const imgFetch = await fetch(`${baseUrl}/api/receipts/file/${encodeURIComponent(scanRes.data.receiptPath)}`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(imgFetch.status, 200);

    // Fetch PWA manifest & service worker & index.html
    for (const pwaPath of ['/', '/manifest.webmanifest', '/sw.js', '/css/styles.css', '/js/app.js']) {
      const r = await fetch(`${baseUrl}${pwaPath}`);
      assert.equal(r.status, 200, `Expected 200 for ${pwaPath}`);
    }
    const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`);
    const manifestJson = await manifestRes.json();
    assert.equal(manifestJson.background_color, '#0b1120');
    assert.equal(manifestJson.theme_color, '#0b1120');
    const htmlRes = await fetch(`${baseUrl}/`);
    const htmlText = await htmlRes.text();
    assert.ok(htmlText.includes('id="meta-theme-color" content="#0b1120"'));
    assert.ok(htmlText.includes('id="auth-app-version"'));
    assert.ok(htmlText.includes('id="settings-app-version"'));
  });

  // 6. Counterparties auto-save & delete + Account & Pocket CRUD
  await t.test('Counterparties prediction auto-save/delete and full Account & Pocket CRUD', async () => {
    // Log new income with a brand new origin "Mock Family Sender" and new expense with destination "Mock Bistro 42"
    const incRes = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-16T10:00',
        type: 'income',
        amount: 25000,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryName: 'Family & Gifts',
        merchant: 'Mock Family Sender',
        note: 'Gift from Mock Family Sender',
      },
    });
    assert.equal(incRes.status, 201);

    const expRes = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-16T12:00',
        type: 'expense',
        amount: 4200,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryName: 'Food & Dining',
        merchant: 'Mock Bistro 42',
        note: '',
      },
    });
    assert.equal(expRes.status, 201);

    // Both should now appear in counterparties predictions
    const cpList = await reqJson('/api/counterparties');
    assert.equal(cpList.status, 200);
    const familySender = cpList.data.counterparties.in.find((c) => c.name === 'Mock Family Sender');
    const bistro = cpList.data.counterparties.out.find((c) => c.name === 'Mock Bistro 42');
    assert.ok(familySender);
    assert.ok(bistro);

    // Delete "Mock Bistro 42" from saved predictions -> transaction remains intact & editing its note does not re-add it
    const bistroTxId = expRes.data.transaction.id;
    const delCp = await reqJson(`/api/counterparties/${bistro.id}`, { method: 'DELETE' });
    assert.equal(delCp.status, 200);
    assert.equal(delCp.data.counterparties.out.some((c) => c.name === 'Mock Bistro 42'), false);

    const dashAfterDelCp = await reqJson('/api/dashboard');
    assert.ok(dashAfterDelCp.data.transactions.some((tx) => tx.id === bistroTxId && tx.merchant === 'Mock Bistro 42'));

    const noteEditOnRemovedCp = await reqJson(`/api/transactions/${bistroTxId}`, {
      method: 'PATCH',
      body: { note: 'Lunch note edit', noteSource: 'manual' },
    });
    assert.equal(noteEditOnRemovedCp.status, 200);
    const cpAfterEdit = await reqJson('/api/counterparties');
    assert.equal(cpAfterEdit.data.counterparties.out.some((c) => c.name === 'Mock Bistro 42'), false);

    // Create a custom bank "Wise", add a pocket, edit pocket, delete pocket, edit bank, delete bank
    const createBank = await reqJson('/api/accounts', {
      method: 'POST',
      body: { name: 'Wise', currency: 'EUR', initialBalance: 100, color: '#9fe870' },
    });
    assert.equal(createBank.status, 201);
    const wiseId = createBank.data.accountId;

    const editBank = await reqJson(`/api/accounts/${wiseId}`, {
      method: 'PATCH',
      body: { name: 'Wise EUR', color: '#00b9ff' },
    });
    assert.equal(editBank.status, 200);
    assert.equal(editBank.data.account.name, 'Wise EUR');

    const createPocket = await reqJson('/api/pockets', {
      method: 'POST',
      body: { accountId: wiseId, name: 'Backup Pocket', currency: 'EUR', initialBalance: 50 },
    });
    assert.equal(createPocket.status, 201);
    const backupPocketId = createPocket.data.pocket.id;

    const editPocket = await reqJson(`/api/pockets/${backupPocketId}`, {
      method: 'PATCH',
      body: { name: 'Reserve EUR', initialBalance: 75, isDefault: true },
    });
    assert.equal(editPocket.status, 200);
    assert.equal(editPocket.data.pocket.name, 'Reserve EUR');
    assert.equal(editPocket.data.pocket.current_balance, 75);
    assert.equal(editPocket.data.pocket.is_default, 1);

    // Log an expense inside Backup/Reserve pocket so we can verify transactions stay in log when archived
    const pocketTx = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-15',
        type: 'expense',
        amount: 10,
        currency: 'EUR',
        pocketId: backupPocketId,
        categoryName: 'Shopping',
        merchant: 'Mock Wise Shop',
        note: 'Archived check',
      },
    });
    assert.equal(pocketTx.status, 201);
    const pocketTxId = pocketTx.data.transaction.id;

    // Default DELETE archives (marks unused) and keeps transactions intact
    const archivePocket = await reqJson(`/api/pockets/${backupPocketId}`, { method: 'DELETE' });
    assert.equal(archivePocket.status, 200);

    const dashArchivedPocket = await reqJson('/api/dashboard');
    const wiseAfterPocketArchive = dashArchivedPocket.data.accounts.find((a) => a.id === wiseId);
    const archivedPocketObj = wiseAfterPocketArchive.pockets.find((p) => p.id === backupPocketId);
    assert.equal(archivedPocketObj.is_archived, 1);
    assert.equal(wiseAfterPocketArchive.archived_pocket_count, 1);
    // Wise total should only count its remaining active 100 EUR pocket, not the archived 65 EUR pocket
    assert.equal(wiseAfterPocketArchive.total_balance, 100);
    // Transaction stays safely in log
    assert.ok(dashArchivedPocket.data.transactions.some((tx) => tx.id === pocketTxId));

    // Restore archived pocket
    const restorePocket = await reqJson(`/api/pockets/${backupPocketId}`, {
      method: 'PATCH',
      body: { isArchived: false },
    });
    assert.equal(restorePocket.status, 200);
    assert.equal(restorePocket.data.pocket.is_archived, 0);

    // Archive entire Wise bank account and verify balance AND transactions are hidden from active dashboard list
    const netWorthBeforeBankArchive = (await reqJson('/api/dashboard')).data.totalNetWorthHuf;
    const archiveBank = await reqJson(`/api/accounts/${wiseId}`, {
      method: 'DELETE',
      body: { action: 'archive' },
    });
    assert.equal(archiveBank.status, 200);

    const dashAfterBankArchive = await reqJson('/api/dashboard');
    const wiseArchived = dashAfterBankArchive.data.accounts.find((a) => a.id === wiseId);
    assert.equal(wiseArchived.is_archived, 1);
    assert.equal(wiseArchived.total_balance, 0);
    assert.ok(dashAfterBankArchive.data.totalNetWorthHuf < netWorthBeforeBankArchive);
    assert.equal(dashAfterBankArchive.data.transactions.some((tx) => tx.id === pocketTxId), false);

    // Restore Wise bank account -> transactions reappear in list, then test permanent purge
    const restoreBank = await reqJson(`/api/accounts/${wiseId}`, {
      method: 'PATCH',
      body: { isArchived: false },
    });
    assert.equal(restoreBank.status, 200);
    assert.equal(restoreBank.data.account.is_archived, 0);

    const dashAfterRestore = await reqJson('/api/dashboard');
    assert.ok(dashAfterRestore.data.transactions.some((tx) => tx.id === pocketTxId));

    const delPocket = await reqJson(`/api/pockets/${backupPocketId}`, {
      method: 'DELETE',
      body: { action: 'purge' },
    });
    assert.equal(delPocket.status, 200);

    const delBank = await reqJson(`/api/accounts/${wiseId}`, {
      method: 'DELETE',
      body: { action: 'purge' },
    });
    assert.equal(delBank.status, 200);
  });

  await t.test('Static asset no-cache headers and 404 for dotfile probes', async () => {
    const jsRes = await fetch(`${baseUrl}/js/app.js`);
    assert.equal(jsRes.status, 200);
    assert.equal(jsRes.headers.get('cache-control'), 'no-cache');

    const cssRes = await fetch(`${baseUrl}/css/styles.css`);
    assert.equal(cssRes.status, 200);
    assert.equal(cssRes.headers.get('cache-control'), 'no-cache');

    const themeInitRes = await fetch(`${baseUrl}/js/theme-init.js`);
    assert.equal(themeInitRes.status, 200);
    assert.equal(themeInitRes.headers.get('cache-control'), 'no-cache');

    const cspHttp = jsRes.headers.get('content-security-policy') || '';
    assert.ok(cspHttp.includes("default-src 'self'"));
    assert.ok(cspHttp.includes("script-src 'self'"));
    assert.ok(!cspHttp.includes("script-src 'self' 'unsafe-inline'"));
    assert.ok(cspHttp.includes("frame-ancestors 'none'"));
    assert.ok(!cspHttp.includes('upgrade-insecure-requests'));
    assert.equal(jsRes.headers.get('strict-transport-security'), null);

    const httpsProxyRes = await fetch(`${baseUrl}/`, {
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    assert.equal(httpsProxyRes.status, 200);
    assert.equal(httpsProxyRes.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
    const cspHttps = httpsProxyRes.headers.get('content-security-policy') || '';
    assert.ok(cspHttps.includes('upgrade-insecure-requests'));
    assert.ok(cspHttps.includes("script-src 'self'"));

    const envRes = await fetch(`${baseUrl}/.env`);
    assert.equal(envRes.status, 404);

    const gitRes = await fetch(`${baseUrl}/.git/HEAD`);
    assert.equal(gitRes.status, 404);
  });

  await t.test('Hide historical filter across graphs/KPIs/months and Dashboard Layout persistence', async () => {
    // Create historical-only and mixed historical+live recipients to verify hideHistorical counterparty filtering
    const histOnlyExp = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2025-05-01T10:00',
        type: 'expense',
        amount: 1200,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryName: 'Shopping',
        merchant: 'Mock HistOnlyShop',
        note: 'historical only expense',
        isHistorical: true,
      },
    });
    assert.equal(histOnlyExp.status, 201);

    const histOnlyInc = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2025-05-02T10:00',
        type: 'income',
        amount: 5000,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryName: 'Other Income',
        merchant: 'Mock HistOnlySource',
        note: 'historical only income',
        isHistorical: true,
      },
    });
    assert.equal(histOnlyInc.status, 201);

    const mixedHist = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2025-05-03T10:00',
        type: 'expense',
        amount: 900,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryName: 'Shopping',
        merchant: 'Mock MixedHistLiveShop',
        note: 'historical tx for mixed',
        isHistorical: true,
      },
    });
    assert.equal(mixedHist.status, 201);

    const mixedLive = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-10T10:00',
        type: 'expense',
        amount: 1500,
        currency: 'HUF',
        pocketId: otpMainId,
        categoryName: 'Shopping',
        merchant: 'Mock MixedHistLiveShop',
        note: 'live tx for mixed',
        isHistorical: false,
      },
    });
    assert.equal(mixedLive.status, 201);

    const allDash = await reqJson('/api/dashboard?limit=500');
    assert.equal(allDash.status, 200);
    const hasHist = allDash.data.transactions.some((tx) => tx.is_historical === 1);
    assert.ok(hasHist, 'Expected imported historical transactions in test DB');
    assert.ok(allDash.data.counterparties.out.some((c) => c.name === 'Mock HistOnlyShop'));
    assert.ok(allDash.data.counterparties.in.some((c) => c.name === 'Mock HistOnlySource'));
    assert.ok(allDash.data.counterparties.out.some((c) => c.name === 'Mock MixedHistLiveShop'));

    const liveDash = await reqJson('/api/dashboard?historical=live&limit=500');
    assert.equal(liveDash.status, 200);
    assert.ok(liveDash.data.transactions.every((tx) => tx.is_historical === 0));
    assert.ok(liveDash.data.kpis.txCount < allDash.data.kpis.txCount);
    assert.ok(liveDash.data.charts.monthlyCashflow.length <= allDash.data.charts.monthlyCashflow.length);
    assert.equal(liveDash.data.totalNetWorthHuf, allDash.data.totalNetWorthHuf);
    assert.ok(liveDash.data.availableMonths.length <= allDash.data.availableMonths.length);
    assert.equal(liveDash.data.counterparties.out.some((c) => c.name === 'Mock HistOnlyShop'), false);
    assert.equal(liveDash.data.counterparties.in.some((c) => c.name === 'Mock HistOnlySource'), false);
    assert.equal(liveDash.data.counterparties.out.some((c) => c.name === 'Mock MixedHistLiveShop'), true);
    assert.equal(liveDash.data.counterparties.in.some((c) => c.name === 'Mock Family Sender'), true);

    // Reverse existing bank order and customize layout
    const origBankIds = allDash.data.accounts.map((a) => a.id);
    const reversedBankIds = [...origBankIds].reverse();
    const layoutPayload = {
      sectionOrder: ['charts', 'kpis', 'ledger', 'banks'],
      hiddenSections: ['kpis'],
      sectionSpans: { banks: 1, charts: 1 },
      kpiOrder: ['kpi-cashflow', 'kpi-networth', 'kpi-income', 'kpi-expense'],
      hiddenKpis: ['kpi-income'],
      kpiSpans: { 'kpi-networth': 2 },
      chartOrder: ['chart-balance', 'chart-monthly', 'chart-donut', 'chart-income'],
      hiddenCharts: ['chart-donut'],
      chartSpans: { 'chart-monthly': 2 },
      bankOrder: reversedBankIds,
      bankSpans: { [String(reversedBankIds[0])]: 2 },
      hideHistorical: true,
      lang: 'hu',
      palette: {
        preset: 'sand',
        primary: '#8f653d',
        accent: '#b6895b',
        positive: '#2e8b57',
        negative: '#c94a4a',
        bg: '#f7f3ed',
        card: '#fffdf9',
      },
    };

    const saveRes = await reqJson('/api/dashboard-layout', {
      method: 'PUT',
      body: layoutPayload,
    });
    assert.equal(saveRes.status, 200);
    assert.deepEqual(saveRes.data.dashboardLayout.sectionOrder, layoutPayload.sectionOrder);
    assert.deepEqual(saveRes.data.dashboardLayout.sectionSpans, layoutPayload.sectionSpans);
    assert.deepEqual(saveRes.data.dashboardLayout.bankSpans, layoutPayload.bankSpans);
    assert.equal(saveRes.data.dashboardLayout.hideHistorical, true);
    assert.equal(saveRes.data.dashboardLayout.lang, 'hu');

    const cpWithLayoutHide = await reqJson('/api/counterparties');
    assert.equal(cpWithLayoutHide.status, 200);
    assert.equal(cpWithLayoutHide.data.counterparties.out.some((c) => c.name === 'Mock HistOnlyShop'), false);
    assert.equal(cpWithLayoutHide.data.counterparties.in.some((c) => c.name === 'Mock HistOnlySource'), false);
    assert.equal(cpWithLayoutHide.data.counterparties.out.some((c) => c.name === 'Mock MixedHistLiveShop'), true);
    assert.deepEqual(saveRes.data.dashboardLayout.palette, layoutPayload.palette);
    // Legacy flat layout migrates automatically to 2D rows
    assert.ok(Array.isArray(saveRes.data.dashboardLayout.sectionRows));
    assert.equal(saveRes.data.dashboardLayout.sectionRows.length, 4);
    assert.deepEqual(saveRes.data.dashboardLayout.chartRows[0], [{ id: 'chart-balance', w: 1 }]);

    const afterSave = await reqJson('/api/dashboard');
    assert.equal(afterSave.status, 200);
    assert.deepEqual(afterSave.data.dashboardLayout.chartOrder, layoutPayload.chartOrder);
    assert.deepEqual(afterSave.data.dashboardLayout.hiddenSections, ['kpis']);
    assert.equal(afterSave.data.dashboardLayout.chartSpans['chart-monthly'], 2);
    assert.equal(afterSave.data.dashboardLayout.lang, 'hu');
    assert.deepEqual(afterSave.data.dashboardLayout.palette, layoutPayload.palette);
    assert.deepEqual(
      afterSave.data.accounts.map((a) => a.id),
      reversedBankIds
    );

    // 2D row layout + custom proportional weights & custom heights persistence
    const firstBankStr = String(reversedBankIds[0]);
    const restBanks = reversedBankIds.slice(1).map((id) => ({ id: String(id), w: 1 }));
    const twoDLayout = {
      ...layoutPayload,
      sectionRows: [
        [
          { id: 'charts', w: 1.45 },
          { id: 'banks', w: 0.55 },
        ],
        [{ id: 'ledger', w: 1 }],
        [{ id: 'kpis', w: 1 }],
      ],
      kpiRows: [
        [
          { id: 'kpi-networth', w: 1.5 },
          { id: 'kpi-cashflow', w: 0.5 },
        ],
        [
          { id: 'kpi-income', w: 1 },
          { id: 'kpi-expense', w: 1 },
        ],
      ],
      chartRows: [
        [
          { id: 'chart-monthly', w: 1.3 },
          { id: 'chart-donut', w: 0.7 },
          { id: 'chart-balance', w: 1 },
        ],
        [{ id: 'chart-income', w: 1 }],
      ],
      bankRows: restBanks.length > 0 ? [[{ id: firstBankStr, w: 1.6 }, ...restBanks]] : [[{ id: firstBankStr, w: 1 }]],
      itemHeights: {
        'chart-monthly': 340,
        ledger: 620,
      },
      itemWidths: {
        kpis: 72.5,
      },
      autoSize: false,
      manualSizes: {
        'kpi-networth': { w: 220, h: 74 },
        'chart-monthly': { w: 420, h: 180 },
      },
      ledgerPageSize: 17,
    };
    const save2D = await reqJson('/api/dashboard-layout', {
      method: 'PUT',
      body: twoDLayout,
    });
    assert.equal(save2D.status, 200);
    assert.deepEqual(save2D.data.dashboardLayout.sectionRows, twoDLayout.sectionRows);
    assert.deepEqual(save2D.data.dashboardLayout.kpiRows, twoDLayout.kpiRows);
    assert.deepEqual(save2D.data.dashboardLayout.chartRows, twoDLayout.chartRows);
    assert.deepEqual(save2D.data.dashboardLayout.bankRows, twoDLayout.bankRows);
    assert.deepEqual(save2D.data.dashboardLayout.itemHeights, twoDLayout.itemHeights);
    assert.deepEqual(save2D.data.dashboardLayout.itemWidths, twoDLayout.itemWidths);
    assert.equal(save2D.data.dashboardLayout.autoSize, false);
    assert.deepEqual(save2D.data.dashboardLayout.manualSizes, twoDLayout.manualSizes);
    assert.equal(save2D.data.dashboardLayout.ledgerPageSize, 17);
    assert.deepEqual(save2D.data.dashboardLayout.sectionOrder, ['charts', 'banks', 'ledger', 'kpis']);

    const after2D = await reqJson('/api/dashboard');
    assert.equal(after2D.status, 200);
    assert.deepEqual(after2D.data.dashboardLayout.sectionRows, twoDLayout.sectionRows);
    assert.deepEqual(after2D.data.dashboardLayout.itemHeights, twoDLayout.itemHeights);
    assert.deepEqual(after2D.data.dashboardLayout.itemWidths, twoDLayout.itemWidths);
    assert.equal(after2D.data.dashboardLayout.autoSize, false);
    assert.deepEqual(after2D.data.dashboardLayout.manualSizes, twoDLayout.manualSizes);
    assert.equal(after2D.data.dashboardLayout.ledgerPageSize, 17);
    assert.ok(after2D.data.dashboardLayout.hiddenKpis.includes('kpi-daily-avg'));
    assert.ok(after2D.data.dashboardLayout.hiddenCharts.includes('chart-net-trend'));

    // New KPI metrics & chart datasets
    assert.equal(typeof after2D.data.kpis.avgDailyExpenseHuf, 'number');
    assert.equal(typeof after2D.data.kpis.avgExpenseTxHuf, 'number');
    assert.ok(after2D.data.kpis.activeExpenseDays >= 1);
    assert.ok(after2D.data.kpis.topMerchant && after2D.data.kpis.topMerchant.amountHuf > 0);
    assert.ok(after2D.data.kpis.biggestExpense && after2D.data.kpis.biggestExpense.amountHuf > 0);
    assert.equal(typeof after2D.data.kpis.recurringExpenseHuf, 'number');
    assert.equal(typeof after2D.data.kpis.inCount, 'number');
    assert.equal(typeof after2D.data.kpis.outCount, 'number');
    assert.ok(after2D.data.kpis.receiptCount >= 1);

    assert.ok(Array.isArray(after2D.data.charts.topMerchants) && after2D.data.charts.topMerchants.length >= 1);
    assert.ok(Array.isArray(after2D.data.charts.topIncomeSources) && after2D.data.charts.topIncomeSources.length >= 1);
    assert.ok(Array.isArray(after2D.data.charts.dailySpending) && after2D.data.charts.dailySpending.length >= 1);
    assert.equal(after2D.data.charts.weekdaySpending.length, 7);
    assert.ok(Array.isArray(after2D.data.charts.wealthDistribution) && after2D.data.charts.wealthDistribution.length >= 1);
    assert.equal(typeof after2D.data.charts.monthlyCashflow[0].cumulativeNetHuf, 'number');
    assert.equal(typeof after2D.data.charts.monthlyCashflow[0].savingsRate, 'number');

    // Toggling optional KPI cards & graphs persists cleanly when explicitly included in kpiRows/chartRows
    const expandedLayout = {
      ...twoDLayout,
      kpiRows: [
        ...twoDLayout.kpiRows,
        [
          { id: 'kpi-daily-avg', w: 1 },
          { id: 'kpi-top-merchant', w: 1 },
          { id: 'kpi-recurring', w: 1 },
        ],
      ],
      chartRows: [
        ...twoDLayout.chartRows,
        [
          { id: 'chart-net-trend', w: 1 },
          { id: 'chart-weekday', w: 1 },
        ],
      ],
      hiddenKpis: ['kpi-income'],
      hiddenCharts: ['chart-donut'],
    };
    const saveExp = await reqJson('/api/dashboard-layout', {
      method: 'PUT',
      body: expandedLayout,
    });
    assert.equal(saveExp.status, 200);
    assert.equal(saveExp.data.dashboardLayout.hiddenKpis.includes('kpi-daily-avg'), false);
    assert.equal(saveExp.data.dashboardLayout.hiddenKpis.includes('kpi-top-merchant'), false);
    assert.equal(saveExp.data.dashboardLayout.hiddenKpis.includes('kpi-biggest-expense'), true);
    assert.equal(saveExp.data.dashboardLayout.hiddenCharts.includes('chart-net-trend'), false);
    assert.equal(saveExp.data.dashboardLayout.hiddenCharts.includes('chart-weekday'), false);
    assert.equal(saveExp.data.dashboardLayout.hiddenCharts.includes('chart-bank-dist'), true);

    // Ledger pagination (page + limit + totalPages + clamping out-of-range page)
    const p1 = await reqJson('/api/dashboard?limit=5&page=1');
    const p2 = await reqJson('/api/dashboard?limit=5&page=2');
    assert.equal(p1.status, 200);
    assert.equal(p2.status, 200);
    assert.equal(p1.data.page, 1);
    assert.equal(p1.data.pageSize, 5);
    assert.equal(p2.data.page, 2);
    assert.equal(p1.data.transactions.length, 5);
    assert.ok(p2.data.transactions.length >= 1);
    assert.ok(p1.data.totalPages >= 2);
    const p1Ids = new Set(p1.data.transactions.map((tx) => tx.id));
    assert.ok(p2.data.transactions.every((tx) => !p1Ids.has(tx.id)), 'Page 2 entries must not overlap page 1');

    const pTooHigh = await reqJson('/api/dashboard?limit=5&page=999');
    assert.equal(pTooHigh.status, 200);
    assert.equal(pTooHigh.data.page, pTooHigh.data.totalPages);
  });

  await t.test('Pure English default markup and full EN/HU i18n module served', async () => {
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('id="lang-select"'));
    assert.ok(html.includes('id="auth-lang-select"'));
    assert.equal(html.includes('Honnan'), false);
    assert.equal(html.includes('Hova'), false);
    assert.equal(/\b(Erste|OTP|Revolut)\b/i.test(html), false, 'Static HTML must be universal and bank-agnostic');
    assert.equal(html.includes('Work · Scholarship · Gifts'), false);
    assert.equal(html.includes('Shopping · Tech · Fuel'), false);
    assert.equal(html.includes('Savings: 0% · Transfers: 0 Ft (0)'), false);
    assert.ok(html.includes('id="settings-tab-general"'));
    assert.ok(html.includes('id="settings-tab-data"'));
    assert.ok(html.includes('id="settings-banks-pockets-panel"'));
    assert.ok(html.includes('id="settings-recipients-panel"'));
    assert.ok(html.includes('id="settings-categories-panel"'));

    // Full Category CRUD (income & expense)
    const addIncCat = await reqJson('/api/categories', {
      method: 'POST',
      body: { name: 'Freelance Consulting', type: 'income', color: '#22c55e' },
    });
    assert.equal(addIncCat.status, 201);
    const incCatId = addIncCat.data.category.id;
    assert.ok(addIncCat.data.categories.some((c) => c.id === incCatId));

    const renameIncCat = await reqJson(`/api/categories/${incCatId}`, {
      method: 'PATCH',
      body: { name: 'Side Hustle', color: '#16a34a' },
    });
    assert.equal(renameIncCat.status, 200);
    assert.equal(renameIncCat.data.category.name, 'Side Hustle');

    const delIncCat = await reqJson(`/api/categories/${incCatId}`, { method: 'DELETE' });
    assert.equal(delIncCat.status, 200);
    assert.equal(delIncCat.data.categories.some((c) => c.id === incCatId), false);

    const addExpCat = await reqJson('/api/categories', {
      method: 'POST',
      body: { name: 'Pet Care', type: 'expense', color: '#f97316' },
    });
    assert.equal(addExpCat.status, 201);
    const delExpCat = await reqJson(`/api/categories/${addExpCat.data.category.id}`, { method: 'DELETE' });
    assert.equal(delExpCat.status, 200);

    const i18nRes = await fetch(`${baseUrl}/js/i18n.js`);
    assert.equal(i18nRes.status, 200);
    assert.equal(i18nRes.headers.get('cache-control'), 'no-cache');
    const i18nCode = await i18nRes.text();
    assert.ok(i18nCode.includes('tCat'));
    assert.equal(/\b(Erste|OTP|Revolut)\b/i.test(i18nCode), false, 'i18n UI strings must not contain hardcoded bank names');
    assert.ok(i18nCode.includes('tranzakció') || i18nCode.includes('Tranzakciós napló'));
    const sandboxWin = {};
    const mockStorage = { getItem: () => null, setItem: () => {} };
    new Function('window', 'localStorage', i18nCode)(sandboxWin, mockStorage);
    assert.ok(sandboxWin.MoneyI18n && sandboxWin.MoneyI18n.STRINGS);
    const { en: enDict, hu: huDict } = sandboxWin.MoneyI18n.STRINGS;
    assert.equal(enDict.btnClose, 'Close');
    assert.equal(huDict.btnClose, 'Bezárás');
    const htmlI18nKeys = Array.from(html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g), (m) => m[1]);
    assert.ok(htmlI18nKeys.length > 20);
    for (const k of htmlI18nKeys) {
      assert.ok(typeof enDict[k] === 'string' && enDict[k].length > 0, `Missing EN i18n key: ${k}`);
      assert.ok(typeof huDict[k] === 'string' && huDict[k].length > 0, `Missing HU i18n key: ${k}`);
    }
    assert.ok(html.includes('id="cp-edit-modal"'));
    assert.ok(html.includes('id="cp-edit-form"'));
    assert.ok(html.includes('id="cpm-update-prev"'));
  });

  await t.test('Counterparty PATCH modification with optional retroactive transaction update', async () => {
    const initDash = await reqJson('/api/dashboard');
    assert.equal(initDash.status, 200);
    const activeAcc = initDash.data.accounts.find((a) => !a.is_archived && a.pockets?.some((p) => !p.is_archived));
    const pocketId = activeAcc.pockets.find((p) => !p.is_archived).id;
    const expCat1 = initDash.data.categories.find((c) => c.type === 'expense');
    const expCat2 = initDash.data.categories.find((c) => c.type === 'expense' && c.id !== expCat1.id) || expCat1;
    const incCat1 = initDash.data.categories.find((c) => c.type === 'income');
    const incCat2 = initDash.data.categories.find((c) => c.type === 'income' && c.id !== incCat1.id) || incCat1;

    // Expense merchant edited with updatePrevious: false -> old transactions untouched
    const txOut = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-10T10:00',
        type: 'expense',
        amount: 1500,
        currency: 'HUF',
        pocketId,
        categoryId: expCat1.id,
        merchant: 'Mock Coffee Stand',
        note: '',
      },
    });
    assert.equal(txOut.status, 201);
    const txOutId = txOut.data.transaction.id;

    // Income origin edited with updatePrevious: true -> old transactions updated
    const txIn = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-11T12:00',
        type: 'income',
        amount: 25000,
        currency: 'HUF',
        pocketId,
        categoryId: incCat1.id,
        merchant: 'Mock Client Legacy',
        note: '',
      },
    });
    assert.equal(txIn.status, 201);
    const txInId = txIn.data.transaction.id;

    const cpRes = await reqJson('/api/counterparties');
    assert.equal(cpRes.status, 200);
    const outCp = cpRes.data.counterparties.out.find((c) => c.name === 'Mock Coffee Stand');
    const inCp = cpRes.data.counterparties.in.find((c) => c.name === 'Mock Client Legacy');
    assert.ok(outCp);
    assert.ok(inCp);
    assert.ok(Number(outCp.tx_count) >= 1);
    assert.ok(Number(inCp.tx_count) >= 1);

    const patchOutNoPrev = await reqJson(`/api/counterparties/${outCp.id}`, {
      method: 'PATCH',
      body: { name: 'Mock Roastery Beta', categoryId: expCat2.id, updatePrevious: false },
    });
    assert.equal(patchOutNoPrev.status, 200);
    assert.equal(patchOutNoPrev.data.item.name, 'Mock Roastery Beta');
    assert.equal(patchOutNoPrev.data.updatedTransactions, 0);

    const patchInWithPrev = await reqJson(`/api/counterparties/${inCp.id}`, {
      method: 'PATCH',
      body: { name: 'Mock Client Modern', categoryId: incCat2.id, updatePrevious: true },
    });
    assert.equal(patchInWithPrev.status, 200);
    assert.equal(patchInWithPrev.data.item.name, 'Mock Client Modern');
    assert.ok(patchInWithPrev.data.updatedTransactions >= 1);

    const afterDash = await reqJson('/api/dashboard?limit=200');
    assert.equal(afterDash.status, 200);
    const untouchedTx = afterDash.data.transactions.find((x) => x.id === txOutId);
    const updatedTx = afterDash.data.transactions.find((x) => x.id === txInId);
    assert.equal(untouchedTx.merchant, 'Mock Coffee Stand');
    assert.equal(untouchedTx.category_id, expCat1.id);
    assert.equal(updatedTx.merchant, 'Mock Client Modern');
    assert.equal(updatedTx.category_id, incCat2.id);
    assert.equal(updatedTx.category_name, incCat2.name);
    assert.ok(updatedTx.note.includes('Mock Client Modern'));
  });

  await t.test('Subpath /moneymanager/ routing, 301 redirect, and subpath-safe relative HTML assets', async () => {
    const redirRes = await fetch(`${baseUrl}/moneymanager`, { redirect: 'manual' });
    assert.equal(redirRes.status, 301);
    assert.equal(redirRes.headers.get('location'), '/moneymanager/');

    const subHtmlRes = await fetch(`${baseUrl}/moneymanager/`);
    assert.equal(subHtmlRes.status, 200);
    const subHtml = await subHtmlRes.text();
    assert.ok(subHtml.includes('href="css/styles.css"'));
    assert.ok(subHtml.includes('src="js/app.js"'));
    assert.ok(subHtml.includes('id="edit-palette-bar"'));
    assert.ok(subHtml.includes('id="settings-palette-panel"'));
    assert.ok(subHtml.includes('id="receipt-progress-box"'));
    assert.ok(subHtml.includes('id="receipt-quota-bar"'));
    assert.ok(subHtml.includes('id="settings-gemini-quota"'));
    assert.ok(subHtml.includes('id="rc-source-badge"'));
    assert.ok(subHtml.includes('id="rc-type"'));
    assert.ok(subHtml.includes('id="rc-time"'));
    assert.ok(subHtml.includes('id="rc-dest-pocket"'));
    assert.ok(subHtml.includes('id="pending-approvals-banner"'));
    assert.ok(subHtml.includes('id="filter-approval"'));
    assert.ok(subHtml.includes('id="filter-sort"'));
    assert.ok(subHtml.includes('id="chip-filter-recurring"'));
    assert.ok(subHtml.includes('id="btn-reset-filters"'));
    assert.ok(subHtml.includes('id="settings-notifications-panel"'));
    assert.ok(subHtml.includes('id="note-modal"'));
    assert.ok(subHtml.includes('id="note-form"'));
    assert.ok(subHtml.includes('id="note-modal-input"'));
    assert.ok(subHtml.includes('id="receipt-attach-banner"'));
    assert.ok(subHtml.includes('id="rv-replace-receipt-btn"'));
    assert.ok(subHtml.includes('href="manifest.webmanifest"'));
    assert.equal(subHtml.includes('src="/js/'), false);

    const directDash = await reqJson('/api/dashboard');
    const subDash = await reqJson('/moneymanager/api/dashboard');
    assert.equal(subDash.status, 200);
    assert.equal(subDash.data.totalNetWorthHuf, directDash.data.totalNetWorthHuf);
    assert.equal(subDash.data.accounts.length, directDash.data.accounts.length);
  });

  await t.test('Gemini Vision quota tracking detects RPM/daily thresholds and rate-limit status', async () => {
    // Use isolated test DB from createApp
    let stats = getGeminiUsageStats(db, getSetting, 'gemini-4-hydrogen');
    assert.equal(stats.requestsToday, 0);
    assert.equal(stats.nearLimit, false);
    assert.equal(stats.status, 'ok');

    // Simulate 8 requests within 60s against standard 10 RPM free tier -> triggers nearLimit warning (80% RPM)
    for (let i = 0; i < 8; i++) {
      stats = recordGeminiUsage(db, getSetting, setSetting, {
        counted: true,
        model: 'gemini-4-hydrogen',
        tokens: 350,
        rateLimitHit: false,
        errorStatus: null,
      });
    }
    assert.equal(stats.requestsToday, 8);
    assert.equal(stats.tokensToday, 2800);
    assert.equal(stats.rpmUsed, 8);
    assert.equal(stats.nearLimit, true);
    assert.equal(stats.status, 'warning');

    // Simulate HTTP 429 rate-limit response
    stats = recordGeminiUsage(db, getSetting, setSetting, {
      counted: true,
      model: 'gemini-4-hydrogen',
      tokens: 0,
      rateLimitHit: true,
      errorStatus: 429,
    });
    assert.equal(stats.rateLimitHitsToday, 1);
    assert.equal(stats.lastErrorStatus, 429);
    assert.equal(stats.status, 'rate_limited');
  });

  await t.test('Banking app screenshot uploads detect bank/type/pocket and auto-log expense, income, and transfer', async () => {
    const dummyImgB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');

    // 1. Payload normalization for Gemini banking screenshot JSON
    const normalized = normalizeGeminiPayload({
      source_type: 'bank_screenshot',
      tx_type: 'income',
      merchant: 'Mock Employer Corp.',
      date: '2026-11-15',
      time: '08:31:00',
      amount: '420000 Ft',
      currency: 'Ft',
      category: 'Salary',
      bank_hint: 'OTP Bank',
      pocket_hint: 'fo számla',
      balance_after: '615000 Ft',
      auto_note: 'November salary credited',
    });
    assert.equal(normalized.source_type, 'bank_screenshot');
    assert.equal(normalized.tx_type, 'income');
    assert.equal(normalized.time, '08:31');
    assert.equal(normalized.amount, 420000);
    assert.equal(normalized.currency, 'HUF');
    assert.equal(normalized.category, 'Work / Salary');
    assert.equal(normalized.bank_hint, 'OTP');
    assert.equal(normalized.pocket_hint, 'fo számla');
    assert.equal(normalized.balance_after, 615000);

    // 2. Outgoing banking screenshot -> auto-matched to OTP pocket regardless of dropdown default
    const dashBefore = await reqJson('/api/dashboard');
    const otpAccBefore = dashBefore.data.accounts.find((a) => a.name === 'OTP');
    const otpMainBefore = otpAccBefore.pockets.find((p) => p.name === 'fo számla');
    const otpPerselyBefore = otpAccBefore.pockets.find((p) => p.name === 'persely számla');
    const revMainBefore = dashBefore.data.accounts.find((a) => a.name === 'Revolut').pockets.find((p) => p.name === 'Main');

    const otpSpendRes = await reqJson('/api/receipts/scan', {
      method: 'POST',
      body: {
        imageBase64: `data:image/png;base64,${dummyImgB64}`,
        mimeType: 'image/png',
        filename: 'otp-card-screenshot.png',
        pocketId: ersteMainId,
        autoLog: true,
      },
    });
    assert.equal(otpSpendRes.status, 200);
    assert.equal(otpSpendRes.data.parsed.source_type, 'bank_screenshot');
    assert.equal(otpSpendRes.data.parsed.bank_hint, 'OTP');
    assert.equal(otpSpendRes.data.parsed.tx_type, 'expense');
    assert.equal(otpSpendRes.data.autoLogged, true);
    assert.equal(otpSpendRes.data.transaction.pocket_id, otpMainBefore.id);
    assert.equal(otpSpendRes.data.transaction.type, 'expense');
    assert.equal(otpSpendRes.data.transaction.amount, 6890);

    // 3. Incoming salary banking screenshot -> Revolut Main balance increases
    const revIncomeRes = await reqJson('/api/receipts/scan', {
      method: 'POST',
      body: {
        imageBase64: `data:image/png;base64,${dummyImgB64}`,
        mimeType: 'image/png',
        filename: 'revolut-income-screenshot.png',
        pocketId: ersteMainId,
        autoLog: true,
      },
    });
    assert.equal(revIncomeRes.status, 200);
    assert.equal(revIncomeRes.data.parsed.source_type, 'bank_screenshot');
    assert.equal(revIncomeRes.data.parsed.bank_hint, 'Revolut');
    assert.equal(revIncomeRes.data.parsed.tx_type, 'income');
    assert.equal(revIncomeRes.data.autoLogged, true);
    assert.equal(revIncomeRes.data.transaction.type, 'income');
    assert.equal(revIncomeRes.data.transaction.pocket_id, revMainBefore.id);
    assert.equal(revIncomeRes.data.transaction.pocket_balance_after, revMainBefore.current_balance + 345000);

    // 4. Internal transfer banking screenshot -> OTP fo számla to OTP persely számla
    const otpTransferRes = await reqJson('/api/receipts/scan', {
      method: 'POST',
      body: {
        imageBase64: `data:image/png;base64,${dummyImgB64}`,
        mimeType: 'image/png',
        filename: 'otp-persely-transfer-screenshot.png',
        pocketId: ersteMainId,
        autoLog: true,
      },
    });
    assert.equal(otpTransferRes.status, 200);
    assert.equal(otpTransferRes.data.parsed.source_type, 'bank_screenshot');
    assert.equal(otpTransferRes.data.parsed.tx_type, 'transfer');
    assert.equal(otpTransferRes.data.autoLogged, true);
    assert.equal(otpTransferRes.data.transaction.type, 'transfer');
    assert.equal(otpTransferRes.data.transaction.pocket_id, otpMainBefore.id);
    assert.equal(otpTransferRes.data.transaction.dest_pocket_id, otpPerselyBefore.id);
    assert.equal(otpTransferRes.data.transaction.dest_pocket_balance_after, otpPerselyBefore.current_balance + 25000);
  });

  await t.test('Bank notification webhook auto-logs OTP/Erste/Revolut events with Needs Approval label & filtering', async () => {
    const settingsRes = await reqJson('/api/settings');
    const token = settingsRes.data.webhookToken;
    assert.ok(token);

    // 1. Unauthorized webhook request without cookie or valid token -> 401
    const unauthRes = await fetch(`${baseUrl}/api/notifications/webhook?token=wrongtoken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'OTP', text: 'Kártyás vásárlás: 1 000 Ft, Mock Supermarket' }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Non-transaction 2FA code notification -> ignored safely
    const codeRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package: 'hu.otpbank.mobilbank',
        title: 'OTP MobilBank',
        text: 'Egyszeri hitelesítő kód: 492811. Soha ne add ki senkinek!',
      }),
    });
    assert.equal(codeRes.status, 200);
    const codeData = await codeRes.json();
    assert.equal(codeData.logged, false);
    assert.equal(codeData.ignored, true);

    // 2b. Non-transaction banking alerts (price/stock alerts, PIN/security recommendations, reactions, declined) -> ignored safely
    const irrelevantNotifications = [
      {
        app: 'Revolut',
        title: 'USD price alert',
        text: 'USD has hit your target price of 335 HUF',
      },
      {
        app: 'Revolut',
        title: 'Stock alert',
        text: 'Stock alert: AAPL hit your target price of $210',
      },
      {
        app: 'OTP Bank',
        title: 'Security recommendation',
        text: 'Recommended to change security pin to protect your account',
      },
      {
        app: 'Revolut',
        title: 'Mock Person Alpha Beta',
        text: 'Reacted ❤️ to your HUF1 payment',
      },
      {
        app: 'OTP MobilBank',
        title: 'Declined',
        text: 'Card payment of 4,500 HUF was declined at Store',
      },
    ];
    for (const payload of irrelevantNotifications) {
      const irRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(irRes.status, 200);
      const irData = await irRes.json();
      assert.equal(irData.logged, false, `Expected ignored for "${payload.text}"`);
      assert.equal(irData.ignored, true, `Expected ignored flag for "${payload.text}"`);
    }

    // 3. OTP MobilBank card payment -> logged on OTP with needs_approval = 1 (balance ignored from amount)
    const otpNotifRes = await fetch(`${baseUrl}/api/notifications/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        package: 'hu.otpbank.mobilbank',
        title: 'OTP MobilBank',
        text: 'Kártyás vásárlás: 8 450 HUF, MOCK GROCERY MAGYARORSZAG, Egyenleg: 245 100 HUF',
      }),
    });
    assert.equal(otpNotifRes.status, 200);
    const otpNotif = await otpNotifRes.json();
    assert.equal(otpNotif.logged, true);
    assert.equal(otpNotif.transaction.account_name, 'OTP');
    assert.equal(otpNotif.transaction.type, 'expense');
    assert.equal(otpNotif.transaction.amount, 8450);
    assert.equal(otpNotif.transaction.merchant, 'Mock Grocery');
    assert.equal(otpNotif.transaction.needs_approval, 1);
    assert.equal(otpNotif.transaction.auto_source, 'notification');

    // 4. Erste George incoming salary notification -> logged as income with needs_approval = 1
    const ersteNotifRes = await fetch(`${baseUrl}/moneymanager/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'Erste George',
        title: 'Beérkező utalás',
        text: 'Erste George: Beérkező utalás +120 000 HUF, Partner: Mock Employer Org, Közlemény: Munkabér',
      }),
    });
    assert.equal(ersteNotifRes.status, 200);
    const ersteNotif = await ersteNotifRes.json();
    assert.equal(ersteNotif.logged, true);
    assert.equal(ersteNotif.transaction.account_name, 'Erste');
    assert.equal(ersteNotif.transaction.pocket_name, 'fo számla');
    assert.equal(ersteNotif.transaction.type, 'income');
    assert.equal(ersteNotif.transaction.amount, 120000);
    assert.equal(ersteNotif.transaction.category_name, 'Work / Salary');
    assert.equal(ersteNotif.transaction.needs_approval, 1);

    // 5. Revolut transfer notification -> logged from Main -> Euro Vault with needs_approval = 1
    const revNotifRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'Revolut',
        text: 'Transferred HUF 15,000 to Euro Vault',
      }),
    });
    assert.equal(revNotifRes.status, 200);
    const revNotif = await revNotifRes.json();
    assert.equal(revNotif.logged, true);
    assert.equal(revNotif.transaction.account_name, 'Revolut');
    assert.equal(revNotif.transaction.pocket_name, 'Main');
    assert.equal(revNotif.transaction.type, 'transfer');
    assert.equal(revNotif.transaction.dest_pocket_name, 'Euro Vault');
    assert.equal(revNotif.transaction.needs_approval, 1);

    // 5b. Sender banking app priority: OTP notification mentioning "Revolut" and a non-bank suffix assigns to OTP's main pocket ("fo számla")
    const senderPriorityRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package: 'hu.otpbank.mobilbank',
        title: 'OTP MobilBank',
        text: 'Kártyás vásárlás: 12 300 HUF, Partner: Revolut Mock Auto Service',
        pocketId: ersteMainId,
      }),
    });
    assert.equal(senderPriorityRes.status, 200);
    const senderPriority = await senderPriorityRes.json();
    assert.equal(senderPriority.logged, true);
    assert.equal(senderPriority.transaction.account_name, 'OTP');
    assert.equal(senderPriority.transaction.pocket_name, 'fo számla');

    // 5c. MacroDroid literal newline inside JSON Magic Text + plain-text pipe body both succeed
    const multilineMagicRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"app":"OTP MobilBank","title":"Kártyás vásárlás","text":"4 500 HUF\nMock Discount Market","bigText":""}',
    });
    assert.equal(multilineMagicRes.status, 200);
    const multilineMagic = await multilineMagicRes.json();
    assert.equal(multilineMagic.logged, true);
    assert.equal(multilineMagic.transaction.account_name, 'OTP');
    assert.equal(multilineMagic.transaction.pocket_name, 'fo számla');
    assert.equal(multilineMagic.transaction.amount, 4500);

    const pipeBodyRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'Erste George | Fizetés érkezett | +95 000 HUF, Partner: Mock Studio Kft.',
    });
    assert.equal(pipeBodyRes.status, 200);
    const pipeBody = await pipeBodyRes.json();
    assert.equal(pipeBody.logged, true);
    assert.equal(pipeBody.transaction.account_name, 'Erste');
    assert.equal(pipeBody.transaction.pocket_name, 'fo számla');
    assert.equal(pipeBody.transaction.type, 'income');
    assert.equal(pipeBody.transaction.amount, 95000);

    // 5d. MacroDroid 5.x duplicated app/title + {notification} unexpanded fallback + ",- Ft" amount + webhookLogs
    const dualRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'OTP Bank OTP Bank',
        title: 'Kártyás fizetés Kártyás fizetés',
        text: '4 780,- Ft a(z) Mock Supermarket kereskedőnél',
        bigText: '{not_text_big}',
      }),
    });
    assert.equal(dualRes.status, 200);
    const dualData = await dualRes.json();
    assert.equal(dualData.logged, true);
    assert.equal(dualData.transaction.account_name, 'OTP');
    assert.equal(dualData.transaction.pocket_name, 'fo számla');
    assert.equal(dualData.transaction.amount, 4780);
    assert.equal(dualData.transaction.merchant, 'Mock Supermarket');

    const unexpandedRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"app":"OTP Bank","title":"Azonnali átutalás","text":"{not_text} [not_text]"}',
    });
    assert.equal(unexpandedRes.status, 200);
    const unexpandedData = await unexpandedRes.json();
    assert.equal(unexpandedData.logged, false);
    assert.match(unexpandedData.reason, /\{notification\}/);

    const settingsAfterWebhook = await reqJson('/api/settings');
    assert.equal(settingsAfterWebhook.status, 200);
    assert.ok(Array.isArray(settingsAfterWebhook.data.webhookLogs));
    assert.ok(settingsAfterWebhook.data.webhookLogs.length >= 2);

    // 5e. Revolut incoming P2P ("Sent you HUF1. Tap to say thank you 💰"), Revolut outgoing, & OTP +/- instant transfers
    const revSentYouRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'Revolut',
        title: 'Mock Person Alpha Beta',
        text: 'Sent you HUF1. Tap to say thank you 💰',
      }),
    });
    assert.equal(revSentYouRes.status, 200);
    const revSentYou = await revSentYouRes.json();
    assert.equal(revSentYou.logged, true);
    assert.equal(revSentYou.transaction.type, 'income');
    assert.equal(revSentYou.transaction.account_name, 'Revolut');
    assert.equal(revSentYou.transaction.pocket_name, 'Main');
    assert.equal(revSentYou.transaction.merchant, 'Mock Person Alpha Beta');
    assert.equal(revSentYou.transaction.amount, 1);
    assert.equal(revSentYou.transaction.currency, 'HUF');
    assert.equal(revSentYou.transaction.needs_approval, 1);

    const revOutRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'Revolut',
        title: 'Mock Streaming Service',
        text: 'Paid HUF 4,500',
      }),
    });
    assert.equal(revOutRes.status, 200);
    const revOut = await revOutRes.json();
    assert.equal(revOut.logged, true);
    assert.equal(revOut.transaction.type, 'expense');
    assert.equal(revOut.transaction.account_name, 'Revolut');
    assert.equal(revOut.transaction.pocket_name, 'Main');
    assert.equal(revOut.transaction.merchant, 'Mock Streaming Service');
    assert.equal(revOut.transaction.amount, 4500);

    const otpNegTransferRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'OTP Bank',
        title: 'Azonnali átutalás',
        text: '-25 000 Ft, Mock External Recipient',
      }),
    });
    assert.equal(otpNegTransferRes.status, 200);
    const otpNegTransfer = await otpNegTransferRes.json();
    assert.equal(otpNegTransfer.logged, true);
    assert.equal(otpNegTransfer.transaction.type, 'expense');
    assert.equal(otpNegTransfer.transaction.account_name, 'OTP');
    assert.equal(otpNegTransfer.transaction.pocket_name, 'fo számla');
    assert.equal(otpNegTransfer.transaction.merchant, 'Mock External Recipient');
    assert.equal(otpNegTransfer.transaction.amount, 25000);

    const otpPosTransferRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'OTP Bank',
        title: 'Azonnali átutalás',
        text: '+18 500 Ft, Mock Sender Two, Közlemény: vacsora',
      }),
    });
    assert.equal(otpPosTransferRes.status, 200);
    const otpPosTransfer = await otpPosTransferRes.json();
    assert.equal(otpPosTransfer.logged, true);
    assert.equal(otpPosTransfer.transaction.type, 'income');
    assert.equal(otpPosTransfer.transaction.account_name, 'OTP');
    assert.equal(otpPosTransfer.transaction.pocket_name, 'fo számla');
    assert.equal(otpPosTransfer.transaction.merchant, 'Mock Sender Two');
    assert.equal(otpPosTransfer.transaction.amount, 18500);

    // 6. Filter dashboard by approval=needs_approval & approval=approved
    const pendingDash = await reqJson('/api/dashboard?approval=needs_approval');
    assert.equal(pendingDash.status, 200);
    assert.ok(pendingDash.data.pendingApprovalCount >= 3);
    assert.ok(pendingDash.data.transactions.length > 0);
    assert.ok(pendingDash.data.transactions.every((tx) => tx.needs_approval === 1));

    const approvedOnlyDash = await reqJson('/api/dashboard?approval=approved');
    assert.equal(approvedOnlyDash.status, 200);
    assert.ok(approvedOnlyDash.data.transactions.every((tx) => tx.needs_approval === 0));

    // 7. Approve single transaction & then approve all remaining pending transactions
    const approveOneRes = await reqJson(`/api/transactions/${otpNotif.transaction.id}/approve`, {
      method: 'POST',
      body: {},
    });
    assert.equal(approveOneRes.status, 200);
    assert.equal(approveOneRes.data.transaction.needs_approval, 0);

    const approveAllRes = await reqJson('/api/transactions/approve-all', {
      method: 'POST',
      body: {},
    });
    assert.equal(approveAllRes.status, 200);
    assert.ok(approveAllRes.data.approvedCount >= 2);

    const afterApproveDash = await reqJson('/api/dashboard?approval=needs_approval');
    assert.equal(afterApproveDash.status, 200);
    assert.equal(afterApproveDash.data.pendingApprovalCount, 0);
    assert.equal(afterApproveDash.data.transactions.length, 0);
  });

  await t.test('Attach receipt later to existing transaction updates itemized auto-note and note modal PATCH flow', async () => {
    const dashBefore = await reqJson('/api/dashboard');
    const otpPocket = dashBefore.data.accounts.find((a) => a.name === 'OTP').pockets[0];

    // 1. Create an existing grocery transaction without a receipt and with auto-note
    const createdRes = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-16T12:00',
        type: 'expense',
        amount: 8450,
        currency: 'HUF',
        pocketId: otpPocket.id,
        categoryName: 'Shopping',
        merchant: 'Mock Grocery Store',
        note: '',
      },
    });
    assert.equal(createdRes.status, 201);
    const txId = createdRes.data.transaction.id;
    assert.equal(createdRes.data.transaction.receipt_path, null);
    assert.equal(createdRes.data.transaction.note_source, 'auto');

    // 2. Attach receipt later via POST /api/receipts/scan (attachToTxId + autoLog: true)
    const dummyImgB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
    const attachRes = await reqJson('/api/receipts/scan', {
      method: 'POST',
      body: {
        imageBase64: `data:image/jpeg;base64,${dummyImgB64}`,
        mimeType: 'image/jpeg',
        filename: 'mock-grocery-receipt.jpg',
        pocketId: otpPocket.id,
        autoLog: true,
        attachToTxId: txId,
      },
    });
    assert.equal(attachRes.status, 200);
    assert.equal(attachRes.data.attachedToExisting, true);
    assert.equal(attachRes.data.transaction.id, txId);
    assert.ok(attachRes.data.transaction.receipt_path);
    assert.equal(attachRes.data.transaction.store_address, '123 Mock Street, Mock City');
    assert.equal(attachRes.data.transaction.note_source, 'auto');
    assert.ok(attachRes.data.transaction.note.includes('Milk & Dairy x2 (1,450 HUF)'));
    assert.ok(attachRes.data.transaction.note.includes('Coffee & Snacks (2,910 HUF)'));
    assert.ok(attachRes.data.transaction.note.includes('Address: 123 Mock Street, Mock City'));

    // 3. Edit note manually (as #note-modal saves), then regenerate auto-note from items + address
    const manualPatch = await reqJson(`/api/transactions/${txId}`, {
      method: 'PATCH',
      body: { note: 'Weekly groceries', noteSource: 'manual' },
    });
    assert.equal(manualPatch.status, 200);
    assert.equal(manualPatch.data.transaction.note, 'Weekly groceries');
    assert.equal(manualPatch.data.transaction.note_source, 'manual');

    // Attaching/re-scanning via API autoLog must preserve existing manual note unless expandNote is chosen
    const attachPreserveManual = await reqJson('/api/receipts/scan', {
      method: 'POST',
      body: {
        imageBase64: `data:image/jpeg;base64,${dummyImgB64}`,
        mimeType: 'image/jpeg',
        filename: 'mock-grocery-receipt.jpg',
        pocketId: otpPocket.id,
        autoLog: true,
        attachToTxId: txId,
      },
    });
    assert.equal(attachPreserveManual.status, 200);
    assert.equal(attachPreserveManual.data.transaction.note, 'Weekly groceries');
    assert.equal(attachPreserveManual.data.transaction.note_source, 'manual');

    // Expanding manual note appends items (with amounts) + store address cleanly
    const attachExpandManual = await reqJson('/api/receipts/scan', {
      method: 'POST',
      body: {
        imageBase64: `data:image/jpeg;base64,${dummyImgB64}`,
        mimeType: 'image/jpeg',
        filename: 'mock-grocery-receipt.jpg',
        pocketId: otpPocket.id,
        autoLog: true,
        expandNote: true,
        attachToTxId: txId,
      },
    });
    assert.equal(attachExpandManual.status, 200);
    assert.equal(attachExpandManual.data.transaction.note_source, 'manual');
    assert.ok(attachExpandManual.data.transaction.note.startsWith('Weekly groceries | '));
    assert.ok(attachExpandManual.data.transaction.note.includes('Milk & Dairy x2 (1,450 HUF)'));
    assert.ok(attachExpandManual.data.transaction.note.includes('Address: 123 Mock Street, Mock City'));

    const regenPatch = await reqJson(`/api/transactions/${txId}`, {
      method: 'PATCH',
      body: { note: '', noteSource: 'auto' },
    });
    assert.equal(regenPatch.status, 200);
    assert.equal(regenPatch.data.transaction.note_source, 'auto');
    assert.ok(regenPatch.data.transaction.note.includes('Milk & Dairy x2 (1,450 HUF)'));
    assert.ok(regenPatch.data.transaction.note.includes('Fresh Bakery Bread (890 HUF)'));
    assert.ok(regenPatch.data.transaction.note.includes('Coffee & Snacks (2,910 HUF)'));
    assert.ok(regenPatch.data.transaction.note.includes('Address: 123 Mock Street, Mock City'));

    // 4. Attach image with skipScan: true on a manual tx -> attaches image without overwriting manual note/fields
    const manualOnlyTx = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-16T13:15',
        type: 'expense',
        amount: 3333,
        currency: 'HUF',
        pocketId: otpPocket.id,
        categoryName: 'Food & Dining',
        merchant: 'Mock Bakery',
        note: 'Cash pastry receipt',
        noteSource: 'manual',
      },
    });
    assert.equal(manualOnlyTx.status, 201);
    const manualTxId = manualOnlyTx.data.transaction.id;

    const skipScanRes = await reqJson('/api/receipts/scan', {
      method: 'POST',
      body: {
        imageBase64: `data:image/jpeg;base64,${dummyImgB64}`,
        mimeType: 'image/jpeg',
        filename: 'mock-bakery.jpg',
        skipScan: true,
        attachToTxId: manualTxId,
      },
    });
    assert.equal(skipScanRes.status, 200);
    assert.equal(skipScanRes.data.skippedScan, true);
    assert.equal(skipScanRes.data.attachedToExisting, true);
    assert.ok(skipScanRes.data.transaction.receipt_path);
    assert.equal(skipScanRes.data.transaction.merchant, 'Mock Bakery');
    assert.equal(skipScanRes.data.transaction.amount, 3333);
    assert.equal(skipScanRes.data.transaction.note, 'Cash pastry receipt');
    assert.equal(skipScanRes.data.transaction.note_source, 'manual');
  });

  await t.test('Exclude from analytics keeps ledger visibility & balance while excluding from KPIs and charts', async () => {
    const dashBase = await reqJson('/api/dashboard?month=2026-11');
    assert.equal(dashBase.status, 200);
    const otpPocketBefore = dashBase.data.accounts.find((a) => a.name === 'OTP').pockets[0];
    const baseExpenseHuf = dashBase.data.kpis.periodExpenseHuf;
    const baseIncomeHuf = dashBase.data.kpis.periodIncomeHuf;
    const baseMonthlyNov = dashBase.data.charts.monthlyCashflow.find((m) => m.month === '2026-11') || {
      expenseHuf: 0,
      incomeHuf: 0,
    };

    // 1. Create an excluded expense transaction in 2026-11
    const createExcl = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-16T15:30',
        type: 'expense',
        amount: 25000,
        currency: 'HUF',
        pocketId: otpPocketBefore.id,
        categoryName: 'Other Expense',
        merchant: 'Mock Deposit Hold',
        note: 'Refundable hold',
        excludeFromAnalytics: true,
      },
    });
    assert.equal(createExcl.status, 201);
    const exclTxId = createExcl.data.transaction.id;
    assert.equal(createExcl.data.transaction.exclude_from_analytics, 1);

    const dashExcl = await reqJson('/api/dashboard?month=2026-11');
    assert.equal(dashExcl.status, 200);
    // Balance MUST decrease by 25,000 HUF
    const otpPocketAfterExcl = dashExcl.data.accounts.find((a) => a.name === 'OTP').pockets[0];
    assert.equal(otpPocketAfterExcl.current_balance, otpPocketBefore.current_balance - 25000);
    // Transaction MUST remain visible in the ledger list
    const listedExcl = dashExcl.data.transactions.find((tx) => tx.id === exclTxId);
    assert.ok(listedExcl);
    assert.equal(listedExcl.exclude_from_analytics, 1);
    // KPIs, category breakdown & monthly cashflow MUST exclude the 25,000 HUF
    assert.equal(dashExcl.data.kpis.periodExpenseHuf, baseExpenseHuf);
    assert.equal(dashExcl.data.kpis.periodIncomeHuf, baseIncomeHuf);
    const novAfterExcl = dashExcl.data.charts.monthlyCashflow.find((m) => m.month === '2026-11') || {
      expenseHuf: 0,
    };
    assert.equal(novAfterExcl.expenseHuf, baseMonthlyNov.expenseHuf);

    // 2. Toggle excludeFromAnalytics=false via PATCH: analytics include it without changing balance again
    const includePatch = await reqJson(`/api/transactions/${exclTxId}`, {
      method: 'PATCH',
      body: { excludeFromAnalytics: false },
    });
    assert.equal(includePatch.status, 200);
    assert.equal(includePatch.data.transaction.exclude_from_analytics, 0);

    const dashIncl = await reqJson('/api/dashboard?month=2026-11');
    assert.equal(dashIncl.status, 200);
    const otpPocketAfterIncl = dashIncl.data.accounts.find((a) => a.name === 'OTP').pockets[0];
    assert.equal(otpPocketAfterIncl.current_balance, otpPocketBefore.current_balance - 25000);
    assert.equal(dashIncl.data.kpis.periodExpenseHuf, baseExpenseHuf + 25000);
    const otherExpCat = dashIncl.data.charts.expenseByCategory.find((c) => c.category === 'Other Expense');
    assert.ok(otherExpCat && otherExpCat.amountHuf >= 25000);
    const novAfterIncl = dashIncl.data.charts.monthlyCashflow.find((m) => m.month === '2026-11');
    assert.equal(novAfterIncl.expenseHuf, baseMonthlyNov.expenseHuf + 25000);

    // 3. Toggle excludeFromAnalytics=true again
    const reExclPatch = await reqJson(`/api/transactions/${exclTxId}`, {
      method: 'PATCH',
      body: { excludeFromAnalytics: true },
    });
    assert.equal(reExclPatch.status, 200);
    const dashReExcl = await reqJson('/api/dashboard?month=2026-11');
    assert.equal(dashReExcl.data.kpis.periodExpenseHuf, baseExpenseHuf);
  });

  await t.test('Expiring sessions default to 10m, support customizable timeout in settings, ping refresh & DB expiration', async () => {
    // 1. Default timeout is 10 minutes
    const statusRes = await reqJson('/api/auth/status?touch=0');
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.data.authenticated, true);
    assert.equal(statusRes.data.sessionTimeoutMinutes, 10);
    const remainingDefaultMs = statusRes.data.expiresAt - Date.now();
    assert.ok(remainingDefaultMs > 8 * 60 * 1000 && remainingDefaultMs <= 10 * 60 * 1000 + 2000);

    const setGet1 = await reqJson('/api/settings');
    assert.equal(setGet1.status, 200);
    assert.equal(setGet1.data.sessionTimeoutMinutes, 10);

    // 2. Customize timeout to 25 minutes in settings -> persists & extends active session
    const put25 = await reqJson('/api/settings', {
      method: 'PUT',
      body: { sessionTimeoutMinutes: 25 },
    });
    assert.equal(put25.status, 200);
    assert.equal(put25.data.sessionTimeoutMinutes, 25);

    const status25 = await reqJson('/api/auth/status?touch=0');
    assert.equal(status25.data.sessionTimeoutMinutes, 25);
    const remaining25Ms = status25.data.expiresAt - Date.now();
    assert.ok(remaining25Ms > 23 * 60 * 1000 && remaining25Ms <= 25 * 60 * 1000 + 2000);

    // Restore back to 10 minutes
    const put10 = await reqJson('/api/settings', {
      method: 'PUT',
      body: { sessionTimeoutMinutes: 10 },
    });
    assert.equal(put10.status, 200);
    assert.equal(put10.data.sessionTimeoutMinutes, 10);

    // 3. Ping refreshes session expiration
    const pingRes = await reqJson('/api/auth/ping', { method: 'POST', body: {} });
    assert.equal(pingRes.status, 200);
    assert.equal(pingRes.data.ok, true);
    assert.equal(pingRes.data.sessionTimeoutMinutes, 10);
    assert.ok(pingRes.data.expiresAt - Date.now() > 9 * 60 * 1000);

    // 4. Expired session in DB is rejected with 401 and cleaned up
    const login2 = await reqJson('/api/auth/login', {
      method: 'POST',
      cookie: '',
      body: { username: 'piuser', password: 'StrongPassword123!' },
    });
    assert.equal(login2.status, 200);
    const cookie2 = login2.setCookie.split(';')[0];
    const token2 = decodeURIComponent(cookie2.split('=')[1]);
    const token2Hash = require('node:crypto').createHash('sha256').update(token2).digest('hex');

    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1000, token2Hash);

    const expiredDash = await reqJson('/api/dashboard', { cookie: cookie2 });
    assert.equal(expiredDash.status, 401);
    const deletedRow = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(token2Hash);
    assert.equal(deletedRow, undefined);

    const unauthPing = await reqJson('/api/auth/ping', { method: 'POST', cookie: cookie2, body: {} });
    assert.equal(unauthPing.status, 401);
  });

  await t.test('Before/after pocket & bank balances and bulk flag/hide/analytics/delete ledger management', async () => {
    const dashBefore = await reqJson('/api/dashboard');
    assert.equal(dashBefore.status, 200);
    const otpAcc = dashBefore.data.accounts.find((a) => a.name === 'OTP');
    const otpPocket = otpAcc.pockets[0];
    const erstePocket = dashBefore.data.accounts.find((a) => a.name === 'Erste').pockets[0];
    const startOtpPocketBal = otpPocket.current_balance;
    const startOtpAccBal = otpAcc.total_balance;
    const startErstePocketBal = erstePocket.current_balance;

    // 1. Create two expenses and one transfer at the end of the timeline, verify before/after balances
    const tx1Res = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2027-01-10T18:00',
        type: 'expense',
        amount: 3000,
        currency: 'HUF',
        pocketId: otpPocket.id,
        categoryName: 'Shopping',
        merchant: 'Mock Bulk Shop 1',
        note: 'First bulk test',
        needsApproval: 1,
      },
    });
    assert.equal(tx1Res.status, 201);
    const tx1 = tx1Res.data.transaction;
    assert.equal(tx1.pocket_balance_before, startOtpPocketBal);
    assert.equal(tx1.pocket_balance_after, startOtpPocketBal - 3000);
    assert.equal(tx1.account_balance_before, startOtpAccBal);
    assert.equal(tx1.account_balance_after, startOtpAccBal - 3000);

    const tx2Res = await reqJson('/api/transactions', {
      method: 'POST',
      body: {
        date: '2027-01-10T18:05',
        type: 'transfer',
        amount: 5000,
        currency: 'HUF',
        pocketId: otpPocket.id,
        destPocketId: erstePocket.id,
        categoryName: 'Bank-to-Bank Transfer',
        note: 'Transfer test',
        needsApproval: 1,
      },
    });
    assert.equal(tx2Res.status, 201);
    const tx2 = tx2Res.data.transaction;
    assert.equal(tx2.pocket_balance_before, startOtpPocketBal - 3000);
    assert.equal(tx2.pocket_balance_after, startOtpPocketBal - 8000);
    assert.equal(tx2.dest_pocket_balance_before, startErstePocketBal);
    assert.equal(tx2.dest_pocket_balance_after, startErstePocketBal + 5000);

    // 2. Bulk properties: recurring, approve, needs_approval, exclude_analytics, mark_historical/live, set_category + composable filters + sorting
    const recRes = await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx1.id, tx2.id], action: 'mark_recurring' },
    });
    assert.equal(recRes.status, 200);
    assert.equal(recRes.data.affectedCount, 2);

    const recDash = await reqJson('/api/dashboard?recurring=1');
    assert.ok(recDash.data.transactions.some((tx) => tx.id === tx1.id && tx.is_recurring === 1));
    assert.ok(recDash.data.transactions.some((tx) => tx.id === tx2.id && tx.is_recurring === 1));

    await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx2.id], action: 'unmark_recurring' },
    });
    await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx1.id, tx2.id], action: 'approve' },
    });
    await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx1.id], action: 'exclude_analytics' },
    });

    // Composable property filters: recurring=1 AND excludedStats=1 together
    const comboDash = await reqJson('/api/dashboard?recurring=1&excludedStats=1');
    assert.equal(comboDash.status, 200);
    assert.ok(comboDash.data.transactions.some((tx) => tx.id === tx1.id));
    assert.equal(comboDash.data.transactions.some((tx) => tx.id === tx2.id), false);

    // hasReceipt & autoSource filter checks
    const receiptDash = await reqJson('/api/dashboard?hasReceipt=1');
    assert.equal(receiptDash.status, 200);
    assert.ok(receiptDash.data.transactions.length >= 1);
    assert.ok(receiptDash.data.transactions.every((tx) => Boolean(tx.receipt_path)));

    const notifDash = await reqJson('/api/dashboard?autoSource=notification');
    assert.equal(notifDash.status, 200);
    assert.ok(notifDash.data.transactions.length >= 1);
    assert.ok(notifDash.data.transactions.every((tx) => tx.auto_source === 'notification'));

    // Ordering options: amount_desc, amount_asc, date_asc, pocket_after_desc + balanceSeries stays chronological
    const amtDescDash = await reqJson('/api/dashboard?sort=amount_desc&limit=500');
    assert.equal(amtDescDash.status, 200);
    assert.equal(amtDescDash.data.selectedSort, 'amount_desc');
    for (let i = 1; i < amtDescDash.data.transactions.length; i += 1) {
      const prevAmt = amtDescDash.data.transactions[i - 1].amount;
      const curAmt = amtDescDash.data.transactions[i].amount;
      if (amtDescDash.data.transactions[i - 1].currency === amtDescDash.data.transactions[i].currency) {
        assert.ok(prevAmt >= curAmt || amtDescDash.data.transactions[i - 1].currency !== 'HUF');
      }
    }
    const bs = amtDescDash.data.charts.balanceSeries;
    for (let i = 1; i < bs.length; i += 1) {
      assert.ok(bs[i - 1].date <= bs[i].date, 'balanceSeries must stay chronological even when table sorted by amount');
    }

    const amtAscDash = await reqJson('/api/dashboard?sort=amount_asc&limit=500');
    assert.equal(amtAscDash.status, 200);
    const txAscIds = amtAscDash.data.transactions.map((t) => t.id);
    const txDescIds = amtDescDash.data.transactions.map((t) => t.id);
    assert.notDeepEqual(txAscIds, txDescIds);

    const dateAscDash = await reqJson('/api/dashboard?sort=date_asc&limit=500');
    assert.equal(dateAscDash.status, 200);
    for (let i = 1; i < dateAscDash.data.transactions.length; i += 1) {
      assert.ok(dateAscDash.data.transactions[i - 1].date <= dateAscDash.data.transactions[i].date);
    }

    const pocketAfterDescDash = await reqJson('/api/dashboard?sort=pocket_after_desc&limit=500');
    assert.equal(pocketAfterDescDash.status, 200);
    assert.equal(pocketAfterDescDash.data.selectedSort, 'pocket_after_desc');

    const billsCat = dashBefore.data.categories.find((c) => c.name === 'Bills & Subscriptions' && c.type === 'expense');
    assert.ok(billsCat);
    const catBulkRes = await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx1.id], action: 'set_category', categoryId: billsCat.id },
    });
    assert.equal(catBulkRes.status, 200);
    assert.equal(catBulkRes.data.affectedCount, 1);

    await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx1.id], action: 'mark_historical' },
    });
    const checkHist = await reqJson('/api/dashboard?visibility=all');
    assert.equal(checkHist.data.transactions.find((tx) => tx.id === tx1.id).is_historical, 1);
    await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx1.id], action: 'mark_live' },
    });

    const checkAllDash = await reqJson('/api/dashboard?visibility=all');
    const fetchedTx1 = checkAllDash.data.transactions.find((tx) => tx.id === tx1.id);
    assert.equal(fetchedTx1.needs_approval, 0);
    assert.equal(fetchedTx1.exclude_from_analytics, 1);
    assert.equal(fetchedTx1.category_name, 'Bills & Subscriptions');
    assert.equal(fetchedTx1.is_historical, 0);
    assert.equal(fetchedTx1.is_recurring, 1);

    // 3. Bulk hide -> hidden from default visibility=visible, visible in visibility=hidden, balance unchanged
    const hideRes = await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx1.id, tx2.id], action: 'hide' },
    });
    assert.equal(hideRes.status, 200);
    assert.equal(hideRes.data.affectedCount, 2);

    const defaultDash = await reqJson('/api/dashboard');
    assert.equal(defaultDash.data.transactions.some((tx) => tx.id === tx1.id), false);
    assert.equal(defaultDash.data.transactions.some((tx) => tx.id === tx2.id), false);
    assert.equal(defaultDash.data.accounts.find((a) => a.name === 'OTP').pockets[0].current_balance, startOtpPocketBal - 8000);

    const hiddenDash = await reqJson('/api/dashboard?visibility=hidden');
    assert.ok(hiddenDash.data.transactions.some((tx) => tx.id === tx1.id && tx.is_hidden === 1));
    assert.ok(hiddenDash.data.transactions.some((tx) => tx.id === tx2.id && tx.is_hidden === 1));

    // 4. Bulk unhide -> back in default view
    await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx1.id, tx2.id], action: 'unhide' },
    });
    const unhiddenDash = await reqJson('/api/dashboard');
    assert.ok(unhiddenDash.data.transactions.some((tx) => tx.id === tx1.id));

    // 5. Bulk delete -> deletes both and restores exact balances
    const delRes = await reqJson('/api/transactions/bulk', {
      method: 'POST',
      body: { ids: [tx1.id, tx2.id], action: 'delete' },
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.data.affectedCount, 2);

    const afterDelDash = await reqJson('/api/dashboard');
    assert.equal(afterDelDash.data.accounts.find((a) => a.name === 'OTP').pockets[0].current_balance, startOtpPocketBal);
    assert.equal(afterDelDash.data.accounts.find((a) => a.name === 'Erste').pockets[0].current_balance, startErstePocketBal);
  });

  await t.test('PWA Web Push (VAPID ES256 + RFC 8291 aes128gcm) delivers notifications on autologged events', async () => {
    const keyRes = await reqJson('/api/push/public-key');
    assert.equal(keyRes.status, 200);
    assert.ok(keyRes.data.publicKey && keyRes.data.publicKey.length > 40);

    const b64UrlEnc = (b) =>
      Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const b64UrlDec = (s) => {
      const n = String(s).replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(n + '='.repeat((4 - (n.length % 4)) % 4), 'base64');
    };

    const uaEcdh = crypto.createECDH('prime256v1');
    uaEcdh.generateKeys();
    const uaPub = uaEcdh.getPublicKey();
    const authSecret = crypto.randomBytes(16);

    const decryptRfc8291 = (bodyBuf) => {
      const salt = bodyBuf.subarray(0, 16);
      const idLen = bodyBuf.readUInt8(20);
      const asPub = bodyBuf.subarray(21, 21 + idLen);
      const cipherPlusTag = bodyBuf.subarray(21 + idLen);
      const shared = uaEcdh.computeSecret(asPub);
      const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPub, asPub]);
      const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12));
      const tag = cipherPlusTag.subarray(cipherPlusTag.length - 16);
      const enc = cipherPlusTag.subarray(0, cipherPlusTag.length - 16);
      const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      assert.equal(dec[dec.length - 1], 0x02);
      return JSON.parse(dec.subarray(0, dec.length - 1).toString('utf8'));
    };

    const receivedPushes = [];
    let pushResponseCode = 201;
    const mockPushServer = http.createServer((pReq, pRes) => {
      const chunks = [];
      pReq.on('data', (c) => chunks.push(c));
      pReq.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        const authHeader = pReq.headers.authorization || '';
        const parsed = decryptRfc8291(rawBody);
        receivedPushes.push({
          encoding: pReq.headers['content-encoding'],
          authHeader,
          payload: parsed,
        });
        pRes.writeHead(pushResponseCode);
        pRes.end();
      });
    });

    await new Promise((resolve) => mockPushServer.listen(0, '127.0.0.1', resolve));
    const pushPort = mockPushServer.address().port;
    const endpoint = `http://127.0.0.1:${pushPort}/push/device1`;

    try {
      const subRes = await reqJson('/api/push/subscribe', {
        method: 'POST',
        body: {
          endpoint,
          keys: {
            p256dh: b64UrlEnc(uaPub),
            auth: b64UrlEnc(authSecret),
          },
        },
      });
      assert.equal(subRes.status, 200);
      assert.equal(subRes.data.subscriptionCount, 1);

      // 1. Test push delivery + VAPID header + decryption
      const testRes = await reqJson('/api/push/test', { method: 'POST' });
      assert.equal(testRes.status, 200);
      assert.equal(testRes.data.sent, 1);
      assert.equal(receivedPushes.length, 1);
      assert.equal(receivedPushes[0].encoding, 'aes128gcm');
      assert.ok(receivedPushes[0].authHeader.startsWith('vapid t='));
      assert.ok(receivedPushes[0].payload.title.includes('MoneyManager'));

      // 2. Bank webhook autolog triggers push notification automatically
      const settingsRes = await reqJson('/api/settings');
      const token = settingsRes.data.webhookToken;
      const webhookRes = await fetch(`${baseUrl}/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package: 'hu.otpbank.mobilbank',
          title: 'OTP MobilBank',
          text: 'Kártyás vásárlás: 9 990 HUF, Mock Grocery Push, Egyenleg: 200 000 HUF',
        }),
      });
      assert.equal(webhookRes.status, 200);
      for (let i = 0; i < 30 && receivedPushes.length < 2; i += 1) {
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.equal(receivedPushes.length, 2);
      assert.ok(receivedPushes[1].payload.title.includes('-9,990 HUF'));
      assert.ok(receivedPushes[1].payload.body.includes('Mock Grocery Push'));

      // 3. Expired push endpoint (410) gets automatically pruned
      pushResponseCode = 410;
      const prunedTest = await reqJson('/api/push/test', { method: 'POST' });
      assert.equal(prunedTest.data.pruned, 1);
      const afterPruneKey = await reqJson('/api/push/public-key');
      assert.equal(afterPruneKey.data.subscriptionCount, 0);
    } finally {
      await new Promise((resolve) => mockPushServer.close(resolve));
    }
  });
});

test('Lossless Full JSON Backup Export & Restore (replace & merge) + Universal CSV roundtrip', async () => {
  const mkInstance = async (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const app = createApp({
      dataDir: dir,
      dbPath: path.join(dir, 'test.db'),
      receiptsDir: path.join(dir, 'receipts'),
    });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const setupRes = await fetch(`${base}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'migrator', password: 'StrongPassword123!' }),
    });
    assert.equal(setupRes.status, 201);
    const cookie = setupRes.headers.get('set-cookie').split(';')[0];
    const req = async (p, opts = {}) => {
      const r = await fetch(`${base}${p}`, {
        method: opts.method || 'GET',
        headers: {
          Cookie: cookie,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const text = await r.text();
      let data = text;
      try {
        data = JSON.parse(text);
      } catch {
        // plain text / csv
      }
      return { status: r.status, data, text };
    };
    return { dir, app, base, cookie, req, close: () => { app.server.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
  };

  const instA = await mkInstance('mm-bak-a-');
  const instB = await mkInstance('mm-bak-b-');
  const instC = await mkInstance('mm-bak-c-');
  const instD = await mkInstance('mm-bak-d-');

  try {
    // Seed rich state on Instance A
    const accRes = await instA.req('/api/accounts', {
      method: 'POST',
      body: { name: 'MockNord Bank', currency: 'EUR', initialBalance: 500, color: '#0ea5e9' },
    });
    assert.equal(accRes.status, 201);
    const mockBankId = accRes.data.accountId;

    const pRes = await instA.req('/api/pockets', {
      method: 'POST',
      body: { accountId: mockBankId, name: 'Vault', currency: 'EUR', initialBalance: 100 },
    });
    assert.equal(pRes.status, 201);
    const vaultId = pRes.data.pocket.id;

    const dashA0 = await instA.req('/api/dashboard');
    const mockBankMainId = dashA0.data.accounts.find((a) => a.id === mockBankId).pockets.find((p) => p.is_default === 1).id;
    const shopCatId = dashA0.data.categories.find((c) => c.name === 'Shopping').id;

    const incTx = await instA.req('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-01T09:00',
        type: 'income',
        amount: 200,
        currency: 'EUR',
        pocketId: mockBankMainId,
        merchant: 'Mock Studio',
        note: 'Salary bonus',
        isRecurring: true,
      },
    });
    assert.equal(incTx.status, 201);

    const expTx = await instA.req('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-02T14:30',
        type: 'expense',
        amount: 35.5,
        currency: 'EUR',
        pocketId: mockBankMainId,
        categoryId: shopCatId,
        merchant: 'Mock Bakery',
        storeAddress: '101 Mock City, Mock St 5',
        items: [{ name: 'Bread', qty: 2, price: 8.5 }],
        note: 'Fresh bread',
      },
    });
    assert.equal(expTx.status, 201);
    const expTxId = expTx.data.transaction.id;

    const trfTx = await instA.req('/api/transactions', {
      method: 'POST',
      body: {
        date: '2026-11-03T16:00',
        type: 'transfer',
        amount: 50,
        currency: 'EUR',
        pocketId: mockBankMainId,
        destPocketId: vaultId,
        note: 'To savings vault',
      },
    });
    assert.equal(trfTx.status, 201);

    // Attach receipt image via skipScan: true
    const sampleImgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const attachRes = await instA.req('/api/receipts/scan', {
      method: 'POST',
      body: {
        imageBase64: `data:image/png;base64,${sampleImgBytes.toString('base64')}`,
        mimeType: 'image/png',
        filename: 'mock-bakery-proof.png',
        skipScan: true,
        attachToTxId: expTxId,
      },
    });
    assert.equal(attachRes.status, 200);
    const receiptName = attachRes.data.receiptPath;
    assert.ok(receiptName);

    // Export full JSON backup & verify no secrets leaked
    const exportJsonRes = await instA.req('/api/export/json');
    assert.equal(exportJsonRes.status, 200);
    const bak = exportJsonRes.data;
    assert.equal(bak.format, 'moneymanager-backup');
    assert.equal(bak.version, 2);
    assert.equal(bak.settings.gemini_api_key, undefined);
    assert.equal(bak.settings.notification_webhook_token, undefined);
    assert.equal(bak.users, undefined);
    assert.ok(bak.receipts.some((r) => r.filename === receiptName));

    // Export CSV and verify full columns
    const exportCsvRes = await instA.req('/api/export/csv');
    assert.equal(exportCsvRes.status, 200);
    const csvHeaderLine = exportCsvRes.text.split(/\r?\n/)[0].replace(/^\uFEFF/, '');
    assert.ok(csvHeaderLine.includes('DestBank'));
    assert.ok(csvHeaderLine.includes('DestPocket'));
    assert.ok(csvHeaderLine.includes('StoreAddress'));
    assert.ok(csvHeaderLine.includes('ItemsJson'));

    // Restore on Instance B using replace mode via preview + backup endpoints
    const bakB64 = Buffer.from(JSON.stringify(bak), 'utf8').toString('base64');
    const prevB = await instB.req('/api/import/preview', {
      method: 'POST',
      body: { fileBase64: bakB64, filename: 'backup.json' },
    });
    assert.equal(prevB.status, 200);
    assert.equal(prevB.data.isBackupJson, true);
    assert.equal(prevB.data.counts.transactions, 3);
    assert.equal(prevB.data.counts.receipts, 1);

    const restB = await instB.req('/api/import/backup', {
      method: 'POST',
      body: { fileBase64: bakB64, mode: 'replace' },
    });
    assert.equal(restB.status, 200);
    assert.equal(restB.data.restoredCounts.transactions, 3);
    assert.equal(restB.data.restoredCounts.receipts, 1);

    const dashB = await instB.req('/api/dashboard?limit=50');
    const mockBankB = dashB.data.accounts.find((a) => a.name === 'MockNord Bank');
    assert.ok(mockBankB);
    assert.equal(mockBankB.pockets.find((p) => p.name === 'Main').current_balance, 614.5);
    assert.equal(mockBankB.pockets.find((p) => p.name === 'Vault').current_balance, 150);
    const restoredExpB = dashB.data.transactions.find((t) => t.merchant === 'Mock Bakery');
    assert.equal(restoredExpB.store_address, '101 Mock City, Mock St 5');
    assert.equal(restoredExpB.receipt_path, receiptName);
    const recFileRes = await fetch(`${instB.base}/api/receipts/file/${encodeURIComponent(receiptName)}`, {
      headers: { Cookie: instB.cookie },
    });
    assert.equal(recFileRes.status, 200);
    assert.deepEqual(Buffer.from(await recFileRes.arrayBuffer()), sampleImgBytes);

    // Merge mode on Instance C (keeps Local Checking intact)
    await instC.req('/api/accounts', {
      method: 'POST',
      body: { name: 'Local Checking', currency: 'HUF', initialBalance: 9000 },
    });
    const mergeC = await instC.req('/api/import/backup', {
      method: 'POST',
      body: { backup: bak, mode: 'merge' },
    });
    assert.equal(mergeC.status, 200);
    const dashC = await instC.req('/api/dashboard?limit=50');
    assert.ok(dashC.data.accounts.some((a) => a.name === 'Local Checking'));
    const mockBankC = dashC.data.accounts.find((a) => a.name === 'MockNord Bank');
    assert.ok(mockBankC);
    assert.equal(mockBankC.pockets.find((p) => p.name === 'Vault').current_balance, 150);

    // Re-import universal CSV on Instance D
    const csvB64 = Buffer.from(exportCsvRes.text, 'utf8').toString('base64');
    const prevD = await instD.req('/api/import/preview', {
      method: 'POST',
      body: { fileBase64: csvB64, filename: 'export.csv' },
    });
    assert.equal(prevD.status, 200);
    const dashD0 = await instD.req('/api/dashboard');
    const defPocketD = dashD0.data.accounts[0].pockets[0].id;
    const commitD = await instD.req('/api/import/commit', {
      method: 'POST',
      body: {
        fileBase64: csvB64,
        filename: 'export.csv',
        mapping: prevD.data.suggestedMapping,
        defaultPocketId: defPocketD,
      },
    });
    assert.equal(commitD.status, 200);
    assert.equal(commitD.data.importedCount, 3);
    const dashD = await instD.req('/api/dashboard?limit=50');
    const mockBankD = dashD.data.accounts.find((a) => a.name === 'MockNord Bank');
    assert.ok(mockBankD);
    assert.equal(dashD.data.transactions.find((t) => t.type === 'transfer').dest_pocket_name, 'Vault');
    assert.equal(dashD.data.transactions.find((t) => t.merchant === 'Mock Bakery').store_address, '101 Mock City, Mock St 5');
  } finally {
    instA.close();
    instB.close();
    instC.close();
    instD.close();
  }
});

test('Safe schema migration on existing DB without needs_approval and auto_source columns', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { initDatabase } = require('../src/db');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-migrate-test-'));
  const dbPath = path.join(tmpDir, 'legacy.db');
  try {
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, currency TEXT, color TEXT, icon TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT '');
      CREATE TABLE pockets (id INTEGER PRIMARY KEY, account_id INTEGER, name TEXT, currency TEXT, initial_balance REAL DEFAULT 0, current_balance REAL DEFAULT 0, color TEXT, icon TEXT, is_default INTEGER DEFAULT 0, created_at TEXT DEFAULT '');
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'HUF',
        account_id INTEGER NOT NULL, pocket_id INTEGER NOT NULL, dest_account_id INTEGER, dest_pocket_id INTEGER,
        dest_amount REAL, category_id INTEGER, category_name TEXT NOT NULL, merchant TEXT DEFAULT '',
        note TEXT NOT NULL DEFAULT '', note_source TEXT NOT NULL DEFAULT 'manual', items_json TEXT DEFAULT '[]',
        receipt_path TEXT, is_historical INTEGER NOT NULL DEFAULT 0,
        pocket_balance_after REAL, account_balance_after REAL, dest_pocket_balance_after REAL, dest_account_balance_after REAL,
        created_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const migrated = initDatabase(dbPath);
    const cols = migrated.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name);
    assert.ok(cols.includes('needs_approval'));
    assert.ok(cols.includes('auto_source'));
    assert.ok(cols.includes('exclude_from_analytics'));
    assert.ok(cols.includes('is_hidden'));
    assert.ok(cols.includes('is_recurring'));
    assert.ok(cols.includes('pocket_balance_before'));
    assert.ok(cols.includes('account_balance_before'));
    assert.ok(cols.includes('dest_pocket_balance_before'));
    assert.ok(cols.includes('dest_account_balance_before'));

    // Insert legacy pocket + historical transfer with recorded_dest_pocket_balance_after checkpoint and zero live tx
    migrated.prepare(
      "INSERT INTO accounts (id, name, slug, currency, color, icon, sort_order) VALUES (99, 'LegacyBank', 'legacy-bank', 'HUF', '#3b82f6', 'landmark', 9)"
    ).run();
    migrated.prepare(
      "INSERT INTO pockets (id, account_id, name, currency, initial_balance, current_balance, color, icon, is_default) VALUES (99, 99, 'LegacyReserve', 'HUF', 0, 210000, '#10b981', 'wallet', 1)"
    ).run();
    migrated.prepare(
      "INSERT INTO transactions (date, type, amount, currency, account_id, pocket_id, category_name, merchant, note, note_source, is_historical, recorded_pocket_balance_after, created_at) VALUES ('2026-10-01', 'income', 210000, 'HUF', 99, 99, 'Work / Salary', 'Mock Employer', 'Legacy row', 'import', 1, 210000, '2026-10-01')"
    ).run();
    migrated.close();

    const migrated2 = initDatabase(dbPath);
    const { recalculateAllBalances } = require('../src/ledger');
    recalculateAllBalances(migrated2);
    const p99 = migrated2.prepare('SELECT initial_balance, current_balance FROM pockets WHERE id = 99').get();
    assert.equal(p99.initial_balance, 210000);
    assert.equal(p99.current_balance, 210000);
    const t99 = migrated2.prepare('SELECT recorded_pocket_balance_after, pocket_balance_after FROM transactions WHERE pocket_id = 99').get();
    assert.equal(t99.recorded_pocket_balance_after, null);
    assert.equal(t99.pocket_balance_after, null);
    migrated2.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Flag-based historical transaction logic (balances, PATCH toggle, auto-notes)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-hist-flag-test-'));
  const app = createApp({
    dataDir: tmpDir,
    dbPath: path.join(tmpDir, 'flag.db'),
    receiptsDir: path.join(tmpDir, 'receipts'),
    skipInitialCsvImport: true,
    rateLimit: false,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => {
    app.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const reqJson = async (p, opts = {}, cookie = '') => {
    const res = await fetch(`${baseUrl}${p}`, {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : {} };
  };

  const setup = await reqJson('/api/auth/setup', {
    method: 'POST',
    body: { username: 'tester', password: 'StrongPassword123' },
  });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie').split(';')[0];

  const acc = await reqJson(
    '/api/accounts',
    { method: 'POST', body: { name: 'BankA', currency: 'HUF', initialBalance: 10000 } },
    cookie
  );
  assert.equal(acc.status, 201);
  const dash0 = await reqJson('/api/dashboard', {}, cookie);
  const pocketId = dash0.data.accounts.find((a) => a.name === 'BankA').pockets[0].id;

  // 1. Live expense reduces balance from 10,000 -> 8,000
  const liveTx = await reqJson(
    '/api/transactions',
    {
      method: 'POST',
      body: {
        date: '2026-11-01T10:00',
        type: 'expense',
        amount: 2000,
        currency: 'HUF',
        pocketId,
        merchant: 'Mock LiveCafe',
        note: 'coffee',
        isHistorical: false,
      },
    },
    cookie
  );
  assert.equal(liveTx.status, 201);
  assert.equal(liveTx.data.transaction.pocket_balance_before, 10000);
  assert.equal(liveTx.data.transaction.pocket_balance_after, 8000);

  // 2. Historical transaction with blank note: auto note has note_source='auto', does NOT affect balance even after live tx & with initialBalance != 0
  const histTx = await reqJson(
    '/api/transactions',
    {
      method: 'POST',
      body: {
        date: '2026-11-05T12:00',
        type: 'expense',
        amount: 3500,
        currency: 'HUF',
        pocketId,
        categoryName: 'Shopping',
        merchant: 'Mock OldStore',
        note: '',
        isHistorical: true,
      },
    },
    cookie
  );
  assert.equal(histTx.status, 201);
  assert.equal(histTx.data.transaction.is_historical, 1);
  assert.equal(histTx.data.transaction.note_source, 'auto');
  assert.equal(histTx.data.transaction.pocket_balance_before, null);
  assert.equal(histTx.data.transaction.pocket_balance_after, null);

  let dash = await reqJson('/api/dashboard', {}, cookie);
  assert.equal(dash.data.accounts.find((a) => a.name === 'BankA').pockets[0].current_balance, 8000);

  // 3. Toggle isHistorical -> false via PATCH includes it in balance (8,000 -> 4,500)
  const patchLive = await reqJson(
    `/api/transactions/${histTx.data.transaction.id}`,
    { method: 'PATCH', body: { isHistorical: false } },
    cookie
  );
  assert.equal(patchLive.status, 200);
  assert.equal(patchLive.data.transaction.is_historical, 0);
  assert.equal(patchLive.data.transaction.pocket_balance_before, 8000);
  assert.equal(patchLive.data.transaction.pocket_balance_after, 4500);

  dash = await reqJson('/api/dashboard', {}, cookie);
  assert.equal(dash.data.accounts.find((a) => a.name === 'BankA').pockets[0].current_balance, 4500);

  // 4. Toggle liveTx -> isHistorical: true via PATCH excludes it (10,000 - 3,500 = 6,500)
  const patchHist = await reqJson(
    `/api/transactions/${liveTx.data.transaction.id}`,
    { method: 'PATCH', body: { isHistorical: true } },
    cookie
  );
  assert.equal(patchHist.status, 200);
  assert.equal(patchHist.data.transaction.is_historical, 1);
  assert.equal(patchHist.data.transaction.pocket_balance_before, null);
  assert.equal(patchHist.data.transaction.pocket_balance_after, null);

  dash = await reqJson('/api/dashboard', {}, cookie);
  assert.equal(dash.data.accounts.find((a) => a.name === 'BankA').pockets[0].current_balance, 6500);
});

test('OTP Sikeres vásárlás notification extraction & smart counterparty pairing', async (t) => {
  const { findBestMatchingCounterparty } = require('../src/ledger');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pair-test-'));
  const { server, db } = createApp({
    dataDir: tmpDir,
    dbPath: path.join(tmpDir, 'test.db'),
    receiptsDir: path.join(tmpDir, 'receipts'),
    skipInitialCsvImport: true,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function reqJson(pathname, opts = {}, cookie = '') {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
  }

  const setupRes = await reqJson('/api/auth/setup', {
    method: 'POST',
    body: { username: 'admin', password: 'StrongPassword123!' },
  });
  assert.equal(setupRes.status, 201);
  const cookie = setupRes.setCookie.split(';')[0];

  await reqJson('/api/accounts', { method: 'POST', body: { name: 'OTP', currency: 'HUF', initialBalance: 100000 } }, cookie);
  await reqJson('/api/accounts', { method: 'POST', body: { name: 'Revolut', currency: 'HUF', initialBalance: 10000 } }, cookie);

  const initDash = await reqJson('/api/dashboard', {}, cookie);
  const otpPocketId = initDash.data.accounts.find((a) => a.name === 'OTP').pockets[0].id;
  const revPocketId = initDash.data.accounts.find((a) => a.name === 'Revolut').pockets[0].id;
  const shopCatId = initDash.data.categories.find((c) => c.name === 'Shopping' && c.type === 'expense').id;
  const salaryCatId = initDash.data.categories.find((c) => c.name === 'Work / Salary' && c.type === 'income').id;
  const familyCatId = initDash.data.categories.find((c) => c.name === 'Family & Gifts' && c.type === 'income').id;

  const settingsRes = await reqJson('/api/settings', {}, cookie);
  const token = settingsRes.data.webhookToken;

  // Seed initial counterparties
  await reqJson('/api/transactions', {
    method: 'POST',
    body: { date: '2026-11-01', type: 'income', amount: 300000, currency: 'HUF', pocketId: otpPocketId, categoryId: salaryCatId, merchant: 'Mock Employer Corp.' },
  }, cookie);
  await reqJson('/api/transactions', {
    method: 'POST',
    body: { date: '2026-11-02', type: 'expense', amount: 2500, currency: 'HUF', pocketId: otpPocketId, categoryId: shopCatId, merchant: 'MOCKMART-GLOBAL ZRT.' },
  }, cookie);
  await reqJson('/api/transactions', {
    method: 'POST',
    body: { date: '2026-11-03', type: 'expense', amount: 5500, currency: 'HUF', pocketId: otpPocketId, categoryId: shopCatId, merchant: 'MockMart/MockHome/MockDecor' },
  }, cookie);
  await reqJson('/api/transactions', {
    method: 'POST',
    body: { date: '2026-11-04', type: 'income', amount: 1000, currency: 'HUF', pocketId: revPocketId, categoryId: familyCatId, merchant: 'Beta Alpha Mock Person' },
  }, cookie);

  // 1. Exact OTP screenshot notification: "Sikeres vásárlás!" + "...a MOCK CANTEEN BISTRO ÉTTEREM kereskedőnél."
  const bistroRes = await reqJson(`/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: {
      app: 'OTP Bank',
      title: 'Sikeres vásárlás!',
      text: '-1 590 Ft értékben sikeresen vásároltál a MOCK CANTEEN BISTRO ÉTTEREM kereskedőnél.',
    },
  });
  assert.equal(bistroRes.status, 200);
  assert.equal(bistroRes.data.logged, true);
  assert.equal(bistroRes.data.transaction.type, 'expense');
  assert.equal(bistroRes.data.transaction.amount, 1590);
  assert.equal(bistroRes.data.transaction.merchant, 'MOCK CANTEEN BISTRO ÉTTEREM');
  assert.equal(bistroRes.data.transaction.category_name, 'Food & Dining');

  // 2. OTP online purchase notification: "Sikeres Online vásárlás!" + "...a(z) CRV*MOCKMART 12345 ONKISZ webshopjában." -> pairs to "MOCKMART-GLOBAL ZRT."
  const mockMartOnlineRes = await reqJson(`/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: {
      app: 'OTP Bank',
      title: 'Sikeres Online vásárlás!',
      text: '-2 127 Ft értékben sikeresen vásároltál a(z) CRV*MOCKMART 12345 ONKISZ webshopjában.',
    },
  });
  assert.equal(mockMartOnlineRes.status, 200);
  assert.equal(mockMartOnlineRes.data.logged, true);
  assert.equal(mockMartOnlineRes.data.transaction.amount, 2127);
  assert.equal(mockMartOnlineRes.data.transaction.merchant, 'MOCKMART-GLOBAL ZRT.');
  assert.equal(mockMartOnlineRes.data.transaction.category_name, 'Shopping');

  // Ensure generic notification titles are NEVER stored in counterparties
  let cpRes = await reqJson('/api/counterparties', {}, cookie);
  const allCpNames = [...cpRes.data.counterparties.in, ...cpRes.data.counterparties.out].map((c) => c.name.toLowerCase());
  assert.equal(allCpNames.some((n) => n.includes('sikeres vásárlás') || n.includes('sikeres online vásárlás')), false);
  assert.equal(allCpNames.some((n) => n.includes('crv*mockmart')), false);

  // 3. When both "MockMart" and "MOCKMART-GLOBAL ZRT." exist, target the closer match for each variant
  await reqJson('/api/transactions', {
    method: 'POST',
    body: { date: '2026-11-05', type: 'expense', amount: 1200, currency: 'HUF', pocketId: otpPocketId, categoryId: shopCatId, merchant: 'MockMart' },
  }, cookie);
  assert.equal(findBestMatchingCounterparty(db, 'MOCKMART-GLOBAL ZRT', 'out').counterparty.name, 'MOCKMART-GLOBAL ZRT.');
  const mockMartSimpleRes = await reqJson(`/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: {
      app: 'OTP Bank',
      title: 'Sikeres Online vásárlás!',
      text: '-999 Ft értékben sikeresen vásároltál a(z) CRV*MOCKMART 12345 ONKISZ webshopjában.',
    },
  });
  assert.equal(mockMartSimpleRes.status, 200);
  assert.equal(mockMartSimpleRes.data.transaction.merchant, 'MockMart');

  // 4. Revolut P2P name-order pairing: "Mock Person Alpha Beta" -> pairs to existing "Beta Alpha Mock Person" + inherits category
  const revPairRes = await reqJson(`/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: {
      app: 'Revolut',
      title: 'Mock Person Alpha Beta',
      text: 'Sent you HUF 1,600. Tap to say thank you 💰',
    },
  });
  assert.equal(revPairRes.status, 200);
  assert.equal(revPairRes.data.logged, true);
  assert.equal(revPairRes.data.transaction.merchant, 'Beta Alpha Mock Person');
  assert.equal(revPairRes.data.transaction.category_name, 'Family & Gifts');

  // 5. Unrelated new merchant must NOT be force-paired and is added as a new counterparty
  const unrelatedRes = await reqJson(`/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    body: {
      app: 'OTP Bank',
      title: 'Sikeres vásárlás!',
      text: '-2 400 Ft értékben sikeresen vásároltál a Mock Artisan Bakery kereskedőnél.',
    },
  });
  assert.equal(unrelatedRes.status, 200);
  assert.equal(unrelatedRes.data.logged, true);
  assert.equal(unrelatedRes.data.transaction.merchant, 'Mock Artisan Bakery');
  cpRes = await reqJson('/api/counterparties', {}, cookie);
  assert.ok(cpRes.data.counterparties.out.some((c) => c.name === 'Mock Artisan Bakery'));
});

test('Scheduled backups: retention engine, local & remote FTP end-to-end, encryption, capabilities & restore', async (t) => {
  const net = require('node:net');
  const zlib = require('node:zlib');
  const {
    buildBackupFilename,
    computeNextRunAt,
    computeRetentionDeletes,
    parseRemoteListLines,
    parseSmbListOutput,
    buildSmbAuthFileContent,
    buildSmbScriptSegments,
    buildCurlConfigText,
    buildRemoteBaseUrl,
    buildSftpBaseArgs,
  } = require('../src/backups');

  // 1. Unit tests: retention policy (age, count, total size, protected file, non-backup files ignored)
  const nowMs = Date.UTC(2026, 10, 19, 12, 0, 0);
  const f1 = buildBackupFilename(new Date(nowMs - 1 * 3600 * 1000), true); // 1h old, newest
  const f2 = buildBackupFilename(new Date(nowMs - 2 * 86400 * 1000), true); // 2d old
  const f3 = buildBackupFilename(new Date(nowMs - 5 * 86400 * 1000), true); // 5d old
  const f4 = buildBackupFilename(new Date(nowMs - 40 * 86400 * 1000), true); // 40d old (> 30d age cap)
  const sampleFiles = [
    { filename: 'unrelated-note.txt', sizeBytes: 999999999 },
    { filename: f4, sizeBytes: 1024 * 1024 },
    { filename: f2, sizeBytes: 2 * 1024 * 1024 },
    { filename: f3, sizeBytes: 2 * 1024 * 1024 },
    { filename: f1, sizeBytes: 2 * 1024 * 1024 },
  ];
  const retAgeAndCount = computeRetentionDeletes(
    sampleFiles,
    { maxAgeDays: 30, maxCount: 2, maxTotalSizeMb: 0 },
    nowMs,
    f1
  );
  assert.deepEqual(
    retAgeAndCount.kept.map((x) => x.filename),
    [f1, f2]
  );
  assert.deepEqual(
    retAgeAndCount.toDelete.map((x) => ({ f: x.filename, r: x.reason })),
    [
      { f: f3, r: 'count' },
      { f: f4, r: 'age' },
    ]
  );

  // Size limit pruning: cap 3 MB keeps newest (f1, 2MB) and prunes f2 (would reach 4MB) while never pruning protected newest
  const retSize = computeRetentionDeletes(
    [
      { filename: f1, sizeBytes: 2 * 1024 * 1024 },
      { filename: f2, sizeBytes: 2 * 1024 * 1024 },
      { filename: f3, sizeBytes: 512 * 1024 },
    ],
    { maxAgeDays: 0, maxCount: 0, maxTotalSizeMb: 3 },
    nowMs,
    f1
  );
  assert.deepEqual(
    retSize.kept.map((x) => x.filename),
    [f1, f3]
  );
  assert.deepEqual(
    retSize.toDelete.map((x) => x.filename),
    [f2]
  );

  // 2. Unit tests: computeNextRunAt for interval, daily, weekly
  const refDate = new Date(2026, 10, 19, 10, 0, 0); // local 10:00
  assert.equal(computeNextRunAt({ enabled: false, scheduleType: 'daily' }, refDate), null);
  const nextInt = new Date(computeNextRunAt({ enabled: true, scheduleType: 'interval', intervalHours: 6 }, refDate));
  assert.equal(Math.round((nextInt - refDate) / 3600000), 6);
  const nextDailyLaterToday = new Date(computeNextRunAt({ enabled: true, scheduleType: 'daily', timeOfDay: '23:30' }, refDate));
  assert.equal(nextDailyLaterToday.getHours(), 23);
  assert.equal(nextDailyLaterToday.getMinutes(), 30);
  assert.equal(nextDailyLaterToday.getDate(), refDate.getDate());
  const nextDailyTomorrow = new Date(computeNextRunAt({ enabled: true, scheduleType: 'daily', timeOfDay: '03:00' }, refDate));
  assert.equal(nextDailyTomorrow.getDate(), refDate.getDate() + 1);
  const nextWeekly = new Date(computeNextRunAt({ enabled: true, scheduleType: 'weekly', dayOfWeek: 0, timeOfDay: '03:00' }, refDate));
  assert.equal(nextWeekly.getDay(), 0);
  assert.ok(nextWeekly > refDate);

  // 3. Unit tests: SFTP/SMB parsers and argument builders
  const smbParsed = parseSmbListOutput([
    '  .                                   D        0  Thu Nov 19 10:00:00 2026',
    `  ${f1}      A    45678  Thu Nov 19 11:00:00 2026`,
    '  random-file.zip                     A    12345  Thu Nov 19 11:00:00 2026',
  ].join('\n'));
  assert.equal(smbParsed.length, 1);
  assert.equal(smbParsed[0].filename, f1);
  assert.equal(smbParsed[0].sizeBytes, 45678);

  const ftpParsed = parseRemoteListLines([
    `-rw-r--r-- 1 user group 8812 Nov 19 10:00 ${f1}`,
    `type=file;size=4400;modify=20261115100000; ${f2}`,
    'unrelated.txt',
  ].join('\n'));
  assert.equal(ftpParsed.length, 2);
  assert.equal(ftpParsed[0].filename, f1);
  assert.equal(ftpParsed[0].sizeBytes, 8812);
  assert.equal(ftpParsed[1].filename, f2);
  assert.equal(ftpParsed[1].sizeBytes, 4400);

  assert.deepEqual(buildSmbScriptSegments('\\mm\\backups/nas/'), ['mm', 'backups', 'nas']);
  const smbAuth = buildSmbAuthFileContent({ username: 'backup', password: 'secret', domain: 'HOME' });
  assert.ok(smbAuth.includes('username = backup') && smbAuth.includes('domain = HOME'));
  assert.equal(buildRemoteBaseUrl({ protocol: 'sftp', host: 'nas.local', port: 22, remotePath: 'backups' }, true), 'sftp://nas.local:22/~/backups/');
  assert.ok(buildCurlConfigText({ protocol: 'ftps', ftpsMode: 'explicit', host: 'nas.local', port: 21, remotePath: '/bk', username: 'u', password: 'p', verifyTls: false }, 'ftp://nas.local:21/bk/').includes('ftp-ssl-reqd'));
  assert.ok(buildSftpBaseArgs({ host: 'nas.local', port: 2222, username: 'pi', verifyTls: false }, '/tmp/k').includes('2222'));

  // 4. Spin up an in-process mock FTP server + MoneyManager instance to test real curl FTP transport, encryption & retention
  const ftpDirs = new Set(['/']);
  const ftpFiles = new Map(); // fullPath -> Buffer
  const ftpServer = net.createServer((ctrl) => {
    ctrl.setEncoding('utf8');
    let cwd = '/';
    let dataServer = null;
    let dataSock = null;
    const waitQueue = [];
    const resolveDir = (arg = '') => {
      const raw = String(arg || '').trim();
      const base = raw.startsWith('/') ? raw : `${cwd === '/' ? '' : cwd}/${raw}`;
      const norm = '/' + base.split('/').filter((s) => s && s !== '.').join('/');
      return norm || '/';
    };
    const takeDataSocket = () => {
      if (dataSock) {
        const s = dataSock;
        dataSock = null;
        return Promise.resolve(s);
      }
      return new Promise((res) => waitQueue.push(res));
    };
    ctrl.write('220 MockFTP Ready\r\n');
    let lineBuf = '';
    ctrl.on('data', async (chunk) => {
      lineBuf += chunk;
      let idx;
      while ((idx = lineBuf.indexOf('\n')) !== -1) {
        const line = lineBuf.slice(0, idx).replace(/\r$/, '').trim();
        lineBuf = lineBuf.slice(idx + 1);
        if (!line) continue;
        const spaceIdx = line.indexOf(' ');
        const cmd = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toUpperCase();
        const arg = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1);

        if (cmd === 'USER') ctrl.write('331 Password required\r\n');
        else if (cmd === 'PASS') ctrl.write(arg === 'ftpPass!123' ? '230 Logged in\r\n' : '530 Login incorrect\r\n');
        else if (cmd === 'SYST') ctrl.write('215 UNIX Type: L8\r\n');
        else if (cmd === 'TYPE' || cmd === 'OPTS') ctrl.write('200 OK\r\n');
        else if (cmd === 'PWD') ctrl.write(`257 "${cwd}" is current directory\r\n`);
        else if (cmd === 'CWD') {
          const target = resolveDir(arg);
          if (ftpDirs.has(target)) {
            cwd = target;
            ctrl.write('250 Directory changed\r\n');
          } else {
            ctrl.write('550 Failed to change directory\r\n');
          }
        } else if (cmd === 'MKD') {
          const target = resolveDir(arg);
          ftpDirs.add(target);
          ctrl.write(`257 "${target}" created\r\n`);
        } else if (cmd === 'PASV') {
          if (dataServer) {
            try { dataServer.close(); } catch { /* ignore */ }
          }
          dataSock = null;
          dataServer = net.createServer((sock) => {
            if (waitQueue.length > 0) waitQueue.shift()(sock);
            else dataSock = sock;
          });
          await new Promise((res) => dataServer.listen(0, '127.0.0.1', res));
          const p = dataServer.address().port;
          ctrl.write(`227 Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255})\r\n`);
        } else if (cmd === 'SIZE') {
          const target = resolveDir(arg);
          const buf = ftpFiles.get(target);
          if (buf) ctrl.write(`213 ${buf.length}\r\n`);
          else ctrl.write('550 File not found\r\n');
        } else if (cmd === 'LIST' || cmd === 'NLST') {
          ctrl.write('150 Opening ASCII data connection\r\n');
          const ds = await takeDataSocket();
          const prefix = cwd === '/' ? '/' : `${cwd}/`;
          const rows = [];
          for (const [fPath, fBuf] of ftpFiles.entries()) {
            if (!fPath.startsWith(prefix)) continue;
            const rel = fPath.slice(prefix.length);
            if (!rel || rel.includes('/')) continue;
            rows.push(`-rw-r--r-- 1 ftp ftp ${fBuf.length} Nov 19 12:00 ${rel}`);
          }
          ds.end(rows.length ? rows.join('\r\n') + '\r\n' : '');
          ctrl.write('226 Transfer complete\r\n');
        } else if (cmd === 'STOR') {
          const target = resolveDir(arg);
          ctrl.write('150 Ok to send data\r\n');
          const ds = await takeDataSocket();
          const chunks = [];
          ds.on('data', (c) => chunks.push(c));
          await new Promise((res) => ds.on('end', res));
          ftpFiles.set(target, Buffer.concat(chunks));
          ctrl.write('226 Transfer complete\r\n');
        } else if (cmd === 'RETR') {
          const target = resolveDir(arg);
          const buf = ftpFiles.get(target);
          if (!buf) {
            ctrl.write('550 File not found\r\n');
          } else {
            ctrl.write('150 Opening binary data connection\r\n');
            const ds = await takeDataSocket();
            ds.end(buf);
            ctrl.write('226 Transfer complete\r\n');
          }
        } else if (cmd === 'DELE') {
          const target = resolveDir(arg);
          if (ftpFiles.delete(target)) ctrl.write('250 File deleted\r\n');
          else ctrl.write('550 File not found\r\n');
        } else if (cmd === 'QUIT') {
          ctrl.end('221 Goodbye\r\n');
        } else {
          ctrl.write('200 OK\r\n');
        }
      }
    });
    ctrl.on('close', () => {
      if (dataServer) {
        try { dataServer.close(); } catch { /* ignore */ }
      }
    });
  });

  await new Promise((res) => ftpServer.listen(0, '127.0.0.1', res));
  const ftpPort = ftpServer.address().port;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-bk-test-'));
  const customLocalDir = path.join(tmpDir, 'custom-local-backups');
  const { server, db } = createApp({
    dataDir: tmpDir,
    dbPath: path.join(tmpDir, 'bk.db'),
    receiptsDir: path.join(tmpDir, 'receipts'),
    skipInitialCsvImport: true,
  });

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    server.close();
    ftpServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function reqJson(pathname, opts = {}, cookie = '') {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, setCookie: res.headers.get('set-cookie'), headers: res.headers };
  }

  const setup = await reqJson('/api/auth/setup', {
    method: 'POST',
    body: { username: 'admin', password: 'StrongPassword123!' },
  });
  assert.equal(setup.status, 201);
  const cookie = setup.setCookie.split(';')[0];

  // Create sample ledger data so backups have real records
  const initDash = await reqJson('/api/dashboard', {}, cookie);
  const pocketId = initDash.data.accounts[0].pockets[0].id;
  await reqJson('/api/transactions', {
    method: 'POST',
    body: { date: '2026-11-18', type: 'expense', amount: 4200, currency: 'HUF', pocketId, categoryName: 'Shopping', merchant: 'Mock Backup Shop', note: 'Backup test tx' },
  }, cookie);

  // Pre-seed 2 older local backups and 2 older remote FTP backups to test independent retention limits:
  // Local maxCount = 3 (keeps 3), Remote maxCount = 2 (prunes down to 2)
  fs.mkdirSync(customLocalDir, { recursive: true });
  const oldL1 = buildBackupFilename(new Date(Date.now() - 3 * 86400000), true);
  const oldL2 = buildBackupFilename(new Date(Date.now() - 2 * 86400000), true);
  fs.writeFileSync(path.join(customLocalDir, oldL1), zlib.gzipSync(Buffer.from('{}')));
  fs.writeFileSync(path.join(customLocalDir, oldL2), zlib.gzipSync(Buffer.from('{}')));

  ftpDirs.add('/mm-remote-bk');
  const oldR1 = buildBackupFilename(new Date(Date.now() - 4 * 86400000), true);
  const oldR2 = buildBackupFilename(new Date(Date.now() - 3 * 86400000), true);
  ftpFiles.set(`/mm-remote-bk/${oldR1}`, zlib.gzipSync(Buffer.from('{}')));
  ftpFiles.set(`/mm-remote-bk/${oldR2}`, zlib.gzipSync(Buffer.from('{}')));

  // Save config with different local vs remote retention + FTP credentials
  const putCfg = await reqJson('/api/backups/config', {
    method: 'PUT',
    body: {
      enabled: true,
      scheduleType: 'daily',
      timeOfDay: '04:15',
      compress: true,
      includeReceipts: true,
      local: {
        enabled: true,
        directory: customLocalDir,
        maxCount: 3,
        maxAgeDays: 30,
        maxTotalSizeMb: 100,
      },
      remote: {
        enabled: true,
        protocol: 'ftp',
        host: '127.0.0.1',
        port: ftpPort,
        remotePath: '/mm-remote-bk',
        username: 'ftpuser',
        password: 'ftpPass!123',
        maxCount: 2,
        maxAgeDays: 90,
        maxTotalSizeMb: 200,
      },
    },
  }, cookie);
  assert.equal(putCfg.status, 200);
  assert.equal(putCfg.data.config.remote.hasPassword, true);
  assert.equal(putCfg.data.config.remote.password, undefined, 'Password must be redacted from API response');
  const rawStoredCfg = db.prepare("SELECT value FROM settings WHERE key = 'backup_config'").get().value;
  assert.equal(rawStoredCfg.includes('ftpPass!123'), false, 'Password must be encrypted at rest in SQLite');
  assert.ok(rawStoredCfg.includes('enc:v1:'));

  // Test remote FTP connection via real curl
  const testConn = await reqJson('/api/backups/remote/test', { method: 'POST', body: {} }, cookie);
  assert.equal(testConn.status, 200);
  assert.equal(testConn.data.ok, true);
  assert.equal(testConn.data.fileCount, 2);

  // Run backup now -> uploads gzipped backup locally and via FTP, prunes remote to 2 while keeping local at 3!
  const runRes = await reqJson('/api/backups/run', { method: 'POST', body: { target: 'all' } }, cookie);
  assert.equal(runRes.status, 200);
  assert.equal(runRes.data.result.status, 'ok');
  assert.ok(runRes.data.result.filename.endsWith('.json.gz'));
  assert.equal(runRes.data.result.local.ok, true);
  assert.equal(runRes.data.result.local.keptCount, 3);
  assert.equal(runRes.data.result.remote.ok, true);
  assert.equal(runRes.data.result.remote.keptCount, 2);
  assert.equal(runRes.data.result.remote.prunedCount, 1);

  const remListRes = await reqJson('/api/backups/remote/list', {}, cookie);
  assert.equal(remListRes.status, 200);
  assert.equal(remListRes.data.files.length, 2);
  assert.equal(remListRes.data.files[0].filename, runRes.data.result.filename);
  assert.equal(remListRes.data.files.some((f) => f.filename === oldR1), false, 'Oldest remote backup should be pruned');

  // Verify local download endpoint serves valid gzipped backup and /api/import/preview detects .json.gz
  const dlRes = await fetch(`${baseUrl}/api/backups/local/${encodeURIComponent(runRes.data.result.filename)}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(dlRes.status, 200);
  const dlBuf = Buffer.from(await dlRes.arrayBuffer());
  assert.equal(dlBuf[0], 0x1f);
  assert.equal(dlBuf[1], 0x8b);
  const gzPreview = await reqJson('/api/import/preview', {
    method: 'POST',
    body: { fileBase64: dlBuf.toString('base64'), filename: runRes.data.result.filename },
  }, cookie);
  assert.equal(gzPreview.status, 200);
  assert.equal(gzPreview.data.isBackupJson, true);
  assert.equal(gzPreview.data.counts.transactions, 1);

  // Mutate ledger after backup, then restore directly from REMOTE FTP backup!
  const delTx = await reqJson(`/api/transactions/${initDash.data.transactions?.[0]?.id || (await reqJson('/api/dashboard', {}, cookie)).data.transactions[0].id}`, {
    method: 'DELETE',
  }, cookie);
  assert.equal(delTx.status, 200);
  assert.equal((await reqJson('/api/dashboard', {}, cookie)).data.transactions.length, 0);

  const remoteRestore = await reqJson('/api/backups/restore', {
    method: 'POST',
    body: { source: 'remote', filename: runRes.data.result.filename, mode: 'replace' },
  }, cookie);
  assert.equal(remoteRestore.status, 200);
  assert.equal(remoteRestore.data.ok, true);
  const restoredDash = await reqJson('/api/dashboard', {}, cookie);
  assert.equal(restoredDash.data.transactions.length, 1);
  assert.equal(restoredDash.data.transactions[0].merchant, 'Mock Backup Shop');

  // Delete one local and one remote backup via API
  const delLocal = await reqJson(`/api/backups/local/${encodeURIComponent(oldL1)}`, { method: 'DELETE' }, cookie);
  assert.equal(delLocal.status, 200);
  assert.equal(delLocal.data.localFiles.some((f) => f.filename === oldL1), false);

  const delRemote = await reqJson(`/api/backups/remote/${encodeURIComponent(oldR2)}`, { method: 'DELETE' }, cookie);
  assert.equal(delRemote.status, 200);
  assert.equal(delRemote.data.files.some((f) => f.filename === oldR2), false);
});

test('Rate limiting blocks login brute-force, X-Forwarded-For spoofing, webhook guessing, and DDoS request floods', async (t) => {
  const { createRateLimiter, getClientIp } = require('../src/rateLimit');
  // 1. Verify trusted proxy X-Forwarded-For uses rightmost proxy-appended IP, blocking leftmost client spoofing
  assert.equal(
    getClientIp({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.5' } }),
    '203.0.113.5'
  );
  assert.equal(
    getClientIp({ socket: { remoteAddress: '198.51.100.10' }, headers: { 'x-forwarded-for': '9.9.9.9' } }),
    '198.51.100.10'
  );
  // Bounded limiter evicts oldest safely without unbounded memory growth
  const bounded = createRateLimiter({ windowMs: 60000, max: 2, maxEntries: 5 });
  for (let i = 0; i < 12; i += 1) bounded.consume(`ip-${i}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rl-test-'));
  const { server } = createApp({
    dataDir: tmpDir,
    dbPath: path.join(tmpDir, 'rl.db'),
    receiptsDir: path.join(tmpDir, 'receipts'),
    skipInitialCsvImport: true,
    rateLimit: {
      globalMax: 25,
      apiMax: 22,
      authBurstMax: 15,
      loginFailMax: 3,
      loginUserFailMax: 4,
      webhookFailMax: 3,
      heavyMax: 2,
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Setup admin account
  const setupRes = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'StrongPassword123' }),
  });
  assert.equal(setupRes.status, 201);
  const cookie = setupRes.headers.get('set-cookie').split(';')[0];

  // 2. Login brute-force via same IP locks out on 4th attempt (even with wrong password) -> 429 + Retry-After
  for (let i = 0; i < 3; i += 1) {
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: `wrong-${i}` }),
    });
    assert.equal(r.status, 401);
  }
  const blockedIpLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'StrongPassword123' }),
  });
  assert.equal(blockedIpLogin.status, 429);
  assert.ok(Number(blockedIpLogin.headers.get('retry-after')) >= 1);

  // 3. Distributed brute-force targeting 'admin' from rotated proxy IPs gets blocked by username limiter
  for (let i = 0; i < 2; i += 1) {
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${i + 10}` },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    // Wait: 3 failed attempts from main IP + 1 more hits loginUserFailMax (4)
    assert.ok(r.status === 401 || r.status === 429);
  }
  const blockedUserLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.99' },
    body: JSON.stringify({ username: 'admin', password: 'StrongPassword123' }),
  });
  assert.equal(blockedUserLogin.status, 429);

  // 4. Webhook invalid-token brute force -> 429 on 4th wrong token attempt from a separate client IP
  for (let i = 0; i < 3; i += 1) {
    const r = await fetch(`${baseUrl}/api/notifications/webhook?token=guess${i}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.20' },
      body: JSON.stringify({ app: 'OTP', text: 'test' }),
    });
    assert.equal(r.status, 401);
  }
  const blockedWebhook = await fetch(`${baseUrl}/api/notifications/webhook?token=guess9`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.20' },
    body: JSON.stringify({ app: 'OTP', text: 'test' }),
  });
  assert.equal(blockedWebhook.status, 429);

  // 5. Heavy endpoint flood (/api/push/test) -> 429 after 2 requests from same IP
  for (let i = 0; i < 2; i += 1) {
    const r = await fetch(`${baseUrl}/api/push/test`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Forwarded-For': '203.0.113.30' },
    });
    assert.equal(r.status, 200);
  }
  const blockedHeavy = await fetch(`${baseUrl}/api/push/test`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-Forwarded-For': '203.0.113.30' },
  });
  assert.equal(blockedHeavy.status, 429);

  // 6. Global HTTP DDoS request flood across static routes -> 429 after globalMax (25)
  let hitGlobal429 = false;
  for (let i = 0; i < 30; i += 1) {
    const r = await fetch(`${baseUrl}/manifest.webmanifest`, {
      headers: { 'X-Forwarded-For': '203.0.113.40' },
    });
    if (r.status === 429) {
      hitGlobal429 = true;
      assert.ok(Number(r.headers.get('retry-after')) >= 1);
      break;
    }
    assert.equal(r.status, 200);
  }
  assert.equal(hitGlobal429, true);
});

test('Charts & KPIs sync with filtered or selected ledger transactions (including selectedIds, excludedStats, and chartsScope)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-chart-scope-test-'));
  const app = createApp({
    dataDir: tmpDir,
    dbPath: path.join(tmpDir, 'scope.db'),
    receiptsDir: path.join(tmpDir, 'receipts'),
    skipInitialCsvImport: true,
    rateLimit: false,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => {
    app.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const reqJson = async (p, opts = {}, cookie = '') => {
    const res = await fetch(`${baseUrl}${p}`, {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : {} };
  };

  const setup = await reqJson('/api/auth/setup', {
    method: 'POST',
    body: { username: 'charttester', password: 'StrongPassword123' },
  });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie').split(';')[0];

  const accA = await reqJson(
    '/api/accounts',
    { method: 'POST', body: { name: 'BankAlpha', currency: 'HUF', initialBalance: 100000 } },
    cookie
  );
  const accB = await reqJson(
    '/api/accounts',
    { method: 'POST', body: { name: 'BankEuro', currency: 'EUR', initialBalance: 500 } },
    cookie
  );
  assert.equal(accA.status, 201);
  assert.equal(accB.status, 201);

  const initDash = await reqJson('/api/dashboard', {}, cookie);
  const pocketA = initDash.data.accounts.find((a) => a.name === 'BankAlpha').pockets[0];
  const pocketB = initDash.data.accounts.find((a) => a.name === 'BankEuro').pockets[0];

  const tx1 = await reqJson(
    '/api/transactions',
    {
      method: 'POST',
      body: { date: '2026-10-05T10:00', type: 'expense', amount: 5000, currency: 'HUF', pocketId: pocketA.id, categoryName: 'Groceries', merchant: 'Mock Grocery' },
    },
    cookie
  );
  const tx2 = await reqJson(
    '/api/transactions',
    {
      method: 'POST',
      body: { date: '2026-10-12T14:00', type: 'expense', amount: 15000, currency: 'HUF', pocketId: pocketA.id, categoryName: 'Shopping', merchant: 'Mock Furniture Store' },
    },
    cookie
  );
  const tx3 = await reqJson(
    '/api/transactions',
    {
      method: 'POST',
      body: { date: '2026-11-02T19:00', type: 'expense', amount: 20, currency: 'EUR', pocketId: pocketB.id, categoryName: 'Dining Out', merchant: 'Mock Bistro' },
    },
    cookie
  );
  const tx4 = await reqJson(
    '/api/transactions',
    {
      method: 'POST',
      body: { date: '2026-11-01T09:00', type: 'income', amount: 80000, currency: 'HUF', pocketId: pocketA.id, categoryName: 'Salary', merchant: 'Mock Employer Corp.' },
    },
    cookie
  );
  const tx5 = await reqJson(
    '/api/transactions',
    {
      method: 'POST',
      body: {
        date: '2026-11-10T11:00',
        type: 'expense',
        amount: 4000,
        currency: 'HUF',
        pocketId: pocketA.id,
        categoryName: 'Shopping',
        merchant: 'Mock Excluded Shop',
        excludeFromAnalytics: true,
      },
    },
    cookie
  );
  assert.equal(tx1.status, 201);
  assert.equal(tx2.status, 201);
  assert.equal(tx3.status, 201);
  assert.equal(tx4.status, 201);
  assert.equal(tx5.status, 201);

  // 1. Category filter scopes KPIs & charts to matching non-excluded ledger items
  const catFiltered = await reqJson('/api/dashboard?month=all&categoryName=Shopping', {}, cookie);
  assert.equal(catFiltered.status, 200);
  assert.equal(catFiltered.data.analyticsScope.mode, 'filtered');
  assert.equal(catFiltered.data.analyticsScope.includeExcluded, false);
  assert.equal(catFiltered.data.kpis.periodExpenseHuf, 15000);
  assert.equal(catFiltered.data.kpis.periodIncomeHuf, 0);
  assert.deepEqual(catFiltered.data.charts.expenseByCategory.map((c) => [c.category, c.amountHuf]), [['Shopping', 15000]]);
  assert.deepEqual(catFiltered.data.charts.monthlyCashflow.map((m) => [m.month, m.expenseHuf]), [['2026-10', 15000]]);

  // 2. excludedStats=1 chip shows stats for excluded entries instead of 0
  const exclDash = await reqJson('/api/dashboard?month=all&excludedStats=1', {}, cookie);
  assert.equal(exclDash.status, 200);
  assert.equal(exclDash.data.analyticsScope.mode, 'filtered');
  assert.equal(exclDash.data.analyticsScope.includeExcluded, true);
  assert.equal(exclDash.data.kpis.periodExpenseHuf, 4000);
  assert.equal(exclDash.data.charts.topMerchants[0].name, 'Mock Excluded Shop');

  // 3. Explicit selectedIds calculates KPIs, category/merchant charts, monthly cashflow & wealthDistribution strictly from checked rows
  const selDash = await reqJson(
    `/api/dashboard?month=all&selectedIds=${tx2.data.transaction.id},${tx5.data.transaction.id}`,
    {},
    cookie
  );
  assert.equal(selDash.status, 200);
  assert.equal(selDash.data.analyticsScope.mode, 'selected');
  assert.equal(selDash.data.analyticsScope.selectedCount, 2);
  assert.equal(selDash.data.analyticsScope.includeExcluded, true);
  assert.equal(selDash.data.kpis.txCount, 2);
  assert.equal(selDash.data.kpis.periodExpenseHuf, 19000);
  assert.equal(selDash.data.kpis.periodIncomeHuf, 0);
  assert.deepEqual(selDash.data.charts.expenseByCategory.map((c) => [c.category, c.amountHuf]), [['Shopping', 19000]]);
  assert.equal(selDash.data.charts.wealthDistribution.length, 1);
  assert.equal(selDash.data.charts.wealthDistribution[0].accountName, 'BankAlpha');
  assert.equal(selDash.data.charts.wealthDistribution[0].pct, 100);

  // 4. chartsScope=all unlinks charts/KPIs from ledger filters while keeping ledger rows filtered
  const unlinkedDash = await reqJson('/api/dashboard?month=all&search=Mock%20Furniture%20Store&chartsScope=all', {}, cookie);
  assert.equal(unlinkedDash.status, 200);
  assert.equal(unlinkedDash.data.transactions.length, 1);
  assert.equal(unlinkedDash.data.transactions[0].merchant, 'Mock Furniture Store');
  assert.equal(unlinkedDash.data.analyticsScope.mode, 'all');
  assert.equal(unlinkedDash.data.analyticsScope.chartsScope, 'all');
  assert.equal(unlinkedDash.data.kpis.periodIncomeHuf, 80000);
  assert.ok(unlinkedDash.data.kpis.periodExpenseHuf > 20000);
});

test('Deleted transaction trash & restore: single/bulk undo, receipt retention, timeframe expiry, and settings toggle', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-trash-test-'));
  const receiptsDir = path.join(tmpDir, 'receipts');
  const app = createApp({
    dataDir: tmpDir,
    dbPath: path.join(tmpDir, 'trash.db'),
    receiptsDir,
    skipInitialCsvImport: true,
    rateLimit: false,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => {
    app.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const reqJson = async (p, opts = {}, cookie = '') => {
    const res = await fetch(`${baseUrl}${p}`, {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : {} };
  };

  const setup = await reqJson('/api/auth/setup', {
    method: 'POST',
    body: { username: 'trashtester', password: 'StrongPassword123' },
  });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie').split(';')[0];

  const initDash = await reqJson('/api/dashboard', {}, cookie);
  assert.equal(initDash.data.deletedTxCount, 0);
  assert.equal(initDash.data.trashRetentionMinutes, 43200);
  const mainPocket = initDash.data.accounts[0].pockets[0];

  // Create transaction with a receipt attached via dummy file + DB receipt_path
  const tx1Res = await reqJson(
    '/api/transactions',
    {
      method: 'POST',
      body: { date: '2026-11-12T10:00', type: 'expense', amount: 3500, currency: 'HUF', pocketId: mainPocket.id, categoryName: 'Shopping', merchant: 'Mock Trash Market', note: 'Keep me safe' },
    },
    cookie
  );
  assert.equal(tx1Res.status, 201);
  const tx1Id = tx1Res.data.transaction.id;
  const dummyReceiptName = 'receipt-trash-test.jpg';
  fs.mkdirSync(receiptsDir, { recursive: true });
  fs.writeFileSync(path.join(receiptsDir, dummyReceiptName), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  app.db.prepare('UPDATE transactions SET receipt_path = ? WHERE id = ?').run(dummyReceiptName, tx1Id);

  const tx2Res = await reqJson(
    '/api/transactions',
    {
      method: 'POST',
      body: { date: '2026-11-13T12:00', type: 'income', amount: 10000, currency: 'HUF', pocketId: mainPocket.id, categoryName: 'Salary', merchant: 'Mock Bonus' },
    },
    cookie
  );
  assert.equal(tx2Res.status, 201);
  const tx2Id = tx2Res.data.transaction.id;

  // 1. Delete single transaction -> moves to trash, updates balance, preserves receipt file on disk
  const delSingle = await reqJson(`/api/transactions/${tx1Id}`, { method: 'DELETE' }, cookie);
  assert.equal(delSingle.status, 200);
  assert.ok(delSingle.data.trashId > 0);
  assert.equal(fs.existsSync(path.join(receiptsDir, dummyReceiptName)), true);

  const dashAfterDel = await reqJson('/api/dashboard', {}, cookie);
  assert.equal(dashAfterDel.data.deletedTxCount, 1);
  assert.equal(dashAfterDel.data.accounts[0].pockets[0].current_balance, 10000);

  const trashList = await reqJson('/api/transactions/trash', {}, cookie);
  assert.equal(trashList.status, 200);
  assert.equal(trashList.data.items.length, 1);
  assert.equal(trashList.data.items[0].merchant, 'Mock Trash Market');
  assert.ok(trashList.data.items[0].remainingMs > 0);

  // 2. Restore from trash within timeframe -> recovers original transaction ID, receipt file, note & balance
  const restoreSingle = await reqJson(
    '/api/transactions/trash/restore',
    { method: 'POST', body: { ids: [delSingle.data.trashId] } },
    cookie
  );
  assert.equal(restoreSingle.status, 200);
  assert.equal(restoreSingle.data.restoredCount, 1);
  assert.deepEqual(restoreSingle.data.restoredIds, [tx1Id]);

  const dashAfterRestore = await reqJson('/api/dashboard', {}, cookie);
  assert.equal(dashAfterRestore.data.deletedTxCount, 0);
  assert.equal(dashAfterRestore.data.accounts[0].pockets[0].current_balance, 6500);
  const recovered = dashAfterRestore.data.transactions.find((x) => x.id === tx1Id);
  assert.ok(recovered);
  assert.equal(recovered.note, 'Keep me safe');
  assert.equal(recovered.receipt_path, dummyReceiptName);

  // 3. Bulk delete both & restore all
  const bulkDel = await reqJson(
    '/api/transactions/bulk',
    { method: 'POST', body: { ids: [tx1Id, tx2Id], action: 'delete' } },
    cookie
  );
  assert.equal(bulkDel.status, 200);
  assert.equal(bulkDel.data.trashIds.length, 2);
  assert.equal((await reqJson('/api/dashboard', {}, cookie)).data.accounts[0].pockets[0].current_balance, 0);

  const restoreAll = await reqJson(
    '/api/transactions/trash/restore',
    { method: 'POST', body: { all: true } },
    cookie
  );
  assert.equal(restoreAll.status, 200);
  assert.equal(restoreAll.data.restoredCount, 2);
  assert.equal((await reqJson('/api/dashboard', {}, cookie)).data.accounts[0].pockets[0].current_balance, 6500);

  // 4. Expiration: once timeframe expires, restore returns 410 and purges orphaned receipt file from disk
  const delExpire = await reqJson(`/api/transactions/${tx1Id}`, { method: 'DELETE' }, cookie);
  app.db
    .prepare('UPDATE deleted_transactions SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 60000).toISOString(), delExpire.data.trashId);

  const expiredRestore = await reqJson(
    '/api/transactions/trash/restore',
    { method: 'POST', body: { ids: [delExpire.data.trashId] } },
    cookie
  );
  assert.equal(expiredRestore.status, 410);
  assert.equal(fs.existsSync(path.join(receiptsDir, dummyReceiptName)), false);
  assert.equal((await reqJson('/api/dashboard', {}, cookie)).data.deletedTxCount, 0);

  // 5. Disabling retention window (0 minutes) deletes permanently immediately
  const updSet = await reqJson('/api/settings', { method: 'PUT', body: { trashRetentionMinutes: 0 } }, cookie);
  assert.equal(updSet.status, 200);
  assert.equal(updSet.data.trashRetentionMinutes, 0);
  const permDel = await reqJson(`/api/transactions/${tx2Id}`, { method: 'DELETE' }, cookie);
  assert.equal(permDel.status, 200);
  assert.equal(permDel.data.trashId, null);
  assert.equal((await reqJson('/api/dashboard', {}, cookie)).data.deletedTxCount, 0);
});

test('Bank notification recognition: Qvik requests/payments, Revolut emoji titles, refunds, own-pocket & cross-bank transfers', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-notif-v2-test-'));
  const { server } = createApp({
    dataDir: tmpDir,
    dbPath: path.join(tmpDir, 'test.db'),
    receiptsDir: path.join(tmpDir, 'receipts'),
    skipInitialCsvImport: true,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function reqJson(pathname, opts = {}, cookie = '') {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
  }

  const setupRes = await reqJson('/api/auth/setup', {
    method: 'POST',
    body: { username: 'admin', password: 'StrongPassword123!' },
  });
  assert.equal(setupRes.status, 201);
  const cookie = setupRes.setCookie.split(';')[0];

  await reqJson('/api/accounts', { method: 'POST', body: { name: 'OTP', currency: 'HUF', initialBalance: 200000 } }, cookie);
  await reqJson('/api/accounts', { method: 'POST', body: { name: 'Revolut', currency: 'HUF', initialBalance: 100000 } }, cookie);

  const dash = await reqJson('/api/dashboard', {}, cookie);
  const otpAcc = dash.data.accounts.find((a) => a.name === 'OTP');
  const revAcc = dash.data.accounts.find((a) => a.name === 'Revolut');
  const otpMainId = otpAcc.pockets.find((p) => p.is_default === 1).id;
  await reqJson(`/api/pockets/${otpMainId}`, { method: 'PATCH', body: { name: 'Fő számla' } }, cookie);
  await reqJson('/api/pockets', {
    method: 'POST',
    body: { accountId: otpAcc.id, name: 'persely számla', currency: 'HUF', initialBalance: 100000 },
  }, cookie);
  await reqJson('/api/pockets', {
    method: 'POST',
    body: { accountId: otpAcc.id, name: 'Mock Goal Pocket', currency: 'HUF', initialBalance: 50000 },
  }, cookie);
  assert.ok(revAcc);

  const settingsRes = await reqJson('/api/settings', {}, cookie);
  const token = settingsRes.data.webhookToken;

  async function postWebhook(payload) {
    return reqJson(`/api/notifications/webhook?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: payload,
    });
  }

  // 1. Qvik & Hungarian payment requests must be ignored cleanly (even with amounts/verbs)
  const qvikReq1 = await postWebhook({
    app: 'OTP Bank',
    title: 'Qvik kérelmet kaptál',
    text: 'Mock Recipient One 2 000 Ft összegű qvik fizetési kérelmet küldött.',
  });
  assert.equal(qvikReq1.status, 200);
  assert.equal(qvikReq1.data.logged, false);
  assert.equal(qvikReq1.data.ignored, true);

  const qvikReq2 = await postWebhook({
    app: 'OTP Bank',
    title: 'Fizetési kérelmet kaptál',
    text: '5 000 Ft fizetési kérelem érkezett.',
  });
  assert.equal(qvikReq2.status, 200);
  assert.equal(qvikReq2.data.logged, false);
  assert.equal(qvikReq2.data.ignored, true);

  // 2. Completed Qvik payments extract real recipient, NOT "Qvik fizetés"
  const qvikPay1 = await postWebhook({
    app: 'OTP Bank',
    title: 'Qvik fizetés',
    text: '-2 000 Ft, Mock Bookstore',
  });
  assert.equal(qvikPay1.status, 200);
  assert.equal(qvikPay1.data.logged, true);
  assert.equal(qvikPay1.data.transaction.type, 'expense');
  assert.equal(qvikPay1.data.transaction.amount, 2000);
  assert.equal(qvikPay1.data.transaction.merchant, 'Mock Bookstore');

  const qvikPay2 = await postWebhook({
    app: 'OTP Bank',
    title: 'Sikeres Qvik fizetés!',
    text: '-3 500 Ft értékben sikeresen fizettél a(z) Mock Cafe részére.',
  });
  assert.equal(qvikPay2.status, 200);
  assert.equal(qvikPay2.data.logged, true);
  assert.equal(qvikPay2.data.transaction.type, 'expense');
  assert.equal(qvikPay2.data.transaction.amount, 3500);
  assert.equal(qvikPay2.data.transaction.merchant, 'Mock Cafe');

  // 3. Revolut emoji status titles must NOT overwrite body counterparty; "with a GIF!" must still log
  const revSent = await postWebhook({
    app: 'Revolut',
    title: 'Transfer sent ✅',
    text: 'You sent 72\u00A0100\u00A0HUF to Mock Recipient One. It will arrive in seconds',
  });
  assert.equal(revSent.status, 200);
  assert.equal(revSent.data.logged, true);
  assert.equal(revSent.data.transaction.type, 'expense');
  assert.equal(revSent.data.transaction.amount, 72100);
  assert.equal(revSent.data.transaction.merchant, 'Mock Recipient One');

  const revRefund = await postWebhook({
    app: 'Revolut',
    title: 'Refund arrived  🎉',
    text: "You've received a payment refund of HUF72,100 from Mock Electronics Store",
  });
  assert.equal(revRefund.status, 200);
  assert.equal(revRefund.data.logged, true);
  assert.equal(revRefund.data.transaction.type, 'income');
  assert.equal(revRefund.data.transaction.amount, 72100);
  assert.equal(revRefund.data.transaction.merchant, 'Mock Electronics Store');

  const revPaidEmoji = await postWebhook({
    app: 'Revolut',
    title: 'Mock Electronics Store',
    text: '🛍 Paid 72\u00A0100\u00A0HUF at Mock Electronics Store ⚠️ HUF Balance: 0,50\u00A0HUF',
  });
  assert.equal(revPaidEmoji.status, 200);
  assert.equal(revPaidEmoji.data.logged, true);
  assert.equal(revPaidEmoji.data.transaction.type, 'expense');
  assert.equal(revPaidEmoji.data.transaction.amount, 72100);
  assert.equal(revPaidEmoji.data.transaction.merchant, 'Mock Electronics Store');
  assert.equal(revPaidEmoji.data.parsed.balance_after, 0.5);

  const revGif = await postWebhook({
    app: 'Revolut',
    title: 'Mock Person Alpha Beta',
    text: 'Has sent you HUF15,000 with a GIF! 💸',
  });
  assert.equal(revGif.status, 200);
  assert.equal(revGif.data.logged, true);
  assert.equal(revGif.data.transaction.type, 'income');
  assert.equal(revGif.data.transaction.amount, 15000);
  assert.equal(revGif.data.transaction.merchant, 'Mock Person Alpha Beta');

  // 4. Pending refund (even with amount) & transaction approval prompts must be ignored
  const pendingRefund = await postWebhook({
    app: 'Revolut',
    title: 'Refund is on the way 😎',
    text: 'Mock Electronics Store has initiated a refund of HUF 12,000. You can expect to receive it in around 5 days',
  });
  assert.equal(pendingRefund.status, 200);
  assert.equal(pendingRefund.data.logged, false);
  assert.equal(pendingRefund.data.ignored, true);

  const approvalPrompt = await postWebhook({
    app: 'OTP Bank',
    title: 'Jóváhagyod a tranzakciót?',
    text: 'Revolut**9999*, 54503 HUF',
  });
  assert.equal(approvalPrompt.status, 200);
  assert.equal(approvalPrompt.data.logged, false);
  assert.equal(approvalPrompt.data.ignored, true);

  // 5. Own-pocket transfer direction (+ withdraws from pocket to Main; - sends from Main to pocket)
  const fromPersely = await postWebhook({
    app: 'OTP Bank',
    title: 'Azonnali átutalás',
    text: '🎉 +71 110 Ft, PERSELY SZÁMLA',
  });
  assert.equal(fromPersely.status, 200);
  assert.equal(fromPersely.data.logged, true);
  assert.equal(fromPersely.data.transaction.type, 'transfer');
  assert.equal(fromPersely.data.transaction.account_name, 'OTP');
  assert.equal(fromPersely.data.transaction.pocket_name, 'persely számla');
  assert.equal(fromPersely.data.transaction.dest_pocket_name, 'Fő számla');
  assert.equal(fromPersely.data.transaction.merchant, '');

  const fromPerselyDup = await postWebhook({
    app: 'OTP Bank',
    title: 'Azonnali átutalás',
    text: '🎉 +71 110 Ft, PERSELY SZÁMLA',
  });
  assert.equal(fromPerselyDup.status, 200);
  assert.equal(fromPerselyDup.data.logged, false);
  assert.equal(fromPerselyDup.data.duplicate, true);

  const toCustomPocket = await postWebhook({
    app: 'OTP Bank',
    title: 'Azonnali átutalás',
    text: '-72 100 Ft, Mock Goal Pocket',
  });
  assert.equal(toCustomPocket.status, 200);
  assert.equal(toCustomPocket.data.logged, true);
  assert.equal(toCustomPocket.data.transaction.type, 'transfer');
  assert.equal(toCustomPocket.data.transaction.pocket_name, 'Fő számla');
  assert.equal(toCustomPocket.data.transaction.dest_pocket_name, 'Mock Goal Pocket');
  assert.equal(toCustomPocket.data.transaction.category_name, 'Pocket-to-Pocket Transfer');
  assert.equal(toCustomPocket.data.transaction.merchant, '');

  const fromCustomPocket = await postWebhook({
    app: 'OTP Bank',
    title: 'Azonnali átutalás',
    text: '+10 000 Ft, Mock Goal Pocket',
  });
  assert.equal(fromCustomPocket.status, 200);
  assert.equal(fromCustomPocket.data.logged, true);
  assert.equal(fromCustomPocket.data.transaction.type, 'transfer');
  assert.equal(fromCustomPocket.data.transaction.pocket_name, 'Mock Goal Pocket');
  assert.equal(fromCustomPocket.data.transaction.dest_pocket_name, 'Fő számla');
  assert.equal(fromCustomPocket.data.transaction.category_name, 'Pocket-to-Pocket Transfer');
  assert.equal(fromCustomPocket.data.transaction.merchant, '');

  // 6. Cross-bank card top-up (OTP -> Revolut) vs real shop with "Revolut" in name
  const topupRes = await postWebhook({
    app: 'OTP Bank',
    title: 'Sikeres Online vásárlás!',
    text: '-54 503 Ft értékben sikeresen vásároltál a(z) Revolut**9999* webshopjában.',
  });
  assert.equal(topupRes.status, 200);
  assert.equal(topupRes.data.logged, true);
  assert.equal(topupRes.data.transaction.type, 'transfer');
  assert.equal(topupRes.data.transaction.account_name, 'OTP');
  assert.equal(topupRes.data.transaction.pocket_name, 'Fő számla');
  assert.equal(topupRes.data.transaction.dest_account_name, 'Revolut');
  assert.equal(topupRes.data.transaction.dest_pocket_name, 'Main');
  assert.equal(topupRes.data.transaction.category_name, 'Bank-to-Bank Transfer');
  assert.equal(topupRes.data.transaction.merchant, '');

  const revShopRes = await postWebhook({
    app: 'OTP Bank',
    title: 'Sikeres Online vásárlás!',
    text: '-4 500 Ft értékben sikeresen vásároltál a(z) Revolut Mock Shop webshopjában.',
  });
  assert.equal(revShopRes.status, 200);
  assert.equal(revShopRes.data.logged, true);
  assert.equal(revShopRes.data.transaction.type, 'expense');
  assert.equal(revShopRes.data.transaction.merchant, 'Revolut Mock Shop');

  // 7. Substring category guard ("Molnár" contains "mol" but must NOT become Fuel & Transport)
  const molnarRes = await postWebhook({
    app: 'OTP Bank',
    title: 'Sikeres vásárlás!',
    text: '-4 200 Ft értékben sikeresen vásároltál a Mock Molnár Bolt kereskedőnél.',
  });
  assert.equal(molnarRes.status, 200);
  assert.equal(molnarRes.data.logged, true);
  assert.equal(molnarRes.data.transaction.merchant, 'Mock Molnár Bolt');
  assert.notEqual(molnarRes.data.transaction.category_name, 'Fuel & Transport');

  // 8. Verify counterparty hygiene: zero generic titles, requests, or card masks leaked into counterparties
  const cpRes = await reqJson('/api/counterparties', {}, cookie);
  const allCpLower = [...cpRes.data.counterparties.in, ...cpRes.data.counterparties.out].map((c) =>
    c.name.toLowerCase()
  );
  for (const forbidden of ['qvik', 'kérel', 'transfer sent', 'refund arrived', 'revolut**9999', 'mock goal pocket']) {
    assert.equal(
      allCpLower.some((name) => name.includes(forbidden)),
      false,
      `Forbidden counterparty fragment "${forbidden}" found in: ${JSON.stringify(allCpLower)}`
    );
  }
});
