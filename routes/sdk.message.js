// routes/sdk.message.js
const { openai } = require('../lib/openai');
const { ThreadService } = require('../services/thread.service');
const { AttachmentService } = require('../services/attachment.service');

const ASSISTANT_ID = process.env.ASSISTANT_ID; // e.g., "asst_abc123"
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5';

function buildToolResources(vectorStoreId) {
  if (!vectorStoreId) return undefined;
  return { file_search: { vector_store_ids: [vectorStoreId] } };
}

async function waitForRunCompletion(threadId, runId, { timeoutMs = 60000, pollMs = 400 } = {}) {
  const start = Date.now();
  for (;;) {
    const run = await openai.beta.threads.runs.retrieve(threadId, runId);
    const s = run.status;
    if (s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'expired') return run;
    if (s === 'requires_action') {
      throw new Error('Run requires action (tool calls) but no handler is implemented.');
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Run polling timed out after ${timeoutMs}ms (status: ${s})`);
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

function extractAssistantText(msg) {
  if (!msg?.content) return '';
  const parts = Array.isArray(msg.content) ? msg.content : [msg.content];
  const out = [];
  for (const p of parts) {
    if (p?.type === 'output_text' && typeof p.text === 'string') out.push(p.text);
    else if (p?.type === 'text' && p.text?.value) out.push(p.text.value);
    else if (typeof p === 'string') out.push(p);
  }
  return out.join('\n').trim();
}

module.exports.sdkMessage = async (req, res) => {
  try {
    const { text, staged_file_ids } = req.body || {};
    if ((!text || typeof text !== 'string') && !Array.isArray(staged_file_ids)) {
      return res.status(400).json({ error: 'Missing text' });
    }

    const userId = req.session?.user?.id || 'anonymous';

    // Ensure or create per-user SDK thread record with a vector store we can add files to
    // We intentionally separate this from OpenAI Threads API "threadId" used below
    const sdkThreadId = `sdk:${userId}`;
    const sdkThread = await ThreadService.ensureThread({ threadId: sdkThreadId, userId });
    const vectorStoreId = sdkThread.vector_store_id || null;

    // Ensure session containers
    req.session.sdkTranscript = Array.isArray(req.session.sdkTranscript)
      ? req.session.sdkTranscript
      : [];
    req.session.sdkConversation = Array.isArray(req.session.sdkConversation)
      ? req.session.sdkConversation
      : [];
    req.session.chatHistory ||= [];

    // If files were staged on the client, attach them to the vector store now
    const fileIds = Array.isArray(staged_file_ids) ? staged_file_ids.filter(id => typeof id === 'string' && id) : [];
    if (fileIds.length > 0 && vectorStoreId) {
      try {
        const results = await AttachmentService.addFiles({ vectorStoreId, fileIds });
        const failed = results.filter(r => !r.ok);
        if (failed.length) {
          console.warn('[sdk.message] Some files failed indexing:', failed);
        }
      } catch (attachErr) {
        console.warn('[sdk.message] Failed to add files to vector store:', attachErr?.message || attachErr);
      }
    }

    // Track user message in session (include note if no text but only files)
    const createdAtIso = new Date().toISOString();
    if (text && typeof text === 'string') {
      const userMessage = {
        id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        createdAt: createdAtIso,
        content: [{ type: 'input_text', text }],
      };
      req.session.sdkTranscript.push({ role: 'user', content: text });
      req.session.sdkConversation.push(userMessage);
      req.session.chatHistory.push({ role: 'user', content: [{ type: 'input_text', text }] });
    } else if (fileIds.length > 0) {
      const notice = '(Files uploaded — no text)';
      const userMessage = {
        id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        createdAt: createdAtIso,
        content: [{ type: 'input_text', text: notice }],
      };
      req.session.sdkTranscript.push({ role: 'user', content: notice });
      req.session.sdkConversation.push(userMessage);
      req.session.chatHistory.push({ role: 'user', content: [{ type: 'input_text', text: notice }] });
    }

    // Ensure/create thread; replace if vector store changed
    let threadId = req.session?.threadId || null;
    const currentVsForThread = req.session?.threadVectorStoreId || null;
    const needsNewThread = !threadId || currentVsForThread !== vectorStoreId;

    if (needsNewThread) {
      const payload = { metadata: { userId, route: 'sdk.message' } };
      const tr = buildToolResources(vectorStoreId);
      if (tr) payload.tool_resources = tr;
      const thread = await openai.beta.threads.create(payload);
      threadId = thread.id;
      req.session.threadId = threadId;
      req.session.threadVectorStoreId = vectorStoreId || null;
      if (typeof req.session.save === 'function') {
        await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));
      }
    }

    // Add the user message to the OpenAI thread (Threads prefers a string content)
    // If no text is provided but files were uploaded, prompt the model to review the files
    const messageText = (text && typeof text === 'string' && text.trim())
      ? text
      : (fileIds.length > 0 ? 'Please review the uploaded files.' : '');

    if (!messageText) {
      return res.status(400).json({ error: 'No text or files provided' });
    }

    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: messageText,
    });

    // Create a run
    let run;
    if (ASSISTANT_ID) {
      run = await openai.beta.threads.runs.create(threadId, { assistant_id: ASSISTANT_ID });
    } else {
      // Build tools and bind vector store when available
      const tools = [];
      if (vectorStoreId) {
        tools.push({ type: 'file_search' });
      }
      if (fileIds.length > 0) {
        // Optionally include code_interpreter when files are present
        tools.push({ type: 'code_interpreter' });
      }

      const runRequest = {
        model: DEFAULT_MODEL,
        ...(tools.length ? { tools } : {}),
        ...(vectorStoreId ? { tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } } } : {}),
      };

      run = await openai.beta.threads.runs.create(threadId, runRequest);
    }

    // Poll until complete
    const finalRun = await waitForRunCompletion(threadId, run.id);
    if (finalRun.status !== 'completed') {
      return res.status(500).json({
        error: `Run did not complete: ${finalRun.status}`,
        thread_id: threadId,
        run_id: run.id,
      });
    }

    // Read the latest assistant message
    const list = await openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 6 });
    const latestAssistant = list.data.find(m => m.role === 'assistant') || list.data?.[0];
    const output_text = extractAssistantText(latestAssistant);

    // Track assistant message in session
    const createdAt =
      latestAssistant?.created_at
        ? new Date(latestAssistant.created_at * 1000).toISOString()
        : new Date().toISOString();
    const assistantMessage = {
      id: latestAssistant?.id || `asst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      createdAt,
      content: [{ type: 'output_text', text: output_text }],
    };
    req.session.sdkTranscript.push({ role: 'assistant', content: output_text });
    req.session.sdkConversation.push(assistantMessage);
    req.session.chatHistory.push({
      role: 'assistant',
      content: [{ type: 'output_text', text: output_text }],
    });

    if (typeof req.session.save === 'function') {
      await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));
    }

    // Backward-compatible response payload
    return res.json({
      success: true,
      thread_id: threadId,
      run_id: run.id,
      text: output_text,
      output_text,
      responseId: run.id,
      message: {
        id: assistantMessage.id,
        role: 'assistant',
        text: output_text,
        createdAt,
      },
      conversation: req.session.sdkConversation,
    });
  } catch (err) {
    console.error('sdkMessage error:', err);
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
};