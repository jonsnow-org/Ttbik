module.exports = {
  preset: "ts-jest", testEnvironment: "node", testMatch: ["**/scripts/**/*.run.ts"], testTimeout: 3_600_000,
  moduleNameMapper: { "^@ton/core$": "<rootDir>/node_modules/@ton/core" },
  transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false, isolatedModules: true }] },
};
