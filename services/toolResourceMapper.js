function buildResources({ vectorStoreId, codeInterpreterFileIds } = {}) {
  const toolResources = {};

  if (vectorStoreId) {
    toolResources.file_search = {
      vector_store_ids: [vectorStoreId],
    };
  }

  if (Array.isArray(codeInterpreterFileIds) && codeInterpreterFileIds.length > 0) {
    toolResources.code_interpreter = {
      file_ids: codeInterpreterFileIds,
    };
  }

  if (Object.keys(toolResources).length === 0) {
    return {};
  }

  // Previously wrapped in { tool_resources: ... }, now return directly
  return resources;
}

module.exports = {
  buildResources,
};

