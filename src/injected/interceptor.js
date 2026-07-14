/**
 * ARKN — Network Interceptor (Generic)
 * Runs in world: "MAIN" via manifest content_scripts declaration.
 * Monkey-patches window.fetch and XMLHttpRequest.
 *
 * Depends on:
 *   window.__ARKN_REGEX__    — declared by regex-engine.js (loaded first)
 *   window.__ARKN_REGISTRY__ — declared by platform-registry.js (loaded before this)
 *
 * This file contains ZERO platform-specific logic.
 * All payload parsing is delegated to the platform adapter selected by the registry.
 */
(function (global) {
  'use strict';

  const LOG = '[ARKN]';
  let arknEnabled = true;

  // ── Enabled status sync ───────────────────────────────────────────────────────

  global.addEventListener('arkn:enabled-status', (e) => {
    arknEnabled = e.detail.enabled;
    console.log(LOG, '🔌 Protection status updated:', arknEnabled ? 'ENABLED' : 'DISABLED');
  });

  // Request initial status from isolated content script
  global.dispatchEvent(new CustomEvent('arkn:request-enabled'));
  global.addEventListener('DOMContentLoaded', () => {
    global.dispatchEvent(new CustomEvent('arkn:request-enabled'));
  });

  // ── Policy configuration sync ──────────────────────────────────────────────────

  let activePolicyConfig = null;

  global.addEventListener('arkn:policy-sync', (e) => {
    activePolicyConfig = e.detail;
    console.log(LOG, '🛡️ Compliance policy synchronized:', activePolicyConfig);
  });

  // Request initial policy from isolated content script
  global.dispatchEvent(new CustomEvent('arkn:request-policy'));
  global.addEventListener('DOMContentLoaded', () => {
    global.dispatchEvent(new CustomEvent('arkn:request-policy'));
  });

  // ── Session store (in-memory, per-page-load) ──────────────────────────────────

  global.__ARKN_SESSION_TOKENS__ = global.__ARKN_SESSION_TOKENS__ || {};

  function storeTokens(sessionId, tokenMap) {
    if (!global.__ARKN_SESSION_TOKENS__[sessionId]) {
      global.__ARKN_SESSION_TOKENS__[sessionId] = new Map();
    }
    for (const [token, original] of tokenMap.entries()) {
      global.__ARKN_SESSION_TOKENS__[sessionId].set(token, original);
    }
    global.dispatchEvent(new CustomEvent('arkn:tokens-sync', {
      detail: { sessionId, entries: Array.from(tokenMap.entries()) },
    }));
  }

  // Handle restored tokens from content.js
  global.addEventListener('arkn:tokens-restored', (e) => {
    const { sessions } = e.detail;
    if (sessions) {
      for (const [sessionId, tokens] of Object.entries(sessions)) {
        if (!global.__ARKN_SESSION_TOKENS__[sessionId]) {
          global.__ARKN_SESSION_TOKENS__[sessionId] = new Map();
        }
        for (const [token, original] of Object.entries(tokens)) {
          global.__ARKN_SESSION_TOKENS__[sessionId].set(token, original);
        }
      }
      console.log(LOG, '🔄 Restored tokens synchronized to interceptor');
    }
  });

  // Request token restore handshake
  global.dispatchEvent(new CustomEvent('arkn:request-restored-tokens'));
  global.addEventListener('DOMContentLoaded', () => {
    global.dispatchEvent(new CustomEvent('arkn:request-restored-tokens'));
  });

  // ── Body reader ───────────────────────────────────────────────────────────────
  // Request bodies may be a string, Blob, ArrayBuffer, or ReadableStream.

  async function readBody(body) {
    if (!body) return null;
    if (typeof body === 'string') return body;
    if (body instanceof Blob) return body.text();
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
    if (body instanceof ReadableStream) {
      const reader = body.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
      return new TextDecoder().decode(combined);
    }
    return null;
  }

  // ── Core redaction engine (platform-agnostic) ────────────────────────────────

  /**
   * Given a raw JSON body string and a resolved { config, adapter } from the registry,
   * runs redaction over all user message text parts.
   *
   * @param {string} rawBody
   * @param {{ config: object, adapter: object }} platform
   * @returns {{ body: string, summary: object, modified: boolean }}
   */
  function processPayload(rawBody, platform) {
    if (!arknEnabled) {
      return { body: rawBody, summary: {}, modified: false };
    }

    const engine = global.__ARKN_REGEX__;
    if (!engine) {
      console.warn(LOG, '⚠️ Regex engine not ready');
      return { body: rawBody, summary: {}, modified: false };
    }

    let parsed;
    try {
      parsed = platform.adapter.parse ? platform.adapter.parse(rawBody) : JSON.parse(rawBody);
    } catch {
      return { body: rawBody, summary: {}, modified: false };
    }
    if (!parsed) return { body: rawBody, summary: {}, modified: false };

    const sessionId = platform.config.getSessionId(global.location);
    const aggregateSummary = {};
    let modified = false;

    // Ask the platform adapter for the user message descriptors
    const userMessages = platform.adapter.extractUserMessages(parsed);

    // ── Diagnostic: log payload shape if adapter returns nothing ──────────────
    if (userMessages.length === 0) {
      console.log(LOG,
        `⚠️ [${platform.config.label}] Adapter returned 0 messages — payload preview:`,
        typeof rawBody === 'string' ? rawBody.slice(0, 200) : '(non-string)'
      );
      return { body: rawBody, summary: {}, sessionId, modified: false };
    }

    let msgIdx = 0;
    for (const msg of userMessages) {
      const isLastMessage = (msgIdx === userMessages.length - 1);
      msgIdx++;

      const textParts = msg.getText();
      const redactedParts = [];
      let msgModified = false;

      // ── Compute token offsets from existing session tokens ────────────────────
      // Subsequent messages must continue the counter (NAME_2, NAME_3…) so they
      // don't overwrite tokens stored by earlier messages in the same conversation.
      const tokenOffsets = {};
      const existing = global.__ARKN_SESSION_TOKENS__[sessionId];
      if (existing) {
        for (const [token] of existing) {
          const m = token.match(/^\{([A-Z0-9_]+)_(\d+)\}$/);
          if (m) {
            const type = m[1], num = parseInt(m[2], 10);
            tokenOffsets[type] = Math.max(tokenOffsets[type] || 0, num);
          }
        }
      }

      const allMsgTokens = [];
      for (const text of textParts) {
        const { redacted, tokens, summary } = engine.redact(text, tokenOffsets, activePolicyConfig);
        if (tokens.size > 0) {
          storeTokens(sessionId, tokens);
          msgModified = true;
          modified = true;
          for (const [k] of tokens.entries()) {
            allMsgTokens.push(k);
          }
          if (isLastMessage) {
            for (const [k, v] of Object.entries(summary)) {
              aggregateSummary[k] = (aggregateSummary[k] ?? 0) + v;
            }
          }
          redactedParts.push(redacted);
        } else {
          redactedParts.push(text);
        }
      }

      if (msgModified) {
        msg.setText(redactedParts);
      }



    }

    let finalBody = rawBody;
    if (modified) {
      finalBody = platform.adapter.serialize ? platform.adapter.serialize(parsed) : JSON.stringify(parsed);
    }

    return {
      body: finalBody,
      summary: aggregateSummary,
      sessionId,
      modified,
    };
  }


  function emitAuditEvent(sessionId, summary, platformLabel) {
    global.dispatchEvent(new CustomEvent('arkn:redacted', {
      detail: { sessionId, summary, timestamp: Date.now(), platform: platformLabel ?? 'unknown' },
    }));
  }

  // ── Fetch intercept ───────────────────────────────────────────────────────────

  const _fetch = global.fetch;

  global.fetch = async function arknFetch(input, init) {
    const isReq  = input instanceof Request;
    const url    = isReq ? input.url : (typeof input === 'string' ? input : String(input));
    const method = ((isReq ? input.method : init?.method) ?? 'GET').toUpperCase();

    if (method === 'POST') {
      const registry = global.__ARKN_REGISTRY__;
      const platform = registry?.getAdapterForUrl(url);

      if (platform) {
        let rawBody;
        if (init?.body) {
          rawBody = await readBody(init.body);
        } else if (isReq) {
          rawBody = await input.clone().text();
        }

        if (rawBody) {
          const { body, summary, sessionId, modified } = processPayload(rawBody, platform);
          if (modified) {
            emitAuditEvent(sessionId, summary, platform.config.label);
            console.log(LOG, `✅ [${platform.config.label}] Redacted:`, summary);
            const newInit = isReq
              ? { method: input.method, headers: input.headers, body }
              : { ...init, body };
            return _fetch.call(this, isReq ? input.url : input, newInit);
          } else {
            console.log(LOG, `ℹ️ [${platform.config.label}] Request intercepted — no PII found`);
          }
        }
      }
    }

    return _fetch.apply(this, arguments);
  };

  // ── XHR intercept ─────────────────────────────────────────────────────────────

  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__arknUrl    = url;
    this.__arknMethod = method?.toUpperCase();
    return _xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__arknMethod === 'POST' && body) {
      const registry = global.__ARKN_REGISTRY__;
      const platform = registry?.getAdapterForUrl(this.__arknUrl ?? '');

      if (platform) {
        const rawBody = typeof body === 'string' ? body : null;
        if (rawBody) {
          const { body: redactedBody, summary, sessionId, modified } = processPayload(rawBody, platform);
          if (modified) {
            emitAuditEvent(sessionId, summary, platform.config.label);
            console.log(LOG, `✅ [${platform.config.label}] XHR redacted:`, summary);
            return _xhrSend.call(this, redactedBody);
          }
        }
      }
    }
    return _xhrSend.call(this, body);
  };

  // ── SPA navigation detector (session migration) ──────────────────────────────
  // When Claude creates a new conversation it navigates from /new → /chat/{uuid}
  // via history.pushState without a page reload.
  // The interceptor stored tokens under 'claude_global' (the session ID for /new).
  // Here we detect the navigation and migrate those tokens to 'claude_{uuid}' so
  // that every conversation has its own isolated token bucket.

  function onSPANavigation() {
    const sessionStore = global.__ARKN_SESSION_TOKENS__;
    if (!sessionStore) return;

    const path = global.location.pathname;

    // Helper to migrate tokens from global bucket to new specific session ID
    function migrateSession(globalKey, newSessionId) {
      const globalStore = sessionStore[globalKey];
      if (globalStore?.size > 0) {
        if (!sessionStore[newSessionId]) {
          sessionStore[newSessionId] = new Map();
        }
        for (const [token, original] of globalStore.entries()) {
          if (!sessionStore[newSessionId].has(token)) {
            sessionStore[newSessionId].set(token, original);
          }
        }
        global.dispatchEvent(new CustomEvent('arkn:session-migrated', {
          detail: {
            from: globalKey,
            to: newSessionId,
            entries: Array.from(globalStore.entries()),
          },
        }));
        globalStore.clear();
        console.log(LOG, `🔀 Session migrated: ${globalKey} → ${newSessionId}`);
      }
    }

    // Claude: /new → /chat/{uuid}
    const claudeMatch = path.match(/\/chat\/([a-f0-9-]{36})/i);
    if (claudeMatch) {
      migrateSession('claude_global', `claude_${claudeMatch[1]}`);
    }

    // Gemini: /app → /app/{id}
    const geminiMatch = path.match(/\/app\/([a-f0-9]+)/i);
    if (geminiMatch) {
      migrateSession('gemini_global', `gemini_${geminiMatch[1]}`);
    }
  }


  // Patch history.pushState and history.replaceState
  const _pushState    = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    const result = _pushState(...args);
    onSPANavigation();
    return result;
  };

  history.replaceState = function (...args) {
    const result = _replaceState(...args);
    onSPANavigation();
    return result;
  };

  // Handle browser back/forward navigation
  global.addEventListener('popstate', onSPANavigation);

  console.log(LOG, '🛡️ Interceptor active (MAIN world) ✓');
})(window);
