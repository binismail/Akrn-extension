/**
 * ARKN — Calm Note Injector (document_idle content script)
 *
 * Injects a small badge beneath user message blocks confirming ARKN protection.
 * Never repeats the redacted PII — only shows type counts.
 *
 * Two injection paths:
 *  1. Event-driven (platform-agnostic): listens for `arkn:protected`,
 *     finds the last user message container via a multi-platform selector list.
 *  2. Token-replacement fallback: called by unmasker.js when it resolves
 *     a token inside a known user message element (ChatGPT-specific).
 */
(function () {
  'use strict';

  const CALM_NOTE_ID_PREFIX = 'arkn-note-';
  let noteCounter = 0;

  window.__ARKN__ = window.__ARKN__ || {};

  // ── Platform-agnostic user message selectors ────────────────────────────────
  // Tried in order — first selector with results wins.
  const USER_MSG_SELECTORS = [
    '[data-message-author-role="user"]',   // ChatGPT
    '[data-testid="user-message"]',        // Claude ✅ (confirmed)
    '.font-user-message',                  // Claude CSS class
    '[class*="user-message"]',             // Claude fuzzy user message
    '[class*="UserMessage"]',              // Claude React component class
    '[data-is-human-turn="true"]',         // Claude (data attr)
    '[data-is-human-turn]',                // Claude (any value)
    '[data-testid="human-turn"]',          // Claude (testid)
    '.human-turn',                         // Claude (class)
    '[class*="HumanTurn"]',               // Claude (React component)
    '[class*="human"][class*="turn"]',     // Claude (fuzzy compound)
    // ── Gemini selectors ─────────────────────────────────────────────────────
    '.query-text',                         // Gemini query text container
    '[class*="query-text"]',               // Gemini query text fuzzy
    '[class*="query-content"]',            // Gemini query content
    '.user-query-text',                    // Gemini user query text
    '[class*="QueryText"]',                // Gemini Angular component
    '[class*="prompt-text"]',              // Gemini prompt text
    'message-content[class*="user"]',      // Gemini user message content
    '.conversation-turn [class*="query"]', // Gemini within turn container
    '[data-message-id] [class*="query"]',  // Gemini message with query child
    '.request-content',                    // Gemini request content area
    '[class*="request-text"]',             // Gemini request text
  ];

  function findAllUserMessages() {
    for (const selector of USER_MSG_SELECTORS) {
      try {
        const matches = [...document.querySelectorAll(selector)];
        if (matches.length > 0) return matches;
      } catch (_) { /* invalid selector — skip */ }
    }

    const candidates = [...document.querySelectorAll('[class]')].filter(el => {
      const rawCls = typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '';
      const cls = rawCls.toLowerCase();
      return (cls.includes('human') || cls.includes('user')) &&
             (cls.includes('turn') || cls.includes('message') || cls.includes('bubble') || cls.includes('query'));
    });
    if (candidates.length > 0) return candidates;


    return [];
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('arkn-styles')) return;
    const style = document.createElement('style');
    style.id = 'arkn-styles';
    style.textContent = `
      .arkn-calm-note {
        display: inline-flex;
        align-items: center;
        margin-top: 6px;
        margin-bottom: 4px;
        margin-left: auto;
        padding: 4px 10px;
        width: fit-content;
        max-width: fit-content;
        box-sizing: border-box;
        border-radius: 999px;
        background: rgba(16, 185, 129, 0.08);
        border: 1px solid rgba(16, 185, 129, 0.25);
        color: #10b981;
        font-size: 11.5px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-weight: 500;
        letter-spacing: 0.01em;
        line-height: 1;
        pointer-events: none;
        user-select: none;
        animation: arkn-fade-in 0.3s ease;
      }
      /* Dark theme adaptive overrides */
      body.dark .arkn-calm-note,
      html.dark .arkn-calm-note,
      [data-theme="dark"] .arkn-calm-note,
      .dark .arkn-calm-note {
        background: rgba(52, 211, 153, 0.12);
        border: 1px solid rgba(52, 211, 153, 0.3);
        color: #34d399;
      }
      .arkn-calm-note .arkn-shield {
        margin-right: 6px;
        font-size: 12px;
        line-height: 1;
      }
      @keyframes arkn-fade-in {
        from { opacity: 0; transform: translateY(3px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── Summary label builder ────────────────────────────────────────────────────

  function buildLabel(summary) {
    const labels = {
      EMAIL: ['email', 'emails'],
      PHONE: ['phone number', 'phone numbers'],
      POSTCODE: ['postcode', 'postcodes'],
      NINO: ['NI number', 'NI numbers'],
      DRIVELIC: ['driving license', 'driving licenses'],
      NHS: ['NHS number', 'NHS numbers'],
      BANK: ['bank details', 'bank details'],
      CLAIM: ['claim number', 'claim numbers'],
      NAME: ['name', 'names'],
      ORG: ['organisation', 'organisations'],
    };

    const parts = [];
    for (const [type, count] of Object.entries(summary)) {
      const cleanType = type.replace(/[\[\{]/g, '');
      const pair = labels[cleanType] || [cleanType.toLowerCase(), `${cleanType.toLowerCase()}s`];
      if (count > 0) parts.push(`${count} ${count === 1 ? pair[0] : pair[1]}`);
    }

    if (parts.length === 0) return null;
    const joined = parts.length === 1
      ? parts[0]
      : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    return `ARKN protected ${joined}`;
  }

  // ── Core injector ────────────────────────────────────────────────────────────

  function injectIntoContainer(container, summary) {
    if (!container || !summary) return;
    const label = buildLabel(summary);
    if (!label) return;

    injectStyles();
    container.__arkn_summary = summary;

    // Target parent element if container is an inner bubble (e.g. Claude's user-message)
    let target = container;
    if (container.getAttribute && container.getAttribute('data-testid') === 'user-message' && container.parentElement) {
      target = container.parentElement;
      target.__arkn_summary = summary;
    }

    let note = target.querySelector('.arkn-calm-note');
    if (!note) {
      note = document.createElement('div');
      note.id = `${CALM_NOTE_ID_PREFIX}${++noteCounter}`;
      note.className = 'arkn-calm-note';
      target.appendChild(note);
    }
    note.innerHTML = `<span class="arkn-shield">🛡️</span><span>${label}</span>`;
  }

  // ── Persistence Observer for SPAs (Gemini / ChatGPT / Claude) ────────────────

  function recheckCalmNotes() {
    const all = findAllUserMessages();
    if (all.length === 0) return;

    for (let i = 0; i < all.length; i++) {
      const msgEl = all[i];
      let target = msgEl;
      if (msgEl.getAttribute && msgEl.getAttribute('data-testid') === 'user-message' && msgEl.parentElement) {
        target = msgEl.parentElement;
      }
      const summary = msgEl.__arkn_summary || target.__arkn_summary;
      if (summary && !target.querySelector('.arkn-calm-note')) {
        injectIntoContainer(msgEl, summary);
      }
    }
  }

  window.addEventListener('arkn:protected', (e) => {
    const { summary } = e.detail ?? {};
    if (!summary || Object.keys(summary).length === 0) return;

    setTimeout(() => {
      const all = findAllUserMessages();
      if (all.length > 0) {
        const lastMsg = all[all.length - 1];
        let target = lastMsg;
        if (lastMsg.getAttribute && lastMsg.getAttribute('data-testid') === 'user-message' && lastMsg.parentElement) {
          target = lastMsg.parentElement;
        }
        lastMsg.__arkn_summary = summary;
        target.__arkn_summary = summary;
        lastMsg.__arkn_summary_final = true;
        target.__arkn_summary_final = true;
        injectIntoContainer(lastMsg, summary);
      }
    }, 300);
  });

  const observer = new MutationObserver(() => {
    recheckCalmNotes();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ── Path 2: Token-replacement fallback ───────────────────────────────────────
  window.__ARKN__.injectCalmNoteForElement = function (container, summary) {
    if (container && summary) {
      container.__arkn_summary = summary;
      injectIntoContainer(container, summary);
    }
  };


  injectStyles();
  console.log('[ARKN] Calm note engine active ✓');
})();


