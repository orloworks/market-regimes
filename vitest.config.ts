import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 120_000, // convergence tests process 5644 days × 5 detectors
    hookTimeout: 120_000, // beforeAll classifyRegimeSeries on full dataset is slow
  },
});
