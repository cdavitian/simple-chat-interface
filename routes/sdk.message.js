const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const sdkMessage = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.session?.user?.id || 'anonymous';
    const vectorStoreId = req.session?.vectorStoreId || null;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    const tools = vectorStoreId ? [{ type: 'file_search' }] : undefined;
    const tool_resources = vectorStoreId
      ? { file_search: { vector_store_ids: [vectorStoreId] } }
      : undefined;

    const ai = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      input: [{ role: 'user', content: text }],
      ...(tools && { tools }),
      ...(tool_resources && { tool_resources }),
      metadata: { route: 'sdk.message', userId },
    });

    const out =
      ai.output_text ??
      ai.output?.[0]?.content?.[0]?.text ??
      '(no text output)';

    return res.json({ ok: true, text: out });
  } catch (err) {
    console.error('sdk.message error', err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
};

module.exports = { sdkMessage };
