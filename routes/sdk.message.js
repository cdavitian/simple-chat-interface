const { openai } = require('../lib/openai');
const { ThreadService } = require('../services/thread.service');
const { AttachmentService } = require('../services/attachment.service');


console.log("Has responses API? ", typeof openai.responses?.create === "function");

console.log("Has chat.completions? ", !!openai.chat?.completions);

async function sdkMessage(req, res) {
  console.log('🚀 SDK MESSAGE: Request received');
  const body = req.body || {};
  const userId = req.session?.user?.id || 'anonymous';
  const threadId = body.thread_id || `sdk:${userId}`;

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const stagedFileIds = Array.isArray(body.staged_file_ids) ? body.staged_file_ids : [];
  const stagedFiles = Array.isArray(body.staged_files) ? body.staged_files : [];
  
  console.log(`📝 SDK MESSAGE: text="${text.substring(0, 50)}", user=${userId}`);

  const allFileIds = new Set();

  stagedFileIds.forEach((id) => {
    if (typeof id === 'string' && id.trim()) {
      allFileIds.add(id.trim());
    }
  });

  stagedFiles.forEach((file) => {
    if (file && typeof file.file_id === 'string' && file.file_id.trim()) {
      allFileIds.add(file.file_id.trim());
    }
  });

  if (!text && allFileIds.size === 0) {
    return res.status(400).json({ error: 'No text or staged files provided' });
  }

  try {
    const thread = await ThreadService.ensureThread({ threadId, userId });

    const fileIdList = Array.from(allFileIds);

    if (fileIdList.length > 0) {
      await AttachmentService.addFiles({
        vectorStoreId: thread.vector_store_id,
        fileIds: fileIdList,
      });
    }

    // Ensure a conversation exists before sending
    let conversationId = thread.conversation_id || null;
    if (!conversationId) {
      const conv = await openai.conversations.create();
      conversationId = conv?.id || null;
      if (conversationId) {
        await ThreadService.setConversationId(thread.id, conversationId);
      }
    }

    // Build input only; no attachments. We bind File Search via vector_store_ids at top level.
    const input = [{
      role: 'user',
      content: [{ type: 'input_text', text: text || 'Please review the uploaded files.' }],
    }];

    const vectorStoreId = thread?.vector_store_id; // or a value from req.body if you allow overrides

        // routes/sdk.message.js

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

    // 2) call Responses API (use 'ai' to avoid shadowing Express 'res')
    const ai = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5",
      input: [{ role: "user", content: text }],
      tools: [{ type: "file_search" }],
      ...(vectorStoreId
        ? { tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } } }
        : {}),
      metadata: { route: "sdk.message", userId },
    });

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


module.exports = {
  sdkMessage,
};

