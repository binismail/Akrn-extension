/**
 * ARKN Detector — Organizations
 * Detects companies/firms with legal suffixes (Ltd, LLP, PLC, etc.). Confidence: 0.90.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;

  // Broad capture: any sequence of words ending in a legal suffix
  const REGEX = /\b([A-Z][A-Za-z0-9\s&'\-]{1,40}\s+(?:Ltd|Limited|LLP|PLC|Corp|Corporation|Inc|Incorporated|Chambers|Partners|Group|Associates|Solicitors))\b/g;

  // Common leading words that are NOT part of org names
  const STRIP_LEADING = new Set([
    'contact', 'please', 'the', 'at', 'from', 'to', 'with', 'about', 'for',
    'call', 'email', 'visit', 'join', 'near', 'like', 'ask', 'tell', 'meet',
    'regarding', 'concerning', 'including', 'between', 'against', 'under',
    'notify', 'inform', 'consult', 'hire', 'sue', 'instruct', 'retain'
  ]);

  function detect(text) {
    REGEX.lastIndex = 0;
    const candidates = [];
    let m;
    while ((m = REGEX.exec(text)) !== null) {
      let orgText = m[1].trim();
      let orgStart = m.index;

      // Strip leading common verbs/prepositions that got captured
      let changed = true;
      while (changed) {
        changed = false;
        const leadMatch = orgText.match(/^([A-Za-z]+)\s+/);
        if (leadMatch && STRIP_LEADING.has(leadMatch[1].toLowerCase())) {
          const stripped = leadMatch[0].length;
          orgText = orgText.slice(stripped);
          orgStart += stripped;
          changed = true;
        }
      }

      // Must still start with uppercase and have at least 2 words
      if (orgText.length > 0 && /^[A-Z]/.test(orgText) && orgText.includes(' ')) {
        candidates.push(create(orgStart, orgStart + orgText.length, orgText, 'ORG', 0.90, 'regex-org'));
      }
    }
    return candidates;
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-org', detect });
})(typeof window !== 'undefined' ? window : globalThis);
