import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // Compile JSX in tests (tsconfig keeps JSX for Next.js), so components can be rendered to check consent boxes.
  oxc: { jsx: { runtime: "automatic" } },
  // Deep check 06:00 M68: under a full parallel run some tests (in-memory database with every migration) passed 5 seconds
  // and failed only on time; a slow test is not a wrong one, so each test gets 30 seconds and each setup 60
  test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
