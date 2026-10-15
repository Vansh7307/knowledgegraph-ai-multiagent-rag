import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");
const backendPort = Number(process.env.KG_E2E_API_PORT ?? 8123);
const frontendPort = Number(process.env.KG_E2E_FRONTEND_PORT ?? 3123);
const backendUrl = `http://127.0.0.1:${backendPort}`;

export default defineConfig({
  testDir: path.join(projectRoot, "tests", "e2e"),
  testMatch: "app_flow.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `.\\.venv\\Scripts\\python.exe -m uvicorn src.app:app --host 127.0.0.1 --port ${backendPort}`,
      cwd: projectRoot,
      url: `${backendUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm.cmd run dev -- --hostname 127.0.0.1 --port ${frontendPort}`,
      cwd: path.join(projectRoot, "frontend"),
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { NEXT_PUBLIC_API_BASE: backendUrl },
    },
  ],
});
