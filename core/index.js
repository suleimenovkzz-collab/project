const config = require("./config");
const { EllaError } = require("./errors");
const { createKernel } = require("./kernel");
const { createDefaultRegistry, createRegistry } = require("./tools");

/**
 * Public factory for ELLA AI core.
 * @param {{ readServices: Function, registry?: ReturnType<typeof createRegistry> }} options
 */
function createElla(options = {}) {
  if (typeof options.readServices !== "function") {
    throw new Error("createElla requires readServices()");
  }

  const registry = options.registry || createDefaultRegistry();
  const kernel = createKernel({
    readServices: options.readServices,
    registry,
  });

  return {
    chat: kernel.chat,
    status: kernel.status,
    registry,
    config,
  };
}

module.exports = {
  createElla,
  createRegistry,
  createDefaultRegistry,
  EllaError,
  config,
};
