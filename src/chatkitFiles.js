// File stager for quietly managing file_ids until they're sent with a prompt

export function createFileStager() {
  const staged = new Set();

  return {
    add: (fileId) => staged.add(fileId),
    list: () => Array.from(staged),
    clear: () => staged.clear(),
    toMessageContent: (text) => {
      const content = [];
      if (text) {
        content.push({ type: "input_text", text });
      }
      Array.from(staged).forEach((id) => {
        content.push({ type: "input_file", file_id: id });
      });
      return content;
    },
  };
}

