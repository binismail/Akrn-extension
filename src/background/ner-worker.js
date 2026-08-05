import { env, pipeline } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

let autoPipeline = null;

async function getPipeline() {
  if (!autoPipeline) {
    autoPipeline = pipeline('token-classification', 'Xenova/distilbert-base-NER', {
      quantized: true,
    });
  }
  return autoPipeline;
}

self.__ARKN_NER_RUNNER__ = async function runNer(text) {
  const recognizer = await getPipeline();
  const entities = await recognizer(text, { aggregation_strategy: 'simple' });
  return entities.map((entity) => ({
    start: entity.start,
    end: entity.end,
    text: entity.word,
    entity_group: entity.entity_group,
    score: entity.score,
  }));
};

self.__ARKN_NER_WARMUP__ = getPipeline;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ARKN_NER') return undefined;

  const text = typeof message.text === 'string' ? message.text : '';
  if (!text.trim()) {
    sendResponse({ ok: true, spans: [] });
    return true;
  }

  self.__ARKN_NER_RUNNER__(text)
    .then((spans) => {
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
