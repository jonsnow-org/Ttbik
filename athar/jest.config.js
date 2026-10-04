module.exports = {
  preset: "ts-jest", testEnvironment: "node", testMatch: ["**/tests/**/*.spec.ts"], testTimeout: 180000,
  moduleNameMapper: { "^@ton/core$": "<rootDir>/node_modules/@ton/core" },
  transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false, isolatedModules: true }] },
};
