// routes/sdk.message.js
const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports.sdkMessage = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.session?.user?.id || 'anonymous';
    const vectorStoreId = req.session?.boundVectorStoreId || req.session?.vectorStoreId || null;
     // --- Initialize or update simple session memory ---
    req.session.chatHistory ||= [];
    // Add the new user message
    req.session.chatHistory.push({
      role: "user",
      content: [{ type: "input_text", text }],
    });
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    // Ensure conversation arrays exist
    req.session.sdkConversation = Array.isArray(req.session.sdkConversation) ? req.session.sdkConversation : [];
    // 1) Append user turn to session transcript (legacy)
    req.session.sdkTranscript = Array.isArray(req.session.sdkTranscript) ? req.session.sdkTranscript : [];
    req.session.sdkTranscript.push({ role: 'user', content: text });

    // Also append a normalized user message for the new React UI
    const userMessage = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      createdAt: new Date().toISOString(),
      content: [{ type: 'input_text', text }],
    };
    req.session.sdkConversation.push(userMessage);

    // 2) Optional: limit turns (e.g., last 20 messages)
    const MAX_TURNS = 20;
    const window = req.session.sdkTranscript.slice(-MAX_TURNS);

    // 3) Call Responses API with the full context window
    const ai = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      tools: [{ type: 'file_search' }],
      tool_resources: vectorStoreId
             ? { file_search: { vector_store_ids: [vectorStoreId] } }
             : undefined,
             input: req.session.chatHistory,
      metadata: { route: 'sdk.message', userId }
    });
     // --- Capture assistant reply into session history ---
    if (ai.output_text) {
        req.session.chatHistory.push({
          role: "assistant",
          content: [{ type: "output_text", text: ai.output_text }],
        });
      }

    // 4) Normalize assistant text
    const messageText =
      ai.output_text ||
      ai?.output?.[0]?.content?.[0]?.text ||
      ai?.response?.output_text ||
      '';

    // 5) Append assistant turn to transcript and persist session
    req.session.sdkTranscript.push({ role: 'assistant', content: messageText });

    // Append normalized assistant message for the new React UI
    const assistantMessage = {
      id: `asst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      createdAt: new Date().toISOString(),
      content: [{ type: 'output_text', text: messageText }],
    };
    req.session.sdkConversation.push(assistantMessage);

    await new Promise(resolve => req.session.save(resolve));

    return res.json({
      success: true,
      response_id: ai.id || null,
      text: messageText,
      conversation: req.session.sdkConversation,
    });
  } catch (err) {
    console.error('sdk.message error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
};