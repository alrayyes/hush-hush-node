import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      include: ["src/**"],
      exclude: ["src/generated/**"],
      reporter: ["text", "lcov"],
    },
  },
});
