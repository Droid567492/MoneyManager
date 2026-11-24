(function () {
  function tr(key, vars) {
    return window.MoneyI18n ? window.MoneyI18n.t(key, vars) : key;
  }

  const MAPPING_FIELD_KEYS = [
    { key: 'date', i18n: 'mapDate' },
    { key: 'amount', i18n: 'mapAmount' },
    { key: 'type', i18n: 'mapType' },
    { key: 'category', i18n: 'mapCategory' },
    { key: 'account', i18n: 'mapAccount' },
    { key: 'pocket', i18n: 'mapPocket' },
    { key: 'destAccount', i18n: 'mapDestAccount' },
    { key: 'destPocket', i18n: 'mapDestPocket' },
    { key: 'destAmount', i18n: 'mapDestAmount' },
    { key: 'merchant', i18n: 'mapMerchant' },
    { key: 'note', i18n: 'mapNote' },
    { key: 'currency', i18n: 'mapCurrency' },
    { key: 'storeAddress', i18n: 'mapStoreAddress' },
    { key: 'isHistorical', i18n: 'mapIsHistorical' },
  ];

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  function initImporter(app) {
    const modal = document.getElementById('import-modal');
    const fileInput = document.getElementById('import-file-input');
    const jsonStep = document.getElementById('import-json-step');
    const jsonSummary = document.getElementById('import-json-summary');
    const backupModeSelect = document.getElementById('import-backup-mode');
    const commitBackupBtn = document.getElementById('btn-commit-backup');
    const step2 = document.getElementById('import-step2');
    const sheetSelect = document.getElementById('import-sheet-select');
    const defaultPocketSelect = document.getElementById('import-default-pocket');
    const defaultTypeSelect = document.getElementById('import-default-type');
    const mappingGrid = document.getElementById('import-mapping-grid');
    const totalRowsEl = document.getElementById('import-total-rows');
    const previewThead = document.getElementById('import-preview-thead');
    const previewTbody = document.getElementById('import-preview-tbody');
    const commitBtn = document.getElementById('btn-commit-import');
    const resultBanner = document.getElementById('import-result');

    let currentFileB64 = '';
    let currentFilename = '';
    let currentHeaders = [];
    let currentMapping = {};

    function openImporter() {
      fileInput.value = '';
      currentFileB64 = '';
      currentFilename = '';
      currentHeaders = [];
      jsonStep?.classList.add('hidden');
      commitBackupBtn?.classList.add('hidden');
      step2.classList.add('hidden');
      commitBtn.classList.add('hidden');
      resultBanner.classList.add('hidden');
      const markHistChk = document.getElementById('import-mark-historical');
      if (markHistChk) markHistChk.checked = false;
      app.populatePocketSelect(defaultPocketSelect);
      modal.showModal();
    }

    async function loadPreview(sheetIndex = 0) {
      resultBanner.classList.add('hidden');
      jsonStep?.classList.add('hidden');
      commitBackupBtn?.classList.add('hidden');
      step2.classList.add('hidden');
      commitBtn.classList.add('hidden');
      try {
        const res = await app.api('/api/import/preview', {
          method: 'POST',
          body: {
            fileBase64: currentFileB64,
            filename: currentFilename,
            sheetIndex,
          },
        });

        if (res.isBackupJson) {
          const c = res.counts || {};
          if (jsonSummary) {
            jsonSummary.textContent = tr('backupPreviewSummary', {
              txCount: c.transactions || 0,
              accCount: c.accounts || 0,
              pocketCount: c.pockets || 0,
              catCount: c.categories || 0,
              cpCount: c.counterparties || 0,
              recCount: c.receipts || 0,
            });
          }
          jsonStep?.classList.remove('hidden');
          commitBackupBtn?.classList.remove('hidden');
          return;
        }

        sheetSelect.innerHTML = res.sheets
          .map(
            (s) =>
              `<option value="${s.index}" ${s.index === res.selectedSheetIndex ? 'selected' : ''}>${app.esc(tr('rowsCountOption', { name: s.name, count: s.rowCount }))}</option>`
          )
          .join('');

        currentHeaders = res.headers || [];
        currentMapping = { ...res.suggestedMapping };
        renderMappingControls(currentHeaders, currentMapping);
        totalRowsEl.textContent = String(res.totalRows);
        renderPreviewTable(currentHeaders, res.previewRows);

        step2.classList.remove('hidden');
        commitBtn.classList.remove('hidden');
      } catch (err) {
        resultBanner.textContent = err.message || tr('parseFailed');
        resultBanner.className = 'status-banner err';
        resultBanner.classList.remove('hidden');
      }
    }

    function renderMappingControls(headers, mapping) {
      const optionsHtml = (selectedIdx) =>
        `<option value="-1">${app.esc(tr('notMapped'))}</option>` +
        headers
          .map((h, i) => `<option value="${i}" ${i === selectedIdx ? 'selected' : ''}>${app.esc(h)}</option>`)
          .join('');

      mappingGrid.innerHTML = MAPPING_FIELD_KEYS.map(
        (f) => `
          <label class="field">
            <span>${app.esc(tr(f.i18n))}</span>
            <select data-map-key="${f.key}">
              ${optionsHtml(mapping[f.key] ?? -1)}
            </select>
          </label>
        `
      ).join('');

      mappingGrid.querySelectorAll('select[data-map-key]').forEach((sel) => {
        sel.addEventListener('change', () => {
          currentMapping[sel.dataset.mapKey] = Number(sel.value);
        });
      });
    }

    if (window.MoneyI18n?.onChange) {
      window.MoneyI18n.onChange(() => {
        if (currentHeaders.length > 0 && !step2.classList.contains('hidden')) {
          renderMappingControls(currentHeaders, currentMapping);
        }
      });
    }

    function renderPreviewTable(headers, rows) {
      previewThead.innerHTML = `<tr>${headers.map((h) => `<th>${app.esc(h)}</th>`).join('')}</tr>`;
      previewTbody.innerHTML = rows
        .map(
          (row) =>
            `<tr>${headers.map((_, i) => `<td>${app.esc(row[i] ?? '')}</td>`).join('')}</tr>`
        )
        .join('');
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      currentFilename = file.name;
      currentFileB64 = await fileToBase64(file);
      await loadPreview(0);
    });

    sheetSelect.addEventListener('change', async () => {
      await loadPreview(Number(sheetSelect.value));
    });

    commitBackupBtn?.addEventListener('click', async () => {
      if (!currentFileB64) return;
      commitBackupBtn.disabled = true;
      commitBackupBtn.textContent = tr('btnImporting');
      try {
        const res = await app.api('/api/import/backup', {
          method: 'POST',
          body: {
            fileBase64: currentFileB64,
            mode: backupModeSelect?.value === 'merge' ? 'merge' : 'replace',
          },
        });
        const c = res.restoredCounts || {};
        const msg = tr('backupRestoreSuccess', {
          txCount: c.transactions || 0,
          accCount: c.accounts || 0,
          pocketCount: c.pockets || 0,
          recCount: c.receipts || 0,
        });
        resultBanner.textContent = msg;
        resultBanner.className = 'status-banner';
        resultBanner.classList.remove('hidden');

        await app.refreshDashboard();
        app.refreshAllEntityManagers?.();
        app.toast(msg, 'ok');
      } catch (err) {
        resultBanner.textContent = err.message || tr('importFailed');
        resultBanner.className = 'status-banner err';
        resultBanner.classList.remove('hidden');
      } finally {
        commitBackupBtn.disabled = false;
        commitBackupBtn.textContent = tr('btnRestoreBackup');
      }
    });

    commitBtn.addEventListener('click', async () => {
      if (!currentFileB64) return;
      commitBtn.disabled = true;
      commitBtn.textContent = tr('btnImporting');
      try {
        const res = await app.api('/api/import/commit', {
          method: 'POST',
          body: {
            fileBase64: currentFileB64,
            filename: currentFilename,
            sheetIndex: Number(sheetSelect.value) || 0,
            mapping: currentMapping,
            defaultPocketId: Number(defaultPocketSelect.value),
            defaultType: defaultTypeSelect.value,
            markAsHistorical: Boolean(document.getElementById('import-mark-historical')?.checked),
          },
        });

        let msg = tr('importSuccess', { count: res.importedCount, file: currentFilename });
        if (res.skippedCount > 0) {
          msg += tr('importSkipped', { count: res.skippedCount });
        }
        resultBanner.textContent = msg;
        resultBanner.className = 'status-banner';
        resultBanner.classList.remove('hidden');

        await app.refreshDashboard();
        app.refreshAllEntityManagers?.();
        app.toast(tr('importToast', { count: res.importedCount }), 'ok');
      } catch (err) {
        resultBanner.textContent = err.message || tr('importFailed');
        resultBanner.className = 'status-banner err';
        resultBanner.classList.remove('hidden');
      } finally {
        commitBtn.disabled = false;
        commitBtn.textContent = tr('btnImportHistorical');
      }
    });

    return { openImporter };
  }

  window.MoneyImporterUI = { initImporter };
})();
