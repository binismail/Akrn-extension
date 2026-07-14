/**
 * ARKN — Google Gemini Platform Config
 *
 * Network inspection findings (gemini.google.com):
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ IMPORTANT: Gemini does NOT use standard JSON POST bodies.       │
 * │                                                                 │
 * │ It uses Google's proprietary "batchexecute" RPC format:         │
 * │   POST /_/BardChatUi/data/batchexecute?rpc=...                  │
 * │   Body: f.req=[[["rpcName","[[\"encoded\",\"message\"]]",...]]]  │
 * │                                                                 │
 * │ The `StreamGenerateContent` endpoint handles AI streaming but   │
 * │ uses binary protobuf encoding, not plain JSON.                  │
 * │                                                                 │
 * │ Intercepting and safely modifying these without a protobuf      │
 * │ schema would risk corrupting the request. Gemini support is     │
 * │ pending a safer decoding strategy.                              │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * STATUS: Pending — extension loads on gemini.google.com but
 * interception is disabled (adapter returns empty) until the
 * batchexecute format is safely decoded.
 *
 * NEXT STEP: Capture a full batchexecute payload in the Network tab
 * (click the request → Payload → View source) and share the raw
 * f.req value so we can build a targeted decoder.
 */

const geminiConfig = {
  id: 'gemini',
  label: 'Gemini',

  hosts: ['gemini.google.com'],

  interceptPaths: [
    'StreamGenerate',
    'batchexecute',
    '/_/BardChatUi/data/',
  ],

  /**
   * @param {Location} location
   * @returns {string}
   */
  getSessionId(location) {
    // Gemini URLs: /app/{hex_id}
    const m = location.pathname.match(/\/app\/([a-f0-9]+)/i);
    return m ? `gemini_${m[1]}` : 'gemini_global';
  },
};

if (typeof window !== 'undefined') {
  window.__ARKN_PLATFORMS__ = window.__ARKN_PLATFORMS__ || [];
  window.__ARKN_PLATFORMS__.push(geminiConfig);
}
