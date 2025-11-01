const {
  Agent,
  Runner,
  withTrace,
  codeInterpreterTool,
  hostedMcpTool,
} = require('@openai/agents');
const { OpenAI } = require('openai');
const { runGuardrails } = require('@openai/guardrails');

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
    file_ids: [],
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

const tools = [codeInterpreter];
const hostedMcp = createHostedMcpTool();
if (hostedMcp) {
  tools.push(hostedMcp);
}

const agent = new Agent({
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

async function runAgentConversation(conversationHistory, traceName = 'MCP Prod Test') {
  if (!Array.isArray(conversationHistory)) {
    throw new Error('conversationHistory must be an array of AgentInputItem objects');
  }

  return withTrace(traceName, async () => {
    const runner = new Runner({
      traceMetadata: {
        __trace_source__: 'agent-builder',
        workflow_id:
          process.env.SDK_AGENT_WORKFLOW_ID ||
          'wf_68efcaa7b9908190bfadd0ac72ef430001c44704e294f2a0',
      },
    });

    const result = await runner.run(agent, [...conversationHistory]);

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

    return {
      finalOutput,
      newItems,
      guardrailResults,
      usage: result?.usage || null,
    };
  });
}

module.exports = {
  runAgentConversation,
};


