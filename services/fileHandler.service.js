const {
  normalizeFileMetadata,
  determineCategory,
  buildMessageRouting,
  getCategoryFromExtension,
} = require('../utils/fileTypeDetector');

function getFileConfig(file = {}) {
  const normalized = normalizeFileMetadata(file);
  const category = determineCategory(normalized);
  const displayName = normalized.filename || file?.file_id || '';
  const messageType = category === 'context' ? 'context_file' : 'input_file';
  const isCodeInterpreter = category === 'code_interpreter';

  return {
    normalized,
    category,
    displayName,
    messageType,
    isCodeInterpreter,
    persistable: {
      content_type: normalized.contentType || null,
      filename: normalized.filename || null,
      category,
    },
  };
}

function getCategory(target) {
  if (!target) {
    return 'default';
  }

  if (typeof target === 'string') {
    return getCategoryFromExtension(target);
  }

  const normalized = normalizeFileMetadata(target);
  return determineCategory(normalized);
}

function prepareMessageParts(fileId, metadata = {}) {
  return buildMessageRouting(fileId, metadata);
}

module.exports = {
  getFileConfig,
  getCategory,
  prepareMessageParts,
};

