const path = require('path');

const rawRules = require('../file-type-rules.json');

const toLower = (value) => (typeof value === 'string' ? value.toLowerCase() : '');
const normalizeCategoryLabel = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = toLower(value).replace(/[^a-z0-9]+/g, '_');

  if (normalized === 'code_interpreter' || normalized === 'codeinterpreter') {
    return 'code_interpreter';
  }

  if (normalized === 'context' || normalized === 'context_file') {
    return 'context';
  }

  return normalized;
};

const CONTEXT_EXTENSIONS = new Set((rawRules?.context?.extensions || []).map(toLower));
const CONTEXT_MIME_TYPES = new Set((rawRules?.context?.mimeTypes || []).map(toLower));

const CODE_INTERPRETER_EXTENSIONS = new Set(
  (rawRules?.codeInterpreter?.extensions || []).map(toLower),
);

const CODE_INTERPRETER_MIME_TYPES = new Set(
  (rawRules?.codeInterpreter?.mimeTypes || []).map(toLower),
);

function deriveExtension(filename = '') {
  if (typeof filename !== 'string') {
    return '';
  }

  const trimmed = filename.trim();
  if (!trimmed) {
    return '';
  }

  const ext = path.extname(trimmed).replace(/^\./, '');
  return toLower(ext);
}

function normalizeFileMetadata(file = {}) {
  const filename =
    typeof file.filename === 'string'
      ? file.filename
      : typeof file.originalname === 'string'
      ? file.originalname
      : typeof file.name === 'string'
      ? file.name
      : typeof file.display_name === 'string'
      ? file.display_name
      : '';

  const contentType = toLower(
    file.content_type || file.contentType || file.mimetype || file.mime || '',
  );

  let extension = toLower(file.extension || '');
  if (!extension) {
    extension = deriveExtension(filename);
  }

  const category = normalizeCategoryLabel(file.category || file.file_category || '');

  return {
    filename,
    contentType,
    extension,
    size: typeof file.size === 'number' ? file.size : null,
    category,
  };
}

function isContextCategory(metadata = {}) {
  const { extension, contentType } = metadata;
  return Boolean(
    (extension && CONTEXT_EXTENSIONS.has(extension)) ||
      (contentType && CONTEXT_MIME_TYPES.has(contentType)),
  );
}

function isCodeInterpreterCategory(metadata = {}) {
  const { extension, contentType } = metadata;
  if (extension && CODE_INTERPRETER_EXTENSIONS.has(extension)) {
    return true;
  }
  if (contentType && CODE_INTERPRETER_MIME_TYPES.has(contentType)) {
    return true;
  }
  return false;
}

function determineCategory(metadata = {}) {
  const explicitCategory = normalizeCategoryLabel(metadata.category || '');

  if (explicitCategory === 'code_interpreter') {
    return 'code_interpreter';
  }

  if (explicitCategory === 'context') {
    return 'context';
  }

  if (isContextCategory(metadata)) {
    return 'context';
  }

  if (isCodeInterpreterCategory(metadata)) {
    return 'code_interpreter';
  }

  return 'default';
}

function buildMessageRouting(fileId, metadata = {}) {
  const normalized = normalizeFileMetadata(metadata);
  const category = determineCategory(normalized);
  const displayName = normalized.filename || metadata.display_name || fileId;

  const messageContent = {
    type: category === 'context' ? 'context_file' : 'input_file',
    file_id: fileId,
    display_name: displayName,
  };

  const attachments = [];
  if (category === 'code_interpreter') {
    attachments.push({
      file_id: fileId,
      tools: [{ type: 'code_interpreter' }],
    });
  }

  return {
    category,
    normalized,
    messageContent,
    attachments,
    display_name: displayName,
  };
}

function getCategoryFromExtension(extension) {
  const normalizedExtension = toLower(extension);
  if (!normalizedExtension) {
    return 'default';
  }

  if (CONTEXT_EXTENSIONS.has(normalizedExtension)) {
    return 'context';
  }

  if (CODE_INTERPRETER_EXTENSIONS.has(normalizedExtension)) {
    return 'code_interpreter';
  }

  return 'default';
}

module.exports = {
  FILE_TYPE_RULES: rawRules,
  CONTEXT_EXTENSIONS,
  CONTEXT_MIME_TYPES,
  CODE_INTERPRETER_EXTENSIONS,
  CODE_INTERPRETER_MIME_TYPES,
  normalizeFileMetadata,
  determineCategory,
  buildMessageRouting,
  isContextCategory,
  isCodeInterpreterCategory,
  getCategoryFromExtension,
};

