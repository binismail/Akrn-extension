import { env, pipeline } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('src/background/onnx-runtime/');
  env.backends.onnx.wasm.numThreads = 1;
}

let autoPipeline = null;

async function getPipeline() {
  if (!autoPipeline) {
    autoPipeline = pipeline('token-classification', 'onnx-community/distilbert-NER-ONNX', {
      quantized: true,
    });
  }
  return autoPipeline;
}

self.__ARKN_NER_RUNNER__ = async function runNer(text) {
  const recognizer = await getPipeline();
  const modelText = text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  const entities = await recognizer(modelText, { aggregation_strategy: 'none' });
  const spans = [];
  let cursor = 0;
  let current = null;

  for (const entity of entities) {
    const tag = entity.entity_group || entity.entity || '';
    const group = tag.replace(/^[BI]-/, '');
    if (!['PER', 'ORG', 'LOC'].includes(group)) {
      if (current) spans.push(current);
      current = null;
      continue;
    }

    const piece = String(entity.word || '').replace(/^##/, '');
    const start = Number.isInteger(entity.start)
      ? entity.start
      : text.toLowerCase().indexOf(piece.toLowerCase(), cursor);
    if (start < 0) continue;
    const end = Number.isInteger(entity.end) ? entity.end : start + piece.length;
    const isSubword = String(entity.word || '').startsWith('##');
    const begins = !current || current.entity_group !== group || start > current.end + 1 || (!isSubword && tag.startsWith('B-'));

    if (begins) {
      if (current) spans.push(current);
      current = { start, end, entity_group: group, score: entity.score };
    } else {
      current.end = end;
      current.score = Math.min(current.score, entity.score);
    }
    cursor = Math.max(cursor, end);
  }
  if (current) spans.push(current);

  return spans.map((span) => ({
    ...span,
    text: text.slice(span.start, span.end),
  }));
};

self.__ARKN_NER_WARMUP__ = getPipeline;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ARKN_NER') return undefined;

  const text = typeof message.text === 'string' ? message.text : '';
  console.log('[ARKN] NER worker request:', { requestId: message.requestId, textLength: text.length });
  if (!text.trim()) {
    sendResponse({ ok: true, spans: [] });
    return true;
  }

  self.__ARKN_NER_RUNNER__(text)
    .then((spans) => {
      console.log('[ARKN] NER worker response:', { requestId: message.requestId, entities: spans.length, spans });
      sendResponse({ ok: true, spans });
    })
    .catch((error) => {
      console.warn('[ARKN] NER worker failed:', error.message);
      sendResponse({ ok: false, spans: [], error: error.message });
    });

  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ARKN_NER_WARMUP') return undefined;
  getPipeline()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
