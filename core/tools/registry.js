function createRegistry() {
  const tools = new Map();

  function register(tool) {
    if (!tool || typeof tool.name !== "string" || !tool.name.trim()) {
      throw new Error("Tool must have a name");
    }
    if (typeof tool.execute !== "function") {
      throw new Error(`Tool "${tool.name}" must have execute()`);
    }
    tools.set(tool.name, tool);
    return tool;
  }

  function registerAll(list = []) {
    for (const tool of list) register(tool);
  }

  function has(name) {
    return tools.has(name);
  }

  function list() {
    return [...tools.values()];
  }

  function asOpenAiTools() {
    return list().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: tool.parameters || { type: "object", properties: {} },
      },
    }));
  }

  async function execute(name, args, ctx) {
    const tool = tools.get(name);
    if (!tool) {
      return { error: `Unknown tool: ${name}` };
    }
    try {
      const result = await tool.execute(args || {}, ctx);
      return result ?? { ok: true };
    } catch (error) {
      return { error: error.message || "Tool failed" };
    }
  }

  return {
    register,
    registerAll,
    has,
    list,
    asOpenAiTools,
    execute,
  };
}

module.exports = { createRegistry };
