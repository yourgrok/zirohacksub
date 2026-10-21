import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: { DEMO_NOW: "2026-10-21", LLM_PROVIDER: "none", READER_MODE: "http", DB_PATH: ":memory:" },
    testTimeout: 30000,
    fileParallelism: false,
  },
});
