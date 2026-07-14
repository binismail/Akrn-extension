/**
 * ARKN Pipeline — Tokenizer
 *
 * Replaces accepted candidates with {TYPE_N} tokens in the text.
 * Also provides restore() for token → original replacement.
 *
 * Replacement is done right-to-left to preserve character offsets.
 */
(function (global) {
  'use strict';

  /**
   * Replace accepted candidates with tokens in the text.
   *
   * Handles duplicate text values (same name appearing multiple times)
   * by assigning them the same token number.
   *
   * @param {string}   text          — Original text
   * @param {object[]} candidates    — Accepted candidates (sorted by start position)
   * @param {object}   [tokenOffsets] — Starting counter per type (e.g. { NAME: 2 })
   * @returns {{ redacted: string, tokens: Map<string,string>, summary: object }}
   */
  function tokenize(text, candidates, tokenOffsets) {
    tokenOffsets = tokenOffsets || {};
    const tokens = new Map();
    const summary = {};

    if (candidates.length === 0) {
      return { redacted: text, tokens, summary };
    }

    // Sort candidates by start position descending (right-to-left replacement)
    const sorted = candidates.slice().sort((a, b) => b.start - a.start);

    // Track counters per type and dedup map for same-text-same-type
    const counters = {};        // type → current count
    const textToToken = {};     // `type:text` → token string

    // First pass: assign token numbers (left-to-right for consistent numbering)
    const leftToRight = candidates.slice().sort((a, b) => a.start - b.start);
    for (const c of leftToRight) {
      const key = `${c.type}:${c.text}`;
      if (!textToToken[key]) {
        if (counters[c.type] === undefined) {
          counters[c.type] = tokenOffsets[c.type] || 0;
        }
        counters[c.type]++;
        textToToken[key] = `{${c.type}_${counters[c.type]}}`;
      }
    }

    // Second pass: replace right-to-left using assigned tokens
    let redacted = text;
    for (const c of sorted) {
      const key = `${c.type}:${c.text}`;
      const token = textToToken[key];
      redacted = redacted.slice(0, c.start) + token + redacted.slice(c.end);
      tokens.set(token, c.text);
    }

    // Build summary counts
    for (const [type, count] of Object.entries(counters)) {
      const base = tokenOffsets[type] || 0;
      if (count > base) {
        summary[type] = count - base;
      }
    }

    return { redacted, tokens, summary };
  }

  /**
   * Restores tokens back to their original values.
   *
   * @param {string}            text     — Text containing {TYPE_N} placeholders
   * @param {Map<string,string>} tokenMap — token → original value
   * @returns {string}
   */
  function restore(text, tokenMap) {
    let out = text;
    for (const [token, original] of tokenMap.entries()) {
      out = out.split(token).join(original);
    }
    return out;
  }

  global.__ARKN_PIPELINE__.tokenize = tokenize;
  global.__ARKN_PIPELINE__.restore = restore;

})(typeof window !== 'undefined' ? window : globalThis);
