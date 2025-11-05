const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const sdkMessage = async (req, res) => {
  try {
    const { text, staged_file_ids = [] } = req.body || {};
    const userId = req.session?.user?.id || 'anonymous';
    const vectorStoreId = req.session?.vectorStoreId || null;

    if ((!text || typeof text !== 'string') && staged_file_ids.length === 0) {
      return res.status(400).json({ error: 'Missing text or files' });
    }

    // Build content parts for Responses API
    const content = [];
    if (text) content.push({ type: 'input_text', text });
    for (const file_id of staged_file_ids) {
      content.push({ type: 'input_file', file_id });
    }

    const ai = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      input: [{ role: 'user', content }],
      tools: [{ type: 'file_search' }],
      // If you tie File Search to a vector store, include this:
      // ...(vectorStoreId
      //   ? { tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } } }
      //   : {}),
      metadata: { route: 'sdk.message', userId },
    });

    const out = ai.output_text ?? ai.output?.[0]?.content?.[0]?.text?.value ?? '';

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
