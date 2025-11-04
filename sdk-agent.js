const {
  Agent,
  Runner,
  withTrace,
  codeInterpreterTool,
  hostedMcpTool,
} = require('@openai/agents');
const { OpenAI } = require('openai');
const { runGuardrails } = require('@openai/guardrails');

// Log SDK version for debugging
try {
  // Use require.resolve to get the package entry point, then traverse up to find package.json
  const packagePath = require.resolve('@openai/agents');
  const fs = require('fs');
  const path = require('path');
  
  // Traverse up from the entry point (e.g., dist/index.js) to find package.json
  let currentDir = path.dirname(packagePath);
  let packageJsonPath = null;
  
  // Look for package.json going up the directory tree (max 5 levels)
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(currentDir, 'package.json');
    if (fs.existsSync(candidate)) {
      packageJsonPath = candidate;
      break;
    }
    currentDir = path.dirname(currentDir);
  }
  
  if (packageJsonPath) {
    const agentsPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    console.log('📦 @openai/agents version:', agentsPackage.version);
  } else {
    console.warn('⚠️ Could not find @openai/agents package.json');
  }
} catch (e) {
  console.warn('⚠️ Could not read @openai/agents version:', e.message);
}

// Try to import fileSearchTool from @openai/agents-openai
let fileSearchTool = null;
try {
  const { fileSearchTool: fileSearchToolImport } = require('@openai/agents-openai');
  fileSearchTool = fileSearchToolImport;
} catch (e) {
  console.warn('@openai/agents-openai not available, file_search will not be enabled:', e?.message);
}

// CRITICAL: Create OpenAI client at module scope to ensure it's reused across requests
// This ensures state persistence works correctly - a new client per request would break memory
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Log client creation (only once when module loads)
if (!global._openaiClientLogged) {
  console.log('✅ OpenAI client initialized at module scope for state persistence');
  global._openaiClientLogged = true;
}

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

function createAgent() {
  // CRITICAL: Always include file_search tool - it's required for file search to work
  // The vector store IDs are passed at agent.start() time, not at agent creation time
  const tools = [codeInterpreter];
  const hostedMcp = createHostedMcpTool();
  if (hostedMcp) {
    tools.push(hostedMcp);
  }

  // CRITICAL: Always include file_search tool - it's required for file search to work
  // The vector store IDs are passed via resources at agent.start() time, not here
  // Note: fileSearchTool may require a vectorStoreId parameter, but we'll pass it via resources
  // Try to create it without a vectorStoreId first (it may accept undefined)
  if (fileSearchTool) {
    try {
      // Try creating fileSearchTool - it may accept undefined/null or require a vectorStoreId
      // If it requires one, we'll need to handle that differently, but for now try undefined
      let fileSearch;
      try {
        fileSearch = fileSearchTool(undefined);
      } catch (e) {
        // If it requires a vectorStoreId, create with a placeholder - resources will override it
        // This is a workaround - ideally fileSearchTool should accept resources at start time
        console.warn('⚠️ fileSearchTool requires vectorStoreId, using placeholder (will be overridden by resources)');
        fileSearch = fileSearchTool('placeholder'); // Will be overridden by resources at start
      }
      tools.push(fileSearch);
    } catch (e) {
      console.error('❌ SDK Agent: Failed to create fileSearchTool:', {
        error: e?.message,
        stack: e?.stack,
      });
    }
  } else {
    // Only warn once if fileSearchTool module is missing
    if (!global._fileSearchToolWarningLogged) {
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

async function runAgentConversation(conversationHistory, traceName = 'MCP Prod Test', vectorStoreId = null, conversationId = null, fileIds = null) {
  if (!Array.isArray(conversationHistory)) {
    throw new Error('conversationHistory must be an array of AgentInputItem objects');
  }

  // Only log minimal info for debugging - reduce verbosity
  if (conversationHistory.length > 0 && vectorStoreId) {
    console.log('📥 Agent conversation:', {
      messages: conversationHistory.length,
      vectorStoreId,
      hasContent: !!conversationHistory[0]?.content,
      hasConversationId: !!conversationId,
      fileIdsCount: fileIds ? fileIds.length : 0
    });
  }

  return withTrace(traceName, async () => {
    // CRITICAL: Create agent once - always include file_search tool
    // The vector store IDs are passed via resources at agent.start() time
    const agent = createAgent();
    
    // Build resources for agent.start() - MUST include file_search with vectorStoreIds
    const resources = {};
    if (vectorStoreId) {
      resources.file_search = {
        vectorStoreIds: [vectorStoreId]
      };
      console.log('🔗 Attaching vector store to agent via resources:', {
        vectorStoreId: vectorStoreId.substring(0, 20) + '...',
        conversationId: conversationId || 'none'
      });
    } else {
      console.warn('⚠️ No vectorStoreId provided - file_search will not work');
    }
    
    // Add Code Interpreter file resources if files are provided
    if (fileIds && fileIds.length > 0) {
      resources.codeInterpreter = {
        fileIds: fileIds
      };
      console.log('📎 Attaching files as tool resources for Code Interpreter:', {
        fileCount: fileIds.length,
        fileIds: fileIds.slice(0, 3).map(id => id.substring(0, 10) + '...')
      });
    }
    
    // CRITICAL: Use agent.start() with conversationId and resources
    // This wires the vector store to the runner so file_search works
    const startOptions = {
      ...(conversationId ? { conversationId } : {}),
      ...(Object.keys(resources).length > 0 ? { resources } : {}),
      traceMetadata: {
        __trace_source__: 'agent-builder',
        workflow_id:
          process.env.SDK_AGENT_WORKFLOW_ID ||
          'wf_68efcaa7b9908190bfadd0ac72ef430001c44704e294f2a0',
      },
    };
    
    console.log('🚀 Starting agent with:', {
      hasConversationId: !!conversationId,
      conversationId: conversationId || 'none',
      hasResources: Object.keys(resources).length > 0,
      resourceKeys: Object.keys(resources),
      hasVectorStore: !!vectorStoreId,
      vectorStoreId: vectorStoreId ? vectorStoreId.substring(0, 20) + '...' : 'none'
    });
    
    // Start the runner with conversationId and resources
    const runner = await agent.start(startOptions);
    
    // If we have a conversation_id, only send the latest message (SDK will pull prior context via store:true)
    // Otherwise, send full history for the first message
    const messagesToSend = conversationId && conversationHistory.length > 0
      ? [conversationHistory[conversationHistory.length - 1]] // Only the latest message
      : [...conversationHistory]; // Full history for first message (or empty if no history)
    
    // Run the agent with the messages
    const result = await runner.run(agent, messagesToSend);
    
    // Log runner state after run for debugging
    // This is critical - if hasRunnerState is false, memory isn't persisting
    console.log('🔍 Runner state after run:', {
      hasRunnerState: !!runner?.state,
      runnerStateType: runner?.state ? typeof runner.state : 'none',
      runnerStateKeys: runner?.state ? Object.keys(runner.state) : [],
      resultType: result ? typeof result : 'none',
      resultIsObject: result ? typeof result === 'object' : false,
      resultKeys: result ? Object.keys(result) : [],
      // Check conversation ID persistence
      conversationIdPersisted: conversationId || 'none',
      note: 'State persistence is controlled by Agent.modelSettings.store (already set to true)'
    });
    
    // Info: runner.state is often empty when using server-side persistence
    // Note: The Agents platform persists conversation state server-side when Agent.modelSettings.store = true.
    // The local runner.state is often empty unless you put custom runner state there.
    // This is expected behavior - the conversationId links to the stored state on the server.
    if (conversationId && !runner?.state) {
      console.info('ℹ️ Conversation ID exists but runner.state is empty (expected with server-side persistence)', {
        conversationId,
        note: 'State is stored server-side. Agent.modelSettings.store: true enables persistence.',
        runnerConfig: runner?.config ? Object.keys(runner.config) : 'no config'
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
    // Robust extraction that checks all possible locations
    function pickConversationId(result, runner) {
      // top-level first (most common)
      if (result?.conversationId) return result.conversationId;
      if (result?.conversation_id) return result.conversation_id;

      // some builds tuck it under state/finalOutput
      if (result?.state?.conversationId) return result.state.conversationId;
      if (result?.state?.conversation_id) return result.state.conversation_id;
      if (result?.finalOutput?.conversationId) return result.finalOutput.conversationId;
      if (result?.finalOutput?.conversation_id) return result.finalOutput.conversation_id;

      // runner may hold it
      if (runner?.state?.conversationId) return runner.state.conversationId;
      if (runner?.state?.conversation_id) return runner.state.conversation_id;

      return null;
    }
    
    // Extract the conversation ID
    let returnedConversationId = pickConversationId(result, runner);
    
    // If we had an input conversationId and didn't extract one, use the input (it should persist)
    if (!returnedConversationId && conversationId) {
      returnedConversationId = conversationId;
    }
    
    // Log what we got back
    console.info('Returned conversationId:', returnedConversationId ?? 'none');

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


