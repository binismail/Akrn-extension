/**
 * ARKN Pipeline — Policy Engine
 *
 * Filters candidates based on a configurable confidence threshold.
 * Default: 0.7 (matches current behavior where all detections pass).
 * Future: per-firm thresholds, allowlists, blocklists.
 */
(function (global) {
  'use strict';

  const DEFAULT_THRESHOLD = 0.7;

  /**
   * Apply policy to filter candidates below threshold.
   *
   * @param {object[]} candidates — Scored candidates
   * @param {object}   [opts]     — Policy options
   * @param {number}   [opts.threshold=0.7] — Minimum confidence to accept
   * @returns {object[]} — Candidates that pass policy
   */
  function applyPolicy(candidates, opts) {
    const threshold = (opts && typeof opts.threshold === 'number') ? opts.threshold : DEFAULT_THRESHOLD;
    return candidates.filter(c => c.confidence >= threshold);
  }

  global.__ARKN_PIPELINE__.applyPolicy = applyPolicy;

})(typeof window !== 'undefined' ? window : globalThis);
