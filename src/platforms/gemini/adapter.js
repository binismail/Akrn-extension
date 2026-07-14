/**
 * ARKN — Google Gemini Platform Adapter
 *
 * Status: STUB — message schema shape is a best-guess pending verification.
 * Update extractUserMessages() once the actual payload structure is confirmed
 * by inspecting a real gemini.google.com network request body.
 *
 * Gemini likely uses a protobuf-over-HTTP or JSON-RPC payload rather than
 * a simple REST JSON body. The exact format must be confirmed before implementing.
 */

const geminiAdapter = {
  id: 'gemini',

  /**
   * Parses raw URL-encoded form data from Gemini's batchexecute RPC request.
   * @param {string} rawBody
   * @returns {object|null}
   */
  parse(rawBody) {
    if (!rawBody || typeof rawBody !== 'string') return null;

    try {
      const params = new URLSearchParams(rawBody);
      const fReqStr = params.get('f.req');
      if (!fReqStr) return null;

      const fReq = JSON.parse(fReqStr);
      let innerJson = null;
      let innerIndex = -1;

      // Locate the nested JSON payload anywhere within f.req array structure
      function findInnerJson(obj) {
        if (!obj) return null;
        if (typeof obj === 'string' && (obj.startsWith('[') || obj.startsWith('{'))) {
          try {
            const candidate = JSON.parse(obj);
            if (Array.isArray(candidate)) return { candidate, rawStr: obj };
          } catch (_) { /* ignore */ }
        }
        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) {
            const res = findInnerJson(obj[i]);
            if (res) return { ...res, parent: obj, index: i };
          }
        }
        return null;
      }

      const found = findInnerJson(fReq);
      if (found) {
        innerJson = found.candidate;
        var targetParent = found.parent;
        var targetIndex = found.index;
      }

      if (!innerJson) return null;

      return {
        params,
        fReq,
        innerJson,
        targetParent,
        targetIndex,
      };
    } catch (e) {
      console.warn('[ARKN] Failed to parse Gemini batchexecute payload:', e);
      return null;
    }
  },

  /**
   * Extracts user message prompt descriptors from the parsed Gemini inner JSON.
   * Scans all string slots within the nested array structure so prompt detection
   * is completely immune to array index shifts across different Google RPC calls.
   * @param {object} parsed
   * @returns {Array<{ getText: () => string[], setText: (parts: string[]) => void }>}
   */
  extractUserMessages(parsed) {
    if (!parsed || !parsed.innerJson) return [];

    const inner = parsed.innerJson;
    let targetSlot = null;

    // Structure 1: inner[0][0][0] is prompt string (Gemini web UI standard)
    if (Array.isArray(inner) && Array.isArray(inner[0]) && Array.isArray(inner[0][0]) && typeof inner[0][0][0] === 'string') {
      targetSlot = { arr: inner[0][0], index: 0 };
    }
    // Structure 2: inner[0][0] is direct prompt string
    else if (Array.isArray(inner) && Array.isArray(inner[0]) && typeof inner[0][0] === 'string') {
      targetSlot = { arr: inner[0], index: 0 };
    }
    // Fallback: search for strings containing spaces (human sentences) to strictly avoid system IDs
    else {
      function walk(curr) {
        if (!curr || targetSlot) return;
        if (Array.isArray(curr)) {
          for (let i = 0; i < curr.length; i++) {
            if (typeof curr[i] === 'string' && curr[i].includes(' ')) {
              targetSlot = { arr: curr, index: i };
              return;
            } else if (typeof curr[i] === 'object') {
              walk(curr[i]);
            }
          }
        }
      }
      walk(inner);
    }

    if (!targetSlot) return [];

    return [{
      getText() {
        return [targetSlot.arr[targetSlot.index]];
      },
      setText(parts) {
        if (parts && parts.length > 0) {
          targetSlot.arr[targetSlot.index] = parts.join('');
        }
      },
    }];
  },



  /**
   * Serializes the modified parsed payload back to a URL-encoded form string.
   * @param {object} parsed
   * @returns {string}
   */
  serialize(parsed) {
    if (!parsed || !parsed.params || !parsed.fReq || !parsed.innerJson) return '';

    // Pack modified innerJson back into target parent array slot
    if (parsed.targetParent && parsed.targetIndex !== undefined) {
      parsed.targetParent[parsed.targetIndex] = JSON.stringify(parsed.innerJson);
    }

    // Update f.req parameter
    parsed.params.set('f.req', JSON.stringify(parsed.fReq));

    return parsed.params.toString();
  },

};

if (typeof window !== 'undefined') {
  window.__ARKN_ADAPTERS__ = window.__ARKN_ADAPTERS__ || {};
  window.__ARKN_ADAPTERS__['gemini'] = geminiAdapter;
}

