/**
 * ARKN — ChatGPT Platform Adapter
 *
 * Knows how to parse ChatGPT's specific JSON payload format and extract/write
 * user message text parts. All platform-specific schema knowledge lives here —
 * the core interceptor stays generic.
 *
 * ChatGPT message schema (current):
 *   {
 *     messages: [{
 *       author: { role: "user" },
 *       content: { parts: ["text here"] }
 *     }]
 *   }
 *
 * Legacy schema also supported:
 *   { messages: [{ role: "user", content: "text here" }] }
 */

const chatgptAdapter = {
  id: 'chatgpt',

  /**
   * Given a parsed JSON payload, return an array of message descriptors.
   * Each descriptor has:
   *   - getText():  returns array of text strings from this message
   *   - setText(redactedParts): writes the redacted strings back into the message
   *
   * @param {object} parsed - The parsed JSON body
   * @returns {Array<{getText: Function, setText: Function}>}
   */
  extractUserMessages(parsed) {
    const messages = parsed?.messages ?? [];
    const result = [];

    for (const msg of messages) {
      // Support both ChatGPT's current schema (author.role) and legacy (role)
      const role = msg?.author?.role ?? msg?.role;
      if (role !== 'user') continue;

      // Format A: content.parts is an array of strings (current ChatGPT)
      if (Array.isArray(msg?.content?.parts)) {
        result.push({
          getText() {
            return msg.content.parts.filter((p) => typeof p === 'string');
          },
          setText(redactedParts) {
            let idx = 0;
            msg.content.parts = msg.content.parts.map((p) =>
              typeof p === 'string' ? redactedParts[idx++] : p
            );
          },
        });
        continue;
      }

      // Format B: content is a plain string (legacy ChatGPT)
      if (typeof msg?.content === 'string') {
        result.push({
          getText() {
            return [msg.content];
          },
          setText(redactedParts) {
            msg.content = redactedParts[0];
          },
        });
      }
    }

    return result;
  },
};

// Register adapter on the global namespace so interceptor can find it
if (typeof window !== 'undefined') {
  window.__ARKN_ADAPTERS__ = window.__ARKN_ADAPTERS__ || {};
  window.__ARKN_ADAPTERS__['chatgpt'] = chatgptAdapter;
}
