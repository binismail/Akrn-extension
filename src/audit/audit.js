/**
 * ARKN — Audit & Compliance Script
 * Reads audit log stats from chrome.storage.local, renders tables, and manages CSV export.
 */
(function () {
  'use strict';

  const LOG_KEY = 'arknLog';

  // DOM Refs
  const totalRedactionsEl = document.getElementById('total-redactions');
  const statNamesOrgsEl   = document.getElementById('stat-names-orgs');
  const statFinanceLegalEl = document.getElementById('stat-finance-legal');
  const logCountEl         = document.getElementById('log-count');
  const tbodyEl            = document.getElementById('audit-tbody');
  const btnExport          = document.getElementById('btn-export');
  const btnClear           = document.getElementById('btn-clear');

  let loadedLogs = [];

  // ── Load and aggregate data ──────────────────────────────────────────────────

  function loadAuditLog() {
    chrome.storage.local.get(LOG_KEY, (res) => {
      const log = res[LOG_KEY] ?? [];
      loadedLogs = log;

      // Sort logs descending by timestamp (newest first)
      loadedLogs.sort((a, b) => b.ts - a.ts);

      renderDashboard();
    });
  }

  function renderDashboard() {
    let totalItems = 0;
    let namesOrgs = 0;
    let financeLegal = 0;

    // Aggregate counts
    for (const entry of loadedLogs) {
      const counts = entry.counts ?? {};
      for (const [type, count] of Object.entries(counts)) {
        totalItems += count;
        if (type === 'NAME' || type === 'ORG') {
          namesOrgs += count;
        } else if (type === 'DRIVELIC' || type === 'NHS' || type === 'BANK' || type === 'CLAIM') {
          financeLegal += count;
        }
      }
    }

    // Update stats cards
    totalRedactionsEl.textContent = totalItems;
    statNamesOrgsEl.textContent   = namesOrgs;
    statFinanceLegalEl.textContent = financeLegal;
    logCountEl.textContent         = loadedLogs.length;

    // Render table
    if (loadedLogs.length === 0) {
      tbodyEl.innerHTML = `
        <tr>
          <td colspan="4" class="empty-state">No ARKN protection events logged in the last 30 days.</td>
        </tr>
      `;
      return;
    }

    tbodyEl.innerHTML = '';

    const typeLabels = {
      EMAIL: 'email', PHONE: 'phone', POSTCODE: 'postcode', NINO: 'NINO',
      DRIVELIC: 'driving license', NHS: 'NHS number', BANK: 'bank details', CLAIM: 'claim no.',
      NAME: 'name', ORG: 'organisation'
    };

    for (const entry of loadedLogs) {
      const tr = document.createElement('tr');

      // 1. Timestamp
      const tdTime = document.createElement('td');
      tdTime.textContent = new Date(entry.ts).toLocaleString();
      tr.appendChild(tdTime);

      // 2. Engine — styled badge, platform-aware
      const tdEngine = document.createElement('td');
      const engineMap = {
        'ChatGPT': { label: 'ChatGPT', color: '#10a37f' },  // OpenAI green
        'chatgpt': { label: 'ChatGPT', color: '#10a37f' },  // legacy stored value
        'Claude':  { label: 'Claude',  color: '#cc785c' },  // Anthropic clay
        'claude':  { label: 'Claude',  color: '#cc785c' },
        'Gemini':  { label: 'Gemini',  color: '#4285f4' },  // Google blue
        'gemini':  { label: 'Gemini',  color: '#4285f4' },
      };
      const engineInfo = engineMap[entry.engine] ?? { label: entry.engine ?? 'Unknown', color: '#888' };
      const badge = document.createElement('span');
      badge.textContent = engineInfo.label;
      badge.style.cssText = `
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: ${engineInfo.color};
        background: ${engineInfo.color}18;
        border: 1px solid ${engineInfo.color}40;
      `;
      tdEngine.appendChild(badge);

      tr.appendChild(tdEngine);

      // 3. Session
      const tdSession = document.createElement('td');
      const fullSessionId = entry.sessionId || 'global';
      if (fullSessionId === 'global') {
        tdSession.textContent = 'global';
      } else {
        const shortSessionId = fullSessionId.slice(0, 8);
        tdSession.textContent = shortSessionId;
        tdSession.title = fullSessionId;
        tdSession.style.cursor = 'help';
      }
      tr.appendChild(tdSession);

      // 4. Breakdown
      const tdBreakdown = document.createElement('td');
      const breakdownDiv = document.createElement('div');
      breakdownDiv.className = 'breakdown-tags';

      const counts = entry.counts ?? {};
      let hasTags = false;
      for (const [type, count] of Object.entries(counts)) {
        if (count > 0) {
          const span = document.createElement('span');
          span.className = `tag tag-${type.toLowerCase()}`;
          const label = typeLabels[type] ?? type.toLowerCase();
          span.textContent = `${count} ${label}${count > 1 && type !== 'BANK' ? 's' : ''}`;
          breakdownDiv.appendChild(span);
          hasTags = true;
        }
      }

      if (!hasTags) {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = '0 items';
        breakdownDiv.appendChild(span);
      }

      tdBreakdown.appendChild(breakdownDiv);
      tr.appendChild(tdBreakdown);

      tbodyEl.appendChild(tr);
    }
  }

  // ── CSV Export ───────────────────────────────────────────────────────────────

  function exportCSV() {
    if (loadedLogs.length === 0) {
      alert('No audit logs available to export.');
      return;
    }

    const headers = [
      'Timestamp', 'AI Engine', 'Session ID',
      'Names', 'Organisations', 'Emails', 'Phone Numbers', 'Postcodes',
      'NI Numbers', 'Driving Licenses', 'NHS Numbers', 'Bank Details', 'Claim Numbers'
    ];

    const rows = [headers];

    for (const entry of loadedLogs) {
      const counts = entry.counts ?? {};
      const dateStr = new Date(entry.ts).toISOString();

      const row = [
        dateStr,
        entry.engine ?? 'unknown',
        entry.sessionId ?? 'global',
        counts.NAME ?? 0,
        counts.ORG ?? 0,
        counts.EMAIL ?? 0,
        counts.PHONE ?? 0,
        counts.POSTCODE ?? 0,
        counts.NINO ?? 0,
        counts.DRIVELIC ?? 0,
        counts.NHS ?? 0,
        counts.BANK ?? 0,
        counts.CLAIM ?? 0
      ];
      rows.push(row);
    }

    // Convert to CSV string
    const csvContent = rows
      .map((r) => r.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `arkn-compliance-audit-report_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ── Clear Logs ────────────────────────────────────────────────────────────────

  function clearLogs() {
    if (loadedLogs.length === 0) {
      alert('No audit logs to clear.');
      return;
    }

    const firstConfirm = confirm('⚠️ Warning: Are you sure you want to delete all local protection history? This action cannot be undone.');
    if (!firstConfirm) return;

    const secondConfirm = confirm('🚨 Double Check: Delete ALL compliance data now? your solicitor audit history will be permanently cleared.');
    if (!secondConfirm) return;

    chrome.storage.local.remove(LOG_KEY, () => {
      loadedLogs = [];
      renderDashboard();
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────

  btnExport.addEventListener('click', exportCSV);
  btnClear.addEventListener('click', clearLogs);

  loadAuditLog();
})();
