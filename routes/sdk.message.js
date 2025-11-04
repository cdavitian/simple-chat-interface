const { v4: uuid } = require('uuid');
const { openai } = require('../lib/openai');
const { ThreadService } = require('../services/thread.service');
const { AttachmentService } = require('../services/attachment.service');
const { buildResources } = require('../services/toolResourceMapper');

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

    const inputMessages = [];
    if (text) {
      inputMessages.push({ role: 'user', content: text });
    } else {
      inputMessages.push({ role: 'user', content: 'Please review the uploaded files.' });
    }

    const tools = [{ type: 'file_search' }];
    if (fileIdList.length > 0) {
      tools.push({ type: 'code_interpreter' });
    }

    const resources = buildResources({
      vectorStoreId: thread.vector_store_id,
      codeInterpreterFileIds: fileIdList.length > 0 ? fileIdList : undefined,
    });

    const baseRequest = {
      model: process.env.OPENAI_MODEL || 'gpt-5',
      input: inputMessages,
      tools,
      ...resources,
    };

    if (thread.conversation_id) {
      baseRequest.conversation = thread.conversation_id;
    }

    const response = await openai.responses.create(baseRequest);

    const conversationId = response?.conversation_id || thread.conversation_id || null;

    if (!thread.conversation_id && conversationId) {
      await ThreadService.setConversationId(thread.id, conversationId);
    }

    let finalText = null;
    if (typeof response?.output_text === 'string') {
      finalText = response.output_text;
    } else if (Array.isArray(response?.output)) {
      for (const item of response.output) {
        if (Array.isArray(item?.content)) {
          for (const contentItem of item.content) {
            if (typeof contentItem?.text === 'string' && contentItem.text) {
              finalText = contentItem.text;
              break;
            }
            if (contentItem?.text?.value) {
              finalText = contentItem.text.value;
              break;
            }
          }
        }
        if (finalText) {
          break;
        }
      }
    }

    const now = new Date().toISOString();
    const conversation = [];

    if (text) {
      conversation.push({
        id: uuid(),
        role: 'user',
        content: text,
        createdAt: now,
      });
    }

    if (finalText) {
      conversation.push({
        id: uuid(),
        role: 'assistant',
        content: finalText,
        createdAt: now,
      });
    }

    return res.json({
      conversation,
      final_output: finalText,
      guardrail_results: response?.guardrails || null,
      usage: response?.usage || null,
      conversationId,
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

