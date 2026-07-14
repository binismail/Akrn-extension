/**
 * ARKN — ChatGPT Platform Config
 *
 * Describes everything the generic interceptor needs to know about ChatGPT:
 *   - Which hosts to activate on
 *   - Which API paths to intercept
 *   - How to extract the session/conversation ID from the URL
 */

const chatgptConfig = {
  id: 'chatgpt',
  label: 'ChatGPT',

  hosts: ['chatgpt.com', 'chat.openai.com'],

  // All known API paths for ChatGPT (current + legacy)
  interceptPaths: [
    '/backend-api/conversation',
    '/backend-api/f/conversation',   // current routing prefix (added 2025)
    '/api/conversation',
    '/backend-anon/conversation',
  ],

  /**
   * Extract the conversation UUID from the URL.
   * ChatGPT URLs look like: /c/6a31d1ad-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   * Returns 'global' for the home page (no active conversation).
   * @param {Location} location
   * @returns {string}
   */
  getSessionId(location) {
    const m = location.pathname.match(/\/c\/([a-f0-9-]{36})/i);
    return m ? m[1] : 'global';
  },
};

// Platform configs are plain objects — no module system in MV3 MAIN world scripts.
// The platform-registry.js collects these via a global array at startup.
if (typeof window !== 'undefined') {
  window.__ARKN_PLATFORMS__ = window.__ARKN_PLATFORMS__ || [];
  window.__ARKN_PLATFORMS__.push(chatgptConfig);
}
