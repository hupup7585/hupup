import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // tsconfig uses jsx: "preserve" for Next.js; tests need JSX compiled.
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/**/*.test.ts"] },
});
