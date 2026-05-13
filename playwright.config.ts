import { defineConfig, devices } from "@playwright/test";

// E2E config for minniDBMax. Each test gets a clean localStorage via a unique
// workspace query param, so tests can run in parallel within one browser.
export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Use the same dev server the project uses interactively. strictPort so we
    // know which port to hit; reuseExistingServer so locally `npm run dev` in
    // another shell still works.
    command: "npm run dev -- --port=5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
