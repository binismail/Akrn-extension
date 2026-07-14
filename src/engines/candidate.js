/**
 * ARKN Pipeline — Candidate Interface & Shared Namespace
 *
 * Every detector produces Candidate objects with the same shape.
 * This file establishes the shared pipeline namespace and factory.
 *
 * Loaded first in manifest content_scripts (MAIN world).
 */
(function (global) {
  'use strict';

  // ── Shared pipeline namespace ──────────────────────────────────────────────
  global.__ARKN_PIPELINE__ = global.__ARKN_PIPELINE__ || {};
  global.__ARKN_DETECTORS__ = global.__ARKN_DETECTORS__ || [];

  /**
   * Creates a Candidate object.
   *
   * @param {number} start       — Character offset in text (inclusive)
   * @param {number} end         — Character offset in text (exclusive)
   * @param {string} text        — Matched substring
   * @param {string} type        — Entity type: "EMAIL" | "PHONE" | "NAME" | "ORG" | etc.
   * @param {number} confidence  — Detection confidence: 0.0 – 1.0
   * @param {string} detector    — Detector ID: "regex-email" | "dict-name" | etc.
   * @returns {object}
   */
  function createCandidate(start, end, text, type, confidence, detector) {
    return { start, end, text, type, confidence, detector };
  }

  global.__ARKN_PIPELINE__.createCandidate = createCandidate;

})(typeof window !== 'undefined' ? window : globalThis);
