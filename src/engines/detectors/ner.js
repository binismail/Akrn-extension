/**
 * ARKN Detector — Background NER Adapter
 *
 * NER inference runs in the service worker. This MAIN-world adapter keeps a
 * short-lived exact-text cache and exposes a bounded prefetch promise.
 */
(function (global) {
  'use strict';

  const create = global.__ARKN_PIPELINE__.createCandidate;
  const cache = new Map();
  const pending = new Map();
  let requestId = 0;

  function mapSpans(text, spans) {
    return (spans || [])
      .filter((span) => span && Number.isInteger(span.start) && Number.isInteger(span.end))
      .map((span) => {
        const type = span.entity_group === 'PER'
          ? 'NAME'
          : span.entity_group === 'ORG'
            ? 'ORG'
            : span.entity_group === 'LOC'
              ? 'LOCATION'
              : null;
        if (!type || span.end <= span.start) return null;
        return create(
          span.start,
          span.end,
          text.slice(span.start, span.end),
          type,
          Math.max(0, Math.min(1, Number(span.score) || 0)),
          'ner-distilbert'
        );
      })
      .filter(Boolean);
  }

  global.addEventListener('arkn:ner-response', (event) => {
    const { requestId: id, text, spans } = event.detail || {};
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    pending.delete(text);
    const candidates = mapSpans(text, spans);
    cache.set(text, candidates);
    request.resolve(candidates);
  });

  function prefetch(text) {
    if (!text || !text.trim()) return Promise.resolve([]);
    if (cache.has(text)) return Promise.resolve(cache.get(text));
    if (pending.has(text)) return pending.get(text).promise;

    const id = ++requestId;
    let timer;
    let resolveRequest;
    const promise = new Promise((resolve) => {
      resolveRequest = resolve;
      timer = setTimeout(() => {
        pending.delete(text);
        pending.delete(id);
        resolve([]);
      }, 300);
    });

    pending.set(text, { promise, resolve: (value) => {
      clearTimeout(timer);
      resolveRequest(value);
    }});
    pending.set(id, pending.get(text));

    global.dispatchEvent(new CustomEvent('arkn:ner-request', {
      detail: { requestId: id, text },
    }));

    return promise;
  }

  function detect(text) {
    return cache.get(text) || [];
  }

  global.__ARKN_NER__ = { detect, prefetch, cache };
  global.__ARKN_DETECTORS__.push({ id: 'ner-distilbert', detect });
})(typeof window !== 'undefined' ? window : globalThis);
