// routes/sdk.message.js
const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports.sdkMessage = async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    // 1) Append user turn to session transcript
    req.session.sdkTranscript = Array.isArray(req.session.sdkTranscript) ? req.session.sdkTranscript : [];
    req.session.sdkTranscript.push({ role: 'user', content: text });

    // 2) Optional: limit turns (e.g., last 20 messages)
    const MAX_TURNS = 20;
    const window = req.session.sdkTranscript.slice(-MAX_TURNS);

    // 3) Call Responses API with the full context window
    const ai = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      input: window, // full history
      metadata: { route: 'sdk.message' }
    });

    // 4) Normalize assistant text
    const messageText =
      ai.output_text ||
      ai?.output?.[0]?.content?.[0]?.text ||
      ai?.response?.output_text ||
      '';

    // 5) Append assistant turn to transcript and persist session
    req.session.sdkTranscript.push({ role: 'assistant', content: messageText });
    await new Promise(resolve => req.session.save(resolve));

    return res.json({
      success: true,
      response_id: ai.id || null,
      text: messageText
    });
  } catch (err) {
    console.error('sdk.message error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
};