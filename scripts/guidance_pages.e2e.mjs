import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:4173";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function waitForServer(process, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (process.exitCode !== null) {
      throw new Error(`Preview server exited with code ${process.exitCode}`);
    }
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

const server = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js",
  "--config",
  "vite.pages.config.js",
  "--host",
  "127.0.0.1",
  "--port",
  "4173",
], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "ignore",
  windowsHide: true,
});

let browser;
try {
  await waitForServer(server);
  browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE_URL}/#/about`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("h1").textContent(), "ATO Trade Intelligence");
  assert.equal(
    await page.getByRole("link", { name: "About", exact: true }).getAttribute("aria-current"),
    "page",
  );
  assert.equal(await page.locator(".about-page > .about-heading").count(), 1);
  assert.equal(await page.locator(".about-heading > span").textContent(), "About");
  assert.deepEqual(
    await page.locator(".about-panel > section > h3").allTextContents(),
    ["Overview", "Scope and Limitations", "Disclaimer", "Acknowledgements", "Sources"],
  );
  assert.deepEqual(
    await page.locator(".about-panel").evaluate((element) => {
      const styles = getComputedStyle(element);
      return { borderRadius: styles.borderRadius, padding: styles.padding };
    }),
    { borderRadius: "8px", padding: "28px" },
  );

  await page.getByRole("link", { name: "How to", exact: true }).click();
  await page.waitForURL("**/#/how-to");
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "How to use the trade tools");
  assert.equal(await page.locator("h1").textContent(), "How to use the trade tools");
  assert.equal(
    await page.getByRole("link", { name: "How to", exact: true }).getAttribute("aria-current"),
    "page",
  );
  assert.equal(await page.locator("figure.howto-figure").count(), 4);
  assert.equal(await page.locator("figure.howto-figure img").count(), 4);
  assert.equal(await page.locator("figure.howto-figure figcaption").count(), 4);
  assert.equal(await page.locator(".howto-page > .howto-heading + .howto-page-links").count(), 1);
  assert.equal(await page.locator(".howto-heading > span").count(), 0);
  assert.deepEqual(
    await page.locator(".howto-step").evaluateAll((steps) =>
      steps.map((step) => Array.from(step.children).map((child) => child.className || child.tagName.toLowerCase())),
    ),
    [
      ["header", "howto-figure", "howto-definitions", "howto-reading-guide"],
      ["header", "howto-figure", "howto-definitions", "howto-reading-guide"],
      ["header", "howto-figure", "howto-definitions", "howto-reading-guide"],
      ["header", "howto-figure", "howto-definitions", "howto-reading-guide"],
    ],
  );
  assert.deepEqual(
    await page.locator(".howto-step").evaluateAll((steps) =>
      steps.map((step) => step.classList.contains("howto-tab-section")),
    ),
    [false, true, true, true],
  );
  assert.deepEqual(
    await page.locator(".howto-step").first().evaluate((element) => {
      const stepStyles = getComputedStyle(element);
      const figureStyles = getComputedStyle(element.querySelector(".howto-figure"));
      const headingStyles = getComputedStyle(document.querySelector(".howto-heading h1"));
      return {
        borderRadius: stepStyles.borderRadius,
        figurePadding: figureStyles.padding,
        headingSize: headingStyles.fontSize,
      };
    }),
    { borderRadius: "8px", figurePadding: "24px", headingSize: "30px" },
  );
  assert.deepEqual(
    await page.locator("figure.howto-figure img").evaluateAll((images) =>
      images.map((image) => image.complete && image.naturalWidth > 0),
    ),
    [true, true, true, true],
  );

  for (const figure of await page.locator("figure.howto-figure").all()) {
    const geometry = await figure.evaluate((element) => {
      const figureRect = element.getBoundingClientRect();
      const markers = Array.from(element.querySelectorAll(".howto-highlight b"));
      return markers.map((marker) => {
        const rect = marker.getBoundingClientRect();
        return {
          left: rect.left - figureRect.left,
          top: rect.top - figureRect.top,
          right: figureRect.right - rect.right,
          bottom: figureRect.bottom - rect.bottom,
        };
      });
    });
    for (const marker of geometry) {
      assert.ok(marker.left >= 0, `Annotation marker is clipped at the left edge: ${JSON.stringify(marker)}`);
      assert.ok(marker.top >= 0, `Annotation marker is clipped at the top edge: ${JSON.stringify(marker)}`);
      assert.ok(marker.right >= 0, `Annotation marker is clipped at the right edge: ${JSON.stringify(marker)}`);
      assert.ok(marker.bottom >= 0, `Annotation marker is clipped at the bottom edge: ${JSON.stringify(marker)}`);
    }

    const highlights = await figure.evaluate((element) => {
      const imageRect = element.querySelector(".howto-image-wrap").getBoundingClientRect();
      return Array.from(element.querySelectorAll(".howto-highlight")).map((highlight) => {
        const rect = highlight.getBoundingClientRect();
        return {
          left: rect.left - imageRect.left,
          top: rect.top - imageRect.top,
          right: imageRect.right - rect.right,
          bottom: imageRect.bottom - rect.bottom,
        };
      });
    });
    for (const highlight of highlights) {
      assert.ok(highlight.left >= 0 && highlight.top >= 0 && highlight.right >= 0 && highlight.bottom >= 0,
        `Annotation box extends beyond its screenshot: ${JSON.stringify(highlight)}`);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    true,
    "How-to page introduces horizontal page overflow on a mobile viewport",
  );
  assert.equal(
    await page.locator(".howto-figure figcaption").first().evaluate((element) => {
      const items = Array.from(element.children);
      return items.length < 2 || Math.abs(items[0].getBoundingClientRect().left - items[1].getBoundingClientRect().left) < 1;
    }),
    true,
    "How-to callout descriptions should stack in one column on mobile",
  );

  await page.getByRole("link", { name: "Trade Flow Explorer", exact: true }).click();
  await page.waitForURL("**/#/trade-explorer");
  await page.waitForFunction(() =>
    document.querySelector('a[href="#/trade-explorer"]')?.getAttribute("aria-current") === "page",
  );
  assert.equal(
    await page.getByRole("link", { name: "Trade Flow Explorer", exact: true }).getAttribute("aria-current"),
    "page",
  );

  process.stdout.write("Guidance pages browser test passed.\n");
} finally {
  await browser?.close();
  server.kill();
}
