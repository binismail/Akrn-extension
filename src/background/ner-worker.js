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
  const inputIds = recognizer.tokenizer(modelText).input_ids.data;
  const spans = [];
  let cursor = 0;
  let current = null;

  function flush() {
    if (!current) return;
    const tokenIds = Array.from(inputIds.slice(current.tokenStart, current.tokenEnd + 1));
    const decoded = recognizer.tokenizer.decode(tokenIds, { skip_special_tokens: true }).trim();
    const start = modelText.toLowerCase().indexOf(decoded.toLowerCase(), cursor);
    if (start >= 0 && decoded.split(/\s+/).length >= 2) {
      const inferredGroup = current.groups[0] === 'MISC'
        ? 'PER'
        : current.groups[0] === 'ORG'
          ? 'ORG'
          : current.groups[0] === 'PER'
            ? 'PER'
            : current.groups[0] === 'LOC'
              ? 'LOC'
              : null;
      if (!inferredGroup) {
        current = null;
        return;
      }
      spans.push({
        start,
        end: start + decoded.length,
        entity_group: inferredGroup,
        score: Math.max(current.score, 0.72),
        text: text.slice(start, start + decoded.length),
      });
      cursor = start + decoded.length;
    }
    current = null;
  }

  for (const entity of entities) {
    const tag = entity.entity_group || entity.entity || '';
    const group = tag.replace(/^[BI]-/, '');
    if (!['PER', 'ORG', 'LOC', 'MISC'].includes(group)) {
      flush();
      continue;
    }

    const tokenIndex = Number(entity.index);
    if (!Number.isInteger(tokenIndex)) continue;
    const isContinuation = current && tokenIndex <= current.tokenEnd + 2;
    if (!isContinuation) {
      flush();
      current = {
        tokenStart: tokenIndex,
        tokenEnd: tokenIndex,
        groups: [group],
        score: Number(entity.score) || 0,
      };
    } else {
      current.tokenEnd = tokenIndex;
      if (!current.groups.includes(group)) current.groups.push(group);
      current.score = Math.min(current.score, Number(entity.score) || 0);
    }
  }
  flush();

  return spans;
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
