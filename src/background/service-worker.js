/**
 * ARKN — Service Worker (Background)
 * Receives zero-PII audit events and persists them to chrome.storage.local & Supabase.
 * Handles SSO session synchronization from dashboard.
 */

// Import static configurations and the bundled NER worker.
importScripts('../config.js', './ner-worker.bundle.js');

const SCHEMA_VERSION  = 2;
const LOG_KEY         = 'arknLog';
const ENABLED_KEY     = 'arknEnabled';
const SCHEMA_KEY      = 'arknSchemaVersion';
const TOKEN_KEY       = 'arknTokenStore';
const SESSION_KEY     = 'arknSessionStore';
const THIRTY_DAYS_MS  = 30 * 24 * 60 * 60 * 1000;

// ── Supabase REST client helper ───────────────────────────────────────────────

async function supabaseFetch(path, options = {}) {
  const url = `${globalThis.ARKN_CONFIG.SUPABASE_URL}${path}`;
  const headers = {
    'apikey': globalThis.ARKN_CONFIG.SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP error ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Install / Update lifecycle ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({ [SCHEMA_KEY]: SCHEMA_VERSION });
    console.log('[ARKN] Fresh install — schema version stamped:', SCHEMA_VERSION);
  }

  if (reason === 'update') {
    console.log('[ARKN] Extension updated from', previousVersion, '— running storage migration...');
    await migrateStorage();
    console.log('[ARKN] Storage migration complete. Schema version:', SCHEMA_VERSION);
  }

  // Warm the NER model without blocking extension startup.
  globalThis.__ARKN_NER_WARMUP__?.().catch(() => {});

  // Immediately send heartbeat after install/reload to mark device online
  sendHeartbeat().catch(() => {});
});

async function migrateStorage() {
  const res = await chrome.storage.local.get([SCHEMA_KEY, TOKEN_KEY]);
  const storedVersion = res[SCHEMA_KEY] ?? 1;

  if (storedVersion < 2) {
    const existingTokens = res[TOKEN_KEY];
    if (existingTokens) {
      await chrome.storage.local.set({
        [TOKEN_KEY]: { ...existingTokens, schemaVersion: 2 },
        [SCHEMA_KEY]: 2,
      });
      console.log('[ARKN] Migration v1→v2: token store preserved');
    } else {
      await chrome.storage.local.set({ [SCHEMA_KEY]: 2 });
    }
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ARKN_AUDIT') {
    handleAuditLog(message.payload).then(
      () => sendResponse({ ok: true }),
      (err) => {
        console.error('[ARKN] Audit sync error:', err);
        sendResponse({ ok: false, error: err.message });
      }
    );
    return true;
  }

  if (message.type === 'ARKN_GET_STATS') {
    getStats().then((stats) => sendResponse(stats));
    return true;
  }

  if (message.type === 'ARKN_GET_ENABLED') {
    chrome.storage.local.get(ENABLED_KEY, (res) =>
      sendResponse({ enabled: res[ENABLED_KEY] !== false })
    );
    return true;
  }

  if (message.type === 'ARKN_SET_ENABLED') {
    chrome.storage.local.set({ [ENABLED_KEY]: message.enabled }, () =>
      sendResponse({ ok: true })
    );
    return true;
  }

  if (message.type === 'ARKN_POLICY_SYNC_REQUEST') {
    sendHeartbeat()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── SSO Auth Handshake ──────────────────────────────────────────────────────

  if (message.type === 'ARKN_SESSION_SYNC') {
    syncSession(message.payload).then(
      (res) => sendResponse({ ok: true, session: res }),
      (err) => {
        console.error('[ARKN] SSO sync error:', err);
        sendResponse({ ok: false, error: err.message });
      }
    );
    return true;
  }

  if (message.type === 'ARKN_SESSION_CLEAR' || message.type === 'ARKN_LOG_OUT') {
    chrome.storage.local.remove(SESSION_KEY, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Debug: Dump session state to console ──────────────────────────────────
  if (message.type === 'ARKN_DEBUG_SESSION') {
    chrome.storage.local.get(SESSION_KEY, (res) => {
      const session = res[SESSION_KEY];
      if (session) {
        const safeSession = {
          ...session,
          accessToken: session.accessToken ? session.accessToken.substring(0, 20) + '...' : null,
          refreshToken: session.refreshToken ? '[present]' : '[missing]',
        };
        console.log('[ARKN] 🔍 DEBUG SESSION DUMP:', JSON.stringify(safeSession, null, 2));
        sendResponse({ ok: true, session: safeSession });
      } else {
        console.warn('[ARKN] 🔍 DEBUG: No session stored.');
        sendResponse({ ok: false, error: 'No session stored' });
      }
    });
    return true;
  }

  // ── Token store export/import ───────────────────────────────────────────────

  if (message.type === 'ARKN_EXPORT_TOKENS') {
    chrome.storage.local.get(TOKEN_KEY, (res) => {
      sendResponse({ tokens: res[TOKEN_KEY] ?? null });
    });
    return true;
  }

  if (message.type === 'ARKN_IMPORT_TOKENS') {
    chrome.storage.local.get(TOKEN_KEY, (res) => {
      const existing = res[TOKEN_KEY] ?? { savedAt: Date.now(), sessions: {}, schemaVersion: SCHEMA_VERSION };
      const imported = message.tokens ?? {};
      const mergedSessions = {
        ...(imported.sessions ?? {}),
        ...existing.sessions,
      };
      const merged = {
        ...existing,
        sessions: mergedSessions,
        savedAt: Date.now(),
        schemaVersion: SCHEMA_VERSION,
      };
      chrome.storage.local.set({ [TOKEN_KEY]: merged }, () => {
        sendResponse({ ok: true, sessionCount: Object.keys(mergedSessions).length });
      });
    });
    return true;
  }

  if (message.type === 'SAVE_TOKENS') {
    chrome.storage.session.set({ [TOKEN_KEY]: message.tokens }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'GET_TOKENS') {
    chrome.storage.session.get(TOKEN_KEY, (res) => {
      sendResponse({ tokens: res?.[TOKEN_KEY] ?? null });
    });
    return true;
  }
});

// ── Session Sync Handshake runner ─────────────────────────────────────────────

async function syncSession(payload) {
  let { accessToken, refreshToken, user } = payload;

  // Proactively check if token is expired or close to expiring (less than 5 mins left)
  let needRefresh = false;
  try {
    const parts = accessToken.split('.');
    if (parts.length === 3) {
      const jwtPayload = JSON.parse(atob(parts[1]));
      const exp = jwtPayload.exp * 1000;
      if (Date.now() >= exp - 5 * 60 * 1000) {
        needRefresh = true;
      }
    }
  } catch (e) {
    needRefresh = true;
  }

  if (needRefresh && refreshToken) {
    console.log('[ARKN] Handshake token is expired or expiring soon — attempting proactive refresh...');
    const refreshed = await performDirectTokenRefresh(refreshToken);
    if (refreshed) {
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      console.log('[ARKN] Handshake token refreshed successfully.');
    }
  }

  const authHeader = { 'Authorization': `Bearer ${accessToken}` };

  // 1. Fetch organization memberships
  const memberships = await supabaseFetch(`/rest/v1/memberships?user_id=eq.${user.id}`, {
    headers: authHeader
  });

  if (!memberships || memberships.length === 0) {
    throw new Error("User does not belong to any organization on ARKN.");
  }
  const orgId = memberships[0].organization_id;
  const role = memberships[0].role;

  // 2. Fetch policies threshold configurations
  const policies = await supabaseFetch(`/rest/v1/policies?organization_id=eq.${orgId}`, {
    headers: authHeader
  });
  const policy = (policies && policies.length > 0) ? policies[0] : null;

  // 3. Register device if not already registered
  const storage = await chrome.storage.local.get(SESSION_KEY);
  let deviceId = storage[SESSION_KEY]?.deviceId;

  if (!deviceId) {
    // Determine browser & OS context details
    let osName = "Chrome OS";
    if (navigator.userAgent.includes("Mac")) osName = "macOS";
    else if (navigator.userAgent.includes("Win")) osName = "Windows";
    else if (navigator.userAgent.includes("Linux")) osName = "Linux";

    const browserName = navigator.userAgent.includes("Edg") ? "Edge" : "Chrome";

    // Check if device already exists in DB for this user/browser/OS to avoid duplicate rows on re-login
    let existingDevice = null;
    try {
      const queryUrl = `/rest/v1/devices?user_id=eq.${user.id}&browser=eq.${encodeURIComponent(browserName)}&os=eq.${encodeURIComponent(osName)}`;
      const existing = await supabaseFetch(queryUrl, {
        method: 'GET',
        headers: authHeader
      });
      if (existing && existing.length > 0) {
        existingDevice = existing[0];
      }
    } catch (checkErr) {
      console.warn('[ARKN] Failed to verify existing device:', checkErr.message);
    }

    if (existingDevice) {
      deviceId = existingDevice.id;
      // Patch last_seen_at to mark device online
      try {
        await supabaseFetch(`/rest/v1/devices?id=eq.${deviceId}`, {
          method: 'PATCH',
          headers: authHeader,
          body: JSON.stringify({
            last_seen_at: new Date().toISOString(),
            extension_version: "0.2.0"
          })
        });
      } catch (patchErr) {
        console.warn('[ARKN] Failed to update device activity:', patchErr.message);
      }
    } else {
      const devices = await supabaseFetch('/rest/v1/devices', {
        method: 'POST',
        headers: {
          ...authHeader,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          user_id: user.id,
          organization_id: orgId,
          device_name: `${user.user_metadata?.full_name || 'Team member'}'s ${osName}`,
          browser: browserName,
          os: osName,
          extension_version: "0.2.0"
        })
      });

      if (devices && devices.length > 0) {
        deviceId = devices[0].id;
      }
    }
  }

  const sessionObj = {
    accessToken,
    refreshToken,
    userId: user.id,
    email: user.email,
    orgId,
    role,
    deviceId,
    policy: policy ? {
      confidenceThreshold: policy.confidence_threshold,
      enabledTypes: policy.enabled_types
    } : null,
    syncedAt: Date.now()
  };

  await chrome.storage.local.set({ [SESSION_KEY]: sessionObj });
  console.log('[ARKN] Session storage synced successfully:', user.email);

  // Sync state to active content scripts if any
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { type: 'ARKN_POLICY_SYNCED', policy: sessionObj.policy }).catch(() => {});
    });
  });

  return sessionObj;
}

// ── Audit Log Handlers (Local & Supabase Sync) ─────────────────────────────────

async function handleAuditLog(entry) {
  // 1. Append to local log history
  await new Promise((resolve) => {
    chrome.storage.local.get(LOG_KEY, (res) => {
      const cutoff = Date.now() - THIRTY_DAYS_MS;
      const log = (res[LOG_KEY] ?? []).filter((e) => e.ts > cutoff);

      log.push({
        ts: entry.ts,
        engine: entry.engine,
        sessionId: entry.sessionId,
        counts: entry.counts ?? {},
      });

      chrome.storage.local.set({ [LOG_KEY]: log }, resolve);
    });
  });

  // 2. Sync to Supabase in background
  try {
    const session = await getValidSession();
    
    if (session && session.accessToken && session.deviceId && session.orgId) {
      const authHeader = {
        'Authorization': `Bearer ${session.accessToken}`,
        'Prefer': 'return=representation'
      };
      console.log('[ARKN] Syncing telemetry — deviceId:', session.deviceId, 'orgId:', session.orgId, 'platform:', entry.engine);
      const result = await supabaseFetch('/rest/v1/telemetry', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          device_id: session.deviceId,
          organization_id: session.orgId,
          platform: entry.engine.toLowerCase(),
          pii_counts: entry.counts,
          event_at: new Date(entry.ts).toISOString()
        })
      });
      if (result && Array.isArray(result) && result.length > 0) {
        console.log('[ARKN] ✅ Telemetry synced to Supabase. Row ID:', result[0].id);
      } else {
        console.warn('[ARKN] ⚠️ Telemetry POST returned empty — RLS may have blocked the insert.');
      }
      // Keep device last_seen_at online during activity
      sendHeartbeat().catch(() => {});
    } else {
      console.warn('[ARKN] Telemetry sync skipped — missing session data. accessToken:', !!session?.accessToken, 'deviceId:', session?.deviceId, 'orgId:', session?.orgId);
    }
  } catch (err) {
    console.warn('[ARKN] Supabase telemetry sync failed:', err.message);
  }
}

// ── Token Refresh ──────────────────────────────────────────────────────────────

/**
 * Perform a direct POST request to Supabase GoTrue to refresh the session tokens.
 */
async function performDirectTokenRefresh(rToken) {
  try {
    const res = await fetch(`${globalThis.ARKN_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'apikey': globalThis.ARKN_CONFIG.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: rToken }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[ARKN] Direct token refresh failed:', res.status, errText);
      return null;
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token
    };
  } catch (err) {
    console.warn('[ARKN] Direct token refresh error:', err.message);
    return null;
  }
}

/**
 * Refresh the Supabase access token using the stored refresh token.
 * Updates chrome.storage.local with the new credentials.
 * Returns the updated session object, or null on failure.
 */
async function refreshAccessToken() {
  const storage = await chrome.storage.local.get(SESSION_KEY);
  const session = storage[SESSION_KEY];
  if (!session || !session.refreshToken) {
    console.warn('[ARKN] No refresh token available — cannot refresh session.');
    return null;
  }

  const tokens = await performDirectTokenRefresh(session.refreshToken);
  if (!tokens) return null;

  const updatedSession = {
    ...session,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    syncedAt: Date.now(),
  };

  await chrome.storage.local.set({ [SESSION_KEY]: updatedSession });
  console.log('[ARKN] ♻️ Access token refreshed successfully.');
  return updatedSession;
}

/**
 * Get a valid session — refreshes the token if it's older than 50 minutes.
 */
async function getValidSession() {
  const storage = await chrome.storage.local.get(SESSION_KEY);
  const session = storage[SESSION_KEY];
  if (!session) return null;

  // Proactively refresh if the session was synced more than 50 minutes ago
  const TOKEN_LIFETIME_MS = 50 * 60 * 1000; // 50 minutes (tokens expire at 60)
  const age = Date.now() - (session.syncedAt || 0);

  if (age > TOKEN_LIFETIME_MS) {
    console.log('[ARKN] Session token is stale (' + Math.round(age / 60000) + 'm old) — refreshing...');
    const refreshed = await refreshAccessToken();
    return refreshed || session; // Fall back to existing if refresh fails
  }

  return session;
}

// ── Stats Aggregations ─────────────────────────────────────────────────────────

async function getStats() {
  const res = await chrome.storage.local.get([LOG_KEY, ENABLED_KEY, SESSION_KEY]);
  const log = res[LOG_KEY] ?? [];
  const enabled = res[ENABLED_KEY] !== false;
  const session = res[SESSION_KEY] ?? null;

  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;

  // Trigger heartbeat update in the background when checking statistics (popup open)
  sendHeartbeat().catch(() => {});

  function aggregate(entries) {
    const totals = { EMAIL: 0, PHONE: 0, POSTCODE: 0, NINO: 0, total: 0 };
    for (const e of entries) {
      for (const [type, count] of Object.entries(e.counts ?? {})) {
        totals[type] = (totals[type] ?? 0) + count;
        totals.total += count;
      }
    }
    return totals;
  }

  return {
    enabled,
    session,
    today:   aggregate(log.filter((e) => e.ts >= todayStart)),
    week:    aggregate(log.filter((e) => e.ts >= weekStart)),
    allTime: aggregate(log),
    logLength: log.length,
  };
}

// ── Heartbeat Sync ─────────────────────────────────────────────────────────────

async function sendHeartbeat() {
  try {
    const session = await getValidSession();
    if (!session) {
      console.warn('[ARKN] Heartbeat skipped — no session stored.');
      return;
    }
    if (!session.deviceId) {
      console.warn('[ARKN] Heartbeat skipped — no deviceId in session. Re-sync from dashboard required.');
      return;
    }
    if (!session.accessToken) {
      console.warn('[ARKN] Heartbeat skipped — no accessToken in session.');
      return;
    }

    // Decode JWT to check auth.uid() vs session.userId
    try {
      const parts = session.accessToken.split('.');
      const jwtPayload = JSON.parse(atob(parts[1]));
      console.log('[ARKN] 🔍 JWT sub (auth.uid):', jwtPayload.sub, '| session.userId:', session.userId, '| match:', jwtPayload.sub === session.userId);
    } catch (jwtErr) {
      console.warn('[ARKN] Could not decode JWT:', jwtErr.message);
    }

    // Check device visibility via SELECT before PATCHing
    try {
      const deviceCheck = await supabaseFetch(`/rest/v1/devices?id=eq.${session.deviceId}&select=id,user_id,device_name,organization_id`, {
        headers: { 'Authorization': `Bearer ${session.accessToken}` }
      });
      console.log('[ARKN] 🔍 Device SELECT result:', JSON.stringify(deviceCheck));
    } catch (checkErr) {
      console.warn('[ARKN] Device SELECT failed:', checkErr.message);
    }

    // Fetch and sync the latest compliance policy from the database
    try {
      const policyResult = await supabaseFetch(`/rest/v1/policies?organization_id=eq.${session.orgId}&select=*`, {
        headers: { 'Authorization': `Bearer ${session.accessToken}` }
      });
      if (policyResult && policyResult.length > 0) {
        const dbPolicy = policyResult[0];
        
        // Build the policy config object
        const updatedPolicy = {
          confidenceThreshold: dbPolicy.confidence_threshold !== undefined ? Number(dbPolicy.confidence_threshold) : 0.70,
          enabledTypes: dbPolicy.enabled_types || {},
          customRules: Array.isArray(dbPolicy.custom_rules) ? dbPolicy.custom_rules : []
        };
        
        // Save the updated policy into session in local storage
        session.policy = updatedPolicy;
        session.syncedAt = Date.now(); // update sync time
        await chrome.storage.local.set({ [SESSION_KEY]: session });
        console.log('[ARKN] ✅ Background policy synced successfully:', updatedPolicy);

        // Broadcast to all active tabs
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            chrome.tabs.sendMessage(tab.id, { type: 'ARKN_POLICY_SYNCED', policy: updatedPolicy }).catch(() => {});
          });
        });
      }
    } catch (polErr) {
      console.warn('[ARKN] Background policy sync failed:', polErr.message);
    }

    console.log('[ARKN] Heartbeat attempt — deviceId:', session.deviceId, 'userId:', session.userId, 'tokenAge:', Math.round((Date.now() - (session.syncedAt || 0)) / 60000) + 'm');

    const result = await supabaseFetch(`/rest/v1/devices?id=eq.${session.deviceId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        last_seen_at: new Date().toISOString()
      })
    });

    // With Prefer: return=representation, PostgREST returns the updated rows
    if (result && Array.isArray(result) && result.length > 0) {
      console.log('[ARKN] ✅ Heartbeat synced. Device status: Online. Updated:', result[0].device_name);
    } else {
      // PATCH returned 200 but 0 rows updated — RLS blocked or wrong deviceId
      console.warn('[ARKN] ⚠️ Heartbeat PATCH returned 0 rows — device not updated!');
      console.warn('[ARKN] ⚠️ This means RLS blocked the update or deviceId does not exist in DB.');
      console.warn('[ARKN] ⚠️ deviceId:', session.deviceId, '— try re-syncing from dashboard.');
    }
  } catch (err) {
    console.warn('[ARKN] Heartbeat sync failed:', err.message);
    // Attempt token refresh and retry once
    try {
      const refreshed = await refreshAccessToken();
      if (refreshed && refreshed.accessToken && refreshed.deviceId) {
        const retryResult = await supabaseFetch(`/rest/v1/devices?id=eq.${refreshed.deviceId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${refreshed.accessToken}`,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({ last_seen_at: new Date().toISOString() })
        });

        if (retryResult && Array.isArray(retryResult) && retryResult.length > 0) {
          console.log('[ARKN] ✅ Heartbeat synced after token refresh.');
        } else {
          console.warn('[ARKN] ⚠️ Heartbeat retry returned 0 rows — device still not updated.');
        }
      }
    } catch (retryErr) {
      console.warn('[ARKN] Heartbeat retry failed after refresh:', retryErr.message);
    }
  }
}

// Schedule heartbeats to run in background every 5 minutes
chrome.alarms.create('arkn_heartbeat', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'arkn_heartbeat') {
    sendHeartbeat().catch(() => {});
  }
});

// Run heartbeat on service worker startup and on extension install/update
chrome.runtime.onStartup.addListener(() => {
  sendHeartbeat().catch(() => {});
});

