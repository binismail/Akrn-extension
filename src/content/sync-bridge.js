/**
 * ARKN — Dashboard Sync (Isolated Context - Content Script)
 * Runs in the isolated world. Listens to window messages from the page context,
 * forwards session tokens to the service worker, and relays the result back to the page.
 */
(function () {
  'use strict';

  window.addEventListener('message', (event) => {
    // Only accept messages from our same window page context
    if (event.source !== window) return;

    if (event.data && event.data.type === 'ARKN_PAGE_SESSION') {
      try {
        // Prevent extension context invalidated crashes on extension reload
        if (!chrome.runtime || !chrome.runtime.id) {
          console.warn('[ARKN] ℹ️ Extension reloaded. Please refresh this tab to reconnect.');
          return;
        }

        const session = JSON.parse(event.data.raw);
        if (session && session.access_token) {
          try {
            chrome.runtime.sendMessage({
              type: 'ARKN_SESSION_SYNC',
              payload: {
                accessToken: session.access_token,
                refreshToken: session.refresh_token,
                user: session.user
              }
            }, (res) => {
              if (chrome.runtime.lastError) {
                const msg = chrome.runtime.lastError.message;
                if (msg && msg.includes("context invalidated")) {
                  console.warn('[ARKN] ℹ️ Extension context was invalidated. Refresh the page to sync session.');
                } else {
                  window.postMessage({
                    type: 'ARKN_PAGE_SYNC_RESULT',
                    ok: false,
                    error: `Service worker unreachable: ${msg}`
                  }, '*');
                }
              } else {
                window.postMessage({
                  type: 'ARKN_PAGE_SYNC_RESULT',
                  ok: res.ok,
                  error: res.error
                }, '*');
              }
            });
          } catch (sendErr) {
            const errMsg = sendErr.message || '';
            if (errMsg.includes("context invalidated")) {
              console.warn('[ARKN] ℹ️ Extension context was invalidated. Refresh the page to sync session.');
            } else {
              console.error('[ARKN] Failed to transmit token:', sendErr);
            }
          }
        }
      } catch (err) {
        // Prevent crash on invalid format
        if (chrome.runtime && chrome.runtime.id) {
          window.postMessage({
            type: 'ARKN_PAGE_SYNC_RESULT',
            ok: false,
            error: `Malformed local storage payload: ${err.message}`
          }, '*');
        }
      }
    }

    if (event.data && event.data.type === 'ARKN_POLICY_UPDATED_SYNC') {
      try {
        if (chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({ type: 'ARKN_POLICY_SYNC_REQUEST' }).catch(() => {});
        }
      } catch (err) {
        // Suppress extension reload errors
      }
    }

    if (event.data && event.data.type === 'ARKN_PAGE_SESSION_CLEAR') {
      try {
        if (chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({ type: 'ARKN_SESSION_CLEAR' }).catch(() => {});
        }
      } catch (clearErr) {
        // Suppress extension reload errors
      }
    }
  });
})();
