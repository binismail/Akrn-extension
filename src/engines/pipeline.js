/**
 * ARKN Pipeline — Orchestrator
 *
 * Wires together: detectors → merger → scorer → policy → tokenizer
 * Exposes the same API as the old monolithic regex-engine.js:
 *   window.__ARKN_REGEX__ = { redact, restore }
 *
 * This ensures zero changes to interceptor.js, platform adapters, and all tests.
 */
(function (global) {
  'use strict';

  const pipeline = global.__ARKN_PIPELINE__;
  const detectors = global.__ARKN_DETECTORS__;

  /**
   * Redacts PII in text using the full pipeline.
   *
   * Flow: text → [detectors] → merge → score → policy → tokenize
   * @param {string} text            — Raw user text
   * @param {object} [tokenOffsets]   — Starting counter per type (e.g. { NAME: 2 })
   * @param {object} [policyConfig]   — Active policy configuration (threshold, enabled types)
   * @returns {{ redacted: string, tokens: Map<string,string>, summary: object }}
   */
  function redact(text, tokenOffsets, policyConfig) {
    tokenOffsets = tokenOffsets || {};

    // ── Step 1: Run all detectors ──────────────────────────────────────────
    let allCandidates = [];
    for (const detector of detectors) {
      try {
        const found = detector.detect(text);
        if (found && found.length > 0) {
          if (detector.id === 'ner-distilbert') {
            console.log('[ARKN] NER detector candidates:', found);
          }
          allCandidates = allCandidates.concat(found);
        }
      } catch (err) {
        console.warn(`[ARKN] Detector "${detector.id}" error:`, err);
      }
    }

    // ── Run custom rules if present in the active policy config ────────────────
    if (policyConfig && Array.isArray(policyConfig.customRules)) {
      const customCandidates = runCustomRules(text, policyConfig.customRules);
      if (customCandidates.length > 0) {
        allCandidates = allCandidates.concat(customCandidates);
      }
    }

    if (allCandidates.length === 0) {
      return { redacted: text, tokens: new Map(), summary: {} };
    }

    // Filter out candidates whose detector types are disabled in the policy config
    if (policyConfig && policyConfig.enabledTypes) {
      allCandidates = allCandidates.filter(c => policyConfig.enabledTypes[c.type] !== false);
    }

    if (allCandidates.length === 0) {
      return { redacted: text, tokens: new Map(), summary: {} };
    }

    // ── Step 1b: Propagate — find all other case-insensitive occurrences ───
    // When a NAME is detected at one position (e.g. "my friend james"),
    // find ALL other occurrences of "james" (any casing) in the text.
    const create = pipeline.createCandidate;
    const seenTexts = new Set();
    const propagated = [];

    for (const c of allCandidates) {
      if (c.type !== 'NAME') continue;
      const key = c.text.toLowerCase();
      if (seenTexts.has(key)) continue;
      seenTexts.add(key);

      const escaped = c.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp('\\b' + escaped + '\\b', 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        // Skip if this is the exact same span as an existing candidate
        const isDup = allCandidates.some(
          x => x.start === start && x.end === end && x.type === 'NAME'
        );
        if (!isDup) {
          propagated.push(create(start, end, c.text, 'NAME', c.confidence, 'propagation'));
        }
      }
    }

    if (propagated.length > 0) {
      allCandidates = allCandidates.concat(propagated);
    }

    // ── Step 2: Merge overlapping candidates ───────────────────────────────
    const merged = pipeline.merge(allCandidates);

    // ── Step 3: Score candidates (contextual boosting) ─────────────────────
    const scored = pipeline.score(merged, text);

    // ── Step 4: Apply policy (threshold filtering) ─────────────────────────
    const thresholdOpts = (policyConfig && typeof policyConfig.confidenceThreshold === 'number') 
      ? { threshold: policyConfig.confidenceThreshold } 
      : null;
    const accepted = pipeline.applyPolicy(scored, thresholdOpts);

    if (accepted.length === 0) {
      return { redacted: text, tokens: new Map(), summary: {} };
    }

    // ── Step 5: Tokenize (replace with {TYPE_N} placeholders) ──────────────
    return pipeline.tokenize(text, accepted, tokenOffsets);
  }

  /**
   * Run custom rules against the text.
   *
   * @param {string} text
   * @param {object[]} rules - Array of custom rules from policy
   * @returns {object[]} candidates
   */
  function runCustomRules(text, rules) {
    const candidates = [];
    const create = pipeline.createCandidate;

    for (const rule of rules) {
      if (!rule.pattern || !rule.name) continue;
      
      const type = rule.name.toUpperCase().replace(/\s+/g, '_');
      const isRegex = rule.type === 'regex';
      
      try {
        let regex;
        if (isRegex) {
          regex = new RegExp(rule.pattern, 'gi');
        } else {
          const escaped = rule.pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          regex = new RegExp('\\b' + escaped + '\\b', 'gi');
        }
        
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(text)) !== null) {
          const matchedText = m[0];
          if (!matchedText) continue;
          
          candidates.push(create(
            m.index,
            m.index + matchedText.length,
            matchedText,
            type,
            1.0, // custom rules match with 1.0 confidence (strict blocking)
            'custom-rule'
          ));
        }
      } catch (err) {
        console.warn(`[ARKN] Custom rule "${rule.name}" execution error:`, err.message);
      }
    }
    return candidates;
  }

  async function redactAsync(text, tokenOffsets, policyConfig) {
    if (global.__ARKN_NER__ && typeof global.__ARKN_NER__.prefetch === 'function') {
      await global.__ARKN_NER__.prefetch(text);
    }
    const result = redact(text, tokenOffsets, policyConfig);
    console.log('[ARKN] Async redact result:', {
      nerCandidates: global.__ARKN_NER__?.detect(text)?.length || 0,
      tokens: result.tokens.size,
      summary: result.summary,
    });
    return result;
  }

  /**
   * Restores tokens back to original values.
   *
   * @param {string}            text     — Text containing {TYPE_N} placeholders
   * @param {Map<string,string>} tokenMap — token → original value
   * @returns {string}
   */
  function restore(text, tokenMap) {
    return pipeline.restore(text, tokenMap);
  }

  // ── Expose same API as old regex-engine.js ──────────────────────────────
  global.__ARKN_REGEX__ = { redact, redactAsync, restore };

  console.log(`[ARKN] 🧠 Pipeline loaded (${detectors.length} detectors) ✓`);

})(typeof window !== 'undefined' ? window : globalThis);
