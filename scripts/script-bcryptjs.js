const path = require("node:path");

function loadBcrypt() {
  const candidates = [
    path.resolve(__dirname, "../apps/api-server/node_modules/bcryptjs"),
    path.resolve(__dirname, "../node_modules/bcryptjs"),
    "bcryptjs"
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND") throw error;
    }
  }

  throw new Error("Cannot load bcryptjs. Build the api-server image or install workspace dependencies first.");
}

module.exports = loadBcrypt();
