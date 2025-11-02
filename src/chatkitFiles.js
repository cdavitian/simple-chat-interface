// File stager for quietly managing file metadata until they're sent with a prompt
// Tracks content_type + filename so the server can route files correctly

import {
  buildMessageContent,
  determineCategory,
  normalizeFileMetadata,
} from './utils/fileTypeDetector';

export function createFileStager() {
  const staged = new Map(); // Map<file_id, { content_type, filename }>

  const add = (fileId, metadata = {}) => {
    if (!fileId) return;
    const normalizedMetadata = {
      content_type: metadata.content_type || metadata.contentType || '',
      filename: metadata.filename || metadata.name || '',
    };

    const category = determineCategory(
      normalizeFileMetadata(normalizedMetadata),
    );

    staged.set(fileId, {
      ...normalizedMetadata,
      category,
    });
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
    const messageContent = buildMessageContent(fileId, metadata);
    return {
      type: messageContent.type,
      file_id: messageContent.file_id,
      display_name: messageContent.display_name,
    };
  };

  const toMessageContent = (text) => {
    const content = [];
    if (text) {
      content.push({ type: 'input_text', text });
    }

    staged.forEach((metadata, fileId) => {
      const messageContent = classifyFile(fileId, metadata);
      content.push({
        type: messageContent.type,
        file_id: messageContent.file_id,
        display_name: messageContent.display_name,
      });
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

