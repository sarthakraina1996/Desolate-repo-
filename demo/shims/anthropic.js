// Stand-in for @anthropic-ai/sdk: messages.create() becomes one prompt for the artifact's
// `sample` capability (the viewer's own Claude access). PDFs go as text; `sample` is text-only.
import { extractText, getDocumentProxy } from 'unpdf';
import { Buffer } from 'buffer';

let sample = null;
// Receives the page's `sample` function once claude.ai grants it.
export function setSample(fn) {
  sample = fn;
}

// Readable messages for the error codes `sample` can throw.
const WHY = {
  not_granted: 'Claude is not allowed on this page (check the artifact permissions)',
  rate_limited: 'Claude is busy for this account; try again in a minute',
  usage_limit: 'this account has reached its Claude usage limit',
  prompt_too_large: 'the resume is too long',
  invalid_json: 'Claude returned an unreadable answer',
};

// Flattens one content block to text; PDFs are extracted and capped at 60,000 characters.
async function blockText(block) {
  if (block.type === 'text') return block.text;
  if (block.type === 'document' && block.source?.type === 'base64') {
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(block.source.data, 'base64')));
    const { text } = await extractText(pdf, { mergePages: true });
    return `<resume>\n${String(text || '')
      .trim()
      .slice(0, 60000)}\n</resume>`;
  }
  return '';
}

// Stands in for messages.create(): JSON-schema requests use sample.json, the rest plain text.
async function create(params) {
  if (!sample) throw new Error('Claude is not available on this page');
  const parts = [params.system || ''];
  for (const m of params.messages || []) {
    const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    for (const b of content) parts.push(await blockText(b));
  }
  const schema =
    params.output_config?.format?.type === 'json_schema'
      ? params.output_config.format.schema
      : null;
  if (schema)
    parts.push(
      `Reply with only one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(schema)}`,
    );
  const prompt = parts.filter(Boolean).join('\n\n');
  try {
    if (schema) {
      const value = await sample.json(prompt, { modelTier: 'default', cache: false });
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }] };
    }
    const { text, truncated } = await sample(prompt, { modelTier: 'quick', cache: false });
    return {
      stop_reason: truncated ? 'max_tokens' : 'end_turn',
      content: [{ type: 'text', text }],
    };
  } catch (e) {
    if (e?.code === 'refused') throw new Error('The AI declined to process this resume.');
    throw new Error(WHY[e?.code] || e?.message || 'Claude could not answer');
  }
}

// Stands in for the SDK client; beta.messages and messages share the same create().
export default class Anthropic {
  constructor() {
    this.beta = { messages: { create } };
    this.messages = { create };
  }
}
