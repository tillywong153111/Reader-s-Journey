import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const baseUrl = process.env.VISUAL_BASE_URL || "http://127.0.0.1:4173";
const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = modeArg ? modeArg.replace("--mode=", "") : "baseline";

const profiles = [
  { id: "iphone14", width: 390, height: 844 },
  { id: "iphone15", width: 393, height: 852 },
  { id: "iphone14plus", width: 430, height: 932 },
  { id: "iphone-se", width: 375, height: 667 }
];

const views = ["entry", "panel", "share", "settings", "entry-sheet"];
const sheetHotspotFallback = {
  panel: [0.5, 0.16],
  settings: [0.3, 0.9]
};
const mockedOpenLibraryPayload = {
  numFound: 1,
  docs: [
    {
      key: "/works/OLRJ1W",
      title: "Mock Open Library Book",
      author_name: ["Reader Journey Bot"],
      isbn: ["9780000000001"],
      number_of_pages_median: 320,
      subject: ["logic"],
      first_publish_year: 2024
    }
  ]
};
const mockedGoogleBooksPayload = {
  totalItems: 1,
  items: [
    {
      id: "rj-mock-google-1",
      volumeInfo: {
        title: "Mock Google Book",
        authors: ["Reader Journey Bot"],
        pageCount: 300,
        categories: ["Psychology"],
        publishedDate: "2024-01-01",
        industryIdentifiers: [{ type: "ISBN_13", identifier: "9780000000002" }]
      }
    }
  ]
};
const baselineDir = resolve(root, "test-results/visual-baseline");
const currentDir = resolve(root, "test-results/visual-current");
const diffDir = resolve(root, "test-results/visual-diff");
const mismatchThreshold = Number(process.env.VISUAL_MISMATCH_THRESHOLD || "0.008");

function cleanDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

async function pingServer(url, timeoutMs = 1600) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return true;
    } catch {
      // server not ready yet
    }
    await sleep(160);
  }
  return false;
}

async function waitForServer(url, timeoutMs = 26000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await pingServer(url, 500)) {
      return true;
    }
    await sleep(220);
  }
  return false;
}

async function startLocalServerIfNeeded() {
  const serverIsUp = await pingServer(baseUrl, 1200);
  if (serverIsUp) {
    return { process: null, spawned: false };
  }

  const child = spawn(process.execPath, ["scripts/dev.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[visual/dev] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[visual/dev] ${chunk}`);
  });

  const ready = await waitForServer(baseUrl, 30000);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`Dev server did not become ready at ${baseUrl}`);
  }

  return { process: child, spawned: true };
}

async function installNetworkStubs(page) {
  await page.route("https://openlibrary.org/search.json**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockedOpenLibraryPayload)
    });
  });
  await page.route("https://www.googleapis.com/books/v1/volumes**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockedGoogleBooksPayload)
    });
  });
}

async function waitForSheetVisible(page, timeoutMs = 5000) {
  try {
    await page.waitForSelector("#sheet-dialog[open]", { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function closeAllSheets(page, maxRounds = 6) {
  for (let round = 0; round < maxRounds; round += 1) {
    const sheetOpen = await page.locator("#sheet-dialog[open]").count();
    const privacyOpen = await page.locator("#privacy-dialog[open]").count();
    if (!sheetOpen && !privacyOpen) return;

    if (privacyOpen) {
      if (await page.locator("#privacy-close-btn").count()) {
        await page.locator("#privacy-close-btn").click();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(160);
      continue;
    }

    if (await page.locator("#sheet-close-btn").count()) {
      await page.locator("#sheet-close-btn").click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(180);
  }
}

async function resetWorldActionState(page) {
  await page.evaluate(() => {
    const hooks = window.__RJ_TEST__;
    if (!hooks) return;
    hooks.clearWorldPointerTarget?.();
    hooks.clearWorldInteractCooldown?.();
  });
  await page.waitForTimeout(80);
}

async function clickWorldPercent(page, xRatio, yRatio) {
  const rect = await page.locator("#world-canvas").boundingBox();
  if (!rect) return false;
  const x = rect.x + rect.width * xRatio;
  const y = rect.y + rect.height * yRatio;
  await page.mouse.click(x, y);
  return true;
}

async function openWorldSheet(page, zoneId, expectedSelector) {
  await resetWorldActionState(page);
  await closeAllSheets(page);

  if (zoneId === "entry" && (await page.locator("#world-entry-btn").count())) {
    await page.locator("#world-entry-btn").click();
  } else if (zoneId === "share" && (await page.locator("#world-share-btn").count())) {
    await page.locator("#world-share-btn").click();
  } else {
    const openedByHook = await page.evaluate((id) => {
      const hooks = window.__RJ_TEST__;
      if (!hooks || typeof hooks.triggerWorldAction !== "function") return false;
      return Boolean(hooks.triggerWorldAction(id));
    }, zoneId);
    if (!openedByHook && sheetHotspotFallback[zoneId]) {
      const [xRatio, yRatio] = sheetHotspotFallback[zoneId];
      await clickWorldPercent(page, xRatio, yRatio);
      await page.waitForTimeout(300);
      await clickWorldPercent(page, xRatio, yRatio);
    }
  }

  const opened = await waitForSheetVisible(page, 6500);
  if (!opened) return false;
  if (!expectedSelector) return true;
  return page.locator(expectedSelector).first().isVisible().catch(() => false);
}

async function captureProfileShots(page, profile, outputDir) {
  await page.setViewportSize({ width: profile.width, height: profile.height });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForSelector(".shell");
  await page.waitForTimeout(420);
  await closeAllSheets(page);

  for (const view of views) {
    if (view === "entry") {
      await openWorldSheet(page, "entry", "#sheet-world-entry-add-btn");
      const path = resolve(outputDir, `${profile.id}-${view}.png`);
      await page.locator(".shell").screenshot({ path });
      await closeAllSheets(page);
      continue;
    }

    if (view === "panel") {
      await openWorldSheet(page, "panel", "#sheet-world-panel-attrs-btn");
      const path = resolve(outputDir, `${profile.id}-${view}.png`);
      await page.locator(".shell").screenshot({ path });
      await closeAllSheets(page);
      continue;
    }

    if (view === "share") {
      await openWorldSheet(page, "share", "#sheet-share-copy-btn");
      const path = resolve(outputDir, `${profile.id}-${view}.png`);
      await page.locator(".shell").screenshot({ path });
      await closeAllSheets(page);
      continue;
    }

    if (view === "settings") {
      await openWorldSheet(page, "settings", "#sheet-world-settings-bgm-toggle-btn");
      const path = resolve(outputDir, `${profile.id}-${view}.png`);
      await page.locator(".shell").screenshot({ path });
      await closeAllSheets(page);
      continue;
    }

    if (view === "entry-sheet") {
      await openWorldSheet(page, "entry", "#sheet-world-entry-search-input");
      if (await page.locator("#sheet-world-entry-search-input").count()) {
        await page.locator("#sheet-world-entry-search-input").fill("math");
        await page.waitForTimeout(240);
      }
      if (await page.locator("#sheet-world-entry-more-btn").count()) {
        const disabled = await page.locator("#sheet-world-entry-more-btn").isDisabled();
        if (!disabled) {
          await page.locator("#sheet-world-entry-more-btn").click();
          await page.waitForTimeout(260);
        }
      }
      await waitForSheetVisible(page, 3000);
      const path = resolve(outputDir, `${profile.id}-entry-sheet.png`);
      await page.locator(".sheet-card").screenshot({ path });
      await closeAllSheets(page);
    }
  }
}

async function captureShots(outputDir) {
  cleanDir(outputDir);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installNetworkStubs(page);

    for (const profile of profiles) {
      await captureProfileShots(page, profile, outputDir);
    }

    await context.close();
  } finally {
    await browser.close();
  }
}

function comparePng(basePath, currentPath, diffPath) {
  const baseline = PNG.sync.read(readFileSync(basePath));
  const current = PNG.sync.read(readFileSync(currentPath));

  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      mismatchRatio: 1,
      pixelMismatch: baseline.width * baseline.height,
      message: "dimension mismatch"
    };
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const mismatchPixels = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: 0.16 }
  );
  const mismatchRatio = mismatchPixels / (baseline.width * baseline.height);

  if (mismatchPixels > 0) {
    writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return {
    mismatchRatio,
    pixelMismatch: mismatchPixels,
    message: ""
  };
}

function getExpectedImageNames() {
  const names = [];
  for (const profile of profiles) {
    for (const view of views) {
      names.push(`${profile.id}-${view}.png`);
    }
  }
  return names;
}

function runComparison() {
  cleanDir(diffDir);
  const names = getExpectedImageNames();
  const failures = [];
  const seededBaselines = [];

  for (const name of names) {
    const basePath = resolve(baselineDir, name);
    const currentPath = resolve(currentDir, name);
    const diffPath = resolve(diffDir, name);
    try {
      if (!existsSync(basePath) && existsSync(currentPath)) {
        mkdirSync(baselineDir, { recursive: true });
        copyFileSync(currentPath, basePath);
        seededBaselines.push(name);
      }
      const result = comparePng(basePath, currentPath, diffPath);
      if (result.mismatchRatio > mismatchThreshold) {
        failures.push(
          `${name} mismatch ${(result.mismatchRatio * 100).toFixed(2)}% (${result.pixelMismatch} px)`
        );
      }
    } catch (error) {
      failures.push(`${name} compare failed: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    console.error("Visual check failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    console.error(`Diff outputs: ${diffDir}`);
    process.exit(1);
  }

  if (seededBaselines.length > 0) {
    console.log(`Visual baseline seeded for ${seededBaselines.length} new snapshots.`);
  }
  console.log(`Visual check passed. Threshold=${(mismatchThreshold * 100).toFixed(2)}%`);
}

async function main() {
  const server = await startLocalServerIfNeeded();

  try {
    if (mode === "baseline") {
      await captureShots(baselineDir);
      console.log(`Baseline screenshots updated: ${baselineDir}`);
      return;
    }

    if (mode === "check") {
      await captureShots(currentDir);
      runComparison();
      return;
    }

    throw new Error(`Unsupported mode: ${mode}`);
  } finally {
    if (server.spawned && server.process) {
      server.process.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(`visual-regression failed: ${error.message}`);
  process.exit(1);
});
