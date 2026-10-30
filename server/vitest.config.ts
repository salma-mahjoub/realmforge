import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Colyseus' optional @pm2/io probe calls process.send(), which breaks the forks pool IPC.
    pool: "threads",
    testTimeout: 20_000,
  },
});
