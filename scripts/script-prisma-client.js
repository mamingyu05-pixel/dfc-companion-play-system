const path = require("node:path");

function loadPrismaClient() {
  const candidates = [
    path.resolve(__dirname, "../apps/api-server/node_modules/@prisma/client"),
    path.resolve(__dirname, "../packages/database/node_modules/@prisma/client"),
    "@prisma/client"
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND") throw error;
    }
  }

  throw new Error("Cannot load @prisma/client. Build the api-server image or install workspace dependencies first.");
}

module.exports = loadPrismaClient();
