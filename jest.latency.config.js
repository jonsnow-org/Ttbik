// Measurement only (not part of CI): runs scripts/latency-bench/response-latency.bench.ts, which imports the REAL
// first-byte policy from src/lib/coderSections.ts (novaFirstByteCap / novaFirstByteWaitS / novaSubmitTimeoutMs / pollMs)
// and prints the before/after numbers in one run.
//   bash scripts/latency-bench/bench.sh
const path = require("path");
const tsJest = path.join(__dirname, "athar/node_modules/ts-jest");
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/scripts/latency-bench/*.bench.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  transform: { "^.+\\.ts$": [tsJest, { diagnostics: false, isolatedModules: true, tsconfig: { module: "commonjs", target: "es2020", esModuleInterop: true } }] },
  roots: ["<rootDir>/scripts/latency-bench"],
  moduleDirectories: ["node_modules", path.join(__dirname, "athar/node_modules")],
  testTimeout: 120000,
};
