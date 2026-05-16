/// <reference types="vitest" />
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  test: {
    // Unit tests live under test/unit/ (Vitest).
    // The Playwright e2e suite under test/e2e/ uses its own runner.
    include: ["test/unit/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "test/e2e/**"],
  },
});
