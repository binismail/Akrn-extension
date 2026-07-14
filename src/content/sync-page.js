/**
 * ARKN — Dashboard Sync (Page Context - MAIN World)
 * Runs in the page context. Reads Supabase auth tokens, posts them to the bridge,
 * and prints detailed transaction diagnostic logs to the browser console.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'sb-umzeixsgchlddlbxhmqi-auth-token';
  let lastRaw = '';
  let syncStatusLogged = false;

  console.log('[ARKN] 🛡️ Dashboard sync agent initialized. Monitoring local session...');
  
  // Diagnostic dump of all local storage keys and cookies
  try {
    console.log('[ARKN] 📁 LocalStorage keys:', Object.keys(localStorage));
    console.log('[ARKN] 🍪 Cookies available:', document.cookie ? 'Present (length: ' + document.cookie.length + ')' : 'None');
    if (document.cookie) {
      console.log('[ARKN] 🍪 Cookies raw values:', document.cookie.split(';').map(c => c.trim().split('=')[0]));
    }
  } catch (diagErr) {
    console.warn('[ARKN] Diagnostics failed:', diagErr.message);
  }

  function checkSession() {
    try {
      // 1. Try to read from LocalStorage
      let raw = localStorage.getItem(STORAGE_KEY);

      // 2. Fallback: Try to read from cookies if not in LocalStorage
      if (!raw && document.cookie) {
        const match = document.cookie.match(new RegExp('(^| )' + STORAGE_KEY + '=([^;]+)'));
        if (match) {
          raw = decodeURIComponent(match[2]);
        }
      }

      // Supabase SSR base64 prefixed cookie decoder
      let decodedRaw = raw;
      if (raw && raw.startsWith('base64-')) {
        try {
          decodedRaw = atob(raw.substring(7));
        } catch (decErr) {
          console.warn('[ARKN] Failed to decode base64 session token:', decErr.message);
        }
      }

      if (decodedRaw === lastRaw) return;
      lastRaw = decodedRaw;
      syncStatusLogged = false; // Reset status log on session change

      if (decodedRaw) {
        window.postMessage({ type: 'ARKN_PAGE_SESSION', raw: decodedRaw }, '*');
      } else {
        console.log('[ARKN] ℹ️ No active dashboard session detected in local storage or cookies.');
        window.postMessage({ type: 'ARKN_PAGE_SESSION_CLEAR' }, '*');
      }
    } catch (err) {
      console.warn('[ARKN] ⚠️ Failed to query storage:', err.message);
    }
  }

  function showSuccessToast() {
    try {
      const existing = document.getElementById('arkn-success-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.id = 'arkn-success-toast';
      toast.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        background-color: #1A5C38;
        color: white;
        padding: 12px 18px;
        border-radius: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        z-index: 999999;
        opacity: 0;
        transform: translateY(-10px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      toast.innerHTML = `
        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="width:16px;height:16px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <span>ARKN Security extension connected successfully.</span>
      `;
      document.body.appendChild(toast);

      // Animate in
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });

      // Fade out and remove
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 250);
      }, 4500);
    } catch (e) {
      // Fail silently if DOM access is not fully ready
    }
  }

  // Listen for sync response status from the bridge content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data && event.data.type === 'ARKN_PAGE_SYNC_RESULT') {
      if (syncStatusLogged) return; // Prevent log spamming
      syncStatusLogged = true;

      const { ok, error } = event.data;
      if (ok) {
        console.log('[ARKN] 🔄 Extension authenticated successfully via SSO handshake.');
        showSuccessToast();
      } else {
        console.error('[ARKN] ❌ SSO handshake failed:', error);
      }
    }
  });

  // Poll for token updates in page context
  setInterval(checkSession, 1500);
  checkSession();
})();
