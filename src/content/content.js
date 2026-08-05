/**
 * ARKN — Content Script (document_start, isolated world)
 *
 * Token persistence strategy:
 *   - Token maps (token → original PII) are stored in chrome.storage.local,
 *     keyed by conversation UUID.
 *   - chrome.storage.local IS directly accessible from content scripts.
 *   - Entries are pruned after TOKEN_TTL_DAYS to prevent accumulation.
 *
 * Architecture:
 *   - MAIN world (interceptor) ↔ Isolated world (this script) ↔ Background (service worker)
 *   - CustomEvents bridge between MAIN and Isolated worlds.
 *   - Syncs enablement status dynamically.
 */
(function () {
  'use strict';

  const TOKEN_STORAGE_KEY = 'arknTokenStore';
  const TOKEN_TTL_DAYS    = 30;
  const TOKEN_TTL_MS      = TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  // ── Shared state ─────────────────────────────────────────────────────────────
  window.__ARKN__ = {
    tokenStore: {},    // { [conversationId]: { [token]: originalValue } }
    lastSummary: {},
    totalToday: 0,
  };

  let arknEnabled = true;
  let isStorageLoaded = false;

  // ── Extension context guard ──────────────────────────────────────────────────
  // When the extension is reloaded while a tab is open, the old content script
  // loses its chrome runtime connection. Calling chrome.* then throws
  // "Extension context invalidated". This guard lets us detect that and bail.

  function isContextValid() {
    try { return !!chrome.runtime?.id; }
    catch { return false; }
  }

  // ── Storage helpers ───────────────────────────────────────────────────────────

  /** Persist the full token store to chrome.storage.local. */
  function persistTokens() {
    if (!isContextValid()) return; // extension was reloaded — skip silently
    chrome.storage.local.set({
      [TOKEN_STORAGE_KEY]: {
        savedAt: Date.now(),
        sessions: window.__ARKN__.tokenStore,
      },
    });
  }

  /** Load token store from storage on page load. */
  function restoreTokens() {
    if (!isContextValid()) return;
    chrome.storage.local.get(TOKEN_STORAGE_KEY, (res) => {
      if (chrome.runtime.lastError) {
        console.warn('[ARKN] Storage read error:', chrome.runtime.lastError.message);
        return;
      }

      const stored = res[TOKEN_STORAGE_KEY];
      if (!stored?.sessions) return;

      // Prune if entire store is older than TTL
      if (Date.now() - stored.savedAt > TOKEN_TTL_MS) {
        chrome.storage.local.remove(TOKEN_STORAGE_KEY);
        console.log('[ARKN] Token store expired — cleared');
        return;
      }

      // Merge into in-memory store
      let count = 0;
      for (const [sessionId, tokens] of Object.entries(stored.sessions)) {
        window.__ARKN__.tokenStore[sessionId] = { ...tokens };
        count += Object.keys(tokens).length;
      }

      console.log('[ARKN] 🔄 Restored', Object.keys(stored.sessions).length,
        'conversation(s),', count, 'token(s)');

      dispatchRestoredTokens();

      // Trigger unmasker to scan existing content immediately
      window.dispatchEvent(new CustomEvent('arkn:tokens-ready', {
        detail: { restored: true },
      }));
    });
  }

  function dispatchRestoredTokens() {
    window.dispatchEvent(new CustomEvent('arkn:tokens-restored', {
      detail: { sessions: window.__ARKN__.tokenStore }
    }));
  }

  window.addEventListener('arkn:request-restored-tokens', () => {
    dispatchRestoredTokens();
  });

  // Restore immediately — before any content renders
  restoreTokens();

  // ── Enabled Status & Policy Sync ─────────────────────────────────────────────

  const SESSION_KEY = 'arknSessionStore';
  let policyConfig = null;

  function dispatchEnabledStatus() {
    window.dispatchEvent(new CustomEvent('arkn:enabled-status', {
      detail: { enabled: arknEnabled }
    }));
  }

  function dispatchPolicy() {
    window.dispatchEvent(new CustomEvent('arkn:policy-sync', {
      detail: policyConfig
    }));
  }

  // Load initial states
  chrome.storage.local.get(['arknEnabled', SESSION_KEY], (res) => {
    arknEnabled = res.arknEnabled !== false;
    isStorageLoaded = true;
    dispatchEnabledStatus();

    const session = res[SESSION_KEY];
    if (session && session.policy) {
      policyConfig = session.policy;
      dispatchPolicy();
    }
  });

  // Listen for requests from MAIN world
  window.addEventListener('arkn:request-enabled', () => {
    if (isStorageLoaded) {
      dispatchEnabledStatus();
    } else {
      chrome.storage.local.get('arknEnabled', (res) => {
        arknEnabled = res.arknEnabled !== false;
        isStorageLoaded = true;
        dispatchEnabledStatus();
      });
    }
  });

  window.addEventListener('arkn:request-policy', () => {
    if (policyConfig) {
      dispatchPolicy();
    } else {
      chrome.storage.local.get(SESSION_KEY, (res) => {
        const session = res[SESSION_KEY];
        if (session && session.policy) {
          policyConfig = session.policy;
          dispatchPolicy();
        }
      });
    }
  });

  // Background NER bridge: MAIN world never imports the model.
  window.addEventListener('arkn:ner-request', (event) => {
    const { requestId, text } = event.detail || {};
    if (!isContextValid()) {
      console.warn('[ARKN] NER bridge unavailable: extension context invalidated. Reload this tab.');
      window.postMessage({ type: 'ARKN_NER_RESPONSE', requestId, text, spans: [], error: 'context-invalidated' }, '*');
      return;
    }
    chrome.runtime.sendMessage({ type: 'ARKN_NER', requestId, text }, (response) => {
      if (chrome.runtime.lastError || !response) {
        console.warn('[ARKN] NER bridge failed:', chrome.runtime.lastError?.message || 'empty response');
        return;
      }
      const detail = { requestId, text, spans: response.spans || [], error: response.error || null };
      window.postMessage({ type: 'ARKN_NER_RESPONSE', ...detail }, '*');
      window.dispatchEvent(new CustomEvent('arkn:ner-response', { detail }));
    });
  });

  // Listen for updates from background service worker / popup
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ARKN_NER_RESPONSE') {
      window.dispatchEvent(new CustomEvent('arkn:ner-response', {
        detail: message,
      }));
    }
    if (message.type === 'ARKN_ENABLED_CHANGED') {
      arknEnabled = message.enabled;
      dispatchEnabledStatus();
    }
    if (message.type === 'ARKN_POLICY_SYNCED') {
      policyConfig = message.policy;
      dispatchPolicy();
    }
  });

  // ── Token sync from MAIN world ───────────────────────────────────────────────

  window.addEventListener('arkn:tokens-sync', (e) => {
    const { sessionId, entries } = e.detail;

    if (!window.__ARKN__.tokenStore[sessionId]) {
      window.__ARKN__.tokenStore[sessionId] = {};
    }

    for (const [token, original] of entries) {
      window.__ARKN__.tokenStore[sessionId][token] = original;
    }

    // Persist updated store
    persistTokens();

    // Notify UI scripts
    window.dispatchEvent(new CustomEvent('arkn:tokens-ready', {
      detail: { sessionId },
    }));
  });

  // ── Session migration (SPA navigation) ───────────────────────────────────────
  // Mirrors the MAIN world's session migration into the isolated world's store.
  // Triggered when Claude navigates from /new → /chat/{uuid} after a new chat is
  // created, ensuring each conversation keeps its own isolated token bucket.

  window.addEventListener('arkn:session-migrated', (e) => {
    const { from, to, entries } = e.detail;
    const store = window.__ARKN__.tokenStore;

    // Create the specific session if it doesn't exist
    if (!store[to]) store[to] = {};

    // Copy tokens — never overwrite values already in the specific session
    for (const [token, original] of entries) {
      if (!store[to][token]) {
        store[to][token] = original;
      }
    }

    // Remove the global bucket so the next new chat starts clean
    delete store[from];

    // Persist the updated (migrated) store
    persistTokens();

    // Trigger a DOM rescan so any in-flight [TOKEN] placeholders resolve correctly
    window.dispatchEvent(new CustomEvent('arkn:tokens-ready', {
      detail: { sessionId: to },
    }));

    console.log('[ARKN] 🔀 Session migrated (isolated world):', from, '→', to);
  });


  // ── Audit bridge ─────────────────────────────────────────────────────────────

  window.addEventListener('arkn:redacted', (e) => {
    const { sessionId, summary, timestamp, platform } = e.detail;

    const total = Object.values(summary).reduce((s, n) => s + n, 0);
    window.__ARKN__.totalToday += total;
    window.__ARKN__.lastSummary = summary;

    console.log('[ARKN] 📤 Redacted event received in isolated context. Forwarding audit log to service worker...', {
      platform,
      sessionId,
      summary,
      contextValid: isContextValid()
    });

    // Zero-PII audit entry — only send if chrome context is still live
    if (isContextValid()) {
      chrome.runtime.sendMessage({
        type: 'ARKN_AUDIT',
        payload: { ts: timestamp, engine: platform ?? 'unknown', sessionId, counts: summary },
      }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[ARKN] ❌ Audit message failed to dispatch:', chrome.runtime.lastError.message);
        } else {
          console.log('[ARKN] 📥 Service worker acknowledged audit log:', res);
        }
      });
    } else {
      console.warn('[ARKN] ⚠️ Cannot send audit log: Extension context is invalidated. Please reload the tab.');
    }

    // Notify UI (pure DOM event — safe even after context invalidation)
    window.dispatchEvent(new CustomEvent('arkn:protected', {
      detail: { sessionId, summary, timestamp },
    }));
  });


  console.log('[ARKN] Content bridge active ✓');
})();
