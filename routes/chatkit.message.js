const OpenAI = require("openai");
const { openai } = require('../lib/openai');

// Helper to get the files client regardless of API surface
function getVectorStoreFilesClient() {
  if (openai?.vectorStores?.files?.list) return openai.vectorStores.files;
  if (openai?.beta?.vectorStores?.files?.list) return openai.beta.vectorStores.files;
  const direct = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return direct.vectorStores.files;
}

// Helper to list all file ids in a vector store (handles pagination)
async function listVectorStoreFileIds(vectorStoreId) {
  if (!vectorStoreId) return [];
  const filesClient = getVectorStoreFilesClient();
  const ids = [];
  let cursor = undefined;
  do {
    const page = await filesClient.list({
      vector_store_id: vectorStoreId,
      limit: 100,
      after: cursor,
    });
    const data = Array.isArray(page?.data) ? page.data : [];
    ids.push(...data.map(f => f.id));
    cursor = page?.has_more ? page.last_id : undefined;
  } while (cursor);
  return ids;
}

module.exports.chatkitMessage = async (req, res) => {
  try {
    const { text } = req.body || {};
    const sessionId = req.session?.chatkitSessionId;
    const vectorStoreId = req.session?.vectorStoreId;

    if (!text || !sessionId) {
      return res.status(400).json({ error: "Missing text or session" });
    }

    // Get file_ids from the active vector store (if any)
    const fileIds = await listVectorStoreFileIds(vectorStoreId);
    const attachments = fileIds.map(id => ({ file_id: id }));

    // Send the message through ChatKit; attach files if present
    const payload = {
      session_id: sessionId,
      input: [{ role: "user", content: text }],
      ...(attachments.length ? { attachments } : {}),
    };

    // Also bind the vector store at response-time so the workflow's File Search can use it
    if (vectorStoreId) {
      payload.tool_resources = {
        file_search: { vector_store_ids: [vectorStoreId] },
      };
    }

    const reply = await openai.beta.chatkit.sessions.responses.create(payload);

    const out =
      reply.output_text ??
      reply.output?.[0]?.content?.[0]?.text?.value ??
      "";

    return res.json({ success: true, text: out, response_id: reply.id });
  } catch (err) {
    console.error("[/api/chatkit/message] ERROR:", err?.stack || err);
    return res.status(err?.status || 500).json({
      error: err?.error?.message || err?.message || "chatkit_message_error",
    });
  }
};

