const OpenAI = require('openai');

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  OPENAI_API_KEY is not set. OpenAI client will throw if used without a key.');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Force a modern API version that supports tool_resources on Responses
  defaultHeaders: { "OpenAI-Version": "2023-12-01" }
});

module.exports = {
  openai,
};

