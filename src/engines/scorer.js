/**
 * ARKN Pipeline — Confidence Scorer
 *
 * Applies contextual boosting rules to candidate confidence scores.
 * Rigid PII (email, phone, etc.) stays at 1.0.
 * Name/Org candidates receive boosts based on multiple signals.
 */
(function (global) {
  'use strict';

  const COMMON_NAMES = global.__ARKN_PIPELINE__.COMMON_NAMES;

  /**
   * Score an array of merged candidates, adjusting confidence.
   *
   * @param {object[]} candidates — Merged candidates
   * @param {string} text — Original text (for contextual analysis)
   * @returns {object[]} — Same candidates with updated confidence values
   */
  function score(candidates, text) {
    // Pre-compute: how many times each name text appears in the full text
    const occurrenceCounts = {};
    for (const c of candidates) {
      if (c.type === 'NAME' || c.type === 'ORG') {
        if (!occurrenceCounts[c.text]) {
          // Count all occurrences of this text in the input
          const escaped = c.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const re = new RegExp('\\b' + escaped + '\\b', 'gi');
          const matches = text.match(re);
          occurrenceCounts[c.text] = matches ? matches.length : 1;
        }
      }
    }

    for (const c of candidates) {
      // Rigid PII detectors already have confidence 1.0 — skip
      if (c.confidence >= 1.0) continue;

      let boost = 0;

      // Boost: appears in global name dictionary
      if (c.type === 'NAME' && COMMON_NAMES && COMMON_NAMES.has(c.text)) {
        boost += 0.10;
      }

      // Boost: name appears multiple times in text (likely a real entity)
      if (occurrenceCounts[c.text] && occurrenceCounts[c.text] > 1) {
        boost += 0.05;
      }

      // Boost: detected by a high-signal context detector
      if (c.detector === 'context-honorific' || c.detector === 'context-intro') {
        boost += 0.05;
      }

      c.confidence = Math.min(1.0, c.confidence + boost);
    }

    return candidates;
  }

  global.__ARKN_PIPELINE__.score = score;

})(typeof window !== 'undefined' ? window : globalThis);
