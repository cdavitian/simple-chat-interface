const { openai } = require('../lib/openai');
const { ThreadService } = require('../services/thread.service');
const { AttachmentService } = require('../services/attachment.service');

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
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      conversation: conversationId || undefined,
      tools: [{ type: 'file_search' }],               // declare the tool
      ...(vectorStoreId ? {
        tool_resources: {                              // attach the resources
          file_search: { vector_store_ids: [vectorStoreId] }
        }
      } : {}),
      input,
    });

    const responseId = response?.id || null;
    const textOut = typeof response?.output_text === 'string' ? response.output_text : '';

    return res.json({
      success: true,
      conversationId: conversationId || null,
      responseId,
      // Keep raw text for backward compatibility
      text: textOut,
      // Provide a UI-friendly message wrapper
      message: {
        id: responseId,
        role: 'assistant',
        text: textOut,
        createdAt: new Date().toISOString(),
      },
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

