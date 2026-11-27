// Tests of the media mini-app / media bot server logic (src/lib/__tests__). Run from the athar folder, which has jest and ts-jest:
//   cd athar && npx jest --config ../jest.media.config.js --rootDir ..
// One test mounts a Mini App screen in jsdom (src/lib/__tests__/novaSkillsScreen.test.ts), so .tsx is transformed too and a CSS
// import resolves to an empty stub; the server-side tests are unaffected.
const path = require("path");
const tsJest = path.join(__dirname, "athar/node_modules/ts-jest");
const tsconfig = { module: "commonjs", target: "es2020", esModuleInterop: true };
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/lib/__tests__/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.css$": "<rootDir>/test/styleMock.js",
    // jsdom → cssstyle → @asamuzakjp/css-color needs lru-cache 10's named LRUCache, while the athar install in moduleDirectories
    // holds lru-cache 5 ("LRUCache" undefined). Pin the server tests and the screen test to the root one.
    "^lru-cache$": "<rootDir>/node_modules/lru-cache",
  },
  transform: {
    "^.+\\.ts$": [tsJest, { diagnostics: false, isolatedModules: true, tsconfig }],
    "^.+\\.tsx$": [tsJest, { diagnostics: false, isolatedModules: true, tsconfig: { ...tsconfig, jsx: "react-jsx" } }],
  },
  roots: ["<rootDir>/src/lib"],
  moduleDirectories: ["node_modules", path.join(__dirname, "athar/node_modules")],
};
