const { openai } = require('../lib/openai');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getVectorStoreFilesClient() {
  if (openai?.vectorStores?.files) {
    return openai.vectorStores.files;
  }

  if (openai?.beta?.vectorStores?.files) {
    return openai.beta.vectorStores.files;
  }

  throw new Error('OpenAI client does not support vector store files API');
}

async function createVectorStoreFile(vectorStoreId, fileId) {
  const filesClient = getVectorStoreFilesClient();
  const createFn = filesClient.create;

  if (createFn.length >= 2) {
    return createFn.call(filesClient, vectorStoreId, { file_id: fileId });
  }

  return createFn.call(filesClient, { vectorStoreId, fileId });
}

async function retrieveVectorStoreFile(vectorStoreId, fileId) {
  const filesClient = getVectorStoreFilesClient();
  const retrieveFn = filesClient.retrieve;

  if (retrieveFn.length >= 2) {
    return retrieveFn.call(filesClient, vectorStoreId, fileId);
  }

  return retrieveFn.call(filesClient, { vectorStoreId, fileId });
}

async function addFileToVectorStore({ vectorStoreId, fileId, timeoutMs = 120000 }) {
  if (!vectorStoreId || !fileId) {
    throw new Error('vectorStoreId and fileId are required');
  }

  await createVectorStoreFile(vectorStoreId, fileId);

  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const file = await retrieveVectorStoreFile(vectorStoreId, fileId);

    if (file?.status === 'completed') {
      return file;
    }

    if (file?.status === 'failed') {
      throw new Error(`Indexing failed for ${fileId}`);
    }

    await wait(1000);
  }

  throw new Error(`Indexing timeout for ${fileId}`);
}

async function addFiles({ vectorStoreId, fileIds = [] }) {
  const results = [];

  for (const fileId of fileIds) {
    try {
      await addFileToVectorStore({ vectorStoreId, fileId });
      results.push({ fileId, ok: true });
    } catch (error) {
      results.push({ fileId, ok: false, error: error?.message || 'index_error' });
    }
  }

  return results;
}

const AttachmentService = {
  addFileToVectorStore,
  addFiles,
};

module.exports = {
  AttachmentService,
};

