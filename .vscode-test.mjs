import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/integration/**/*.test.js",
  version: "1.143.1",
  workspaceFolder: "test/fixtures/workspace",
  mocha: { ui: "tdd", timeout: 20000 },
});
