/// <reference types="vitest" />
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  test: {
    // Unit tests live next to source files as src/**/*.test.ts.
    // The Playwright e2e suite under test/ uses its own runner.
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "test/**"],
  },
});
