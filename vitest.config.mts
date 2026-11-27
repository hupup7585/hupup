import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // Compile JSX in tests (tsconfig keeps JSX for Next.js), so components can be rendered to check consent boxes.
  oxc: { jsx: { runtime: "automatic" } },
  // Deep check 06:00 M68: 20 seconds per test (was the 5-second default), so a busy machine (parallel sessions, bcrypt,
  // the in-memory database) never fails a passing test by time
  test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup.ts"], testTimeout: 20_000 },
});
