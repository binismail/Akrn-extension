/**
 * ARKN — Response Unmasker (document_idle content script)
 *
 * Watches AI platform response panels via MutationObserver.
 * When tokens like {EMAIL_1} or {NAME_1} appear in AI responses,
 * replaces them with the original values from the local token store.
 * Also hooks into the calm note badge injector for user messages.
 *
 * Two unmask strategies:
 *  1. Text-node level: Fast, catches tokens in individual text nodes.
 *  2. Element-level: Catches tokens split across sibling text nodes
 *     (Claude's streaming renderer sometimes splits "{NAME" + "_1}").
 */
(function () {
  'use strict';

  // Matches any custom or standard token e.g. {EMAIL_1}, {NON_ME_1}, etc.
  const TOKEN_RE = /\{[A-Z0-9_]+_\d+\}/g;

  // Initialize namespace if not present
  window.__ARKN__ = window.__ARKN__ || {};

  // ── Platform detection ─────────────────────────────────────────────────────

  function getCurrentPlatform() {
    const host = window.location.hostname;
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('chatgpt.com') || host.includes('openai.com')) return 'chatgpt';
    if (host.includes('gemini.google.com')) return 'gemini';
    return null;
  }

  // ── Token resolution helper ──────────────────────────────────────────────────

  function resolveToken(token, sessionId) {
    const store = window.__ARKN__?.tokenStore ?? {};

    // 1. Exact session match — fastest and most precise
    if (sessionId && store[sessionId]?.[token]) return store[sessionId][token];

    // 2. Platform-scoped fallback:
    //    Scope the search to sessions that belong to the current platform.
    //    This prevents ChatGPT sessions from polluting Claude token lookups
    //    (e.g. {NAME_1} = 'Khalid Ismail' from ChatGPT overwriting 'Khalid' from Claude).
    //    Also handles URL change: claude.ai/new → /chat/{uuid} (session key mismatch).
    const platform = getCurrentPlatform();

    const matchingKeys = Object.keys(store).filter(key => {
      if (platform === 'claude')   return key.startsWith('claude_');
      if (platform === 'chatgpt')  return !key.startsWith('claude_') && !key.startsWith('gemini_');
      if (platform === 'gemini')   return key.startsWith('gemini_');
      return true; // unknown platform — search all
    });

    // Reverse order = newest session first within the same platform
    for (let i = matchingKeys.length - 1; i >= 0; i--) {
      if (store[matchingKeys[i]]?.[token]) return store[matchingKeys[i]][token];
    }

    return null;
  }

  function getCurrentSessionId() {
    const host = window.location.hostname;
    const loc = window.location.pathname;

    // ChatGPT: /c/{uuid} → uuid, otherwise 'global'
    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      const chatgptMatch = loc.match(/\/c\/([a-f0-9-]{36})/i);
      return chatgptMatch ? chatgptMatch[1] : 'global';
    }

    // Claude: /chat/{uuid} → claude_{uuid}, otherwise 'claude_global'
    if (host.includes('claude.ai')) {
      const claudeMatch = loc.match(/\/chat\/([a-f0-9-]{36})/i);
      return claudeMatch ? `claude_${claudeMatch[1]}` : 'claude_global';
    }

    // Gemini: /app/{id} → gemini_{id}, otherwise 'gemini_global'
    if (host.includes('gemini.google.com')) {
      const geminiMatch = loc.match(/\/app\/([a-f0-9]+)/i);
      return geminiMatch ? `gemini_${geminiMatch[1]}` : 'gemini_global';
    }

    return null;
  }


  // ── Text node scanner (Strategy 1) ──────────────────────────────────────────

  function unmaskNode(node) {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent;
    if (!text || !TOKEN_RE.test(text)) return;

    TOKEN_RE.lastIndex = 0;
    const sessionId = getCurrentSessionId();
    const resolvedTokens = [];

    const newText = text.replace(TOKEN_RE, (token) => {
      const original = resolveToken(token, sessionId);
      if (original) {
        resolvedTokens.push(token);
        return original;
      }
      return token; // keep token visible if not resolved yet
    });

    if (newText !== text) {
      node.textContent = newText;
      notifyCalmNote(node, resolvedTokens);
    }
  }

  // ── Element-level scanner (Strategy 2) ──────────────────────────────────────
  // Handles tokens split across multiple text nodes (e.g. "{NAME" + "_1}")
  // by checking the combined textContent of parent elements.

  function unmaskElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    const text = el.textContent;
    if (!text || !TOKEN_RE.test(text)) return;

    TOKEN_RE.lastIndex = 0;
    const sessionId = getCurrentSessionId();
    let anyReplaced = false;

    // Walk through the element's innerHTML to find and replace tokens
    // Process leaf-level elements to avoid corrupting complex DOM structures
    const leafElements = el.querySelectorAll('p, span, li, td, th, h1, h2, h3, h4, h5, h6, code, pre, a, strong, em, div');
    const targets = leafElements.length > 0 ? leafElements : [el];

    for (const target of targets) {
      const targetText = target.textContent;
      if (!targetText || !TOKEN_RE.test(targetText)) continue;
      TOKEN_RE.lastIndex = 0;

      const tokens = targetText.match(TOKEN_RE);
      if (!tokens) continue;

      let modified = false;

      // Method A: If element has multiple child nodes, token might be split across them.
      // Try innerHTML replacement with flexible regex that allows HTML tags between chars.
      if (target.childNodes.length > 1) {
        let html = target.innerHTML;
        for (const token of tokens) {
          const original = resolveToken(token, sessionId);
          if (original) {
            const flexRe = new RegExp(
              token.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:<[^>]*>)*'),
              'g'
            );
            const newHtml = html.replace(flexRe, original);
            if (newHtml !== html) {
              html = newHtml;
              modified = true;
              anyReplaced = true;
            }
          }
        }
        if (modified) {
          target.innerHTML = html;
          continue;
        }
      }

      // Method B: Direct textContent replacement (single text node or innerHTML didn't catch it).
      // This handles Claude's case where {NAME_1} is in a single text node that Strategy 1
      // missed due to timing (token store wasn't synced when MutationObserver first fired).
      let newText = targetText;
      for (const token of tokens) {
        const original = resolveToken(token, sessionId);
        if (original) {
          newText = newText.split(token).join(original);
          anyReplaced = true;
        }
      }
      if (newText !== targetText) {
        // Only use textContent replacement if the element has no complex children
        // (avoid destroying nested elements)
        if (target.childNodes.length <= 1) {
          target.textContent = newText;
        } else {
          // Walk text nodes manually and replace
          const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null);
          let textNode;
          while ((textNode = walker.nextNode())) {
            if (TOKEN_RE.test(textNode.textContent)) {
              TOKEN_RE.lastIndex = 0;
              let nodeText = textNode.textContent;
              const nodeTokens = nodeText.match(TOKEN_RE);
              if (nodeTokens) {
                for (const token of nodeTokens) {
                  const original = resolveToken(token, sessionId);
                  if (original) {
                    nodeText = nodeText.split(token).join(original);
                  }
                }
                textNode.textContent = nodeText;
              }
            }
          }
        }
      }
    }

    return anyReplaced;
  }

  // ── Calm note notification helper ──────────────────────────────────────────

  function notifyCalmNote(node, resolvedTokens) {
    if (!resolvedTokens || resolvedTokens.length === 0) return;

    // Locate closest user message container across ChatGPT, Claude, and Gemini
    const selectors = [
      '[data-message-author-role="user"]',
      '[data-testid="user-message"]',
      '.font-user-message',
      '[class*="user-message"]',
      'user-query-container',
      '.user-query-container',
      '.user-query',
    ];
    let userMsgEl = null;
    if (node.parentElement) {
      for (const sel of selectors) {
        userMsgEl = node.parentElement.closest(sel);
        if (userMsgEl) break;
      }
    }

    if (userMsgEl) {
      // If the interceptor has already injected/confirmed the final summary, do not overwrite it.
      if (userMsgEl.__arkn_summary_final) return;

      let parentEl = userMsgEl;
      if (userMsgEl.getAttribute && userMsgEl.getAttribute('data-testid') === 'user-message' && userMsgEl.parentElement) {
        parentEl = userMsgEl.parentElement;
      }
      if (parentEl.__arkn_summary_final) return;

      if (!userMsgEl.__arkn_summary) {
        userMsgEl.__arkn_summary = {};
      }
      if (!userMsgEl.__arkn_unmasked_tokens) {
        userMsgEl.__arkn_unmasked_tokens = new Set();
      }

      let updated = false;
      for (const token of resolvedTokens) {
        if (userMsgEl.__arkn_unmasked_tokens.has(token)) continue;
        userMsgEl.__arkn_unmasked_tokens.add(token);

        const m = token.match(/^\{([A-Z0-9_]+)_(\d+)\}$/);
        const type = m ? m[1] : token.split('_')[0].replace(/[\[\{]/g, '');
        userMsgEl.__arkn_summary[type] = (userMsgEl.__arkn_summary[type] || 0) + 1;
        updated = true;
      }

      if (updated && window.__ARKN__?.injectCalmNoteForElement) {
        window.__ARKN__.injectCalmNoteForElement(userMsgEl, userMsgEl.__arkn_summary);
      }
    }
  }

  function unmaskSubtree(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      unmaskNode(node);
    }

    // Strategy 2: Check response containers for split tokens / missed replacements
    const responseSelectors = [
      '.markdown',                              // ChatGPT response
      '[class*="markdown"]',                    // ChatGPT variants
      '[data-testid="assistant-message"]',       // Claude
      '[class*="response-content"]',            // Claude
      '[class*="font-claude"]',                 // Claude font class
      '[class*="claude-message"]',              // Claude message class
      '[class*="assistant"]',                   // Claude/ChatGPT assistant
      '[class*="bot-message"]',                 // Generic bot message
      '[class*="ai-message"]',                  // Generic AI message
      '.model-response-text',                   // Gemini
      '[class*="response"]',                    // Gemini/generic variants
      '.message-content',                       // Generic
    ];

    for (const sel of responseSelectors) {
      try {
        const elements = root.querySelectorAll ? root.querySelectorAll(sel) : [];
        for (const el of elements) {
          unmaskElement(el);
        }
      } catch (_) { /* invalid selector */ }
    }

    // Strategy 2b: Catch-all — find ANY element whose textContent contains tokens
    // This handles unknown/changing DOM structures across platforms
    if (root.querySelectorAll) {
      try {
        const allDivs = root.querySelectorAll('div, p, span, pre, code, li');
        for (const el of allDivs) {
          if (el.textContent && TOKEN_RE.test(el.textContent)) {
            TOKEN_RE.lastIndex = 0;
            unmaskElement(el);
          }
        }
      } catch (_) {}
    }
  }

  // ── MutationObserver ─────────────────────────────────────────────────────────

  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      if (mut.type === 'childList') {
        for (const node of mut.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            unmaskSubtree(node);
          } else {
            unmaskNode(node);
          }
        }
      } else if (mut.type === 'characterData') {
        unmaskNode(mut.target);
        // Also try element-level unmask on parent (split token case)
        if (mut.target.parentElement) {
          unmaskElement(mut.target.parentElement);
        }
      }
    }
  });

  // ChatGPT renders responses inside the main content area
  function startObserving() {
    const target = document.body;
    if (!target) return;

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Unmask anything already rendered before observer started
    unmaskSubtree(document.body);
    console.log('[ARKN] Unmasker active ✓');
  }

  // Re-run unmask when new tokens arrive (in case response streamed before token sync)
  window.addEventListener('arkn:tokens-ready', () => {
    unmaskSubtree(document.body);
  });

  // ── Periodic rescan for streaming renderers (Claude/Gemini) ─────────────────
  // Claude and Gemini re-render their response DOM after streaming completes.
  // This catches tokens that appear after the MutationObserver already fired.
  let rescanCount = 0;
  const MAX_RESCANS = 15; // 15 × 2s = 30s of rescanning after page interaction
  let rescanTimer = null;

  function startRescan() {
    if (rescanTimer) return;
    rescanCount = 0;
    rescanTimer = setInterval(() => {
      rescanCount++;
      unmaskSubtree(document.body);
      if (rescanCount >= MAX_RESCANS) {
        clearInterval(rescanTimer);
        rescanTimer = null;
      }
    }, 2000);
  }

  // Start rescanning when tokens are synced (a redaction just happened)
  window.addEventListener('arkn:tokens-ready', startRescan);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving);
  } else {
    startObserving();
  }
})();

