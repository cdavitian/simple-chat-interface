const { openai } = require('../lib/openai');
const { ThreadService } = require('../services/thread.service');
const { AttachmentService } = require('../services/attachment.service');

async function sdkMessage(req, res) {
  const body = req.body || {};
  const userId = req.session?.user?.id || 'anonymous';
  const threadId = body.thread_id || `sdk:${userId}`;

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const stagedFileIds = Array.isArray(body.staged_file_ids) ? body.staged_file_ids : [];
  const stagedFiles = Array.isArray(body.staged_files) ? body.staged_files : [];

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

    // Build input; attach files at top-level per Responses API
    const input = [{
      role: 'user',
      content: [{ type: 'input_text', text: text || 'Please review the uploaded files.' }],
    }];
    const attachments = fileIdList.map((id) => ({ file_id: id, tools: [{ type: 'file_search' }] }));

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      conversation: conversationId || undefined,
      attachments,
      input,
    });

    const responseId = response?.id || null;
    const textOut = typeof response?.output_text === 'string' ? response.output_text : '';

    return res.json({
      success: true,
      conversationId: conversationId || null,
      responseId,
      text: textOut,
      usage: response?.usage || null,
    });
  } catch (error) {
    console.error('sdk.message error:', error);
    return res.status(500).json({
      error: error?.message || 'server_error',
    });
  }
}

module.exports = {
  sdkMessage,
};

