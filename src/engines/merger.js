/**
 * ARKN Pipeline — Candidate Merger
 *
 * Deduplicates overlapping candidates from multiple detectors.
 * When two candidates overlap, keeps the one with higher confidence.
 * When two candidates cover the exact same span, merges to highest confidence.
 */
(function (global) {
  'use strict';

  /**
   * Merge an array of candidates, removing overlaps.
   *
   * @param {object[]} candidates — Flat array from all detectors
   * @returns {object[]} — Deduplicated candidates, sorted by position
   */
  function merge(candidates) {
    if (candidates.length <= 1) return candidates;

    // Sort by start position, then by confidence descending for same start
    const sorted = candidates.slice().sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.confidence - a.confidence;
    });

    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = sorted[i];

      // Exact same span — keep highest confidence
      if (curr.start === prev.start && curr.end === prev.end) {
        if (curr.confidence > prev.confidence) {
          merged[merged.length - 1] = curr;
        }
        continue;
      }

      // Overlapping spans — prefer longer span (more complete entity), then higher confidence
      if (curr.start < prev.end) {
        const prevLen = prev.end - prev.start;
        const currLen = curr.end - curr.start;
        if (currLen > prevLen || (currLen === prevLen && curr.confidence > prev.confidence)) {
          merged[merged.length - 1] = curr;
        }
        // else: keep prev (already in merged)
        continue;
      }

      // No overlap — add
      merged.push(curr);
    }

    return merged;
  }

  global.__ARKN_PIPELINE__.merge = merge;

})(typeof window !== 'undefined' ? window : globalThis);
