import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "npm run build && npm run start:e2e",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: "production",
      E2E_MOCK_MODE: "true",
      NEXT_PUBLIC_E2E_MOCK_MODE: "true",
      SESSION_COOKIE_NAME: "swarm_session_token",
      SESSION_COOKIE_SECURE: "false",
      NEXT_PUBLIC_DEMO_USER_EMAIL: "operator@swarm.e2e",
      NEXT_PUBLIC_DEMO_USER_PASSWORD: "DemoPass123!",
      NEXT_TELEMETRY_DISABLED: "1"
    }
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
