/**
 * ARKN — Popup Controller Script
 * Handles view switching (Auth vs Main stats), redirection triggers,
 * toggles, backup exports/imports, and periods filtering.
 */
(function () {
  'use strict';

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const authView     = $('auth-view');
  const mainView     = $('main-view');
  const btnConnect   = $('btn-connect');
  const btnSignout   = $('btn-signout');
  const userEmail    = $('user-email');

  const heroNumber   = $('hero-number');
  const heroLabel    = $('hero-label');
  const statusBadge  = $('status-badge');
  const statusLabel  = $('status-label');
  const briefingList = $('briefing-list');
  const toggleEl     = $('toggle-enabled');
  const btnHistory   = $('btn-history');
  
  // Backup / Restore elements
  const btnExport    = $('btn-export');
  const inputImport  = $('input-import');
  const backupStatus = $('backup-status');

  const periodBtns   = document.querySelectorAll('.period-btn');

  let currentPeriod = 'today';
  let cachedStats   = null;

  // ── Session & Stats Loader ───────────────────────────────────────────────────

  function loadPopupState() {
    chrome.runtime.sendMessage({ type: 'ARKN_GET_STATS' }, (stats) => {
      if (chrome.runtime.lastError || !stats) {
        showView(false);
        return;
      }
      
      cachedStats = stats;
      const isConnected = !!stats.session;
      
      showView(isConnected);

      if (isConnected) {
        userEmail.textContent = stats.session.email || 'Connected';
        renderStats(currentPeriod);
        renderStatus(stats.enabled);
        toggleEl.checked = stats.enabled;
      }
    });
  }

  function showView(isConnected) {
    if (isConnected) {
      authView.classList.add('hidden');
      mainView.classList.remove('hidden');
    } else {
      mainView.classList.add('hidden');
      authView.classList.remove('hidden');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const PII_LABELS = {
    EMAIL: { name: 'Email Addresses', badge: 'EMAIL' },
    PHONE: { name: 'Phone Numbers', badge: 'PHONE' },
    POSTCODE: { name: 'UK Postcodes', badge: 'POSTCODE' },
    NINO: { name: 'National Insurance Numbers', badge: 'NINO' },
    DRIVELIC: { name: 'Driving Licenses', badge: 'DRIVELIC' },
    NHS: { name: 'NHS Numbers', badge: 'NHS' },
    BANK: { name: 'UK Bank Details', badge: 'BANK' },
    CLAIM: { name: 'Court Claim Numbers', badge: 'CLAIM' },
    NAME: { name: 'Personal Names', badge: 'NAME' },
    ORG: { name: 'Organizations / Firms', badge: 'ORG' },
  };

  function renderStats(period) {
    if (!cachedStats) return;
    const data = cachedStats[period] ?? { total: 0 };

    heroNumber.textContent = data.total ?? 0;
    const periodLabels = { today: 'today', week: 'this week', allTime: 'all time' };
    heroLabel.textContent = `items protected ${periodLabels[period] ?? ''}`;

    // Clear briefing list
    briefingList.innerHTML = '';

    // Filter type keys that have count > 0 (ignoring total)
    const activeTypes = Object.entries(data)
      .filter(([key, val]) => key !== 'total' && typeof val === 'number' && val > 0)
      .sort((a, b) => b[1] - a[1]); // sort by count descending

    if (activeTypes.length === 0) {
      briefingList.innerHTML = `
        <div class="briefing-empty">
          <span class="shield-icon-lg">🛡️</span>
          <span class="empty-title">All Prompts Secured</span>
          <span class="empty-desc">No sensitive PII has been leaked.</span>
        </div>
      `;
      return;
    }

    for (const [type, count] of activeTypes) {
      const info = PII_LABELS[type] || {
        name: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        badge: type
      };
      
      const row = document.createElement('div');
      row.className = 'briefing-row';
      row.innerHTML = `
        <div class="briefing-left">
          <span class="briefing-name">${info.name}</span>
          <span class="briefing-tag">${info.badge}</span>
        </div>
        <span class="briefing-count">${count}</span>
      `;
      briefingList.appendChild(row);
    }
  }

  function renderStatus(enabled) {
    statusBadge.className = `status-badge ${enabled ? 'active' : 'inactive'}`;
    statusLabel.textContent = enabled ? 'Active' : 'Paused';
  }

  // ── Action Bindings ──────────────────────────────────────────────────────────

  btnConnect.addEventListener('click', () => {
    chrome.tabs.create({ url: `${globalThis.ARKN_CONFIG.DASHBOARD_URL}/dashboard` });
  });

  btnSignout.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'ARKN_LOG_OUT' }, () => {
      showView(false);
      cachedStats = null;
    });
  });

  // ── Period switcher ───────────────────────────────────────────────────────────

  periodBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      periodBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      renderStats(currentPeriod);
    });
  });

  // ── Toggle ────────────────────────────────────────────────────────────────────

  toggleEl.addEventListener('change', () => {
    const enabled = toggleEl.checked;
    renderStatus(enabled);
    chrome.runtime.sendMessage({ type: 'ARKN_SET_ENABLED', enabled }, () => {
      // Notify active ChatGPT/Claude/Gemini tabs
      chrome.tabs.query(
        { url: [
          'https://chatgpt.com/*', 
          'https://chat.openai.com/*', 
          'https://claude.ai/*', 
          'https://gemini.google.com/*'
        ]},
        (tabs) => {
          for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, { type: 'ARKN_ENABLED_CHANGED', enabled })
              .catch(() => {/* tab may not have content script */});
          }
        }
      );
    });
  });

  btnHistory.addEventListener('click', () => {
    chrome.tabs.create({ url: `${globalThis.ARKN_CONFIG.DASHBOARD_URL}/dashboard/reports` });
  });

  // ── Backup / Restore Helpers ──────────────────────────────────────────────────

  let statusTimer = null;
  function showBackupStatus(msg, isError = false) {
    backupStatus.textContent = msg;
    backupStatus.style.color = isError ? '#ef4444' : '#1A5C38';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { backupStatus.textContent = ''; }, 4000);
  }

  btnExport.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'ARKN_EXPORT_TOKENS' }, (res) => {
      if (chrome.runtime.lastError || !res?.tokens) {
        showBackupStatus('No local sessions to export yet.', true);
        return;
      }

      const blob = new Blob([JSON.stringify(res.tokens, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href     = url;
      a.download = `arkn-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);

      const sessionCount = Object.keys(res.tokens.sessions ?? {}).length;
      showBackupStatus(`✓ Exported ${sessionCount} session(s)`);
    });
  });

  inputImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      let parsed;
      try { parsed = JSON.parse(ev.target.result); }
      catch {
        showBackupStatus('Invalid backup file.', true);
        return;
      }

      if (!parsed?.sessions) {
        showBackupStatus('File is not an ARKN backup.', true);
        return;
      }

      chrome.runtime.sendMessage({ type: 'ARKN_IMPORT_TOKENS', tokens: parsed }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          showBackupStatus('Import failed.', true);
          return;
        }
        showBackupStatus(`✓ Imported ${res.sessionCount} session(s)`);
      });
    };
    reader.readAsText(file);
    inputImport.value = '';
  });

  // ── Boot ──────────────────────────────────────────────────────────────────────

  loadPopupState();
})();
