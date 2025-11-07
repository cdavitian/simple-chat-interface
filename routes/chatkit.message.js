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
    const { text, staged_file_ids, staged_files } = req.body || {};
    const sessionId = req.session?.chatkitSessionId;
    // We will attach files directly by file_id instead of using vector store ids

    if (!text || !sessionId) {
      return res.status(400).json({ error: "Missing text or session" });
    }

    // Build attachments with tool permissions per file
    // Prefer client-provided staged_files (includes metadata/category) to choose tools
    const filesWithMeta = Array.isArray(staged_files) ? staged_files : [];
    let attachments = [];

    if (filesWithMeta.length > 0) {
      attachments = filesWithMeta
        .filter(f => f && typeof f.file_id === 'string' && f.file_id)
        .map(f => {
          const categoryRaw = (f.category || f.file_category || '').toString();
          const category = categoryRaw.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          const tools = category === 'code_interpreter'
            ? [{ type: 'code_interpreter' }]
            : [{ type: 'file_search' }];
          return { file_id: f.file_id, tools };
        });
    } else {
      // Fallback: if only file ids were provided, default to file_search
      const fileIds = Array.isArray(staged_file_ids) ? staged_file_ids : [];
      attachments = fileIds.map(id => ({ file_id: id, tools: [{ type: 'file_search' }] }));
    }

    // Send the message through ChatKit; attach files if present
    const payload = {
      session_id: sessionId,
      input: [{ role: "user", content: text }],
      ...(attachments.length ? { attachments } : {}),
    };

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

