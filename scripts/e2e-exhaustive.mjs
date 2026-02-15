import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";
const headed = process.argv.includes("--headed");
const outputDir = resolve(root, "output/playwright/e2e-exhaustive");
const reportPath = resolve(root, "output/playwright/e2e-exhaustive-report.json");

const viewports = [
  { id: "mobile-390x844", width: 390, height: 844 },
  { id: "mobile-430x932", width: 430, height: 932 },
  { id: "desktop-1280x720", width: 1280, height: 720 }
];

const hotspotPlan = [
  { id: "panel", x: 0.5, y: 0.16, expectedSelectors: ["#sheet-world-panel-attrs-btn"] },
  { id: "entry", x: 0.3, y: 0.6, expectedSelectors: ["#sheet-world-entry-add-btn"] },
  { id: "shelf", x: 0.72, y: 0.6, expectedSelectors: [".sheet-open-book-detail", ".scroll-empty"] },
  { id: "settings", x: 0.3, y: 0.9, expectedSelectors: ["#sheet-world-settings-bgm-toggle-btn"] },
  { id: "share", x: 0.72, y: 0.86, expectedSelectors: ["#sheet-share-copy-btn"] }
];

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

function cleanOutput() {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
}

async function pingServer(url, timeoutMs = 1600) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      // server not ready
    }
    await sleep(140);
  }
  return false;
}

async function waitForServer(url, timeoutMs = 32000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pingServer(url, 600)) return true;
    await sleep(200);
  }
  return false;
}

async function startServerIfNeeded() {
  if (await pingServer(baseUrl, 1200)) {
    return { process: null, spawned: false };
  }

  const child = spawn(process.execPath, ["scripts/dev.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[e2e/dev] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[e2e/dev] ${chunk}`);
  });

  const ready = await waitForServer(baseUrl, 35000);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`dev server did not become ready at ${baseUrl}`);
  }

  return { process: child, spawned: true };
}

async function screenshot(page, name) {
  const path = resolve(outputDir, name);
  await page.screenshot({ path, fullPage: true });
  return path;
}

function isBenignConsoleError(text) {
  return /status of 429/i.test(text) || /ERR_BLOCKED_BY_CLIENT/i.test(text);
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

async function getWorldCanvasBox(page) {
  return page.locator("#world-canvas").boundingBox();
}

async function clickWorldPercent(page, xRatio, yRatio) {
  const rect = await getWorldCanvasBox(page);
  if (!rect) {
    throw new Error("world canvas missing");
  }
  const x = rect.x + rect.width * xRatio;
  const y = rect.y + rect.height * yRatio;
  await page.mouse.click(x, y);
}

async function advanceWorld(page, ms) {
  await page.evaluate((delta) => {
    if (typeof window.advanceTime === "function") {
      window.advanceTime(delta);
    }
  }, ms);
  await page.waitForTimeout(80);
}

async function readTextState(page) {
  return page.evaluate(() => {
    if (typeof window.render_game_to_text !== "function") return { missing: true };
    try {
      return JSON.parse(window.render_game_to_text());
    } catch (error) {
      return { parseError: String(error), raw: String(window.render_game_to_text()) };
    }
  });
}

async function isAnyVisible(page, selectors) {
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (!count) continue;
    const visible = await page.locator(selector).first().isVisible();
    if (visible) return true;
  }
  return false;
}

async function closeAllSheets(page, maxRounds = 6) {
  let closedAny = false;
  for (let round = 0; round < maxRounds; round += 1) {
    const sheetOpen = await page.locator("#sheet-dialog[open]").count();
    const privacyOpen = await page.locator("#privacy-dialog[open]").count();
    if (!sheetOpen && !privacyOpen) break;
    closedAny = true;

    if (privacyOpen) {
      if (await page.locator("#privacy-close-btn").count()) {
        await page.locator("#privacy-close-btn").click();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(180);
      continue;
    }

    if (await page.locator("#sheet-close-btn").count()) {
      await page.locator("#sheet-close-btn").click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(200);
  }
  return closedAny;
}

async function waitForSheetVisible(page, timeoutMs = 9000) {
  try {
    await page.waitForSelector("#sheet-dialog[open]", { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function clickFirstWithRetry(page, selector, attempts = 4, timeoutMs = 4000) {
  for (let index = 0; index < attempts; index += 1) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) return false;
    try {
      await locator.click({ timeout: timeoutMs });
      return true;
    } catch (error) {
      const message = String(error || "");
      const retriable =
        /detached|not visible|Timeout|receives pointer events|stable/i.test(message) && index < attempts - 1;
      if (!retriable) {
        throw error;
      }
      await page.waitForTimeout(140);
    }
  }
  return false;
}

async function queueHotspotByHook(page, hotspotId) {
  try {
    return await page.evaluate((zoneId) => {
      const hooks = window.__RJ_TEST__;
      if (!hooks || typeof hooks.queueWorldHotspot !== "function") return false;
      return Boolean(hooks.queueWorldHotspot(zoneId));
    }, hotspotId);
  } catch {
    return false;
  }
}

async function triggerHotspotByHook(page, hotspotId) {
  try {
    return await page.evaluate((zoneId) => {
      const hooks = window.__RJ_TEST__;
      if (!hooks || typeof hooks.triggerWorldAction !== "function") return false;
      return Boolean(hooks.triggerWorldAction(zoneId));
    }, hotspotId);
  } catch {
    return false;
  }
}

async function resetWorldActionState(page) {
  await page.evaluate(() => {
    const hooks = window.__RJ_TEST__;
    if (!hooks) return;
    if (typeof hooks.clearWorldPointerTarget === "function") {
      hooks.clearWorldPointerTarget();
    }
    if (typeof hooks.clearWorldInteractCooldown === "function") {
      hooks.clearWorldInteractCooldown();
    }
  });
  await page.waitForTimeout(100);
}

async function openHotspot(page, hotspot) {
  await resetWorldActionState(page);
  await closeAllSheets(page);
  let sawOpen = false;
  let sawMatch = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await resetWorldActionState(page);
    const queued = await queueHotspotByHook(page, hotspot.id);
    if (!queued) {
      await clickWorldPercent(page, hotspot.x, hotspot.y);
    }

    await advanceWorld(page, 1500);
    let opened = await waitForSheetVisible(page, 1800);
    if (!opened) {
      const triggered = await triggerHotspotByHook(page, hotspot.id);
      if (!triggered) {
        await clickWorldPercent(page, hotspot.x, hotspot.y);
      }
      opened = await waitForSheetVisible(page, 2200);
    }
    if (!opened) {
      continue;
    }

    sawOpen = true;
    const matched = await isAnyVisible(page, hotspot.expectedSelectors);
    if (matched) {
      sawMatch = true;
      return { opened: true, matched: true, selectors: hotspot.expectedSelectors };
    }
    await closeAllSheets(page);
  }

  return { opened: sawOpen, matched: sawMatch, selectors: hotspot.expectedSelectors };
}

async function runEntryFlow(page, scenario) {
  const flow = { opened: false, customAddAttempted: false, addTriggered: false, searchSheetOpened: false };

  await resetWorldActionState(page);
  await closeAllSheets(page);
  await page.locator("#world-entry-btn").click();
  flow.opened = await waitForSheetVisible(page, 5000);
  if (!flow.opened) return flow;

  if (await page.locator("#sheet-world-entry-search-input").count()) {
    await page.locator("#sheet-world-entry-search-input").fill("math");
    await page.waitForTimeout(220);
  }

  if (await page.locator("#sheet-world-entry-more-btn").count()) {
    const disabled = await page.locator("#sheet-world-entry-more-btn").isDisabled();
    if (!disabled) {
      await page.locator("#sheet-world-entry-more-btn").click();
      await page.waitForTimeout(260);
      flow.searchSheetOpened = Boolean(await page.locator("#sheet-dialog[open]").count());
      if (await page.locator(".sheet-select-book").count()) {
        await page.locator(".sheet-select-book").first().click();
        await page.waitForTimeout(260);
      }
    }
  }

  if (await page.locator("#sheet-world-entry-online-btn").count()) {
    const disabled = await page.locator("#sheet-world-entry-online-btn").isDisabled();
    if (!disabled) {
      await page.locator("#sheet-world-entry-online-btn").click();
      await page.waitForTimeout(350);
    }
  }

  if (await page.locator("#sheet-world-entry-mode-btn").count()) {
    await page.locator("#sheet-world-entry-mode-btn").click();
    await page.waitForTimeout(180);
  }

  if (await page.locator("#sheet-world-entry-title").count()) {
    flow.customAddAttempted = true;
    await page.locator("#sheet-world-entry-title").fill("Exhaustive Test Book");
    await page.locator("#sheet-world-entry-author").fill("Reader Bot");
    await page.locator("#sheet-world-entry-pages").fill("360");
    if (await page.locator("#sheet-world-entry-category").count()) {
      await page.locator("#sheet-world-entry-category").selectOption("logic");
    }
  }

  if (await page.locator("#sheet-world-entry-add-btn").count()) {
    await page.locator("#sheet-world-entry-add-btn").click();
    flow.addTriggered = true;
    await page.waitForTimeout(320);
  }

  scenario.snapshots.push({ name: "entry-flow", state: await readTextState(page) });
  await screenshot(page, `${scenario.id}-entry-flow.png`);
  await closeAllSheets(page);
  return flow;
}

async function runPanelFlow(page, scenario) {
  const flow = {
    panelOpened: false,
    attrsOpened: false,
    skillsOpened: false,
    achievementsOpened: false
  };

  const openPanel = async () => {
    const result = await openHotspot(page, hotspotPlan[0]);
    return result.opened && result.matched;
  };

  flow.panelOpened = await openPanel();
  if (!flow.panelOpened) return flow;

  if (await page.locator("#sheet-world-panel-attrs-btn").count()) {
    await page.locator("#sheet-world-panel-attrs-btn").click();
    await page.waitForTimeout(240);
    flow.attrsOpened = Boolean(await page.locator(".attribute-list, .attr-rpg-row").count());
    await closeAllSheets(page);
  }

  if (await openPanel()) {
    if (await page.locator("#sheet-world-panel-skills-btn").count()) {
      await page.locator("#sheet-world-panel-skills-btn").click();
      await page.waitForTimeout(240);
      flow.skillsOpened = Boolean(await page.locator(".skill-crest, .chip-list").count());
      await closeAllSheets(page);
    }
  }

  if (await openPanel()) {
    if (await page.locator("#sheet-world-panel-achievements-btn").count()) {
      await page.locator("#sheet-world-panel-achievements-btn").click();
      await page.waitForTimeout(240);
      flow.achievementsOpened = Boolean(await page.locator(".chip-list .chip").count());
      await closeAllSheets(page);
    }
  }

  scenario.snapshots.push({ name: "panel-flow", state: await readTextState(page) });
  return flow;
}

async function runShelfFlow(page, scenario) {
  const flow = {
    shelfOpened: false,
    detailOpened: false,
    progressSaved: false,
    reflectionSaved: false,
    reflectionEditOpened: false,
    reflectionDeleteAttempted: false
  };

  const result = await openHotspot(page, hotspotPlan[2]);
  flow.shelfOpened = result.opened;
  if (!flow.shelfOpened) return flow;

  if (await page.locator(".sheet-open-book-detail").count()) {
    await page.locator(".sheet-open-book-detail").first().click();
    await page.waitForTimeout(260);
    flow.detailOpened = true;
  }

  if (await page.locator("#sheet-book-progress-range").count()) {
    await page.locator("#sheet-book-progress-range").fill("35");
    await page.waitForTimeout(120);
    if (await page.locator("#sheet-save-progress-btn").count()) {
      await page.locator("#sheet-save-progress-btn").click();
      await page.waitForTimeout(220);
      flow.progressSaved = true;
    }
  }

  if (await page.locator("#sheet-reflection-input").count()) {
    await page.locator("#sheet-reflection-input").fill("Automated reflection for exhaustive flow.");
    if (await page.locator("#sheet-save-reflection-btn").count()) {
      await page.locator("#sheet-save-reflection-btn").click();
      await page.waitForTimeout(240);
      flow.reflectionSaved = true;
    }
  }

  if (await page.locator(".sheet-reflection-edit").count()) {
    flow.reflectionEditOpened = await clickFirstWithRetry(page, ".sheet-reflection-edit");
    await page.waitForTimeout(180);
    if (await page.locator("#sheet-cancel-reflection-btn").count()) {
      await page.locator("#sheet-cancel-reflection-btn").click();
      await page.waitForTimeout(160);
    }
  }

  if (await page.locator(".sheet-reflection-delete").count()) {
    flow.reflectionDeleteAttempted = await clickFirstWithRetry(page, ".sheet-reflection-delete");
    await page.waitForTimeout(220);
  }

  scenario.snapshots.push({ name: "shelf-flow", state: await readTextState(page) });
  await screenshot(page, `${scenario.id}-shelf-flow.png`);
  await closeAllSheets(page);
  return flow;
}

async function runShareFlow(page, scenario) {
  const flow = { opened: false, inviteCopyClicked: false, shareCopyClicked: false };
  await resetWorldActionState(page);
  await closeAllSheets(page);
  await page.locator("#world-share-btn").click();
  flow.opened = await waitForSheetVisible(page, 5000);
  if (!flow.opened) return flow;

  if (await page.locator("#sheet-share-nickname-input").count()) {
    await page.locator("#sheet-share-nickname-input").fill("ExhaustiveUser");
    await page.waitForTimeout(120);
  }

  if (await page.locator("#sheet-share-copy-invite-btn").count()) {
    await page.locator("#sheet-share-copy-invite-btn").click();
    flow.inviteCopyClicked = true;
    await page.waitForTimeout(120);
  }
  if (await page.locator("#sheet-share-copy-btn").count()) {
    await page.locator("#sheet-share-copy-btn").click();
    flow.shareCopyClicked = true;
    await page.waitForTimeout(120);
  }

  scenario.snapshots.push({ name: "share-flow", state: await readTextState(page) });
  await screenshot(page, `${scenario.id}-share-flow.png`);
  await closeAllSheets(page);
  return flow;
}

async function runSettingsFlow(page, scenario) {
  const flow = {
    opened: false,
    bgmToggled: false,
    sfxToggled: false,
    privacyOpened: false,
    resetAttempted: false,
    backdropCloseWorked: false
  };

  await resetWorldActionState(page);
  const settingsResult = await openHotspot(page, hotspotPlan[3]);
  flow.opened = settingsResult.opened;
  if (!flow.opened) return flow;

  if (await page.locator("#sheet-world-settings-bgm-toggle-btn").count()) {
    await page.locator("#sheet-world-settings-bgm-toggle-btn").click();
    await page.waitForTimeout(140);
    flow.bgmToggled = true;
  }
  if (await page.locator("#sheet-world-settings-sfx-toggle-btn").count()) {
    await page.locator("#sheet-world-settings-sfx-toggle-btn").click();
    await page.waitForTimeout(140);
    flow.sfxToggled = true;
  }

  if (await page.locator("#sheet-world-settings-privacy-btn").count()) {
    await page.locator("#sheet-world-settings-privacy-btn").click();
    await page.waitForTimeout(160);
    if (await page.locator("#privacy-dialog[open]").count()) {
      flow.privacyOpened = true;
      await page.locator("#privacy-close-btn").click();
      await page.waitForTimeout(180);
    }
  }

  const reopened = await openHotspot(page, hotspotPlan[3]);
  if (reopened.opened && (await page.locator("#sheet-world-settings-reset-btn").count())) {
    await page.locator("#sheet-world-settings-reset-btn").click();
    await page.waitForTimeout(220);
    flow.resetAttempted = true;
  }

  if (await page.locator("#sheet-dialog[open]").count()) {
    await page.mouse.click(20, 20);
    await page.waitForTimeout(240);
    flow.backdropCloseWorked = !(await page.locator("#sheet-dialog[open]").count());
  }

  scenario.snapshots.push({ name: "settings-flow", state: await readTextState(page) });
  await screenshot(page, `${scenario.id}-settings-flow.png`);
  await closeAllSheets(page);
  return flow;
}

async function runWorldMovement(page, scenario) {
  const flow = { moved: false, waypoints: [] };
  const before = await readTextState(page);

  const points = [
    [0.5, 0.78],
    [0.2, 0.76],
    [0.78, 0.74],
    [0.34, 0.66],
    [0.66, 0.84]
  ];

  for (const [x, y] of points) {
    await clickWorldPercent(page, x, y);
    await advanceWorld(page, 1600);
    await closeAllSheets(page);
    flow.waypoints.push(await readTextState(page));
  }

  await page.keyboard.down("ArrowUp");
  await advanceWorld(page, 420);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("ArrowRight");
  await advanceWorld(page, 420);
  await page.keyboard.up("ArrowRight");

  const after = await readTextState(page);
  if (before?.player && after?.player) {
    const dx = Math.abs((after.player.x || 0) - (before.player.x || 0));
    const dy = Math.abs((after.player.y || 0) - (before.player.y || 0));
    flow.moved = dx + dy > 20;
  }

  scenario.snapshots.push({ name: "world-movement-before", state: before });
  scenario.snapshots.push({ name: "world-movement-after", state: after });
  await screenshot(page, `${scenario.id}-world-movement.png`);
  return flow;
}

async function collectViewportVisibility(page) {
  return page.evaluate(() => {
    const selectors = [
      "#world-entry-btn",
      "#world-share-btn",
      "#world-zone-hint",
      "#world-level-chip",
      "#world-book-chip"
    ];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const report = {};
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) {
        report[selector] = { present: false };
        continue;
      }
      const rect = el.getBoundingClientRect();
      report[selector] = {
        present: true,
        visible: rect.width > 0 && rect.height > 0,
        fullyInsideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= vw && rect.bottom <= vh,
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }
    return report;
  });
}

async function runScenario(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });

  const scenario = {
    id: viewport.id,
    viewport,
    errors: [],
    consoleErrors: [],
    dialogs: [],
    snapshots: [],
    visibility: {},
    movement: null,
    hotspotResults: {},
    entryFlow: null,
    panelFlow: null,
    shelfFlow: null,
    shareFlow: null,
    settingsFlow: null,
    pass: false
  };

  page.on("pageerror", (error) => {
    scenario.errors.push(String(error));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      scenario.consoleErrors.push(msg.text());
    }
  });
  page.on("dialog", async (dialog) => {
    scenario.dialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.dismiss();
  });

  await installNetworkStubs(page);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell");
  await page.waitForTimeout(650);

  scenario.visibility = await collectViewportVisibility(page);
  await screenshot(page, `${scenario.id}-world-initial.png`);

  scenario.movement = await runWorldMovement(page, scenario);

  for (const hotspot of hotspotPlan) {
    scenario.hotspotResults[hotspot.id] = await openHotspot(page, hotspot);
    await screenshot(page, `${scenario.id}-hotspot-${hotspot.id}.png`);
    await closeAllSheets(page);
  }

  scenario.entryFlow = await runEntryFlow(page, scenario);
  scenario.panelFlow = await runPanelFlow(page, scenario);
  scenario.shelfFlow = await runShelfFlow(page, scenario);
  scenario.shareFlow = await runShareFlow(page, scenario);
  scenario.settingsFlow = await runSettingsFlow(page, scenario);

  const requiredHotspots = ["panel", "entry", "shelf", "settings", "share"];
  const allHotspotsOpened = requiredHotspots.every((id) => scenario.hotspotResults[id]?.opened);
  const allHotspotsMatched = requiredHotspots.every((id) => scenario.hotspotResults[id]?.matched);
  const nonBenignConsoleErrors = scenario.consoleErrors.filter((item) => !isBenignConsoleError(item));
  const noErrors = scenario.errors.length === 0 && nonBenignConsoleErrors.length === 0;
  const clipped = Object.values(scenario.visibility).some(
    (item) => item && item.present && (!item.visible || !item.fullyInsideViewport)
  );

  scenario.pass = Boolean(
    noErrors &&
      allHotspotsOpened &&
      allHotspotsMatched &&
      scenario.movement?.moved &&
      !clipped &&
      scenario.entryFlow?.addTriggered &&
      scenario.panelFlow?.panelOpened &&
      scenario.settingsFlow?.opened &&
      scenario.shareFlow?.opened &&
      scenario.shelfFlow?.shelfOpened
  );

  await screenshot(page, `${scenario.id}-world-final.png`);
  await context.close();
  return scenario;
}

async function run() {
  cleanOutput();
  const server = await startServerIfNeeded();
  const browser = await chromium.launch({ headless: !headed });
  const report = {
    baseUrl,
    headed,
    startedAt: new Date().toISOString(),
    scenarios: [],
    pass: false
  };

  try {
    for (const viewport of viewports) {
      const scenario = await runScenario(browser, viewport);
      report.scenarios.push(scenario);
    }

    report.pass = report.scenarios.every((scenario) => scenario.pass);
    report.finishedAt = new Date().toISOString();
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    if (!report.pass) {
      console.error(`e2e exhaustive check failed. report: ${reportPath}`);
      process.exit(1);
    }

    console.log(`e2e exhaustive check passed. report: ${reportPath}`);
  } finally {
    await browser.close();
    if (server.spawned && server.process) {
      server.process.kill("SIGTERM");
    }
  }
}

run().catch((error) => {
  console.error(`e2e exhaustive run failed: ${error.message}`);
  process.exit(1);
});
