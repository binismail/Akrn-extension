/**
 * ARKN — Claude (Anthropic) Platform Adapter
 *
 * Confirmed payload format via network inspection on claude.ai.
 *
 * Message (completion) endpoint payload:
 *   POST /api/organizations/{org_id}/chat_conversations/{conv_id}/completion
 *   {
 *     "messages": [
 *       { "role": "human", "content": "hey" }   ← current observed format
 *       // Claude API also uses "user" as role in some versions
 *     ],
 *     "model": "claude-sonnet-4-5",
 *     "max_tokens": 8096,
 *     ...
 *   }
 *
 * Other endpoints on the same domain that we must NOT modify:
 *   POST .../title   → { message_content: "...", recent_titles: [] }  ← no `messages` key
 *   GET  .../settings, memory, etc.
 *
 * Filtering strategy: only process payloads that have a `messages` array.
 */

const claudeAdapter = {
  id: 'claude',

  /**
   * Extract user message descriptors from Claude's completion payload.
   * Returns empty array for non-completion endpoints (title, settings, etc.)
   *
   * THREE CONFIRMED FORMATS (from network inspection):
   *
   * Format A — Messages array (Anthropic API format):
   *   { messages: [{ role: "human"|"user", content: "text" }], model: "..." }
   *
   * Format B — Content blocks (multi-modal):
   *   { messages: [{ role: "human", content: [{ type: "text", text: "..." }] }] }
   *
   * Format C — Direct prompt string (Claude web UI, CONFIRMED):
   *   { prompt: "so the name is Khalid what's yours?", parent_message_uuid: "...", model: "..." }
   *
   * @param {object} parsed - The parsed JSON body
   * @returns {Array<{getText: Function, setText: Function}>}
   */
  extractUserMessages(parsed) {
    // ── Format C: direct prompt string (Claude web UI) ─────────────────────
    // Confirmed via network inspection: {"prompt": "user text", "parent_message_uuid": "...", ...}
    if (typeof parsed?.prompt === 'string' && parsed.prompt.length > 0) {
      return [{
        getText() {
          return [parsed.prompt];
        },
        setText(redactedParts) {
          parsed.prompt = redactedParts[0];
        },
      }];
    }

    // ── Formats A + B: messages array (Anthropic API / future-proofing) ────
    // Guard: only the completion endpoint has a `messages` array.
    // The title endpoint has `message_content` (string) — skip it entirely.
    if (!Array.isArray(parsed?.messages)) {
      return [];
    }

    const result = [];

    for (const msg of parsed.messages) {
      // Claude uses "human" as the user role (not "user")
      // Support both for compatibility
      const role = msg?.role;
      if (role !== 'human' && role !== 'user') continue;

      // Format A: content is a plain string (most common in Claude's web interface)
      if (typeof msg.content === 'string') {
        result.push({
          getText() {
            return [msg.content];
          },
          setText(redactedParts) {
            msg.content = redactedParts[0];
          },
        });
        continue;
      }

      // Format B: content is an array of blocks (Claude's multi-modal format)
      // [{ type: "text", text: "..." }, { type: "image", ... }]
      if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter((b) => b?.type === 'text' && typeof b?.text === 'string');
        if (textBlocks.length > 0) {
          result.push({
            getText() {
              return textBlocks.map((b) => b.text);
            },
            setText(redactedParts) {
              let idx = 0;
              for (const block of textBlocks) {
                block.text = redactedParts[idx++] ?? block.text;
              }
            },
          });
        }
      }
    }

    return result;
  },

};

if (typeof window !== 'undefined') {
  window.__ARKN_ADAPTERS__ = window.__ARKN_ADAPTERS__ || {};
  window.__ARKN_ADAPTERS__['claude'] = claudeAdapter;
}
