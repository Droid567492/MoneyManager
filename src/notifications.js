'use strict';

const {
  getLocalIsoDate,
  getLocalIsoDateTime,
  createTransaction,
  isGenericCounterpartyName,
  cleanRawMerchantString,
  findBestMatchingCounterparty,
} = require('./ledger');
const { mapCategoryName } = require('./gemini');

const VERIFICATION_REGEX =
  /(?:hitelesítő\s*kód|belépési\s*kód|egyszeri\s*kód|biztonsági\s*kód|megerősítő\s*kód|verification\s*code|security\s*code|passcode|one[- ]time\s*(?:password|code)|3d\s*secure|otp\s*kód)/i;

const TX_VERB_REGEX =
  /(?:vásárlás|vásároltál|fizetés|fizettél|utalás|átutalás|utaltál|utalt|küldött|küldtél|elküldtél|jóváírás|jóváírva|terhelés|átvezetés|készpénz|felvétel|befizetés|feltöltés|visszatérítés|visszautalás|leemelés|költöttél|beérkező|beérkezett|érkezett|kaptál|fogadtál|kereskedőnél|spent|paid|sent|received|credited|debited|transferred|moved|topped\s*up|top[- ]?up|purchase|payment|deposit|deposited|withdrawal|withdrawn|refund|refunded|cashback|charged|direct\s+debit)/i;

const PRICE_OR_MARKET_ALERT_REGEX =
  /(?:price\s+alert|target\s+price|hit\s+your\s+target|reached\s+your\s+target|exchange\s+rate\s+alert|rate\s+alert|fx\s+alert|currency\s+alert|stock\s+alert|crypto\s+alert|commodity\s+alert|market\s+alert|watchlist|\b(?:stock|share|crypto|token|etf|usd|eur|gbp|huf|btc|eth)\b[^\n]{0,40}\b(?:is\s+(?:up|down)|rose|fell|dropped|jumped|surged|hit\s+your|reached\s+your)\b|árfolyam(?:értesítés|riasztás|\s+elérte)|célár(?:folyam)?)/i;

const SECURITY_OR_PIN_ALERT_REGEX =
  /(?:security\s+pin|change\s+(?:your\s+)?(?:security\s+)?pin|recommend(?:ed)?\s+to\s+change|update\s+(?:your\s+)?(?:pin|password|passcode|security)|pin\s+(?:change|changed|reminder|reset|blocked|unblocked)|password\s+(?:change|changed|reset|expiry|reminder)|security\s+(?:alert|notice|recommendation|tip|checkup|reminder|update)|new\s+(?:device|login|sign[- ]in)|logged\s+in\s+(?:from|on)|sign[- ]in\s+attempt|biztonsági\s+(?:pin|értesítés|figyelmeztetés|ajánlás|javaslat)|pin[- ]?kód\s*(?:csere|módosítás|változtatás)|jelszó\s*(?:csere|módosítás|változtatás|emlékeztető)|statement\s+is\s+ready|monthly\s+statement|számlakivonat|havi\s+kivonat|scheduled\s+maintenance|karbantartás)/i;

const SOCIAL_OR_REQUEST_ALERT_REGEX =
  /(?:\breacted\b[\s\S]{0,40}\bto\s+your\b|\bliked\s+your\s+(?:payment|transfer)\b|\breagált\b[\s\S]{0,40}\b(?:fizetésedre|utalásodra|tranzakciódra)\b|\b(?:requested|is\s+requesting)\b[^\n]{0,40}\bfrom\s+you\b|\bpayment\s+request\b|\bsplit\s+bill\s+request\b|\bfizetési\s+kérelem\b|\bsent\s+you\s+a\s+(?:message|gif|sticker)\b|\büzenetet\s+küldött\b)/i;

const FAILED_TX_ALERT_REGEX =
  /(?:\b(?:declined|transaction\s+failed|payment\s+failed|transfer\s+failed|unsuccessful|insufficient\s+(?:funds|balance)|could\s+not\s+be\s+processed|was\s+not\s+completed|card\s+(?:frozen|blocked))\b|\b(?:sikertelen\s+(?:vásárlás|fizetés|tranzakció|utalás)|elutasított\s+(?:vásárlás|fizetés|tranzakció|utalás)|elutasítva|visszautasítva|fedezethiány|kártya\s+zárolva)\b)/i;

const PROMO_OR_REMINDER_ALERT_REGEX =
  /(?:\b(?:invite\s+(?:friends?|a\s+friend)|refer\s+a\s+friend|earn\s+up\s+to|get\s+up\s+to|win\s+up\s+to|cashback\s+offer|special\s+offer|upgrade\s+to\s+(?:plus|premium|metal|ultra)|upcoming\s+(?:payment|transfer|bill|subscription)|is\s+due\s+(?:tomorrow|soon|in\s+\d+\s+days)|payment\s+reminder)\b|\b(?:hívd\s+meg|ajánld\s+ismerőseidnek|nyerj\s+akár|esedékes\s+holnap|fizetési\s+emlékeztető)\b)/i;

const UI_CTA_TAIL_REGEX =
  /(?:[.\s]*\btap\s+to\s+(?:say\s+thank\s+you|view|reply|open|see|check|confirm)[^.\n]*$|[.\s]*\bkoppints\s+(?:a|az|ide|a\s+részletekért)[^.\n]*$)/i;

const GENERIC_TITLE_REGEX =
  /^(?:otp(?:\s+bank|\s+mobilbank|\s+smartbank)?|erste(?:\s+bank|\s+george)?|george|revolut|wise|azonnali\s+átutalás|átutalás|beérkező\s+utalás|kimenő\s+utalás|kártyás\s+(?:vásárlás|fizetés|tranzakció)|bankkártyás\s+(?:vásárlás|fizetés)|sikeres\s+(?:online\s+|kártyás\s+|bankkártyás\s+|pos\s+)?(?:vásárlás|fizetés|tranzakció|átutalás|utalás|jóváírás|terhelés)|(?:online|sikeres)\s+(?:vásárlás|fizetés|tranzakció)|vásárlás|fizetés|tranzakció|értesítés|jóváírás|terhelés|átvezetés|fizetés\s+érkezett|card\s+payment|bank\s+card\s+payment|instant\s+transfer|transfer|payment(?:\s+(?:received|sent))?|money\s+(?:received|sent)|transaction|alert|notification)$/i;

function normalizeAmountNumber(rawNumStr) {
  if (!rawNumStr) return 0;
  let cleaned = String(rawNumStr).replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = cleaned.split(',');
    if (parts[parts.length - 1].length === 2 || parts[parts.length - 1].length === 1) {
      cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasDot) {
    const parts = cleaned.split('.');
    if (parts[parts.length - 1].length === 3 && parts.length > 1) {
      cleaned = parts.join('');
    }
  }

  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function normalizeCurrencyCode(rawCur) {
  const c = String(rawCur || 'HUF').trim().toUpperCase();
  if (c === 'FT' || c === 'HUF' || c === 'FORINT') return 'HUF';
  if (c === '€' || c === 'EUR') return 'EUR';
  if (c === '$' || c === 'USD') return 'USD';
  if (c === '£' || c === 'GBP') return 'GBP';
  return 'HUF';
}

function matchBankInText(text, dbAccounts = []) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return null;
  const sorted = [...(dbAccounts || [])].sort(
    (a, b) => String(b.name || '').length - String(a.name || '').length
  );
  for (const acc of sorted) {
    const nameLower = String(acc.name || '').trim().toLowerCase();
    const slugLower = String(acc.slug || '').trim().toLowerCase();
    if (nameLower && nameLower.length >= 2 && hay.includes(nameLower)) return acc.name;
    if (slugLower && slugLower.length >= 2 && hay.includes(slugLower)) return acc.name;
  }
  if (hay.includes('otp') || hay.includes('mobilbank') || hay.includes('smartbank') || hay.includes('hu.otpbank')) {
    return 'OTP';
  }
  if (hay.includes('erste') || hay.includes('george') || hay.includes('hu.erstebank') || hay.includes('spardat')) {
    return 'Erste';
  }
  if (hay.includes('revolut') || hay.includes('com.revolut')) {
    return 'Revolut';
  }
  return null;
}

function detectBankHint(pkg, app, title, body, dbAccounts = []) {
  // Check the notification's originating app/package first so counterparty mentions never override the sender bank.
  const appSource = [pkg, app].filter(Boolean).join(' ');
  const fromApp = matchBankInText(appSource, dbAccounts);
  if (fromApp) return fromApp;

  const fromTitle = matchBankInText(title, dbAccounts);
  if (fromTitle) return fromTitle;

  return matchBankInText(body, dbAccounts);
}

function resolveBankMainPocketId(db, bankHint) {
  if (!bankHint || typeof bankHint !== 'string') return null;
  const cleanBank = bankHint.trim().toLowerCase();
  if (!cleanBank) return null;

  const query = `
    SELECT p.id, p.name AS pocket_name, a.name AS account_name
    FROM pockets p
    JOIN accounts a ON a.id = p.account_id
    WHERE a.is_archived = 0 AND p.is_archived = 0
      AND (LOWER(a.name) = ? OR LOWER(a.slug) = ? OR LOWER(a.name) LIKE ?)
    ORDER BY
      CASE WHEN LOWER(a.name) = ? THEN 0 ELSE 1 END ASC,
      p.is_default DESC,
      CASE WHEN LOWER(p.name) IN ('main', 'fo számla', 'fő számla', 'főszámla') THEN 0 ELSE 1 END ASC,
      p.id ASC
    LIMIT 1
  `;
  const row = db.prepare(query).get(cleanBank, cleanBank, `%${cleanBank}%`, cleanBank);
  return row ? row.id : null;
}

function stripUnexpandedMagicText(raw) {
  const cleaned = String(raw || '')
    .replace(/\{(?:not_|notification|trigger_|lv=)[^}]*\}/gi, ' ')
    .replace(/\[(?:not_|notification|trigger_|lv=)[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ');
  if (words.length >= 2 && words.length % 2 === 0) {
    const mid = words.length / 2;
    if (words.slice(0, mid).join(' ') === words.slice(mid).join(' ')) {
      return words.slice(0, mid).join(' ');
    }
  }
  return cleaned;
}

function stripUiCtaTails(raw) {
  return String(raw || '').replace(UI_CTA_TAIL_REGEX, '').trim();
}

function extractAmountAndCurrency(text) {
  const afterUnit = /([+-]?)\s*(\d[\d\s.,]*\d|\d)\s*(?:,-|,\s*-)?\s*(HUF|Ft|EUR|USD|GBP|€|\$|£)/i.exec(text);
  const beforeUnit = /([+-]?)\s*(HUF|Ft|EUR|USD|GBP|€|\$|£)\s*(\d[\d\s.,]*\d|\d)/i.exec(text);

  let match = null;
  let sign = '';
  let numStr = '';
  let curStr = '';

  if (afterUnit && (!beforeUnit || afterUnit.index <= beforeUnit.index)) {
    match = afterUnit;
    sign = afterUnit[1] || '';
    numStr = afterUnit[2];
    curStr = afterUnit[3];
  } else if (beforeUnit) {
    match = beforeUnit;
    sign = beforeUnit[1] || '';
    curStr = beforeUnit[2];
    numStr = beforeUnit[3];
  }

  if (!match) return { amount: 0, currency: 'HUF', sign: '' };
  return {
    amount: normalizeAmountNumber(numStr),
    currency: normalizeCurrencyCode(curStr),
    sign,
  };
}

function detectMoneyflowDirection(title, bodyWithoutBalance, sign) {
  const full = stripUiCtaTails(`${title} ${bodyWithoutBalance}`).toLowerCase();

  // 1. Explicit internal vault / pocket transfer (only when moving to an own pocket/vault)
  const hasInternalTransfer =
    /(?:persely\s*számla|euro\s*vault|savings\s*pocket|\b(?:transferred|moved)\s+[^\n]*?\b(?:to|into)\s+[\w\s]*vault\b|\bátvezetés\b)/i.test(
      full
    ) && !/(?:vásárlás|purchase|\bspent\b|\bsent\s+you\b|\bpaid\s+you\b)/i.test(full);
  if (hasInternalTransfer) {
    return 'transfer';
  }

  // 2. Explicit incoming moneyflow (checked before generic outgoing words like "sent" or "paid")
  const hasExplicitIncome =
    /(?:\bsent\s+you\b|\bpaid\s+you\b|\btransferred\s+(?:money\s+)?to\s+you\b|\bsent\s+to\s+your\b|\byou\s+received\b|\breceived\b|\badded\b[^\n]*\bto\s+your\b|\btopped\s+up\b|\btop[- ]?up\b|\brefund(?:ed)?\b|\bcashback\b|\breward\b|\bcredited\b|\bdeposit(?:ed)?\b|\bincoming\b|\bmoney\s+received\b|\bpayment\s+received\b|\bküldött\s+neked\b|\butalt\s+neked\b|\bfizetett\s+neked\b|\bjóváírás\b|\bjóváírva\b|\bbeérkező\b|\bbeérkezett\b|\bérkezett\b|\bkaptál\b|\bfogadtál\b|\bvisszatérítés\b|\bvisszautalás\b|\bfeltöltés\b|\bbefizetés\b|\bmunkabér\b|\bösztöndíj\b|\bfizetés\s+érkezett\b)/i.test(
      full
    );
  if (hasExplicitIncome && sign !== '-') {
    return 'income';
  }

  // 3. Explicit negative amount sign or explicit outgoing payment verbs
  const hasExplicitExpense =
    sign === '-' ||
    /(?:\byou\s+(?:spent|paid|sent)\b|\b(?:spent|paid)\s+(?:at|in|to|on)\b|\bsent\s+(?!you\b)|\bcard\s+payment\b|\bpurchase\b|\bdebited\b|\bwithdrawal\b|\bdirect\s+debit\b|\bkártyás\s+(?:vásárlás|fizetés|tranzakció)\b|\bsikeres\s+(?:kártyás\s+)?(?:vásárlás|fizetés)\b|\bterhelés\b|\bleemelés\b|\bkészpénzfelvétel\b|\bfizettél\b|\bküldtél\b|\belküldtél\b|\butaltál\b|\bköltöttél\b|\bkimenő\s+utalás\b|\bazonnali\s+átutalás\s+teljesült\b)/i.test(
      full
    );
  if (hasExplicitExpense) {
    return 'expense';
  }

  // 4. Explicit plus sign with no outgoing indicators
  if (sign === '+') {
    return 'income';
  }

  return 'expense';
}

function cleanMerchantName(raw) {
  let s = stripUiCtaTails(raw)
    .replace(/^(?:a(?:\(z\)|z)?|the)\s+/i, '')
    .replace(/\s*(?:kereskedőnél|webshopjában|webshopban|webáruházában|webáruházban|üzletében|üzletben|boltjában|boltban|kártyával|kártya|egyenleg|balance|közlemény|reference).*$/i, '')
    .replace(/[.,;:\-]+$/, '')
    .trim();
  s = cleanRawMerchantString(s);
  if (!s || isGenericCounterpartyName(s)) return '';
  return s.slice(0, 80);
}

function isGenericTitle(title, dbAccounts = []) {
  const stripped = String(title || '')
    .replace(/^[\s!?.:;,\-–—]+|[\s!?.:;,\-–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return true;
  if (GENERIC_TITLE_REGEX.test(stripped) || isGenericCounterpartyName(stripped)) return true;
  for (const acc of dbAccounts || []) {
    if (String(acc.name || '').trim().toLowerCase() === stripped.toLowerCase()) return true;
  }
  return false;
}

function inferExpenseCategory(text, merchant, txType) {
  const mapped = mapCategoryName(`${stripUiCtaTails(text)} ${merchant}`, txType);
  if (txType === 'expense' && (mapped === 'Other Expense' || mapped === 'Shopping')) {
    const combined = `${stripUiCtaTails(text)} ${merchant}`.toLowerCase();
    if (/(?:étterem|etterem|bistro|bisztró|büfé|bufe|kávézó|kavezo|pékség|pekseg|menza|kantin|mcdonald|kfc|burger\s*king|canteen|cafeteria|restaurant)/i.test(combined)) {
      return 'Food & Dining';
    }
  }
  return mapped;
}

function extractMerchant(title, bodyWithoutBalance, txType, dbAccounts = []) {
  const cleanBody = stripUiCtaTails(bodyWithoutBalance);
  const cleanTitle = stripUiCtaTails(title);

  // 1. Explicit labelled counterparty fields in body
  const labeled = /(?:Partner|Kereskedő|Merchant|Küldő|Feladó|Kedvezményezett|Hely)\s*:\s*([^\n,;]+)/i.exec(cleanBody);
  if (labeled && cleanMerchantName(labeled[1])) {
    return cleanMerchantName(labeled[1]);
  }

  // 2. Hungarian bank card purchase patterns:
  //    e.g. "a METRO BISTRO ÉTTEREM kereskedőnél", "a(z) CRV*TESCO 12345 ONKISZ webshopjában"
  const huMerchantAt =
    /(?:(?:sikeresen\s+)?(?:vásároltál|fizettél|költöttél|tranzakciót\s+hajtottál\s+végre)\s+)?\ba(?:\(z\)|z)?\s+(.+?)\s+(?:kereskedőnél|webshopjában|webshopban|webáruházában|webáruházban|üzletében|üzletben|boltjában|boltban|étteremben|alkalmazásban|helyszínén|helyen|elfogadóhelyen|terminálon)(?:[.!,;\s]|$)/i.exec(
      cleanBody
    );
  if (huMerchantAt) {
    const cand = cleanMerchantName(huMerchantAt[1]);
    if (cand && !isGenericTitle(cand, dbAccounts)) return cand;
  }

  // 3. Revolut HU patterns
  const revHu = /(?:itt|neki|tőle)\s*:\s*([^\n.,;]+)/i.exec(cleanBody);
  if (revHu && cleanMerchantName(revHu[1])) {
    return cleanMerchantName(revHu[1]);
  }

  // 4. Revolut / bank notifications that put the sender/merchant directly in notification title
  //    e.g. app="Revolut", title="Anna Maria Kovacs", text="Sent you HUF1. Tap to say thank you 💰"
  if (cleanTitle && !isGenericTitle(cleanTitle, dbAccounts)) {
    const cleanedTitleMerchant = cleanTitle
      .replace(/^(?:payment\s+(?:from|to)|sent\s+to|received\s+from)\s+/i, '')
      .trim();
    if (cleanedTitleMerchant.length >= 2 && !isGenericTitle(cleanedTitleMerchant, dbAccounts)) {
      return cleanedTitleMerchant.slice(0, 80);
    }
  }

  // 5. English prepositions on cleaned body (after UI CTA tails are stripped)
  if (txType === 'income') {
    const fromMatch = /\bfrom\s+([^\n.,;]+)/i.exec(cleanBody);
    if (fromMatch && cleanMerchantName(fromMatch[1])) {
      return cleanMerchantName(fromMatch[1]);
    }
  } else if (txType === 'transfer') {
    const toMatch = /\b(?:to|into)\s+([^\n.,;]+)/i.exec(cleanBody);
    if (toMatch && cleanMerchantName(toMatch[1])) {
      return cleanMerchantName(toMatch[1]);
    }
  } else {
    const atMatch = /\b(?:at|to)\s+([^\n.,;]+)/i.exec(cleanBody);
    if (atMatch && cleanMerchantName(atMatch[1])) {
      return cleanMerchantName(atMatch[1]);
    }
  }

  // 6. Comma-delimited OTP style: "-25 000 Ft, Tanulmányi" or "Kártyás vásárlás: 8 450 HUF, SPAR MAGYARORSZAG"
  const parts = cleanBody
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (/(HUF|Ft|EUR|USD|GBP|€|\$|£)/i.test(part)) continue;
    if (/^(?:Közlemény|Reference|Időpont|Dátum|Card|Kártya)\b/i.test(part)) continue;
    if (/(?:értékben|sikeresen\s+vásároltál|sikeresen\s+fizettél)/i.test(part)) continue;
    const candidate = cleanMerchantName(part);
    if (candidate && candidate.length >= 2 && !isGenericTitle(candidate, dbAccounts)) {
      return candidate;
    }
  }

  return txType === 'income'
    ? 'Incoming Bank Transfer'
    : txType === 'transfer'
      ? 'Internal Bank Transfer'
      : 'Bank Card Payment';
}

function parseTimestampToTxDate(ts, text) {
  if (ts !== undefined && ts !== null && ts !== '') {
    let d = null;
    if (typeof ts === 'number' || /^\d{10,13}$/.test(String(ts).trim())) {
      const n = Number(ts);
      d = new Date(n < 1e12 ? n * 1000 : n);
    } else {
      d = new Date(String(ts));
    }
    if (d && !Number.isNaN(d.getTime())) {
      const pad = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  const timeInText = /\b([01]\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (timeInText) {
    return `${getLocalIsoDate()}T${timeInText[1]}:${timeInText[2]}`;
  }
  return getLocalIsoDateTime();
}

function buildNotificationAutoNote({ bankHint, title, txType, merchant, destPocketHint, refText, category }) {
  const bankLabel = bankHint || 'Bank';
  const refSuffix = refText ? ` (${refText})` : '';
  if (txType === 'income') {
    return `${bankLabel}: incoming from ${merchant}${refSuffix}`;
  }
  if (txType === 'transfer') {
    const target = destPocketHint || merchant;
    return `${bankLabel}: internal transfer to ${target}${refSuffix}`;
  }
  const cleanTitle = stripUiCtaTails(title);
  if (cleanTitle && cleanTitle.toLowerCase() !== merchant.toLowerCase() && isGenericTitle(cleanTitle)) {
    return `${bankLabel} (${cleanTitle}): ${merchant}${refSuffix}`;
  }
  if (category && category !== 'Other Expense') {
    return `${bankLabel} · ${category}: ${merchant}${refSuffix}`;
  }
  return `${bankLabel}: payment to ${merchant}${refSuffix}`;
}

function parseBankNotification(payload = {}, dbAccounts = []) {
  const rawJoined = [
    payload.package,
    payload.packageName,
    payload.app,
    payload.appName,
    payload.title,
    payload.bigText,
    payload.text,
    payload.message,
    payload.body,
    payload.rawText,
  ]
    .filter(Boolean)
    .join(' ');
  const hadMacroTokens = /\{(?:not_|notification|trigger_)[^}]*\}|\[(?:not_|notification|trigger_)[^\]]*\]/i.test(rawJoined);

  const pkg = stripUnexpandedMagicText(payload.package || payload.packageName || '');
  const app = stripUnexpandedMagicText(payload.app || payload.appName || '');
  const title = stripUnexpandedMagicText(payload.title || '');
  const bigBody = stripUnexpandedMagicText(payload.bigText || '');
  const textBody = stripUnexpandedMagicText(payload.text || payload.message || payload.body || payload.rawText || '');
  const body =
    bigBody && textBody && !bigBody.includes(textBody) && !textBody.includes(bigBody)
      ? `${textBody} ${bigBody}`
      : bigBody || textBody;
  const subText = stripUnexpandedMagicText(payload.subText || '');

  const combined = [app, title, body, subText].filter(Boolean).join(' ').trim();
  if (!combined) {
    return {
      ignored: true,
      reason: hadMacroTokens
        ? 'MacroDroid placeholders were unexpanded or empty. Use {not_title} and {notification} (via the ... Magic Text menu) and trigger with a real bank notification.'
        : 'Empty notification payload.',
    };
  }

  // Ignore non-transaction banking alerts (price/stock/FX alerts, security/PIN, 2FA, reactions/requests, declined, promos)
  if (PRICE_OR_MARKET_ALERT_REGEX.test(combined)) {
    return { ignored: true, reason: 'Price, stock, or exchange-rate alert ignored.' };
  }
  if (SECURITY_OR_PIN_ALERT_REGEX.test(combined)) {
    return { ignored: true, reason: 'Security, PIN, or account management notification ignored.' };
  }
  if (VERIFICATION_REGEX.test(combined) && !TX_VERB_REGEX.test(combined)) {
    return { ignored: true, reason: 'Verification or security code notification ignored.' };
  }
  if (SOCIAL_OR_REQUEST_ALERT_REGEX.test(combined)) {
    return { ignored: true, reason: 'Chat reaction, message, or payment request notification ignored.' };
  }
  if (FAILED_TX_ALERT_REGEX.test(combined)) {
    return { ignored: true, reason: 'Declined or failed transaction notification ignored.' };
  }
  if (PROMO_OR_REMINDER_ALERT_REGEX.test(combined)) {
    return { ignored: true, reason: 'Promotional or upcoming payment reminder notification ignored.' };
  }

  // Extract trailing account balance first so its numeric value doesn't override the transaction amount
  const balRegex =
    /(?:Elérhető\s*egyenleg|Új\s*egyenleg|Egyenleg|Available\s*balance|New\s*balance|Balance)\s*[:\-]?\s*([+-]?\s*\d[\d\s.,]*(?:,-)?\s*(?:HUF|Ft|EUR|USD|GBP|€|\$|£)?)/i;
  let balanceAfter = null;
  const balMatch = balRegex.exec(combined);
  if (balMatch) {
    balanceAfter = normalizeAmountNumber(balMatch[1]);
  }
  const textWithoutBalance = combined.replace(balRegex, ' ').trim();
  const bodyWithoutBalance = [body, subText].filter(Boolean).join(' ').replace(balRegex, ' ').trim();

  const { amount, currency, sign } = extractAmountAndCurrency(textWithoutBalance);
  if (!amount || amount <= 0) {
    return {
      ignored: true,
      reason: hadMacroTokens
        ? 'No transaction amount found (use {notification} instead of {not_text} for MacroDroid notification body).'
        : 'No transaction amount detected in notification.',
    };
  }

  const hasPositiveTxEvidence =
    TX_VERB_REGEX.test(combined) || sign === '+' || sign === '-' || balanceAfter !== null;
  if (!hasPositiveTxEvidence) {
    return {
      ignored: true,
      reason: 'No transaction action or payment verb detected in notification.',
    };
  }

  const bankHint = detectBankHint(pkg, app, title, `${body} ${subText}`, dbAccounts);
  const txType = detectMoneyflowDirection(title, bodyWithoutBalance || textWithoutBalance, sign);
  const lower = textWithoutBalance.toLowerCase();

  // Reference / Közlemény
  const refMatch = /(?:Közlemény|Reference|Megjegyzés|Note)\s*:\s*([^\n,;]+)/i.exec(bodyWithoutBalance || textWithoutBalance);
  const refText = refMatch ? stripUiCtaTails(refMatch[1]).trim() : '';

  const merchant = extractMerchant(title, bodyWithoutBalance || textWithoutBalance, txType, dbAccounts);
  const category = inferExpenseCategory(textWithoutBalance, merchant, txType);

  let destPocketHint = null;
  if (txType === 'transfer') {
    if (lower.includes('persely')) destPocketHint = 'persely számla';
    else if (lower.includes('euro vault') || lower.includes('vault')) destPocketHint = 'Euro Vault';
    else if (lower.includes('savings pocket') || lower.includes('megtakarítás')) destPocketHint = 'Savings Pocket';
    else {
      const destM = /\b(?:to|into)\s+([^\n.,;]+)/i.exec(stripUiCtaTails(bodyWithoutBalance || textWithoutBalance));
      if (destM) destPocketHint = destM[1].trim();
    }
  }

  const cardMatch = /(?:Card|Kártya|\*{4}|•{4})\s*[:\-]?\s*(\d{4})\b/i.exec(combined);
  const cardLast4 = cardMatch ? cardMatch[1] : null;

  const autoNote = buildNotificationAutoNote({
    bankHint,
    title,
    txType,
    merchant,
    destPocketHint,
    refText,
    category,
  });

  return {
    ignored: false,
    bank_hint: bankHint,
    pocket_hint: null,
    dest_bank_hint: txType === 'transfer' ? bankHint : null,
    dest_pocket_hint: destPocketHint,
    tx_type: txType,
    amount,
    currency,
    merchant,
    category,
    ref_text: refText,
    date: parseTimestampToTxDate(payload.timestamp, textWithoutBalance),
    card_last4: cardLast4,
    balance_after: balanceAfter,
    auto_note: autoNote,
    raw_summary: stripUiCtaTails(body || title || combined),
  };
}

function ingestBankNotification(db, resolveHintedPocketIdFn, payload = {}) {
  const dbAccounts = db.prepare('SELECT id, name, slug FROM accounts WHERE is_archived = 0').all();
  const parsed = parseBankNotification(payload, dbAccounts);
  if (parsed.ignored || !parsed.amount || parsed.amount <= 0) {
    return {
      logged: false,
      ignored: true,
      reason: parsed.reason || 'Notification did not contain a recognizable transaction.',
      parsed,
    };
  }

  // Pair extracted origin/destination with the closest existing counterparty (and its default category)
  if ((parsed.tx_type === 'income' || parsed.tx_type === 'expense') && parsed.merchant) {
    const dir = parsed.tx_type === 'income' ? 'in' : 'out';
    const matched = findBestMatchingCounterparty(db, parsed.merchant, dir);
    if (matched && matched.counterparty) {
      parsed.raw_merchant = parsed.merchant;
      parsed.merchant = matched.counterparty.name;
      parsed.matched_counterparty_id = matched.counterparty.id;
      parsed.match_score = matched.score;
      if (matched.counterparty.default_category_id) {
        const expectedCatType = parsed.tx_type === 'income' ? 'income' : 'expense';
        const catRow = db
          .prepare('SELECT id, name, type FROM categories WHERE id = ?')
          .get(matched.counterparty.default_category_id);
        if (catRow && catRow.type === expectedCatType) {
          parsed.category = catRow.name;
        }
      }
      parsed.auto_note = buildNotificationAutoNote({
        bankHint: parsed.bank_hint,
        title: stripUnexpandedMagicText(payload.title || ''),
        txType: parsed.tx_type,
        merchant: parsed.merchant,
        destPocketHint: parsed.dest_pocket_hint,
        refText: parsed.ref_text || '',
        category: parsed.category,
      });
    }
  }

  // De-duplicate rapid double-notifications from Android summary + detail notifications (last 90s)
  const cutoffIso = new Date(Date.now() - 90 * 1000).toISOString();
  const duplicate = db
    .prepare(
      `SELECT id FROM transactions
       WHERE auto_source = 'notification'
         AND amount = ?
         AND LOWER(merchant) = LOWER(?)
         AND created_at >= ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(parsed.amount, parsed.merchant, cutoffIso);

  if (duplicate) {
    return {
      logged: false,
      ignored: true,
      duplicate: true,
      duplicateTxId: duplicate.id,
      reason: 'Duplicate notification within 90 seconds ignored.',
      parsed,
    };
  }

  // Always assign to the detected bank account's main pocket
  let targetPocketId = parsed.bank_hint ? resolveBankMainPocketId(db, parsed.bank_hint) : null;
  if (!targetPocketId && payload.pocketId) {
    targetPocketId = Number(payload.pocketId);
  }
  if (!targetPocketId) {
    const fallbackPocket =
      db.prepare('SELECT id FROM pockets WHERE is_archived = 0 ORDER BY is_default DESC, id ASC LIMIT 1').get() ||
      db.prepare('SELECT id FROM pockets ORDER BY is_default DESC, id ASC LIMIT 1').get();
    targetPocketId = fallbackPocket?.id;
  }
  if (!targetPocketId) {
    throw new Error('No pocket available to log notification transaction.');
  }

  let txType = parsed.tx_type;
  let destPocketId = null;
  if (txType === 'transfer') {
    destPocketId = resolveHintedPocketIdFn(
      db,
      parsed.dest_bank_hint || parsed.bank_hint,
      parsed.dest_pocket_hint,
      null,
      targetPocketId
    );
    if (!destPocketId || destPocketId === targetPocketId) {
      txType = 'expense';
      destPocketId = null;
    }
  }

  const transaction = createTransaction(db, {
    date: parsed.date,
    type: txType,
    amount: parsed.amount,
    currency: parsed.currency,
    pocketId: targetPocketId,
    destPocketId,
    categoryName: parsed.category,
    merchant: parsed.merchant,
    note: '',
    receiptAutoNote: parsed.auto_note,
    noteSource: 'auto',
    items: [],
    isHistorical: 0,
    needsApproval: 1,
    autoSource: 'notification',
  });

  return {
    logged: true,
    ignored: false,
    parsed,
    transaction,
  };
}

module.exports = {
  parseBankNotification,
  ingestBankNotification,
  resolveBankMainPocketId,
};
