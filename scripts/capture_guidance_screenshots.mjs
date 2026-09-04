import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT = fileURLToPath(new URL("../public/how-to/", import.meta.url));
const BASE_URL = "http://127.0.0.1:4174";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CAPTURE_MODE_CSS = `
  html, body, #root, .platform-shell, .platform-module,
  .platform-module > .app-shell, .app-shell {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
  }
  .platform-shell { display: block !important; }
  .platform-sidebar { display: none !important; }
  .platform-module { width: 100% !important; }
  .top-header, .filter-bar { position: static !important; }
`;

async function waitForServer(process, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (process.exitCode !== null) throw new Error(`Preview server exited with code ${process.exitCode}`);
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the preview server");
}

async function screenshotViewportRegion(page, path, x, y, width, height) {
  await page.screenshot({
    path,
    clip: { x, y, width, height },
    animations: "disabled",
  });
}

const server = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js",
  "--config",
  "vite.pages.config.js",
  "--host",
  "127.0.0.1",
  "--port",
  "4174",
], {
  cwd: ROOT,
  stdio: "ignore",
  windowsHide: true,
});

let browser;
try {
  await mkdir(OUTPUT, { recursive: true });
  await waitForServer(server);
  browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

  await page.goto(`${BASE_URL}/#/trade-explorer`, { waitUntil: "networkidle" });
  await page.waitForSelector(".map-card .maplibregl-canvas");
  await page.waitForTimeout(1_000);

  await screenshotViewportRegion(
    page,
    `${OUTPUT}navigation-and-filters.png`,
    0,
    0,
    1600,
    350,
  );

  await page.setViewportSize({ width: 1600, height: 2000 });
  await page.addStyleTag({
    content: CAPTURE_MODE_CSS,
  });

  await page.waitForTimeout(300);
  const content = await page.locator(".content").boundingBox();
  const snapshotHeader = await page.locator(".page-header").boundingBox();
  const snapshotMap = await page.locator(".map-card").boundingBox();
  await screenshotViewportRegion(
    page,
    `${OUTPUT}trade-snapshot.png`,
    content.x,
    snapshotHeader.y,
    content.width,
    snapshotMap.y + snapshotMap.height - snapshotHeader.y,
  );

  await page.getByRole("button", { name: "Trends", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("h1")?.textContent?.includes("trends"));
  await page.waitForTimeout(300);
  await page.locator(".trend-panel").screenshot({
    path: `${OUTPUT}trade-trends.png`,
    animations: "disabled",
  });

  await page.goto(`${BASE_URL}/#/ev-value-chain`, { waitUntil: "networkidle" });
  await page.waitForSelector(".stage-chain-canvas svg");
  await page.waitForTimeout(500);
  await page.addStyleTag({
    content: CAPTURE_MODE_CSS,
  });
  await page.waitForTimeout(300);
  await page.locator(".stage-overview-section").screenshot({
    path: `${OUTPUT}ev-value-chain.png`,
    animations: "disabled",
  });

  process.stdout.write(`Guidance screenshots written to ${OUTPUT}\n`);
} finally {
  await browser?.close();
  server.kill();
}
