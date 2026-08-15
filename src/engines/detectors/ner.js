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
  const REQUEST_TIMEOUT_MS = 8000;
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

  global.addEventListener('message', (event) => {
    if (event.source !== global || event.data?.type !== 'ARKN_NER_RESPONSE') return;
    handleResponse(event.data);
  });

  global.addEventListener('arkn:ner-response', (event) => {
    handleResponse(event.detail);
  });

  function handleResponse(detail) {
    const { requestId: id, text, spans, error } = detail || {};
    const request = pending.get(id);
    if (!request) return;

    pending.delete(id);
    pending.delete(request.key);
    clearTimeout(request.timer);

    const candidates = mapSpans(text, spans);
    if (!error) cache.set(request.key, candidates);
    console.log('[ARKN] NER response:', {
      requestId: id,
      entities: candidates.length,
      error: error || null,
    });
    request.resolve(candidates);
  }

  function prefetch(text) {
    if (!text || !text.trim()) return Promise.resolve([]);
    const key = text;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(key)) return pending.get(key).promise;

    const id = ++requestId;
    console.log('[ARKN] NER request:', { requestId: id, textLength: text.length });
    let resolveRequest;
    const promise = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    const request = {
      key,
      promise,
      resolve: resolveRequest,
      timer: setTimeout(() => {
        pending.delete(key);
        pending.delete(id);
        console.warn('[ARKN] NER request timed out; regex fallback used:', { requestId: id });
        resolveRequest([]);
      }, REQUEST_TIMEOUT_MS),
    };

    pending.set(key, request);
    pending.set(id, request);
    global.dispatchEvent(new CustomEvent('arkn:ner-request', {
      detail: { requestId: id, text },
    }));

    return promise;
  }

  function detect(text) {
    return cache.get(text) || [];
  }

  global.__ARKN_NER__ = { detect, prefetch, cache, REQUEST_TIMEOUT_MS };
  global.__ARKN_DETECTORS__.push({ id: 'ner-distilbert', detect });
})(typeof window !== 'undefined' ? window : globalThis);
