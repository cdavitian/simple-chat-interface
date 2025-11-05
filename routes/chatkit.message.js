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
    const thread = await ThreadService.ensureThread({
      threadId,
      userId,
      sessionId,
    });

    const fileIdList = Array.from(allFileIds);

    if (fileIdList.length > 0) {
      await AttachmentService.addFiles({
        vectorStoreId: thread.vector_store_id,
        fileIds: fileIdList,
      });
    }

    const inputMessages = [];
    if (text) {
      inputMessages.push({ role: 'user', content: text });
    } else {
      inputMessages.push({ role: 'user', content: 'Please review the uploaded files.' });
    }

    const vectorStoreId = thread.vector_store_id || process.env.VECTOR_STORE_ID || null;
    const tools = [];
    if (vectorStoreId) {
      tools.push({ type: 'file_search', vector_store_ids: [vectorStoreId] });
    }
    if (fileIdList.length > 0) {
      tools.push({ type: 'code_interpreter' });
    }

    const baseRequest = {
      model: process.env.OPENAI_MODEL || 'gpt-5',
      input: inputMessages,
      tools,
    };

    if (thread.conversation_id) {
      baseRequest.conversation = thread.conversation_id;
    }

    const response = await openai.responses.create(baseRequest);

    const conversationId = response?.conversation_id || thread.conversation_id || null;

    if (!thread.conversation_id && conversationId) {
      await ThreadService.setConversationId(thread.id, conversationId);
    }

    const responseId = response?.id || uuid();
    const messageId = uuid();

    return res.json({
      success: true,
      message_id: messageId,
      response_id: responseId,
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

