'use strict';

/**
 * Multi-currency exchange rate helper.
 * Rates represent how many units of the base currency (default HUF) equal 1 unit of the given currency.
 * Example: { HUF: 1, EUR: 405.0, USD: 375.0, GBP: 480.0 }
 */

const DEFAULT_FX_RATES = {
  HUF: 1,
  EUR: 405.0,
  USD: 375.0,
  GBP: 480.0,
};

const SUPPORTED_CURRENCIES = ['HUF', 'EUR', 'USD', 'GBP'];

function normalizeCurrency(code, fallback = 'HUF') {
  if (!code || typeof code !== 'string') return fallback;
  const upper = code.trim().toUpperCase();
  if (upper === 'FT' || upper === 'FORINT') return 'HUF';
  if (upper === '€' || upper === 'EURO') return 'EUR';
  if (upper === '$' || upper === 'US$') return 'USD';
  if (upper === '£') return 'GBP';
  return SUPPORTED_CURRENCIES.includes(upper) ? upper : upper.slice(0, 5) || fallback;
}

function parseFxRates(raw) {
  if (!raw) return { ...DEFAULT_FX_RATES };
  if (typeof raw === 'object') {
    return mergeValidRates(raw);
  }
  try {
    const parsed = JSON.parse(raw);
    return mergeValidRates(parsed);
  } catch {
    return { ...DEFAULT_FX_RATES };
  }
}

function mergeValidRates(obj) {
  const out = { ...DEFAULT_FX_RATES };
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const cur = normalizeCurrency(k, '');
    const num = Number(v);
    if (cur && Number.isFinite(num) && num > 0) {
      out[cur] = num;
    }
  }
  out.HUF = 1;
  return out;
}

function roundCurrency(amount, currency = 'HUF') {
  const cur = normalizeCurrency(currency);
  const num = Number(amount) || 0;
  if (cur === 'HUF') {
    return Math.round(num * 100) / 100;
  }
  return Math.round(num * 100) / 100;
}

/**
 * Convert an amount from one currency to another using rates expressed in HUF per 1 unit.
 */
function convertCurrency(amount, fromCurrency, toCurrency, fxRates = DEFAULT_FX_RATES) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  if (from === to) return roundCurrency(num, to);

  const rates = mergeValidRates(fxRates);
  const fromRate = rates[from] || 1;
  const toRate = rates[to] || 1;
  const inHuf = num * fromRate;
  return roundCurrency(inHuf / toRate, to);
}

/**
 * Fetch live FX rates against HUF from open.er-api.com (no key required).
 */
async function fetchLiveFxRates() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/HUF', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`FX API HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || !data.rates) {
      throw new Error('Invalid FX API response');
    }
    // data.rates gives how many EUR/USD/GBP equal 1 HUF; invert to get HUF per 1 EUR/USD/GBP
    const updated = { ...DEFAULT_FX_RATES };
    for (const code of ['EUR', 'USD', 'GBP']) {
      const perHuf = Number(data.rates[code]);
      if (Number.isFinite(perHuf) && perHuf > 0) {
        updated[code] = Math.round((1 / perHuf) * 100) / 100;
      }
    }
    updated.HUF = 1;
    return { rates: updated, source: 'open.er-api.com', updatedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  DEFAULT_FX_RATES,
  SUPPORTED_CURRENCIES,
  normalizeCurrency,
  parseFxRates,
  roundCurrency,
  convertCurrency,
  fetchLiveFxRates,
};
