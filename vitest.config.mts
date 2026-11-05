import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // Compile JSX in tests (tsconfig keeps JSX for Next.js), so components can be rendered to check consent boxes.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/**/*.test.ts"] },
});
