'use strict';

const { getLocalIsoDate, buildReceiptAutoNote } = require('./ledger');

const ALLOWED_EXPENSE_CATEGORIES = [
  'Shopping',
  'Tech & Electronics',
  'Fuel & Transport',
  'University & Dorm',
  'Food & Dining',
  'Bills & Subscriptions',
  'Entertainment',
  'Health & Fitness',
  'Other Expense',
];

const ALLOWED_INCOME_CATEGORIES = [
  'Work / Salary',
  'Scholarship',
  'Family & Gifts',
  'Other Income',
];

const ALLOWED_TRANSFER_CATEGORIES = [
  'Bank-to-Bank Transfer',
  'Pocket-to-Pocket Transfer',
  'Savings / Set Aside',
  'Pocket Reimbursement',
  'Internal Transfer',
];

function mapCategoryName(raw, txType = 'expense') {
  const type = String(txType || 'expense').toLowerCase();
  const lower = typeof raw === 'string' ? raw.trim().toLowerCase() : '';

  if (type === 'income') {
    const exactIn = ALLOWED_INCOME_CATEGORIES.find((c) => c.toLowerCase() === lower);
    if (exactIn) return exactIn;
    if (lower.includes('salary') || lower.includes('work') || lower.includes('wage') || lower.includes('fizu') || lower.includes('bér')) {
      return 'Work / Salary';
    }
    if (lower.includes('scholar') || lower.includes('ösztöndíj') || lower.includes('uni')) {
      return 'Scholarship';
    }
    if (lower.includes('family') || lower.includes('gift') || lower.includes('apa') || lower.includes('anya') || lower.includes('család') || lower.includes('ajándék')) {
      return 'Family & Gifts';
    }
    return 'Other Income';
  }

  if (type === 'transfer') {
    const exactTr = ALLOWED_TRANSFER_CATEGORIES.find((c) => c.toLowerCase() === lower);
    if (exactTr) return exactTr;
    if (lower.includes('saving') || lower.includes('set aside') || lower.includes('persely') || lower.includes('vault') || lower.includes('megtakarítás')) {
      return 'Savings / Set Aside';
    }
    if (lower.includes('reimburs') || lower.includes('vissza')) {
      return 'Pocket Reimbursement';
    }
    if (lower.includes('pocket') || lower.includes('zseb')) {
      return 'Pocket-to-Pocket Transfer';
    }
    if (lower.includes('bank')) {
      return 'Bank-to-Bank Transfer';
    }
    return 'Internal Transfer';
  }

  if (!lower) return 'Shopping';
  const exact = ALLOWED_EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  if (lower.includes('tech') || lower.includes('electr') || lower.includes('gadget') || lower.includes('pc')) {
    return 'Tech & Electronics';
  }
  if (lower.includes('fuel') || lower.includes('gas') || lower.includes('petrol') || lower.includes('transport') || lower.includes('mol') || lower.includes('omv') || lower.includes('shell')) {
    return 'Fuel & Transport';
  }
  if (lower.includes('uni') || lower.includes('dorm') || lower.includes('egyetem') || lower.includes('kollégium')) {
    return 'University & Dorm';
  }
  if (lower.includes('food') || lower.includes('dining') || lower.includes('restaur') || lower.includes('cafe') || lower.includes('coffee') || lower.includes('wolt') || lower.includes('foodora')) {
    return 'Food & Dining';
  }
  if (lower.includes('bill') || lower.includes('util') || lower.includes('subscr') || lower.includes('tele')) {
    return 'Bills & Subscriptions';
  }
  if (lower.includes('entertain') || lower.includes('cinema') || lower.includes('game')) {
    return 'Entertainment';
  }
  if (lower.includes('health') || lower.includes('pharm') || lower.includes('gym') || lower.includes('patika')) {
    return 'Health & Fitness';
  }
  if (lower.includes('shop') || lower.includes('grocer') || lower.includes('supermarket') || lower.includes('store')) {
    return 'Shopping';
  }
  return 'Other Expense';
}

function formatItemListText(items, maxItems = 25) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const parts = items
    .map((it) => {
      if (typeof it === 'string') return it.trim();
      if (!it || typeof it.name !== 'string' || !it.name.trim()) return '';
      const name = it.name.trim();
      const qty = Number(it.qty);
      return qty > 1 ? `${name} x${qty}` : name;
    })
    .filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length > maxItems) {
    return `${parts.slice(0, maxItems).join(', ')} (+${parts.length - maxItems} more)`;
  }
  return parts.join(', ');
}

function buildReceiptItemsNote(category, merchant, items, opts = {}) {
  return buildReceiptAutoNote({
    categoryName: category,
    merchant,
    items,
    storeAddress: opts.storeAddress || opts.store_address || '',
    currency: opts.currency || 'HUF',
  });
}

function normalizeBankHint(val) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed || /^(null|none|n\/a)$/i.test(trimmed)) return null;
  const bh = trimmed.toLowerCase();
  if (bh.includes('erste') || bh.includes('george')) return 'Erste';
  if (bh.includes('otp')) return 'OTP';
  if (bh.includes('revolut')) return 'Revolut';
  if (bh.includes('wise')) return 'Wise';
  return trimmed;
}

function buildDemoReceiptResult(filenameHint = '') {
  const lower = String(filenameHint || '').toLowerCase();
  const today = getLocalIsoDate();
  const demoWarn =
    'No Gemini API key configured yet, showing sample parsed result. Add your free Gemini API key in Settings for real photo & banking screenshot OCR.';

  if (
    lower.includes('screen') ||
    lower.includes('otp') ||
    lower.includes('erste') ||
    lower.includes('george') ||
    lower.includes('revolut') ||
    lower.includes('bank') ||
    lower.includes('transfer')
  ) {
    const bankHint = lower.includes('erste') || lower.includes('george')
      ? 'Erste'
      : lower.includes('revolut')
        ? 'Revolut'
        : 'OTP';

    if (lower.includes('transfer') || lower.includes('atvezetes') || lower.includes('persely') || lower.includes('vault')) {
      const destPocket = bankHint === 'OTP' ? 'persely számla' : bankHint === 'Revolut' ? 'Euro Vault' : 'Savings Pocket';
      return {
        mode: 'demo',
        warning: demoWarn,
        parsed: {
          source_type: 'bank_screenshot',
          tx_type: 'transfer',
          merchant: `Transfer to ${destPocket}`,
          date: today,
          time: '14:22',
          amount: 25000,
          currency: 'HUF',
          category: 'Savings / Set Aside',
          items: [
            { name: `From: ${bankHint} (${bankHint === 'Revolut' ? 'Main' : 'fo számla'})`, qty: 1, price: 25000 },
            { name: `To: ${bankHint} (${destPocket})`, qty: 1, price: 25000 },
          ],
          auto_note: `Savings transfer in ${bankHint} app to ${destPocket}`,
          card_last4: null,
          bank_hint: bankHint,
          pocket_hint: bankHint === 'Revolut' ? 'Main' : 'fo számla',
          dest_bank_hint: bankHint,
          dest_pocket_hint: destPocket,
          balance_after: null,
        },
      };
    }

    if (lower.includes('income') || lower.includes('salary') || lower.includes('jovairas') || lower.includes('received')) {
      return {
        mode: 'demo',
        warning: demoWarn,
        parsed: {
          source_type: 'bank_screenshot',
          tx_type: 'income',
          merchant: 'Acme Corp.',
          date: today,
          time: '09:14',
          amount: 345000,
          currency: 'HUF',
          category: 'Work / Salary',
          items: [{ name: 'Reference: Monthly salary transfer', qty: 1, price: 345000 }],
          auto_note: `Incoming transfer on ${bankHint} from Acme Corp. (Monthly salary transfer)`,
          card_last4: null,
          bank_hint: bankHint,
          pocket_hint: bankHint === 'Revolut' ? 'Main' : 'fo számla',
          dest_bank_hint: null,
          dest_pocket_hint: null,
          balance_after: null,
        },
      };
    }

    return {
      mode: 'demo',
      warning: demoWarn,
      parsed: {
        source_type: 'bank_screenshot',
        tx_type: 'expense',
        merchant: 'Wolt Magyarország',
        date: today,
        time: '18:45',
        amount: 6890,
        currency: 'HUF',
        category: 'Food & Dining',
        items: [{ name: 'Card purchase (•••• 4821)', qty: 1, price: 6890 }],
        auto_note: `${bankHint} card payment at Wolt Magyarország`,
        card_last4: '4821',
        bank_hint: bankHint,
        pocket_hint: bankHint === 'Revolut' ? 'Main' : 'fo számla',
        dest_bank_hint: null,
        dest_pocket_hint: null,
        balance_after: null,
      },
    };
  }

  if (lower.includes('mol') || lower.includes('omv') || lower.includes('shell') || lower.includes('fuel')) {
    const items = [{ name: 'EVO 95 Petrol (28.5 L)', qty: 1, price: 18500 }];
    const storeAddress = '789 Station Rd, Sample City';
    return {
      mode: 'demo',
      warning: 'No Gemini API key configured yet, showing sample parsed receipt. Add your free Gemini API key in Settings for real photo OCR.',
      parsed: {
        source_type: 'receipt',
        tx_type: 'expense',
        merchant: 'MOL Service Station',
        store_address: storeAddress,
        date: today,
        time: null,
        amount: 18500,
        currency: 'HUF',
        category: 'Fuel & Transport',
        items,
        auto_note: buildReceiptItemsNote('Fuel & Transport', 'MOL Service Station', items, {
          storeAddress,
          currency: 'HUF',
        }),
        card_last4: null,
        bank_hint: null,
        pocket_hint: null,
        dest_bank_hint: null,
        dest_pocket_hint: null,
        balance_after: null,
      },
    };
  }

  if (lower.includes('tech') || lower.includes('media') || lower.includes('alza') || lower.includes('apple')) {
    const items = [
      { name: 'USB-C 65W GaN Charger', qty: 1, price: 16990 },
      { name: 'Braided USB-C Cable 2m', qty: 1, price: 8000 },
    ];
    const storeAddress = '456 Market Ave, Sample City';
    return {
      mode: 'demo',
      warning: 'No Gemini API key configured yet, showing sample parsed receipt. Add your free Gemini API key in Settings for real photo OCR.',
      parsed: {
        source_type: 'receipt',
        tx_type: 'expense',
        merchant: 'Alza / MediaMarkt',
        store_address: storeAddress,
        date: today,
        time: null,
        amount: 24990,
        currency: 'HUF',
        category: 'Tech & Electronics',
        items,
        auto_note: buildReceiptItemsNote('Tech & Electronics', 'Alza / MediaMarkt', items, {
          storeAddress,
          currency: 'HUF',
        }),
        card_last4: null,
        bank_hint: 'Revolut',
        pocket_hint: null,
        dest_bank_hint: null,
        dest_pocket_hint: null,
        balance_after: null,
      },
    };
  }

  const sparItems = [
    { name: 'Milk & Dairy', qty: 2, price: 1450 },
    { name: 'Fresh Bakery Bread', qty: 1, price: 890 },
    { name: 'Chicken Breast', qty: 1, price: 3200 },
    { name: 'Coffee & Snacks', qty: 1, price: 2910 },
  ];
  const sparAddress = '123 Main Street, Sample City';
  return {
    mode: 'demo',
    warning: 'No Gemini API key configured yet, showing sample parsed receipt. Add your free Gemini API key in Settings for real photo OCR.',
    parsed: {
      source_type: 'receipt',
      tx_type: 'expense',
      merchant: 'SPAR Magyarország',
      store_address: sparAddress,
      date: today,
      time: null,
      amount: 8450,
      currency: 'HUF',
      category: 'Shopping',
      items: sparItems,
      auto_note: buildReceiptItemsNote('Shopping', 'SPAR Magyarország', sparItems, {
        storeAddress: sparAddress,
        currency: 'HUF',
      }),
      card_last4: null,
      bank_hint: null,
      pocket_hint: null,
      dest_bank_hint: null,
      dest_pocket_hint: null,
      balance_after: null,
    },
  };
}

function normalizeGeminiPayload(rawJson) {
  const sourceType =
    String(rawJson?.source_type || '').toLowerCase() === 'bank_screenshot'
      ? 'bank_screenshot'
      : 'receipt';
  const rawTxType = String(rawJson?.tx_type || 'expense').toLowerCase().trim();
  const txType = ['expense', 'income', 'transfer'].includes(rawTxType) ? rawTxType : 'expense';

  const merchant = String(rawJson?.merchant || 'Unknown Merchant').trim();
  const rawAddress = rawJson?.store_address ?? rawJson?.merchant_address ?? rawJson?.address ?? null;
  const storeAddress =
    typeof rawAddress === 'string' && rawAddress.trim() && !/^(null|none|n\/a)$/i.test(rawAddress.trim())
      ? rawAddress.trim()
      : null;
  let date = rawJson?.date ? String(rawJson.date).trim() : getLocalIsoDate();
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) {
    date = getLocalIsoDate();
  } else {
    date = date.slice(0, 10);
  }

  let time = null;
  if (typeof rawJson?.time === 'string') {
    const tMatch = /(\d{2}:\d{2})/.exec(rawJson.time.trim());
    if (tMatch) time = tMatch[1];
  }

  const rawAmount = Number(String(rawJson?.amount ?? 0).replace(/[^\d.-]/g, ''));
  const amount = Number.isFinite(rawAmount) && rawAmount !== 0 ? Math.abs(rawAmount) : 0;

  let currency = String(rawJson?.currency || 'HUF').trim().toUpperCase();
  if (currency === 'FT' || currency === 'FORINT') currency = 'HUF';
  if (!['HUF', 'EUR', 'USD', 'GBP'].includes(currency)) currency = 'HUF';

  const category = mapCategoryName(rawJson?.category, txType);
  const items = Array.isArray(rawJson?.items)
    ? rawJson.items
        .filter((it) => it && typeof it.name === 'string' && it.name.trim())
        .slice(0, 30)
        .map((it) => ({
          name: it.name.trim(),
          qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
          price: Number.isFinite(Number(it.price)) ? Number(it.price) : 0,
        }))
    : [];

  let autoNote = typeof rawJson?.auto_note === 'string' ? rawJson.auto_note.trim() : '';
  if (sourceType === 'receipt' && (items.length > 0 || storeAddress)) {
    autoNote = buildReceiptItemsNote(category, merchant, items, { storeAddress, currency });
  } else if (!autoNote) {
    if (items.length > 0 || storeAddress) {
      autoNote = buildReceiptItemsNote(category, merchant, items, { storeAddress, currency });
    } else {
      autoNote = `${category} at ${merchant}`;
    }
  }

  const bankHint = normalizeBankHint(rawJson?.bank_hint);
  const pocketHint =
    typeof rawJson?.pocket_hint === 'string' && rawJson.pocket_hint.trim()
      ? rawJson.pocket_hint.trim()
      : null;
  const destBankHint = normalizeBankHint(rawJson?.dest_bank_hint);
  const destPocketHint =
    typeof rawJson?.dest_pocket_hint === 'string' && rawJson.dest_pocket_hint.trim()
      ? rawJson.dest_pocket_hint.trim()
      : null;

  let balanceAfter = null;
  if (rawJson?.balance_after !== null && rawJson?.balance_after !== undefined && rawJson?.balance_after !== '') {
    const parsedBal = Number(String(rawJson.balance_after).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(parsedBal)) balanceAfter = parsedBal;
  }

  return {
    source_type: sourceType,
    tx_type: txType,
    merchant,
    store_address: storeAddress,
    date,
    time,
    amount,
    currency,
    category,
    items,
    auto_note: autoNote,
    card_last4: rawJson?.card_last4 ? String(rawJson.card_last4).trim() : null,
    bank_hint: bankHint,
    pocket_hint: pocketHint,
    dest_bank_hint: destBankHint,
    dest_pocket_hint: destPocketHint,
    balance_after: balanceAfter,
  };
}

const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
const FALLBACK_GEMINI_MODELS = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    source_type: { type: 'string' },
    tx_type: { type: 'string' },
    merchant: { type: 'string' },
    store_address: { type: ['string', 'null'] },
    date: { type: 'string' },
    time: { type: ['string', 'null'] },
    amount: { type: 'number' },
    currency: { type: 'string' },
    category: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          price: { type: 'number' },
        },
        required: ['name'],
      },
    },
    auto_note: { type: 'string' },
    card_last4: { type: ['string', 'null'] },
    bank_hint: { type: ['string', 'null'] },
    pocket_hint: { type: ['string', 'null'] },
    dest_bank_hint: { type: ['string', 'null'] },
    dest_pocket_hint: { type: ['string', 'null'] },
    balance_after: { type: ['number', 'null'] },
  },
  required: ['source_type', 'tx_type', 'merchant', 'amount', 'currency', 'category', 'auto_note'],
};

const TEST_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
  },
  required: ['ok', 'message'],
};

function resolveGeminiModel(model) {
  const clean = typeof model === 'string' ? model.trim() : '';
  if (!clean || /^gemini-(1|2)\./i.test(clean)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return clean;
}

function extractInteractionText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  if (Array.isArray(data?.steps)) {
    const parts = [];
    for (const step of data.steps) {
      if (step?.type === 'model_output' && Array.isArray(step.content)) {
        for (const item of step.content) {
          if (item?.type === 'text' && typeof item.text === 'string') {
            parts.push(item.text);
          }
        }
      }
    }
    if (parts.length > 0) return parts.join('');
  }
  if (Array.isArray(data?.outputs)) {
    const parts = data.outputs.map((o) => (typeof o?.text === 'string' ? o.text : '')).filter(Boolean);
    if (parts.length > 0) return parts.join('');
  }
  return '';
}

function extractUsageMetadata(data, headers) {
  const usage = data?.usage || data?.usageMetadata || {};
  const totalTokens = Number(
    usage.total_tokens ?? usage.totalTokens ?? usage.totalTokenCount ?? 0
  ) || 0;
  const remReqRaw = headers && typeof headers.get === 'function' ? headers.get('x-ratelimit-remaining-requests') : null;
  const remTokRaw = headers && typeof headers.get === 'function' ? headers.get('x-ratelimit-remaining-tokens') : null;
  return {
    totalTokens,
    remainingRequests: remReqRaw !== null && remReqRaw !== '' ? Number(remReqRaw) : null,
    remainingTokens: remTokRaw !== null && remTokRaw !== '' ? Number(remTokRaw) : null,
  };
}

function isRateLimitError(err) {
  if (!err) return false;
  if (err.status === 429) return true;
  return /quota|rate.?limit|resource_exhausted|too many requests/i.test(String(err.message || ''));
}

async function callGeminiInteraction(model, apiKey, inputItems, jsonSchema) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: inputItems,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: jsonSchema,
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `Gemini HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      if (isRateLimitError(err)) err.rateLimitHit = true;
      throw err;
    }

    const text = extractInteractionText(data);
    if (!text) {
      throw new Error('Gemini returned empty response.');
    }
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return {
      parsedJson: JSON.parse(cleaned),
      usageMeta: extractUsageMetadata(data, res.headers),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeReceiptImage(imageBuffer, mimeType, apiKey, preferredModel = DEFAULT_GEMINI_MODEL, filenameHint = '') {
  const cleanKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!cleanKey) {
    return buildDemoReceiptResult(filenameHint);
  }

  const prompt = `You are a financial OCR assistant capable of reading BOTH:
1) Paper or digital store receipts & invoices (source_type = "receipt")
2) Mobile or web banking app transaction screenshots (source_type = "bank_screenshot"), especially Hungarian & European banks:
   - OTP MobilBank / OTP SmartBank (green/white UI, "Jóváírás", "Terhelés", "Kártyás vásárlás", "Átvezetés", "Persely", "Közlemény", "Egyenleg") -> bank_hint: "OTP"
   - Erste George (Erste Bank Hungary UI, "George", "Könyvelt", "Zárolt", "Partner", "Közlemény", "Kártyás fizetés") -> bank_hint: "Erste"
   - Revolut (dark/light UI, "Main", "Vault", "Pocket", "Sent", "Received", "Exchanged", "Card ••••") -> bank_hint: "Revolut"

Analyze this image and extract exact transaction fields as JSON:
- source_type: "receipt" or "bank_screenshot"
- tx_type: "expense" (outgoing payment / purchase / negative amount / "Terhelés" / "Sent"), "income" (incoming deposit / credit / positive "+" / "Jóváírás" / "Received" / salary), or "transfer" (internal transfer between own banks/pockets/vaults / "Átvezetés" / "To Vault" / "Persely")
- merchant: Store/merchant name, OR sender/recipient/partner name on a banking screenshot
- store_address: Full street address / store location shown on the paper receipt (e.g. "123 Main Street, Sample City"), or null if not visible
- date: YYYY-MM-DD (or null if unreadable)
- time: HH:MM in 24-hour format if visible on the receipt or screenshot, else null
- amount: Positive number representing the absolute transaction total (in Hungarian numbers, spaces/dots are thousand separators and commas are decimals, e.g. "-12 450 Ft" -> 12450)
- currency: "HUF", "EUR", "USD", or "GBP"
- category:
  - If tx_type="expense": one of Shopping, Tech & Electronics, Fuel & Transport, University & Dorm, Food & Dining, Bills & Subscriptions, Entertainment, Health & Fitness, Other Expense
  - If tx_type="income": one of Work / Salary, Scholarship, Family & Gifts, Other Income
  - If tx_type="transfer": one of Bank-to-Bank Transfer, Pocket-to-Pocket Transfer, Savings / Set Aside, Pocket Reimbursement, Internal Transfer
- items: Array of { name, qty, price }. For receipts extract EVERY purchased line item (groceries, goods, etc.); for banking screenshots list key metadata lines such as payment reference ("Közlemény"), fee, or counterparty account if useful
- auto_note: For receipts with items, list all bought items cleanly after the store name (e.g. "Shopping at Spar: Milk, Bread x2, Apples, Coffee"); for banking screenshots include any payment reference ("Közlemény") if visible
- card_last4: Last 4 digits of bank card if visible, else null
- bank_hint: Detected bank or financial institution name shown on the screenshot (e.g. from app header or card brand), else null
- pocket_hint: Source pocket/vault/sub-account name if visible (e.g. "fo számla", "persely számla", "Main", "Euro Vault", "Savings Pocket"), else null
- dest_bank_hint: For transfers, destination bank or financial institution name if visible, else null
- dest_pocket_hint: For transfers, destination pocket/vault name if visible, else null
- balance_after: Numeric balance after transaction if displayed on the banking screenshot (e.g. "Egyenleg" / "Balance"), else null`;

  const inputItems = [
    { type: 'text', text: prompt },
    {
      type: 'image',
      data: imageBuffer.toString('base64'),
      mime_type: mimeType || 'image/jpeg',
    },
  ];

  const primaryModel = resolveGeminiModel(preferredModel);
  const candidates = Array.from(new Set([primaryModel, ...FALLBACK_GEMINI_MODELS]));
  let lastError = null;
  let rateLimitHit = false;
  const attemptedModels = [];

  for (const model of candidates) {
    attemptedModels.push(model);
    try {
      const { parsedJson, usageMeta } = await callGeminiInteraction(model, cleanKey, inputItems, RECEIPT_JSON_SCHEMA);
      return {
        mode: 'gemini',
        model,
        parsed: normalizeGeminiPayload(parsedJson),
        usageMeta: {
          ...usageMeta,
          rateLimitHit,
          attemptedModels,
        },
      };
    } catch (err) {
      lastError = err;
      if (isRateLimitError(err)) {
        rateLimitHit = true;
      }
      // Only fall back to next model if model not found / unsupported / overloaded, not on invalid API key
      if (err.status === 401 || err.status === 403 || String(err.message).toLowerCase().includes('api key not valid')) {
        throw err;
      }
    }
  }

  if (lastError) {
    lastError.rateLimitHit = rateLimitHit;
    throw lastError;
  }
  const err = new Error('Gemini receipt analysis failed.');
  err.rateLimitHit = rateLimitHit;
  throw err;
}

async function testGeminiConnection(apiKey, preferredModel = DEFAULT_GEMINI_MODEL) {
  const cleanKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!cleanKey) {
    throw new Error('Gemini API key is empty.');
  }
  const inputItems = [{ type: 'text', text: 'Return JSON: {"ok": true, "message": "connected"}' }];
  const primaryModel = resolveGeminiModel(preferredModel);
  const candidates = Array.from(new Set([primaryModel, ...FALLBACK_GEMINI_MODELS]));
  let lastErr = null;
  let rateLimitHit = false;
  for (const model of candidates) {
    try {
      const { parsedJson, usageMeta } = await callGeminiInteraction(model, cleanKey, inputItems, TEST_JSON_SCHEMA);
      return {
        ok: true,
        model,
        response: parsedJson,
        usageMeta: { ...usageMeta, rateLimitHit },
      };
    } catch (err) {
      lastErr = err;
      if (isRateLimitError(err)) rateLimitHit = true;
      if (err.status === 401 || err.status === 403) throw err;
    }
  }
  if (lastErr) {
    lastErr.rateLimitHit = rateLimitHit;
    throw lastErr;
  }
  throw new Error('Unable to reach Gemini API.');
}

function getModelQuotaLimits(model) {
  const lower = String(model || '').toLowerCase();
  if (lower.includes('flash-lite')) {
    return { dailyLimitEstimate: 500, rpmLimitEstimate: 15 };
  }
  return { dailyLimitEstimate: 250, rpmLimitEstimate: 10 };
}

function parseStoredGeminiUsage(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getGeminiUsageStats(db, getSettingFn, preferredModel = DEFAULT_GEMINI_MODEL) {
  const today = getLocalIsoDate();
  const saved = parseStoredGeminiUsage(getSettingFn(db, 'gemini_usage', ''));
  const sameDay = saved.date === today;

  const now = Date.now();
  const recentTimestamps = Array.isArray(saved.recentTimestamps)
    ? saved.recentTimestamps.filter((ts) => typeof ts === 'number' && now - ts < 60000 && ts <= now + 5000)
    : [];

  const activeModel = resolveGeminiModel(preferredModel || saved.lastModel || DEFAULT_GEMINI_MODEL);
  const { dailyLimitEstimate, rpmLimitEstimate } = getModelQuotaLimits(activeModel);

  const requestsToday = sameDay ? Number(saved.requestsToday || 0) : 0;
  const tokensToday = sameDay ? Number(saved.tokensToday || 0) : 0;
  const rateLimitHitsToday = sameDay ? Number(saved.rateLimitHitsToday || 0) : 0;
  const lastErrorStatus = sameDay && saved.lastErrorStatus != null ? Number(saved.lastErrorStatus) : null;
  const rpmUsed = recentTimestamps.length;

  const dailyPct = Math.min(100, Math.round((requestsToday / dailyLimitEstimate) * 100));
  const rpmPct = Math.min(100, Math.round((rpmUsed / rpmLimitEstimate) * 100));
  const nearLimit = Boolean(dailyPct >= 80 || rpmPct >= 80 || rateLimitHitsToday > 0);
  const status = lastErrorStatus === 429 || rateLimitHitsToday > 0 && dailyPct >= 95
    ? 'rate_limited'
    : nearLimit
      ? 'warning'
      : 'ok';

  return {
    date: today,
    requestsToday,
    tokensToday,
    rateLimitHitsToday,
    rpmUsed,
    dailyLimitEstimate,
    rpmLimitEstimate,
    dailyPct,
    rpmPct,
    nearLimit,
    status,
    lastModel: saved.lastModel || activeModel,
    lastScanAt: saved.lastScanAt || null,
    lastErrorStatus,
  };
}

function recordGeminiUsage(db, getSettingFn, setSettingFn, event = {}) {
  const today = getLocalIsoDate();
  const saved = parseStoredGeminiUsage(getSettingFn(db, 'gemini_usage', ''));
  const sameDay = saved.date === today;
  const now = Date.now();

  const recentTimestamps = Array.isArray(saved.recentTimestamps)
    ? saved.recentTimestamps.filter((ts) => typeof ts === 'number' && now - ts < 60000 && ts <= now + 5000)
    : [];
  if (event.counted !== false) {
    recentTimestamps.push(now);
  }

  const next = {
    date: today,
    requestsToday: (sameDay ? Number(saved.requestsToday || 0) : 0) + (event.counted !== false ? 1 : 0),
    tokensToday: (sameDay ? Number(saved.tokensToday || 0) : 0) + Number(event.tokens || 0),
    rateLimitHitsToday: (sameDay ? Number(saved.rateLimitHitsToday || 0) : 0) + (event.rateLimitHit ? 1 : 0),
    recentTimestamps: recentTimestamps.slice(-50),
    lastModel: resolveGeminiModel(event.model || saved.lastModel || DEFAULT_GEMINI_MODEL),
    lastScanAt: new Date(now).toISOString(),
    lastErrorStatus: event.errorStatus != null ? Number(event.errorStatus) : null,
  };

  setSettingFn(db, 'gemini_usage', JSON.stringify(next));
  return getGeminiUsageStats(db, getSettingFn, next.lastModel);
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  ALLOWED_EXPENSE_CATEGORIES,
  ALLOWED_INCOME_CATEGORIES,
  ALLOWED_TRANSFER_CATEGORIES,
  mapCategoryName,
  normalizeGeminiPayload,
  buildReceiptItemsNote,
  resolveGeminiModel,
  analyzeReceiptImage,
  testGeminiConnection,
  getGeminiUsageStats,
  recordGeminiUsage,
};
