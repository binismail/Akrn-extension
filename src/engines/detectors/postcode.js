/**
 * ARKN Detector — International Postcodes
 * Detects UK, US, Canadian, Nigerian, Indian, German, French,
 * Australian, and Dutch postal codes. Confidence: 1.0.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;

  const PATTERNS = [
    // UK
    /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/gi,
    // US ZIP / ZIP+4
    /\b\d{5}(?:-\d{4})?\b/g,
    // Canadian
    /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/gi,
    // Nigerian six-digit postal code
    /\b\d{6}\b/g,
    // Indian PIN (cannot begin with zero)
    /\b[1-9]\d{5}\b/g,
    // German and French five-digit postal codes
    /\b\d{5}\b/g,
    // Australian four-digit postcode
    /\b\d{4}\b/g,
    // Dutch postcode
    /\b\d{4}\s?[A-Z]{2}\b/gi,
  ];

  function detect(text) {
    const candidates = [];
    const seen = new Set();
    const nhsLikeSpans = [];
    const nhsLike = /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g;
    let nhsMatch;
    while ((nhsMatch = nhsLike.exec(text)) !== null) {
      nhsLikeSpans.push({
        start: nhsMatch.index,
        end: nhsMatch.index + nhsMatch[0].length,
      });
    }

    for (const regex of PATTERNS) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const matchStart = match.index;
        const matchEnd = match.index + match[0].length;
        const isNumericOnly = /^\d+$/.test(match[0]);
        if (isNumericOnly && nhsLikeSpans.some((span) =>
          matchStart >= span.start && matchEnd <= span.end
        )) continue;
        const key = `${matchStart}:${matchEnd}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(create(
          match.index,
          match.index + match[0].length,
          match[0],
          'POSTCODE',
          1.0,
          'regex-postcode-intl'
        ));
      }
    }

    return candidates
      .sort((a, b) => {
        const lengthDiff = (b.end - b.start) - (a.end - a.start);
        return lengthDiff || a.start - b.start;
      })
      .filter((candidate, index, all) => {
        return !all.slice(0, index).some((kept) =>
          candidate.start < kept.end && candidate.end > kept.start
        );
      })
      .sort((a, b) => a.start - b.start);
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-postcode-intl', detect });
})(typeof window !== 'undefined' ? window : globalThis);
