// Tests of the media mini-app / media bot server logic (src/lib/__tests__). Run from the athar folder, which has jest and ts-jest:
//   cd athar && npx jest --config ../jest.media.config.js --rootDir ..
const path = require("path");
const tsJest = path.join(__dirname, "athar/node_modules/ts-jest");
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/lib/__tests__/*.test.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  transform: { "^.+\\.ts$": [tsJest, { diagnostics: false, isolatedModules: true, tsconfig: { module: "commonjs", target: "es2020", esModuleInterop: true } }] },
  roots: ["<rootDir>/src/lib"],
  moduleDirectories: ["node_modules", path.join(__dirname, "athar/node_modules")],
};
