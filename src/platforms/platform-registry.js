/**
 * ARKN — Platform Registry
 *
 * Loaded in world: "MAIN" after all platform config.js files.
 * At startup, it reads window.__ARKN_PLATFORMS__ (populated by each config.js)
 * and builds a fast lookup structure.
 *
 * The interceptor calls:
 *   registry.getAdapterForUrl(url)   → { config, adapter } or null
 *
 * To add a new platform:
 *   1. Create src/platforms/<name>/config.js  — pushes to window.__ARKN_PLATFORMS__
 *   2. Create src/platforms/<name>/adapter.js — registers on window.__ARKN_ADAPTERS__
 *   3. Add the config.js + adapter.js to manifest.json (BEFORE platform-registry.js)
 *   4. Add host permissions in manifest.json
 *   That's it. Zero changes needed here or in interceptor.js.
 */

(function (global) {
  'use strict';

  // ── Build lookup from registered configs ────────────────────────────────────

  const platforms = global.__ARKN_PLATFORMS__ || [];
  const adapters  = global.__ARKN_ADAPTERS__  || {};

  // Pre-compile all intercept paths into a single fast lookup map:
  // pathSubstring → { config, adapter }
  const pathMap = new Map();

  for (const config of platforms) {
    const adapter = adapters[config.id];
    if (!adapter) {
      console.warn(`[ARKN] Platform "${config.id}" has config but no adapter — skipping`);
      continue;
    }
    for (const path of config.interceptPaths) {
      pathMap.set(path, { config, adapter });
    }
    console.log(`[ARKN] ✅ Platform registered: ${config.label} (${config.interceptPaths.length} paths)`);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  const registry = {
    /**
     * Given a full request URL, return the matching platform { config, adapter }
     * or null if no platform handles this URL.
     * @param {string} url
     * @returns {{ config: object, adapter: object }|null}
     */
    getAdapterForUrl(url) {
      for (const [path, entry] of pathMap) {
        if (url.includes(path)) return entry;
      }
      return null;
    },

    /**
     * Returns the list of all registered platform configs (for debugging/popup).
     * @returns {object[]}
     */
    getRegisteredPlatforms() {
      return platforms.map((p) => ({ id: p.id, label: p.label }));
    },
  };

  // Expose on the ARKN namespace so the interceptor can access it
  global.__ARKN_REGISTRY__ = registry;

  console.log(
    `[ARKN] Platform registry ready — ${platforms.length} platform(s):`,
    platforms.map((p) => p.label).join(', ')
  );
})(window);
