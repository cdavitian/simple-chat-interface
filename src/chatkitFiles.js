// File stager for quietly managing file_ids until they're sent with a prompt
// Now tracks content_type to route files correctly (PDF → context_file, CSV/XLS → input_file)

export function createFileStager() {
  const staged = new Map(); // Map<file_id, { content_type, filename? }>

  return {
    add: (fileId, metadata = {}) => {
      staged.set(fileId, metadata);
    },
    list: () => Array.from(staged.keys()),
    listWithMetadata: () => Array.from(staged.entries()).map(([file_id, metadata]) => ({
      file_id,
      ...metadata
    })),
    clear: () => staged.clear(),
    toMessageContent: (text) => {
      const content = [];
      if (text) {
        content.push({ type: "input_text", text });
      }
      Array.from(staged.entries()).forEach(([file_id, metadata]) => {
        const contentType = metadata?.content_type || '';
        // Route by content type: PDF → context_file, others → input_file
        if (contentType === 'application/pdf') {
          content.push({ type: "context_file", file_id });
        } else {
          content.push({ type: "input_file", file_id });
        }
      });
      return content;
    },
  };
}

