import fileTypeRules from '../../file-type-rules.json';

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

const CONTEXT_EXTENSIONS = new Set((fileTypeRules?.context?.extensions || []).map(toLower));
const CONTEXT_MIME_TYPES = new Set((fileTypeRules?.context?.mimeTypes || []).map(toLower));

const CODE_INTERPRETER_EXTENSIONS = new Set(
  (fileTypeRules?.codeInterpreter?.extensions || []).map(toLower),
);

const CODE_INTERPRETER_MIME_TYPES = new Set(
  (fileTypeRules?.codeInterpreter?.mimeTypes || []).map(toLower),
);

const deriveExtension = (filename = '') => {
  if (typeof filename !== 'string') {
    return '';
  }

  const trimmed = filename.trim();
  if (!trimmed || !trimmed.includes('.')) {
    return '';
  }

  return toLower(trimmed.split('.').pop());
};

export const normalizeFileMetadata = (file = {}) => {
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
    category,
  };
};

export const isContextCategory = (metadata = {}) => {
  const { extension, contentType } = metadata;
  return (
    (extension && CONTEXT_EXTENSIONS.has(extension)) ||
    (contentType && CONTEXT_MIME_TYPES.has(contentType))
  );
};

export const isCodeInterpreterCategory = (metadata = {}) => {
  const { extension, contentType } = metadata;
  if (extension && CODE_INTERPRETER_EXTENSIONS.has(extension)) {
    return true;
  }

  if (contentType && CODE_INTERPRETER_MIME_TYPES.has(contentType)) {
    return true;
  }

  return false;
};

export const determineCategory = (metadata = {}) => {
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
};

export const buildMessageContent = (fileId, metadata = {}) => {
  const normalized = normalizeFileMetadata(metadata);
  const category = determineCategory(normalized);
  const displayName = normalized.filename || metadata.display_name || fileId;

  return {
    type: category === 'context' ? 'context_file' : 'input_file',
    file_id: fileId,
    display_name: displayName,
    category,
  };
};

export const FILE_TYPE_RULES = fileTypeRules;

