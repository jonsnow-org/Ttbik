module.exports = { preset: "ts-jest", testEnvironment: "node", testMatch: ["**/tests/**/*.spec.ts"], testTimeout: 120000,
  transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false, isolatedModules: true }] } };
