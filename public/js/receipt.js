(function () {
  function tr(key, vars) {
    return window.MoneyI18n ? window.MoneyI18n.t(key, vars) : key;
  }

  function trCat(name) {
    return window.MoneyI18n ? window.MoneyI18n.tCat(name) : name;
  }

  function escapeHtml(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function estimateBase64Bytes(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return 0;
    const commaIdx = dataUrl.indexOf(',');
    const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    return Math.max(0, Math.round((b64.length * 3) / 4));
  }

  function compressImageToDataUrl(file, hooks = {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof hooks.onReadDone === 'function') {
          hooks.onReadDone({ origBytes: file.size || estimateBase64Bytes(dataUrl) });
        }
        const img = new Image();
        img.onerror = () =>
          resolve({
            dataUrl,
            mimeType: file.type || 'image/jpeg',
            origBytes: file.size || estimateBase64Bytes(dataUrl),
            compressedBytes: estimateBase64Bytes(dataUrl),
            width: 0,
            height: 0,
            origWidth: 0,
            origHeight: 0,
          });
        img.onload = () => {
          const origWidth = img.naturalWidth || img.width || 0;
          const origHeight = img.naturalHeight || img.height || 0;
          const maxDim = 1600;
          let width = origWidth;
          let height = origHeight;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          resolve({
            dataUrl: compressed,
            mimeType: 'image/jpeg',
            origBytes: file.size || estimateBase64Bytes(dataUrl),
            compressedBytes: estimateBase64Bytes(compressed),
            width,
            height,
            origWidth,
            origHeight,
          });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderVisionQuotaCard(containerEl, usage, opts = {}) {
    if (!containerEl) return;
    const esc = typeof opts.esc === 'function' ? opts.esc : escapeHtml;
    const hasKey = opts.hasKey !== false;
    const u = usage || {};
    const rpd = Number(u.requestsToday || 0);
    const dailyLimit = Number(u.dailyLimitEstimate || 250);
    const rpm = Number(u.rpmUsed || 0);
    const rpmLimit = Number(u.rpmLimitEstimate || 10);
    const tokens = Number(u.tokensToday || 0);
    const pct = Math.min(100, Number(u.dailyPct != null ? u.dailyPct : Math.round((rpd / dailyLimit) * 100)));

    let cardState = '';
    let badgeClass = '';
    let badgeText = tr('visionQuotaBadgeOk');

    if (!hasKey) {
      badgeClass = 'is-demo';
      badgeText = tr('visionQuotaBadgeDemo');
    } else if (u.status === 'rate_limited') {
      cardState = 'is-danger';
      badgeClass = 'is-danger';
      badgeText = tr('visionQuotaBadgeDanger');
    } else if (u.nearLimit || u.status === 'warning') {
      cardState = 'is-warning';
      badgeClass = 'is-warning';
      badgeText = tr('visionQuotaBadgeWarn');
    }

    containerEl.className = `vision-quota-card ${cardState}`.trim();
    containerEl.innerHTML = `
      <div class="vision-quota-header">
        <strong>${esc(tr('visionQuotaTitle'))}</strong>
        <span class="vision-quota-badge ${badgeClass}">${esc(badgeText)}</span>
      </div>
      ${
        hasKey
          ? `
        <div class="vision-quota-bar">
          <div class="vision-quota-fill ${badgeClass}" style="width:${pct}%"></div>
        </div>
        <div class="vision-quota-metrics">
          <span>${esc(
            tr('visionQuotaMetrics', {
              rpd,
              dailyLimit,
              pct,
              rpm,
              rpmLimit,
              tokens: tokens.toLocaleString(),
            })
          )}</span>
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" class="vision-quota-link">${esc(
            tr('visionQuotaCheckLink')
          )} ↗</a>
        </div>
        ${
          u.nearLimit || u.status === 'rate_limited'
            ? `<div class="vision-quota-warn-note">${esc(
                tr('visionQuotaNearWarn', { rpd, dailyLimit, rpm, rpmLimit })
              )}</div>`
            : ''
        }
      `
          : `
        <div class="vision-quota-metrics">
          <span>${esc(tr('visionQuotaDemoHint'))}</span>
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" class="vision-quota-link">${esc(
            tr('visionQuotaCheckLink')
          )} ↗</a>
        </div>
      `
      }
    `;
  }

  function initReceiptScanner(app) {
    const modal = document.getElementById('receipt-modal');
    const pocketSel = document.getElementById('receipt-pocket');
    const autoLogChk = document.getElementById('receipt-autolog');
    const fileInput = document.getElementById('receipt-file-input');
    const dropzone = document.getElementById('receipt-dropzone');
    const quotaBar = document.getElementById('receipt-quota-bar');
    const progressBox = document.getElementById('receipt-progress-box');
    const spinnerEl = document.getElementById('receipt-spinner');
    const stageTitleEl = document.getElementById('receipt-stage-title');
    const elapsedEl = document.getElementById('receipt-elapsed');
    const progressFill = document.getElementById('receipt-progress-fill');
    const statusBox = document.getElementById('receipt-status');
    const previewPanel = document.getElementById('receipt-preview-panel');
    const thumbImg = document.getElementById('receipt-thumb');
    const confirmForm = document.getElementById('receipt-confirm-form');
    const rescanBtn = document.getElementById('rc-rescan');
    const rcSourceBadge = document.getElementById('rc-source-badge');
    const rcTypeSel = document.getElementById('rc-type');
    const rcTimeInput = document.getElementById('rc-time');
    const rcCategorySel = document.getElementById('rc-category');
    const rcDestPocketWrap = document.getElementById('rc-dest-pocket-wrap');
    const rcDestPocketSel = document.getElementById('rc-dest-pocket');
    const attachBanner = document.getElementById('receipt-attach-banner');
    const rcSubmitBtn = document.getElementById('rc-submit-btn');
    const autoLogToggleRow = autoLogChk ? autoLogChk.closest('.toggle-row') : null;
    const skipScanRow = document.getElementById('receipt-skip-scan-row');
    const skipScanChk = document.getElementById('receipt-skip-scan');
    const expandThumbBtn = document.getElementById('rc-expand-thumb-btn');
    const rcAddressInput = document.getElementById('rc-address');
    const rcAttachMergeBox = document.getElementById('rc-attach-merge-box');
    const rcDiffRowsEl = document.getElementById('rc-diff-rows');
    const rcKeepAllBtn = document.getElementById('rc-keep-all-btn');
    const rcUseAllReceiptBtn = document.getElementById('rc-use-all-receipt-btn');
    const rcNoteStrategyBox = document.getElementById('rc-note-strategy-box');
    const rcNoteInput = document.getElementById('rc-note');

    let lastExtractedItems = [];
    let lastAutoNote = '';
    let lastScannedPayload = null;
    let lastSettingsSnapshot = null;
    let currentAttachTx = null;
    let currentNoteStrategy = 'receipt';
    let diffSelections = {};
    let noteEditedManually = false;
    let timerInterval = null;
    let scanStartMs = 0;

    function formatClientItemAmt(price, currency = 'HUF') {
      const num = Number(price);
      if (!Number.isFinite(num) || num <= 0) return '';
      const cur = String(currency || 'HUF').trim().toUpperCase();
      const formatted =
        cur === 'HUF' || Math.abs(num - Math.round(num)) < 0.005
          ? Math.round(num).toLocaleString('en-US')
          : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return cur ? `${formatted} ${cur}` : formatted;
    }

    function formatClientReceiptItem(it, currency = 'HUF') {
      if (typeof it === 'string') return it.trim();
      if (!it || typeof it.name !== 'string' || !it.name.trim()) return '';
      const name = it.name.trim();
      const qty = Number(it.qty);
      const qtyPart = Number.isFinite(qty) && qty > 1 ? ` x${qty}` : '';
      const amtPart = formatClientItemAmt(it.price, currency);
      return amtPart ? `${name}${qtyPart} (${amtPart})` : `${name}${qtyPart}`;
    }

    function buildClientReceiptDetails(items, address, currency) {
      const entries = Array.isArray(items)
        ? items.map((it) => formatClientReceiptItem(it, currency)).filter(Boolean)
        : [];
      const cleanAddr = String(address || '').trim();
      const parts = [];
      if (entries.length > 0) {
        const listed = entries.slice(0, 25).join(', ');
        const extra = entries.length > 25 ? ` (+${entries.length - 25} more)` : '';
        parts.push(`${listed}${extra}`);
      }
      if (cleanAddr) {
        parts.push(`Address: ${cleanAddr}`);
      }
      return parts.join(' | ');
    }

    function buildClientReceiptAutoNote(payload) {
      const p = payload || lastScannedPayload || {};
      const items = lastExtractedItems;
      const currency = document.getElementById('rc-currency')?.value || p.currency || 'HUF';
      const merchant = document.getElementById('rc-merchant')?.value.trim() || p.merchant || '';
      const selectedCatOpt = rcCategorySel?.selectedOptions?.[0];
      const category = selectedCatOpt?.dataset?.origName || p.category || 'Shopping';
      const address = rcAddressInput?.value.trim() || '';
      const entries = Array.isArray(items)
        ? items.map((it) => formatClientReceiptItem(it, currency)).filter(Boolean)
        : [];

      if (entries.length === 0 && !address && p.auto_note) {
        return p.auto_note.trim();
      }
      const prefix = merchant ? `${category} at ${merchant}` : category;
      let note = prefix;
      if (entries.length > 0) {
        const listed = entries.slice(0, 25).join(', ');
        const extra = entries.length > 25 ? ` (+${entries.length - 25} more)` : '';
        note = `${prefix}: ${listed}${extra}`;
      }
      if (address) {
        note = `${note} | Address: ${address}`;
      }
      return note;
    }

    function buildExpandedAttachNote(origNote, payload) {
      const base = String(origNote || '').trim();
      const p = payload || lastScannedPayload || {};
      const currency = document.getElementById('rc-currency')?.value || p.currency || 'HUF';
      const address = rcAddressInput?.value.trim() || '';
      const details = buildClientReceiptDetails(lastExtractedItems, address, currency);
      if (!base) return buildClientReceiptAutoNote(p);
      if (!details) {
        const fallback = String(p.auto_note || '').trim();
        if (!fallback || base.toLowerCase().includes(fallback.toLowerCase())) return base;
        return `${base} | ${fallback}`;
      }
      if (base.toLowerCase().includes(details.toLowerCase())) return base;
      return `${base} | ${details}`;
    }

    function syncNoteStrategyUI() {
      if (!rcNoteStrategyBox) return;
      rcNoteStrategyBox.querySelectorAll('[data-note-strategy]').forEach((btn) => {
        btn.classList.toggle('is-selected', !noteEditedManually && btn.dataset.noteStrategy === currentNoteStrategy);
      });
    }

    function applyNoteStrategy(strategy) {
      currentNoteStrategy = strategy;
      noteEditedManually = false;
      const receiptNote = buildClientReceiptAutoNote(lastScannedPayload);
      lastAutoNote = receiptNote;
      if (rcNoteInput) {
        if (strategy === 'keep' && currentAttachTx) {
          rcNoteInput.value = currentAttachTx.note || '';
        } else if (strategy === 'expand' && currentAttachTx) {
          rcNoteInput.value = buildExpandedAttachNote(currentAttachTx.note || '', lastScannedPayload);
        } else {
          rcNoteInput.value = receiptNote;
        }
      }
      syncNoteStrategyUI();
    }

    if (rcNoteStrategyBox) {
      rcNoteStrategyBox.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-note-strategy]');
        if (!btn) return;
        applyNoteStrategy(btn.dataset.noteStrategy);
      });
    }

    if (rcNoteInput) {
      rcNoteInput.addEventListener('input', () => {
        noteEditedManually = true;
        syncNoteStrategyUI();
      });
    }

    const syncNoteAfterFormEdit = () => {
      lastAutoNote = buildClientReceiptAutoNote(lastScannedPayload);
      if (noteEditedManually) return;
      if (currentAttachTx) {
        if (currentNoteStrategy === 'expand' || currentNoteStrategy === 'receipt') {
          applyNoteStrategy(currentNoteStrategy);
        }
      } else if (rcNoteInput && lastScannedPayload?.source_type === 'receipt') {
        rcNoteInput.value = lastAutoNote;
      }
    };
    rcAddressInput?.addEventListener('input', syncNoteAfterFormEdit);
    rcCategorySel?.addEventListener('change', syncNoteAfterFormEdit);
    document.getElementById('rc-merchant')?.addEventListener('input', syncNoteAfterFormEdit);
    document.getElementById('rc-currency')?.addEventListener('change', syncNoteAfterFormEdit);

    function applyDiffSelection(field, source, origMap, recMap) {
      diffSelections[field] = source;
      const val = source === 'receipt' ? recMap[field] : origMap[field];
      if (field === 'merchant') {
        document.getElementById('rc-merchant').value = val || '';
      } else if (field === 'amount') {
        document.getElementById('rc-amount').value = val?.amount ?? '';
        document.getElementById('rc-currency').value = val?.currency || 'HUF';
      } else if (field === 'date') {
        document.getElementById('rc-date').value = val || '';
      } else if (field === 'time' && rcTimeInput) {
        rcTimeInput.value = val || '';
      } else if (field === 'category' && rcCategorySel) {
        app.selectOptionByTextOrValue(rcCategorySel, val || 'Shopping');
      } else if (field === 'storeAddress' && rcAddressInput) {
        rcAddressInput.value = val || '';
      }
      if (rcDiffRowsEl) {
        rcDiffRowsEl.querySelectorAll(`[data-diff-field="${field}"] [data-pick-source]`).forEach((btn) => {
          btn.classList.toggle('is-selected', btn.dataset.pickSource === source);
        });
      }
      syncNoteAfterFormEdit();
    }

    function renderAttachComparePanel(tx, p) {
      if (!rcAttachMergeBox || !rcDiffRowsEl || !tx || !p) {
        rcAttachMergeBox?.classList.add('hidden');
        return;
      }
      const origDateRaw = String(tx.date || '');
      const origDate = origDateRaw.slice(0, 10);
      const origTime = origDateRaw.includes('T') ? origDateRaw.slice(11, 16) : '';
      const origAddr = String(tx.store_address || '').trim();
      const recAddr = String(p.store_address || '').trim();

      const origMap = {
        merchant: String(tx.merchant || '').trim(),
        amount: { amount: Number(tx.amount || 0), currency: tx.currency || 'HUF' },
        date: origDate,
        time: origTime,
        category: String(tx.category_name || '').trim(),
        storeAddress: origAddr || recAddr,
      };
      const recMap = {
        merchant: String(p.merchant || '').trim(),
        amount: { amount: Number(p.amount || 0), currency: p.currency || 'HUF' },
        date: p.date || origDate,
        time: p.time || '',
        category: p.category || origMap.category,
        storeAddress: recAddr || origAddr,
      };

      const diffs = [];
      if (recMap.merchant && recMap.merchant.toLowerCase() !== origMap.merchant.toLowerCase()) {
        diffs.push({
          field: 'merchant',
          label: tr('merchantCounterpartyLabel'),
          origLabel: origMap.merchant || '—',
          recLabel: recMap.merchant,
        });
      }
      if (
        recMap.amount.amount > 0 &&
        (Math.abs(recMap.amount.amount - origMap.amount.amount) > 0.01 ||
          recMap.amount.currency !== origMap.amount.currency)
      ) {
        diffs.push({
          field: 'amount',
          label: tr('amountLabel'),
          origLabel: `${origMap.amount.amount.toLocaleString()} ${origMap.amount.currency}`,
          recLabel: `${recMap.amount.amount.toLocaleString()} ${recMap.amount.currency}`,
        });
      }
      if (recMap.date && recMap.date !== origMap.date) {
        diffs.push({
          field: 'date',
          label: tr('dateLabel'),
          origLabel: origMap.date || '—',
          recLabel: recMap.date,
        });
      }
      if (recMap.time && recMap.time !== origMap.time) {
        diffs.push({
          field: 'time',
          label: tr('timeLabel'),
          origLabel: origMap.time || '—',
          recLabel: recMap.time,
        });
      }
      if (recMap.category && recMap.category.toLowerCase() !== origMap.category.toLowerCase()) {
        diffs.push({
          field: 'category',
          label: tr('categoryLabel'),
          origLabel: trCat(origMap.category),
          recLabel: trCat(recMap.category),
        });
      }
      if (origAddr && recAddr && origAddr.toLowerCase() !== recAddr.toLowerCase()) {
        diffs.push({
          field: 'storeAddress',
          label: tr('storeAddressLabel'),
          origLabel: origAddr,
          recLabel: recAddr,
        });
      }

      diffSelections = {};
      if (diffs.length === 0) {
        rcDiffRowsEl.innerHTML = `<div class="muted small">${app.esc(tr('attachNoDiffsHint'))}</div>`;
      } else {
        diffs.forEach((d) => {
          diffSelections[d.field] = 'orig';
        });
        rcDiffRowsEl.innerHTML = diffs
          .map(
            (d) => `
              <div class="rc-diff-row" data-diff-field="${d.field}">
                <span class="rc-diff-field-label">${app.esc(d.label)}</span>
                <div class="rc-diff-picks">
                  <button type="button" class="btn small rc-diff-pill is-selected" data-pick-source="orig">${app.esc(
                    tr('diffFieldOrig', { val: d.origLabel })
                  )}</button>
                  <button type="button" class="btn small rc-diff-pill" data-pick-source="receipt">${app.esc(
                    tr('diffFieldReceipt', { val: d.recLabel })
                  )}</button>
                </div>
              </div>
            `
          )
          .join('');
        rcDiffRowsEl.querySelectorAll('[data-pick-source]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const row = btn.closest('[data-diff-field]');
            if (!row) return;
            applyDiffSelection(row.dataset.diffField, btn.dataset.pickSource, origMap, recMap);
          });
        });
      }

      if (rcKeepAllBtn) {
        rcKeepAllBtn.onclick = () => {
          diffs.forEach((d) => applyDiffSelection(d.field, 'orig', origMap, recMap));
          if (tx.note && String(tx.note).trim()) applyNoteStrategy('keep');
        };
      }
      if (rcUseAllReceiptBtn) {
        rcUseAllReceiptBtn.onclick = () => {
          diffs.forEach((d) => applyDiffSelection(d.field, 'receipt', origMap, recMap));
          applyNoteStrategy('receipt');
        };
      }

      rcAttachMergeBox.classList.remove('hidden');
    }

    function matchPocketOption(selectEl, bankHint, pocketHint, excludeValue = null) {
      if (!selectEl) return null;
      const bClean = typeof bankHint === 'string' ? bankHint.trim().toLowerCase() : '';
      const pClean = typeof pocketHint === 'string' ? pocketHint.trim().toLowerCase() : '';
      const opts = Array.from(selectEl.options).filter(
        (o) => !excludeValue || o.value !== String(excludeValue)
      );
      const parseOpt = (o) => {
        const parts = o.textContent.split('→');
        return {
          bank: (parts[0] || '').trim().toLowerCase(),
          pocket: (parts[1] || o.textContent).trim().toLowerCase(),
        };
      };
      if (bClean && pClean) {
        const exact = opts.find((o) => {
          const { bank, pocket } = parseOpt(o);
          return (
            (bank === bClean || bank.includes(bClean)) &&
            (pocket.includes(pClean) || pClean.includes(pocket.replace(/\s*\([^)]*\)$/, '').trim()))
          );
        });
        if (exact) return exact;
      }
      if (bClean) {
        const byBank = opts.find((o) => {
          const { bank } = parseOpt(o);
          return bank === bClean || bank.includes(bClean);
        });
        if (byBank) return byBank;
      }
      if (!bClean && pClean) {
        const byPocket = opts.find((o) => {
          const { pocket } = parseOpt(o);
          return pocket.includes(pClean) || pClean.includes(pocket.replace(/\s*\([^)]*\)$/, '').trim());
        });
        if (byPocket) return byPocket;
      }
      return null;
    }

    function syncTypeControls(txType) {
      const normalized = ['expense', 'income', 'transfer'].includes(txType) ? txType : 'expense';
      if (rcTypeSel) rcTypeSel.value = normalized;
      if (rcDestPocketWrap) {
        rcDestPocketWrap.classList.toggle('hidden', normalized !== 'transfer');
      }
      if (rcCategorySel) {
        const prevVal = rcCategorySel.value;
        app.populateCategorySelect(rcCategorySel, normalized);
        if (prevVal && Array.from(rcCategorySel.options).some((o) => o.value === prevVal)) {
          rcCategorySel.value = prevVal;
        }
      }
    }

    if (rcTypeSel) {
      rcTypeSel.addEventListener('change', () => {
        syncTypeControls(rcTypeSel.value);
      });
    }

    const STEP_KEYS = ['read', 'compress', 'upload', 'extract'];

    autoLogChk.checked = localStorage.getItem('mm_receipt_autolog') === 'true';
    autoLogChk.addEventListener('change', () => {
      localStorage.setItem('mm_receipt_autolog', String(autoLogChk.checked));
    });

    pocketSel.addEventListener('change', () => {
      localStorage.setItem('mm_last_receipt_pocket', pocketSel.value);
    });

    function showStatus(msg, variant = '') {
      statusBox.textContent = msg;
      statusBox.className = `status-banner ${variant}`.trim();
      statusBox.classList.remove('hidden');
    }

    function hideStatus() {
      statusBox.classList.add('hidden');
    }

    function stopTimer() {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }

    function updateElapsedLabel() {
      if (!scanStartMs) return;
      const sec = ((Date.now() - scanStartMs) / 1000).toFixed(1);
      elapsedEl.textContent = `${sec}s`;
    }

    function resetProgressUI() {
      stopTimer();
      scanStartMs = Date.now();
      elapsedEl.textContent = '0.0s';
      progressBox.classList.remove('hidden');
      spinnerEl.className = 'receipt-spinner';
      progressFill.className = 'receipt-progress-fill';
      progressFill.style.width = '5%';
      stageTitleEl.textContent = tr('processingReceiptTitle');
      for (const k of STEP_KEYS) {
        const li = document.getElementById(`receipt-step-${k}`);
        const meta = document.getElementById(`receipt-step-${k}-meta`);
        if (li) li.className = 'receipt-step-item';
        if (meta) meta.textContent = '';
      }
    }

    function setStepState(stepKey, state, metaText = '') {
      const li = document.getElementById(`receipt-step-${stepKey}`);
      const meta = document.getElementById(`receipt-step-${stepKey}-meta`);
      if (li) {
        li.className = 'receipt-step-item';
        if (state) li.classList.add(`is-${state}`);
      }
      if (meta && metaText !== undefined && metaText !== null) {
        meta.textContent = metaText;
      }
    }

    function setProgress(pct, titleText, modeClass = '') {
      progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      progressFill.className = `receipt-progress-fill ${modeClass}`.trim();
      if (titleText) stageTitleEl.textContent = titleText;
      if (modeClass === 'is-done') {
        spinnerEl.className = 'receipt-spinner is-done';
      } else if (modeClass === 'is-error') {
        spinnerEl.className = 'receipt-spinner is-error';
      } else {
        spinnerEl.className = 'receipt-spinner';
      }
    }

    async function refreshQuotaBar() {
      try {
        const s = await app.api('/api/settings');
        lastSettingsSnapshot = s;
        renderVisionQuotaCard(quotaBar, s.geminiUsage, {
          hasKey: s.hasGeminiKey,
          esc: app.esc,
        });
      } catch {
        // Keep silent if offline; quota bar remains minimal
      }
    }

    if (window.MoneyI18n) {
      window.MoneyI18n.onChange(() => {
        if (lastSettingsSnapshot) {
          renderVisionQuotaCard(quotaBar, lastSettingsSnapshot.geminiUsage, {
            hasKey: lastSettingsSnapshot.hasGeminiKey,
            esc: app.esc,
          });
        }
      });
    }

    modal.addEventListener('close', () => {
      stopTimer();
    });

    function openScanner(options = {}) {
      stopTimer();
      currentAttachTx = options && options.attachTx ? options.attachTx : null;
      lastScannedPayload = null;
      lastExtractedItems = [];
      lastAutoNote = '';
      diffSelections = {};
      currentNoteStrategy = 'receipt';
      noteEditedManually = false;
      if (autoLogToggleRow) {
        autoLogToggleRow.classList.toggle('hidden', Boolean(currentAttachTx));
      }
      if (skipScanRow) {
        skipScanRow.classList.toggle('hidden', !currentAttachTx);
      }
      if (skipScanChk) {
        skipScanChk.checked = false;
      }
      rcAttachMergeBox?.classList.add('hidden');
      rcNoteStrategyBox?.classList.add('hidden');
      if (rcAddressInput) rcAddressInput.value = '';
      const preferredPocket = currentAttachTx
        ? currentAttachTx.pocket_id
        : localStorage.getItem('mm_last_receipt_pocket');
      app.populatePocketSelect(pocketSel, preferredPocket);
      if (rcDestPocketSel) app.populatePocketSelect(rcDestPocketSel, currentAttachTx?.dest_pocket_id || null);
      if (attachBanner) {
        if (currentAttachTx) {
          attachBanner.textContent = tr('attachingToTxBanner', {
            merchant: currentAttachTx.merchant || trCat(currentAttachTx.category_name),
            amount: Number(currentAttachTx.amount || 0).toLocaleString(),
            currency: currentAttachTx.currency || 'HUF',
            date: String(currentAttachTx.date || '').replace('T', ' '),
          });
          attachBanner.className = 'status-banner warn';
        } else {
          attachBanner.className = 'status-banner hidden';
        }
      }
      if (rcSubmitBtn) {
        rcSubmitBtn.textContent = tr(currentAttachTx ? 'confirmAttachLedger' : 'confirmAddLedger');
      }
      syncTypeControls(
        currentAttachTx && currentAttachTx.type !== 'adjustment' ? currentAttachTx.type : 'expense'
      );
      if (rcSourceBadge) rcSourceBadge.className = 'rc-source-badge hidden';
      hideStatus();
      progressBox.classList.add('hidden');
      previewPanel.classList.add('hidden');
      dropzone.classList.remove('hidden');
      fileInput.value = '';
      modal.showModal();
      refreshQuotaBar();
    }

    async function handleFile(file) {
      if (!file) return;
      hideStatus();
      previewPanel.classList.add('hidden');
      resetProgressUI();

      let activeStep = 'read';
      let longWaitWatcher = null;
      const formatKb = (bytes) => `${Math.max(1, Math.round(Number(bytes || 0) / 1024)).toLocaleString()} KB`;

      timerInterval = setInterval(updateElapsedLabel, 100);

      try {
        // Stage 1: Read file from device
        activeStep = 'read';
        const origKb = formatKb(file.size);
        setStepState('read', 'active', `${file.name ? `${file.name} · ` : ''}${origKb}`);
        setProgress(15, tr('stageReading'));

        // Allow paint frame so user sees Stage 1 cleanly before compression runs
        await new Promise((r) => setTimeout(r, 40));

        // Stage 2: Optimize & compress image
        const imgResult = await compressImageToDataUrl(file, {
          onReadDone: ({ origBytes }) => {
            setStepState('read', 'done', `${tr('stepDoneTag')} (${formatKb(origBytes)})`);
            activeStep = 'compress';
            setStepState('compress', 'active', '...');
            setProgress(35, tr('stageCompressing'));
          },
        });

        thumbImg.src = imgResult.dataUrl;
        const origKbNum = Math.max(1, Math.round(imgResult.origBytes / 1024));
        const compKbNum = Math.max(1, Math.round(imgResult.compressedBytes / 1024));
        const dimText = imgResult.width && imgResult.height ? `${imgResult.width}x${imgResult.height}` : 'JPEG';
        setStepState(
          'compress',
          'done',
          tr('stepCompressedMeta', {
            origKb: origKbNum.toLocaleString(),
            compKb: compKbNum.toLocaleString(),
            w: imgResult.width || '?',
            h: imgResult.height || '?',
          })
        );
        if (!imgResult.width || !imgResult.height) {
          setStepState('compress', 'done', `${origKbNum.toLocaleString()} KB -> ${compKbNum.toLocaleString()} KB (${dimText})`);
        }

        // Stage 3: Upload & Gemini Vision analysis (or skip AI scan when attaching directly)
        const shouldSkipScan = Boolean(currentAttachTx && skipScanChk && skipScanChk.checked);
        activeStep = 'upload';
        setStepState('upload', 'active', `${compKbNum.toLocaleString()} KB`);
        setProgress(
          65,
          shouldSkipScan ? tr('stageAttachedDirectly') : tr('stageUploading', { kb: compKbNum.toLocaleString() })
        );

        longWaitWatcher = setInterval(() => {
          const sec = ((Date.now() - scanStartMs) / 1000).toFixed(1);
          if (!shouldSkipScan && Number(sec) >= 2.2) {
            setProgress(78, tr('stageStillAnalyzing', { sec }));
          }
        }, 700);

        const res = await app.api('/api/receipts/scan', {
          method: 'POST',
          body: {
            imageBase64: imgResult.dataUrl,
            mimeType: imgResult.mimeType,
            filename: file.name,
            pocketId: Number(pocketSel.value),
            autoLog: currentAttachTx ? false : autoLogChk.checked,
            skipScan: shouldSkipScan,
            attachToTxId: currentAttachTx ? currentAttachTx.id : undefined,
          },
        });

        clearInterval(longWaitWatcher);
        longWaitWatcher = null;

        setStepState(
          'upload',
          'done',
          tr('stepUploadMeta', {
            kb: compKbNum.toLocaleString(),
            model: res.model || 'Gemini',
          })
        );

        // Update live quota card immediately
        if (res.usage) {
          lastSettingsSnapshot = {
            ...(lastSettingsSnapshot || {}),
            hasGeminiKey: res.mode === 'gemini' || Boolean(lastSettingsSnapshot?.hasGeminiKey),
            geminiUsage: res.usage,
          };
          renderVisionQuotaCard(quotaBar, res.usage, {
            hasKey: lastSettingsSnapshot.hasGeminiKey,
            esc: app.esc,
          });
        }

        if (res.skippedScan && res.attachedToExisting) {
          stopTimer();
          updateElapsedLabel();
          const secDone = ((Date.now() - scanStartMs) / 1000).toFixed(1);
          setStepState('extract', 'done', tr('stepDoneTag'));
          setProgress(100, tr('stageComplete', { sec: secDone }), 'is-done');
          await new Promise((r) => setTimeout(r, 220));
          modal.close();
          await app.refreshDashboard();
          app.toast(tr('receiptAttachedSkipScanToast'), 'ok');
          return;
        }

        // Stage 4: Extract line items & log / populate review
        activeStep = 'extract';
        const p = res.parsed || {};
        lastExtractedItems = Array.isArray(p.items) ? p.items : [];
        const isAutoLogged = Boolean(res.autoLogged && res.transaction);
        setStepState('extract', 'active', tr('stepItemsMeta', { count: lastExtractedItems.length }));
        setProgress(92, tr(isAutoLogged ? 'stageAutoLogging' : 'stageExtracting'));

        await new Promise((r) => setTimeout(r, 80));

        stopTimer();
        updateElapsedLabel();
        const totalSec = ((Date.now() - scanStartMs) / 1000).toFixed(1);
        setStepState('extract', 'done', tr('stepItemsMeta', { count: lastExtractedItems.length }));
        setProgress(100, tr('stageComplete', { sec: totalSec }), 'is-done');

        if (isAutoLogged) {
          await new Promise((r) => setTimeout(r, 320));
          modal.close();
          await app.refreshDashboard();
          if (res.attachedToExisting) {
            app.toast(tr('receiptAttachedToast'), 'ok');
          } else {
            const txTypeLogged = res.transaction.type || p.tx_type || 'expense';
            const sign = txTypeLogged === 'income' ? '+' : txTypeLogged === 'transfer' ? '⇄ ' : '-';
            app.toast(
              tr('receiptLoggedSignedToast', {
                merchant: res.transaction.merchant || trCat(res.transaction.category_name),
                sign,
                amount: res.transaction.amount.toLocaleString(),
                currency: res.transaction.currency,
              }),
              'ok'
            );
          }
          if (res.warning) {
            app.toast(res.warning, 'ok');
          } else if (res.usage?.nearLimit) {
            app.toast(
              tr('visionQuotaNearWarn', {
                rpd: res.usage.requestsToday,
                dailyLimit: res.usage.dailyLimitEstimate,
                rpm: res.usage.rpmUsed,
                rpmLimit: res.usage.rpmLimitEstimate,
              }),
              'err'
            );
          }
          return;
        }

        const detectedType = currentAttachTx
          ? currentAttachTx.type !== 'adjustment'
            ? currentAttachTx.type
            : 'expense'
          : ['expense', 'income', 'transfer'].includes(p.tx_type)
            ? p.tx_type
            : 'expense';
        syncTypeControls(detectedType);

        if (rcSourceBadge) {
          const isBank = p.source_type === 'bank_screenshot';
          const parts = [tr(isBank ? 'sourceBadgeBank' : 'sourceBadgeReceipt')];
          if (p.bank_hint) parts.push(p.bank_hint);
          if (p.card_last4) parts.push(tr('sourceBadgeCard', { last4: p.card_last4 }));
          rcSourceBadge.textContent = parts.join(' · ');
          rcSourceBadge.className = `rc-source-badge ${isBank ? 'is-bank' : 'is-receipt'}`;
        }

        lastScannedPayload = p;
        noteEditedManually = false;
        document.getElementById('rc-path').value = res.receiptPath || '';
        document.getElementById('rc-merchant').value =
          (currentAttachTx && currentAttachTx.merchant) || p.merchant || '';
        const attachDateRaw = currentAttachTx ? String(currentAttachTx.date || '') : '';
        document.getElementById('rc-date').value = attachDateRaw
          ? attachDateRaw.slice(0, 10)
          : p.date || new Date().toISOString().slice(0, 10);
        if (rcTimeInput) {
          rcTimeInput.value =
            attachDateRaw && attachDateRaw.includes('T')
              ? attachDateRaw.slice(11, 16)
              : p.time || '';
        }
        document.getElementById('rc-amount').value = currentAttachTx
          ? currentAttachTx.amount
          : p.amount || '';
        document.getElementById('rc-currency').value = currentAttachTx
          ? currentAttachTx.currency || 'HUF'
          : p.currency || 'HUF';
        if (rcCategorySel) {
          app.selectOptionByTextOrValue(
            rcCategorySel,
            (currentAttachTx && currentAttachTx.category_name) ||
              p.category ||
              (detectedType === 'income' ? 'Other Income' : detectedType === 'transfer' ? 'Internal Transfer' : 'Shopping')
          );
        }
        if (rcAddressInput) {
          rcAddressInput.value =
            (currentAttachTx && String(currentAttachTx.store_address || '').trim()) ||
            p.store_address ||
            '';
        }
        lastAutoNote = buildClientReceiptAutoNote(p);
        if (currentAttachTx) {
          renderAttachComparePanel(currentAttachTx, p);
          rcNoteStrategyBox?.classList.remove('hidden');
          const hasExistingNote = Boolean(currentAttachTx.note && String(currentAttachTx.note).trim());
          applyNoteStrategy(hasExistingNote ? 'keep' : 'receipt');
        } else {
          rcAttachMergeBox?.classList.add('hidden');
          rcNoteStrategyBox?.classList.add('hidden');
          if (rcNoteInput) rcNoteInput.value = lastAutoNote;
        }

        let matchedBankMsg = '';
        if (!currentAttachTx && (p.bank_hint || p.pocket_hint)) {
          if (p.source_type === 'bank_screenshot' || !localStorage.getItem('mm_last_receipt_pocket')) {
            const matchOpt = matchPocketOption(pocketSel, p.bank_hint, p.pocket_hint);
            if (matchOpt) {
              pocketSel.value = matchOpt.value;
              matchedBankMsg = tr('pocketAutoMatched', { bank: p.bank_hint || matchOpt.textContent });
            }
          }
        }

        if (rcDestPocketSel) {
          app.populatePocketSelect(rcDestPocketSel);
          const destMatch = matchPocketOption(
            rcDestPocketSel,
            p.dest_bank_hint || p.bank_hint,
            p.dest_pocket_hint,
            pocketSel.value
          );
          if (destMatch) {
            rcDestPocketSel.value = destMatch.value;
          } else {
            const firstDifferent = Array.from(rcDestPocketSel.options).find((o) => o.value !== pocketSel.value);
            if (firstDifferent) rcDestPocketSel.value = firstDifferent.value;
          }
        }

        const itemsBox = document.getElementById('rc-items-box');
        const extraLines = [];
        if (p.store_address) {
          extraLines.push(app.esc(tr('receiptAddressLine', { address: p.store_address })));
        }
        if (p.balance_after !== null && p.balance_after !== undefined) {
          extraLines.push(
            app.esc(
              tr('detectedBalanceAfter', {
                balance: Number(p.balance_after).toLocaleString(),
                currency: p.currency || 'HUF',
              })
            )
          );
        }
        if (lastExtractedItems.length > 0) {
          itemsBox.innerHTML =
            `<strong>${app.esc(tr('extractedItemsHeader'))}</strong><br>` +
            lastExtractedItems
              .map((it) => `${app.esc(it.name)} × ${it.qty || 1}: ${Number(it.price || 0).toLocaleString()}`)
              .join('<br>') +
            (extraLines.length ? `<br><em>${extraLines.join(' · ')}</em>` : '');
        } else if (extraLines.length > 0) {
          itemsBox.innerHTML = extraLines.join('<br>');
        } else {
          itemsBox.textContent = tr('noLineItems');
        }

        if (res.warning) {
          showStatus(matchedBankMsg ? `${res.warning} (${matchedBankMsg})` : res.warning, 'warn');
        } else {
          const baseStatus = tr('scannedViaModelRich', {
            sec: totalSec,
            model: res.model || 'Gemini',
            kb: compKbNum.toLocaleString(),
            count: lastExtractedItems.length,
          });
          showStatus(matchedBankMsg ? `${baseStatus} ${matchedBankMsg}.` : baseStatus, res.usage?.nearLimit ? 'warn' : '');
        }

        dropzone.classList.add('hidden');
        previewPanel.classList.remove('hidden');
      } catch (err) {
        if (longWaitWatcher) clearInterval(longWaitWatcher);
        stopTimer();
        updateElapsedLabel();
        const isRateLimit =
          err.status === 429 || /quota|rate.?limit|resource_exhausted|429/i.test(String(err.message || ''));
        setStepState(activeStep, 'error', isRateLimit ? 'HTTP 429' : 'Error');
        setProgress(100, tr('stageFailedTitle'), 'is-error');
        showStatus(
          isRateLimit ? `${tr('visionRateLimitError')} (${err.message})` : err.message || tr('scanFailed'),
          'err'
        );
        refreshQuotaBar();
      }
    }

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        handleFile(fileInput.files[0]);
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer?.files?.[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    const openPreviewLightbox = () => {
      if (thumbImg?.src && typeof app.openImageLightbox === 'function') {
        app.openImageLightbox(
          thumbImg.src,
          document.getElementById('rc-merchant')?.value.trim() || tr('receiptViewTitle')
        );
      }
    };
    thumbImg?.addEventListener('click', openPreviewLightbox);
    expandThumbBtn?.addEventListener('click', openPreviewLightbox);

    rescanBtn.addEventListener('click', () => {
      stopTimer();
      progressBox.classList.add('hidden');
      previewPanel.classList.add('hidden');
      rcAttachMergeBox?.classList.add('hidden');
      rcNoteStrategyBox?.classList.add('hidden');
      dropzone.classList.remove('hidden');
      hideStatus();
      fileInput.value = '';
      refreshQuotaBar();
    });

    confirmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const txType = rcTypeSel ? rcTypeSel.value : 'expense';
        const srcPocketId = Number(pocketSel.value);
        const destPocketId = txType === 'transfer' && rcDestPocketSel ? Number(rcDestPocketSel.value) : null;
        if (txType === 'transfer' && (!destPocketId || destPocketId === srcPocketId)) {
          showStatus(tr('errChooseOtherPocket'), 'err');
          return;
        }

        const noteText = document.getElementById('rc-note').value.trim();
        const rawDate = document.getElementById('rc-date').value;
        const rawTime = rcTimeInput ? rcTimeInput.value : '';
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const localToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const txDate = rawTime
          ? `${rawDate}T${rawTime}`
          : rawDate === localToday
            ? `${localToday}T${pad(now.getHours())}:${pad(now.getMinutes())}`
            : rawDate;

        const selectedCatOpt = rcCategorySel?.selectedOptions?.[0];
        const storeAddress = rcAddressInput ? rcAddressInput.value.trim() : '';
        lastAutoNote = buildClientReceiptAutoNote(lastScannedPayload);
        const isStillAuto = noteText === lastAutoNote.trim() || noteText === '';
        if (currentAttachTx) {
          let attachNoteSource = 'manual';
          if (noteText === '') {
            attachNoteSource = 'auto';
          } else if (!noteEditedManually) {
            if (currentNoteStrategy === 'keep') {
              attachNoteSource = currentAttachTx.note_source || 'manual';
            } else if (currentNoteStrategy === 'expand') {
              attachNoteSource = currentAttachTx.note_source === 'manual' ? 'manual' : 'auto';
            } else {
              attachNoteSource = 'auto';
            }
          }
          await app.api(`/api/transactions/${currentAttachTx.id}`, {
            method: 'PATCH',
            body: {
              receiptPath: document.getElementById('rc-path').value || null,
              items: lastExtractedItems,
              storeAddress,
              merchant: document.getElementById('rc-merchant').value.trim() || currentAttachTx.merchant,
              date: txDate,
              amount: Number(document.getElementById('rc-amount').value),
              currency: document.getElementById('rc-currency').value,
              categoryId: rcCategorySel?.value ? Number(rcCategorySel.value) : undefined,
              categoryName: selectedCatOpt?.dataset?.origName || undefined,
              note: noteText,
              noteSource: attachNoteSource,
              receiptAutoNote: lastAutoNote,
            },
          });
          modal.close();
          await app.refreshDashboard();
          app.toast(tr('receiptAttachedToast'), 'ok');
          return;
        }

        const payload = {
          type: txType,
          date: txDate,
          amount: Number(document.getElementById('rc-amount').value),
          currency: document.getElementById('rc-currency').value,
          pocketId: srcPocketId,
          destPocketId: destPocketId || undefined,
          categoryId: rcCategorySel?.value ? Number(rcCategorySel.value) : undefined,
          categoryName: selectedCatOpt?.dataset?.origName || undefined,
          merchant: document.getElementById('rc-merchant').value.trim(),
          note: noteText,
          noteSource: isStillAuto ? 'auto' : 'manual',
          receiptAutoNote: lastAutoNote,
          storeAddress,
          items: lastExtractedItems,
          receiptPath: document.getElementById('rc-path').value || null,
        };

        await app.api('/api/transactions', { method: 'POST', body: payload });
        modal.close();
        await app.refreshDashboard();
        app.toast(tr('receiptSavedToast'), 'ok');
      } catch (err) {
        showStatus(err.message || tr('couldNotSaveTx'), 'err');
      }
    });

    return { openScanner };
  }

  window.MoneyReceipt = { initReceiptScanner, renderVisionQuotaCard };
})();
