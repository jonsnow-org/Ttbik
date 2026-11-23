// Measurement only (not part of CI): runs scripts/nova-speed/bench.bench.ts, which calls the REAL Nova tool functions
// against a fixed in-memory repository and prints the payload of the old behaviour and the new one in one run.
// Run it with: bash scripts/nova-speed/bench.sh
const path = require("path");
const tsJest = path.join(__dirname, "athar/node_modules/ts-jest");
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/scripts/nova-speed/*.bench.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  transform: { "^.+\\.ts$": [tsJest, { diagnostics: false, isolatedModules: true, tsconfig: { module: "commonjs", target: "es2020", esModuleInterop: true } }] },
  roots: ["<rootDir>/scripts/nova-speed"],
  moduleDirectories: ["node_modules", path.join(__dirname, "athar/node_modules")],
  testTimeout: 120000,
};
