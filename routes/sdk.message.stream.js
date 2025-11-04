const { openai } = require('../lib/openai');
const { ThreadService } = require('../services/thread.service');
const { AttachmentService } = require('../services/attachment.service');

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function sdkMessageStream(req, res) {
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const stagedFileIds = Array.isArray(body.staged_file_ids) ? body.staged_file_ids : [];
  const userId = req.session?.user?.id || 'anonymous';
  const threadId = body.thread_id || `sdk:${userId}`;

  if (!text && stagedFileIds.length === 0) {
    return res.status(400).json({ error: 'No text or files provided' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let stream;

  try {
    const thread = await ThreadService.ensureThread({ threadId, userId });

    if (stagedFileIds.length > 0) {
      await AttachmentService.addFiles({
        vectorStoreId: thread.vector_store_id,
        fileIds: stagedFileIds,
      });
    }

    const tools = [{ type: 'file_search' }];
    if (stagedFileIds.length > 0) {
      tools.push({ type: 'code_interpreter' });
    }

    const baseRequest = {
      model: process.env.OPENAI_MODEL || 'gpt-5',
      input: [
        {
          role: 'user',
          content: text || 'Please review the uploaded files.',
        },
      ],
      tools,
    };

    if (thread.conversation_id) {
      baseRequest.conversation = thread.conversation_id;
    }

    if (openai?.responses?.stream?.create) {
      stream = await openai.responses.stream.create(baseRequest);
    } else if (typeof openai?.responses?.stream === 'function') {
      stream = await openai.responses.stream(baseRequest);
    } else {
      throw new Error('OpenAI client does not support streaming responses');
    }

    let capturedConversationId = thread.conversation_id || null;

    for await (const event of stream) {
      const maybeConversationId = event?.response?.conversation_id || event?.conversation_id;

      if (!capturedConversationId && maybeConversationId) {
        capturedConversationId = maybeConversationId;
        await ThreadService.setConversationId(thread.id, capturedConversationId);
      }

      if (event?.type === 'response.output_text.delta') {
        const delta = typeof event.delta === 'string'
          ? event.delta
          : event.delta?.text ?? event.delta?.value ?? '';
        if (delta) {
          sendEvent(res, 'token', { text: delta });
        }
      }

      if (event?.type === 'response.completed') {
        const finalText = event?.response?.output_text || '';
        sendEvent(res, 'final', { text: finalText, conversationId: capturedConversationId });
      }

      if (typeof event?.type === 'string' && event.type.startsWith('response.tool')) {
        sendEvent(res, 'tool', event);
      }
    }

    sendEvent(res, 'done', {});
    res.end();
  } catch (error) {
    console.error('sdk.message.stream error:', error);
    sendEvent(res, 'error', { message: error?.message || 'stream_error' });
    res.end();
    await stream?.controller?.abort?.();
  }

  req.on('close', async () => {
    await stream?.controller?.abort?.();
  });
}

module.exports = {
  sdkMessageStream,
};

