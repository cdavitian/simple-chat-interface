// File stager for quietly managing file metadata until they're sent with a prompt
// Tracks content_type + filename so the server can route files correctly

export function createFileStager() {
  const staged = new Map(); // Map<file_id, { content_type, filename }>

  const add = (fileId, metadata = {}) => {
    if (!fileId) return;
    const normalized = {
      content_type: metadata.content_type || metadata.contentType || '',
      filename: metadata.filename || metadata.name || ''
    };
    staged.set(fileId, normalized);
  };

  const remove = (fileId) => {
    if (!fileId) return;
    staged.delete(fileId);
  };

  const list = () => Array.from(staged.keys());

  const listWithMetadata = () => Array.from(staged.entries()).map(([file_id, metadata]) => ({
    file_id,
    ...metadata
  }));

  const clear = () => staged.clear();

  const classifyFile = (fileId, metadata = {}) => {
    const contentType = (metadata.content_type || '').toLowerCase();
    const filename = metadata.filename || '';
    const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    const isPdf = contentType === 'application/pdf' || extension === 'pdf';
    const displayName = filename || fileId;

    if (isPdf) {
      return { type: 'context_file', file_id: fileId, display_name: displayName };
    }

    return { type: 'input_file', file_id: fileId, display_name: displayName };
  };

  const toMessageContent = (text) => {
    const content = [];
    if (text) {
      content.push({ type: 'input_text', text });
    }

    staged.forEach((metadata, fileId) => {
      content.push(classifyFile(fileId, metadata));
    });

    return content;
  };

  return {
    add,
    remove,
    list,
    listWithMetadata,
    clear,
    toMessageContent,
    getMetadata: (fileId) => staged.get(fileId)
  };
}

