'use strict';

const STYLE_PROMPTS = {
  clean: 'Remove filler words, false starts and repeated words. Fix punctuation, capitalization and sentence breaks. Do not reword, summarize or add anything.',
  email: 'Remove filler and false starts; format as a concise professional message with correct punctuation. Do not add greetings or sign-offs that were not spoken.',
  notes: 'Remove filler and false starts; format as terse bullet points where the speaker listed items. Keep all content.',
  code: 'Remove filler. Preserve identifiers, file names and code tokens exactly as spoken. Use sentence case in prose.',
  literal: 'Fix only punctuation and capitalization. Do not remove any words.'
};

function buildPrompt(settings, context) {
  const style = STYLE_PROMPTS[settings.cleanupStyle] || STYLE_PROMPTS.clean;
  const dict = (settings.dictionary || [])
    .filter((d) => d && d.to)
    .map((d) => `"${d.from}" → "${d.to}"`)
    .join(', ');
  const lines = [
    'You are a dictation formatter. You receive raw speech-to-text output and return only the formatted text.',
    style,
    'Never add content, never answer questions in the text, never translate.',
    dict ? `Apply these spelling corrections when the words appear: ${dict}.` : '',
    context && context.app ? `The text is being written in ${context.app}${context.field ? ` (${context.field})` : ''}. Use that only to inform spelling and capitalization of names and technical terms.` : '',
    'Return the formatted text and nothing else — no quotes, no commentary.'
  ];
  return lines.filter(Boolean).join('\n');
}

async function cleanup(settings, rawText, context, log) {
  if (!settings.cleanupEnabled) return rawText;
  if (!settings.cleanupApiKey && !/localhost|127\.0\.0\.1/.test(settings.cleanupBaseUrl)) return rawText;
  if (!rawText.trim()) return rawText;
  try {
    const res = await fetch(`${settings.cleanupBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.cleanupApiKey ? { Authorization: `Bearer ${settings.cleanupApiKey}` } : {})
      },
      body: JSON.stringify({
        model: settings.cleanupModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: buildPrompt(settings, context) },
          { role: 'user', content: rawText }
        ]
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`cleanup ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || rawText;
  } catch (err) {
    log(`cleanup failed, keeping raw transcript: ${err.message}`);
    return rawText;
  }
}

module.exports = { cleanup, buildPrompt, STYLE_PROMPTS };
