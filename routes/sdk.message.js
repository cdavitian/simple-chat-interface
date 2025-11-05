const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Safe sanity log
console.log('Has Responses API? ', typeof client.responses?.create === 'function');

const sdkMessage = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.session?.user?.id || 'anonymous';
    const vectorStoreId = req.session?.vectorStoreId || null;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    const ai = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      input: [{ role: 'user', content: text }],
      tools: [{ type: 'file_search' }],
      ...(vectorStoreId
        ? { tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } } }
        : {}),
      metadata: { route: 'sdk.message', userId },
    });

    const out =
      ai.output_text ??
      ai.output?.[0]?.content?.[0]?.text?.value ??
      '';

    return res.json({
      success: true,
      response_id: ai.id,
      text: out,
      message: {
        id: ai.id,
        role: 'assistant',
        text: out,
        createdAt: new Date().toISOString(),
      },
      usage: ai?.usage || null,
    });
  } catch (err) {
    console.error('[/api/sdk/message] ERROR:', err?.stack || err);
    const status = err?.status || 500;
    return res.status(status).json({
      error: err?.error?.message || err?.message || String(err),
      requestId: err?.request_id || err?.requestId,
    });
  }
};

module.exports = { sdkMessage };

