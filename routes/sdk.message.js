// routes/sdk.message.js
const OpenAI = require("openai");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// safe sanity logs (no package.json import)
console.log("Has Responses API? ", typeof client.responses?.create === "function");

module.exports.sdkMessage = async (req, res) => {
  try {
    // 1) inputs
    const { text } = req.body || {};
    const userId = req.session?.user?.id;
    const vectorStoreId = req.session?.vectorStoreId;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing text" });
    }

    console.log("Vector store bound:", vectorStoreId);
    console.log("Using File Search tools:", !!vectorStoreId);

    // 2) call Responses API (use 'ai' to avoid shadowing Express 'res')
    const ai = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5",
      input: [{ role: "user", content: text }],
      tools: [{ type: "file_search" }],
      ...(vectorStoreId
        ? { tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } } }
        : {}),
      metadata: { route: "sdk.message", userId },
    },
    { headers: { "OpenAI-Version": "2023-12-01" } } // <-- per-call override
  );

    // 3) normalize output
    const out =
      ai.output_text ??
      ai.output?.[0]?.content?.[0]?.text?.value ??
      "";

    return res.json({
      success: true,
      response_id: ai.id,
      text: out,
      message: {
        id: ai.id,
        role: "assistant",
        text: out,
        createdAt: new Date().toISOString(),
      },
      usage: ai?.usage || null,
    });
  } catch (err) {
    console.error("[/api/sdk/message] ERROR:", err?.stack || err);
    const status = err?.status || 500;
    return res.status(status).json({
      error: err?.error?.message || err?.message || String(err),
      requestId: err?.request_id || err?.requestId,
    });
  }
};
