/**
 * ARKN — Claude (Anthropic) Platform Config
 *
 * Confirmed via network inspection on claude.ai.
 *
 * Message endpoint URL pattern:
 *   POST /api/organizations/{org_id}/chat_conversations/{conv_id}/completion
 *
 * Other endpoints on the same domain (NOT intercepted):
 *   POST .../title          — generates conversation title, payload: { message_content, recent_titles }
 *   GET  .../settings       — user settings
 *   GET  .../memory         — memory entries
 *
 * The adapter distinguishes these by payload shape (only completion has `messages` array).
 */

const claudeConfig = {
  id: 'claude',
  label: 'Claude',

  hosts: ['claude.ai'],

  // Intercepts all conversation API calls; the adapter filters to completion-only
  interceptPaths: [
    '/chat_conversations',
  ],

  /**
   * Extract conversation UUID from Claude's browser URL.
   * Claude URLs: https://claude.ai/chat/{uuid}
   * @param {Location} location
   * @returns {string}
   */
  getSessionId(location) {
    // Browser URL: /chat/{uuid}
    const browserMatch = location.pathname.match(/\/chat\/([a-f0-9-]{36})/i);
    if (browserMatch) return `claude_${browserMatch[1]}`;
    return 'claude_global';
  },
};

if (typeof window !== 'undefined') {
  window.__ARKN_PLATFORMS__ = window.__ARKN_PLATFORMS__ || [];
  window.__ARKN_PLATFORMS__.push(claudeConfig);
}
