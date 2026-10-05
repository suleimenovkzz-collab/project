const { getCatalog, getService } = require("./catalog");
const { getClinicInfo } = require("./clinic");
const { createRegistry } = require("./registry");

function createDefaultRegistry() {
  const registry = createRegistry();
  registry.registerAll([getCatalog, getService, getClinicInfo]);
  return registry;
}

module.exports = {
  createRegistry,
  createDefaultRegistry,
  getCatalog,
  getService,
  getClinicInfo,
};
