(function () {
  function t(key, vars) {
    return window.MoneyI18n ? window.MoneyI18n.t(key, vars) : key;
  }

  function tCat(name) {
    return window.MoneyI18n ? window.MoneyI18n.tCat(name) : name;
  }

  const PALETTE_PRESETS = {
    indigo: {
      i18n: 'presetIndigo',
      primary: '#6366f1',
      accent: '#0ea5e9',
      positive: '#10b981',
      negative: '#f43f5e',
      dark: { bg: '#0b1120', card: '#16223b', elevated: '#111a2e', input: '#0f172a' },
      light: { bg: '#f1f5f9', card: '#ffffff', elevated: '#ffffff', input: '#f8fafc' },
    },
    slate: {
      i18n: 'presetSlate',
      primary: '#64748b',
      accent: '#94a3b8',
      positive: '#16a34a',
      negative: '#dc2626',
      dark: { bg: '#111317', card: '#1c2026', elevated: '#171a20', input: '#14171c' },
      light: { bg: '#f4f5f7', card: '#ffffff', elevated: '#ffffff', input: '#eef0f4' },
    },
    sand: {
      i18n: 'presetSand',
      primary: '#8f653d',
      accent: '#b6895b',
      positive: '#2e8b57',
      negative: '#c94a4a',
      dark: { bg: '#171411', card: '#241f1a', elevated: '#1d1915', input: '#191512' },
      light: { bg: '#f7f3ed', card: '#fffdf9', elevated: '#ffffff', input: '#efe8dd' },
    },
    taupe: {
      i18n: 'presetTaupe',
      primary: '#78716c',
      accent: '#a8a29e',
      positive: '#15803d',
      negative: '#b91c1c',
      dark: { bg: '#141312', card: '#211f1d', elevated: '#1b1918', input: '#171614' },
      light: { bg: '#f5f4f2', card: '#ffffff', elevated: '#ffffff', input: '#eceae6' },
    },
    sage: {
      i18n: 'presetSage',
      primary: '#4b836b',
      accent: '#6ca48b',
      positive: '#22a06b',
      negative: '#d14353',
      dark: { bg: '#0f1613', card: '#18241f', elevated: '#141d19', input: '#111915' },
      light: { bg: '#f3f7f4', card: '#ffffff', elevated: '#ffffff', input: '#e9f0eb' },
    },
    sky: {
      i18n: 'presetSky',
      primary: '#3b82f6',
      accent: '#60a5fa',
      positive: '#10b981',
      negative: '#ef4444',
      dark: { bg: '#0d1520', card: '#162231', elevated: '#111b28', input: '#0f1824' },
      light: { bg: '#f4f8fc', card: '#ffffff', elevated: '#ffffff', input: '#eaf1f8' },
    },
    ocean: {
      i18n: 'presetOcean',
      primary: '#0284c7',
      accent: '#06b6d4',
      positive: '#10b981',
      negative: '#ef4444',
      dark: { bg: '#06131f', card: '#0e2538', elevated: '#0a1b2b', input: '#081724' },
      light: { bg: '#f0f9ff', card: '#ffffff', elevated: '#ffffff', input: '#e0f2fe' },
    },
  };

  function validHex(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
  }

  function sanitizePaletteClient(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const preset = PALETTE_PRESETS[src.preset] || src.preset === 'custom' ? src.preset : 'indigo';
    const out = { preset };
    for (const k of ['primary', 'accent', 'positive', 'negative', 'bg', 'card']) {
      const hex = validHex(src[k]);
      if (hex) out[k] = hex;
    }
    return out;
  }

  const CORE_KPIS = ['kpi-networth', 'kpi-income', 'kpi-expense', 'kpi-cashflow'];
  const EXTRA_KPIS = [
    'kpi-savings-rate',
    'kpi-daily-avg',
    'kpi-top-merchant',
    'kpi-biggest-expense',
    'kpi-recurring',
    'kpi-tx-activity',
  ];
  const ALL_KPIS = [...CORE_KPIS, ...EXTRA_KPIS];

  const CORE_CHARTS = ['chart-monthly', 'chart-donut', 'chart-income', 'chart-balance'];
  const EXTRA_CHARTS = ['chart-net-trend', 'chart-daily-spend', 'chart-weekday', 'chart-bank-dist'];
  const ALL_CHARTS = [...CORE_CHARTS, ...EXTRA_CHARTS];

  const DEFAULT_LAYOUT = {
    lang: localStorage.getItem('mm_lang') === 'hu' ? 'hu' : 'en',
    palette: { preset: 'indigo' },
    sectionRows: [[{ id: 'kpis', w: 1 }], [{ id: 'banks', w: 1 }], [{ id: 'charts', w: 1 }], [{ id: 'ledger', w: 1 }]],
    kpiRows: [
      CORE_KPIS.map((id) => ({ id, w: 1 })),
      EXTRA_KPIS.slice(0, 4).map((id) => ({ id, w: 1 })),
      EXTRA_KPIS.slice(4).map((id) => ({ id, w: 1 })),
    ],
    chartRows: [
      [
        { id: 'chart-monthly', w: 1 },
        { id: 'chart-donut', w: 1 },
      ],
      [
        { id: 'chart-income', w: 1 },
        { id: 'chart-balance', w: 1 },
      ],
      [
        { id: 'chart-net-trend', w: 1 },
        { id: 'chart-daily-spend', w: 1 },
      ],
      [
        { id: 'chart-weekday', w: 1 },
        { id: 'chart-bank-dist', w: 1 },
      ],
    ],
    bankRows: [],
    autoSize: true,
    manualSizes: {},
    itemHeights: {},
    itemWidths: {},
    sectionOrder: ['kpis', 'banks', 'charts', 'ledger'],
    hiddenSections: [],
    sectionSpans: {},
    kpiOrder: [...ALL_KPIS],
    hiddenKpis: [...EXTRA_KPIS],
    kpiSpans: {},
    chartOrder: [...ALL_CHARTS],
    hiddenCharts: [...EXTRA_CHARTS],
    chartSpans: {},
    bankOrder: [],
    bankSpans: {},
    hideHistorical: false,
    ledgerPageSize: 25,
  };

  function sanitizePageSizeClient(val, fallback = 25) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.max(1, Math.min(500, Math.round(n)));
  }

  function clampWeight(val) {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.round(Math.max(0.15, Math.min(10, n)) * 1000) / 1000;
  }

  function sanitizeHeightMapClient(obj) {
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

  function sanitizeWidthMapClient(obj) {
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

  function sanitizeManualSizesClient(obj) {
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

  function sanitizeRowListClient(rawRows, allIds, defaultPerRow = 1) {
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
          const w = clampWeight(typeof cell === 'object' && cell !== null ? cell.w : 1);
          cleanRow.push({ id, w });
        }
        if (cleanRow.length > 0) rows.push(cleanRow);
      }
    }
    for (const id of allIds.map(String)) {
      if (seen.has(id)) continue;
      if (defaultPerRow > 1 && rows.length > 0 && rows[rows.length - 1].length < defaultPerRow) {
        rows[rows.length - 1].push({ id, w: 1 });
      } else {
        rows.push([{ id, w: 1 }]);
      }
    }
    return rows;
  }

  function migrateFlatToRowsClient(orderIds, spansMap = {}, mode = 'single', defaultPerRow = 1) {
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

  function normalizeLayout(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const mergeOrder = (given, def) => {
      const seen = new Set();
      const out = [];
      for (const id of Array.isArray(given) ? given : []) {
        if (def.includes(id) && !seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
      for (const id of def) {
        if (!seen.has(id)) out.push(id);
      }
      return out;
    };
    const filterValid = (given, def) =>
      Array.isArray(given) ? given.filter((id) => def.includes(id)) : [];
    const copySpans = (given, def) => {
      const out = {};
      if (given && typeof given === 'object') {
        for (const [k, v] of Object.entries(given)) {
          if (def.includes(k) && (v === 2 || v === 'full')) out[k] = 2;
        }
      }
      return out;
    };
    const copySectionSpans = (given, def) => {
      const out = {};
      if (given && typeof given === 'object') {
        for (const [k, v] of Object.entries(given)) {
          if (def.includes(k) && (v === 1 || v === 'half')) out[k] = 1;
        }
      }
      return out;
    };
    const copyBankSpans = (given) => {
      const out = {};
      if (given && typeof given === 'object') {
        for (const [k, v] of Object.entries(given)) {
          const idNum = Number(k);
          if (Number.isInteger(idNum) && idNum > 0 && (v === 2 || v === 3)) {
            out[String(idNum)] = v;
          }
        }
      }
      return out;
    };

    const baseSectionOrder = mergeOrder(src.sectionOrder, DEFAULT_LAYOUT.sectionOrder);
    const baseKpiOrder = mergeOrder(src.kpiOrder, DEFAULT_LAYOUT.kpiOrder);
    const baseChartOrder = mergeOrder(src.chartOrder, DEFAULT_LAYOUT.chartOrder);
    const baseBankIds = Array.isArray(src.bankOrder) ? src.bankOrder.map(Number).filter(Boolean) : [];

    const collectRowIdsClient = (rows) => {
      const set = new Set();
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (!Array.isArray(r)) continue;
          for (const c of r) {
            const id = String(typeof c === 'object' && c !== null ? c.id : c || '').trim();
            if (id) set.add(id);
          }
        }
      }
      return set;
    };
    const mentionedKpis = new Set([
      ...(Array.isArray(src.kpiOrder) ? src.kpiOrder.map(String) : []),
      ...collectRowIdsClient(src.kpiRows),
    ]);
    const mentionedCharts = new Set([
      ...(Array.isArray(src.chartOrder) ? src.chartOrder.map(String) : []),
      ...collectRowIdsClient(src.chartRows),
    ]);

    const normalizedHiddenKpis = filterValid(src.hiddenKpis, DEFAULT_LAYOUT.kpiOrder);
    for (const id of EXTRA_KPIS) {
      if (!mentionedKpis.has(id) && !normalizedHiddenKpis.includes(id)) {
        normalizedHiddenKpis.push(id);
      }
    }
    const normalizedHiddenCharts = filterValid(src.hiddenCharts, DEFAULT_LAYOUT.chartOrder);
    for (const id of EXTRA_CHARTS) {
      if (!mentionedCharts.has(id) && !normalizedHiddenCharts.includes(id)) {
        normalizedHiddenCharts.push(id);
      }
    }

    const sectionSpans = copySectionSpans(src.sectionSpans, DEFAULT_LAYOUT.sectionOrder);
    const kpiSpans = copySpans(src.kpiSpans, DEFAULT_LAYOUT.kpiOrder);
    const chartSpans = copySpans(src.chartSpans, DEFAULT_LAYOUT.chartOrder);
    const bankSpans = copyBankSpans(src.bankSpans);

    const sectionRows = Array.isArray(src.sectionRows)
      ? sanitizeRowListClient(src.sectionRows, baseSectionOrder, 1)
      : migrateFlatToRowsClient(baseSectionOrder, sectionSpans, 'section', 2);
    const kpiRows = Array.isArray(src.kpiRows)
      ? sanitizeRowListClient(src.kpiRows, baseKpiOrder, 4)
      : migrateFlatToRowsClient(baseKpiOrder, kpiSpans, 'kpi', 4);
    const chartRows = Array.isArray(src.chartRows)
      ? sanitizeRowListClient(src.chartRows, baseChartOrder, 2)
      : migrateFlatToRowsClient(baseChartOrder, chartSpans, 'chart', 2);

    const rawBankRowIds = [];
    if (Array.isArray(src.bankRows)) {
      for (const r of src.bankRows) {
        if (!Array.isArray(r)) continue;
        for (const c of r) {
          const id = String(typeof c === 'object' && c !== null ? c.id : c || '').trim();
          if (id && !rawBankRowIds.includes(id)) rawBankRowIds.push(id);
        }
      }
    }
    const mergedBankStrIds = [...new Set([...rawBankRowIds, ...baseBankIds.map(String)])];
    const bankRows = Array.isArray(src.bankRows)
      ? sanitizeRowListClient(src.bankRows, mergedBankStrIds, 3)
      : migrateFlatToRowsClient(baseBankIds.map(String), bankSpans, 'bank', 3);

    const itemHeights = sanitizeHeightMapClient(src.itemHeights);
    const itemWidths = sanitizeWidthMapClient(src.itemWidths);
    const manualSizes = sanitizeManualSizesClient(src.manualSizes);
    if (!src.manualSizes && Object.keys(itemHeights).length > 0) {
      for (const [k, h] of Object.entries(itemHeights)) {
        manualSizes[k] = { w: null, h };
      }
    }

    return {
      lang: src.lang === 'hu' ? 'hu' : src.lang === 'en' ? 'en' : DEFAULT_LAYOUT.lang,
      palette: sanitizePaletteClient(src.palette),
      sectionRows,
      kpiRows,
      chartRows,
      bankRows,
      autoSize: src.autoSize !== false,
      manualSizes,
      itemHeights,
      itemWidths,
      sectionOrder: sectionRows.flatMap((r) => r.map((c) => c.id)),
      hiddenSections: filterValid(src.hiddenSections, DEFAULT_LAYOUT.sectionOrder),
      sectionSpans,
      kpiOrder: kpiRows.flatMap((r) => r.map((c) => c.id)),
      hiddenKpis: normalizedHiddenKpis,
      kpiSpans,
      chartOrder: chartRows.flatMap((r) => r.map((c) => c.id)),
      hiddenCharts: normalizedHiddenCharts,
      chartSpans,
      bankOrder: bankRows.flatMap((r) => r.map((c) => Number(c.id))).filter((n) => Number.isInteger(n) && n > 0),
      bankSpans,
      hideHistorical: Boolean(src.hideHistorical),
      ledgerPageSize: sanitizePageSizeClient(src.ledgerPageSize, 25),
    };
  }

  function loadLocalLayout() {
    try {
      const raw = localStorage.getItem('mm_dashboard_layout');
      return raw ? normalizeLayout(JSON.parse(raw)) : normalizeLayout(DEFAULT_LAYOUT);
    } catch {
      return normalizeLayout(DEFAULT_LAYOUT);
    }
  }

  const state = {
    user: null,
    dashboard: null,
    showArchived: false,
    editMode: false,
    serverLayoutSynced: false,
    sessionTimeoutMinutes: 10,
    sessionDeadlineMs: 0,
    sessionTimerInterval: null,
    sessionExpiring: false,
    lastActivityResetMs: 0,
    lastServerPingMs: 0,
    selectedTxIds: new Set(),
    lastClickedTxId: null,
    chartsFollowLedger: true,
    layout: loadLocalLayout(),
    filters: {
      month: 'all',
      accountId: '',
      pocketId: '',
      type: 'all',
      categoryName: 'all',
      approval: 'all',
      visibility: 'visible',
      historical: 'all',
      recurring: '',
      excludedStats: '',
      hasReceipt: '',
      autoSource: '',
      sort: 'date_desc',
      search: '',
      page: 1,
      limit: 25,
    },
  };
  state.filters.limit = state.layout.ledgerPageSize || 25;
  if (state.layout.hideHistorical) {
    state.filters.historical = 'live';
  }
  let activeReceiptUI = null;
  let currentViewingReceiptTx = null;
  let currentEditingTxObj = null;
  let currentNoteModalTx = null;

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMoney(amount, currency = 'HUF', showSign = false) {
    const num = Number(amount) || 0;
    const abs = Math.abs(num);
    const maxDec = currency === 'HUF' && Math.abs(abs - Math.round(abs)) < 0.005 ? 0 : 2;
    const formatted = abs.toLocaleString(undefined, {
      minimumFractionDigits: maxDec,
      maximumFractionDigits: maxDec,
    });
    const sign = num < 0 ? '-' : showSign && num > 0 ? '+' : '';
    const sym = currency === 'HUF' ? ' Ft' : currency === 'EUR' ? ' €' : currency === 'USD' ? ' $' : currency === 'GBP' ? ' £' : ` ${currency}`;
    return `${sign}${formatted}${sym}`;
  }

  const openModalStack = [];

  function syncToastHost() {
    const container = document.getElementById('toast-container');
    if (!container) return null;
    for (let i = openModalStack.length - 1; i >= 0; i -= 1) {
      if (!openModalStack[i] || !openModalStack[i].isConnected || !openModalStack[i].open) {
        openModalStack.splice(i, 1);
      }
    }
    document.querySelectorAll('dialog[open]').forEach((dlg) => {
      if (!openModalStack.includes(dlg)) openModalStack.push(dlg);
    });
    const topDialog = openModalStack.length ? openModalStack[openModalStack.length - 1] : null;
    const host = topDialog || document.body;
    if (host && (container.parentElement !== host || container.nextElementSibling !== null)) {
      host.appendChild(container);
    }
    return container;
  }

  if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.__mmToastPatched) {
    HTMLDialogElement.prototype.__mmToastPatched = true;
    const origShowModal = HTMLDialogElement.prototype.showModal;
    const origClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = function () {
      const idx = openModalStack.indexOf(this);
      if (idx !== -1) openModalStack.splice(idx, 1);
      openModalStack.push(this);
      const res = origShowModal.apply(this, arguments);
      syncToastHost();
      return res;
    };
    HTMLDialogElement.prototype.close = function () {
      const idx = openModalStack.indexOf(this);
      if (idx !== -1) openModalStack.splice(idx, 1);
      const res = origClose.apply(this, arguments);
      syncToastHost();
      return res;
    };
  }

  function toast(message, kind = 'ok', opts = {}) {
    const container = syncToastHost();
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}${opts?.actionLabel ? ' toast-has-action' : ''}`;

    if (opts?.actionLabel && typeof opts.onAction === 'function') {
      const msgSpan = document.createElement('span');
      msgSpan.textContent = message;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action-btn';
      btn.textContent = opts.actionLabel;
      el.appendChild(msgSpan);
      el.appendChild(btn);
      let timer = null;
      const closeToast = () => {
        if (timer) clearTimeout(timer);
        el.remove();
        syncToastHost();
      };
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        closeToast();
        try {
          await opts.onAction();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
      container.appendChild(el);
      timer = setTimeout(closeToast, Number(opts.durationMs) || 8500);
      return;
    }

    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
      syncToastHost();
    }, Number(opts?.durationMs) || 4200);
  }

  async function api(url, opts = {}) {
    const headers = { Accept: 'application/json', ...(opts.headers || {}) };
    const fetchOpts = { method: opts.method || 'GET', headers, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(opts.body);
    }
    const reqUrl = url.startsWith('/') ? url.slice(1) : url;
    const res = await fetch(reqUrl, fetchOpts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && !url.startsWith('/api/auth/')) {
        showAuthScreen(true);
      }
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    if (state.user && !url.startsWith('/api/auth/logout') && !url.includes('touch=0')) {
      resetInactivityTimer({ fromApi: true, timeoutMinutes: data.sessionTimeoutMinutes });
    }
    return data;
  }

  function storePasswordCredential(formEl, username, password) {
    try {
      if (window.PasswordCredential && navigator.credentials?.store) {
        let cred;
        if (formEl && formEl.id === 'login-form') {
          cred = new PasswordCredential(formEl);
        } else {
          cred = new PasswordCredential({ id: username, password, name: username });
        }
        navigator.credentials.store(cred).catch(() => {});
      }
    } catch {
      // ignore on browsers without Credential Management API
    }
  }

  function sanitizeSessionTimeout(mins) {
    const num = Number(mins);
    if (!Number.isFinite(num) || num < 1) return 10;
    return Math.min(10080, Math.max(1, Math.round(num)));
  }

  function formatCountdown(remainingMs) {
    const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function updateSessionTimerDisplay() {
    const badge = document.getElementById('session-timer-badge');
    const textEl = document.getElementById('session-timer-text');
    if (!badge || !textEl) return;
    const remainingMs = Math.max(0, state.sessionDeadlineMs - Date.now());
    textEl.textContent = formatCountdown(remainingMs);
    const remainingSec = Math.ceil(remainingMs / 1000);
    badge.classList.toggle('is-warning', remainingSec <= 60 && remainingSec > 15);
    badge.classList.toggle('is-urgent', remainingSec <= 15);
  }

  function stopSessionCountdown() {
    if (state.sessionTimerInterval) {
      clearInterval(state.sessionTimerInterval);
      state.sessionTimerInterval = null;
    }
    state.sessionDeadlineMs = 0;
  }

  async function handleSessionExpired() {
    if (!state.user || state.sessionExpiring) return;
    state.sessionExpiring = true;
    stopSessionCountdown();
    state.user = null;
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    try {
      await fetch('api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // ignore on auto-logout
    }
    showAuthScreen(true);
    toast(t('toastSessionExpired'), 'err');
    state.sessionExpiring = false;
  }

  function resetInactivityTimer(opts = {}) {
    if (!state.user) return;
    const now = Date.now();
    if (!opts.fromApi && state.sessionDeadlineMs > 0 && now >= state.sessionDeadlineMs) {
      handleSessionExpired();
      return;
    }
    if (!opts.fromApi && now - state.lastActivityResetMs < 500) {
      return;
    }
    state.lastActivityResetMs = now;
    const timeoutMins = sanitizeSessionTimeout(opts.timeoutMinutes ?? state.sessionTimeoutMinutes);
    state.sessionTimeoutMinutes = timeoutMins;
    state.sessionDeadlineMs = now + timeoutMins * 60 * 1000;
    updateSessionTimerDisplay();

    if (opts.fromApi) {
      state.lastServerPingMs = now;
    } else if (now - state.lastServerPingMs > 20000) {
      state.lastServerPingMs = now;
      fetch('api/auth/ping', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      })
        .then(async (r) => {
          if (r.status === 401) {
            handleSessionExpired();
            return;
          }
          const d = await r.json().catch(() => ({}));
          if (r.ok && d.sessionTimeoutMinutes) {
            state.sessionTimeoutMinutes = sanitizeSessionTimeout(d.sessionTimeoutMinutes);
          }
        })
        .catch(() => {});
    }
  }

  function tickSessionCountdown() {
    if (!state.user || !state.sessionDeadlineMs) return;
    const remainingMs = state.sessionDeadlineMs - Date.now();
    if (remainingMs <= 0) {
      updateSessionTimerDisplay();
      handleSessionExpired();
      return;
    }
    updateSessionTimerDisplay();
  }

  function startSessionCountdown(timeoutMinutes) {
    state.sessionExpiring = false;
    if (timeoutMinutes !== undefined && timeoutMinutes !== null) {
      state.sessionTimeoutMinutes = sanitizeSessionTimeout(timeoutMinutes);
    }
    stopSessionCountdown();
    resetInactivityTimer({ fromApi: true, timeoutMinutes: state.sessionTimeoutMinutes });
    state.sessionTimerInterval = setInterval(tickSessionCountdown, 1000);
  }

  function renderAppVersion(info) {
    if (!info) return;
    state.appVersion = info;
    const label = info.label || (info.version ? `v${info.version}` : '');
    const details = [
      info.version ? `Version: v${info.version}` : '',
      info.buildNumber ? `Build: #${info.buildNumber}` : '',
      info.commitSha ? `Commit: ${info.commitSha}${info.isDirty ? ' (uncommitted dev changes)' : ''}` : '',
      info.buildTime ? `Built: ${info.buildTime}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    for (const id of ['auth-app-version', 'settings-app-version']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.textContent = label;
      if (details) el.title = details;
    }
  }

  function showAuthScreen(initialized) {
    stopSessionCountdown();
    state.user = null;
    if (state.appVersion) renderAppVersion(state.appVersion);
    document.getElementById('app-view').classList.add('hidden');
    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('setup-form').classList.toggle('hidden', initialized);
    document.getElementById('login-form').classList.toggle('hidden', !initialized);
  }

  function showAppScreen(user, sessionTimeoutMinutes) {
    state.user = user;
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    document.getElementById('user-badge').textContent = t('signedInAs', { user: user.username });
    startSessionCountdown(sessionTimeoutMinutes ?? state.sessionTimeoutMinutes);
  }

  function getAllPockets() {
    if (!state.dashboard) return [];
    const list = [];
    for (const acc of state.dashboard.accounts) {
      for (const p of acc.pockets) {
        list.push({ ...p, accountName: acc.name, accountArchived: Boolean(acc.is_archived) });
      }
    }
    return list;
  }

  function getActivePockets() {
    return getAllPockets().filter((p) => !p.is_archived && !p.accountArchived);
  }

  function populatePocketSelect(selectEl, preferredId = null, includeArchivedId = null) {
    const incIdNum = includeArchivedId ? Number(includeArchivedId) : null;
    const accounts = state.dashboard?.accounts || [];
    const unusedSuffix = ` (${t('badgeUnused')})`;
    selectEl.innerHTML = accounts
      .map((acc) => {
        const visiblePockets = acc.pockets.filter(
          (p) => (!p.is_archived && !acc.is_archived) || (incIdNum && p.id === incIdNum)
        );
        if (visiblePockets.length === 0) return '';
        return `<optgroup label="${esc(acc.name)}${acc.is_archived ? esc(unusedSuffix) : ''}">${visiblePockets
          .map(
            (p) =>
              `<option value="${p.id}" data-currency="${esc(p.currency)}">${esc(acc.name)} → ${esc(p.name)} (${esc(p.currency)})${p.is_archived ? ` [${esc(t('badgeUnused'))}]` : ''}</option>`
          )
          .join('')}</optgroup>`;
      })
      .join('');
    if (preferredId && Array.from(selectEl.options).some((o) => o.value === String(preferredId))) {
      selectEl.value = String(preferredId);
    }
  }

  function populateCategorySelect(selectEl, txType) {
    const cats = (state.dashboard?.categories || []).filter((c) => c.type === txType);
    selectEl.innerHTML = cats
      .map((c) => `<option value="${c.id}" data-orig-name="${esc(c.name)}">${esc(tCat(c.name))}</option>`)
      .join('');
  }

  function selectOptionByTextOrValue(selectEl, labelOrId) {
    const target = String(labelOrId || '').toLowerCase();
    const match = Array.from(selectEl.options).find(
      (o) =>
        o.value === String(labelOrId) ||
        (o.dataset?.origName && o.dataset.origName.toLowerCase() === target) ||
        o.textContent.toLowerCase() === target
    );
    if (match) selectEl.value = match.value;
  }

  function saveLayoutState(persistToServer = true) {
    try {
      localStorage.setItem('mm_dashboard_layout', JSON.stringify(state.layout));
    } catch {
      // ignore storage quota errors
    }
    if (persistToServer && state.user) {
      api('/api/dashboard-layout', { method: 'PUT', body: state.layout }).catch(() => {});
    }
  }

  function syncHistoricalControlsUI() {
    const mode = state.filters.historical || 'all';
    const isLiveOnly = mode === 'live';
    const sel = document.getElementById('filter-historical');
    if (sel) sel.value = mode;
    ['edit-hide-historical', 'settings-hide-historical'].forEach((id) => {
      const chk = document.getElementById(id);
      if (chk) chk.checked = isLiveOnly;
    });

    const label = isLiveOnly
      ? t('btnHistoricalHidden')
      : mode === 'historical'
      ? t('btnHistoryOnly')
      : t('btnHideHistorical');
    ['btn-toggle-historical', 'btn-charts-historical'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.textContent = label;
      btn.classList.toggle('btn-active-filter', mode !== 'all');
    });
  }

  async function setHistoricalMode(mode, persist = true) {
    state.filters.historical = mode || 'all';
    state.filters.page = 1;
    state.layout.hideHistorical = state.filters.historical === 'live';
    syncHistoricalControlsUI();
    saveLayoutState(persist);
    await refreshDashboard();
  }

  function getDeviceTheme() {
    try {
      if (window.matchMedia) {
        if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
      }
    } catch {
      // ignore matchMedia errors
    }
    return 'dark';
  }

  function getThemeMode() {
    try {
      if (localStorage.getItem('mm_theme_sync_v2') !== '1') {
        localStorage.removeItem('mm_theme');
        if (!localStorage.getItem('mm_theme_mode')) localStorage.setItem('mm_theme_mode', 'auto');
        localStorage.setItem('mm_theme_sync_v2', '1');
      }
      const mode = localStorage.getItem('mm_theme_mode');
      if (mode === 'light' || mode === 'dark') return mode;
    } catch {
      // ignore storage errors
    }
    return 'auto';
  }

  function updateThemeButtonUI() {
    const btn = document.getElementById('btn-theme');
    if (!btn) return;
    const mode = getThemeMode();
    const active = document.documentElement.getAttribute('data-theme') || getDeviceTheme();
    btn.textContent = mode === 'auto' ? '🌓' : mode === 'light' ? '☀️' : '🌙';
    const tip =
      mode === 'auto'
        ? t('titleThemeAuto', { theme: active === 'light' ? t('themeModeLight') : t('themeModeDark') })
        : mode === 'light'
        ? t('titleThemeLight')
        : t('titleThemeDark');
    btn.title = tip;
    btn.setAttribute('aria-label', tip);
  }

  function syncThemeWithDevice(forcePalette = false) {
    const mode = getThemeMode();
    const target = mode === 'light' || mode === 'dark' ? mode : getDeviceTheme();
    const current = document.documentElement.getAttribute('data-theme');
    const changed = current !== target;
    if (changed) {
      document.documentElement.setAttribute('data-theme', target);
      if (state.layout.palette) {
        delete state.layout.palette.bg;
        delete state.layout.palette.card;
      }
    }
    if (changed || forcePalette) {
      applyColorPalette();
      if (changed && state.dashboard) renderAllCharts();
    } else {
      updateThemeButtonUI();
    }
  }

  function setThemeMode(mode) {
    const nextMode = mode === 'light' || mode === 'dark' ? mode : 'auto';
    try {
      localStorage.setItem('mm_theme_sync_v2', '1');
      localStorage.setItem('mm_theme_mode', nextMode);
      localStorage.removeItem('mm_theme');
    } catch {
      // ignore storage errors
    }
    if (state.layout.palette) {
      delete state.layout.palette.bg;
      delete state.layout.palette.card;
    }
    syncThemeWithDevice(true);
    if (state.dashboard) renderAllCharts();
    saveLayoutState(true);
  }

  function adjustHex(hex, delta) {
    const clean = validHex(hex) || '#6366f1';
    const clamp = (n) => Math.max(0, Math.min(255, n));
    const r = clamp(parseInt(clean.slice(1, 3), 16) + delta);
    const g = clamp(parseInt(clean.slice(3, 5), 16) + delta);
    const b = clamp(parseInt(clean.slice(5, 7), 16) + delta);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  function hexToRgb(hex) {
    const clean = validHex(hex) || '#0b1120';
    return [
      parseInt(clean.slice(1, 3), 16),
      parseInt(clean.slice(3, 5), 16),
      parseInt(clean.slice(5, 7), 16),
    ];
  }

  function computeModalBackdrop(bgHex, primaryHex, isLight) {
    const [br, bgC, bb] = hexToRgb(bgHex);
    const [pr, pg, pb] = hexToRgb(primaryHex);
    const wBg = isLight ? 0.55 : 0.78;
    const wPri = 0.12;
    const r = Math.round(br * wBg + pr * wPri);
    const g = Math.round(bgC * wBg + pg * wPri);
    const b = Math.round(bb * wBg + pb * wPri);
    return `rgba(${r}, ${g}, ${b}, ${isLight ? 0.5 : 0.74})`;
  }

  function resolvePaletteValues() {
    const p = state.layout.palette || { preset: 'indigo' };
    const base = PALETTE_PRESETS[p.preset] || PALETTE_PRESETS.indigo;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const surf = isLight ? base.light : base.dark;
    const primary = validHex(p.primary) || base.primary;
    const bg = validHex(p.bg) || surf.bg;
    const card = validHex(p.card) || surf.card;
    return {
      preset: p.preset || 'indigo',
      primary,
      primaryHover: adjustHex(primary, -18),
      accent: validHex(p.accent) || base.accent,
      positive: validHex(p.positive) || base.positive,
      negative: validHex(p.negative) || base.negative,
      bg,
      card,
      elevated: validHex(p.bg) ? adjustHex(bg, isLight ? 4 : 7) : surf.elevated,
      input: validHex(p.bg) ? adjustHex(bg, isLight ? -3 : 4) : surf.input,
    };
  }

  function applyColorPalette() {
    const vals = resolvePaletteValues();
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--primary', vals.primary);
    rootStyle.setProperty('--primary-hover', vals.primaryHover);
    rootStyle.setProperty('--accent', vals.accent);
    rootStyle.setProperty('--positive', vals.positive);
    rootStyle.setProperty('--negative', vals.negative);
    rootStyle.setProperty('--bg', vals.bg);
    rootStyle.setProperty('--bg-card', vals.card);
    rootStyle.setProperty('--bg-elevated', vals.elevated);
    rootStyle.setProperty('--bg-input', vals.input);
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    rootStyle.backgroundColor = vals.bg;
    rootStyle.setProperty('--modal-backdrop', computeModalBackdrop(vals.bg, vals.primary, isLight));
    const metaTheme = document.getElementById('meta-theme-color');
    if (metaTheme) {
      metaTheme.setAttribute('content', vals.bg);
    } else if (document.head) {
      const m = document.createElement('meta');
      m.name = 'theme-color';
      m.id = 'meta-theme-color';
      m.content = vals.bg;
      document.head.appendChild(m);
    }
    updateThemeButtonUI();
    renderPaletteControls();
  }

  function renderPaletteControls() {
    const vals = resolvePaletteValues();
    const activePreset = state.layout.palette?.preset || 'indigo';
    const activeThemeMode = getThemeMode();
    const themeModesHtml = [
      ['auto', `🌓 ${t('themeModeAuto')}`],
      ['light', `☀️ ${t('themeModeLight')}`],
      ['dark', `🌙 ${t('themeModeDark')}`],
    ]
      .map(
        ([m, label]) =>
          `<button type="button" class="btn btn-ghost small theme-mode-btn ${activeThemeMode === m ? 'active' : ''}" data-theme-mode="${m}">${esc(label)}</button>`
      )
      .join('');
    const presetsHtml = Object.entries(PALETTE_PRESETS)
      .map(([id, cfg]) => {
        const isAct = activePreset === id;
        return `<button type="button" class="preset-chip ${isAct ? 'active' : ''}" data-palette-preset="${id}"><span class="preset-swatch" style="background:${cfg.primary}"></span>${esc(t(cfg.i18n))}</button>`;
      })
      .join('');

    const pickers = [
      ['primary', t('colPrimary'), vals.primary],
      ['accent', t('colAccent'), vals.accent],
      ['positive', t('colPositive'), vals.positive],
      ['negative', t('colNegative'), vals.negative],
      ['bg', t('colBg'), vals.bg],
      ['card', t('colCard'), vals.card],
    ]
      .map(
        ([k, label, val]) =>
          `<label class="color-chip-label"><span>${esc(label)}</span><input type="color" data-palette-key="${k}" value="${esc(val)}" /></label>`
      )
      .join('');

    const html = `
      <div class="palette-bar-head">
        <div>
          <strong>${esc(t('paletteTitle'))}</strong>
          <span class="muted small" style="margin-left:6px;">${esc(t('paletteDesc'))}</span>
        </div>
        <div class="palette-head-actions">
          <div class="theme-mode-pills" role="group" aria-label="${esc(t('themeModeLabel'))}">${themeModesHtml}</div>
          <button type="button" class="btn btn-ghost small" data-palette-reset="1">${esc(t('btnResetColors'))}</button>
        </div>
      </div>
      <div class="palette-presets">${presetsHtml}</div>
      <div class="palette-pickers">${pickers}</div>
    `;

    ['edit-palette-bar', 'settings-palette-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  }

  function initPaletteControls() {
    document.addEventListener('click', (e) => {
      const themeModeBtn = e.target.closest('[data-theme-mode]');
      if (themeModeBtn) {
        setThemeMode(themeModeBtn.dataset.themeMode);
        return;
      }
      const presetBtn = e.target.closest('[data-palette-preset]');
      if (presetBtn) {
        const id = presetBtn.dataset.palettePreset;
        if (!PALETTE_PRESETS[id]) return;
        state.layout.palette = { preset: id };
        applyColorPalette();
        renderAllCharts();
        saveLayoutState(true);
        toast(t('toastPaletteSaved'), 'ok');
        return;
      }
      if (e.target.closest('[data-palette-reset]')) {
        state.layout.palette = { preset: 'indigo' };
        applyColorPalette();
        renderAllCharts();
        saveLayoutState(true);
        toast(t('toastPaletteReset'), 'ok');
      }
    });

    document.addEventListener('input', (e) => {
      const inp = e.target.closest('input[type="color"][data-palette-key]');
      if (!inp) return;
      const key = inp.dataset.paletteKey;
      state.layout.palette = { ...(state.layout.palette || { preset: 'custom' }), preset: 'custom', [key]: inp.value };
      applyColorPalette();
      renderAllCharts();
    });

    document.addEventListener('change', (e) => {
      const inp = e.target.closest('input[type="color"][data-palette-key]');
      if (!inp) return;
      saveLayoutState(true);
    });
  }

  function convertAmountHufClient(amount, currency = 'HUF', fxRates = {}) {
    const val = Number(amount);
    if (!Number.isFinite(val)) return 0;
    const cur = String(currency || 'HUF').toUpperCase();
    const rate = cur === 'HUF' ? 1 : Number(fxRates?.[cur] || 1) || 1;
    return Math.round(val * rate * 100) / 100;
  }

  function computeClientAnalytics(txList, fxRates = {}, accounts = []) {
    const roundHuf = (n) => Math.round((Number(n) || 0) * 100) / 100;
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
    const monthlyMap = new Map();
    const weekdayBuckets = Array.from({ length: 7 }, (_, dow) => ({ dow, expenseHuf: 0, count: 0 }));
    const touchedPocketIds = new Set();

    for (const tx of txList || []) {
      if (tx.pocket_id) touchedPocketIds.add(Number(tx.pocket_id));
      if (tx.dest_pocket_id) touchedPocketIds.add(Number(tx.dest_pocket_id));
      if (tx.receipt_path) receiptCount += 1;
      if (tx.type !== 'income' && tx.type !== 'expense' && tx.type !== 'transfer') continue;

      const hufAmt = convertAmountHufClient(tx.amount, tx.currency, fxRates);
      const txLabel = String(tx.merchant || tx.category_name || '').trim() || tx.category_name;
      const txDay = String(tx.date || '').slice(0, 10);
      const txMonth = String(tx.date || '').slice(0, 7);

      if (txMonth.length === 7) {
        const mEntry = monthlyMap.get(txMonth) || { month: txMonth, incomeHuf: 0, expenseHuf: 0, transferHuf: 0, netHuf: 0 };
        if (tx.type === 'income') mEntry.incomeHuf += hufAmt;
        else if (tx.type === 'expense') mEntry.expenseHuf += hufAmt;
        else if (tx.type === 'transfer') mEntry.transferHuf += hufAmt;
        mEntry.netHuf = mEntry.incomeHuf - mEntry.expenseHuf;
        monthlyMap.set(txMonth, mEntry);
      }

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
        if (Number(tx.is_recurring) === 1) {
          recurringExpenseHuf += hufAmt;
          recurringCount += 1;
        }
        if (!biggestExpense || hufAmt > biggestExpense.amountHuf) {
          biggestExpense = {
            id: tx.id,
            amountHuf: roundHuf(hufAmt),
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

    periodIncomeHuf = roundHuf(periodIncomeHuf);
    periodExpenseHuf = roundHuf(periodExpenseHuf);
    periodTransferHuf = roundHuf(periodTransferHuf);
    recurringExpenseHuf = roundHuf(recurringExpenseHuf);
    const periodNetHuf = roundHuf(periodIncomeHuf - periodExpenseHuf);
    const savingsRate =
      periodIncomeHuf > 0 ? Math.round(((periodIncomeHuf - periodExpenseHuf) / periodIncomeHuf) * 1000) / 10 : 0;
    const activeExpenseDays = dailyExpMap.size;
    const avgDailyExpenseHuf = activeExpenseDays > 0 ? roundHuf(periodExpenseHuf / activeExpenseDays) : 0;
    const avgExpenseTxHuf = outCount > 0 ? roundHuf(periodExpenseHuf / outCount) : 0;
    const recurringPct =
      periodExpenseHuf > 0 ? Math.round((recurringExpenseHuf / periodExpenseHuf) * 1000) / 10 : 0;

    const finalizeBreakdown = (map, total) =>
      Array.from(map.values())
        .map((item) => ({
          ...item,
          amountHuf: roundHuf(item.amountHuf),
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
      .map((dItem) => ({
        date: dItem.date,
        expenseHuf: roundHuf(dItem.expenseHuf),
        count: dItem.count,
      }));

    const weekdaySpending = weekdayBuckets.map((w) => ({
      dow: w.dow,
      expenseHuf: roundHuf(w.expenseHuf),
      count: w.count,
      pct: periodExpenseHuf > 0 ? Math.round((w.expenseHuf / periodExpenseHuf) * 1000) / 10 : 0,
    }));

    let runningNetHuf = 0;
    const monthlyCashflow = Array.from(monthlyMap.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12)
      .map((m) => {
        const inc = roundHuf(m.incomeHuf);
        const exp = roundHuf(m.expenseHuf);
        const trf = roundHuf(m.transferHuf);
        const net = roundHuf(m.netHuf);
        runningNetHuf = roundHuf(runningNetHuf + net);
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

    const wealthDistribution = [];
    for (const acc of accounts || []) {
      if (acc.is_archived) continue;
      for (const p of acc.pockets || []) {
        if (p.is_archived || !(Number(p.balance_huf) > 0)) continue;
        if (touchedPocketIds.size > 0 && !touchedPocketIds.has(Number(p.id))) continue;
        wealthDistribution.push({
          pocketId: p.id,
          pocketName: p.name,
          accountId: acc.id,
          accountName: acc.name,
          color: p.color || acc.color || '#6366f1',
          currency: p.currency,
          balance: p.current_balance,
          balanceHuf: roundHuf(p.balance_huf),
          pct: 0,
        });
      }
    }
    const scopedWealthTotal = wealthDistribution.reduce((sum, w) => sum + w.balanceHuf, 0);
    for (const w of wealthDistribution) {
      w.pct = scopedWealthTotal > 0 ? Math.round((w.balanceHuf / scopedWealthTotal) * 1000) / 10 : 0;
    }
    wealthDistribution.sort((a, b) => b.balanceHuf - a.balanceHuf);

    return {
      kpis: {
        periodIncomeHuf,
        periodExpenseHuf,
        periodTransferHuf,
        transferCount,
        periodNetHuf,
        savingsRate,
        txCount: (txList || []).length,
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
      },
    };
  }

  function collectActiveLedgerFilterPills(d) {
    const pills = [];
    if (state.filters.month && state.filters.month !== 'all') {
      pills.push(t('scopePillMonth', { month: state.filters.month }));
    }
    if (state.filters.accountId) {
      const acc = (d?.accounts || []).find((a) => String(a.id) === String(state.filters.accountId));
      if (acc) pills.push(t('scopePillBank', { name: acc.name }));
    }
    if (state.filters.pocketId) {
      const pObj = (d?.accounts || []).flatMap((a) => a.pockets || []).find((p) => String(p.id) === String(state.filters.pocketId));
      if (pObj) pills.push(t('scopePillPocket', { name: pObj.name }));
    }
    if (state.filters.type && state.filters.type !== 'all') {
      const typeKeys = { expense: 'typeExpense', income: 'typeIncome', transfer: 'typeTransfer', adjustment: 'typeAdjustment' };
      const label = typeKeys[state.filters.type] ? t(typeKeys[state.filters.type]) : state.filters.type;
      pills.push(t('scopePillType', { type: label }));
    }
    if (state.filters.categoryName && state.filters.categoryName !== 'all') {
      pills.push(t('scopePillCategory', { cat: tCat(state.filters.categoryName) }));
    }
    if (state.filters.search) {
      pills.push(t('scopePillSearch', { q: state.filters.search }));
    }
    if (state.filters.approval === 'needs_approval') pills.push(t('approvalFilterPending'));
    else if (state.filters.approval === 'approved') pills.push(t('approvalFilterApproved'));
    if (state.filters.visibility === 'hidden') pills.push(t('visFilterHidden'));
    else if (state.filters.visibility === 'all') pills.push(t('visFilterAll'));
    if (state.filters.recurring) pills.push(t('chipRecurring'));
    if (state.filters.excludedStats) pills.push(t('chipExcludedStats'));
    if (state.filters.hasReceipt) pills.push(t('chipHasReceipt'));
    if (state.filters.autoSource === 'notification') pills.push(t('chipFromNotif'));
    return pills;
  }

  function getActiveAnalyticsState() {
    const d = state.dashboard;
    if (!d) return null;
    const baseScopeText = state.filters.month === 'all' ? t('scopeAllTime') : state.filters.month;
    const filterPills = collectActiveLedgerFilterPills(d);
    const hasLedgerFilters = filterPills.some((p) => !state.filters.month || state.filters.month === 'all' || !p.startsWith(t('scopePillMonth', { month: state.filters.month })));
    const selectedTxs =
      state.selectedTxIds.size > 0
        ? (d.transactions || []).filter((tx) => state.selectedTxIds.has(tx.id))
        : [];

    if (state.chartsFollowLedger && selectedTxs.length > 0) {
      const computed = computeClientAnalytics(selectedTxs, d.fxRates, d.accounts);
      return {
        mode: 'selected',
        kpis: computed.kpis,
        charts: computed.charts,
        txCount: selectedTxs.length,
        selectedCount: selectedTxs.length,
        hasLedgerFilters,
        filterPills,
        scopeLabel: t('scopeLabelSelected', { count: selectedTxs.length }),
      };
    }

    if (!state.chartsFollowLedger) {
      return {
        mode: 'unlinked',
        kpis: d.kpis,
        charts: d.charts,
        txCount: Number(d.kpis?.txCount || 0),
        selectedCount: selectedTxs.length,
        hasLedgerFilters,
        filterPills: state.filters.month !== 'all' ? [t('scopePillMonth', { month: state.filters.month })] : [],
        scopeLabel: baseScopeText,
      };
    }

    const mode = d.analyticsScope?.mode === 'filtered' || hasLedgerFilters ? 'filtered' : 'all';
    const txCount = Number(d.kpis?.txCount || 0);
    return {
      mode,
      kpis: d.kpis,
      charts: d.charts,
      txCount,
      selectedCount: 0,
      hasLedgerFilters,
      filterPills,
      scopeLabel: mode === 'filtered' ? t('scopeLabelFiltered', { count: txCount }) : baseScopeText,
    };
  }

  function renderAllCharts(chartsOverride = null) {
    const d = state.dashboard;
    if (!d) return;
    const charts = chartsOverride || getActiveAnalyticsState()?.charts || d.charts;
    window.MoneyCharts.renderMonthlyCashflowChart(document.getElementById('chart-monthly'), charts.monthlyCashflow);
    window.MoneyCharts.renderExpenseDonutChart(document.getElementById('chart-expense-donut'), charts.expenseByCategory);
    window.MoneyCharts.renderIncomeSourcesChart(
      document.getElementById('chart-income-sources'),
      charts.incomeByCategory,
      charts.transferByCategory || []
    );
    window.MoneyCharts.renderTopMerchantsChart(
      document.getElementById('chart-balance-history'),
      charts.topMerchants || [],
      charts.topIncomeSources || []
    );
    window.MoneyCharts.renderNetTrendChart(document.getElementById('chart-net-trend-body'), charts.monthlyCashflow || []);
    window.MoneyCharts.renderDailySpendingChart(document.getElementById('chart-daily-spend-body'), charts.dailySpending || []);
    window.MoneyCharts.renderWeekdaySpendingChart(document.getElementById('chart-weekday-body'), charts.weekdaySpending || []);
    window.MoneyCharts.renderWealthDistributionChart(document.getElementById('chart-bank-dist-body'), charts.wealthDistribution || []);
  }

  function renderKpiCards(active) {
    const d = state.dashboard;
    if (!d || !active) return;
    const kpis = active.kpis || d.kpis;
    const charts = active.charts || d.charts;
    const scopeText = active.scopeLabel;

    document.getElementById('kpi-networth').textContent = formatMoney(d.totalNetWorthHuf, 'HUF');
    const curBadges = Object.entries(d.totalsByCurrency || {})
      .map(([cur, amt]) => `<span class="curr-pill">${formatMoney(amt, cur)}</span>`)
      .join('');
    document.getElementById('kpi-currencies').innerHTML = curBadges || `<span class="muted">${esc(t('kpiNoPockets'))}</span>`;

    document.getElementById('kpi-income-label').textContent = t('kpiIncomePeriodLabel', { scope: scopeText });
    document.getElementById('kpi-expense-label').textContent = t('kpiExpensePeriodLabel', { scope: scopeText });
    document.getElementById('donut-scope-label').textContent = scopeText;

    document.getElementById('kpi-income').textContent = formatMoney(kpis.periodIncomeHuf, 'HUF', true);
    document.getElementById('kpi-expense').textContent = formatMoney(-kpis.periodExpenseHuf, 'HUF');

    const netEl = document.getElementById('kpi-net');
    netEl.textContent = formatMoney(kpis.periodNetHuf, 'HUF', true);
    netEl.className = `kpi-value ${kpis.periodNetHuf >= 0 ? 'positive' : 'negative'}`;

    const topInc = (charts.incomeByCategory || [])
      .slice(0, 3)
      .map((c) => `${tCat(c.category)} (${c.pct}%)`)
      .join(' · ');
    document.getElementById('kpi-income-top').textContent = topInc || t('kpiIncomeFallback');

    const topExp = (charts.expenseByCategory || [])
      .slice(0, 3)
      .map((c) => `${tCat(c.category)} (${c.pct}%)`)
      .join(' · ');
    document.getElementById('kpi-expense-top').textContent = topExp || t('kpiExpenseFallback');

    const topTrf = (charts.transferByCategory || [])
      .slice(0, 3)
      .map((c) => `${tCat(c.category)} (${c.pct}%)`)
      .join(' · ');
    document.getElementById('kpi-savings-rate').textContent = topTrf || t('kpiTransferFallback');

    const incChartSub = document.getElementById('income-chart-sub');
    if (incChartSub) {
      const activeIncTrf = [...(charts.incomeByCategory || []), ...(charts.transferByCategory || [])]
        .slice(0, 3)
        .map((c) => `${tCat(c.category)} (${c.pct}%)`)
        .join(' · ');
      incChartSub.textContent = activeIncTrf || scopeText;
    }

    const merchChartSub = document.getElementById('merchants-chart-sub');
    if (merchChartSub) {
      merchChartSub.textContent = scopeText;
    }

    const srValEl = document.getElementById('kpi-savings-rate-val');
    if (srValEl) {
      const rate = Number(kpis.savingsRate || 0);
      srValEl.textContent = `${rate}%`;
      srValEl.className = `kpi-value ${rate >= 0 ? 'positive' : 'negative'}`;
      document.getElementById('kpi-savings-rate-sub').textContent = t('kpiSavingsSummary', {
        rate,
        amt: formatMoney(kpis.periodTransferHuf || 0, 'HUF'),
        count: kpis.transferCount || 0,
      });
    }

    const dailyValEl = document.getElementById('kpi-daily-avg-val');
    if (dailyValEl) {
      dailyValEl.textContent = formatMoney(-(kpis.avgDailyExpenseHuf || 0), 'HUF');
      document.getElementById('kpi-daily-avg-sub').textContent = t('kpiDailyAvgSub', {
        days: kpis.activeExpenseDays || 0,
        perTx: formatMoney(kpis.avgExpenseTxHuf || 0, 'HUF'),
      });
    }

    const topMerchValEl = document.getElementById('kpi-top-merchant-val');
    if (topMerchValEl) {
      const tm = kpis.topMerchant;
      topMerchValEl.textContent = tm ? tm.name : '-';
      document.getElementById('kpi-top-merchant-sub').textContent = tm
        ? t('kpiTopMerchantSub', {
            amt: formatMoney(tm.amountHuf, 'HUF'),
            count: tm.count,
            pct: tm.pct,
          })
        : t('kpiExpenseFallback');
    }

    const bigExpValEl = document.getElementById('kpi-biggest-expense-val');
    if (bigExpValEl) {
      const be = kpis.biggestExpense;
      bigExpValEl.textContent = be ? formatMoney(-be.amountHuf, 'HUF') : formatMoney(0, 'HUF');
      document.getElementById('kpi-biggest-expense-sub').textContent = be
        ? `${be.merchant || tCat(be.categoryName)} · ${be.date}`
        : t('kpiExpenseFallback');
    }

    const recValEl = document.getElementById('kpi-recurring-val');
    if (recValEl) {
      recValEl.textContent = formatMoney(-(kpis.recurringExpenseHuf || 0), 'HUF');
      document.getElementById('kpi-recurring-sub').textContent = t('kpiRecurringSub', {
        count: kpis.recurringCount || 0,
        pct: kpis.recurringPct || 0,
      });
    }

    const actValEl = document.getElementById('kpi-tx-activity-val');
    if (actValEl) {
      actValEl.textContent = String(kpis.txCount || 0);
      document.getElementById('kpi-tx-activity-sub').textContent = t('kpiActivitySub', {
        inc: kpis.inCount || 0,
        out: kpis.outCount || 0,
        rec: kpis.receiptCount || 0,
      });
    }
  }

  function renderChartsScopeBar(active) {
    const syncBtn = document.getElementById('btn-charts-sync-ledger');
    if (syncBtn) {
      syncBtn.classList.toggle('is-active', Boolean(state.chartsFollowLedger));
      syncBtn.setAttribute('aria-pressed', state.chartsFollowLedger ? 'true' : 'false');
      syncBtn.textContent = state.chartsFollowLedger ? t('btnChartsSyncLedger') : t('btnChartsUnlinked');
    }

    const bar = document.getElementById('charts-scope-bar');
    const badgeEl = document.getElementById('charts-scope-badge');
    const pillsEl = document.getElementById('charts-scope-pills');
    const actionsEl = document.getElementById('charts-scope-actions');
    if (!bar || !badgeEl || !pillsEl || !actionsEl || !active) return;

    bar.classList.toggle('is-selected', active.mode === 'selected');
    bar.classList.toggle('is-filtered', active.mode === 'filtered');
    bar.classList.toggle('is-unlinked', active.mode === 'unlinked');

    const kpis = active.kpis || {};
    const statPills = [];
    if (active.mode === 'selected') {
      badgeEl.textContent = t('scopeSelectedBadge', { count: active.selectedCount });
      if (kpis.periodIncomeHuf > 0) statPills.push(t('scopePillIn', { amt: formatMoney(kpis.periodIncomeHuf, 'HUF', true) }));
      if (kpis.periodExpenseHuf > 0) statPills.push(t('scopePillOut', { amt: formatMoney(-kpis.periodExpenseHuf, 'HUF') }));
      if (kpis.periodTransferHuf > 0) statPills.push(t('scopePillTransfers', { amt: formatMoney(kpis.periodTransferHuf, 'HUF') }));
      statPills.push(t('scopePillNet', { amt: formatMoney(kpis.periodNetHuf || 0, 'HUF', true) }));
    } else if (active.mode === 'filtered') {
      badgeEl.textContent = t('scopeFilteredBadge', { count: active.txCount });
      statPills.push(...active.filterPills);
    } else if (active.mode === 'unlinked') {
      badgeEl.textContent = t('scopeUnlinkedBadge', { count: active.txCount });
      statPills.push(...active.filterPills);
    } else {
      badgeEl.textContent = t('scopeAllBadge', { count: active.txCount });
      statPills.push(...active.filterPills);
    }

    pillsEl.innerHTML = statPills.map((p) => `<span class="charts-scope-pill">${esc(p)}</span>`).join('');

    const actions = [];
    if (active.mode === 'selected') {
      actions.push(`<button type="button" class="btn btn-ghost small" data-scope-action="clear-selection">${esc(t('btnScopeClearSelection'))}</button>`);
    }
    if (active.mode === 'filtered' && active.hasLedgerFilters) {
      actions.push(`<button type="button" class="btn btn-ghost small" data-scope-action="reset-filters">${esc(t('btnScopeResetFilters'))}</button>`);
    }
    if (active.mode === 'unlinked') {
      actions.push(`<button type="button" class="btn btn-secondary small" data-scope-action="relink">${esc(t('btnScopeRelink'))}</button>`);
    }
    actionsEl.innerHTML = actions.join('');
  }

  function updateBulkSummaryPill() {
    const sumEl = document.getElementById('ledger-bulk-summary');
    if (!sumEl) return;
    const d = state.dashboard;
    if (!d || state.selectedTxIds.size === 0) {
      sumEl.textContent = '';
      sumEl.classList.add('hidden');
      return;
    }
    const selectedTxs = (d.transactions || []).filter((tx) => state.selectedTxIds.has(tx.id));
    if (selectedTxs.length === 0) {
      sumEl.textContent = '';
      sumEl.classList.add('hidden');
      return;
    }
    const { kpis } = computeClientAnalytics(selectedTxs, d.fxRates, d.accounts);
    const parts = [];
    if (kpis.periodIncomeHuf > 0) parts.push(t('scopePillIn', { amt: formatMoney(kpis.periodIncomeHuf, 'HUF', true) }));
    if (kpis.periodExpenseHuf > 0) parts.push(t('scopePillOut', { amt: formatMoney(-kpis.periodExpenseHuf, 'HUF') }));
    if (kpis.periodTransferHuf > 0) parts.push(t('scopePillTransfers', { amt: formatMoney(kpis.periodTransferHuf, 'HUF') }));
    parts.push(t('scopePillNet', { amt: formatMoney(kpis.periodNetHuf, 'HUF', true) }));
    sumEl.textContent = parts.join(' · ');
    sumEl.classList.remove('hidden');
  }

  function renderAnalyticsAndKpis() {
    const active = getActiveAnalyticsState();
    if (!active) return;
    renderKpiCards(active);
    renderChartsScopeBar(active);
    updateBulkSummaryPill();
    renderAllCharts(active.charts);
  }

  async function refreshDashboard() {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(state.filters)) {
      if (v) params.set(k, v);
    }
    params.set('chartsScope', state.chartsFollowLedger ? 'ledger' : 'all');
    const data = await api(`/api/dashboard?${params.toString()}`);
    state.dashboard = data;

    if (!state.serverLayoutSynced && data.dashboardLayout) {
      state.serverLayoutSynced = true;
      state.layout = normalizeLayout(data.dashboardLayout);
      if (data.dashboardLayout.lang && window.MoneyI18n && window.MoneyI18n.getLang() !== data.dashboardLayout.lang) {
        window.MoneyI18n.setLang(data.dashboardLayout.lang, true);
      }
      applyColorPalette();
      try {
        localStorage.setItem('mm_dashboard_layout', JSON.stringify(state.layout));
      } catch {
        // ignore
      }
      const wantedHist = state.layout.hideHistorical ? 'live' : 'all';
      const wantedLimit = state.layout.ledgerPageSize || 25;
      if (state.filters.historical !== wantedHist || state.filters.limit !== wantedLimit) {
        state.filters.historical = wantedHist;
        state.filters.limit = wantedLimit;
        state.filters.page = 1;
        syncHistoricalControlsUI();
        return refreshDashboard();
      }
    }
    state.filters.page = Number(data.page || state.filters.page || 1);
    state.serverLayoutSynced = true;
    renderDashboard();
  }

  function renderDashboard() {
    const d = state.dashboard;
    if (!d) return;
    if (window.MoneyI18n) window.MoneyI18n.applyStaticTranslations();
    if (state.user) {
      document.getElementById('user-badge').textContent = t('signedInAs', { user: state.user.username });
    }
    syncHistoricalControlsUI();

    // Month selector options
    const monthSel = document.getElementById('month-filter');
    const prevMonth = state.filters.month;
    monthSel.innerHTML =
      `<option value="all">${esc(t('allTime'))}</option>` +
      d.availableMonths.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    monthSel.value = Array.from(monthSel.options).some((o) => o.value === prevMonth) ? prevMonth : 'all';

    // Clear bank/pocket scope button
    const clearBtn = document.getElementById('btn-clear-scope');
    clearBtn.classList.toggle('hidden', !state.filters.accountId && !state.filters.pocketId);

    // Banks & Pockets Grid
    renderBanksGrid(d.accounts);

    // Filter dropdowns
    renderFilterDropdowns(d);

    // Pending Approvals Banner
    const pendingCount = Number(d.pendingApprovalCount || 0);
    const pendingBanner = document.getElementById('pending-approvals-banner');
    if (pendingBanner) {
      pendingBanner.classList.toggle('hidden', pendingCount === 0);
      const pendingTextEl = document.getElementById('pending-approvals-text');
      if (pendingTextEl) pendingTextEl.textContent = t('pendingApprovalsText', { count: pendingCount });
      const filterPendingBtn = document.getElementById('btn-filter-pending');
      if (filterPendingBtn) {
        filterPendingBtn.textContent =
          state.filters.approval === 'needs_approval' ? t('btnShowAllApproval') : t('btnFilterPending');
      }
    }
    const approvalSel = document.getElementById('filter-approval');
    if (approvalSel) approvalSel.value = state.filters.approval || 'all';
    const visSel = document.getElementById('filter-visibility');
    if (visSel) {
      visSel.value = state.filters.visibility || 'visible';
      const hidOpt = visSel.querySelector('option[value="hidden"]');
      if (hidOpt) {
        const hidCount = Number(d.hiddenTxCount || 0);
        hidOpt.textContent = hidCount > 0 ? `${t('visFilterHidden')} (${hidCount})` : t('visFilterHidden');
      }
    }
    const typeSel = document.getElementById('filter-type');
    if (typeSel) typeSel.value = state.filters.type || 'all';
    const sortSel = document.getElementById('filter-sort');
    if (sortSel) sortSel.value = state.filters.sort || 'date_desc';

    syncFilterChipsAndResetUI(d);
    syncLedgerSortHeaders();

    const trashBtn = document.getElementById('btn-open-trash');
    if (trashBtn) {
      const delCount = Number(d.deletedTxCount || 0);
      trashBtn.classList.toggle('hidden', delCount === 0);
      trashBtn.textContent = t('btnOpenTrash', { count: delCount });
    }

    // Ledger Table & Pagination
    renderLedgerTable(d.transactions, d.totalMatchingTransactions);
    renderLedgerPagination(d);

    // Apply layout rows, widths, heights, visibility & edit mode handles first
    applyColorPalette();
    applyDashboardLayout();

    // Charts & KPIs (rendered after layout sizing so dynamic viewBoxes and custom heights fit exact widths)
    renderAnalyticsAndKpis();
  }

  function renderBanksGrid(accounts) {
    const grid = document.getElementById('banks-grid');
    grid.dataset.layoutSig = '';
    const toggleBtn = document.getElementById('btn-toggle-archived');
    const hiddenItemsCount = accounts.reduce(
      (sum, a) => sum + (a.is_archived ? 1 : a.pockets.filter((p) => p.is_archived).length),
      0
    );
    if (hiddenItemsCount === 0) {
      state.showArchived = false;
      toggleBtn.classList.add('hidden');
    } else {
      toggleBtn.classList.remove('hidden');
      toggleBtn.textContent = state.showArchived
        ? t('hideUnused', { count: hiddenItemsCount })
        : t('showUnused', { count: hiddenItemsCount });
    }

    const visibleAccounts = state.showArchived ? accounts : accounts.filter((a) => !a.is_archived);
    const unusedBadgeHtml = `<span class="badge-archived">${esc(t('badgeUnused'))}</span>`;
    grid.innerHTML = visibleAccounts
      .map((acc) => {
        const isAccActive = String(state.filters.accountId) === String(acc.id) && !state.filters.pocketId;
        const visiblePockets = state.showArchived ? acc.pockets : acc.pockets.filter((p) => !p.is_archived);
        const hasDiffCurrency = visiblePockets.some((p) => p.currency !== acc.currency);
        const hiddenHere = acc.pockets.length - acc.pockets.filter((p) => !p.is_archived).length;
        const subText = acc.is_archived
          ? t('archivedPocketCountSub', { count: acc.pockets.length })
          : !state.showArchived && hiddenHere > 0
          ? t('pocketCountHiddenSub', { count: visiblePockets.length, hidden: hiddenHere })
          : t('pocketCountSub', { count: visiblePockets.length });

        const pocketsHtml =
          visiblePockets.length === 0
            ? `<div class="muted small" style="padding:8px 0;">${esc(t('allPocketsHiddenMsg'))}</div>`
            : visiblePockets
                .map((p) => {
                  const isPocketActive = String(state.filters.pocketId) === String(p.id);
                  const hufHint = p.currency !== 'HUF' ? `≈ ${formatMoney(p.balance_huf, 'HUF')}` : t('pocketBalHint');
                  return `
                    <div class="pocket-row ${p.is_archived ? 'archived-row' : ''} ${isPocketActive ? 'active-scope' : ''}" data-filter-pocket="${p.id}">
                      <div class="pocket-info">
                        <div class="pocket-name">${esc(p.name)}${p.is_default ? ' <span class="muted small">★</span>' : ''}${p.is_archived ? unusedBadgeHtml : ''}</div>
                        <div class="pocket-meta">${esc(p.currency)} · ${esc(hufHint)}</div>
                      </div>
                      <div class="pocket-right">
                        <div class="pocket-balance ${p.current_balance < 0 ? 'negative' : ''}">${formatMoney(p.current_balance, p.currency)}</div>
                        ${
                          p.is_archived
                            ? `<button type="button" class="btn btn-secondary small" data-restore-pocket="${p.id}" title="${esc(t('btnRestore'))}">${esc(t('btnRestore'))}</button>`
                            : `<button type="button" class="btn btn-secondary small" data-sync-pocket="${p.id}" title="${esc(t('titleSyncPocket'))}">${esc(t('btnSync'))}</button>`
                        }
                        <button type="button" class="btn btn-icon small" data-edit-pocket="${p.id}" title="${esc(t('titleEditPocket'))}">✏️</button>
                      </div>
                    </div>
                  `;
                })
                .join('');

        return `
          <article class="bank-card ${acc.is_archived ? 'archived-card' : ''} ${isAccActive ? 'active-scope' : ''}" data-bank-id="${acc.id}" data-drag-group="bank" data-drag-id="${acc.id}" data-widget-title="${esc(acc.name)}" draggable="${state.editMode ? 'true' : 'false'}">
            <div class="widget-edit-bar" data-edit-chrome="1"></div>
            <div class="bank-header" data-filter-account="${acc.id}" style="cursor:pointer;">
              <div class="bank-title-row">
                <span class="bank-dot" style="background:${esc(acc.color)}"></span>
                <div>
                  <div class="bank-name">${esc(acc.name)}${acc.is_archived ? unusedBadgeHtml : ''}</div>
                  <div class="muted small">${esc(subText)}</div>
                </div>
              </div>
              <div class="bank-total">
                <div class="bank-total-main">${formatMoney(acc.total_balance, acc.currency)}</div>
                ${hasDiffCurrency && !acc.is_archived ? `<div class="muted small">≈ ${formatMoney(acc.total_balance_huf, 'HUF')}</div>` : ''}
              </div>
            </div>
            <div class="pockets-list">${pocketsHtml}</div>
            <div class="bank-footer">
              ${
                acc.is_archived
                  ? `<button type="button" class="btn btn-secondary small" data-restore-bank="${acc.id}">${esc(t('btnRestoreBank'))}</button>
                     <button type="button" class="btn btn-ghost small" data-edit-bank="${acc.id}">${esc(t('btnEditBank'))}</button>`
                  : `<button type="button" class="btn btn-ghost small" data-add-pocket="${acc.id}">${esc(t('btnPlusPocket'))}</button>
                     <button type="button" class="btn btn-ghost small" data-edit-bank="${acc.id}">${esc(t('btnEditBank'))}</button>
                     <button type="button" class="btn btn-ghost small" data-quick-tx-account="${acc.id}">${esc(t('btnQuickLog'))}</button>`
              }
            </div>
          </article>
        `;
      })
      .join('');

    grid.querySelectorAll('[data-filter-account]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.filterAccount;
        if (state.filters.accountId === id && !state.filters.pocketId) {
          state.filters.accountId = '';
        } else {
          state.filters.accountId = id;
          state.filters.pocketId = '';
        }
        state.filters.page = 1;
        refreshDashboard();
      });
    });

    grid.querySelectorAll('[data-filter-pocket]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-sync-pocket]') || e.target.closest('[data-edit-pocket]') || e.target.closest('[data-restore-pocket]')) return;
        const pid = el.dataset.filterPocket;
        if (state.filters.pocketId === pid) {
          state.filters.pocketId = '';
        } else {
          state.filters.pocketId = pid;
          state.filters.accountId = '';
        }
        state.filters.page = 1;
        refreshDashboard();
      });
    });

    grid.querySelectorAll('[data-sync-pocket]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSyncModal(Number(btn.dataset.syncPocket));
      });
    });

    grid.querySelectorAll('[data-restore-pocket]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await setPocketArchived(Number(btn.dataset.restorePocket), false);
      });
    });

    grid.querySelectorAll('[data-restore-bank]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await setAccountArchived(Number(btn.dataset.restoreBank), false);
      });
    });

    grid.querySelectorAll('[data-edit-pocket]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = Number(btn.dataset.editPocket);
        const p = getAllPockets().find((x) => x.id === pid);
        if (p) openPocketModal(p.account_id, p);
      });
    });

    grid.querySelectorAll('[data-add-pocket]').forEach((btn) => {
      btn.addEventListener('click', () => openPocketModal(Number(btn.dataset.addPocket)));
    });

    grid.querySelectorAll('[data-edit-bank]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const acc = state.dashboard.accounts.find((a) => a.id === Number(btn.dataset.editBank));
        if (acc) openBankModal(acc);
      });
    });

    grid.querySelectorAll('[data-quick-tx-account]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const acc = state.dashboard.accounts.find((a) => a.id === Number(btn.dataset.quickTxAccount));
        const activePockets = acc?.pockets?.filter((p) => !p.is_archived) || [];
        const defPocket = activePockets.find((p) => p.is_default)?.id || activePockets[0]?.id;
        openTxModal({ type: 'expense', pocketId: defPocket });
      });
    });
  }

  function renderFilterDropdowns(d) {
    const unusedSuffix = ` (${t('badgeUnused')})`;
    const activeAccounts = d.accounts.filter((a) => !a.is_archived);
    const accSel = document.getElementById('filter-account');
    accSel.innerHTML =
      `<option value="">${esc(t('allBanks'))}</option>` +
      activeAccounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    accSel.value = activeAccounts.some((a) => String(a.id) === String(state.filters.accountId))
      ? state.filters.accountId
      : '';

    const pocketSel = document.getElementById('filter-pocket');
    const visibleBankPockets = getAllPockets().filter(
      (p) => !p.accountArchived && (!state.filters.accountId || String(p.account_id) === String(state.filters.accountId))
    );
    pocketSel.innerHTML =
      `<option value="">${esc(t('allPockets'))}</option>` +
      visibleBankPockets
        .map(
          (p) =>
            `<option value="${p.id}">${esc(p.accountName)} → ${esc(p.name)}${p.is_archived ? esc(unusedSuffix) : ''}</option>`
        )
        .join('');
    if (state.filters.pocketId && visibleBankPockets.some((p) => String(p.id) === String(state.filters.pocketId))) {
      pocketSel.value = state.filters.pocketId;
    } else {
      pocketSel.value = '';
      state.filters.pocketId = '';
    }

    const catSel = document.getElementById('filter-category');
    const typeFilter = state.filters.type;
    const eligibleCats =
      typeFilter && typeFilter !== 'all' && typeFilter !== 'adjustment'
        ? d.categories.filter((c) => c.type === typeFilter)
        : d.categories;
    catSel.innerHTML =
      `<option value="all">${esc(t('allCategories'))}</option>` +
      eligibleCats.map((c) => `<option value="${esc(c.name)}">${esc(tCat(c.name))}</option>`).join('');
    if (state.filters.categoryName !== 'all' && eligibleCats.some((c) => c.name === state.filters.categoryName)) {
      catSel.value = state.filters.categoryName;
    } else {
      catSel.value = 'all';
      state.filters.categoryName = 'all';
    }

    const bulkCatSel = document.getElementById('bulk-category-select');
    if (bulkCatSel) {
      const prevBulkCat = bulkCatSel.value;
      bulkCatSel.innerHTML =
        `<option value="">${esc(t('bulkCatPlaceholder'))}</option>` +
        d.categories.map((c) => `<option value="${c.id}">${esc(tCat(c.name))} (${esc(c.type)})</option>`).join('');
      if (prevBulkCat && Array.from(bulkCatSel.options).some((o) => o.value === prevBulkCat)) {
        bulkCatSel.value = prevBulkCat;
      }
    }
  }

  function syncFilterChipsAndResetUI(d) {
    const fc = d?.filterCounts || {};
    const chipSpecs = [
      { id: 'chip-filter-recurring', countId: 'chip-count-recurring', active: Boolean(state.filters.recurring), count: Number(fc.recurring || 0) },
      { id: 'chip-filter-excluded', countId: 'chip-count-excluded', active: Boolean(state.filters.excludedStats), count: Number(fc.excludedStats || 0) },
      { id: 'chip-filter-receipt', countId: 'chip-count-receipt', active: Boolean(state.filters.hasReceipt), count: Number(fc.hasReceipt || 0) },
      { id: 'chip-filter-notif', countId: 'chip-count-notif', active: state.filters.autoSource === 'notification', count: Number(fc.fromNotif || 0) },
    ];
    for (const c of chipSpecs) {
      const btn = document.getElementById(c.id);
      if (btn) {
        btn.classList.toggle('is-active', c.active);
        btn.setAttribute('aria-pressed', c.active ? 'true' : 'false');
      }
      const badge = document.getElementById(c.countId);
      if (badge) {
        badge.textContent = String(c.count);
        badge.classList.toggle('hidden', c.count === 0);
      }
    }

    const defaultHist = state.layout.hideHistorical ? 'live' : 'all';
    let activeCount = 0;
    if (state.filters.search) activeCount += 1;
    if (state.filters.accountId) activeCount += 1;
    if (state.filters.pocketId) activeCount += 1;
    if (state.filters.type && state.filters.type !== 'all') activeCount += 1;
    if (state.filters.categoryName && state.filters.categoryName !== 'all') activeCount += 1;
    if (state.filters.approval && state.filters.approval !== 'all') activeCount += 1;
    if (state.filters.visibility && state.filters.visibility !== 'visible') activeCount += 1;
    if ((state.filters.historical || 'all') !== defaultHist) activeCount += 1;
    if (state.filters.recurring) activeCount += 1;
    if (state.filters.excludedStats) activeCount += 1;
    if (state.filters.hasReceipt) activeCount += 1;
    if (state.filters.autoSource) activeCount += 1;
    if (state.filters.sort && state.filters.sort !== 'date_desc') activeCount += 1;

    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) {
      resetBtn.classList.toggle('hidden', activeCount === 0);
      resetBtn.textContent = activeCount > 0 ? `${t('btnResetFilters')} (${activeCount})` : t('btnResetFilters');
    }
  }

  function syncLedgerSortHeaders() {
    const sortKey = state.filters.sort || 'date_desc';
    document.querySelectorAll('#ledger-table thead th.th-sortable').forEach((th) => {
      const asc = th.dataset.sortAsc;
      const desc = th.dataset.sortDesc;
      const ind = th.querySelector('.sort-ind');
      const isAsc = sortKey === asc;
      const isDesc = sortKey === desc;
      th.classList.toggle('is-sorted-asc', isAsc);
      th.classList.toggle('is-sorted-desc', isDesc);
      if (ind) {
        ind.textContent = isAsc ? ' ▲' : isDesc ? ' ▼' : '';
      }
    });
  }

  const LEDGER_COL_WIDTHS_KEY = 'mm_ledger_col_widths';

  function getSavedColWidths() {
    try {
      const raw = localStorage.getItem(LEDGER_COL_WIDTHS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveColWidths(widths) {
    try {
      localStorage.setItem(LEDGER_COL_WIDTHS_KEY, JSON.stringify(widths));
    } catch {
      // ignore storage errors
    }
  }

  function syncDynamicContainerWidth() {
    const container = document.getElementById('dashboard-container');
    if (!container) return;
    if (window.innerWidth <= 900) {
      container.classList.remove('is-wide-flush');
      return;
    }
    const tableWrap = document.querySelector('#ledger-section .table-wrap');
    if (!tableWrap) {
      container.classList.remove('is-wide-flush');
      return;
    }
    const overflow = tableWrap.scrollWidth - tableWrap.clientWidth;
    if (overflow > 2) {
      container.classList.add('is-wide-flush');
    } else if (overflow < -28) {
      container.classList.remove('is-wide-flush');
    }
  }

  function syncColAutoSizeUI() {
    const btn = document.getElementById('btn-auto-size-cols');
    if (!btn) return;
    const widths = getSavedColWidths();
    btn.classList.toggle('hidden', Object.keys(widths).length === 0);
  }

  function applyColumnWidth(colKey, widthPx) {
    const table = document.getElementById('ledger-table');
    if (!table || !colKey) return;
    const cells = table.querySelectorAll(`th[data-col-key="${colKey}"], td[data-col-key="${colKey}"]`);
    const valid = Number.isFinite(widthPx) && widthPx >= 48;
    cells.forEach((el) => {
      if (valid) {
        const w = `${Math.round(widthPx)}px`;
        el.style.width = w;
        el.style.minWidth = w;
        el.style.maxWidth = w;
        el.setAttribute('data-col-resized', '1');
      } else {
        el.style.width = '';
        el.style.minWidth = '';
        el.style.maxWidth = '';
        el.removeAttribute('data-col-resized');
      }
    });
    const th = table.querySelector(`thead th[data-col-key="${colKey}"]`);
    if (th) {
      let autoBtn = th.querySelector('.col-auto-btn');
      if (valid && colKey !== 'select') {
        if (!autoBtn) {
          autoBtn = document.createElement('button');
          autoBtn.type = 'button';
          autoBtn.className = 'col-auto-btn';
          autoBtn.setAttribute('data-auto-col-key', colKey);
          autoBtn.textContent = '⤢';
          const resizer = th.querySelector('.col-resizer');
          if (resizer) th.insertBefore(autoBtn, resizer);
          else th.appendChild(autoBtn);
        }
        autoBtn.title = t('titleAutoSizeCol');
      } else if (autoBtn) {
        autoBtn.remove();
      }
    }
  }

  function applyAllSavedColWidths() {
    const table = document.getElementById('ledger-table');
    if (table) {
      table.querySelectorAll('thead th[data-col-key]').forEach((th) => {
        const colKey = th.dataset.colKey;
        if (!colKey) return;
        const widths = getSavedColWidths();
        applyColumnWidth(colKey, widths[colKey] ? Number(widths[colKey]) : null);
      });
    }
    syncColAutoSizeUI();
    requestAnimationFrame(syncDynamicContainerWidth);
  }

  function resetLedgerColumnWidth(colKey) {
    if (!colKey) return;
    const widths = getSavedColWidths();
    delete widths[colKey];
    saveColWidths(widths);
    applyColumnWidth(colKey, null);
    syncColAutoSizeUI();
    requestAnimationFrame(syncDynamicContainerWidth);
  }

  function resetAllLedgerColWidths() {
    saveColWidths({});
    applyAllSavedColWidths();
  }

  function autoFitLedgerColumn(colKey) {
    const table = document.getElementById('ledger-table');
    if (!table || !colKey) return;
    const cells = table.querySelectorAll(`th[data-col-key="${colKey}"], td[data-col-key="${colKey}"]`);
    if (cells.length === 0) return;

    table.classList.add('is-autofit-measuring');
    cells.forEach((el) => {
      el.setAttribute('data-col-autofit-measure', '1');
      el.style.width = '';
      el.style.minWidth = '';
      el.style.maxWidth = '';
    });

    let maxW = 60;
    cells.forEach((el) => {
      const w = Math.max(el.scrollWidth, Math.ceil(el.getBoundingClientRect().width));
      if (w > maxW) maxW = w;
    });

    cells.forEach((el) => el.removeAttribute('data-col-autofit-measure'));
    table.classList.remove('is-autofit-measuring');

    const finalW = Math.max(52, Math.min(720, Math.ceil(maxW + 14)));
    const widths = getSavedColWidths();
    widths[colKey] = finalW;
    saveColWidths(widths);
    applyColumnWidth(colKey, finalW);
    syncColAutoSizeUI();
    requestAnimationFrame(syncDynamicContainerWidth);
  }

  function initLedgerColumnResizer() {
    const table = document.getElementById('ledger-table');
    if (!table) return;
    applyAllSavedColWidths();

    table.querySelector('thead')?.addEventListener('click', (e) => {
      const autoBtn = e.target.closest('[data-auto-col-key]');
      if (!autoBtn) return;
      e.preventDefault();
      e.stopPropagation();
      resetLedgerColumnWidth(autoBtn.dataset.autoColKey);
    });

    document.getElementById('btn-auto-size-cols')?.addEventListener('click', () => {
      resetAllLedgerColWidths();
    });

    const tableWrap = document.querySelector('#ledger-section .table-wrap');
    if (tableWrap && 'ResizeObserver' in window) {
      new ResizeObserver(() => requestAnimationFrame(syncDynamicContainerWidth)).observe(tableWrap);
    }
    window.addEventListener('resize', () => requestAnimationFrame(syncDynamicContainerWidth));

    let activeResize = null;

    table.querySelectorAll('[data-col-resizer]').forEach((handle) => {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const colKey = handle.dataset.colResizer;
        const th = handle.closest('th');
        if (!colKey || !th) return;
        e.preventDefault();
        e.stopPropagation();
        handle.classList.add('is-resizing');
        activeResize = {
          colKey,
          handle,
          startX: e.clientX,
          startW: Math.max(48, Math.round(th.getBoundingClientRect().width)),
          currentW: Math.max(48, Math.round(th.getBoundingClientRect().width)),
        };
      });

      handle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        autoFitLedgerColumn(handle.dataset.colResizer);
      });
    });

    window.addEventListener('pointermove', (e) => {
      if (!activeResize) return;
      const nextW = Math.max(48, Math.min(900, Math.round(activeResize.startW + (e.clientX - activeResize.startX))));
      activeResize.currentW = nextW;
      applyColumnWidth(activeResize.colKey, nextW);
      syncDynamicContainerWidth();
    });

    window.addEventListener('pointerup', () => {
      if (!activeResize) return;
      activeResize.handle.classList.remove('is-resizing');
      const widths = getSavedColWidths();
      widths[activeResize.colKey] = activeResize.currentW;
      saveColWidths(widths);
      syncColAutoSizeUI();
      requestAnimationFrame(syncDynamicContainerWidth);
      activeResize = null;
    });
  }

  function updateBulkSelectionUI(visibleTransactions = []) {
    const ids = (visibleTransactions || []).map((tx) => tx.id);
    const idSet = new Set(ids);
    for (const selId of Array.from(state.selectedTxIds)) {
      if (!idSet.has(selId)) state.selectedTxIds.delete(selId);
    }
    const count = state.selectedTxIds.size;
    const bar = document.getElementById('ledger-bulk-bar');
    const countEl = document.getElementById('ledger-bulk-count');
    if (bar) bar.classList.toggle('hidden', count === 0);
    if (countEl) countEl.textContent = t('bulkSelectedCount', { count });

    const selectAll = document.getElementById('ledger-select-all');
    if (selectAll) {
      selectAll.disabled = ids.length === 0;
      selectAll.checked = ids.length > 0 && count === ids.length;
      selectAll.indeterminate = count > 0 && count < ids.length;
    }
    updateBulkSummaryPill();
  }

  const PRESET_PAGE_SIZES = [10, 15, 25, 50, 100, 250];

  function buildPageNumbers(currentPage, totalPages) {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    if (start > 2) pages.push('...');
    for (let p = start; p <= end; p += 1) pages.push(p);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
  }

  function renderLedgerPagination(d) {
    const bar = document.getElementById('ledger-pagination-bar');
    if (!bar) return;
    const total = Number(d?.totalMatchingTransactions || 0);
    const pageSize = sanitizePageSizeClient(d?.pageSize ?? state.layout.ledgerPageSize, 25);
    const totalPages = Math.max(1, Number(d?.totalPages || Math.ceil(total / pageSize) || 1));
    const page = Math.max(1, Math.min(totalPages, Number(d?.page || state.filters.page || 1)));
    const visibleCount = Array.isArray(d?.transactions) ? d.transactions.length : 0;

    const summaryEl = document.getElementById('ledger-page-summary');
    if (summaryEl) {
      if (total === 0 || visibleCount === 0) {
        summaryEl.textContent = t('pageShowingEmpty');
      } else {
        const start = (page - 1) * pageSize + 1;
        const end = start + visibleCount - 1;
        summaryEl.textContent = t('pageShowing', { start, end, total });
      }
    }

    const controlsEl = document.getElementById('ledger-page-buttons');
    if (controlsEl) {
      const nums = buildPageNumbers(page, totalPages);
      const btns = [
        `<button type="button" class="btn btn-ghost small page-num-btn" data-ledger-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${esc(t('pagePrev'))}</button>`,
        ...nums.map((n) =>
          n === '...'
            ? '<span class="pagination-ellipsis">...</span>'
            : `<button type="button" class="btn btn-ghost small page-num-btn ${n === page ? 'is-active-page' : ''}" data-ledger-page="${n}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`
        ),
        `<button type="button" class="btn btn-ghost small page-num-btn" data-ledger-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>${esc(t('pageNext'))}</button>`,
      ];
      controlsEl.innerHTML = btns.join('');
    }

    const selEl = document.getElementById('ledger-page-size-select');
    const customEl = document.getElementById('ledger-page-size-custom');
    const savedSize = sanitizePageSizeClient(state.layout.ledgerPageSize, pageSize);
    if (selEl && customEl) {
      const isPreset = PRESET_PAGE_SIZES.includes(savedSize);
      selEl.value = isPreset ? String(savedSize) : 'custom';
      customEl.classList.toggle('hidden', isPreset);
      if (!isPreset || document.activeElement !== customEl) {
        customEl.value = String(savedSize);
      }
    }
  }

  function applyLedgerPageSize(rawSize, showFeedback = true) {
    const clean = sanitizePageSizeClient(rawSize, state.layout.ledgerPageSize || 25);
    state.layout.ledgerPageSize = clean;
    state.filters.limit = clean;
    state.filters.page = 1;
    saveLayoutState(true);
    refreshDashboard();
    if (showFeedback) toast(t('toastPageSizeSaved', { count: clean }), 'ok');
  }

  async function executeBulkLedgerAction(action, extra = {}) {
    const ids = Array.from(state.selectedTxIds);
    if (ids.length === 0) return;
    if (action === 'delete' && !window.confirm(t('confirmBulkDelete', { count: ids.length }))) {
      return;
    }
    try {
      const res = await api('/api/transactions/bulk', {
        method: 'POST',
        body: { ids, action, ...extra },
      });
      if (action === 'delete') {
        state.selectedTxIds.clear();
        state.lastClickedTxId = null;
      }
      await refreshDashboard();
      if (action === 'delete' && Array.isArray(res.trashIds) && res.trashIds.length > 0) {
        const trashIds = res.trashIds;
        toast(t('toastBulkDone', { count: res.affectedCount ?? ids.length }), 'ok', {
          actionLabel: t('btnUndo'),
          durationMs: 8500,
          onAction: () => restoreTrashIds(trashIds),
        });
      } else {
        toast(t('toastBulkDone', { count: res.affectedCount ?? ids.length }), 'ok');
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function renderLedgerTable(transactions, totalMatching) {
    const tbody = document.getElementById('ledger-tbody');
    const emptyEl = document.getElementById('ledger-empty');
    document.getElementById('ledger-count').textContent = t('txCount', { count: totalMatching });

    if (!transactions || transactions.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      updateBulkSelectionUI([]);
      applyAllSavedColWidths();
      return;
    }
    emptyEl.classList.add('hidden');
    updateBulkSelectionUI(transactions);

    tbody.innerHTML = transactions
      .map((tx) => {
        const signedAmt =
          tx.type === 'income'
            ? formatMoney(tx.amount, tx.currency, true)
            : tx.type === 'expense'
            ? formatMoney(-tx.amount, tx.currency)
            : tx.type === 'transfer'
            ? `⇄ ${formatMoney(tx.amount, tx.currency)}`
            : `= ${formatMoney(tx.amount, tx.currency)}`;

        const amtClass = tx.type === 'income' ? 'positive' : tx.type === 'expense' ? 'negative' : '';

        const typeBadge =
          tx.type === 'income'
            ? `<span class="badge-type badge-type-in">${esc(t('badgeIn'))}</span>`
            : tx.type === 'transfer'
            ? `<span class="badge-type badge-type-transfer">${esc(t('badgeTransfer'))}</span>`
            : tx.type === 'adjustment'
            ? `<span class="badge-type badge-type-sync">${esc(t('badgeSync'))}</span>`
            : `<span class="badge-type badge-type-out">${esc(t('badgeOut'))}</span>`;

        const pocketRoute =
          tx.type === 'transfer' && tx.dest_pocket_name
            ? `${esc(tx.account_name)} · ${esc(tx.pocket_name)} ⇄ ${esc(tx.dest_account_name)} · ${esc(tx.dest_pocket_name)}`
            : tx.type === 'income'
            ? `${esc(tx.merchant || t('kpiIncomeLabel'))} → ${esc(tx.account_name)} · ${esc(tx.pocket_name)}`
            : `${esc(tx.account_name)} · ${esc(tx.pocket_name)} → ${esc(tx.merchant || tCat(tx.category_name))}`;

        let pocketBalBeforeHtml = '<span class="muted">-</span>';
        if (tx.type === 'transfer') {
          const srcBefore =
            tx.pocket_balance_before !== null && tx.pocket_balance_before !== undefined
              ? `<span class="bal-before-pill">${formatMoney(tx.pocket_balance_before, tx.currency)}</span>`
              : '<span class="muted">-</span>';
          const dstBefore =
            tx.dest_pocket_balance_before !== null && tx.dest_pocket_balance_before !== undefined
              ? `<div class="small muted">→ ${formatMoney(tx.dest_pocket_balance_before, tx.dest_pocket_currency || tx.currency)}</div>`
              : '';
          pocketBalBeforeHtml = `${srcBefore}${dstBefore}`;
        } else if (tx.pocket_balance_before !== null && tx.pocket_balance_before !== undefined) {
          pocketBalBeforeHtml = `<span class="bal-before-pill">${formatMoney(tx.pocket_balance_before, tx.currency)}</span>`;
        }

        let pocketBalHtml = '<span class="muted">-</span>';
        if (tx.type === 'transfer') {
          const srcPart =
            tx.pocket_balance_after !== null && tx.pocket_balance_after !== undefined
              ? `<span class="bal-after-pill">${formatMoney(tx.pocket_balance_after, tx.currency)}</span>`
              : '<span class="muted">-</span>';
          const dstPart =
            tx.dest_pocket_balance_after !== null && tx.dest_pocket_balance_after !== undefined
              ? `<div class="small muted">→ ${formatMoney(tx.dest_pocket_balance_after, tx.dest_pocket_currency || tx.currency)}</div>`
              : '';
          pocketBalHtml = `${srcPart}${dstPart}`;
        } else if (tx.pocket_balance_after !== null && tx.pocket_balance_after !== undefined) {
          pocketBalHtml = `<span class="bal-after-pill">${formatMoney(tx.pocket_balance_after, tx.currency)}</span>`;
        }

        const accBalBeforeHtml =
          tx.account_balance_before !== null && tx.account_balance_before !== undefined
            ? `<span class="account-before-text">${formatMoney(tx.account_balance_before, tx.account_currency || 'HUF')}</span>`
            : '<span class="muted">-</span>';

        const accBalHtml =
          tx.account_balance_after !== null && tx.account_balance_after !== undefined
            ? `<span class="account-after-text">${formatMoney(tx.account_balance_after, tx.account_currency || 'HUF')}</span>`
            : '<span class="muted">-</span>';

        const noteBadge =
          tx.note_source === 'auto'
            ? `<span class="badge-note-src badge-auto">${esc(t('badgeAuto'))}</span>`
            : tx.note_source === 'import'
            ? `<span class="badge-note-src badge-import">${esc(t('badgeSheet'))}</span>`
            : `<span class="badge-note-src badge-manual">${esc(t('badgeManual'))}</span>`;

        const histBadge = tx.is_historical ? `<span class="badge-historical">${esc(t('badgeHistory'))}</span>` : '';
        const notifBadge = tx.auto_source === 'notification' ? `<span class="badge-notif-src">📲 ${esc(t('badgeFromNotif'))}</span>` : '';
        const approvalBadge = tx.needs_approval ? `<span class="badge-needs-approval">⏳ ${esc(t('badgeNeedsApproval'))}</span>` : '';
        const recurringBadge = tx.is_recurring ? `<span class="badge-prop-recurring">🔁 ${esc(t('badgeRecurring'))}</span>` : '';
        const hiddenBadge = tx.is_hidden ? `<span class="badge-hidden-tx">👁️ ${esc(t('badgeHiddenTx'))}</span>` : '';
        const isAdjustment = tx.type === 'adjustment';
        const isSelected = state.selectedTxIds.has(tx.id);
        const title = tx.merchant ? esc(tx.merchant) : esc(tCat(tx.category_name));

        const rowClasses = [
          tx.needs_approval ? 'row-needs-approval' : '',
          tx.is_hidden ? 'row-hidden-tx' : '',
          isSelected ? 'row-selected' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return `
          <tr data-tx-id="${tx.id}" class="${rowClasses}">
            <td class="col-select" data-col-key="select">
              <input type="checkbox" data-select-tx="${tx.id}" ${isSelected ? 'checked' : ''} aria-label="Select transaction" />
            </td>
            <td data-col-key="date">
              <div class="tx-merchant">${typeBadge}${notifBadge}${title}${approvalBadge}${recurringBadge}${hiddenBadge}${histBadge}</div>
              <div class="tx-date">${esc(tx.date.replace('T', ' '))}</div>
            </td>
            <td data-col-key="flow"><span class="pill" style="border-left:3px solid ${esc(tx.account_color)}">${pocketRoute}</span></td>
            <td data-col-key="category"><span class="pill">${esc(tCat(tx.category_name))}</span></td>
            <td class="note-cell" data-col-key="note">
              ${noteBadge}
              <span class="note-clickable" data-edit-note="${tx.id}" title="${esc(t('titleEditNote'))}">${esc(tx.note)}</span>
            </td>
            <td class="num ${amtClass}" data-col-key="amount"><strong>${signedAmt}</strong></td>
            <td class="num" data-col-key="pocketBefore">${pocketBalBeforeHtml}</td>
            <td class="num" data-col-key="pocketAfter">${pocketBalHtml}</td>
            <td class="num" data-col-key="bankBefore">${accBalBeforeHtml}</td>
            <td class="num" data-col-key="bankAfter">${accBalHtml}</td>
            <td data-col-key="actions">
              <div class="row-actions">
                ${!isAdjustment ? `<label class="tx-analytics-toggle ${tx.exclude_from_analytics ? 'is-excluded' : ''}" title="${esc(t('titleExcludeAnalytics'))}"><input type="checkbox" data-toggle-exclude-analytics="${tx.id}" ${tx.exclude_from_analytics ? 'checked' : ''} /><span>${esc(t('excludeAnalyticsShort'))}</span></label>` : ''}
                ${tx.needs_approval ? `<button type="button" class="btn btn-approve-row small" data-approve-tx="${tx.id}" title="${esc(t('titleApproveTx'))}">✓ ${esc(t('btnApproveShort'))}</button>` : ''}
                ${tx.receipt_path ? `<button type="button" class="btn btn-icon small" data-view-receipt="${tx.id}" title="${esc(t('titleViewReceipt'))}">🧾</button>` : !isAdjustment ? `<button type="button" class="btn btn-icon small" data-attach-receipt="${tx.id}" title="${esc(t('titleAttachReceipt'))}">📷</button>` : ''}
                ${!isAdjustment ? `<button type="button" class="btn btn-icon small" data-dup-tx="${tx.id}" title="${esc(t('titleDuplicateTx'))}">📋</button>` : ''}
                <button type="button" class="btn btn-icon small" data-edit-tx="${tx.id}" title="${esc(t('titleEditTx'))}">✏️</button>
                <button type="button" class="btn btn-icon small" data-del-tx="${tx.id}" title="${esc(t('titleDeleteTx'))}">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    const applyTxRowSelection = (id, checked, shiftKey) => {
      const visibleIds = transactions.map((tItem) => tItem.id);
      if (shiftKey && state.lastClickedTxId !== null && visibleIds.includes(state.lastClickedTxId)) {
        const idxA = visibleIds.indexOf(state.lastClickedTxId);
        const idxB = visibleIds.indexOf(id);
        if (idxA !== -1 && idxB !== -1) {
          const [start, end] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
          for (let i = start; i <= end; i += 1) {
            const targetId = visibleIds[i];
            if (checked) state.selectedTxIds.add(targetId);
            else state.selectedTxIds.delete(targetId);
            const box = tbody.querySelector(`[data-select-tx="${targetId}"]`);
            if (box) box.checked = checked;
            const trEl = tbody.querySelector(`tr[data-tx-id="${targetId}"]`);
            if (trEl) trEl.classList.toggle('row-selected', checked);
          }
        }
      } else {
        if (checked) state.selectedTxIds.add(id);
        else state.selectedTxIds.delete(id);
        const box = tbody.querySelector(`[data-select-tx="${id}"]`);
        if (box) box.checked = checked;
        const trEl = tbody.querySelector(`tr[data-tx-id="${id}"]`);
        if (trEl) trEl.classList.toggle('row-selected', checked);
      }
      state.lastClickedTxId = id;
      updateBulkSelectionUI(transactions);
      renderAnalyticsAndKpis();
    };

    tbody.querySelectorAll('[data-select-tx]').forEach((chk) => {
      chk.addEventListener('click', (e) => {
        applyTxRowSelection(Number(chk.dataset.selectTx), chk.checked, e.shiftKey);
      });
    });

    tbody.querySelectorAll('tr[data-tx-id]').forEach((trEl) => {
      trEl.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input, select, textarea, label, [data-edit-note]')) return;
        const selText = window.getSelection ? window.getSelection().toString() : '';
        if (selText) return;
        const id = Number(trEl.dataset.txId);
        applyTxRowSelection(id, !state.selectedTxIds.has(id), e.shiftKey);
      });
    });

    tbody.querySelectorAll('[data-approve-tx]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.approveTx);
        try {
          await api(`/api/transactions/${id}/approve`, { method: 'POST' });
          await refreshDashboard();
          toast(t('toastTxApproved'), 'ok');
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });

    tbody.querySelectorAll('[data-edit-tx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tx = state.dashboard.transactions.find((tItem) => tItem.id === Number(btn.dataset.editTx));
        if (tx) openTxModal(tx, true);
      });
    });

    tbody.querySelectorAll('[data-dup-tx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tx = state.dashboard.transactions.find((tItem) => tItem.id === Number(btn.dataset.dupTx));
        if (tx && tx.type !== 'adjustment') openDuplicateTxModal(tx);
      });
    });

    tbody.querySelectorAll('[data-edit-note]').forEach((el) => {
      el.addEventListener('click', () => {
        const tx = state.dashboard.transactions.find((tItem) => tItem.id === Number(el.dataset.editNote));
        if (tx) openNoteModal(tx);
      });
    });

    tbody.querySelectorAll('[data-attach-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tx = state.dashboard.transactions.find((tItem) => tItem.id === Number(btn.dataset.attachReceipt));
        if (tx && activeReceiptUI) activeReceiptUI.openScanner({ attachTx: tx });
      });
    });

    tbody.querySelectorAll('[data-del-tx]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.delTx);
        if (!window.confirm(t('confirmDeleteTx'))) return;
        try {
          const res = await api(`/api/transactions/${id}`, { method: 'DELETE' });
          await refreshDashboard();
          if (res.trashId) {
            toast(t('toastTxDeleted'), 'ok', {
              actionLabel: t('btnUndo'),
              durationMs: 8500,
              onAction: () => restoreTrashIds([res.trashId]),
            });
          } else {
            toast(t('toastTxDeleted'), 'ok');
          }
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });

    tbody.querySelectorAll('[data-toggle-exclude-analytics]').forEach((chk) => {
      chk.addEventListener('change', async () => {
        const id = Number(chk.dataset.toggleExcludeAnalytics);
        try {
          await api(`/api/transactions/${id}`, {
            method: 'PATCH',
            body: { excludeFromAnalytics: chk.checked },
          });
          await refreshDashboard();
          toast(chk.checked ? t('toastExcludedFromAnalytics') : t('toastIncludedInAnalytics'), 'ok');
        } catch (err) {
          chk.checked = !chk.checked;
          toast(err.message, 'err');
        }
      });
    });

    tbody.querySelectorAll('[data-view-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tx = state.dashboard.transactions.find((tItem) => tItem.id === Number(btn.dataset.viewReceipt));
        if (tx) openReceiptViewModal(tx);
      });
    });

    applyAllSavedColWidths();
  }

  function createInteractiveImageViewer({
    stageEl,
    imgEl,
    zoomOutBtn,
    zoomResetBtn,
    zoomInBtn,
    rotateLeftBtn,
    rotateRightBtn,
    fullscreenBtn,
    downloadEl,
    onOpenFullscreen,
  }) {
    if (!stageEl || !imgEl) return null;
    const v = {
      scale: 1,
      x: 0,
      y: 0,
      rotate: 0,
      dragging: false,
      startX: 0,
      startY: 0,
      origX: 0,
      origY: 0,
      pinchDist: 0,
      pinchScale: 1,
      moved: false,
    };

    const clampScale = (s) => Math.max(0.5, Math.min(5, Math.round(s * 100) / 100));

    function applyTransform() {
      imgEl.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale}) rotate(${v.rotate}deg)`;
      if (zoomResetBtn) {
        zoomResetBtn.textContent = `${Math.round(v.scale * 100)}%`;
      }
      stageEl.classList.toggle('is-zoomed', v.scale > 1.02 || v.x !== 0 || v.y !== 0);
    }

    function resetView() {
      v.scale = 1;
      v.x = 0;
      v.y = 0;
      v.rotate = 0;
      applyTransform();
    }

    function setSrc(src, stateOverride = null) {
      imgEl.src = src || '';
      if (downloadEl) {
        if (src) {
          downloadEl.href = src;
          const baseName = decodeURIComponent(String(src).split('/').pop().split('?')[0] || 'receipt');
          downloadEl.download = baseName.startsWith('data:') ? 'receipt.jpg' : baseName;
        } else {
          downloadEl.removeAttribute('href');
        }
      }
      if (stateOverride) {
        v.scale = clampScale(stateOverride.scale || 1);
        v.x = Number(stateOverride.x || 0);
        v.y = Number(stateOverride.y || 0);
        v.rotate = Number(stateOverride.rotate || 0);
        applyTransform();
      } else {
        resetView();
      }
    }

    function zoomTo(nextScale, clientX = null, clientY = null) {
      const target = clampScale(nextScale);
      if (clientX !== null && clientY !== null && target > 1) {
        const rect = stageEl.getBoundingClientRect();
        const cx = clientX - (rect.left + rect.width / 2);
        const cy = clientY - (rect.top + rect.height / 2);
        const factor = target / v.scale;
        v.x = Math.round((v.x - cx * (factor - 1)) * 10) / 10;
        v.y = Math.round((v.y - cy * (factor - 1)) * 10) / 10;
      } else if (target <= 1) {
        v.x = 0;
        v.y = 0;
      }
      v.scale = target;
      applyTransform();
    }

    zoomInBtn?.addEventListener('click', () => zoomTo(v.scale + 0.35));
    zoomOutBtn?.addEventListener('click', () => zoomTo(v.scale - 0.35));
    zoomResetBtn?.addEventListener('click', resetView);
    rotateLeftBtn?.addEventListener('click', () => {
      v.rotate -= 90;
      applyTransform();
    });
    rotateRightBtn?.addEventListener('click', () => {
      v.rotate += 90;
      applyTransform();
    });
    fullscreenBtn?.addEventListener('click', () => {
      if (typeof onOpenFullscreen === 'function' && imgEl.src) {
        onOpenFullscreen(imgEl.src, { scale: v.scale, x: v.x, y: v.y, rotate: v.rotate });
      }
    });

    stageEl.addEventListener(
      'wheel',
      (e) => {
        if (!imgEl.src) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomTo(v.scale * factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    stageEl.addEventListener('dblclick', (e) => {
      if (!imgEl.src) return;
      if (v.scale > 1.05) {
        zoomTo(1);
      } else {
        zoomTo(2.2, e.clientX, e.clientY);
      }
    });

    stageEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !imgEl.src) return;
      v.dragging = true;
      v.moved = false;
      v.startX = e.clientX;
      v.startY = e.clientY;
      v.origX = v.x;
      v.origY = v.y;
      stageEl.classList.add('is-dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (!v.dragging) return;
      const dx = e.clientX - v.startX;
      const dy = e.clientY - v.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) v.moved = true;
      v.x = v.origX + dx;
      v.y = v.origY + dy;
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (!v.dragging) return;
      v.dragging = false;
      stageEl.classList.remove('is-dragging');
    });

    const touchDist = (t0, t1) => Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    stageEl.addEventListener(
      'touchstart',
      (e) => {
        if (!imgEl.src) return;
        if (e.touches.length === 2) {
          v.dragging = false;
          v.pinchDist = touchDist(e.touches[0], e.touches[1]);
          v.pinchScale = v.scale;
        } else if (e.touches.length === 1) {
          v.dragging = true;
          v.moved = false;
          v.startX = e.touches[0].clientX;
          v.startY = e.touches[0].clientY;
          v.origX = v.x;
          v.origY = v.y;
          stageEl.classList.add('is-dragging');
        }
      },
      { passive: true }
    );

    stageEl.addEventListener(
      'touchmove',
      (e) => {
        if (!imgEl.src) return;
        if (e.touches.length === 2 && v.pinchDist > 0) {
          e.preventDefault();
          const dist = touchDist(e.touches[0], e.touches[1]);
          zoomTo(v.pinchScale * (dist / v.pinchDist));
        } else if (e.touches.length === 1 && v.dragging) {
          e.preventDefault();
          const dx = e.touches[0].clientX - v.startX;
          const dy = e.touches[0].clientY - v.startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) v.moved = true;
          v.x = v.origX + dx;
          v.y = v.origY + dy;
          applyTransform();
        }
      },
      { passive: false }
    );

    stageEl.addEventListener('touchend', () => {
      v.dragging = false;
      v.pinchDist = 0;
      stageEl.classList.remove('is-dragging');
    });

    return {
      setSrc,
      resetView,
      zoomBy: (delta) => zoomTo(v.scale + delta),
      rotateBy: (deg) => {
        v.rotate += deg;
        applyTransform();
      },
      getState: () => ({ scale: v.scale, x: v.x, y: v.y, rotate: v.rotate }),
    };
  }

  let receiptInlineViewer = null;
  let receiptLightboxViewer = null;

  function ensureImageViewersInitialized() {
    if (!receiptLightboxViewer && document.getElementById('lb-stage')) {
      receiptLightboxViewer = createInteractiveImageViewer({
        stageEl: document.getElementById('lb-stage'),
        imgEl: document.getElementById('lb-img'),
        zoomOutBtn: document.getElementById('lb-zoom-out'),
        zoomResetBtn: document.getElementById('lb-zoom-reset'),
        zoomInBtn: document.getElementById('lb-zoom-in'),
        rotateLeftBtn: document.getElementById('lb-rotate-left'),
        rotateRightBtn: document.getElementById('lb-rotate-right'),
        downloadEl: document.getElementById('lb-download-btn'),
      });
    }
    if (!receiptInlineViewer && document.getElementById('rv-stage')) {
      receiptInlineViewer = createInteractiveImageViewer({
        stageEl: document.getElementById('rv-stage'),
        imgEl: document.getElementById('rv-img'),
        zoomOutBtn: document.getElementById('rv-zoom-out'),
        zoomResetBtn: document.getElementById('rv-zoom-reset'),
        zoomInBtn: document.getElementById('rv-zoom-in'),
        rotateLeftBtn: document.getElementById('rv-rotate-left'),
        rotateRightBtn: document.getElementById('rv-rotate-right'),
        fullscreenBtn: document.getElementById('rv-fullscreen-btn'),
        downloadEl: document.getElementById('rv-download-btn'),
        onOpenFullscreen: (src, viewState) => {
          openImageLightbox(src, document.getElementById('rv-title')?.textContent || t('receiptViewTitle'), viewState);
        },
      });
    }
  }

  function openImageLightbox(src, title = '', initialState = null) {
    if (!src) return;
    ensureImageViewersInitialized();
    const lbModal = document.getElementById('image-lightbox-modal');
    const lbTitle = document.getElementById('lb-title');
    if (lbTitle) lbTitle.textContent = title || t('receiptViewTitle');
    receiptLightboxViewer?.setSrc(src, initialState);
    lbModal?.showModal();
  }

  function openReceiptViewModal(tx) {
    currentViewingReceiptTx = tx;
    ensureImageViewersInitialized();
    const titleText = t('receiptTitlePrefix', {
      name: tx.merchant || tCat(tx.category_name),
    });
    document.getElementById('rv-title').textContent = titleText;
    const imgSrc = `api/receipts/file/${encodeURIComponent(tx.receipt_path)}`;
    if (receiptInlineViewer) {
      receiptInlineViewer.setSrc(imgSrc);
    } else {
      document.getElementById('rv-img').src = imgSrc;
    }
    document.getElementById('rv-meta').textContent = `${tx.date} · ${tx.account_name} (${tx.pocket_name}) · ${formatMoney(tx.amount, tx.currency)}`;
    const rvAddressEl = document.getElementById('rv-address');
    if (rvAddressEl) {
      const addr = String(tx.store_address || '').trim();
      rvAddressEl.textContent = addr ? t('receiptAddressLine', { address: addr }) : '';
      rvAddressEl.classList.toggle('hidden', !addr);
    }
    document.getElementById('rv-note').textContent = tx.note;
    let items = [];
    try {
      items = JSON.parse(tx.items_json || '[]');
    } catch {
      items = [];
    }
    const ul = document.getElementById('rv-items');
    ul.innerHTML = items.length
      ? items.map((it) => `<li>${esc(it.name)} × ${it.qty || 1}: ${Number(it.price || 0).toLocaleString()}</li>`).join('')
      : `<li class="muted">${esc(t('noItemizedLines'))}</li>`;
    document.getElementById('receipt-view-modal').showModal();
  }

  function openNoteModal(tx) {
    currentNoteModalTx = tx;
    document.getElementById('note-tx-id').value = String(tx.id);
    document.getElementById('note-modal-sub').textContent = `${tx.merchant || tCat(tx.category_name)} · ${formatMoney(tx.amount, tx.currency)} · ${String(tx.date || '').replace('T', ' ')}`;
    document.getElementById('note-modal-input').value = tx.note || '';

    const itemsHint = document.getElementById('note-modal-items-hint');
    let items = [];
    try {
      items = JSON.parse(tx.items_json || '[]');
    } catch {
      items = [];
    }
    const storeAddr = String(tx.store_address || '').trim();
    if (itemsHint) {
      if (items.length > 0 || storeAddr) {
        const itemText = items.map((it) => `${esc(it.name)} × ${it.qty || 1}`).join(', ');
        const addrLine = storeAddr ? `<div><em>${esc(t('receiptAddressLine', { address: storeAddr }))}</em></div>` : '';
        itemsHint.innerHTML =
          `<strong>${esc(t('extractedItemsHeader'))}</strong><br>` +
          (itemText || '') +
          addrLine;
        itemsHint.classList.remove('hidden');
      } else {
        itemsHint.classList.add('hidden');
      }
    }
    document.getElementById('note-modal').showModal();
  }

  // -------------------- TRANSACTION MODAL (SEPARATE ORIGIN & DESTINATION + FILTERABLE COMBOBOX) --------------------
  const txFlowState = {
    origMode: 'pocket', // 'pocket' | 'external'
    destMode: 'external', // 'external' | 'pocket'
  };

  function normText(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function populateAccountSelect(selectEl, preferredAccountId = null, preserveAccountId = null) {
    const presIdNum = preserveAccountId ? Number(preserveAccountId) : null;
    const unusedSuffix = ` (${t('badgeUnused')})`;
    const accounts = (state.dashboard?.accounts || []).filter(
      (acc) => (!acc.is_archived && acc.pockets.some((p) => !p.is_archived)) || (presIdNum && acc.id === presIdNum)
    );
    selectEl.innerHTML = accounts
      .map((a) => `<option value="${a.id}">${esc(a.name)}${a.is_archived ? esc(unusedSuffix) : ''}</option>`)
      .join('');
    if (preferredAccountId && Array.from(selectEl.options).some((o) => o.value === String(preferredAccountId))) {
      selectEl.value = String(preferredAccountId);
    }
  }

  function populatePocketsForAccount(accountSelectEl, pocketSelectEl, preferredPocketId = null, preservePocketId = null) {
    const accId = Number(accountSelectEl.value);
    const presIdNum = preservePocketId ? Number(preservePocketId) : null;
    const acc = (state.dashboard?.accounts || []).find((a) => a.id === accId);
    const pockets = (acc?.pockets || []).filter((p) => !p.is_archived || (presIdNum && p.id === presIdNum));
    pocketSelectEl.innerHTML = pockets
      .map(
        (p) =>
          `<option value="${p.id}" data-currency="${esc(p.currency)}">${esc(p.name)} (${esc(p.currency)})${p.is_archived ? ` [${esc(t('badgeUnused'))}]` : ''}</option>`
      )
      .join('');
    if (preferredPocketId && pockets.some((p) => p.id === Number(preferredPocketId))) {
      pocketSelectEl.value = String(preferredPocketId);
    } else {
      const def = pockets.find((p) => p.is_default === 1) || pockets[0];
      if (def) pocketSelectEl.value = String(def.id);
    }
  }

  function setAccountAndPocket(accountSelectEl, pocketSelectEl, pocketId, allowArchived = false) {
    const active = getActivePockets();
    const all = getAllPockets();
    const requested = pocketId ? all.find((p) => p.id === Number(pocketId)) : null;
    const target =
      requested && (allowArchived || (!requested.is_archived && !requested.accountArchived))
        ? requested
        : active[0] || all[0];
    if (!target) return;
    const preserveThis = allowArchived && (target.is_archived || target.accountArchived);
    populateAccountSelect(accountSelectEl, target.account_id, preserveThis ? target.account_id : null);
    populatePocketsForAccount(accountSelectEl, pocketSelectEl, target.id, preserveThis ? target.id : null);
  }

  function syncCurrencyFromActivePocket() {
    const type = document.getElementById('tx-type').value;
    const activeSel =
      type === 'income'
        ? document.getElementById('tx-dest-pocket')
        : document.getElementById('tx-orig-pocket');
    const opt = activeSel.options[activeSel.selectedIndex];
    if (opt?.dataset?.currency) {
      document.getElementById('tx-currency').value = opt.dataset.currency;
    }
  }

  function syncFlowFromModes(preserveCategory = false) {
    let type = 'expense';
    if (txFlowState.origMode === 'external' && txFlowState.destMode === 'pocket') {
      type = 'income';
    } else if (txFlowState.origMode === 'pocket' && txFlowState.destMode === 'pocket') {
      type = 'transfer';
    }

    const prevType = document.getElementById('tx-type').value;
    const prevCat = document.getElementById('tx-category').value;
    document.getElementById('tx-type').value = type;

    document.querySelectorAll('#tx-modal .type-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.txType === type);
    });

    document.getElementById('orig-mode-pocket').classList.toggle('active', txFlowState.origMode === 'pocket');
    document.getElementById('orig-mode-external').classList.toggle('active', txFlowState.origMode === 'external');
    document.getElementById('orig-pocket-box').classList.toggle('hidden', txFlowState.origMode !== 'pocket');
    document.getElementById('orig-external-box').classList.toggle('hidden', txFlowState.origMode !== 'external');

    document.getElementById('dest-mode-external').classList.toggle('active', txFlowState.destMode === 'external');
    document.getElementById('dest-mode-pocket').classList.toggle('active', txFlowState.destMode === 'pocket');
    document.getElementById('dest-external-box').classList.toggle('hidden', txFlowState.destMode !== 'external');
    document.getElementById('dest-pocket-box').classList.toggle('hidden', txFlowState.destMode !== 'pocket');

    document.getElementById('tx-dest-amount-wrap').classList.toggle('hidden', type !== 'transfer');

    populateCategorySelect(document.getElementById('tx-category'), type);
    if (preserveCategory && prevType === type && prevCat) {
      document.getElementById('tx-category').value = prevCat;
    }
    syncCurrencyFromActivePocket();
  }

  function setTxTypeTab(type) {
    if (type === 'income') {
      txFlowState.origMode = 'external';
      txFlowState.destMode = 'pocket';
    } else if (type === 'transfer') {
      txFlowState.origMode = 'pocket';
      txFlowState.destMode = 'pocket';
    } else {
      txFlowState.origMode = 'pocket';
      txFlowState.destMode = 'external';
    }
    syncFlowFromModes(false);
  }

  function snapshotExternalInputState(el) {
    return {
      value: el ? el.value : '',
      forceNew: el?.dataset.forceNew || '',
      userEdited: el?.dataset.userEdited || '',
    };
  }

  function restoreExternalInputState(el, saved) {
    if (!el) return;
    el.value = saved.value;
    if (saved.forceNew) el.dataset.forceNew = saved.forceNew;
    else delete el.dataset.forceNew;
    if (saved.userEdited) el.dataset.userEdited = saved.userEdited;
    else delete el.dataset.userEdited;
  }

  /**
   * Flips Origin and Destination selections, modes, and cross-FX transfer amounts in #tx-modal.
   */
  function swapTxFlowSides() {
    const isEdit = Boolean(document.getElementById('tx-id')?.value);
    const origAccSel = document.getElementById('tx-orig-account');
    const origPocketSel = document.getElementById('tx-orig-pocket');
    const destAccSel = document.getElementById('tx-dest-account');
    const destPocketSel = document.getElementById('tx-dest-pocket');
    const origExtInput = document.getElementById('tx-orig-external-input');
    const destExtInput = document.getElementById('tx-dest-external-input');

    const prevOrigMode = txFlowState.origMode;
    const prevDestMode = txFlowState.destMode;
    const prevOrigPocketId = origPocketSel?.value || null;
    const prevDestPocketId = destPocketSel?.value || null;
    const prevOrigExt = snapshotExternalInputState(origExtInput);
    const prevDestExt = snapshotExternalInputState(destExtInput);
    const sameType = prevOrigMode === prevDestMode;

    txFlowState.origMode = prevDestMode;
    txFlowState.destMode = prevOrigMode;

    setAccountAndPocket(origAccSel, origPocketSel, prevDestPocketId, isEdit);
    setAccountAndPocket(destAccSel, destPocketSel, prevOrigPocketId, isEdit);
    restoreExternalInputState(origExtInput, prevDestExt);
    restoreExternalInputState(destExtInput, prevOrigExt);

    if (prevOrigMode === 'pocket' && prevDestMode === 'pocket') {
      const amountEl = document.getElementById('tx-amount');
      const destAmountEl = document.getElementById('tx-dest-amount');
      if (amountEl && destAmountEl && amountEl.value.trim() && destAmountEl.value.trim()) {
        const tmp = amountEl.value;
        amountEl.value = destAmountEl.value;
        destAmountEl.value = tmp;
      }
    }

    document.getElementById('tx-orig-external-list')?.classList.add('hidden');
    document.getElementById('tx-dest-external-list')?.classList.add('hidden');

    if (!sameType) {
      const txCatSel = document.getElementById('tx-category');
      if (txCatSel) delete txCatSel.dataset.userPicked;
    }

    syncFlowFromModes(sameType);

    const swapBtn = document.getElementById('tx-flow-swap-btn');
    if (swapBtn) {
      swapBtn.classList.remove('is-swapping');
      void swapBtn.offsetWidth;
      swapBtn.classList.add('is-swapping');
    }
  }

  const CLIENT_CORP_NOISE = new Set([
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

  const CLIENT_DESC_TOKENS = new Set([
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

  function cleanClientMerchant(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = s.replace(/^(?:CRV|CURVE|SUMUP|SQ|PAYPAL|PP|BARION|SIMPLEPAY|SIMPLE|GOPAY|VPOS|OTP\s*MOBIL|NYX)\s*\*\s*/i, '');
    s = s.replace(/^(?:sikeresen\s+)?(?:vasaroltal|vásároltál|fizettel|fizettél|koltottel|költöttél)\s+a(?:\(z\)|z)?\s+/i, '');
    s = s.replace(/\s+\d{3,}\s+ONKISZ(?:OLG[AÁ]L[OÓ])?\b.*$/i, '');
    s = s.replace(/\s+ONKISZ(?:OLG[AÁ]L[OÓ])?\b.*$/i, '');
    const trailingDigits = /^([A-Za-zÀ-ž0-9.&'/\- ]{2,}?)\s+#?\d{4,}$/.exec(s);
    if (trailingDigits && /[A-Za-zÀ-ž]{2,}/.test(trailingDigits[1])) {
      s = trailingDigits[1];
    }
    return s.replace(/^[.,;:\-\s]+|[.,;:\-\s]+$/g, '').trim();
  }

  function clientLevenshtein(a, b) {
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

  function analyzeClientCounterparty(raw) {
    const cleaned = cleanClientMerchant(raw);
    const lower = String(cleaned || '').trim().toLowerCase();
    const hasSlash = /\//.test(cleaned);
    const norm = normText(cleaned).replace(/['’`]/g, '');
    const allTokens = norm.split(/[^a-z0-9]+/g).filter(Boolean);
    const filteredBrand = allTokens.filter((tok) => !CLIENT_CORP_NOISE.has(tok) && !/^\d{3,}$/.test(tok));
    const brandTokens = filteredBrand.length > 0 ? filteredBrand : allTokens;
    const filteredCore = brandTokens.filter((tok) => !CLIENT_DESC_TOKENS.has(tok));
    const coreTokens = filteredCore.length > 0 ? filteredCore : brandTokens;
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
      sortedBrand: [...brandTokens].sort().join(' '),
      sortedCore: [...coreTokens].sort().join(' '),
      compactBrand: brandTokens.join(''),
      compactCore: coreTokens.join(''),
    };
  }

  function scoreClientCounterparty(query, candidateName) {
    if (!query || !candidateName) return 0;
    const qRaw = String(query).trim().toLowerCase();
    const cRaw = String(candidateName).trim().toLowerCase();
    if (qRaw && cRaw && qRaw === cRaw) return 1.0;

    const a = analyzeClientCounterparty(query);
    const b = analyzeClientCounterparty(candidateName);
    if (!a.allTokens.length || !b.allTokens.length) return 0;

    if (a.lower && a.lower === b.lower) return 0.995;
    if (a.normFull && a.normFull === b.normFull) return 0.99;

    const slashMismatch = a.hasSlash !== b.hasSlash;
    if (!slashMismatch) {
      const tokenLenPenalty = Math.min(0.03, Math.abs(a.allTokens.length - b.allTokens.length) * 0.01);
      if (a.brandStr && a.brandStr === b.brandStr) return 0.96 - tokenLenPenalty;
      if (a.compactBrand && a.compactBrand === b.compactBrand) return 0.95 - tokenLenPenalty;
      if (a.coreStr && a.coreStr === b.coreStr) return 0.93 - tokenLenPenalty;
      if (a.compactCore && a.compactCore === b.compactCore && a.compactCore.length >= 4) return 0.92 - tokenLenPenalty;
      if (a.brandTokens.length >= 2 && a.sortedBrand === b.sortedBrand) return 0.94;
      if (a.coreTokens.length >= 2 && a.sortedCore === b.sortedCore) return 0.92;

      if (a.coreTokens.length === 1 && b.coreTokens.length === 1) {
        const tA = a.coreTokens[0];
        const tB = b.coreTokens[0];
        if (!/\d/.test(tA) && !/\d/.test(tB)) {
          const minLen = Math.min(tA.length, tB.length);
          const maxLen = Math.max(tA.length, tB.length);
          if (minLen >= 6) {
            const dist = clientLevenshtein(tA, tB);
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

    let score = 0;
    if (matchedCount > 0) {
      const coverage = matchedCount / Math.max(a.coreTokens.length, b.coreTokens.length);
      if (slashMismatch) {
        score = Math.min(0.68, 0.5 + 0.18 * coverage);
      } else if (coverage >= 0.75) {
        score = 0.74 + 0.14 * coverage;
      } else {
        score = 0.55 * coverage;
      }
    }

    const normQ = normText(query);
    const normC = normText(candidateName);
    if (normQ && normC.includes(normQ)) {
      const floor = b.hasSlash && !a.hasSlash ? Math.min(0.62, score || 0.62) : 0.62;
      score = Math.max(score, floor);
    }
    return score;
  }

  function findBestClientCounterpartyMatch(query, direction) {
    const items = state.dashboard?.counterparties?.[direction] || [];
    const trimmed = String(query || '').trim();
    if (!trimmed) {
      return {
        matches: items.slice(0, 40).map((cp) => ({ cp, score: 0 })),
        topMatch: null,
      };
    }

    const qMeta = analyzeClientCounterparty(trimmed);
    const scored = [];
    for (const cp of items) {
      const score = scoreClientCounterparty(trimmed, cp.name);
      if (score >= 0.45) {
        const cpMeta = analyzeClientCounterparty(cp.name);
        scored.push({
          cp,
          score,
          hasSlash: cpMeta.hasSlash,
          tokenDiff: Math.abs(qMeta.allTokens.length - cpMeta.allTokens.length),
        });
      }
    }

    scored.sort((x, y) => {
      if (Math.abs(y.score - x.score) > 0.005) return y.score - x.score;
      if (x.hasSlash !== y.hasSlash) return x.hasSlash ? 1 : -1;
      if (x.tokenDiff !== y.tokenDiff) return x.tokenDiff - y.tokenDiff;
      const useDiff = Number(y.cp.use_count || 0) - Number(x.cp.use_count || 0);
      if (useDiff !== 0) return useDiff;
      return String(y.cp.last_used_at || '').localeCompare(String(x.cp.last_used_at || ''));
    });

    return {
      matches: scored.slice(0, 40),
      topMatch: scored[0] || null,
    };
  }

  function applyCounterpartyDefaultCategory(catId, force = true) {
    if (!catId) return;
    const catSel = document.getElementById('tx-category');
    if (!catSel) return;
    if (!force && catSel.dataset.userPicked === '1') return;
    if (Array.from(catSel.options).some((o) => o.value === String(catId))) {
      catSel.value = String(catId);
    }
  }

  function renderCounterpartyCombobox(direction, inputId, listId) {
    const input = document.getElementById(inputId);
    const listEl = document.getElementById(listId);
    if (!input || !listEl) return;

    const query = input.value || '';
    const trimmed = query.trim();
    const { matches, topMatch } = findBestClientCounterpartyMatch(query, direction);
    const exactExists = Boolean(trimmed && topMatch && topMatch.score >= 0.99);
    const hasStrongMatch = Boolean(trimmed && topMatch && topMatch.score >= 0.78);

    const renderRow = ({ cp, score }, idx) => {
      const isTopClosest = Boolean(hasStrongMatch && idx === 0);
      let badgeHtml = '';
      if (isTopClosest) {
        const badgeText = score >= 0.99 ? t('comboExactMatch') : t('comboClosestMatch');
        badgeHtml = `<span class="combobox-match-badge">${esc(badgeText)}</span>`;
      } else if (trimmed && score >= 0.72) {
        badgeHtml = `<span class="combobox-match-badge is-similar">${esc(t('comboSimilarMatch'))}</span>`;
      }
      return `
        <div class="combobox-item${isTopClosest ? ' is-closest-match' : ''}" data-cp-id="${cp.id}" data-cp-name="${esc(cp.name)}" data-cp-cat="${cp.default_category_id || ''}">
          <div class="combobox-item-main">
            <span class="combobox-item-name">${esc(cp.name)}</span>
            ${badgeHtml}
            ${cp.default_category_name ? `<span class="combobox-item-cat">${esc(tCat(cp.default_category_name))}</span>` : ''}
          </div>
          <div style="display:flex;gap:2px;flex-shrink:0;">
            <button type="button" class="combo-del-btn" data-cp-edit="${cp.id}" title="${esc(t('titleEditPrediction'))}">✏️</button>
            <button type="button" class="combo-del-btn" data-cp-del="${cp.id}" title="${esc(t('titleDelPrediction'))}">🗑️</button>
          </div>
        </div>
      `;
    };

    let html = '';
    if (!trimmed) {
      html = matches.map(renderRow).join('');
    } else if (hasStrongMatch) {
      html = matches.map(renderRow).join('');
      if (!exactExists) {
        html += `<div class="combobox-add-hint" data-cp-add-new="1">${esc(t('comboCreateNewSeparate', { name: trimmed }))}</div>`;
      }
    } else {
      html += `<div class="combobox-add-hint is-recommended-new" data-cp-add-new="1">${esc(t('comboRecommendNew', { name: trimmed }))}</div>`;
      html += matches.map(renderRow).join('');
    }

    if (!html) {
      html = `<div class="combobox-add-hint muted">${esc(t('comboEmptyHint'))}</div>`;
    }

    listEl.innerHTML = html;

    listEl.querySelectorAll('[data-cp-edit]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cpId = Number(btn.dataset.cpEdit);
        const cpObj = (state.dashboard?.counterparties?.[direction] || []).find((x) => x.id === cpId);
        if (cpObj) {
          listEl.classList.add('hidden');
          openCounterpartyEditModal(cpObj, { direction, inputId, listId });
        }
      });
    });

    listEl.querySelectorAll('[data-cp-del]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cpId = Number(btn.dataset.cpDel);
        try {
          const res = await api(`/api/counterparties/${cpId}?historical=${encodeURIComponent(state.filters.historical || 'all')}`, { method: 'DELETE' });
          if (state.dashboard) state.dashboard.counterparties = res.counterparties;
          renderCounterpartyCombobox(direction, inputId, listId);
          refreshAllCounterpartyManagers();
          listEl.classList.remove('hidden');
          input.focus();
          toast(t('toastPredictionRemoved'), 'ok');
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });

    listEl.querySelectorAll('.combobox-item').forEach((row) => {
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-cp-del]') || e.target.closest('[data-cp-edit]')) return;
        delete input.dataset.forceNew;
        input.dataset.userEdited = '1';
        input.value = row.dataset.cpName || '';
        applyCounterpartyDefaultCategory(row.dataset.cpCat, true);
        listEl.classList.add('hidden');
      });
    });

    listEl.querySelectorAll('[data-cp-add-new]').forEach((hint) => {
      hint.addEventListener('mousedown', (e) => e.preventDefault());
      hint.addEventListener('click', () => {
        input.dataset.forceNew = '1';
        listEl.classList.add('hidden');
      });
    });
  }

  function setupCounterpartyCombobox(direction, inputId, listId) {
    const input = document.getElementById(inputId);
    const listEl = document.getElementById(listId);
    if (!input || !listEl) return;

    const openAndFilter = () => {
      renderCounterpartyCombobox(direction, inputId, listId);
      listEl.classList.remove('hidden');
    };

    input.addEventListener('focus', openAndFilter);
    input.addEventListener('input', () => {
      delete input.dataset.forceNew;
      input.dataset.userEdited = '1';
      openAndFilter();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        listEl.classList.add('hidden');
        return;
      }
      if (e.key === 'Enter' && !listEl.classList.contains('hidden') && input.dataset.forceNew !== '1') {
        const { topMatch } = findBestClientCounterpartyMatch(input.value, direction);
        if (topMatch && topMatch.score >= 0.78) {
          e.preventDefault();
          input.value = topMatch.cp.name;
          applyCounterpartyDefaultCategory(topMatch.cp.default_category_id, false);
          listEl.classList.add('hidden');
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${listId}`)) {
        listEl.classList.add('hidden');
      }
    });
  }

  function openTxModal(preset = {}, isEdit = false, opts = {}) {
    const isDuplicate = Boolean(opts?.isDuplicate);
    currentEditingTxObj = isEdit ? preset : null;
    const hideEditActions = !isEdit || preset.type === 'adjustment';
    document.getElementById('tx-attach-receipt-btn')?.classList.toggle('hidden', hideEditActions);
    document.getElementById('tx-duplicate-btn')?.classList.toggle('hidden', hideEditActions);
    const modal = document.getElementById('tx-modal');
    document.getElementById('tx-modal-title').textContent = isEdit
      ? t('txModalEdit')
      : isDuplicate
      ? t('txModalDuplicate')
      : t('txModalAdd');
    document.getElementById('tx-id').value = isEdit ? String(preset.id) : '';

    const type = preset.type && preset.type !== 'adjustment' ? preset.type : 'expense';
    const origAccSel = document.getElementById('tx-orig-account');
    const origPocketSel = document.getElementById('tx-orig-pocket');
    const destAccSel = document.getElementById('tx-dest-account');
    const destPocketSel = document.getElementById('tx-dest-pocket');

    const preferredPocketId = preset.pocket_id || preset.pocketId || state.filters.pocketId;
    setAccountAndPocket(origAccSel, origPocketSel, preferredPocketId, isEdit);
    setAccountAndPocket(destAccSel, destPocketSel, preset.dest_pocket_id || preset.destPocketId || preferredPocketId, isEdit);

    // For transfers without preset destPocketId, pick a different active pocket by default
    if (type === 'transfer' && !preset.dest_pocket_id && !preset.destPocketId) {
      const all = getActivePockets();
      const alt = all.find((p) => p.id !== Number(origPocketSel.value));
      if (alt) setAccountAndPocket(destAccSel, destPocketSel, alt.id, isEdit);
    }

    setTxTypeTab(type);

    const origExtInput = document.getElementById('tx-orig-external-input');
    const destExtInput = document.getElementById('tx-dest-external-input');
    const txCatSel = document.getElementById('tx-category');
    delete origExtInput.dataset.forceNew;
    delete origExtInput.dataset.userEdited;
    delete destExtInput.dataset.forceNew;
    delete destExtInput.dataset.userEdited;
    if (txCatSel) delete txCatSel.dataset.userPicked;

    if (type === 'income') {
      setAccountAndPocket(destAccSel, destPocketSel, preferredPocketId, isEdit);
      origExtInput.value = preset.merchant || '';
      destExtInput.value = '';
    } else if (type === 'expense') {
      destExtInput.value = preset.merchant || '';
      origExtInput.value = '';
    } else {
      origExtInput.value = '';
      destExtInput.value = '';
    }

    document.getElementById('tx-orig-external-list').classList.add('hidden');
    document.getElementById('tx-dest-external-list').classList.add('hidden');

    const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const presetDate = preset.date ? (preset.date.length === 10 ? `${preset.date}T12:00` : preset.date.slice(0, 16)) : nowLocal;
    document.getElementById('tx-date').value = presetDate;
    document.getElementById('tx-amount').value = preset.amount ? String(preset.amount) : '';

    if (preset.currency) {
      document.getElementById('tx-currency').value = preset.currency;
    } else {
      syncCurrencyFromActivePocket();
    }

    if ((preset.category_id || preset.categoryId) && txCatSel) {
      txCatSel.value = String(preset.category_id || preset.categoryId);
      if (isEdit || isDuplicate) txCatSel.dataset.userPicked = '1';
    }
    document.getElementById('tx-dest-amount').value = preset.dest_amount ? String(preset.dest_amount) : '';
    document.getElementById('tx-note').value = isEdit || isDuplicate ? preset.note || '' : '';
    const exclChk = document.getElementById('tx-exclude-analytics');
    if (exclChk) exclChk.checked = isEdit ? Boolean(preset.exclude_from_analytics) : Boolean(preset.excludeFromAnalytics);
    const recChk = document.getElementById('tx-recurring');
    if (recChk) recChk.checked = isEdit ? Boolean(preset.is_recurring) : Boolean(preset.isRecurring);
    const histChk = document.getElementById('tx-historical');
    if (histChk) histChk.checked = isEdit ? Boolean(preset.is_historical) : Boolean(preset.isHistorical || preset.is_historical);

    if (!modal.open) modal.showModal();
  }

  /**
   * Opens #tx-modal pre-filled as a new transaction copied from an existing ledger item.
   */
  function openDuplicateTxModal(tx) {
    if (!tx || tx.type === 'adjustment') return;
    openTxModal(
      {
        type: tx.type,
        pocketId: tx.pocket_id,
        destPocketId: tx.dest_pocket_id || null,
        merchant: tx.merchant || '',
        amount: tx.amount,
        currency: tx.currency,
        dest_amount: tx.dest_amount || null,
        categoryId: tx.category_id,
        note: tx.note_source === 'manual' ? tx.note || '' : '',
        excludeFromAnalytics: Boolean(tx.exclude_from_analytics),
        isRecurring: Boolean(tx.is_recurring),
        isHistorical: Boolean(tx.is_historical),
      },
      false,
      { isDuplicate: true }
    );
  }

  // -------------------- POCKET / SYNC / BANK / MANAGE MODALS --------------------
  async function setPocketArchived(pocketId, isArchived) {
    try {
      await api(`/api/pockets/${pocketId}`, { method: 'PATCH', body: { isArchived } });
      await refreshDashboard();
      refreshAllEntityManagers();
      toast(isArchived ? t('toastPocketHidden') : t('toastPocketRestored'), 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function setAccountArchived(accountId, isArchived) {
    try {
      await api(`/api/accounts/${accountId}`, { method: 'PATCH', body: { isArchived } });
      if (isArchived) {
        if (String(state.filters.accountId) === String(accountId)) state.filters.accountId = '';
        const hiddenAcc = state.dashboard?.accounts?.find((a) => a.id === Number(accountId));
        if (hiddenAcc && hiddenAcc.pockets?.some((p) => String(p.id) === String(state.filters.pocketId))) {
          state.filters.pocketId = '';
        }
      }
      await refreshDashboard();
      refreshAllEntityManagers();
      toast(isArchived ? t('toastBankHidden') : t('toastBankRestored'), 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function executeEntityDelete(kind, id, choice, modalId) {
    const kindLabel = kind === 'pocket' ? t('kindPocket') : t('kindBank');
    const endpoint = kind === 'pocket' ? `/api/pockets/${id}` : `/api/accounts/${id}`;
    let payload = { action: 'archive' };
    let msg = t('confirmArchive', { kind: kindLabel.toLowerCase() });
    let doneToast = t('toastHiddenDone', { kind: kindLabel });

    if (choice && choice.startsWith('move:')) {
      payload = { action: 'move', moveToPocketId: Number(choice.slice(5)) };
      msg = t('confirmMoveDelete', { kind: kindLabel.toLowerCase() });
      doneToast = t('toastMovedDone', { kind: kindLabel });
    } else if (choice === 'purge') {
      payload = { action: 'purge' };
      msg = kind === 'pocket' ? t('confirmPurgePocket') : t('confirmPurgeBank');
      doneToast = t('toastPurgedDone', { kind: kindLabel });
    }

    if (!window.confirm(msg)) return;
    try {
      await api(endpoint, { method: 'DELETE', body: payload });
      document.getElementById(modalId).close();
      await refreshDashboard();
      refreshAllEntityManagers();
      toast(doneToast, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function openPocketModal(accountId, pocketObj = null) {
    const isEdit = Boolean(pocketObj);
    document.getElementById('pocket-modal-title').textContent = isEdit
      ? t('editPocketTitle', { name: pocketObj.name })
      : t('addPocket');
    document.getElementById('pm-save-btn').textContent = isEdit ? t('savePocket') : t('createPocket');
    document.getElementById('pm-pocket-id').value = isEdit ? String(pocketObj.id) : '';
    document.getElementById('pm-account-id').value = String(accountId);
    document.getElementById('pm-name').value = isEdit ? pocketObj.name : '';
    document.getElementById('pm-currency').value = isEdit ? pocketObj.currency : 'HUF';
    document.getElementById('pm-initial').value = isEdit ? String(pocketObj.initial_balance ?? 0) : '0';
    document.getElementById('pm-color').value = isEdit ? pocketObj.color || '#6366f1' : '#6366f1';
    document.getElementById('pm-default').checked = isEdit ? Boolean(pocketObj.is_default) : false;
    document.getElementById('pm-archived-wrap').classList.toggle('hidden', !isEdit);
    document.getElementById('pm-archived').checked = isEdit ? Boolean(pocketObj.is_archived) : false;

    const dangerZone = document.getElementById('pm-danger-zone');
    const moveSel = document.getElementById('pm-delete-move');
    if (isEdit) {
      const others = getActivePockets().filter((p) => p.id !== pocketObj.id);
      moveSel.innerHTML =
        `<option value="archive">${esc(t('optArchive'))}</option>` +
        others
          .map(
            (p) =>
              `<option value="move:${p.id}">${esc(t('optMovePocket', { account: p.accountName, pocket: p.name }))}</option>`
          )
          .join('') +
        `<option value="purge">${esc(t('optPurgePocket'))}</option>`;
      dangerZone.classList.remove('hidden');
    } else {
      dangerZone.classList.add('hidden');
    }

    document.getElementById('pocket-modal').showModal();
  }

  function openBankModal(accountObj = null) {
    const isEdit = Boolean(accountObj);
    document.getElementById('bank-modal-title').textContent = isEdit
      ? t('editBankTitle', { name: accountObj.name })
      : t('addBank');
    document.getElementById('bm-save-btn').textContent = isEdit ? t('saveBank') : t('createBank');
    document.getElementById('bm-account-id').value = isEdit ? String(accountObj.id) : '';
    document.getElementById('bm-name').value = isEdit ? accountObj.name : '';
    document.getElementById('bm-currency').value = isEdit ? accountObj.currency : 'HUF';
    document.getElementById('bm-initial').value = '0';
    document.getElementById('bm-color').value = isEdit ? accountObj.color || '#0ea5e9' : '#0ea5e9';
    document.getElementById('bm-initial-wrap').classList.toggle('hidden', isEdit);
    document.getElementById('bm-archived-wrap').classList.toggle('hidden', !isEdit);
    document.getElementById('bm-archived').checked = isEdit ? Boolean(accountObj.is_archived) : false;

    const dangerZone = document.getElementById('bm-danger-zone');
    const moveSel = document.getElementById('bm-delete-move');
    if (isEdit) {
      const otherPockets = getActivePockets().filter((p) => p.account_id !== accountObj.id);
      moveSel.innerHTML =
        `<option value="archive">${esc(t('optArchive'))}</option>` +
        otherPockets
          .map(
            (p) =>
              `<option value="move:${p.id}">${esc(t('optMoveBank', { account: p.accountName, pocket: p.name }))}</option>`
          )
          .join('') +
        `<option value="purge">${esc(t('optPurgeBank'))}</option>`;
      dangerZone.classList.remove('hidden');
    } else {
      dangerZone.classList.add('hidden');
    }

    document.getElementById('bank-modal').showModal();
  }

  const cpManagerStates = new WeakMap();
  let cpmPrevTouched = false;
  let activeCpEditContext = null;

  function openCounterpartyEditModal(cp, comboCtx = null) {
    if (!cp) return;
    activeCpEditContext = comboCtx || null;
    cpmPrevTouched = false;

    const modal = document.getElementById('cp-edit-modal');
    if (!modal) return;

    const isOrigin = cp.direction === 'in';
    document.getElementById('cp-edit-modal-title').textContent = isOrigin
      ? t('editOriginTitle')
      : t('editDestinationTitle');
    document.getElementById('cpm-id').value = String(cp.id);
    document.getElementById('cpm-direction').value = cp.direction;
    document.getElementById('cpm-old-name').value = cp.name || '';
    const txCount = Number(cp.tx_count || 0);
    document.getElementById('cpm-tx-count').value = String(txCount);
    document.getElementById('cpm-name').value = cp.name || '';

    const catType = isOrigin ? 'income' : 'expense';
    const cats = (state.dashboard?.categories || []).filter((c) => c.type === catType);
    const catSel = document.getElementById('cpm-category');
    catSel.innerHTML =
      `<option value="">${esc(t('noDefaultCat'))}</option>` +
      cats.map((c) => `<option value="${c.id}">${esc(tCat(c.name))}</option>`).join('');
    catSel.value = cp.default_category_id ? String(cp.default_category_id) : '';

    const prevChk = document.getElementById('cpm-update-prev');
    prevChk.checked = false;
    document.getElementById('cpm-update-prev-label').textContent = t('cpUpdatePrevCountLabel', { count: txCount });

    modal.showModal();
  }

  function refreshAllCounterpartyManagers() {
    const settingsPanel = document.getElementById('settings-recipients-panel');
    if (settingsPanel && settingsPanel.innerHTML.trim()) {
      renderCounterpartyManager(settingsPanel);
    }
    const managePanel = document.getElementById('manage-cp-panel');
    if (managePanel) {
      renderCounterpartyManager(managePanel);
    }
  }

  function renderCounterpartyManager(containerEl) {
    if (!containerEl) return;
    let st = cpManagerStates.get(containerEl);
    if (!st) {
      st = { dir: 'out', search: '' };
      cpManagerStates.set(containerEl, st);
    }
    const cps = state.dashboard?.counterparties || { in: [], out: [] };
    const outCount = (cps.out || []).length;
    const inCount = (cps.in || []).length;
    const catType = st.dir === 'in' ? 'income' : 'expense';
    const cats = (state.dashboard?.categories || []).filter((c) => c.type === catType);
    const catOptionsHtml =
      `<option value="">${esc(t('noDefaultCat'))}</option>` +
      cats.map((c) => `<option value="${c.id}">${esc(tCat(c.name))}</option>`).join('');

    containerEl.innerHTML = `
      <h4 style="margin:0 0 4px;">${esc(t('manageSavedPredictions'))}</h4>
      <p class="muted small" style="margin:0 0 10px;">${esc(t('managePredictionsNoteSafe'))}</p>
      <div class="cp-mgr-tabs" role="tablist">
        <button type="button" class="btn small cp-mgr-tab ${st.dir === 'out' ? 'active' : ''}" data-cp-tab="out">${esc(t('savedDestinationsPanel'))} (<span data-cp-count="out">${outCount}</span>)</button>
        <button type="button" class="btn small cp-mgr-tab ${st.dir === 'in' ? 'active' : ''}" data-cp-tab="in">${esc(t('savedOriginsPanel'))} (<span data-cp-count="in">${inCount}</span>)</button>
      </div>
      <div class="cp-mgr-controls">
        <input type="text" data-cp-search placeholder="${esc(t('phSearchRecipients'))}" value="${esc(st.search)}" />
        <div class="cp-mgr-add-row">
          <input type="text" data-cp-add-name placeholder="${esc(st.dir === 'in' ? t('phAddOrigin') : t('phAddDest'))}" />
          <select data-cp-add-cat aria-label="${esc(t('categoryLabel'))}">${catOptionsHtml}</select>
          <button type="button" class="btn btn-secondary small" data-cp-add-btn>${esc(t('btnAddShort'))}</button>
        </div>
      </div>
      <div class="manage-list cp-mgr-rows" style="max-height:240px;"></div>
    `;

    const rowsEl = containerEl.querySelector('.cp-mgr-rows');
    const searchEl = containerEl.querySelector('[data-cp-search]');
    const addInpEl = containerEl.querySelector('[data-cp-add-name]');
    const addCatEl = containerEl.querySelector('[data-cp-add-cat]');
    const addBtnEl = containerEl.querySelector('[data-cp-add-btn]');

    const renderRows = () => {
      const latestCps = state.dashboard?.counterparties || { in: [], out: [] };
      const list = latestCps[st.dir] || [];
      const outSpan = containerEl.querySelector('[data-cp-count="out"]');
      const inSpan = containerEl.querySelector('[data-cp-count="in"]');
      if (outSpan) outSpan.textContent = String((latestCps.out || []).length);
      if (inSpan) inSpan.textContent = String((latestCps.in || []).length);

      const nq = normText(st.search);
      const filtered = nq
        ? list.filter(
            (cp) =>
              normText(cp.name).includes(nq) ||
              (cp.default_category_name && normText(tCat(cp.default_category_name)).includes(nq))
          )
        : list;

      if (filtered.length === 0) {
        rowsEl.innerHTML = `<div class="muted small" style="padding:8px 4px;">${esc(t('noMatchingPredictions'))}</div>`;
        return;
      }

      rowsEl.innerHTML = filtered
        .map(
          (cp) => `
            <div class="manage-row">
              <div class="cp-mgr-row-info">
                <span>${esc(cp.name)}</span>
                ${cp.default_category_name ? `<span class="cp-mgr-badge">${esc(tCat(cp.default_category_name))}</span>` : ''}
                ${Number(cp.use_count || 0) > 1 ? `<span class="cp-mgr-badge">×${Number(cp.use_count)}</span>` : ''}
              </div>
              <div style="display:flex;gap:4px;">
                <button type="button" class="btn btn-ghost small" data-cp-mgr-edit="${cp.id}" title="${esc(t('titleEditPrediction'))}">✏️</button>
                <button type="button" class="combo-del-btn" data-cp-mgr-del="${cp.id}" title="${esc(t('titleDelPrediction'))}">🗑️</button>
              </div>
            </div>
          `
        )
        .join('');

      rowsEl.querySelectorAll('[data-cp-mgr-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cpId = Number(btn.dataset.cpMgrEdit);
          const cpObj = (state.dashboard?.counterparties?.[st.dir] || []).find((x) => x.id === cpId);
          if (cpObj) openCounterpartyEditModal(cpObj);
        });
      });

      rowsEl.querySelectorAll('[data-cp-mgr-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const res = await api(
              `/api/counterparties/${Number(btn.dataset.cpMgrDel)}?historical=${encodeURIComponent(state.filters.historical || 'all')}`,
              { method: 'DELETE' }
            );
            state.dashboard.counterparties = res.counterparties;
            renderRows();
            // Sync any sibling manager panel (e.g. Manage Modal vs Settings)
            const other =
              containerEl.id === 'settings-recipients-panel'
                ? document.getElementById('manage-cp-panel')
                : document.getElementById('settings-recipients-panel');
            if (other && other.innerHTML.trim()) renderCounterpartyManager(other);
            toast(t('toastPredictionRemoved'), 'ok');
          } catch (err) {
            toast(err.message, 'err');
          }
        });
      });
    };

    renderRows();

    containerEl.querySelectorAll('[data-cp-tab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        st.dir = tabBtn.dataset.cpTab === 'in' ? 'in' : 'out';
        renderCounterpartyManager(containerEl);
      });
    });

    searchEl?.addEventListener('input', () => {
      st.search = searchEl.value || '';
      renderRows();
    });

    const handleAdd = async () => {
      const name = addInpEl?.value.trim();
      if (!name) return;
      const categoryId = addCatEl?.value ? Number(addCatEl.value) : null;
      try {
        const res = await api(
          `/api/counterparties?historical=${encodeURIComponent(state.filters.historical || 'all')}`,
          { method: 'POST', body: { name, direction: st.dir, categoryId } }
        );
        state.dashboard.counterparties = res.counterparties;
        if (addInpEl) addInpEl.value = '';
        renderRows();
        const other =
          containerEl.id === 'settings-recipients-panel'
            ? document.getElementById('manage-cp-panel')
            : document.getElementById('settings-recipients-panel');
        if (other && other.innerHTML.trim()) renderCounterpartyManager(other);
        toast(t('toastAddedPrediction', { name }), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    };

    addBtnEl?.addEventListener('click', handleAdd);
    addInpEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAdd();
      }
    });
  }

  const catManagerStates = new WeakMap();

  function renderCategoriesManager(containerEl) {
    if (!containerEl) return;
    let st = catManagerStates.get(containerEl);
    if (!st) {
      st = { type: 'expense', search: '' };
      catManagerStates.set(containerEl, st);
    }

    const allCats = state.dashboard?.categories || [];
    const countOf = (tp) => allCats.filter((c) => c.type === tp).length;

    containerEl.innerHTML = `
      <h4 style="margin:0 0 4px;">${esc(t('manageCategoriesTitle'))}</h4>
      <p class="muted small" style="margin:0 0 10px;">${esc(t('manageCategoriesSub'))}</p>
      <div class="cp-mgr-tabs" role="tablist">
        <button type="button" class="btn small cp-mgr-tab ${st.type === 'expense' ? 'active' : ''}" data-cat-tab="expense">${esc(t('catTabExpense'))} (<span data-cat-count="expense">${countOf('expense')}</span>)</button>
        <button type="button" class="btn small cp-mgr-tab ${st.type === 'income' ? 'active' : ''}" data-cat-tab="income">${esc(t('catTabIncome'))} (<span data-cat-count="income">${countOf('income')}</span>)</button>
        <button type="button" class="btn small cp-mgr-tab ${st.type === 'transfer' ? 'active' : ''}" data-cat-tab="transfer">${esc(t('catTabTransfer'))} (<span data-cat-count="transfer">${countOf('transfer')}</span>)</button>
      </div>
      <div class="cp-mgr-controls">
        <input type="text" data-cat-search placeholder="${esc(t('phSearchCategories'))}" value="${esc(st.search)}" />
        <div class="cp-mgr-add-row">
          <input type="text" data-cat-add-name placeholder="${esc(t('phAddCategory'))}" />
          <input type="color" class="cat-mgr-color" data-cat-add-color value="#6366f1" aria-label="${esc(t('brandColor'))}" />
          <button type="button" class="btn btn-secondary small" data-cat-add-btn>${esc(t('btnAddShort'))}</button>
        </div>
      </div>
      <div class="manage-list cat-mgr-rows" style="max-height:240px;"></div>
    `;

    const rowsEl = containerEl.querySelector('.cat-mgr-rows');
    const searchEl = containerEl.querySelector('[data-cat-search]');
    const addNameEl = containerEl.querySelector('[data-cat-add-name]');
    const addColorEl = containerEl.querySelector('[data-cat-add-color]');
    const addBtnEl = containerEl.querySelector('[data-cat-add-btn]');

    const renderRows = () => {
      const latestCats = state.dashboard?.categories || [];
      ['expense', 'income', 'transfer'].forEach((tp) => {
        const sp = containerEl.querySelector(`[data-cat-count="${tp}"]`);
        if (sp) sp.textContent = String(latestCats.filter((c) => c.type === tp).length);
      });

      const sameType = latestCats.filter((c) => c.type === st.type);
      const nq = normText(st.search);
      const filtered = nq
        ? sameType.filter((c) => normText(c.name).includes(nq) || normText(tCat(c.name)).includes(nq))
        : sameType;

      if (filtered.length === 0) {
        rowsEl.innerHTML = `<div class="muted small" style="padding:8px 4px;">${esc(t('noMatchingCategories'))}</div>`;
        return;
      }

      const disableDelete = sameType.length <= 1;
      rowsEl.innerHTML = filtered
        .map((c) => {
          const disp = tCat(c.name);
          const rawDiff = disp && disp !== c.name ? ` <span class="muted small">(${esc(c.name)})</span>` : '';
          return `
            <div class="manage-row">
              <div class="cp-mgr-row-info">
                <input type="color" class="cat-mgr-color" data-cat-color="${c.id}" value="${esc(c.color || '#6366f1')}" aria-label="${esc(c.name)}" />
                <span>${esc(disp)}${rawDiff}</span>
              </div>
              <div style="display:flex;gap:4px;">
                <button type="button" class="btn btn-ghost small" data-cat-rename="${c.id}" title="${esc(t('btnEditShort'))}">✏️</button>
                <button type="button" class="combo-del-btn" data-cat-del="${c.id}" ${disableDelete ? 'disabled' : ''} title="${esc(t('titleDelPrediction'))}">🗑️</button>
              </div>
            </div>
          `;
        })
        .join('');

      rowsEl.querySelectorAll('[data-cat-color]').forEach((colorInp) => {
        colorInp.addEventListener('change', async () => {
          try {
            await api(`/api/categories/${Number(colorInp.dataset.catColor)}`, {
              method: 'PATCH',
              body: { color: colorInp.value },
            });
            await refreshDashboard();
            renderRows();
            toast(t('toastCatUpdated'), 'ok');
          } catch (err) {
            toast(err.message, 'err');
          }
        });
      });

      rowsEl.querySelectorAll('[data-cat-rename]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.catRename);
          const catObj = (state.dashboard?.categories || []).find((x) => x.id === id);
          if (!catObj) return;
          const nextName = window.prompt(t('promptRenameCategory'), catObj.name);
          if (!nextName || !nextName.trim() || nextName.trim() === catObj.name) return;
          try {
            await api(`/api/categories/${id}`, {
              method: 'PATCH',
              body: { name: nextName.trim() },
            });
            await refreshDashboard();
            renderRows();
            refreshAllCounterpartyManagers();
            toast(t('toastCatUpdated'), 'ok');
          } catch (err) {
            toast(err.message, 'err');
          }
        });
      });

      rowsEl.querySelectorAll('[data-cat-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.catDel);
          try {
            await api(`/api/categories/${id}`, { method: 'DELETE' });
            await refreshDashboard();
            renderRows();
            refreshAllCounterpartyManagers();
            toast(t('toastCatDeleted'), 'ok');
          } catch (err) {
            toast(err.message, 'err');
          }
        });
      });
    };

    renderRows();

    containerEl.querySelectorAll('[data-cat-tab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        st.type = tabBtn.dataset.catTab;
        renderCategoriesManager(containerEl);
      });
    });

    searchEl?.addEventListener('input', () => {
      st.search = searchEl.value || '';
      renderRows();
    });

    const handleAddCat = async () => {
      const name = addNameEl?.value.trim();
      if (!name) return;
      try {
        await api('/api/categories', {
          method: 'POST',
          body: {
            name,
            type: st.type,
            color: addColorEl?.value || '#6366f1',
          },
        });
        if (addNameEl) addNameEl.value = '';
        await refreshDashboard();
        renderRows();
        refreshAllCounterpartyManagers();
        toast(t('toastCustomCatAdded'), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    };

    addBtnEl?.addEventListener('click', handleAddCat);
    addNameEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddCat();
      }
    });
  }

  function refreshAllEntityManagers() {
    refreshAllCounterpartyManagers();
    const settingsOpen = document.getElementById('settings-modal')?.open;
    const settingsBanksPanel = document.getElementById('settings-banks-pockets-panel');
    const settingsCatsPanel = document.getElementById('settings-categories-panel');
    if (settingsOpen) {
      if (settingsBanksPanel) renderBanksAndPocketsManager(settingsBanksPanel);
      if (settingsCatsPanel) renderCategoriesManager(settingsCatsPanel);
    }
    if (document.getElementById('manage-accounts-modal')?.open) {
      renderManageAccountsModal();
    }
  }

  function renderBanksAndPocketsManager(containerEl) {
    if (!containerEl) return;
    const accounts = state.dashboard?.accounts || [];
    const unusedBadge = `<span class="badge-archived">${esc(t('badgeUnused'))}</span>`;

    const accountsHtml = accounts
      .map(
        (acc) => `
          <div class="${acc.is_archived ? 'archived-card' : ''}" style="margin-bottom:12px;border:1px solid var(--border);border-radius:10px;padding:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:6px;flex-wrap:wrap;">
              <strong><span class="bank-dot" style="display:inline-block;margin-right:6px;background:${esc(acc.color)}"></span>${esc(acc.name)} (${esc(acc.currency)})${acc.is_archived ? unusedBadge : ''}</strong>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${
                  acc.is_archived
                    ? `<button type="button" class="btn btn-secondary small" data-mgr-toggle-bank="${acc.id}" data-archived="0">${esc(t('btnRestoreShort'))}</button>`
                    : `<button type="button" class="btn btn-secondary small" data-mgr-add-pocket="${acc.id}">${esc(t('btnPlusPocket'))}</button>
                       <button type="button" class="btn btn-ghost small" data-mgr-toggle-bank="${acc.id}" data-archived="1">${esc(t('btnHideShort'))}</button>`
                }
                <button type="button" class="btn btn-secondary small" data-mgr-edit-bank="${acc.id}">${esc(t('btnEditShort'))}</button>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${acc.pockets
                .map(
                  (p) => `
                    <div class="manage-row ${p.is_archived ? 'archived-row' : ''}">
                      <span>${esc(p.name)} <span class="muted small">${esc(t('pocketInitMeta', { currency: p.currency, init: p.initial_balance }))}</span>${p.is_default ? ' ★' : ''}${p.is_archived ? unusedBadge : ''}</span>
                      <div style="display:flex;gap:4px;">
                        <button type="button" class="btn btn-ghost small" data-mgr-toggle-pocket="${p.id}" data-archived="${p.is_archived ? '0' : '1'}">${p.is_archived ? esc(t('btnRestoreShort')) : esc(t('btnHideShort'))}</button>
                        <button type="button" class="btn btn-ghost small" data-mgr-edit-pocket="${p.id}">${esc(t('btnEditShort'))}</button>
                      </div>
                    </div>
                  `
                )
                .join('')}
            </div>
          </div>
        `
      )
      .join('');

    containerEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px;flex-wrap:wrap;">
        <h4 style="margin:0;">${esc(t('banksHeading'))}</h4>
        <button type="button" class="btn btn-primary small" data-mgr-add-bank="1">${esc(t('btnAddBank'))}</button>
      </div>
      <p class="muted small" style="margin:0 0 10px;">${esc(t('manageBanksSub'))}</p>
      ${accountsHtml}
    `;

    containerEl.querySelector('[data-mgr-add-bank]')?.addEventListener('click', () => openBankModal());
    containerEl.querySelectorAll('[data-mgr-edit-bank]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const acc = state.dashboard.accounts.find((a) => a.id === Number(btn.dataset.mgrEditBank));
        if (acc) openBankModal(acc);
      });
    });
    containerEl.querySelectorAll('[data-mgr-add-pocket]').forEach((btn) => {
      btn.addEventListener('click', () => openPocketModal(Number(btn.dataset.mgrAddPocket)));
    });
    containerEl.querySelectorAll('[data-mgr-edit-pocket]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = getAllPockets().find((x) => x.id === Number(btn.dataset.mgrEditPocket));
        if (p) openPocketModal(p.account_id, p);
      });
    });
    containerEl.querySelectorAll('[data-mgr-toggle-bank]').forEach((btn) => {
      btn.addEventListener('click', () =>
        setAccountArchived(Number(btn.dataset.mgrToggleBank), btn.dataset.archived === '1')
      );
    });
    containerEl.querySelectorAll('[data-mgr-toggle-pocket]').forEach((btn) => {
      btn.addEventListener('click', () =>
        setPocketArchived(Number(btn.dataset.mgrTogglePocket), btn.dataset.archived === '1')
      );
    });
  }

  function renderManageAccountsModal() {
    const body = document.getElementById('manage-accounts-body');
    if (!body) return;
    body.innerHTML = `
      <div class="manage-panel" id="manage-banks-panel"></div>
      <div class="manage-panel" id="manage-cp-panel"></div>
    `;
    renderBanksAndPocketsManager(document.getElementById('manage-banks-panel'));
    renderCounterpartyManager(document.getElementById('manage-cp-panel'));
  }

  function openManageAccountsModal() {
    renderManageAccountsModal();
    document.getElementById('manage-accounts-modal').showModal();
  }

  function openSyncModal(pocketId) {
    const all = getAllPockets();
    const p = all.find((x) => x.id === pocketId);
    if (!p) return;
    document.getElementById('sync-pocket-id').value = String(p.id);
    document.getElementById('sync-pocket-desc').textContent = t('syncDescText', {
      account: p.accountName,
      pocket: p.name,
      balance: formatMoney(p.current_balance, p.currency),
    });
    document.getElementById('sync-currency-label').textContent = p.currency;
    document.getElementById('sync-balance').value = String(p.current_balance);
    const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('sync-date').value = nowLocal;
    document.getElementById('sync-note').value = '';
    document.getElementById('sync-modal').showModal();
  }

  function renderWebhookLogs(logs) {
    const box = document.getElementById('notif-webhook-logs');
    if (!box) return;
    const list = Array.isArray(logs) ? logs : [];
    if (list.length === 0) {
      box.innerHTML = `<div class="muted">${esc(t('webhookLogsEmpty'))}</div>`;
      return;
    }
    box.innerHTML =
      `<div style="font-weight:700;margin-bottom:4px;">${esc(t('webhookLogsTitle'))}</div>` +
      list
        .slice(0, 6)
        .map((item) => {
          const badge = item.logged
            ? `<span style="color:var(--positive);font-weight:700;">✓ ${esc(t('webhookLogLogged'))}</span>`
            : `<span style="color:#fbbf24;font-weight:700;">• ${esc(t('webhookLogIgnored'))}</span>`;
          const timeStr = item.at ? new Date(item.at).toLocaleTimeString() : '';
          return `
            <div class="webhook-log-item">
              <div>${badge} <span class="muted">${esc(timeStr)}</span>: ${esc(item.statusText || '')}</div>
              <div class="muted">${esc(item.preview || '')}</div>
            </div>
          `;
        })
        .join('');
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function isWebPushSupported() {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  async function syncPushSubscriptionSilently() {
    if (!state.user || !isWebPushSupported() || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await api('/api/push/subscribe', { method: 'POST', body: existing.toJSON() });
      }
    } catch {
      // keep silent in background sync
    }
  }

  async function updatePushSettingsUI(serverCount = null) {
    const statusEl = document.getElementById('pwa-push-status');
    const enableBtn = document.getElementById('btn-push-enable');
    const disableBtn = document.getElementById('btn-push-disable');
    const testBtn = document.getElementById('btn-push-test');
    if (!statusEl) return;

    if (!isWebPushSupported()) {
      statusEl.textContent = t('pwaPushStatusUnsupported');
      enableBtn?.classList.add('hidden');
      disableBtn?.classList.add('hidden');
      testBtn?.classList.add('hidden');
      return;
    }

    let count = Number(serverCount);
    let sub = null;
    try {
      const reg = await navigator.serviceWorker.ready;
      sub = await reg.pushManager.getSubscription();
      if (!Number.isFinite(count)) {
        const keyInfo = await api('/api/push/public-key');
        count = Number(keyInfo.subscriptionCount || 0);
      }
    } catch {
      if (!Number.isFinite(count)) count = 0;
    }

    if (Notification.permission === 'denied') {
      statusEl.textContent = t('pwaPushStatusDenied');
      enableBtn?.classList.add('hidden');
      disableBtn?.classList.add('hidden');
      testBtn?.classList.toggle('hidden', count <= 0);
      return;
    }

    if (sub && Notification.permission === 'granted') {
      statusEl.textContent = t('pwaPushStatusActive', { count });
      enableBtn?.classList.add('hidden');
      disableBtn?.classList.remove('hidden');
      testBtn?.classList.remove('hidden');
    } else {
      statusEl.textContent = t('pwaPushStatusOff', { count });
      enableBtn?.classList.remove('hidden');
      disableBtn?.classList.add('hidden');
      testBtn?.classList.toggle('hidden', count <= 0);
    }
  }

  const backupUiState = {
    clearPassword: false,
    clearSshKey: false,
    remoteFiles: [],
    lastSnapshot: null,
  };

  function formatBytesHuman(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatIsoLocalShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function syncBackupFormVisibility() {
    const schedType = document.getElementById('bk-schedule-type')?.value || 'daily';
    document.getElementById('bk-time-wrap')?.classList.toggle('hidden', schedType === 'interval');
    document.getElementById('bk-weekday-wrap')?.classList.toggle('hidden', schedType !== 'weekly');
    document.getElementById('bk-interval-wrap')?.classList.toggle('hidden', schedType !== 'interval');

    const protocol = document.getElementById('bk-remote-protocol')?.value || 'sftp';
    const authMethod = document.getElementById('bk-remote-auth-method')?.value || 'password';
    document.getElementById('bk-ftps-row')?.classList.toggle('hidden', protocol !== 'ftps');
    document.getElementById('bk-smb-row')?.classList.toggle('hidden', protocol !== 'smb');
    document.getElementById('bk-sftp-auth-row')?.classList.toggle('hidden', protocol !== 'sftp');
    document.getElementById('bk-ssh-key-wrap')?.classList.toggle('hidden', protocol !== 'sftp' || authMethod !== 'key');
    document.getElementById('bk-verify-tls-wrap')?.classList.toggle('hidden', protocol !== 'ftps' && protocol !== 'sftp');
  }

  function bindBackupFileRowActions(container, source) {
    if (!container) return;
    container.querySelectorAll('[data-bk-restore]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const filename = btn.dataset.bkRestore;
        if (!filename) return;
        if (!window.confirm(t('bkConfirmRestoreReplace', { name: filename }))) return;
        try {
          btn.disabled = true;
          await api('/api/backups/restore', {
            method: 'POST',
            body: { source, filename, mode: 'replace' },
          });
          toast(t('bkToastRestored'), 'ok');
          document.getElementById('settings-modal')?.close();
          await refreshDashboard();
        } catch (err) {
          toast(err.message, 'err');
        } finally {
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-bk-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const filename = btn.dataset.bkDelete;
        if (!filename) return;
        if (!window.confirm(t('bkConfirmDelete', { name: filename }))) return;
        try {
          btn.disabled = true;
          if (source === 'remote') {
            const res = await api(`/api/backups/remote/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            backupUiState.remoteFiles = res.files || [];
            renderRemoteBackupList(backupUiState.remoteFiles);
          } else {
            const snap = await api(`/api/backups/local/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            renderBackupSnapshot(snap);
          }
          toast(t('bkToastDeleted'), 'ok');
        } catch (err) {
          toast(err.message, 'err');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function renderLocalBackupList(files = []) {
    const listEl = document.getElementById('bk-local-list');
    if (!listEl) return;
    if (!files || files.length === 0) {
      listEl.innerHTML = `<div class="muted small">${esc(t('bkNoLocalFiles'))}</div>`;
      return;
    }
    listEl.innerHTML = files
      .map(
        (f) => `
          <div class="backup-file-row">
            <div class="backup-file-meta">
              <span class="backup-file-name" title="${esc(f.filename)}">${esc(f.filename)}</span>
              <span class="muted small">${esc(formatIsoLocalShort(f.createdAt))} · ${esc(formatBytesHuman(f.sizeBytes))}</span>
            </div>
            <div class="backup-file-actions">
              <a class="btn btn-ghost small" href="api/backups/local/${encodeURIComponent(f.filename)}" download>${esc(t('bkBtnDownload'))}</a>
              <button type="button" class="btn btn-secondary small" data-bk-restore="${esc(f.filename)}">${esc(t('bkBtnRestore'))}</button>
              <button type="button" class="btn btn-ghost small" data-bk-delete="${esc(f.filename)}">${esc(t('bkBtnDelete'))}</button>
            </div>
          </div>
        `
      )
      .join('');
    bindBackupFileRowActions(listEl, 'local');
  }

  function renderRemoteBackupList(files = []) {
    const listEl = document.getElementById('bk-remote-list');
    if (!listEl) return;
    if (!files || files.length === 0) {
      listEl.innerHTML = `<div class="muted small">${esc(t('bkNoRemoteFiles'))}</div>`;
      return;
    }
    listEl.innerHTML = files
      .map(
        (f) => `
          <div class="backup-file-row">
            <div class="backup-file-meta">
              <span class="backup-file-name" title="${esc(f.filename)}">${esc(f.filename)}</span>
              <span class="muted small">${esc(formatIsoLocalShort(f.timestampMs ? new Date(f.timestampMs).toISOString() : ''))} · ${esc(formatBytesHuman(f.sizeBytes))}</span>
            </div>
            <div class="backup-file-actions">
              <button type="button" class="btn btn-secondary small" data-bk-restore="${esc(f.filename)}">${esc(t('bkBtnRestore'))}</button>
              <button type="button" class="btn btn-ghost small" data-bk-delete="${esc(f.filename)}">${esc(t('bkBtnDelete'))}</button>
            </div>
          </div>
        `
      )
      .join('');
    bindBackupFileRowActions(listEl, 'remote');
  }

  function renderBackupHistoryList(history = []) {
    const histEl = document.getElementById('bk-history-list');
    if (!histEl) return;
    if (!history || history.length === 0) {
      histEl.innerHTML = `<div class="muted small">${esc(t('bkNoRunsYet'))}</div>`;
      return;
    }
    histEl.innerHTML = history
      .slice(0, 20)
      .map((h) => {
        const cls = h.status === 'ok' ? 'is-ok' : h.status === 'partial' ? 'is-warn' : 'is-err';
        const trig = h.trigger === 'scheduled' ? t('bkTriggerScheduled') : t('bkTriggerManual');
        const details = [];
        if (h.local && !h.local.skipped) {
          if (h.local.ok) {
            const p = h.local.prunedCount > 0 ? ` (${t('bkPrunedNote', { count: h.local.prunedCount })})` : '';
            details.push(`Local OK${p}`);
          } else {
            details.push(`Local ERR: ${h.local.error || 'failed'}`);
          }
        }
        if (h.remote && !h.remote.skipped) {
          const proto = String(h.remote.protocol || '').toUpperCase();
          if (h.remote.ok) {
            const p = h.remote.prunedCount > 0 ? ` (${t('bkPrunedNote', { count: h.remote.prunedCount })})` : '';
            details.push(`${proto} OK${p}`);
          } else {
            details.push(`${proto} ERR: ${h.remote.error || 'failed'}`);
          }
        }
        return `
          <div class="backup-file-row">
            <div class="backup-file-meta">
              <span class="backup-file-name">${esc(formatIsoLocalShort(h.startedAt))} · ${esc(trig)} (${esc(formatBytesHuman(h.sizeBytes))})</span>
              <span class="muted small">${esc(details.join(' | ') || h.filename || '')}</span>
            </div>
            <span class="backup-status-pill ${cls}">${esc(String(h.status || 'ok').toUpperCase())}</span>
          </div>
        `;
      })
      .join('');
  }

  function renderBackupSnapshot(snap) {
    if (!snap || !snap.config) return;
    backupUiState.lastSnapshot = snap;
    const cfg = snap.config;

    document.getElementById('bk-enabled').checked = Boolean(cfg.enabled);
    document.getElementById('bk-schedule-type').value = cfg.scheduleType || 'daily';
    document.getElementById('bk-time').value = cfg.timeOfDay || '03:00';
    document.getElementById('bk-weekday').value = String(cfg.dayOfWeek ?? 0);
    document.getElementById('bk-interval-hours').value = String(cfg.intervalHours || 24);
    document.getElementById('bk-compress').checked = cfg.compress !== false;
    document.getElementById('bk-include-receipts').checked = cfg.includeReceipts !== false;

    const pill = document.getElementById('bk-next-run-pill');
    if (pill) {
      if (cfg.enabled && cfg.nextRunAt) {
        pill.className = 'backup-status-pill is-ok';
        pill.textContent = t('bkNextRunScheduled', { when: formatIsoLocalShort(cfg.nextRunAt) });
      } else {
        pill.className = 'backup-status-pill muted';
        pill.textContent = t('bkScheduleDisabled');
      }
    }

    const lastRunEl = document.getElementById('bk-last-run-info');
    if (lastRunEl) {
      const lastEntry = snap.history?.[0];
      lastRunEl.textContent = cfg.lastRunAt
        ? t('bkLastRunFmt', {
            when: formatIsoLocalShort(cfg.lastRunAt),
            status: String(lastEntry?.status || 'ok').toUpperCase(),
          })
        : t('bkNoRunsYet');
    }

    const loc = cfg.local || {};
    document.getElementById('bk-local-enabled').checked = loc.enabled !== false;
    document.getElementById('bk-local-dir').value = loc.directory || '';
    document.getElementById('bk-local-max-count').value = String(loc.maxCount ?? 14);
    document.getElementById('bk-local-max-size').value = String(loc.maxTotalSizeMb ?? 250);
    document.getElementById('bk-local-max-age').value = String(loc.maxAgeDays ?? 30);
    const locResolved = document.getElementById('bk-local-resolved');
    if (locResolved) {
      locResolved.textContent = t('bkResolvedDirFmt', { dir: loc.resolvedDirectory || './data/backups' });
    }
    const locSummary = document.getElementById('bk-local-summary');
    if (locSummary) {
      locSummary.textContent = t('bkLocalSummaryFmt', {
        count: (snap.localFiles || []).length,
        size: formatBytesHuman(snap.localTotalBytes || 0),
      });
    }

    const rem = cfg.remote || {};
    document.getElementById('bk-remote-enabled').checked = Boolean(rem.enabled);
    document.getElementById('bk-remote-protocol').value = rem.protocol || 'sftp';
    document.getElementById('bk-remote-host').value = rem.host || '';
    document.getElementById('bk-remote-port').value = String(rem.port || 22);
    document.getElementById('bk-remote-ftps-mode').value = rem.ftpsMode || 'explicit';
    document.getElementById('bk-remote-share').value = rem.share || '';
    document.getElementById('bk-remote-domain').value = rem.domain || '';
    document.getElementById('bk-remote-path').value = rem.remotePath || '/moneymanager-backups';
    document.getElementById('bk-remote-user').value = rem.username || '';
    document.getElementById('bk-remote-pass').value = '';
    document.getElementById('bk-pass-hint').textContent = rem.hasPassword ? t('bkSecretSaved') : '';
    document.getElementById('bk-remote-auth-method').value = rem.authMethod || 'password';
    document.getElementById('bk-remote-ssh-key').value = '';
    document.getElementById('bk-key-hint').textContent = rem.hasSshKey ? t('bkSecretSaved') : '';
    document.getElementById('bk-remote-verify-tls').checked = Boolean(rem.verifyTls);
    document.getElementById('bk-remote-max-count').value = String(rem.maxCount ?? 30);
    document.getElementById('bk-remote-max-size').value = String(rem.maxTotalSizeMb ?? 1024);
    document.getElementById('bk-remote-max-age').value = String(rem.maxAgeDays ?? 90);
    backupUiState.clearPassword = false;
    backupUiState.clearSshKey = false;

    const capsEl = document.getElementById('bk-capabilities');
    if (capsEl && snap.capabilities) {
      const caps = snap.capabilities;
      capsEl.innerHTML = [
        `<span class="backup-status-pill ${caps.curl ? 'is-ok' : 'is-err'}">FTP/FTPS${caps.curl ? ' ✓' : ' ✕'}</span>`,
        `<span class="backup-status-pill ${caps.sftp || caps.curl ? 'is-ok' : 'is-err'}">SFTP${caps.sftp ? ' ✓' : caps.curl ? ' (pw)' : ' ✕'}</span>`,
        `<span class="backup-status-pill ${caps.smbclient ? 'is-ok' : 'is-warn'}">SMB${caps.smbclient ? ' ✓' : ' -'}</span>`,
      ].join('');
    }

    syncBackupFormVisibility();
    renderLocalBackupList(snap.localFiles || []);
    renderRemoteBackupList(backupUiState.remoteFiles || []);
    renderBackupHistoryList(snap.history || []);
  }

  function collectBackupPayloadFromForm() {
    return {
      enabled: Boolean(document.getElementById('bk-enabled')?.checked),
      scheduleType: document.getElementById('bk-schedule-type')?.value || 'daily',
      timeOfDay: document.getElementById('bk-time')?.value || '03:00',
      dayOfWeek: Number(document.getElementById('bk-weekday')?.value || 0),
      intervalHours: Number(document.getElementById('bk-interval-hours')?.value || 24),
      compress: Boolean(document.getElementById('bk-compress')?.checked),
      includeReceipts: Boolean(document.getElementById('bk-include-receipts')?.checked),
      local: {
        enabled: Boolean(document.getElementById('bk-local-enabled')?.checked),
        directory: document.getElementById('bk-local-dir')?.value.trim() || '',
        maxCount: Number(document.getElementById('bk-local-max-count')?.value ?? 14),
        maxTotalSizeMb: Number(document.getElementById('bk-local-max-size')?.value ?? 250),
        maxAgeDays: Number(document.getElementById('bk-local-max-age')?.value ?? 30),
      },
      remote: {
        enabled: Boolean(document.getElementById('bk-remote-enabled')?.checked),
        protocol: document.getElementById('bk-remote-protocol')?.value || 'sftp',
        ftpsMode: document.getElementById('bk-remote-ftps-mode')?.value || 'explicit',
        host: document.getElementById('bk-remote-host')?.value.trim() || '',
        port: Number(document.getElementById('bk-remote-port')?.value || 22),
        share: document.getElementById('bk-remote-share')?.value.trim() || '',
        domain: document.getElementById('bk-remote-domain')?.value.trim() || '',
        remotePath: document.getElementById('bk-remote-path')?.value.trim() || '/moneymanager-backups',
        username: document.getElementById('bk-remote-user')?.value.trim() || '',
        password: document.getElementById('bk-remote-pass')?.value || '',
        clearPassword: backupUiState.clearPassword,
        authMethod: document.getElementById('bk-remote-auth-method')?.value || 'password',
        sshPrivateKey: document.getElementById('bk-remote-ssh-key')?.value || '',
        clearSshKey: backupUiState.clearSshKey,
        verifyTls: Boolean(document.getElementById('bk-remote-verify-tls')?.checked),
        maxCount: Number(document.getElementById('bk-remote-max-count')?.value ?? 30),
        maxTotalSizeMb: Number(document.getElementById('bk-remote-max-size')?.value ?? 1024),
        maxAgeDays: Number(document.getElementById('bk-remote-max-age')?.value ?? 90),
      },
    };
  }

  async function loadBackupSettingsPanel() {
    try {
      const snap = await api('/api/backups/status');
      renderBackupSnapshot(snap);
    } catch (err) {
      const msgEl = document.getElementById('bk-main-msg');
      if (msgEl) msgEl.textContent = err.message;
    }
  }

  function switchSettingsTab(tab = 'general') {
    const activeTab = tab === 'data' ? 'data' : tab === 'backups' ? 'backups' : 'general';
    document.getElementById('settings-tab-general')?.classList.toggle('hidden', activeTab !== 'general');
    document.getElementById('settings-tab-data')?.classList.toggle('hidden', activeTab !== 'data');
    document.getElementById('settings-tab-backups')?.classList.toggle('hidden', activeTab !== 'backups');
    document.getElementById('settings-tab-btn-general')?.classList.toggle('active', activeTab === 'general');
    document.getElementById('settings-tab-btn-data')?.classList.toggle('active', activeTab === 'data');
    document.getElementById('settings-tab-btn-backups')?.classList.toggle('active', activeTab === 'backups');
    if (activeTab === 'data') {
      renderBanksAndPocketsManager(document.getElementById('settings-banks-pockets-panel'));
      renderCounterpartyManager(document.getElementById('settings-recipients-panel'));
      renderCategoriesManager(document.getElementById('settings-categories-panel'));
    } else if (activeTab === 'backups') {
      loadBackupSettingsPanel();
    }
  }

  function populateNotifTestAccountSelect() {
    const sel = document.getElementById('notif-test-app');
    if (!sel) return;
    const prevVal = sel.value || '';
    const accounts = (state.dashboard?.accounts || []).filter((a) => !a.is_archived);
    sel.innerHTML =
      `<option value="" data-i18n="notifAppAuto">${esc(t('notifAppAuto'))}</option>` +
      accounts.map((a) => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
    if (prevVal && Array.from(sel.options).some((o) => o.value === prevVal)) {
      sel.value = prevVal;
    }
  }

  async function openSettingsModal(initialTab = 'general') {
    const modal = document.getElementById('settings-modal');
    const targetTab = initialTab === 'data' ? 'data' : initialTab === 'backups' ? 'backups' : 'general';
    switchSettingsTab(targetTab);
    renderPaletteControls();
    renderBanksAndPocketsManager(document.getElementById('settings-banks-pockets-panel'));
    renderCounterpartyManager(document.getElementById('settings-recipients-panel'));
    renderCategoriesManager(document.getElementById('settings-categories-panel'));
    populateNotifTestAccountSelect();
    try {
      const s = await api('/api/settings');
      if (s.appVersion) renderAppVersion(s.appVersion);
      document.getElementById('set-gemini-status').textContent = s.hasGeminiKey
        ? t('geminiStatusSet', { preview: s.geminiKeyPreview })
        : t('geminiStatusUnset');
      document.getElementById('set-gemini-key').value = '';
      document.getElementById('set-gemini-model').value = s.geminiModel || 'gemini-4-hydrogen';
      document.getElementById('fx-eur').value = s.fxRates.EUR || 405;
      document.getElementById('fx-usd').value = s.fxRates.USD || 375;
      document.getElementById('fx-gbp').value = s.fxRates.GBP || 480;
      document.getElementById('set-gemini-msg').textContent = '';
      document.getElementById('set-fx-msg').textContent = '';
      const notifMsg = document.getElementById('set-notif-msg');
      if (notifMsg) notifMsg.textContent = '';
      const timeoutInput = document.getElementById('set-session-timeout');
      if (timeoutInput) timeoutInput.value = String(s.sessionTimeoutMinutes || state.sessionTimeoutMinutes || 10);
      const timeoutMsg = document.getElementById('set-timeout-msg');
      if (timeoutMsg) timeoutMsg.textContent = '';
      const trashSel = document.getElementById('set-trash-retention');
      if (trashSel) {
        const minsVal = String(s.trashRetentionMinutes ?? 43200);
        if (!Array.from(trashSel.options).some((o) => o.value === minsVal)) {
          const opt = document.createElement('option');
          opt.value = minsVal;
          opt.textContent = formatTrashWindowLabel(Number(minsVal));
          trashSel.appendChild(opt);
        }
        trashSel.value = minsVal;
      }
      const trashMsg = document.getElementById('set-trash-retention-msg');
      if (trashMsg) trashMsg.textContent = '';
      const webhookInput = document.getElementById('set-webhook-url');
      if (webhookInput && s.webhookToken) {
        const wUrl = new URL('api/notifications/webhook', window.location.href);
        wUrl.searchParams.set('token', s.webhookToken);
        webhookInput.value = wUrl.toString();
      }
      renderWebhookLogs(s.webhookLogs);
      updatePushSettingsUI(s.pushSubscriptionCount);
      if (window.MoneyReceipt && typeof window.MoneyReceipt.renderVisionQuotaCard === 'function') {
        window.MoneyReceipt.renderVisionQuotaCard(
          document.getElementById('settings-gemini-quota'),
          s.geminiUsage,
          { hasKey: s.hasGeminiKey, esc }
        );
      }
    } catch (err) {
      toast(err.message, 'err');
    }
    modal.showModal();
  }

  // -------------------- DASHBOARD EDIT MODE & DRAG-AND-DROP --------------------
  function getSectionLabels() {
    return {
      kpis: t('secTitleKpis'),
      banks: t('secTitleBanks'),
      charts: t('secTitleCharts'),
      ledger: t('secTitleLedger'),
    };
  }

  function getKpiLabels() {
    return {
      'kpi-networth': t('widgetTitleNetWorth'),
      'kpi-income': t('widgetTitleIncome'),
      'kpi-expense': t('widgetTitleExpense'),
      'kpi-cashflow': t('widgetTitleCashflow'),
      'kpi-savings-rate': t('widgetTitleSavingsRate'),
      'kpi-daily-avg': t('widgetTitleDailyAvg'),
      'kpi-top-merchant': t('widgetTitleTopMerchant'),
      'kpi-biggest-expense': t('widgetTitleBiggestExpense'),
      'kpi-recurring': t('widgetTitleRecurringKpi'),
      'kpi-tx-activity': t('widgetTitleTxActivity'),
    };
  }

  function getChartLabels() {
    return {
      'chart-monthly': t('widgetTitleMonthly'),
      'chart-donut': t('widgetTitleDonut'),
      'chart-income': t('widgetTitleIncomeSources'),
      'chart-balance': t('widgetTitleBalance'),
      'chart-net-trend': t('chartNetTrendTitle'),
      'chart-daily-spend': t('chartDailySpendTitle'),
      'chart-weekday': t('chartWeekdayTitle'),
      'chart-bank-dist': t('chartWealthTitle'),
    };
  }

  function getKpiCatalog() {
    return [
      { id: 'kpi-networth', title: t('widgetTitleNetWorth'), desc: t('widgetDescNetWorth') },
      { id: 'kpi-income', title: t('widgetTitleIncome'), desc: t('widgetDescIncome') },
      { id: 'kpi-expense', title: t('widgetTitleExpense'), desc: t('widgetDescExpense') },
      { id: 'kpi-cashflow', title: t('widgetTitleCashflow'), desc: t('widgetDescCashflow') },
      { id: 'kpi-savings-rate', title: t('widgetTitleSavingsRate'), desc: t('widgetDescSavingsRate') },
      { id: 'kpi-daily-avg', title: t('widgetTitleDailyAvg'), desc: t('widgetDescDailyAvg') },
      { id: 'kpi-top-merchant', title: t('widgetTitleTopMerchant'), desc: t('widgetDescTopMerchant') },
      { id: 'kpi-biggest-expense', title: t('widgetTitleBiggestExpense'), desc: t('widgetDescBiggestExpense') },
      { id: 'kpi-recurring', title: t('widgetTitleRecurringKpi'), desc: t('widgetDescRecurringKpi') },
      { id: 'kpi-tx-activity', title: t('widgetTitleTxActivity'), desc: t('widgetDescTxActivity') },
    ];
  }

  function getChartCatalog() {
    return [
      { id: 'chart-monthly', title: t('widgetTitleMonthly'), desc: t('widgetDescMonthly') },
      { id: 'chart-donut', title: t('widgetTitleDonut'), desc: t('widgetDescDonut') },
      { id: 'chart-income', title: t('widgetTitleIncomeSources'), desc: t('widgetDescIncomeSources') },
      { id: 'chart-balance', title: t('widgetTitleBalance'), desc: t('widgetDescBalance') },
      { id: 'chart-net-trend', title: t('chartNetTrendTitle'), desc: t('widgetDescNetTrend') },
      { id: 'chart-daily-spend', title: t('chartDailySpendTitle'), desc: t('widgetDescDailySpend') },
      { id: 'chart-weekday', title: t('chartWeekdayTitle'), desc: t('widgetDescWeekday') },
      { id: 'chart-bank-dist', title: t('chartWealthTitle'), desc: t('widgetDescWealth') },
    ];
  }

  function toggleWidgetVisibility(group, id) {
    const arr =
      group === 'section'
        ? state.layout.hiddenSections
        : group === 'kpi'
        ? state.layout.hiddenKpis
        : group === 'chart'
        ? state.layout.hiddenCharts
        : null;
    if (!arr) return;
    const idx = arr.indexOf(id);
    if (idx >= 0) {
      arr.splice(idx, 1);
      if (group === 'kpi' && !findRowCell(state.layout.kpiRows, id)) {
        state.layout.kpiRows.push([{ id, w: 1 }]);
      } else if (group === 'chart' && !findRowCell(state.layout.chartRows, id)) {
        state.layout.chartRows.push([{ id, w: 1 }]);
      }
      syncFlatOrdersFromRows();
    } else {
      arr.push(id);
    }
    applyDashboardLayout();
    if (group === 'chart' || group === 'section') renderAllCharts();
    saveLayoutState(true);
    if (document.getElementById('widgets-modal')?.open) {
      renderWidgetsModal();
    }
  }

  function renderWidgetsModal() {
    const kpiBox = document.getElementById('widgets-kpi-list');
    const chartBox = document.getElementById('widgets-chart-list');
    if (!kpiBox || !chartBox) return;

    const hiddenKpiSet = new Set(state.layout.hiddenKpis || []);
    kpiBox.innerHTML = getKpiCatalog()
      .map((item) => {
        const active = !hiddenKpiSet.has(item.id);
        return `
          <button type="button" class="widget-choice-card ${active ? 'is-active' : ''}" data-widget-choice-group="kpi" data-widget-choice-id="${esc(item.id)}" aria-pressed="${active ? 'true' : 'false'}">
            <div class="widget-choice-meta">
              <div class="widget-choice-title">${esc(item.title)}</div>
              <div class="widget-choice-desc">${esc(item.desc)}</div>
            </div>
            <span class="widget-choice-state">${active ? esc(t('widgetShownTag')) : esc(t('widgetHiddenTag'))}</span>
          </button>
        `;
      })
      .join('');

    const hiddenChartSet = new Set(state.layout.hiddenCharts || []);
    chartBox.innerHTML = getChartCatalog()
      .map((item) => {
        const active = !hiddenChartSet.has(item.id);
        return `
          <button type="button" class="widget-choice-card ${active ? 'is-active' : ''}" data-widget-choice-group="chart" data-widget-choice-id="${esc(item.id)}" aria-pressed="${active ? 'true' : 'false'}">
            <div class="widget-choice-meta">
              <div class="widget-choice-title">${esc(item.title)}</div>
              <div class="widget-choice-desc">${esc(item.desc)}</div>
            </div>
            <span class="widget-choice-state">${active ? esc(t('widgetShownTag')) : esc(t('widgetHiddenTag'))}</span>
          </button>
        `;
      })
      .join('');

    kpiBox.querySelectorAll('[data-widget-choice-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleWidgetVisibility('kpi', btn.dataset.widgetChoiceId);
      });
    });
    chartBox.querySelectorAll('[data-widget-choice-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleWidgetVisibility('chart', btn.dataset.widgetChoiceId);
      });
    });
  }

  function openWidgetsModal(focusSection = 'kpis') {
    renderWidgetsModal();
    const modal = document.getElementById('widgets-modal');
    if (!modal) return;
    modal.showModal();
    const targetEl = document.getElementById(
      focusSection === 'charts' ? 'widgets-chart-section' : 'widgets-kpi-section'
    );
    if (targetEl) {
      requestAnimationFrame(() => targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
  }

  function syncFlatOrdersFromRows() {
    state.layout.sectionOrder = state.layout.sectionRows.flatMap((r) => r.map((c) => c.id));
    state.layout.kpiOrder = state.layout.kpiRows.flatMap((r) => r.map((c) => c.id));
    state.layout.chartOrder = state.layout.chartRows.flatMap((r) => r.map((c) => c.id));
    state.layout.bankOrder = state.layout.bankRows
      .flatMap((r) => r.map((c) => Number(c.id)))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  function findRowCell(rows, id) {
    const sid = String(id);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (String(rows[r][c].id) === sid) return { r, c, cell: rows[r][c] };
      }
    }
    return null;
  }

  function removeCellFromRows(rows, id) {
    const pos = findRowCell(rows, id);
    if (!pos) return null;
    const [removed] = rows[pos.r].splice(pos.c, 1);
    if (rows[pos.r].length === 0) {
      rows.splice(pos.r, 1);
    }
    return { removed, prevRowIdx: pos.r, prevColIdx: pos.c };
  }

  function getGroupContext(group) {
    if (group === 'section') {
      return {
        rowsKey: 'sectionRows',
        hiddenSet: new Set(state.layout.hiddenSections || []),
        container: document.getElementById('dashboard-sections'),
      };
    }
    if (group === 'kpi') {
      return {
        rowsKey: 'kpiRows',
        hiddenSet: new Set(state.layout.hiddenKpis || []),
        container: document.getElementById('kpi-grid'),
      };
    }
    if (group === 'chart') {
      return {
        rowsKey: 'chartRows',
        hiddenSet: new Set(state.layout.hiddenCharts || []),
        container: document.getElementById('charts-grid'),
      };
    }
    if (group === 'bank') {
      const hiddenBanks = new Set();
      if (state.dashboard?.accounts && !state.showArchived) {
        for (const a of state.dashboard.accounts) {
          if (a.is_archived) hiddenBanks.add(String(a.id));
        }
      }
      return {
        rowsKey: 'bankRows',
        hiddenSet: hiddenBanks,
        container: document.getElementById('banks-grid'),
      };
    }
    return null;
  }

  function getItemMinBounds(group) {
    return group === 'kpi' ? { minW: 90, minH: 60 } : { minW: 150, minH: 90 };
  }

  function isItemAutoSized(group, id) {
    const sid = String(id);
    const ms = state.layout.manualSizes?.[sid];
    if (ms && (ms.w !== null || ms.h !== null)) return false;
    if (state.layout.autoSize === false) return false;
    const ctx = getGroupContext(group);
    if (!ctx) return true;
    const pos = findRowCell(state.layout[ctx.rowsKey], sid);
    if (!pos) return true;
    const visRow = state.layout[ctx.rowsKey][pos.r].filter((c) => !ctx.hiddenSet.has(String(c.id)));
    return !(visRow.length > 1 && visRow.some((c) => Math.abs(Number(c.w || 1) - 1) > 0.02));
  }

  function buildMoveButtonsHtml(group, id, allowHide = false) {
    const escId = esc(id);
    const autoOn = isItemAutoSized(group, id);
    return `
      <button type="button" class="edit-mini-btn ${autoOn ? 'is-auto-on' : 'is-auto-off'}" data-toggle-auto-group="${group}" data-toggle-auto-id="${escId}" title="${esc(t('titleAutoSizeItem'))}">${esc(autoOn ? t('btnAutoOn') : t('btnAutoOff'))}</button>
      <button type="button" class="edit-mini-btn" data-move-group="${group}" data-move-id="${escId}" data-move-dir="up" title="${esc(t('titleMoveUp'))}">▲</button>
      <button type="button" class="edit-mini-btn" data-move-group="${group}" data-move-id="${escId}" data-move-dir="down" title="${esc(t('titleMoveDown'))}">▼</button>
      <button type="button" class="edit-mini-btn" data-move-group="${group}" data-move-id="${escId}" data-move-dir="left" title="${esc(t('titleMoveLeft'))}">◀</button>
      <button type="button" class="edit-mini-btn" data-move-group="${group}" data-move-id="${escId}" data-move-dir="right" title="${esc(t('titleMoveRight'))}">▶</button>
      ${allowHide ? `<button type="button" class="edit-mini-btn" data-hide-group="${group}" data-hide-id="${escId}">${esc(group === 'section' ? t('btnHide') : '👁️')}</button>` : ''}
    `;
  }

  function ensureHeightResizer(el, group, id) {
    let resizer = el.querySelector(':scope > .layout-height-resizer');
    if (!resizer) {
      resizer = document.createElement('div');
      resizer.className = 'layout-height-resizer';
      resizer.setAttribute('data-edit-chrome', '1');
      resizer.draggable = false;
      el.appendChild(resizer);
    }
    resizer.setAttribute('data-height-group', group);
    resizer.setAttribute('data-height-id', String(id));
    resizer.title = t('titleHeightResizer');
  }

  function ensureWidthResizer(el, group, id) {
    let resizer = el.querySelector(':scope > .layout-width-resizer');
    if (!resizer) {
      resizer = document.createElement('div');
      resizer.className = 'layout-width-resizer';
      resizer.setAttribute('data-edit-chrome', '1');
      resizer.draggable = false;
      el.appendChild(resizer);
    }
    resizer.setAttribute('data-width-group', group);
    resizer.setAttribute('data-width-id', String(id));
    resizer.title = t('titleWidthResizer');
  }

  function ensureCornerResizer(el, group, id) {
    let resizer = el.querySelector(':scope > .layout-corner-resizer');
    if (!resizer) {
      resizer = document.createElement('div');
      resizer.className = 'layout-corner-resizer';
      resizer.setAttribute('data-edit-chrome', '1');
      resizer.draggable = false;
      el.appendChild(resizer);
    }
    resizer.setAttribute('data-corner-group', group);
    resizer.setAttribute('data-corner-id', String(id));
    resizer.title = t('titleCornerResizer');
  }

  function ensureEditBars() {
    const secLabels = getSectionLabels();
    const widgetLabels = { ...getKpiLabels(), ...getChartLabels() };

    document.querySelectorAll('#dashboard-sections .dash-section[data-section-id]').forEach((sec) => {
      const id = sec.dataset.sectionId;
      const title = secLabels[id] || sec.dataset.sectionTitle || id;
      sec.setAttribute('data-drag-group', 'section');
      sec.setAttribute('data-drag-id', id);
      sec.setAttribute('draggable', state.editMode ? 'true' : 'false');
      let bar = sec.querySelector(':scope > .section-edit-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'section-edit-bar';
        bar.setAttribute('data-edit-chrome', '1');
        sec.prepend(bar);
      }
      bar.innerHTML = `
        <span class="drag-handle">⠿ ${esc(t('sectionPrefix', { title }))}</span>
        <div class="edit-bar-btns">${buildMoveButtonsHtml('section', id, true)}</div>
      `;
      ensureHeightResizer(sec, 'section', id);
      ensureWidthResizer(sec, 'section', id);
      ensureCornerResizer(sec, 'section', id);
    });

    const wireCards = (selector, group, allowHide) => {
      document.querySelectorAll(selector).forEach((card) => {
        const id = group === 'bank' ? card.dataset.bankId : card.dataset.widgetId;
        const title = widgetLabels[id] || card.dataset.widgetTitle || id;
        card.setAttribute('data-drag-group', group);
        card.setAttribute('data-drag-id', id);
        card.setAttribute('draggable', state.editMode ? 'true' : 'false');
        let bar = card.querySelector(':scope > .widget-edit-bar');
        if (!bar) {
          bar = document.createElement('div');
          bar.className = 'widget-edit-bar';
          bar.setAttribute('data-edit-chrome', '1');
          card.prepend(bar);
        }
        bar.innerHTML = `
          <span class="drag-handle">⠿ ${esc(title)}</span>
          <div class="edit-bar-btns">${buildMoveButtonsHtml(group, id, allowHide)}</div>
        `;
        ensureHeightResizer(card, group, id);
        ensureWidthResizer(card, group, id);
        ensureCornerResizer(card, group, id);
      });
    };

    wireCards('#kpi-grid .kpi-card[data-widget-id]', 'kpi', true);
    wireCards('#charts-grid .chart-card[data-widget-id]', 'chart', true);
    wireCards('#banks-grid .bank-card[data-bank-id]', 'bank', false);
  }

  function applyItemBoxStyle(el, group, id, weight, solo) {
    const ms = state.layout.manualSizes?.[String(id)];
    const hasW = Boolean(ms && ms.w !== null && Number.isFinite(Number(ms.w)));
    const hasH = Boolean(ms && ms.h !== null && Number.isFinite(Number(ms.h)));
    const isManual = hasW || hasH;

    el.classList.toggle('is-manual-size', isManual);
    el.classList.toggle('is-manual-w', hasW);
    el.classList.toggle('is-manual-h', hasH);

    if (hasW) {
      el.style.flex = '0 0 auto';
      el.style.width = `${Math.round(Number(ms.w))}px`;
      el.style.maxWidth = '100%';
    } else {
      el.style.flex = solo ? '1 1 0px' : `${clampWeight(weight)} 1 0px`;
      el.style.width = '';
      el.style.maxWidth = '';
    }

    if (hasH) {
      const hPx = Math.round(Number(ms.h));
      el.style.height = `${hPx}px`;
      el.style.minHeight = '0px';
      el.style.alignSelf = 'flex-start';
      if (group === 'chart') {
        const body = el.querySelector('.chart-body');
        if (body) {
          const chromeH = state.editMode ? 104 : 66;
          const bodyH = Math.max(60, hPx - chromeH);
          body.style.height = `${bodyH}px`;
          body.style.minHeight = '0px';
          body.dataset.customHeight = String(Math.max(90, bodyH));
        }
      }
    } else {
      el.style.height = '';
      el.style.minHeight = '';
      el.style.alignSelf = '';
      if (group === 'chart') {
        const body = el.querySelector('.chart-body');
        if (body) {
          body.style.height = '';
          body.style.minHeight = '';
          delete body.dataset.customHeight;
        }
      }
    }
  }

  function updateRowModeClass(rowEl, visRow) {
    let manualCnt = 0;
    for (const cell of visRow) {
      const ms = state.layout.manualSizes?.[String(cell.id)];
      if (ms && (ms.w !== null || ms.h !== null)) manualCnt++;
    }
    rowEl.classList.remove('row-auto', 'row-mixed', 'row-manual');
    if (manualCnt === 0) rowEl.classList.add('row-auto');
    else if (manualCnt === visRow.length) rowEl.classList.add('row-manual');
    else rowEl.classList.add('row-mixed');
    return manualCnt === 0;
  }

  function renderLayoutContainer(container, rows, hiddenSet, opts) {
    if (!container) return false;
    const { group, itemSelector, getIdFn } = opts;
    const matched = Array.from(container.querySelectorAll(itemSelector));
    const elById = new Map();
    for (const el of matched) {
      const id = String(getIdFn(el) || '');
      if (id && !elById.has(id)) elById.set(id, el);
    }

    const renderedRows = [];
    const visibleIds = new Set();
    for (const row of rows || []) {
      const visRow = row.filter((cell) => {
        const id = String(cell.id);
        return elById.has(id) && !hiddenSet.has(id);
      });
      if (visRow.length > 0) {
        renderedRows.push(visRow);
        visRow.forEach((cell) => visibleIds.add(String(cell.id)));
      }
    }

    for (const [id] of elById.entries()) {
      if (!visibleIds.has(id) && !hiddenSet.has(id)) {
        renderedRows.push([{ id, w: 1 }]);
        visibleIds.add(id);
      }
    }

    const hiddenList = Array.from(elById.keys()).filter((id) => !visibleIds.has(id));
    const sig = renderedRows.map((r) => r.map((c) => String(c.id)).join(',')).join('|') + '::h=' + hiddenList.join(',');
    const existingRowCount = container.querySelectorAll(':scope > .layout-row').length;

    const applyRowSizing = (rowEl, visRow) => {
      const solo = visRow.length === 1;
      const allAuto = updateRowModeClass(rowEl, visRow);
      const rowUnequal = allAuto && !solo && visRow.some((c) => Math.abs(Number(c.w || 1) - 1) > 0.02);
      visRow.forEach((cell) => {
        const id = String(cell.id);
        const el = elById.get(id);
        if (!el) return;
        el.classList.remove('hidden');
        applyItemBoxStyle(el, group, id, cell.w, solo);
      });
      return rowUnequal;
    };

    if (container.dataset.layoutSig === sig && existingRowCount === renderedRows.length) {
      const existingRowEls = container.querySelectorAll(':scope > .layout-row');
      renderedRows.forEach((visRow, rIdx) => {
        const rowEl = existingRowEls[rIdx];
        if (!rowEl) return;
        const rowUnequal = applyRowSizing(rowEl, visRow);
        rowEl.querySelectorAll(':scope > .layout-col-gutter > .gutter-auto-btn').forEach((btn) => {
          btn.classList.toggle('is-custom-sized', rowUnequal);
        });
      });
      for (const id of hiddenList) {
        const el = elById.get(id);
        if (el) {
          el.classList.add('hidden');
          el.style.flex = '';
          el.style.width = '';
          el.style.maxWidth = '';
          el.style.height = '';
          el.style.minHeight = '';
          el.style.alignSelf = '';
        }
      }
      return false;
    }

    const activeEl =
      document.activeElement && container.contains(document.activeElement) ? document.activeElement : null;
    const selStart = activeEl && 'selectionStart' in activeEl ? activeEl.selectionStart : null;
    const selEnd = activeEl && 'selectionEnd' in activeEl ? activeEl.selectionEnd : null;

    const frag = document.createDocumentFragment();
    renderedRows.forEach((visRow, rIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'layout-row';
      rowEl.dataset.layoutGroup = group;
      rowEl.dataset.rowIdx = String(rIdx);
      const solo = visRow.length === 1;
      const rowUnequal = applyRowSizing(rowEl, visRow);
      visRow.forEach((cell, cIdx) => {
        const id = String(cell.id);
        const el = elById.get(id);
        if (!el) return;
        rowEl.appendChild(el);
        if (!solo && cIdx < visRow.length - 1) {
          const gutter = document.createElement('div');
          gutter.className = 'layout-col-gutter';
          gutter.setAttribute('data-edit-chrome', '1');
          gutter.setAttribute('data-gutter-group', group);
          gutter.setAttribute('data-left-id', id);
          gutter.setAttribute('data-right-id', String(visRow[cIdx + 1].id));
          gutter.title = t('titleColResizer');
          gutter.draggable = false;
          const autoBtn = document.createElement('button');
          autoBtn.type = 'button';
          autoBtn.className = `gutter-auto-btn ${rowUnequal ? 'is-custom-sized' : ''}`;
          autoBtn.setAttribute('data-auto-row-group', group);
          autoBtn.setAttribute('data-auto-row-id', id);
          autoBtn.title = t('titleAutoSizeRow');
          autoBtn.textContent = '⤢';
          gutter.appendChild(autoBtn);
          rowEl.appendChild(gutter);
        }
      });
      frag.appendChild(rowEl);
    });

    for (const id of hiddenList) {
      const el = elById.get(id);
      if (el) {
        el.classList.add('hidden');
        el.style.flex = '';
        el.style.width = '';
        el.style.maxWidth = '';
        el.style.height = '';
        el.style.minHeight = '';
        el.style.alignSelf = '';
        frag.appendChild(el);
      }
    }

    container.innerHTML = '';
    container.appendChild(frag);
    container.dataset.layoutSig = sig;

    if (activeEl && document.contains(activeEl) && document.activeElement !== activeEl) {
      try {
        activeEl.focus({ preventScroll: true });
        if (selStart !== null && typeof activeEl.setSelectionRange === 'function') {
          activeEl.setSelectionRange(selStart, selEnd);
        }
      } catch {
        // ignore focus restore failure
      }
    }
    return true;
  }

  function renderEditVisibilityPills() {
    const box = document.getElementById('edit-visibility-pills');
    if (!box) return;
    const makeGroup = (label, groupKey, items, hiddenArr) => {
      const hiddenSet = new Set(hiddenArr || []);
      return (
        `<span class="vis-pill-group">${esc(label)}:</span>` +
        Object.entries(items)
          .map(([id, title]) => {
            const isHidden = hiddenSet.has(id);
            return `<button type="button" class="vis-pill ${isHidden ? 'is-hidden-pill' : ''}" data-hide-group="${groupKey}" data-hide-id="${esc(id)}">${isHidden ? '🙈' : '✓'} ${esc(title)}</button>`;
          })
          .join('')
      );
    };

    box.innerHTML =
      makeGroup(t('editGroupSections'), 'section', getSectionLabels(), state.layout.hiddenSections) +
      makeGroup(t('editGroupKpis'), 'kpi', getKpiLabels(), state.layout.hiddenKpis) +
      makeGroup(t('editGroupCharts'), 'chart', getChartLabels(), state.layout.hiddenCharts);
  }

  function applyDashboardLayout() {
    document.body.classList.toggle('dashboard-edit-mode', state.editMode);
    document.getElementById('dashboard-edit-banner')?.classList.toggle('hidden', !state.editMode);
    const editBtn = document.getElementById('btn-edit-dashboard');
    if (editBtn) {
      editBtn.classList.toggle('btn-active-filter', state.editMode);
      editBtn.textContent = state.editMode ? t('btnDone') : t('btnCustomize');
    }

    if (state.dashboard?.accounts) {
      const allAccIds = state.dashboard.accounts.map((a) => String(a.id));
      state.layout.bankRows = sanitizeRowListClient(state.layout.bankRows, allAccIds, 3);
      syncFlatOrdersFromRows();
    }

    ensureEditBars();

    renderLayoutContainer(
      document.getElementById('dashboard-sections'),
      state.layout.sectionRows,
      new Set(state.layout.hiddenSections || []),
      {
        group: 'section',
        itemSelector: ':scope > .dash-section[data-section-id], :scope > .layout-row > .dash-section[data-section-id]',
        getIdFn: (el) => el.dataset?.sectionId,
      }
    );

    renderLayoutContainer(
      document.getElementById('kpi-grid'),
      state.layout.kpiRows,
      new Set(state.layout.hiddenKpis || []),
      {
        group: 'kpi',
        itemSelector: ':scope > .kpi-card[data-widget-id], :scope > .layout-row > .kpi-card[data-widget-id]',
        getIdFn: (el) => el.dataset?.widgetId,
      }
    );

    renderLayoutContainer(
      document.getElementById('banks-grid'),
      state.layout.bankRows,
      new Set(),
      {
        group: 'bank',
        itemSelector: ':scope > .bank-card[data-bank-id], :scope > .layout-row > .bank-card[data-bank-id]',
        getIdFn: (el) => el.dataset?.bankId,
      }
    );

    renderLayoutContainer(
      document.getElementById('charts-grid'),
      state.layout.chartRows,
      new Set(state.layout.hiddenCharts || []),
      {
        group: 'chart',
        itemSelector: ':scope > .chart-card[data-widget-id], :scope > .layout-row > .chart-card[data-widget-id]',
        getIdFn: (el) => el.dataset?.widgetId,
      }
    );

    if (state.editMode) {
      renderEditVisibilityPills();
    }
    syncAutoSizeBannerControl();
  }

  function syncAutoSizeBannerControl() {
    const toggle = document.getElementById('edit-auto-size-toggle');
    if (!toggle) return;
    const allItems = Array.from(document.querySelectorAll('#dashboard-container [data-drag-group][data-drag-id]'));
    const manualCount = allItems.filter((el) => {
      const ms = state.layout.manualSizes?.[String(el.dataset.dragId)];
      return ms && (ms.w !== null || ms.h !== null);
    }).length;
    if (manualCount === 0 && state.layout.autoSize !== false) {
      toggle.checked = true;
      toggle.indeterminate = false;
    } else if (manualCount > 0 && manualCount < allItems.length && state.layout.autoSize !== false) {
      toggle.checked = false;
      toggle.indeterminate = true;
    } else {
      toggle.checked = false;
      toggle.indeterminate = false;
    }
  }

  function snapshotElementManualSize(el, id, axis = 'both') {
    const rect = el.getBoundingClientRect();
    state.layout.manualSizes = state.layout.manualSizes || {};
    const prev = state.layout.manualSizes[String(id)] || { w: null, h: null };
    const nextW = axis === 'w' || axis === 'both' ? Math.max(60, Math.round(rect.width)) : prev.w;
    const nextH = axis === 'h' || axis === 'both' ? Math.max(48, Math.round(rect.height)) : prev.h;
    state.layout.manualSizes[String(id)] = { w: nextW, h: nextH };
  }

  function enableItemAutoSize(group, id) {
    const sid = String(id);
    if (state.layout.manualSizes) delete state.layout.manualSizes[sid];
    if (state.layout.itemHeights) delete state.layout.itemHeights[sid];
    if (state.layout.itemWidths) delete state.layout.itemWidths[sid];
    const ctx = getGroupContext(group);
    const rows = ctx ? state.layout[ctx.rowsKey] : null;
    const pos = rows ? findRowCell(rows, sid) : null;
    if (pos) {
      rows[pos.r].forEach((cell) => {
        cell.w = 1;
      });
    }
    if (Object.keys(state.layout.manualSizes || {}).length === 0) {
      state.layout.autoSize = true;
    }
  }

  function setGlobalAutoSize(enabled) {
    if (enabled) {
      state.layout.autoSize = true;
      state.layout.manualSizes = {};
      state.layout.itemHeights = {};
      state.layout.itemWidths = {};
      for (const rowsKey of ['sectionRows', 'kpiRows', 'chartRows', 'bankRows']) {
        const rows = state.layout[rowsKey] || [];
        for (const row of rows) {
          for (const cell of row) {
            cell.w = 1;
          }
        }
      }
      resetAllLedgerColWidths();
    } else {
      state.layout.autoSize = false;
      state.layout.manualSizes = {};
      document.querySelectorAll('#dashboard-container [data-drag-group][data-drag-id]').forEach((el) => {
        if (el.classList.contains('hidden')) return;
        const grp = el.dataset.dragGroup;
        if (grp === 'section') return;
        const id = String(el.dataset.dragId || '');
        if (!id) return;
        snapshotElementManualSize(el, id, 'both');
      });
    }
    applyDashboardLayout();
    renderAllCharts();
    saveLayoutState(true);
  }

  function setEditMode(enabled) {
    state.editMode = Boolean(enabled);
    applyDashboardLayout();
    renderAllCharts();
  }

  function dropLayoutItemSpatial(group, srcId, targetId, pos) {
    const sId = String(srcId);
    const tId = String(targetId);
    if (!sId || !tId || sId === tId) return false;
    const ctx = getGroupContext(group);
    if (!ctx) return false;
    const rows = state.layout[ctx.rowsKey];
    if (!findRowCell(rows, sId) || !findRowCell(rows, tId)) return false;

    const removedInfo = removeCellFromRows(rows, sId);
    if (!removedInfo) return false;
    const movedCell = removedInfo.removed;
    const tPos = findRowCell(rows, tId);
    if (!tPos) {
      rows.push([movedCell]);
      return false;
    }

    if (pos === 'left' || pos === 'right') {
      const targetRow = rows[tPos.r];
      const visRow = targetRow.filter((c) => !ctx.hiddenSet.has(String(c.id)));
      const weightSource = visRow.length > 0 ? visRow : targetRow;
      const avgW = weightSource.reduce((s, c) => s + Number(c.w || 1), 0) / weightSource.length;
      movedCell.w = clampWeight(avgW);
      const insertIdx = pos === 'left' ? tPos.c : tPos.c + 1;
      targetRow.splice(insertIdx, 0, movedCell);
    } else {
      movedCell.w = 1;
      const insertRowIdx = pos === 'top' ? tPos.r : tPos.r + 1;
      rows.splice(insertRowIdx, 0, [movedCell]);
    }

    syncFlatOrdersFromRows();
    applyDashboardLayout();
    if (group === 'chart' || group === 'section') renderAllCharts();
    saveLayoutState(true);
    return true;
  }

  function moveLayoutItem2D(group, id, dir) {
    const sid = String(id);
    const ctx = getGroupContext(group);
    if (!ctx) return false;
    const rows = state.layout[ctx.rowsKey];
    const cur = findRowCell(rows, sid);
    if (!cur) return false;

    const isVisCell = (cell) => !ctx.hiddenSet.has(String(cell.id));
    const visRowIndices = [];
    rows.forEach((row, rIdx) => {
      if (row.some(isVisCell)) visRowIndices.push(rIdx);
    });
    const curVisRowPos = visRowIndices.indexOf(cur.r);
    const visInCurRow = rows[cur.r].filter(isVisCell);
    const curVisColPos = visInCurRow.findIndex((c) => String(c.id) === sid);
    if (curVisRowPos === -1 || curVisColPos === -1) return false;

    let changed = false;

    if (dir === 'left' || dir === 'right') {
      const step = dir === 'left' ? -1 : 1;
      const targetColPos = curVisColPos + step;
      if (targetColPos >= 0 && targetColPos < visInCurRow.length) {
        const neighborId = String(visInCurRow[targetColPos].id);
        const nIdx = rows[cur.r].findIndex((c) => String(c.id) === neighborId);
        const tmp = rows[cur.r][cur.c];
        rows[cur.r][cur.c] = rows[cur.r][nIdx];
        rows[cur.r][nIdx] = tmp;
        changed = true;
      } else {
        const adjVisRowPos = curVisRowPos + step;
        if (adjVisRowPos >= 0 && adjVisRowPos < visRowIndices.length) {
          const destRowRef = rows[visRowIndices[adjVisRowPos]];
          const removedInfo = removeCellFromRows(rows, sid);
          if (removedInfo) {
            const destVis = destRowRef.filter(isVisCell);
            const avgW = destVis.length
              ? destVis.reduce((s, c) => s + Number(c.w || 1), 0) / destVis.length
              : 1;
            removedInfo.removed.w = clampWeight(avgW);
            if (dir === 'left') {
              destRowRef.push(removedInfo.removed);
            } else {
              destRowRef.unshift(removedInfo.removed);
            }
            changed = true;
          }
        }
      }
    } else if (dir === 'up' || dir === 'down') {
      const step = dir === 'up' ? -1 : 1;
      if (visInCurRow.length > 1) {
        const removedInfo = removeCellFromRows(rows, sid);
        if (removedInfo) {
          removedInfo.removed.w = 1;
          const insertRowIdx = dir === 'up' ? removedInfo.prevRowIdx : removedInfo.prevRowIdx + 1;
          rows.splice(insertRowIdx, 0, [removedInfo.removed]);
          changed = true;
        }
      } else {
        const adjVisRowPos = curVisRowPos + step;
        if (adjVisRowPos >= 0 && adjVisRowPos < visRowIndices.length) {
          const targetRowIdx = visRowIndices[adjVisRowPos];
          const [movedRow] = rows.splice(cur.r, 1);
          const adjustedTargetIdx = targetRowIdx > cur.r ? targetRowIdx - 1 : targetRowIdx;
          const insertIdx = dir === 'up' ? adjustedTargetIdx : adjustedTargetIdx + 1;
          rows.splice(insertIdx, 0, movedRow);
          changed = true;
        }
      }
    }

    if (changed) {
      syncFlatOrdersFromRows();
      applyDashboardLayout();
      if (group === 'chart' || group === 'section') renderAllCharts();
      saveLayoutState(true);
    }
    return changed;
  }

  function computeDropZone(targetEl, clientX, clientY) {
    const rect = targetEl.getBoundingClientRect();
    const rx = clientX - rect.left;
    const ry = clientY - rect.top;
    const vBand = Math.min(54, Math.max(22, rect.height * 0.28));
    if (ry < vBand) return 'top';
    if (rect.height - ry < vBand) return 'bottom';
    return rx < rect.width / 2 ? 'left' : 'right';
  }

  function clearDropZoneClasses(el) {
    if (!el) return;
    el.classList.remove('drop-zone-top', 'drop-zone-bottom', 'drop-zone-left', 'drop-zone-right');
  }

  function initDashboardCustomizer() {
    const container = document.getElementById('dashboard-container');
    if (!container) return;

    let chartRaf = 0;
    const scheduleChartRedraw = () => {
      if (chartRaf) return;
      chartRaf = requestAnimationFrame(() => {
        chartRaf = 0;
        renderAllCharts();
      });
    };

    if ('ResizeObserver' in window) {
      const lastSizes = new WeakMap();
      const chartObserver = new ResizeObserver((entries) => {
        let dirty = false;
        for (const entry of entries) {
          const w = Math.round(entry.contentRect.width);
          const h = Math.round(entry.contentRect.height);
          if (w <= 0 || h <= 0) continue;
          const prev = lastSizes.get(entry.target);
          if (!prev || Math.abs(w - prev.w) >= 2 || Math.abs(h - prev.h) >= 3) {
            lastSizes.set(entry.target, { w, h });
            dirty = true;
          }
        }
        if (dirty) scheduleChartRedraw();
      });
      document.querySelectorAll('#charts-grid .chart-card').forEach((card) => chartObserver.observe(card));
    }

    container.addEventListener('click', (e) => {
      const toggleAutoBtn = e.target.closest('[data-toggle-auto-group]');
      if (toggleAutoBtn) {
        const group = toggleAutoBtn.dataset.toggleAutoGroup;
        const id = String(toggleAutoBtn.dataset.toggleAutoId || '');
        const itemEl = toggleAutoBtn.closest('[data-drag-group][data-drag-id]');
        if (!id || !itemEl) return;
        if (isItemAutoSized(group, id)) {
          snapshotElementManualSize(itemEl, id, 'both');
        } else {
          enableItemAutoSize(group, id);
        }
        applyDashboardLayout();
        if (group === 'chart' || group === 'section') renderAllCharts();
        saveLayoutState(true);
        return;
      }

      const autoRowBtn = e.target.closest('[data-auto-row-group]');
      if (autoRowBtn) {
        const group = autoRowBtn.dataset.autoRowGroup;
        const id = String(autoRowBtn.dataset.autoRowId || '');
        const ctx = getGroupContext(group);
        if (!ctx) return;
        const rows = state.layout[ctx.rowsKey];
        const pos = findRowCell(rows, id);
        if (pos) {
          rows[pos.r].forEach((cell) => {
            const cid = String(cell.id);
            cell.w = 1;
            if (state.layout.manualSizes) delete state.layout.manualSizes[cid];
            if (state.layout.itemHeights) delete state.layout.itemHeights[cid];
            if (state.layout.itemWidths) delete state.layout.itemWidths[cid];
          });
        }
        applyDashboardLayout();
        if (group === 'chart' || group === 'section') renderAllCharts();
        saveLayoutState(true);
        return;
      }

      const moveBtn = e.target.closest('[data-move-group]');
      if (moveBtn) {
        moveLayoutItem2D(
          moveBtn.dataset.moveGroup,
          moveBtn.dataset.moveId,
          moveBtn.dataset.moveDir
        );
        return;
      }

      const hideBtn = e.target.closest('[data-hide-group]');
      if (hideBtn) {
        toggleWidgetVisibility(hideBtn.dataset.hideGroup, hideBtn.dataset.hideId);
      }
    });

    // Prevent native HTML5 drag hijacking resize handles inside draggable cards
    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.gutter-auto-btn')) return;
      if (e.target.closest('.layout-col-gutter, .layout-height-resizer, .layout-width-resizer, .layout-corner-resizer')) {
        e.preventDefault();
      }
    });

    // Double-click any resize edge/corner/gutter to restore Auto Size ON
    container.addEventListener('dblclick', (e) => {
      if (!state.editMode) return;
      const gutter = e.target.closest('.layout-col-gutter');
      if (gutter) {
        e.preventDefault();
        e.stopPropagation();
        const group = gutter.dataset.gutterGroup;
        const leftId = gutter.dataset.leftId;
        const ctx = getGroupContext(group);
        if (!ctx) return;
        const rows = state.layout[ctx.rowsKey];
        const pos = findRowCell(rows, leftId);
        if (!pos) return;
        rows[pos.r].forEach((cell) => {
          cell.w = 1;
        });
        applyDashboardLayout();
        scheduleChartRedraw();
        saveLayoutState(true);
        return;
      }

      const handleEl = e.target.closest('.layout-width-resizer, .layout-height-resizer, .layout-corner-resizer');
      if (handleEl) {
        e.preventDefault();
        e.stopPropagation();
        const group = handleEl.dataset.widthGroup || handleEl.dataset.heightGroup || handleEl.dataset.cornerGroup;
        const id = String(handleEl.dataset.widthId || handleEl.dataset.heightId || handleEl.dataset.cornerId || '');
        if (!group || !id) return;
        enableItemAutoSize(group, id);
        applyDashboardLayout();
        if (group === 'chart' || group === 'section') scheduleChartRedraw();
        saveLayoutState(true);
      }
    });

    let resizeSession = null;

    const getRenderedVisRowCells = (rowEl, group, id) => {
      const ctx = getGroupContext(group);
      const rows = ctx ? state.layout[ctx.rowsKey] : null;
      const pos = rows ? findRowCell(rows, id) : null;
      if (!pos) return { visRow: [], cell: null, rows: null, pos: null };
      const visIds = new Set(
        Array.from(rowEl.children)
          .filter((ch) => ch.dataset?.dragId && !ch.classList.contains('hidden'))
          .map((ch) => String(ch.dataset.dragId))
      );
      const visRow = rows[pos.r].filter((c) => visIds.has(String(c.id)));
      return { visRow, cell: pos.cell, rows, pos };
    };

    container.addEventListener('pointerdown', (e) => {
      if (!state.editMode) return;
      if (e.button !== 0) return;

      const gutter = e.target.closest('.layout-col-gutter');
      if (gutter) {
        if (e.target.closest('.gutter-auto-btn')) return;
        e.preventDefault();
        e.stopPropagation();
        const leftEl = gutter.previousElementSibling;
        const rightEl = gutter.nextElementSibling;
        if (!leftEl || !rightEl) return;
        const group = gutter.dataset.gutterGroup;
        const leftId = String(gutter.dataset.leftId || '');
        const rightId = String(gutter.dataset.rightId || '');
        const ctx = getGroupContext(group);
        if (!ctx) return;
        const rows = state.layout[ctx.rowsKey];
        const leftCell = findRowCell(rows, leftId)?.cell;
        const rightCell = findRowCell(rows, rightId)?.cell;
        if (!leftCell || !rightCell) return;

        gutter.classList.add('active');
        resizeSession = {
          mode: 'col',
          group,
          handle: gutter,
          leftEl,
          rightEl,
          leftCell,
          rightCell,
          startX: e.clientX,
          startLeftPx: leftEl.getBoundingClientRect().width,
          startRightPx: rightEl.getBoundingClientRect().width,
          pairWeight: Number(leftCell.w || 1) + Number(rightCell.w || 1),
        };
        return;
      }

      const cornerEl = e.target.closest('.layout-corner-resizer');
      const wResizer = !cornerEl ? e.target.closest('.layout-width-resizer') : null;
      const hResizer = !cornerEl && !wResizer ? e.target.closest('.layout-height-resizer') : null;
      const handleEl = cornerEl || wResizer || hResizer;
      if (!handleEl) return;

      e.preventDefault();
      e.stopPropagation();
      const itemEl = handleEl.parentElement;
      const rowEl = itemEl?.parentElement;
      if (!itemEl || !rowEl) return;
      const group = handleEl.dataset.cornerGroup || handleEl.dataset.widthGroup || handleEl.dataset.heightGroup;
      const id = String(handleEl.dataset.cornerId || handleEl.dataset.widthId || handleEl.dataset.heightId || '');
      if (!group || !id) return;

      const axis = cornerEl ? 'both' : wResizer ? 'w' : 'h';
      const rect = itemEl.getBoundingClientRect();
      const { visRow, cell } = getRenderedVisRowCells(rowEl, group, id);
      const prev = state.layout.manualSizes?.[id] || { w: null, h: null };
      state.layout.manualSizes = state.layout.manualSizes || {};
      state.layout.manualSizes[id] = {
        w: axis === 'w' || axis === 'both' ? Math.max(60, Math.round(rect.width)) : prev.w,
        h: axis === 'h' || axis === 'both' ? Math.max(48, Math.round(rect.height)) : prev.h,
      };

      if (visRow.length > 0) {
        updateRowModeClass(rowEl, visRow);
        applyItemBoxStyle(itemEl, group, id, cell?.w || 1, visRow.length === 1);
      }

      handleEl.classList.add('active');
      const parentW = rowEl.parentElement?.getBoundingClientRect().width || window.innerWidth;
      resizeSession = {
        mode: 'free',
        axis,
        group,
        id,
        itemEl,
        rowEl,
        handle: handleEl,
        bounds: getItemMinBounds(group),
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height,
        maxW: Math.max(300, Math.round(parentW)),
        weight: cell?.w || 1,
        solo: visRow.length <= 1,
      };
    });

    document.addEventListener('pointermove', (e) => {
      if (!resizeSession) return;
      if (resizeSession.mode === 'col') {
        const pairPx = resizeSession.startLeftPx + resizeSession.startRightPx;
        if (pairPx <= 10) return;
        const dx = e.clientX - resizeSession.startX;
        const minPx = Math.min(pairPx * 0.35, Math.max(90, pairPx * 0.12));
        const newLeftPx = Math.max(minPx, Math.min(pairPx - minPx, resizeSession.startLeftPx + dx));
        const newRightPx = pairPx - newLeftPx;
        const leftW = clampWeight((newLeftPx / pairPx) * resizeSession.pairWeight);
        const rightW = clampWeight((newRightPx / pairPx) * resizeSession.pairWeight);
        resizeSession.leftCell.w = leftW;
        resizeSession.rightCell.w = rightW;
        resizeSession.leftEl.style.flex = `${leftW} 1 0px`;
        resizeSession.rightEl.style.flex = `${rightW} 1 0px`;
        if (resizeSession.group === 'chart' || resizeSession.group === 'section') {
          scheduleChartRedraw();
        }
      } else if (resizeSession.mode === 'free') {
        const entry = state.layout.manualSizes?.[resizeSession.id] || { w: null, h: null };
        if (resizeSession.axis === 'w' || resizeSession.axis === 'both') {
          const dx = e.clientX - resizeSession.startX;
          entry.w = Math.round(
            Math.max(resizeSession.bounds.minW, Math.min(resizeSession.maxW, resizeSession.startW + dx))
          );
        }
        if (resizeSession.axis === 'h' || resizeSession.axis === 'both') {
          const dy = e.clientY - resizeSession.startY;
          entry.h = Math.round(
            Math.max(resizeSession.bounds.minH, Math.min(1600, resizeSession.startH + dy))
          );
        }
        state.layout.manualSizes[resizeSession.id] = entry;
        applyItemBoxStyle(
          resizeSession.itemEl,
          resizeSession.group,
          resizeSession.id,
          resizeSession.weight,
          resizeSession.solo
        );
        if (resizeSession.group === 'chart' || resizeSession.group === 'section') {
          scheduleChartRedraw();
        }
      }
    });

    document.addEventListener('pointerup', () => {
      if (!resizeSession) return;
      resizeSession.handle?.classList.remove('active');
      const group = resizeSession.group;
      resizeSession = null;
      applyDashboardLayout();
      if (group === 'chart' || group === 'section') renderAllCharts();
      saveLayoutState(true);
    });

    let dragState = null;
    let dragOverEl = null;
    let dragOverPos = null;

    container.addEventListener('dragstart', (e) => {
      if (!state.editMode) return;
      if (e.target.closest('button, input, select, textarea, a, label, .col-resizer, .layout-col-gutter, .layout-height-resizer, .layout-width-resizer, .layout-corner-resizer')) {
        e.preventDefault();
        return;
      }
      const item = e.target.closest('[data-drag-group][data-drag-id]');
      if (!item) return;
      e.stopPropagation();
      dragState = {
        group: item.dataset.dragGroup,
        id: item.dataset.dragId,
        el: item,
      };
      item.classList.add('dragging-item');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `${dragState.group}:${dragState.id}`);
      }
    });

    container.addEventListener('dragover', (e) => {
      if (!dragState) return;
      const target = e.target.closest(`[data-drag-group="${dragState.group}"]`);
      if (!target || target === dragState.el) {
        if (dragOverEl) {
          clearDropZoneClasses(dragOverEl);
          dragOverEl = null;
          dragOverPos = null;
        }
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const pos = computeDropZone(target, e.clientX, e.clientY);
      if (dragOverEl === target && dragOverPos === pos) return;
      if (dragOverEl) clearDropZoneClasses(dragOverEl);
      dragOverEl = target;
      dragOverPos = pos;
      dragOverEl.classList.add(`drop-zone-${pos}`);
    });

    container.addEventListener('drop', (e) => {
      if (!dragState) return;
      const target = e.target.closest(`[data-drag-group="${dragState.group}"]`);
      if (!target || target === dragState.el) return;
      e.preventDefault();
      e.stopPropagation();
      const targetId = target.dataset.dragId;
      const pos = dragOverPos || computeDropZone(target, e.clientX, e.clientY);
      const { group, id } = dragState;
      clearDropZoneClasses(dragOverEl);
      dragOverEl = null;
      dragOverPos = null;
      dragState.el.classList.remove('dragging-item');
      dragState = null;
      dropLayoutItemSpatial(group, id, targetId, pos);
    });

    container.addEventListener('dragend', () => {
      clearDropZoneClasses(dragOverEl);
      dragOverEl = null;
      dragOverPos = null;
      if (dragState?.el) {
        dragState.el.classList.remove('dragging-item');
      }
      dragState = null;
    });
  }

  // -------------------- INITIALIZATION & EVENTS --------------------
  async function bootstrap() {
    // Apply initial language before binding/rendering
    if (window.MoneyI18n) {
      window.MoneyI18n.applyStaticTranslations();
      const handleLangChange = (val) => {
        window.MoneyI18n.setLang(val);
        state.layout.lang = window.MoneyI18n.getLang();
        saveLayoutState(true);
        if (state.dashboard) renderDashboard();
        if (document.getElementById('manage-accounts-modal').open) renderManageAccountsModal();
        if (document.getElementById('widgets-modal')?.open) renderWidgetsModal();
      };
      document.getElementById('lang-select')?.addEventListener('change', (e) => handleLangChange(e.target.value));
      document.getElementById('auth-lang-select')?.addEventListener('change', (e) => handleLangChange(e.target.value));
    }

    // Theme init (defaults to device color scheme and syncs live + on PWA/tab resume)
    syncThemeWithDevice(true);
    initPaletteControls();

    if (window.matchMedia) {
      const bindMedia = (queryStr) => {
        const mq = window.matchMedia(queryStr);
        const onChange = () => syncThemeWithDevice(false);
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
        else if (typeof mq.addListener === 'function') mq.addListener(onChange);
      };
      bindMedia('(prefers-color-scheme: light)');
      bindMedia('(prefers-color-scheme: dark)');
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncThemeWithDevice(false);
    });
    window.addEventListener('pageshow', () => syncThemeWithDevice(false));
    window.addEventListener('focus', () => syncThemeWithDevice(false));

    document.getElementById('btn-theme').addEventListener('click', () => {
      const currentMode = getThemeMode();
      if (currentMode === 'auto') {
        const opposite = getDeviceTheme() === 'dark' ? 'light' : 'dark';
        setThemeMode(opposite);
      } else {
        setThemeMode('auto');
      }
    });

    // Register PWA service worker (bypass HTTP cache and refresh once when an active PWA worker updates)
    if ('serviceWorker' in navigator) {
      const hadController = Boolean(navigator.serviceWorker.controller);
      let swReloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || swReloading) return;
        swReloading = true;
        window.location.reload();
      });
      navigator.serviceWorker
        .register('sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          reg.update().catch(() => {});
        })
        .catch(() => {});
    }

    // Modal close buttons & backdrop click-to-close
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => document.getElementById(btn.dataset.close)?.close());
    });
    if (document.body && typeof MutationObserver === 'function') {
      const modalObs = new MutationObserver(() => syncToastHost());
      modalObs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    }
    document.addEventListener('close', () => syncToastHost(), true);

    document.querySelectorAll('dialog.modal').forEach((dialog) => {
      dialog.addEventListener('close', () => syncToastHost());
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    });

    const appBridge = {
      api,
      esc,
      toast,
      refreshDashboard,
      refreshAllEntityManagers,
      populatePocketSelect,
      populateCategorySelect,
      selectOptionByTextOrValue,
      openImageLightbox,
    };

    document.addEventListener('keydown', (e) => {
      const lbModal = document.getElementById('image-lightbox-modal');
      if (!lbModal || !lbModal.open || !receiptLightboxViewer) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        receiptLightboxViewer.zoomBy(0.35);
      } else if (e.key === '-') {
        e.preventDefault();
        receiptLightboxViewer.zoomBy(-0.35);
      } else if (e.key === '0') {
        e.preventDefault();
        receiptLightboxViewer.resetView();
      } else if (e.key === 'r') {
        e.preventDefault();
        receiptLightboxViewer.rotateBy(90);
      } else if (e.key === 'R') {
        e.preventDefault();
        receiptLightboxViewer.rotateBy(-90);
      }
    });

    const receiptUI = window.MoneyReceipt.initReceiptScanner(appBridge);
    activeReceiptUI = receiptUI;
    const importerUI = window.MoneyImporterUI.initImporter(appBridge);

    // Note Modal & Receipt View/Attach Handlers
    document.getElementById('note-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = Number(document.getElementById('note-tx-id').value);
      const nextNote = document.getElementById('note-modal-input').value;
      if (!id) return;
      try {
        await api(`/api/transactions/${id}`, {
          method: 'PATCH',
          body: { note: nextNote, noteSource: nextNote.trim() ? 'manual' : 'auto' },
        });
        document.getElementById('note-modal').close();
        await refreshDashboard();
        toast(t('toastNoteUpdated'), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    document.getElementById('btn-note-regen-auto')?.addEventListener('click', async () => {
      const id = Number(document.getElementById('note-tx-id').value);
      if (!id) return;
      try {
        const res = await api(`/api/transactions/${id}`, {
          method: 'PATCH',
          body: { note: '', noteSource: 'auto' },
        });
        if (res.transaction) {
          document.getElementById('note-modal-input').value = res.transaction.note || '';
        }
        await refreshDashboard();
        toast(t('toastNoteRegenerated'), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    document.getElementById('btn-note-attach-receipt')?.addEventListener('click', () => {
      if (!currentNoteModalTx) return;
      document.getElementById('note-modal').close();
      receiptUI.openScanner({ attachTx: currentNoteModalTx });
    });

    document.getElementById('rv-replace-receipt-btn')?.addEventListener('click', () => {
      if (!currentViewingReceiptTx) return;
      document.getElementById('receipt-view-modal').close();
      receiptUI.openScanner({ attachTx: currentViewingReceiptTx });
    });

    document.getElementById('rv-edit-note-btn')?.addEventListener('click', () => {
      if (!currentViewingReceiptTx) return;
      document.getElementById('receipt-view-modal').close();
      openNoteModal(currentViewingReceiptTx);
    });

    document.getElementById('tx-attach-receipt-btn')?.addEventListener('click', () => {
      if (!currentEditingTxObj) return;
      document.getElementById('tx-modal').close();
      receiptUI.openScanner({ attachTx: currentEditingTxObj });
    });

    document.getElementById('tx-duplicate-btn')?.addEventListener('click', () => {
      if (!currentEditingTxObj || currentEditingTxObj.type === 'adjustment') return;
      openDuplicateTxModal(currentEditingTxObj);
    });

    // Setup form
    document.getElementById('setup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('setup-error');
      errEl.classList.add('hidden');
      const username = document.getElementById('setup-username').value.trim();
      const password = document.getElementById('setup-password').value;
      const confirm = document.getElementById('setup-password-confirm').value;
      if (password !== confirm) {
        errEl.textContent = t('passwordsMismatch');
        errEl.classList.remove('hidden');
        return;
      }
      try {
        const res = await api('/api/auth/setup', { method: 'POST', body: { username, password } });
        storePasswordCredential(null, username, password);
        showAppScreen(res.user, res.sessionTimeoutMinutes);
        await refreshDashboard();
        syncPushSubscriptionSilently();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });

    // Login form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const errEl = document.getElementById('login-error');
      errEl.classList.add('hidden');
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      try {
        const res = await api('/api/auth/login', { method: 'POST', body: { username, password } });
        storePasswordCredential(form, username, password);
        showAppScreen(res.user, res.sessionTimeoutMinutes);
        await refreshDashboard();
        syncPushSubscriptionSilently();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      showAuthScreen(true);
    });

    // Topbar & mobile nav buttons
    document.getElementById('btn-scan-receipt').addEventListener('click', receiptUI.openScanner);
    document.getElementById('mnav-scan').addEventListener('click', receiptUI.openScanner);

    document.getElementById('btn-add-tx').addEventListener('click', () => openTxModal({ type: 'expense' }));
    document.getElementById('mnav-add').addEventListener('click', () => openTxModal({ type: 'expense' }));

    document.getElementById('btn-transfer').addEventListener('click', () => openTxModal({ type: 'transfer' }));
    document.getElementById('mnav-transfer').addEventListener('click', () => openTxModal({ type: 'transfer' }));

    document.getElementById('btn-open-import').addEventListener('click', () => {
      document.getElementById('settings-modal')?.close();
      importerUI.openImporter();
    });
    document.getElementById('settings-hide-historical')?.addEventListener('change', (e) => {
      const liveOnly = Boolean(e.target.checked);
      setHistoricalMode(liveOnly ? 'live' : 'all', true);
      toast(t(liveOnly ? 'toastHistoricalHidden' : 'toastHistoricalShown'), 'ok');
    });

    document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
    document.getElementById('mnav-settings').addEventListener('click', openSettingsModal);

    document.getElementById('btn-toggle-archived').addEventListener('click', () => {
      state.showArchived = !state.showArchived;
      if (state.dashboard) {
        renderBanksGrid(state.dashboard.accounts);
        applyDashboardLayout();
      }
    });
    document.getElementById('btn-edit-dashboard').addEventListener('click', () => {
      setEditMode(!state.editMode);
    });
    document.getElementById('btn-done-layout').addEventListener('click', () => {
      setEditMode(false);
      toast(t('toastLayoutSaved'), 'ok');
    });
    document.getElementById('edit-hide-historical').addEventListener('change', (e) => {
      setHistoricalMode(e.target.checked ? 'live' : 'all', true);
    });
    document.getElementById('edit-auto-size-toggle')?.addEventListener('change', (e) => {
      const next = Boolean(e.target.checked);
      setGlobalAutoSize(next);
      toast(t(next ? 'toastAutoSizedAll' : 'toastAutoSizeOff'), 'ok');
    });
    document.getElementById('btn-reset-layout').addEventListener('click', () => {
      const keepLang = state.layout.lang || 'en';
      const keepPalette = state.layout.palette ? { ...state.layout.palette } : { preset: 'indigo' };
      const keepHideHistorical = Boolean(state.layout.hideHistorical);
      state.layout = normalizeLayout({
        ...DEFAULT_LAYOUT,
        lang: keepLang,
        palette: keepPalette,
        hideHistorical: keepHideHistorical,
      });
      if (state.dashboard?.accounts) {
        state.dashboard.accounts.sort((a, b) => a.id - b.id);
        const ids = state.dashboard.accounts.map((a) => String(a.id));
        state.layout.bankRows = sanitizeRowListClient([], ids, 3);
        syncFlatOrdersFromRows();
        renderBanksGrid(state.dashboard.accounts);
      }
      resetAllLedgerColWidths();
      applyDashboardLayout();
      renderAllCharts();
      saveLayoutState(true);
      toast(t('toastLayoutReset'), 'ok');
    });
    initDashboardCustomizer();
    document.getElementById('btn-choose-kpis')?.addEventListener('click', () => openWidgetsModal('kpis'));
    document.getElementById('btn-choose-charts')?.addEventListener('click', () => openWidgetsModal('charts'));
    document.getElementById('btn-charts-sync-ledger')?.addEventListener('click', () => {
      state.chartsFollowLedger = !state.chartsFollowLedger;
      refreshDashboard();
    });
    document.getElementById('charts-scope-actions')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-scope-action]');
      if (!btn) return;
      const action = btn.dataset.scopeAction;
      if (action === 'clear-selection') {
        document.getElementById('btn-bulk-clear')?.click();
      } else if (action === 'reset-filters') {
        document.getElementById('btn-reset-filters')?.click();
      } else if (action === 'relink') {
        state.chartsFollowLedger = true;
        refreshDashboard();
      }
    });
    document.getElementById('btn-widgets-reset-default')?.addEventListener('click', () => {
      document.getElementById('btn-reset-layout')?.click();
      renderWidgetsModal();
    });
    document.getElementById('btn-manage-accounts').addEventListener('click', openManageAccountsModal);
    document.getElementById('btn-add-bank').addEventListener('click', () => openBankModal());

    document.getElementById('btn-clear-scope').addEventListener('click', () => {
      state.filters.accountId = '';
      state.filters.pocketId = '';
      state.filters.page = 1;
      refreshDashboard();
    });

    const applyFilterChange = (patch, clearSelection = false) => {
      Object.assign(state.filters, patch, { page: 1 });
      if (clearSelection) {
        state.selectedTxIds.clear();
        state.lastClickedTxId = null;
      }
      refreshDashboard();
    };

    // Filters
    document.getElementById('month-filter').addEventListener('change', (e) => {
      applyFilterChange({ month: e.target.value });
    });
    document.getElementById('filter-account').addEventListener('change', (e) => {
      applyFilterChange({ accountId: e.target.value, pocketId: '' });
    });
    document.getElementById('filter-pocket').addEventListener('change', (e) => {
      applyFilterChange({ pocketId: e.target.value });
    });
    document.getElementById('filter-type').addEventListener('change', (e) => {
      applyFilterChange({ type: e.target.value });
    });
    document.getElementById('filter-category').addEventListener('change', (e) => {
      applyFilterChange({ categoryName: e.target.value });
    });
    document.getElementById('filter-sort')?.addEventListener('change', (e) => {
      applyFilterChange({ sort: e.target.value || 'date_desc' });
    });
    document.getElementById('filter-approval')?.addEventListener('change', (e) => {
      applyFilterChange({ approval: e.target.value });
    });
    document.getElementById('filter-visibility')?.addEventListener('change', (e) => {
      applyFilterChange({ visibility: e.target.value }, true);
    });
    document.getElementById('chip-filter-recurring')?.addEventListener('click', () => {
      applyFilterChange({ recurring: state.filters.recurring ? '' : '1' });
    });
    document.getElementById('chip-filter-excluded')?.addEventListener('click', () => {
      applyFilterChange({ excludedStats: state.filters.excludedStats ? '' : '1' });
    });
    document.getElementById('chip-filter-receipt')?.addEventListener('click', () => {
      applyFilterChange({ hasReceipt: state.filters.hasReceipt ? '' : '1' });
    });
    document.getElementById('chip-filter-notif')?.addEventListener('click', () => {
      applyFilterChange({ autoSource: state.filters.autoSource === 'notification' ? '' : 'notification' });
    });
    document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
      const searchEl = document.getElementById('filter-search');
      if (searchEl) searchEl.value = '';
      state.filters = {
        ...state.filters,
        accountId: '',
        pocketId: '',
        type: 'all',
        categoryName: 'all',
        approval: 'all',
        visibility: 'visible',
        historical: state.layout.hideHistorical ? 'live' : 'all',
        recurring: '',
        excludedStats: '',
        hasReceipt: '',
        autoSource: '',
        sort: 'date_desc',
        search: '',
        page: 1,
      };
      syncHistoricalControlsUI();
      state.selectedTxIds.clear();
      state.lastClickedTxId = null;
      refreshDashboard();
    });
    document.querySelectorAll('#ledger-table thead th.th-sortable').forEach((th) => {
      th.addEventListener('click', (e) => {
        if (e.target.closest('.col-resizer, .col-auto-btn')) return;
        const asc = th.dataset.sortAsc;
        const desc = th.dataset.sortDesc;
        const def = th.dataset.sortDefault || desc;
        if (state.filters.sort === desc) state.filters.sort = asc;
        else if (state.filters.sort === asc) state.filters.sort = desc;
        else state.filters.sort = def;
        state.filters.page = 1;
        refreshDashboard();
      });
    });
    document.getElementById('ledger-page-buttons')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ledger-page]');
      if (!btn || btn.disabled) return;
      const targetPage = Math.max(1, Number(btn.dataset.ledgerPage) || 1);
      if (targetPage === state.filters.page) return;
      state.filters.page = targetPage;
      refreshDashboard();
    });
    document.getElementById('ledger-page-size-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      const customEl = document.getElementById('ledger-page-size-custom');
      if (val === 'custom') {
        if (customEl) {
          customEl.classList.remove('hidden');
          customEl.value = String(state.layout.ledgerPageSize || 25);
          customEl.focus();
          customEl.select();
        }
        return;
      }
      applyLedgerPageSize(Number(val));
    });
    const customPageSizeInp = document.getElementById('ledger-page-size-custom');
    if (customPageSizeInp) {
      const commitCustomSize = () => {
        if (customPageSizeInp.classList.contains('hidden')) return;
        const val = Number(customPageSizeInp.value);
        if (!Number.isFinite(val) || val < 1) {
          customPageSizeInp.value = String(state.layout.ledgerPageSize || 25);
          return;
        }
        const clamped = sanitizePageSizeClient(val, 25);
        if (clamped !== state.layout.ledgerPageSize || state.filters.limit !== clamped) {
          applyLedgerPageSize(clamped);
        }
      };
      customPageSizeInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitCustomSize();
        }
      });
      customPageSizeInp.addEventListener('change', commitCustomSize);
    }
    document.getElementById('ledger-select-all')?.addEventListener('change', (e) => {
      const txs = state.dashboard?.transactions || [];
      if (e.target.checked) {
        txs.forEach((tx) => state.selectedTxIds.add(tx.id));
      } else {
        state.selectedTxIds.clear();
      }
      renderLedgerTable(txs, state.dashboard?.totalMatchingTransactions || txs.length);
      renderAnalyticsAndKpis();
    });
    document.getElementById('btn-bulk-view-charts')?.addEventListener('click', async () => {
      if (!state.chartsFollowLedger) {
        state.chartsFollowLedger = true;
        await refreshDashboard();
      } else {
        renderAnalyticsAndKpis();
      }
      document.getElementById('section-charts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('btn-bulk-clear')?.addEventListener('click', () => {
      state.selectedTxIds.clear();
      state.lastClickedTxId = null;
      const txs = state.dashboard?.transactions || [];
      renderLedgerTable(txs, state.dashboard?.totalMatchingTransactions || txs.length);
      renderAnalyticsAndKpis();
    });
    document.querySelectorAll('#ledger-bulk-bar [data-bulk-action]').forEach((btn) => {
      btn.addEventListener('click', () => executeBulkLedgerAction(btn.dataset.bulkAction));
    });
    document.getElementById('btn-bulk-apply-prop')?.addEventListener('click', () => {
      const propSel = document.getElementById('bulk-property-action');
      const act = propSel?.value;
      if (!act) return;
      executeBulkLedgerAction(act);
    });
    document.getElementById('btn-bulk-apply-cat')?.addEventListener('click', () => {
      const catSel = document.getElementById('bulk-category-select');
      const catId = Number(catSel?.value);
      if (!catId) return;
      executeBulkLedgerAction('set_category', { categoryId: catId });
    });
    initLedgerColumnResizer();
    document.getElementById('btn-filter-pending')?.addEventListener('click', () => {
      state.filters.approval = state.filters.approval === 'needs_approval' ? 'all' : 'needs_approval';
      state.filters.page = 1;
      refreshDashboard();
    });
    document.getElementById('btn-approve-all')?.addEventListener('click', async () => {
      try {
        const res = await api('/api/transactions/approve-all', { method: 'POST', body: {} });
        await refreshDashboard();
        toast(t('toastAllApproved', { count: res.approvedCount || 0 }), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    document.getElementById('filter-historical').addEventListener('change', (e) => {
      setHistoricalMode(e.target.value, true);
    });
    let searchTimer = null;
    document.getElementById('filter-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.filters.search = e.target.value.trim();
        state.filters.page = 1;
        refreshDashboard();
      }, 220);
    });

    // Transaction Modal Events
    document.querySelectorAll('#tx-modal .type-tab').forEach((btn) => {
      btn.addEventListener('click', () => setTxTypeTab(btn.dataset.txType));
    });

    document.getElementById('orig-mode-pocket').addEventListener('click', () => {
      txFlowState.origMode = 'pocket';
      syncFlowFromModes(true);
    });
    document.getElementById('orig-mode-external').addEventListener('click', () => {
      txFlowState.origMode = 'external';
      if (txFlowState.destMode === 'external') txFlowState.destMode = 'pocket';
      syncFlowFromModes(true);
    });
    document.getElementById('dest-mode-external').addEventListener('click', () => {
      txFlowState.destMode = 'external';
      if (txFlowState.origMode === 'external') txFlowState.origMode = 'pocket';
      syncFlowFromModes(true);
    });
    document.getElementById('dest-mode-pocket').addEventListener('click', () => {
      txFlowState.destMode = 'pocket';
      syncFlowFromModes(true);
    });
    document.getElementById('tx-flow-swap-btn')?.addEventListener('click', swapTxFlowSides);

    document.getElementById('tx-orig-account').addEventListener('change', () => {
      populatePocketsForAccount(
        document.getElementById('tx-orig-account'),
        document.getElementById('tx-orig-pocket')
      );
      syncCurrencyFromActivePocket();
    });
    document.getElementById('tx-orig-pocket').addEventListener('change', syncCurrencyFromActivePocket);

    document.getElementById('tx-dest-account').addEventListener('change', () => {
      populatePocketsForAccount(
        document.getElementById('tx-dest-account'),
        document.getElementById('tx-dest-pocket')
      );
      syncCurrencyFromActivePocket();
    });
    document.getElementById('tx-dest-pocket').addEventListener('change', syncCurrencyFromActivePocket);

    setupCounterpartyCombobox('in', 'tx-orig-external-input', 'tx-orig-external-list');
    setupCounterpartyCombobox('out', 'tx-dest-external-input', 'tx-dest-external-list');

    document.getElementById('tx-category')?.addEventListener('change', (e) => {
      e.target.dataset.userPicked = '1';
    });

    document.getElementById('tx-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('tx-id').value;
      const type = document.getElementById('tx-type').value;
      const noteText = document.getElementById('tx-note').value;

      const origPocketId = Number(document.getElementById('tx-orig-pocket').value);
      const destPocketId = Number(document.getElementById('tx-dest-pocket').value);
      const extInput =
        type === 'income'
          ? document.getElementById('tx-orig-external-input')
          : type === 'expense'
          ? document.getElementById('tx-dest-external-input')
          : null;
      let merchant = extInput ? extInput.value.trim() : '';
      if (extInput && merchant && extInput.dataset.forceNew !== '1' && (!id || extInput.dataset.userEdited === '1')) {
        const dir = type === 'income' ? 'in' : 'out';
        const { topMatch } = findBestClientCounterpartyMatch(merchant, dir);
        if (topMatch && topMatch.score >= 0.85) {
          merchant = topMatch.cp.name;
          extInput.value = merchant;
          applyCounterpartyDefaultCategory(topMatch.cp.default_category_id, false);
        }
      }

      const payload = {
        type,
        date: document.getElementById('tx-date').value,
        amount: Number(document.getElementById('tx-amount').value),
        currency: document.getElementById('tx-currency').value,
        pocketId: type === 'income' ? destPocketId : origPocketId,
        categoryId: Number(document.getElementById('tx-category').value),
        destPocketId: type === 'transfer' ? destPocketId : undefined,
        destAmount:
          type === 'transfer' && document.getElementById('tx-dest-amount').value
            ? Number(document.getElementById('tx-dest-amount').value)
            : undefined,
        merchant,
        note: noteText,
        noteSource: noteText.trim() ? 'manual' : 'auto',
        excludeFromAnalytics: Boolean(document.getElementById('tx-exclude-analytics')?.checked),
        isRecurring: Boolean(document.getElementById('tx-recurring')?.checked),
        isHistorical: Boolean(document.getElementById('tx-historical')?.checked),
      };

      try {
        if (id) {
          payload.needsApproval = 0;
          await api(`/api/transactions/${id}`, { method: 'PATCH', body: payload });
          toast(t('toastTxUpdated'), 'ok');
        } else {
          await api('/api/transactions', { method: 'POST', body: payload });
          toast(t('toastTxCreated'), 'ok');
        }
        document.getElementById('tx-modal').close();
        await refreshDashboard();
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    // Pocket & Sync & Bank Forms
    document.getElementById('pocket-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pocketId = document.getElementById('pm-pocket-id').value;
      const body = {
        accountId: Number(document.getElementById('pm-account-id').value),
        name: document.getElementById('pm-name').value.trim(),
        currency: document.getElementById('pm-currency').value,
        initialBalance: Number(document.getElementById('pm-initial').value) || 0,
        color: document.getElementById('pm-color').value,
        isDefault: document.getElementById('pm-default').checked,
        ...(pocketId ? { isArchived: document.getElementById('pm-archived').checked } : {}),
      };
      try {
        if (pocketId) {
          await api(`/api/pockets/${pocketId}`, { method: 'PATCH', body });
          toast(t('toastPocketUpdated'), 'ok');
        } else {
          await api('/api/pockets', { method: 'POST', body });
          toast(t('toastPocketCreated'), 'ok');
        }
        document.getElementById('pocket-modal').close();
        await refreshDashboard();
        refreshAllEntityManagers();
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    document.getElementById('pm-delete-btn').addEventListener('click', async () => {
      const pocketId = document.getElementById('pm-pocket-id').value;
      if (!pocketId) return;
      const choice = document.getElementById('pm-delete-move').value;
      await executeEntityDelete('pocket', pocketId, choice, 'pocket-modal');
    });

    document.getElementById('sync-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pid = Number(document.getElementById('sync-pocket-id').value);
      try {
        await api(`/api/pockets/${pid}/sync`, {
          method: 'POST',
          body: {
            targetBalance: Number(document.getElementById('sync-balance').value),
            mode: document.getElementById('sync-mode').value,
            date: document.getElementById('sync-date').value,
            note: document.getElementById('sync-note').value.trim(),
          },
        });
        document.getElementById('sync-modal').close();
        await refreshDashboard();
        toast(t('toastPocketSynced'), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    document.getElementById('bank-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const accId = document.getElementById('bm-account-id').value;
      const body = {
        name: document.getElementById('bm-name').value.trim(),
        currency: document.getElementById('bm-currency').value,
        initialBalance: Number(document.getElementById('bm-initial').value) || 0,
        color: document.getElementById('bm-color').value,
        ...(accId ? { isArchived: document.getElementById('bm-archived').checked } : {}),
      };
      try {
        if (accId) {
          await api(`/api/accounts/${accId}`, { method: 'PATCH', body });
          toast(t('toastBankUpdated'), 'ok');
        } else {
          await api('/api/accounts', { method: 'POST', body });
          toast(t('toastBankCreated'), 'ok');
        }
        document.getElementById('bank-modal').close();
        await refreshDashboard();
        refreshAllEntityManagers();
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    document.getElementById('bm-delete-btn').addEventListener('click', async () => {
      const accId = document.getElementById('bm-account-id').value;
      if (!accId) return;
      const choice = document.getElementById('bm-delete-move').value;
      await executeEntityDelete('account', accId, choice, 'bank-modal');
    });

    document.getElementById('cpm-update-prev')?.addEventListener('change', () => {
      cpmPrevTouched = true;
    });

    document.getElementById('cp-edit-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = Number(document.getElementById('cpm-id').value);
      const dir = document.getElementById('cpm-direction').value;
      const oldName = document.getElementById('cpm-old-name').value;
      const newName = document.getElementById('cpm-name').value.trim();
      const rawCat = document.getElementById('cpm-category').value;
      const categoryId = rawCat ? Number(rawCat) : null;
      const txCount = Number(document.getElementById('cpm-tx-count').value || 0);
      if (!id || !newName) return;

      const oldCp = (state.dashboard?.counterparties?.[dir] || []).find((x) => x.id === id);
      const nameChanged = newName !== oldName;
      const catChanged = oldCp ? Number(oldCp.default_category_id || 0) !== Number(categoryId || 0) : true;

      let updatePrevious = Boolean(document.getElementById('cpm-update-prev').checked);
      if (!cpmPrevTouched && txCount > 0 && (nameChanged || catChanged)) {
        const msg = nameChanged
          ? t('confirmUpdatePrevEntries', { oldName, newName, count: txCount })
          : t('confirmUpdatePrevEntriesCat', { name: newName, count: txCount });
        updatePrevious = window.confirm(msg);
      }

      try {
        const res = await api(
          `/api/counterparties/${id}?historical=${encodeURIComponent(state.filters.historical || 'all')}`,
          {
            method: 'PATCH',
            body: { name: newName, categoryId, updatePrevious },
          }
        );
        document.getElementById('cp-edit-modal').close();
        if (state.dashboard) {
          state.dashboard.counterparties = res.counterparties;
        }
        const savedCtx = activeCpEditContext;
        activeCpEditContext = null;
        if (savedCtx) {
          const inp = document.getElementById(savedCtx.inputId);
          if (inp && normText(inp.value) === normText(oldName)) {
            inp.value = res.item?.name || newName;
          }
          renderCounterpartyCombobox(savedCtx.direction, savedCtx.inputId, savedCtx.listId);
        }
        await refreshDashboard();
        refreshAllCounterpartyManagers();
        if (Number(res.updatedTransactions || 0) > 0) {
          toast(t('toastPredictionUpdatedWithPrev', { count: res.updatedTransactions }), 'ok');
        } else {
          toast(t('toastPredictionUpdated'), 'ok');
        }
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    // Settings Forms
    document.getElementById('settings-gemini-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { geminiModel: document.getElementById('set-gemini-model').value };
      const keyVal = document.getElementById('set-gemini-key').value.trim();
      if (keyVal) body.geminiApiKey = keyVal;
      try {
        await api('/api/settings', { method: 'PUT', body });
        document.getElementById('set-gemini-msg').textContent = t('geminiSaved');
        document.getElementById('set-gemini-key').value = '';
        const s = await api('/api/settings');
        document.getElementById('set-gemini-status').textContent = s.hasGeminiKey
          ? t('geminiStatusSet', { preview: s.geminiKeyPreview })
          : t('geminiStatusUnset');
        if (window.MoneyReceipt && typeof window.MoneyReceipt.renderVisionQuotaCard === 'function') {
          window.MoneyReceipt.renderVisionQuotaCard(
            document.getElementById('settings-gemini-quota'),
            s.geminiUsage,
            { hasKey: s.hasGeminiKey, esc }
          );
        }
        toast(t('geminiSaved'), 'ok');
      } catch (err) {
        document.getElementById('set-gemini-msg').textContent = err.message;
        toast(err.message, 'err');
      }
    });

    document.getElementById('btn-test-gemini').addEventListener('click', async () => {
      const msgEl = document.getElementById('set-gemini-msg');
      msgEl.textContent = t('testingGemini');
      try {
        const res = await api('/api/settings/test-gemini', {
          method: 'POST',
          body: {
            geminiApiKey: document.getElementById('set-gemini-key').value.trim() || undefined,
            geminiModel: document.getElementById('set-gemini-model').value,
          },
        });
        const okMsg = t('geminiConnected', { model: res.model });
        msgEl.textContent = okMsg;
        if (res.usage && window.MoneyReceipt && typeof window.MoneyReceipt.renderVisionQuotaCard === 'function') {
          window.MoneyReceipt.renderVisionQuotaCard(
            document.getElementById('settings-gemini-quota'),
            res.usage,
            { hasKey: true, esc }
          );
        }
        toast(okMsg, 'ok');
      } catch (err) {
        msgEl.textContent = err.message;
        toast(err.message, 'err');
      }
    });

    document.getElementById('settings-fx-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/settings', {
          method: 'PUT',
          body: {
            fxRates: {
              HUF: 1,
              EUR: Number(document.getElementById('fx-eur').value),
              USD: Number(document.getElementById('fx-usd').value),
              GBP: Number(document.getElementById('fx-gbp').value),
            },
          },
        });
        await refreshDashboard();
        document.getElementById('set-fx-msg').textContent = t('fxSaveSuccess');
        toast(t('fxToast'), 'ok');
      } catch (err) {
        document.getElementById('set-fx-msg').textContent = err.message;
        toast(err.message, 'err');
      }
    });

    document.getElementById('btn-refresh-fx').addEventListener('click', async () => {
      const msgEl = document.getElementById('set-fx-msg');
      msgEl.textContent = t('fetchingFx');
      try {
        const res = await api('/api/settings/refresh-fx', { method: 'POST' });
        document.getElementById('fx-eur').value = res.rates.EUR;
        document.getElementById('fx-usd').value = res.rates.USD;
        document.getElementById('fx-gbp').value = res.rates.GBP;
        await refreshDashboard();
        const fxMsg = t('fxUpdatedFrom', { source: res.source });
        msgEl.textContent = fxMsg;
        toast(fxMsg, 'ok');
      } catch (err) {
        const errMsg = t('fxFetchFailed', { msg: err.message });
        msgEl.textContent = errMsg;
        toast(errMsg, 'err');
      }
    });

    document.getElementById('settings-password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = document.getElementById('set-password-msg');
      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: {
            currentPassword: document.getElementById('pw-current').value,
            newPassword: document.getElementById('pw-new').value,
          },
        });
        e.target.reset();
        const okMsg = t('toastPasswordUpdated');
        if (msgEl) msgEl.textContent = okMsg;
        toast(okMsg, 'ok');
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message;
        toast(err.message, 'err');
      }
    });

    const saveSessionTimeout = async () => {
      const inp = document.getElementById('set-session-timeout');
      const msgEl = document.getElementById('set-timeout-msg');
      const mins = sanitizeSessionTimeout(inp?.value);
      if (inp) inp.value = String(mins);
      try {
        const res = await api('/api/settings', {
          method: 'PUT',
          body: { sessionTimeoutMinutes: mins },
        });
        const applied = sanitizeSessionTimeout(res.sessionTimeoutMinutes ?? mins);
        if (inp) inp.value = String(applied);
        startSessionCountdown(applied);
        const msg = t('toastTimeoutSaved', { minutes: applied });
        if (msgEl) msgEl.textContent = msg;
        toast(msg, 'ok');
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message;
        toast(err.message, 'err');
      }
    };

    document.getElementById('btn-save-session-timeout')?.addEventListener('click', saveSessionTimeout);
    document.getElementById('set-session-timeout')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveSessionTimeout();
      }
    });

    function formatTrashWindowLabel(mins) {
      const n = Number(mins);
      if (n <= 0) return t('trashOptOff');
      if (n === 15) return t('trashOpt15m');
      if (n === 60) return t('trashOpt1h');
      if (n === 1440) return t('trashOpt24h');
      if (n === 10080) return t('trashOpt7d');
      if (n === 43200) return t('trashOpt30d');
      if (n === 129600) return t('trashOpt90d');
      if (n >= 1440 && n % 1440 === 0) return `${n / 1440}d`;
      if (n >= 60 && n % 60 === 0) return `${n / 60}h`;
      return `${n}m`;
    }

    function formatTrashRemaining(remainingMs) {
      const mins = Math.max(1, Math.ceil((Number(remainingMs) || 0) / 60000));
      if (mins >= 1440) return `${Math.ceil(mins / 1440)}d`;
      if (mins >= 60) return `${Math.ceil(mins / 60)}h`;
      return `${mins}m`;
    }

    async function restoreTrashIds(ids, { all = false } = {}) {
      const res = await api('/api/transactions/trash/restore', {
        method: 'POST',
        body: all ? { all: true } : { ids },
      });
      await refreshDashboard();
      if (document.getElementById('trash-modal')?.open) {
        const trashData = await api('/api/transactions/trash');
        renderTrashModal(trashData);
      }
      toast(t('toastTxRestored', { count: res.restoredCount || 1 }), 'ok');
    }

    function renderTrashModal(data) {
      const items = data?.items || [];
      const retentionMinutes = Number(data?.retentionMinutes ?? 43200);
      const infoEl = document.getElementById('trash-retention-info');
      const listEl = document.getElementById('trash-list');
      const emptyEl = document.getElementById('trash-empty');
      const restoreAllBtn = document.getElementById('btn-trash-restore-all');
      const emptyBtn = document.getElementById('btn-trash-empty');

      if (infoEl) {
        infoEl.textContent =
          retentionMinutes > 0
            ? t('trashRetentionInfo', { window: formatTrashWindowLabel(retentionMinutes) })
            : t('trashDisabledInfo');
      }
      if (restoreAllBtn) restoreAllBtn.classList.toggle('hidden', items.length === 0);
      if (emptyBtn) emptyBtn.classList.toggle('hidden', items.length === 0);
      if (emptyEl) emptyEl.classList.toggle('hidden', items.length > 0);
      if (!listEl) return;

      listEl.innerHTML = items
        .map((item) => {
          const signedAmt =
            item.type === 'income'
              ? formatMoney(item.amount, item.currency, true)
              : item.type === 'expense'
              ? formatMoney(-item.amount, item.currency)
              : item.type === 'transfer'
              ? `⇄ ${formatMoney(item.amount, item.currency)}`
              : `= ${formatMoney(item.amount, item.currency)}`;
          const amtClass = item.type === 'income' ? 'positive' : item.type === 'expense' ? 'negative' : '';
          const route =
            item.type === 'transfer' && item.destPocketName
              ? `${esc(item.accountName)} · ${esc(item.pocketName)} → ${esc(item.destAccountName)} · ${esc(item.destPocketName)}`
              : `${esc(item.accountName)} · ${esc(item.pocketName)}${item.merchant ? ` · ${esc(item.merchant)}` : ''}`;
          const receiptTag = item.receiptPath ? ' 🧾' : '';
          return `
            <div class="trash-item">
              <div class="trash-item-main">
                <div class="trash-item-top">
                  <span class="${amtClass}">${esc(signedAmt)}</span>
                  <span>${esc(tCat(item.categoryName))}${receiptTag}</span>
                  <span class="trash-expiry-pill">${esc(t('trashExpiresIn', { time: formatTrashRemaining(item.remainingMs) }))}</span>
                </div>
                <div class="trash-item-meta">
                  <span>${esc(String(item.date || '').replace('T', ' '))}</span>
                  <span>${route}</span>
                  ${item.note ? `<span>“${esc(item.note.slice(0, 80))}${item.note.length > 80 ? '…' : ''}”</span>` : ''}
                </div>
              </div>
              <div class="trash-item-actions">
                <button type="button" class="btn btn-secondary small" data-trash-restore="${item.id}">${esc(t('btnTrashRestore'))}</button>
                <button type="button" class="btn btn-danger small" data-trash-purge="${item.id}">${esc(t('btnTrashDeleteForever'))}</button>
              </div>
            </div>
          `;
        })
        .join('');

      listEl.querySelectorAll('[data-trash-restore]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await restoreTrashIds([Number(btn.dataset.trashRestore)]);
          } catch (err) {
            btn.disabled = false;
            toast(err.message, 'err');
          }
        });
      });

      listEl.querySelectorAll('[data-trash-purge]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res = await api(`/api/transactions/trash/${Number(btn.dataset.trashPurge)}`, { method: 'DELETE' });
            const fresh = await api('/api/transactions/trash');
            renderTrashModal(fresh);
            await refreshDashboard();
            toast(t('toastTrashPurged', { count: res.purgedCount || 1 }), 'ok');
          } catch (err) {
            btn.disabled = false;
            toast(err.message, 'err');
          }
        });
      });
    }

    async function openTrashModal() {
      try {
        const data = await api('/api/transactions/trash');
        renderTrashModal(data);
        const modal = document.getElementById('trash-modal');
        if (modal && !modal.open) modal.showModal();
      } catch (err) {
        toast(err.message, 'err');
      }
    }

    document.getElementById('btn-open-trash')?.addEventListener('click', openTrashModal);
    document.getElementById('btn-settings-open-trash')?.addEventListener('click', openTrashModal);
    document.getElementById('btn-trash-restore-all')?.addEventListener('click', async () => {
      try {
        await restoreTrashIds([], { all: true });
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    document.getElementById('btn-trash-empty')?.addEventListener('click', async () => {
      if (!window.confirm(t('confirmTrashEmpty'))) return;
      try {
        const res = await api('/api/transactions/trash?all=1', { method: 'DELETE' });
        const fresh = await api('/api/transactions/trash');
        renderTrashModal(fresh);
        await refreshDashboard();
        toast(t('toastTrashPurged', { count: res.purgedCount || 0 }), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    document.getElementById('btn-save-trash-retention')?.addEventListener('click', async () => {
      const sel = document.getElementById('set-trash-retention');
      const msgEl = document.getElementById('set-trash-retention-msg');
      const mins = Number(sel?.value ?? 43200);
      try {
        const res = await api('/api/settings', {
          method: 'PUT',
          body: { trashRetentionMinutes: mins },
        });
        const applied = Number(res.trashRetentionMinutes ?? mins);
        const msg = t('toastTrashRetentionSaved', { window: formatTrashWindowLabel(applied) });
        if (msgEl) msgEl.textContent = msg;
        await refreshDashboard();
        toast(msg, 'ok');
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message;
        toast(err.message, 'err');
      }
    });

    const timerBadge = document.getElementById('session-timer-badge');
    if (timerBadge) {
      timerBadge.addEventListener('click', () => {
        resetInactivityTimer();
        openSettingsModal();
      });
      timerBadge.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          resetInactivityTimer();
          openSettingsModal();
        }
      });
    }

    const onUserActivity = () => resetInactivityTimer();
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'click', 'input', 'change', 'scroll'].forEach((evtName) => {
      document.addEventListener(evtName, onUserActivity, { passive: true, capture: true });
    });
    document.addEventListener('mousemove', onUserActivity, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.user) {
        tickSessionCountdown();
      }
    });

    // Notification Auto-Logger Controls
    const copyInputValue = async (inputId, toastKey) => {
      const inp = document.getElementById(inputId);
      if (!inp || !inp.value) return;
      try {
        await navigator.clipboard.writeText(inp.value);
      } catch {
        inp.select();
        document.execCommand?.('copy');
      }
      toast(t(toastKey), 'ok');
    };

    document.getElementById('btn-copy-webhook')?.addEventListener('click', () => {
      copyInputValue('set-webhook-url', 'toastWebhookCopied');
    });

    document.getElementById('btn-copy-macrodroid')?.addEventListener('click', () => {
      copyInputValue('set-macrodroid-body', 'toastMacrodroidCopied');
    });

    document.getElementById('btn-rotate-webhook')?.addEventListener('click', async () => {
      try {
        const res = await api('/api/settings/rotate-webhook-token', { method: 'POST' });
        const wUrl = new URL('api/notifications/webhook', window.location.href);
        wUrl.searchParams.set('token', res.webhookToken);
        const inp = document.getElementById('set-webhook-url');
        if (inp) inp.value = wUrl.toString();
        toast(t('toastWebhookRotated'), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    document.querySelectorAll('[data-settings-tab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        switchSettingsTab(tabBtn.dataset.settingsTab);
      });
    });

    // Scheduled Backups Form & Controls
    document.getElementById('bk-schedule-type')?.addEventListener('change', syncBackupFormVisibility);
    document.getElementById('bk-remote-protocol')?.addEventListener('change', (e) => {
      const proto = e.target.value;
      const ftpsMode = document.getElementById('bk-remote-ftps-mode')?.value || 'explicit';
      const portEl = document.getElementById('bk-remote-port');
      if (portEl) {
        portEl.value = proto === 'ftp' ? '21' : proto === 'ftps' ? (ftpsMode === 'implicit' ? '990' : '21') : proto === 'smb' ? '445' : '22';
      }
      syncBackupFormVisibility();
    });
    document.getElementById('bk-remote-ftps-mode')?.addEventListener('change', (e) => {
      const portEl = document.getElementById('bk-remote-port');
      if (portEl && (portEl.value === '21' || portEl.value === '990')) {
        portEl.value = e.target.value === 'implicit' ? '990' : '21';
      }
    });
    document.getElementById('bk-remote-auth-method')?.addEventListener('change', syncBackupFormVisibility);
    document.getElementById('bk-remote-pass')?.addEventListener('input', () => {
      backupUiState.clearPassword = false;
    });
    document.getElementById('btn-bk-clear-pass')?.addEventListener('click', () => {
      backupUiState.clearPassword = true;
      const pEl = document.getElementById('bk-remote-pass');
      if (pEl) pEl.value = '';
      const hEl = document.getElementById('bk-pass-hint');
      if (hEl) hEl.textContent = '';
    });
    document.getElementById('bk-remote-ssh-key')?.addEventListener('input', () => {
      backupUiState.clearSshKey = false;
    });

    async function saveBackupSettingsFromForm(showToast = true) {
      const payload = collectBackupPayloadFromForm();
      const res = await api('/api/backups/config', { method: 'PUT', body: payload });
      renderBackupSnapshot(res);
      if (showToast) toast(t('bkToastSaved'), 'ok');
      return res;
    }

    document.getElementById('backup-schedule-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = document.getElementById('bk-main-msg');
      try {
        await saveBackupSettingsFromForm(true);
        if (msgEl) msgEl.textContent = t('bkToastSaved');
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message;
        toast(err.message, 'err');
      }
    });

    async function runManualBackupTarget(target) {
      const msgEl = document.getElementById('bk-main-msg');
      const remoteMsgEl = document.getElementById('bk-remote-msg');
      try {
        if (msgEl) msgEl.textContent = t('bkToastStarted');
        await saveBackupSettingsFromForm(false);
        const res = await api('/api/backups/run', { method: 'POST', body: { target } });
        renderBackupSnapshot(res);
        if (res.result?.remote?.ok) {
          try {
            const remList = await api('/api/backups/remote/list');
            backupUiState.remoteFiles = remList.files || [];
            renderRemoteBackupList(backupUiState.remoteFiles);
          } catch {
            // ignore optional list refresh error
          }
        }
        const r = res.result || {};
        if (r.status === 'ok') {
          const text = t('bkToastRunOk', { filename: r.filename, size: formatBytesHuman(r.sizeBytes) });
          if (msgEl) msgEl.textContent = text;
          toast(text, 'ok');
        } else {
          const errMsg = r.remote?.error || r.local?.error || 'Check backup history';
          const text = t('bkToastRunPartial', { msg: errMsg });
          if (msgEl) msgEl.textContent = text;
          if (remoteMsgEl && r.remote?.error) remoteMsgEl.textContent = r.remote.error;
          toast(text, 'err');
        }
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message;
        toast(err.message, 'err');
      }
    }

    document.getElementById('btn-bk-run-now')?.addEventListener('click', () => runManualBackupTarget('all'));
    document.getElementById('btn-bk-run-local')?.addEventListener('click', () => runManualBackupTarget('local'));
    document.getElementById('btn-bk-run-remote')?.addEventListener('click', () => runManualBackupTarget('remote'));

    document.getElementById('btn-bk-test-remote')?.addEventListener('click', async () => {
      const msgEl = document.getElementById('bk-remote-msg');
      try {
        if (msgEl) msgEl.textContent = t('bkTestingRemote');
        const payload = collectBackupPayloadFromForm();
        const res = await api('/api/backups/remote/test', {
          method: 'POST',
          body: { remote: payload.remote },
        });
        if (msgEl) msgEl.textContent = res.message || 'OK';
        toast(res.message || 'Remote connection OK', 'ok');
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message;
        toast(err.message, 'err');
      }
    });

    document.getElementById('btn-bk-refresh-remote')?.addEventListener('click', async () => {
      const msgEl = document.getElementById('bk-remote-msg');
      try {
        if (msgEl) msgEl.textContent = t('bkLoadingRemote');
        const payload = collectBackupPayloadFromForm();
        if (payload.remote.host) {
          await saveBackupSettingsFromForm(false);
        }
        const res = await api('/api/backups/remote/list');
        backupUiState.remoteFiles = res.files || [];
        renderRemoteBackupList(backupUiState.remoteFiles);
        if (msgEl) {
          msgEl.textContent = t('bkLocalSummaryFmt', {
            count: backupUiState.remoteFiles.length,
            size: formatBytesHuman(res.totalBytes || 0),
          });
        }
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message;
        toast(err.message, 'err');
      }
    });

    const fillSampleNotif = (appVal, textVal) => {
      const appSel = document.getElementById('notif-test-app');
      const txtEl = document.getElementById('notif-test-text');
      if (appSel) appSel.value = appVal || '';
      if (txtEl) txtEl.value = textVal;
    };
    const getFirstAccountForPreset = (idx = 0) => {
      const active = (state.dashboard?.accounts || []).filter((a) => !a.is_archived);
      return active[idx] || active[0] || null;
    };
    document.getElementById('btn-sample-expense')?.addEventListener('click', () => {
      const acc = getFirstAccountForPreset(0);
      const cur = acc?.currency || 'HUF';
      const accName = acc?.name || '';
      fillSampleNotif(accName, `Card purchase: 8 450 ${cur}, Supermarket, Balance: 245 100 ${cur}`);
    });
    document.getElementById('btn-sample-income')?.addEventListener('click', () => {
      const acc = getFirstAccountForPreset(0);
      const cur = acc?.currency || 'HUF';
      const accName = acc?.name || '';
      fillSampleNotif(accName, `Incoming transfer +120 000 ${cur}, Partner: Employer, Reference: Monthly Salary`);
    });
    document.getElementById('btn-sample-transfer')?.addEventListener('click', () => {
      const acc = getFirstAccountForPreset(0);
      const cur = acc?.currency || 'HUF';
      const accName = acc?.name || '';
      const pockets = (acc?.pockets || []).filter((p) => !p.is_archived);
      const destPocket = pockets.find((p) => !p.is_default)?.name || pockets[1]?.name || 'Savings Pocket';
      fillSampleNotif(accName, `Transferred ${cur} 15,000 to ${destPocket}`);
    });

    document.getElementById('btn-test-notif')?.addEventListener('click', async () => {
      const msgEl = document.getElementById('set-notif-msg');
      const appName = document.getElementById('notif-test-app')?.value || '';
      const rawText = document.getElementById('notif-test-text')?.value.trim() || '';
      if (!rawText) return;
      try {
        const res = await api('/api/notifications/webhook', {
          method: 'POST',
          body: { app: appName, title: appName, text: rawText },
        });
        if (res.logged && res.transaction) {
          const msgVars = {
            merchant: res.transaction.merchant || tCat(res.transaction.category_name),
            amount: res.transaction.amount.toLocaleString(),
            currency: res.transaction.currency,
            account: res.transaction.account_name || '',
            pocket: res.transaction.pocket_name || '',
          };
          if (msgEl) {
            msgEl.textContent = t('notifLoggedMsg', msgVars);
          }
          await refreshDashboard();
          toast(t('notifLoggedMsg', msgVars), 'ok');
        } else {
          if (msgEl) msgEl.textContent = t('notifIgnoredMsg', { reason: res.reason || 'Ignored' });
          toast(t('notifIgnoredMsg', { reason: res.reason || 'Ignored' }), 'err');
        }
        api('/api/settings').then((s) => renderWebhookLogs(s.webhookLogs)).catch(() => {});
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message;
        toast(err.message, 'err');
      }
    });

    document.getElementById('btn-push-enable')?.addEventListener('click', async () => {
      if (!isWebPushSupported()) {
        toast(t('pwaPushStatusUnsupported'), 'err');
        return;
      }
      try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          toast(t('toastPushBlocked'), 'err');
          await updatePushSettingsUI();
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const { publicKey } = await api('/api/push/public-key');
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }
        const res = await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
        await updatePushSettingsUI(res.subscriptionCount);
        toast(t('toastPushEnabled'), 'ok');
      } catch (err) {
        toast(err.message || t('pwaPushStatusUnsupported'), 'err');
      }
    });

    document.getElementById('btn-push-disable')?.addEventListener('click', async () => {
      try {
        let count = 0;
        if ('serviceWorker' in navigator && 'PushManager' in window) {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            const endpoint = sub.endpoint;
            await sub.unsubscribe().catch(() => {});
            const res = await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint } });
            count = Number(res.subscriptionCount || 0);
          }
        }
        await updatePushSettingsUI(count);
        toast(t('toastPushDisabled'), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    document.getElementById('btn-push-test')?.addEventListener('click', async () => {
      try {
        const res = await api('/api/push/test', { method: 'POST' });
        toast(t('toastPushTestSent', { sent: res.sent || 0, total: res.total || 0 }), res.sent > 0 ? 'ok' : 'err');
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'mm-autolog-push' && state.user) {
          refreshDashboard().catch(() => {});
        }
      });
    }

    // Initial Auth check
    try {
      const status = await api('/api/auth/status');
      if (status.appVersion) renderAppVersion(status.appVersion);
      if (status.authenticated && status.user) {
        showAppScreen(status.user, status.sessionTimeoutMinutes);
        await refreshDashboard();
        syncPushSubscriptionSilently();
      } else {
        showAuthScreen(status.initialized);
      }
    } catch {
      showAuthScreen(true);
    }
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
