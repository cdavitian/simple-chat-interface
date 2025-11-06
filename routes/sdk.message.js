// routes/sdk.message.js
const OpenAI = require("openai");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports.sdkMessage = async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing text" });
    }

    const ai = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5",
      input: [{ role: "user", content: text }],
      // IMPORTANT: no tools, no tool_resources here
      metadata: { route: "sdk.message" },
    });

    const out = ai.output_text ?? ai.output?.[0]?.content?.[0]?.text?.value ?? "";
    return res.json({
      success: true,
      response_id: ai.id,
      text: out,
      message: { id: ai.id, role: "assistant", text: out, createdAt: new Date().toISOString() },
      usage: ai?.usage || null,
    });
  } catch (err) {
    console.error("[/api/sdk/message] ERROR:", err?.stack || err);
    return res.status(err?.status || 500).json({ error: err?.message || String(err) });
  }
};