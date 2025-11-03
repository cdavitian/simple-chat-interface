const {
  Agent,
  Runner,
  withTrace,
  codeInterpreterTool,
  hostedMcpTool,
} = require('@openai/agents');
const { OpenAI } = require('openai');
const { runGuardrails } = require('@openai/guardrails');

// Try to import fileSearchTool from @openai/agents-openai
let fileSearchTool = null;
try {
  const { fileSearchTool: fileSearchToolImport } = require('@openai/agents-openai');
  fileSearchTool = fileSearchToolImport;
} catch (e) {
  console.warn('@openai/agents-openai not available, file_search will not be enabled:', e?.message);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const guardrailsConfig = {
  guardrails: [],
};

const context = { guardrailLlm: client };

function guardrailsHasTripwire(results) {
  return (results ?? []).some((r) => r?.tripwireTriggered === true);
}

function getGuardrailSafeText(results, fallbackText) {
  for (const r of results ?? []) {
    if (r?.info && 'checked_text' in r.info) {
      return r.info.checked_text ?? fallbackText;
    }
  }

  const pii = (results ?? []).find((r) => r?.info && 'anonymized_text' in r.info);
  return pii?.info?.anonymized_text ?? fallbackText;
}

const codeInterpreter = codeInterpreterTool({
  container: {
    type: 'auto',
  },
});

function createHostedMcpTool() {
  const serverLabel = process.env.MCP_SERVER_LABEL || 'Kyo_MCP_Prod';
  const serverUrl = process.env.MCP_SERVER_URL || 'https://kyo-mcp.kyocare.com';
  const authorization = process.env.MCP_SERVER_AUTHORIZATION;

  if (!authorization) {
    return null;
  }

  let allowedTools;
  if (process.env.MCP_SERVER_ALLOWED_TOOLS) {
    allowedTools = process.env.MCP_SERVER_ALLOWED_TOOLS.split(',')
      .map((tool) => tool.trim())
      .filter(Boolean);
  } else {
    allowedTools = ['list-table-tool', 'read-data-tool', 'search', 'fetch'];
  }

  return hostedMcpTool({
    serverLabel,
    allowedTools,
    authorization,
    requireApproval: 'never',
    serverUrl,
  });
}

function createAgent(vectorStoreId = null) {
  const tools = [codeInterpreter];
  const hostedMcp = createHostedMcpTool();
  if (hostedMcp) {
    tools.push(hostedMcp);
  }

  // Add file search tool if vector store is provided and fileSearchTool is available
  if (vectorStoreId && fileSearchTool) {
    try {
      const fileSearch = fileSearchTool(vectorStoreId);
      tools.push(fileSearch);
      // Silent on success - only log errors
    } catch (e) {
      console.error('❌ SDK Agent: Failed to create fileSearchTool:', {
        error: e?.message,
        stack: e?.stack,
        vectorStoreId
      });
    }
  } else {
    // Only warn if vector store is missing when it should be available
    if (!vectorStoreId && process.env.OPENAI_API_KEY) {
      console.warn('⚠️ SDK Agent: No vectorStoreId provided, fileSearchTool will not be available');
    }
    // Only warn once if fileSearchTool module is missing
    if (!fileSearchTool && !global._fileSearchToolWarningLogged) {
      console.warn('⚠️ SDK Agent: fileSearchTool not available from @openai/agents-openai');
      global._fileSearchToolWarningLogged = true;
    }
  }

  return new Agent({
    name: process.env.SDK_AGENT_NAME || 'My agent',
    instructions:
      process.env.SDK_AGENT_INSTRUCTIONS || 'Allow the user to query the MCP data sources.',
    model: process.env.SDK_AGENT_MODEL || 'gpt-5',
    tools,
    modelSettings: {
      reasoning: {
        effort: 'low',
        summary: 'auto',
      },
      store: true,
    },
  });
}

async function runAgentConversation(conversationHistory, traceName = 'MCP Prod Test', vectorStoreId = null, conversationId = null) {
  if (!Array.isArray(conversationHistory)) {
    throw new Error('conversationHistory must be an array of AgentInputItem objects');
  }

  // Only log minimal info for debugging - reduce verbosity
  if (conversationHistory.length > 0 && vectorStoreId) {
    console.log('📥 Agent conversation:', {
      messages: conversationHistory.length,
      vectorStoreId,
      hasContent: !!conversationHistory[0]?.content,
      hasConversationId: !!conversationId
    });
  }

  return withTrace(traceName, async () => {
    // Create agent with vector store if provided
    const agent = createAgent(vectorStoreId);
    
    // Build Runner options - include conversation_id if provided
    // Support both spellings as SDK may accept either depending on version
    const runnerOptions = {
      store: true, // Ensure stateful storage is enabled
      traceMetadata: {
        __trace_source__: 'agent-builder',
        workflow_id:
          process.env.SDK_AGENT_WORKFLOW_ID ||
          'wf_68efcaa7b9908190bfadd0ac72ef430001c44704e294f2a0',
      },
    };
    
    // Add conversation_id/conversationId if provided (for continuing existing conversation)
    // Support both spellings for SDK compatibility
    if (conversationId) {
      runnerOptions.conversationId = conversationId;
      runnerOptions.conversation_id = conversationId;
    }
    
    // Log what we're passing to Runner
    console.info('🏃 Runner init:', { 
      conversationId: conversationId ?? 'none',
      hasStore: runnerOptions.store === true
    });
    
    const runner = new Runner(runnerOptions);

    // If we have a conversation_id, only send the latest message (SDK will pull prior context via store:true)
    // Otherwise, send full history for the first message
    // When using store:true with conversationId, SDK maintains context internally
    const messagesToSend = conversationId && conversationHistory.length > 0
      ? [conversationHistory[conversationHistory.length - 1]] // Only the latest message
      : [...conversationHistory]; // Full history for first message (or empty if no history)
    
    const result = await runner.run(agent, messagesToSend);
    
    // Log runner state after run for debugging
    if (conversationId || result) {
      console.log('🔍 Runner state after run:', {
        hasRunnerState: !!runner?.state,
        runnerStateType: runner?.state ? typeof runner.state : 'none',
        resultType: result ? typeof result : 'none',
        resultIsObject: result ? typeof result === 'object' : false,
        runnerKeys: runner ? Object.keys(runner) : [],
        resultKeys: result ? Object.keys(result) : []
      });
      
      // Try to find conversation_id in various places
      console.log('🔎 Searching for conversation_id:', {
        resultConversationId: result?.conversation_id,
        resultConversationIdCamel: result?.conversationId,
        runnerConversationId: runner?.conversation_id,
        runnerConversationIdCamel: runner?.conversationId,
        runnerState: runner?.state ? JSON.stringify(runner.state).substring(0, 200) : 'none',
        resultStringified: result ? JSON.stringify(result).substring(0, 500) : 'none'
      });
    }

    const newItems = (result?.newItems || []).map((item) => {
      const rawItem = item?.rawItem || item;
      const timestamp = rawItem?.createdAt || new Date().toISOString();
      const identifier = rawItem?.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return {
        ...rawItem,
        id: identifier,
        createdAt: timestamp,
      };
    });

    let finalOutput = result?.finalOutput ?? null;
    let guardrailResults = null;

    if (finalOutput && guardrailsConfig.guardrails.length > 0) {
      guardrailResults = await runGuardrails({
        client,
        guardrails: guardrailsConfig.guardrails,
        context,
        input: finalOutput,
      });

      if (guardrailsHasTripwire(guardrailResults?.results)) {
        finalOutput = getGuardrailSafeText(guardrailResults?.results, finalOutput);
      }
    }

    // Extract conversation_id from result for persistence
    // Use robust extraction that checks all possible locations
    function extractConversationId(result, runner) {
      return (
        // Top-level (most common) - check both spellings
        result?.conversationId ??
        result?.conversation_id ??
        
        // Sometimes attached to runner state (depending on SDK version)
        runner?.state?.conversationId ??
        runner?.state?.conversation_id ??
        
        // Runner instance itself
        runner?.conversationId ??
        runner?.conversation_id ??
        
        // Very defensive: scan result state and finalOutput
        result?.finalOutput?.conversationId ??
        result?.state?.conversationId ??
        result?.state?.conversation_id ??
        
        // Fallback to thread_id if conversation_id not found (some SDK versions)
        result?.thread_id ??
        
        null
      );
    }
    
    // Extract the conversation ID
    let returnedConversationId = extractConversationId(result, runner);
    
    // If we had an input conversationId and didn't extract one, use the input (it should persist)
    if (!returnedConversationId && conversationId) {
      returnedConversationId = conversationId;
    }
    
    // Log result keys and extracted value BEFORE any other transforms
    console.info('🔍 Result keys:', result ? Object.keys(result) : []);
    console.info('🔍 Top-level conversationId:', result?.conversationId);
    console.info('🔍 Runner.state:', runner?.state);

    // Log for debugging
    console.log('💬 Conversation ID extraction:', {
      input: conversationId || 'none',
      extracted: returnedConversationId || 'none',
      usingInput: !!conversationId && returnedConversationId === conversationId,
      resultHasConversationId: !!(result?.conversation_id || result?.conversationId),
      runnerHasConversationId: !!(runner?.conversation_id || runner?.conversationId || runner?.state?.conversation_id || runner?.state?.conversationId)
    });

    return {
      finalOutput,
      newItems,
      guardrailResults,
      usage: result?.usage || null,
      conversationId: returnedConversationId,
    };
  });
}

module.exports = {
  runAgentConversation,
};


