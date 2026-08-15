import { env, pipeline } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('src/background/onnx-runtime/');
  env.backends.onnx.wasm.numThreads = 1;
}

// Common English words that the NER model sometimes mislabels as PER
// (e.g. "Tomorrow", "Will", "Called", "Tell"). These are never name
// components, so they must not extend a person span.
const COMMON_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'with', 'from', 'about', 'after', 'before', 'into', 'over', 'under',
  'will', 'would', 'could', 'should', 'shall', 'may', 'might', 'must', 'can',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'done', 'not', 'no', 'yes', 'this', 'that', 'these',
  'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'you',
  'him', 'us', 'them', 'it', 'i', 'we', 'they', 'he', 'she',
  'tomorrow', 'today', 'yesterday', 'now', 'then', 'here', 'there',
  'please', 'ask', 'tell', 'called', 'call', 'contact', 'email', 'meet',
  'send', 'review', 'update', 'join', 'talk', 'speak', 'attend', 'about',
  'the', 'will', 'and', 'for', 'with', 'case', 'meeting', 'letter',
]);

let autoPipeline = null;
let nerReady = null;

async function getPipeline() {
  if (!autoPipeline) {
    autoPipeline = pipeline('token-classification', 'onnx-community/distilbert-NER-ONNX', {
      quantized: true,
    });
  }
  return autoPipeline;
}

function warmupNer() {
  if (!nerReady) {
    const startedAt = performance.now();
    nerReady = getPipeline()
      .then((recognizer) => {
        console.log('[ARKN] NER model ready:', Math.round(performance.now() - startedAt), 'ms');
        return recognizer;
      })
      .catch((error) => {
        nerReady = null;
        console.warn('[ARKN] NER warmup failed:', error.message);
        throw error;
      });
  }
  return nerReady;
}

self.__ARKN_NER_WARMUP__ = warmupNer;

self.__ARKN_NER_RUNNER__ = async function runNer(text) {
  const recognizer = await warmupNer();
  // This cased DistilBERT model recognizes entity names far better when they
  // are capitalized, but lower-case prompts are common. Run inference on a
  // title-cased copy (only for recall) while keeping the original text for
  // exact offset mapping and token values.
  const modelText = text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  const entities = await recognizer(modelText, { aggregation_strategy: 'none' });
  const inputIds = recognizer.tokenizer(modelText).input_ids.data;

  // ── Group entity tokens into typed spans using BIO + index continuity ──────
  const groups = [];
  let current = null;

  function flush() {
    if (!current) return;
    groups.push(current);
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

    // The model sometimes tags common English words (Tomorrow, Will, Called)
    // as PER. These must not extend or start a person span.
    const wordLower = String(entity.word || '').toLowerCase();
    if (group === 'PER' && !wordLower.startsWith('##') && COMMON_WORDS.has(wordLower)) {
      flush();
      continue;
    }

    const isSubword = String(entity.word || '').startsWith('##');
    // A new B-* label always begins a new entity boundary, even when it
    // continues the same type (e.g. "B-PER ... B-PER"). This keeps separate
    // names distinct instead of merging them across intervening words.
    // Exception: a "##subword" token continues its source word even when the
    // model restarts BIO at the subword (e.g. "B-PER(Fe) B-PER(##mi)").
    const isNewBegin = tag.startsWith('B-') && !isSubword;
    // Transformers.js omits O-labeled tokens, so gaps in the index sequence
    // indicate intervening words. Flush the current span whenever we skip a
    // token, otherwise "and", "at", etc. get absorbed into a single entity.
    const isGap = current && tokenIndex > current.tokenEnd + 2;
    // A subword token is part of the current source word — always continue it
    // (even across a B- restart or a low individual score), never start fresh.
    const isSubwordContinue = current && isSubword && tokenIndex <= current.tokenEnd + 2;
    const isContinuation = isSubwordContinue ||
      (current &&
        !isNewBegin &&
        !isGap &&
        ((tag.startsWith('I-') && group === current.groups[0]) ||
          // Adjacent name parts may be tagged B-PER + B-PER (no gap); merge
          // them so "Femi Balogun" stays one span.
          (group === 'PER' && current.groups[0] === 'PER')));

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

  // ── Convert each grouped token range into an exact source span ─────────────
  const spans = [];
  let cursor = 0;

  for (const g of groups) {
    const tokenIds = Array.from(inputIds.slice(g.tokenStart, g.tokenEnd + 1));
    const decoded = recognizer.tokenizer.decode(tokenIds, { skip_special_tokens: true }).trim();
    if (!decoded) continue;

    const inferredGroup = g.groups[0] === 'MISC'
      ? 'PER'
      : g.groups[0] === 'ORG'
        ? 'ORG'
        : g.groups[0] === 'PER'
          ? 'PER'
          : g.groups[0] === 'LOC'
            ? 'LOC'
            : null;
    if (!inferredGroup) continue;

    // Find the decoded text in the source from the last span's end.
    const start = modelText.toLowerCase().indexOf(decoded.toLowerCase(), cursor);
    if (start < 0) continue;

    // The decoded text may include a trailing space captured by the decode
    // (e.g. "Lagos Nigeria "). Trim the source substring to the entity's
    // actual coverage — never extend into a following word.
    const rawEnd = start + decoded.length;
    let end = rawEnd;
    while (end > start && /\s/.test(modelText[end - 1])) end--;

    const sourceText = text.slice(start, end);
    if (!sourceText.trim()) continue;

    // Drop entity fragments inside email addresses / URLs (e.g. "co" from
    // "femi.balogun@email.com"). These are domain parts, not real entities.
    const before = text.slice(Math.max(0, start - 2), start);
    if (/[@.]$/.test(before)) continue;

    spans.push({
      start,
      end,
      entity_group: inferredGroup,
      score: Math.max(g.score, 0.72),
      text: sourceText.trim(),
    });
    cursor = end;
  }

  return spans;
};

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
  warmupNer()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
