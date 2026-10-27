// Opt-in end-to-end runs against a REAL local model on CPU (never part of CI): see e2e/local-cpu/README.md
const base = require("./jest.media.config.js");
module.exports = { ...base, testMatch: ["<rootDir>/e2e/local-cpu/*.e2e.ts"], roots: ["<rootDir>/e2e/local-cpu", "<rootDir>/src/lib"], testTimeout: 1800000 };
