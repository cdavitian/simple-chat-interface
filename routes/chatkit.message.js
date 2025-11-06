const { v4: uuid } = require('uuid');
const { openai } = require('../lib/openai');
const { ThreadService } = require('../services/thread.service');
const { AttachmentService } = require('../services/attachment.service');

async function chatkitMessage(req, res) {
  const body = req.body || {};
  const userId = req.session?.user?.id || 'anonymous';

  const sessionId = body.session_id ?? req.session?.chatkitSessionId ?? null;
  const threadId = sessionId || `thread:${userId}`;

  const text = typeof body.text === 'string' ? body.text.trim() : '';

  const stagedFileIds = Array.isArray(body.staged_file_ids) ? body.staged_file_ids : [];
  const stagedFiles = Array.isArray(body.staged_files) ? body.staged_files : [];
  const legacyFileId = typeof body.file_id === 'string' ? body.file_id : null;

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
  if (legacyFileId && legacyFileId.trim()) {
    allFileIds.add(legacyFileId.trim());
  }

  if (!text && allFileIds.size === 0) {
    return res.status(400).json({ error: 'Missing text or files' });
  }

  try {
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing chatkit session' });
    }

    const thread = await ThreadService.ensureThread({
      threadId,
      userId,
      sessionId,
    });

    const fileIdList = Array.from(allFileIds);

    if (fileIdList.length > 0) {
      // Prefer the session-bound vector store so ChatKit retrieval sees new files
      const sessionVectorStoreId = req.session?.vectorStoreId || null;
      const targetVectorStoreId = sessionVectorStoreId || thread.vector_store_id || process.env.VECTOR_STORE_ID || null;
      if (!targetVectorStoreId) {
        return res.status(500).json({ error: 'No vector store available to attach files' });
      }

      await AttachmentService.addFiles({
        vectorStoreId: targetVectorStoreId,
        fileIds: fileIdList,
      });
    }

    const inputMessages = [];
    if (text) {
      inputMessages.push({ role: 'user', content: text });
    } else {
      inputMessages.push({ role: 'user', content: 'Please review the uploaded files.' });
    }

    const response = await openai.beta.chatkit.sessions.responses.create({
      session_id: sessionId,
      input: inputMessages,
      // NOTE: do not pass tool_resources; retrieval uses the bound vector store
    });

    const responseId = response?.id || uuid();
    const messageId = uuid();

    const out = response.output_text ?? response.output?.[0]?.content?.[0]?.text?.value ?? '';

    return res.json({
      success: true,
      message_id: messageId,
      response_id: responseId,
      text: out,
    });
  } catch (error) {
    console.error('chatkit.message error:', error);
    return res.status(500).json({
      error: error?.message || 'server_error',
    });
  }
}

module.exports = {
  chatkitMessage,
};

