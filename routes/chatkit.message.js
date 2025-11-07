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

    // Collect candidate file ids: client-provided + any unsent from the session
    const clientFileIds = Array.isArray(staged_file_ids) ? staged_file_ids : [];
    const sessionUnsent = Array.isArray(req.session?.unsentFileIds) ? req.session.unsentFileIds : [];
    const allCandidateIds = Array.from(new Set([ ...clientFileIds, ...sessionUnsent ]));

    // Build attachments with tool permissions per file
    // Prefer client-provided staged_files (includes metadata/category) to choose tools
    const filesWithMeta = Array.isArray(staged_files) ? staged_files : [];
    const metaById = new Map(filesWithMeta
      .filter(f => f && typeof f.file_id === 'string' && f.file_id)
      .map(f => [f.file_id, f]));

    let attachments = [];

    attachments = allCandidateIds.map(id => {
      const f = metaById.get(id) || {};
      const categoryRaw = (f.category || f.file_category || '').toString();
      const category = categoryRaw.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const tools = category === 'code_interpreter'
        ? [{ type: 'code_interpreter' }]
        : [{ type: 'file_search' }];
      return { file_id: id, tools };
    });

    // Build tools set based on attachments
    const toolTypes = new Set();
    for (const att of attachments) {
      for (const t of att.tools || []) {
        if (t?.type) toolTypes.add(t.type);
      }
    }
    const tools = Array.from(toolTypes).map(type => ({ type }));

    // Build input message with inlined attachments (preferred shape for ChatKit)
    const inputMessage = {
      role: "user",
      content: text,
      ...(attachments.length
        ? {
            attachments: attachments.map(a => ({
              file_id: a.file_id,
              tools: Array.isArray(a.tools) && a.tools.length ? a.tools : [{ type: "file_search" }],
            })),
          }
        : {}),
    };

    // Send the message through ChatKit with per-message attachments
    const payload = {
      session_id: sessionId,
      ...(tools.length ? { tools } : {}),
      input: [inputMessage],
    };

    // Log the payload being sent to OpenAI (for debugging)
    console.log('[chatkit.message] 📤 Sending to OpenAI ChatKit API:');
    console.log('[chatkit.message] 📤 Session ID:', sessionId);
    console.log('[chatkit.message] 📤 File IDs in attachments:', attachments.map(a => a.file_id));
    console.log('[chatkit.message] 📤 Tools:', tools);
    console.log('[chatkit.message] 📤 Input message:', JSON.stringify(inputMessage, null, 2));

    const reply = await openai.beta.chatkit.sessions.responses.create(payload);

    // Mark any session-tracked unsent file ids that were included as sent now
    try {
      if (Array.isArray(req.session.unsentFileIds)) {
        const sentIds = new Set(allCandidateIds);
        req.session.unsentFileIds = req.session.unsentFileIds.filter(id => !sentIds.has(id));
      }
      if (!Array.isArray(req.session.sentFileIds)) req.session.sentFileIds = [];
      req.session.sentFileIds = Array.from(new Set([ ...req.session.sentFileIds, ...allCandidateIds ]));
      if (typeof req.session.save === 'function') {
        await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));
      }
    } catch (trackErr) {
      console.warn('[chatkit.message] Failed to update sent/unsent file tracking:', trackErr?.message);
    }

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

