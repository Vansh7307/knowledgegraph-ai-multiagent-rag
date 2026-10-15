import { expect, test } from "../../frontend/node_modules/@playwright/test";

const apiBase = `http://127.0.0.1:${process.env.KG_E2E_API_PORT ?? 8123}`;

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiBase}/api/reset`);
  expect(response.ok()).toBeTruthy();
});

test("streams the enterprise demo and updates graph counters live", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    Object.assign(window, { demoSseProgressCount: 0 });
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict);
        this.addEventListener("progress", () => {
          const state = window as Window & { demoSseProgressCount: number };
          state.demoSseProgressCount += 1;
        });
      }
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Load Enterprise Demo/ }).click();

  await expect(page.getByTestId("metric-chunks")).not.toHaveText("0");
  await expect(page.getByTestId("metric-entities")).not.toHaveText("0");
  await expect(page.getByTestId("metric-triplets")).not.toHaveText("0");
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { demoSseProgressCount: number }).demoSseProgressCount
  )).toBeGreaterThan(0);
  await expect(page.locator(".graph-panel")).toContainText(/Python SSE ingestion|Enterprise demo streamed from Python/);
});

test("switches mobile tabs and renders the desktop three-column command center", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: /Ingest/ })).toBeVisible();
  await nav.getByRole("button", { name: /Ask AI/ }).click();
  await expect(page.locator(".chat-panel")).toHaveClass(/visible/);
  await nav.getByRole("button", { name: /Graph/ }).click();
  await expect(page.locator(".graph-panel")).toHaveClass(/visible/);
  await nav.getByRole("button", { name: /Ingest/ }).click();
  await expect(page.locator(".ingestion-panel")).toHaveClass(/visible/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(nav).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(nav).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const columns = await page.locator(".main-grid").evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length
  );
  expect(columns).toBe(3);
});

test("canvas requestAnimationFrame activity settles instead of running continuously", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    let scheduledFrames = 0;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      scheduledFrames += 1;
      return nativeRequestAnimationFrame(callback);
    };
    Object.defineProperty(window, "scheduledCanvasFrames", { get: () => scheduledFrames });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Load Enterprise Demo/ }).click();
  await expect(page.getByTestId("metric-entities")).not.toHaveText("0");
  await expect(page.locator(".graph-panel")).toContainText("Enterprise demo streamed from Python");
  await page.waitForTimeout(3_000);
  const firstSample = await page.evaluate(() =>
    (window as Window & { scheduledCanvasFrames: number }).scheduledCanvasFrames
  );
  await page.waitForTimeout(1_500);
  const settledSample = await page.evaluate(() =>
    (window as Window & { scheduledCanvasFrames: number }).scheduledCanvasFrames
  );
  expect(settledSample - firstSample).toBeLessThanOrEqual(2);
});
