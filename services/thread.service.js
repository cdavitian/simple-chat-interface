const { pool } = require('../lib/db');
const { openai } = require('../lib/openai');

let tablesEnsured = false;

async function ensureTables() {
  if (tablesEnsured) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      vector_store_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      role TEXT NOT NULL,
      content TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  tablesEnsured = true;
}

async function createVectorStoreForThread(threadId) {
  const request = { name: `thread:${threadId}` };

  let vectorStore;

  if (openai?.vectorStores?.create) {
    vectorStore = await openai.vectorStores.create(request);
  } else if (openai?.beta?.vectorStores?.create) {
    vectorStore = await openai.beta.vectorStores.create(request);
  } else {
    throw new Error('OpenAI client does not support vector store creation');
  }

  if (!vectorStore?.id) {
    throw new Error('Failed to create vector store for thread');
  }

  return vectorStore.id;
}

async function ensureThread({ threadId, userId, sessionId = null }) {
  await ensureTables();

  const existing = await pool.query(
    'SELECT * FROM threads WHERE id = $1 LIMIT 1',
    [threadId],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const vectorStoreId = await createVectorStoreForThread(threadId);

  const inserted = await pool.query(
    `INSERT INTO threads (id, session_id, user_id, vector_store_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [threadId, sessionId, userId, vectorStoreId],
  );

  return inserted.rows[0];
}

async function setConversationId(threadId, conversationId) {
  await ensureTables();

  await pool.query(
    `UPDATE threads
       SET conversation_id = $1,
           updated_at = now()
     WHERE id = $2`,
    [conversationId, threadId],
  );
}

async function get(threadId) {
  await ensureTables();

  const result = await pool.query(
    'SELECT * FROM threads WHERE id = $1 LIMIT 1',
    [threadId],
  );

  return result.rows[0] || null;
}

const ThreadService = {
  ensureThread,
  setConversationId,
  get,
};

module.exports = {
  ThreadService,
};

