(function () {
  function tr(key, vars) {
    return window.MoneyI18n ? window.MoneyI18n.t(key, vars) : key;
  }

  function trCat(name) {
    return window.MoneyI18n ? window.MoneyI18n.tCat(name) : name;
  }

  function getThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    return {
      positive: pick('--positive', '#10b981'),
      negative: pick('--negative', '#f43f5e'),
      accent: pick('--accent', '#0ea5e9'),
      primary: pick('--primary', '#6366f1'),
    };
  }

  function fmtShortHuf(val) {
    const abs = Math.abs(val);
    if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${Math.round(val / 1_000)}k`;
    return `${Math.round(val)}`;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function measureChartBox(container, legendReserve = 0) {
    container.innerHTML = '';
    const width = Math.max(200, Math.min(1150, Math.round(container.clientWidth || 560)));
    const rectH = container.clientHeight ? Math.round(container.clientHeight) : 0;
    const availH = rectH > legendReserve + 20 ? rectH - legendReserve : rectH;
    const height = Math.max(90, Math.min(720, Number(container.dataset.customHeight) || availH || 220));
    return { width, height };
  }

  function renderMonthlyCashflowChart(container, series) {
    if (!container) return;
    if (!series || series.length === 0) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyMonthly'))}</div>`;
      return;
    }

    const { width, height } = measureChartBox(container, 24);
    const pad = { top: 18, right: 16, bottom: 32, left: 50 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const maxVal = Math.max(
      1,
      ...series.map((d) => Math.max(d.incomeHuf, d.expenseHuf, d.transferHuf || 0))
    );

    const groupW = plotW / series.length;
    const barW = Math.min(14, Math.max(4, groupW * 0.22));

    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((frac) => {
        const y = pad.top + plotH * (1 - frac);
        const val = maxVal * frac;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(148,163,184,0.16)" stroke-dasharray="3 3" />
          <text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="10">${fmtShortHuf(val)}</text>
        `;
      })
      .join('');

    const incLabel = tr('legendIncome');
    const expLabel = tr('legendOutgoing');
    const trfLabel = tr('legendTransfers');
    const colors = getThemeColors();

    const bars = series
      .map((d, idx) => {
        const cx = pad.left + idx * groupW + groupW / 2;
        const incH = (d.incomeHuf / maxVal) * plotH;
        const expH = (d.expenseHuf / maxVal) * plotH;
        const trfH = ((d.transferHuf || 0) / maxVal) * plotH;
        const incY = pad.top + plotH - incH;
        const expY = pad.top + plotH - expH;
        const trfY = pad.top + plotH - trfH;
        const label = d.month.slice(2);

        return `
          <g>
            <rect x="${cx - barW * 1.5 - 2}" y="${incY}" width="${barW}" height="${incH}" rx="2.5" fill="${escapeHtml(colors.positive)}">
              <title>${escapeHtml(d.month)} ${escapeHtml(incLabel)}: ${Math.round(d.incomeHuf).toLocaleString()} Ft</title>
            </rect>
            <rect x="${cx - barW * 0.5}" y="${expY}" width="${barW}" height="${expH}" rx="2.5" fill="${escapeHtml(colors.negative)}">
              <title>${escapeHtml(d.month)} ${escapeHtml(expLabel)}: ${Math.round(d.expenseHuf).toLocaleString()} Ft</title>
            </rect>
            <rect x="${cx + barW * 0.5 + 2}" y="${trfY}" width="${barW}" height="${trfH}" rx="2.5" fill="${escapeHtml(colors.accent)}">
              <title>${escapeHtml(d.month)} ${escapeHtml(trfLabel)}: ${Math.round(d.transferHuf || 0).toLocaleString()} Ft</title>
            </rect>
            <text x="${cx}" y="${height - 10}" text-anchor="middle" fill="#94a3b8" font-size="10">${escapeHtml(label)}</text>
          </g>
        `;
      })
      .join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;" role="img" aria-label="${escapeHtml(tr('chartMonthlyTitle'))}">
        ${gridLines}
        ${bars}
      </svg>
      <div class="small muted" style="display:flex;gap:14px;justify-content:center;margin-top:4px;">
        <span><span style="color:${escapeHtml(colors.positive)};">■</span> ${escapeHtml(incLabel)}</span>
        <span><span style="color:${escapeHtml(colors.negative)};">■</span> ${escapeHtml(expLabel)}</span>
        <span><span style="color:${escapeHtml(colors.accent)};">■</span> ${escapeHtml(trfLabel)}</span>
      </div>
    `;
  }

  function renderExpenseDonutChart(container, breakdown) {
    if (!container) return;
    if (!breakdown || breakdown.length === 0) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyExpense'))}</div>`;
      return;
    }

    const total = breakdown.reduce((s, item) => s + item.amountHuf, 0);
    if (total <= 0) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyExpense'))}</div>`;
      return;
    }

    const r = 58;
    const cx = 80;
    const cy = 80;
    const circumference = 2 * Math.PI * r;
    let offset = 0;

    const slices = breakdown
      .map((item) => {
        const dash = (item.amountHuf / total) * circumference;
        const catLabel = trCat(item.category);
        const circle = `
          <circle cx="${cx}" cy="${cy}" r="${r}"
            fill="transparent"
            stroke="${escapeHtml(item.color)}"
            stroke-width="24"
            stroke-dasharray="${dash} ${circumference - dash}"
            stroke-dashoffset="${-offset}"
            transform="rotate(-90 ${cx} ${cy})">
            <title>${escapeHtml(catLabel)}: ${Math.round(item.amountHuf).toLocaleString()} Ft (${item.pct}%)</title>
          </circle>
        `;
        offset += dash;
        return circle;
      })
      .join('');

    const legend = breakdown
      .slice(0, 7)
      .map(
        (item) => `
          <div class="legend-item">
            <div class="legend-left">
              <span class="legend-swatch" style="background:${escapeHtml(item.color)}"></span>
              <span>${escapeHtml(trCat(item.category))}</span>
            </div>
            <div><strong>${item.pct}%</strong> <span class="muted">${fmtShortHuf(item.amountHuf)} Ft</span></div>
          </div>
        `
      )
      .join('');

    container.innerHTML = `
      <div class="donut-wrap">
        <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="${escapeHtml(tr('chartDonutTitle'))}">
          ${slices}
          <text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="currentColor" font-size="13" font-weight="800">${fmtShortHuf(total)} Ft</text>
          <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#94a3b8" font-size="10">${escapeHtml(tr('donutTotalOutgoing'))}</text>
        </svg>
        <div class="legend-list">${legend}</div>
      </div>
    `;
  }

  function renderIncomeSourcesChart(container, incomeBreakdown, transferBreakdown = []) {
    if (!container) return;
    const hasIncome = Array.isArray(incomeBreakdown) && incomeBreakdown.length > 0;
    const hasTransfers = Array.isArray(transferBreakdown) && transferBreakdown.length > 0;

    if (!hasIncome && !hasTransfers) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyIncome'))}</div>`;
      return;
    }

    const renderGroup = (title, items) => {
      const max = Math.max(1, ...items.map((b) => b.amountHuf));
      const rows = items
        .map((b) => {
          const w = Math.max(4, Math.round((b.amountHuf / max) * 100));
          return `
            <div>
              <div class="hbar-row-top">
                <span><strong>${escapeHtml(trCat(b.category))}</strong> (${b.count})</span>
                <span>${Math.round(b.amountHuf).toLocaleString()} Ft · <span class="muted">${b.pct}%</span></span>
              </div>
              <div class="hbar-track">
                <div class="hbar-fill" style="width:${w}%;background:${escapeHtml(b.color)}"></div>
              </div>
            </div>
          `;
        })
        .join('');
      return `<div style="margin-bottom:12px;"><div class="small muted" style="font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(title)}</div><div class="hbar-list">${rows}</div></div>`;
    };

    let html = '';
    if (hasIncome) html += renderGroup(tr('groupIncomeSources'), incomeBreakdown);
    if (hasTransfers) html += renderGroup(tr('groupTransfers'), transferBreakdown);
    container.innerHTML = html;
  }

  function renderBalanceHistoryChart(container, series) {
    if (!container) return;
    if (!series || series.length === 0) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyBalance'))}</div>`;
      return;
    }

    const points = series.length === 1 ? [series[0], series[0]] : series;
    const { width, height } = measureChartBox(container, 0);
    const pad = { top: 18, right: 16, bottom: 30, left: 54 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const vals = points.map((p) => p.pocketBalanceAfterHuf);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = Math.max(1, maxV - minV);

    const coords = points.map((p, idx) => {
      const x = pad.left + (idx / Math.max(1, points.length - 1)) * plotW;
      const y = pad.top + plotH - ((p.pocketBalanceAfterHuf - minV) / span) * plotH;
      return { x, y, raw: p };
    });

    const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const area = `${pad.left},${pad.top + plotH} ${polyline} ${(pad.left + plotW).toFixed(1)},${pad.top + plotH}`;

    const yLabels = [0, 0.5, 1]
      .map((frac) => {
        const y = pad.top + plotH * (1 - frac);
        const v = minV + span * frac;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(148,163,184,0.16)" stroke-dasharray="3 3" />
          <text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="10">${fmtShortHuf(v)}</text>
        `;
      })
      .join('');

    const colors = getThemeColors();
    const dots = coords
      .map(
        (c) => `
          <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="${escapeHtml(colors.accent)}">
            <title>${escapeHtml(c.raw.date)} · ${escapeHtml(c.raw.accountName)} (${escapeHtml(c.raw.pocketName)}): ${Math.round(c.raw.pocketBalanceAfter).toLocaleString()} ${escapeHtml(c.raw.currency)}</title>
          </circle>
        `
      )
      .join('');

    const firstDate = points[0].date.slice(0, 10);
    const lastDate = points[points.length - 1].date.slice(0, 10);

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;" role="img" aria-label="${escapeHtml(tr('chartBalanceTitle'))}">
        <defs>
          <linearGradient id="balArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${escapeHtml(colors.accent)}" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="${escapeHtml(colors.accent)}" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        ${yLabels}
        <polygon points="${area}" fill="url(#balArea)" />
        <polyline points="${polyline}" fill="none" stroke="${escapeHtml(colors.accent)}" stroke-width="2.5" stroke-linejoin="round" />
        ${dots}
        <text x="${pad.left}" y="${height - 8}" fill="#94a3b8" font-size="10">${escapeHtml(firstDate)}</text>
        <text x="${width - pad.right}" y="${height - 8}" text-anchor="end" fill="#94a3b8" font-size="10">${escapeHtml(lastDate)}</text>
      </svg>
    `;
  }

  function renderTopMerchantsChart(container, topMerchants, topIncomeSources = []) {
    if (!container) return;
    const expList = Array.isArray(topMerchants) ? topMerchants : [];
    const incList = Array.isArray(topIncomeSources) ? topIncomeSources : [];

    if (expList.length === 0 && incList.length === 0) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyMerchants'))}</div>`;
      return;
    }

    const renderGroup = (title, items, limit) => {
      const sliced = items.slice(0, limit);
      const max = Math.max(1, ...sliced.map((b) => b.amountHuf));
      const rows = sliced
        .map((b, idx) => {
          const w = Math.max(4, Math.round((b.amountHuf / max) * 100));
          return `
            <div>
              <div class="hbar-row-top">
                <span><strong>#${idx + 1} ${escapeHtml(b.name)}</strong> (${b.count})</span>
                <span>${Math.round(b.amountHuf).toLocaleString()} Ft · <span class="muted">${b.pct}%</span></span>
              </div>
              <div class="hbar-track">
                <div class="hbar-fill" style="width:${w}%;background:${escapeHtml(b.color)}"></div>
              </div>
            </div>
          `;
        })
        .join('');
      return `<div style="margin-bottom:12px;"><div class="small muted" style="font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(title)}</div><div class="hbar-list">${rows}</div></div>`;
    };

    let html = '';
    if (expList.length > 0) html += renderGroup(tr('groupTopOutgoingPlaces'), expList, 7);
    if (incList.length > 0) html += renderGroup(tr('groupTopIncomeSenders'), incList, 3);
    container.innerHTML = html;
  }

  function renderNetTrendChart(container, monthlySeries) {
    if (!container) return;
    if (!monthlySeries || monthlySeries.length === 0) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyNetTrend'))}</div>`;
      return;
    }

    const { width, height } = measureChartBox(container, 24);
    const pad = { top: 18, right: 16, bottom: 32, left: 54 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const allVals = [0];
    for (const d of monthlySeries) {
      allVals.push(Number(d.netHuf) || 0, Number(d.cumulativeNetHuf) || 0);
    }
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const span = Math.max(1, maxV - minV);
    const toY = (v) => pad.top + ((maxV - v) / span) * plotH;
    const zeroY = toY(0);

    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((frac) => {
        const y = pad.top + plotH * frac;
        const val = maxV - span * frac;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(148,163,184,0.16)" stroke-dasharray="3 3" />
          <text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="10">${fmtShortHuf(val)}</text>
        `;
      })
      .join('');

    const colors = getThemeColors();
    const groupW = plotW / monthlySeries.length;
    const barW = Math.min(26, Math.max(6, groupW * 0.45));
    const netLabel = tr('legendMonthlyNet');
    const cumLabel = tr('legendCumulativeNet');

    const bars = monthlySeries
      .map((d, idx) => {
        const cx = pad.left + idx * groupW + groupW / 2;
        const val = Number(d.netHuf) || 0;
        const vy = toY(val);
        const y = val >= 0 ? vy : zeroY;
        const h = Math.max(1.5, Math.abs(zeroY - vy));
        const fill = val >= 0 ? colors.positive : colors.negative;
        const label = d.month.slice(2);
        return `
          <rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" fill="${escapeHtml(fill)}" opacity="0.82">
            <title>${escapeHtml(d.month)} ${escapeHtml(netLabel)}: ${Math.round(val).toLocaleString()} Ft (${d.savingsRate ?? 0}%)</title>
          </rect>
          <text x="${cx.toFixed(1)}" y="${height - 10}" text-anchor="middle" fill="#94a3b8" font-size="10">${escapeHtml(label)}</text>
        `;
      })
      .join('');

    const lineCoords = monthlySeries.map((d, idx) => ({
      x: pad.left + idx * groupW + groupW / 2,
      y: toY(Number(d.cumulativeNetHuf) || 0),
      raw: d,
    }));
    const polyline = lineCoords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const dots = lineCoords
      .map(
        (c) => `
          <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="${escapeHtml(colors.accent)}" stroke="#0f172a" stroke-width="1">
            <title>${escapeHtml(c.raw.month)} ${escapeHtml(cumLabel)}: ${Math.round(c.raw.cumulativeNetHuf || 0).toLocaleString()} Ft</title>
          </circle>
        `
      )
      .join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;" role="img" aria-label="${escapeHtml(tr('chartNetTrendTitle'))}">
        ${gridLines}
        <line x1="${pad.left}" y1="${zeroY.toFixed(1)}" x2="${width - pad.right}" y2="${zeroY.toFixed(1)}" stroke="rgba(148,163,184,0.45)" stroke-width="1" />
        ${bars}
        ${lineCoords.length > 1 ? `<polyline points="${polyline}" fill="none" stroke="${escapeHtml(colors.accent)}" stroke-width="2.5" stroke-linejoin="round" />` : ''}
        ${dots}
      </svg>
      <div class="small muted" style="display:flex;gap:14px;justify-content:center;margin-top:4px;">
        <span><span style="color:${escapeHtml(colors.positive)};">■</span> ${escapeHtml(netLabel)}</span>
        <span><span style="color:${escapeHtml(colors.accent)};">●</span> ${escapeHtml(cumLabel)}</span>
      </div>
    `;
  }

  function renderDailySpendingChart(container, dailySeries) {
    if (!container) return;
    if (!dailySeries || dailySeries.length === 0) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyDaily'))}</div>`;
      return;
    }

    const { width, height } = measureChartBox(container, 18);
    const pad = { top: 18, right: 16, bottom: 30, left: 50 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const maxVal = Math.max(1, ...dailySeries.map((d) => d.expenseHuf || 0));
    const avgVal = dailySeries.reduce((s, d) => s + (d.expenseHuf || 0), 0) / dailySeries.length;
    const avgY = pad.top + plotH - (avgVal / maxVal) * plotH;

    const gridLines = [0, 0.5, 1]
      .map((frac) => {
        const y = pad.top + plotH * (1 - frac);
        const val = maxVal * frac;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(148,163,184,0.16)" stroke-dasharray="3 3" />
          <text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="10">${fmtShortHuf(val)}</text>
        `;
      })
      .join('');

    const colors = getThemeColors();
    const groupW = plotW / dailySeries.length;
    const barW = Math.min(20, Math.max(3, groupW * 0.68));
    const bars = dailySeries
      .map((d, idx) => {
        const cx = pad.left + idx * groupW + groupW / 2;
        const h = Math.max(1.5, ((d.expenseHuf || 0) / maxVal) * plotH);
        const y = pad.top + plotH - h;
        return `
          <rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${escapeHtml(colors.negative)}" opacity="0.88">
            <title>${escapeHtml(d.date)}: ${Math.round(d.expenseHuf).toLocaleString()} Ft (${d.count})</title>
          </rect>
        `;
      })
      .join('');

    const firstDate = dailySeries[0].date;
    const lastDate = dailySeries[dailySeries.length - 1].date;
    const avgLabel = tr('dailyAvgLineLabel', { amt: fmtShortHuf(avgVal) });

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;" role="img" aria-label="${escapeHtml(tr('chartDailySpendTitle'))}">
        ${gridLines}
        ${bars}
        <line x1="${pad.left}" y1="${avgY.toFixed(1)}" x2="${width - pad.right}" y2="${avgY.toFixed(1)}" stroke="${escapeHtml(colors.accent)}" stroke-width="1.5" stroke-dasharray="5 4" />
        <text x="${width - pad.right}" y="${Math.max(12, avgY - 4).toFixed(1)}" text-anchor="end" fill="${escapeHtml(colors.accent)}" font-size="10" font-weight="700">${escapeHtml(avgLabel)}</text>
        <text x="${pad.left}" y="${height - 8}" fill="#94a3b8" font-size="10">${escapeHtml(firstDate)}</text>
        ${firstDate !== lastDate ? `<text x="${width - pad.right}" y="${height - 8}" text-anchor="end" fill="#94a3b8" font-size="10">${escapeHtml(lastDate)}</text>` : ''}
      </svg>
    `;
  }

  function renderWeekdaySpendingChart(container, weekdaySeries) {
    if (!container) return;
    const list = Array.isArray(weekdaySeries) ? weekdaySeries : [];
    const peakVal = Math.max(0, ...list.map((d) => Number(d.expenseHuf) || 0));
    if (list.length === 0 || peakVal <= 0) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyWeekday'))}</div>`;
      return;
    }

    const { width, height } = measureChartBox(container, 0);
    const pad = { top: 18, right: 16, bottom: 32, left: 50 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const dayKeys = [
      'weekdayShortMon',
      'weekdayShortTue',
      'weekdayShortWed',
      'weekdayShortThu',
      'weekdayShortFri',
      'weekdayShortSat',
      'weekdayShortSun',
    ];

    const gridLines = [0, 0.5, 1]
      .map((frac) => {
        const y = pad.top + plotH * (1 - frac);
        const val = peakVal * frac;
        return `
          <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(148,163,184,0.16)" stroke-dasharray="3 3" />
          <text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="10">${fmtShortHuf(val)}</text>
        `;
      })
      .join('');

    const colors = getThemeColors();
    const groupW = plotW / list.length;
    const barW = Math.min(34, Math.max(10, groupW * 0.55));
    const bars = list
      .map((d, idx) => {
        const cx = pad.left + idx * groupW + groupW / 2;
        const val = Number(d.expenseHuf) || 0;
        const h = val > 0 ? Math.max(2, (val / peakVal) * plotH) : 0;
        const y = pad.top + plotH - h;
        const isPeak = val === peakVal && peakVal > 0;
        const dayLabel = tr(dayKeys[d.dow] || dayKeys[idx] || '');
        const fill = isPeak ? colors.negative : colors.primary;
        return `
          <rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${escapeHtml(fill)}" opacity="${isPeak ? '0.95' : '0.78'}">
            <title>${escapeHtml(dayLabel)}: ${Math.round(val).toLocaleString()} Ft (${d.pct}% · ${d.count})</title>
          </rect>
          <text x="${cx.toFixed(1)}" y="${height - 10}" text-anchor="middle" fill="#94a3b8" font-size="11">${escapeHtml(dayLabel)}</text>
        `;
      })
      .join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;" role="img" aria-label="${escapeHtml(tr('chartWeekdayTitle'))}">
        ${gridLines}
        ${bars}
      </svg>
    `;
  }

  function renderWealthDistributionChart(container, wealthItems) {
    if (!container) return;
    const items = Array.isArray(wealthItems) ? wealthItems.filter((x) => Number(x.balanceHuf) > 0) : [];
    const total = items.reduce((s, x) => s + Number(x.balanceHuf || 0), 0);
    if (items.length === 0 || total <= 0) {
      container.innerHTML = `<div class="chart-empty">${escapeHtml(tr('chartEmptyWealth'))}</div>`;
      return;
    }

    const r = 58;
    const cx = 80;
    const cy = 80;
    const circumference = 2 * Math.PI * r;
    let offset = 0;

    const slices = items
      .map((item) => {
        const dash = (item.balanceHuf / total) * circumference;
        const label = `${item.accountName} -> ${item.pocketName}`;
        const circle = `
          <circle cx="${cx}" cy="${cy}" r="${r}"
            fill="transparent"
            stroke="${escapeHtml(item.color)}"
            stroke-width="24"
            stroke-dasharray="${dash} ${circumference - dash}"
            stroke-dashoffset="${-offset}"
            transform="rotate(-90 ${cx} ${cy})">
            <title>${escapeHtml(label)}: ${Math.round(item.balanceHuf).toLocaleString()} Ft (${item.pct}%)</title>
          </circle>
        `;
        offset += dash;
        return circle;
      })
      .join('');

    const legend = items
      .slice(0, 7)
      .map(
        (item) => `
          <div class="legend-item">
            <div class="legend-left">
              <span class="legend-swatch" style="background:${escapeHtml(item.color)}"></span>
              <span>${escapeHtml(item.accountName)} → ${escapeHtml(item.pocketName)}</span>
            </div>
            <div><strong>${item.pct}%</strong> <span class="muted">${fmtShortHuf(item.balanceHuf)} Ft</span></div>
          </div>
        `
      )
      .join('');

    container.innerHTML = `
      <div class="donut-wrap">
        <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="${escapeHtml(tr('chartWealthTitle'))}">
          ${slices}
          <text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="currentColor" font-size="13" font-weight="800">${fmtShortHuf(total)} Ft</text>
          <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#94a3b8" font-size="10">${escapeHtml(tr('donutTotalWealth'))}</text>
        </svg>
        <div class="legend-list">${legend}</div>
      </div>
    `;
  }

  window.MoneyCharts = {
    renderMonthlyCashflowChart,
    renderExpenseDonutChart,
    renderIncomeSourcesChart,
    renderTopMerchantsChart,
    renderNetTrendChart,
    renderDailySpendingChart,
    renderWeekdaySpendingChart,
    renderWealthDistributionChart,
    renderBalanceHistoryChart,
  };
})();
