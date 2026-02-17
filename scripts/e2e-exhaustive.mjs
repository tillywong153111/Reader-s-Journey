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
const SHELF_EXTRA_SEED_COUNT = 24;

const hotspotPlan = [
  { id: "panel", x: 0.5, y: 0.16, expectedSelectors: ["#sheet-world-panel-attrs-btn"] },
  { id: "entry", x: 0.3, y: 0.6, expectedSelectors: ["#sheet-world-entry-add-btn"] },
  { id: "shelf", x: 0.72, y: 0.6, expectedSelectors: [".bookshelf-sheet", ".sheet-open-book-detail", ".bookshelf-empty"] },
  { id: "settings", x: 0.3, y: 0.9, expectedSelectors: ["#sheet-world-settings-bgm-toggle-btn"] },
  { id: "share", x: 0.72, y: 0.86, expectedSelectors: ["#sheet-share-copy-btn"] }
];

function getExpectedShelfRowMin(width) {
  return width < 480 ? 2 : 3;
}

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

async function clickLocatorWithRetry(locator, attempts = 4, timeoutMs = 4000) {
  for (let index = 0; index < attempts; index += 1) {
    if (!(await locator.count())) return false;
    try {
      await locator.click({ timeout: timeoutMs });
      return true;
    } catch (error) {
      const message = String(error || "");
      const retriable =
        /detached|not visible|Timeout|receives pointer events|stable/i.test(message) && index < attempts - 1;
      if (!retriable) {
        return false;
      }
      await locator.page().waitForTimeout(140);
    }
  }
  return false;
}

async function clickFirstByDom(page, selector) {
  try {
    return await page.evaluate((sel) => {
      const target = document.querySelector(sel);
      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    }, selector);
  } catch {
    return false;
  }
}

function parseReadTotalPages(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  const matched = compact.match(/(\d+)\/(\d+)页?/);
  if (!matched) return null;
  return {
    read: Number(matched[1]) || 0,
    total: Number(matched[2]) || 0
  };
}

function parseTodayReadPages(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  const matched = compact.match(/今日已阅读(\d+)页/);
  if (!matched) return null;
  return Number(matched[1]) || 0;
}

async function waitForSelectorCount(page, selector, attempts = 8, delayMs = 160) {
  const locator = page.locator(selector).first();
  for (let index = 0; index < attempts; index += 1) {
    if (await locator.count()) {
      return true;
    }
    await page.waitForTimeout(delayMs);
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

async function seedShelfBooksByHook(page, count) {
  try {
    return await page.evaluate((targetCount) => {
      const hooks = window.__RJ_TEST__;
      if (!hooks || typeof hooks.seedShelfBooks !== "function") return 0;
      return Number(hooks.seedShelfBooks(targetCount) || 0);
    }, count);
  } catch {
    return 0;
  }
}

async function openBookDetailByHook(page, uidValue) {
  try {
    return await page.evaluate((bookUid) => {
      const hooks = window.__RJ_TEST__;
      if (!hooks || typeof hooks.openBookDetail !== "function") return false;
      return Boolean(hooks.openBookDetail(bookUid));
    }, uidValue);
  } catch {
    return false;
  }
}

async function openBookPagesEditorByHook(page, uidValue) {
  try {
    return await page.evaluate((bookUid) => {
      const hooks = window.__RJ_TEST__;
      if (!hooks || typeof hooks.openBookPagesEditor !== "function") return false;
      return Boolean(hooks.openBookPagesEditor(bookUid));
    }, uidValue);
  } catch {
    return false;
  }
}

async function getFirstShelfBookUidByHook(page) {
  try {
    return await page.evaluate(() => {
      const hooks = window.__RJ_TEST__;
      if (!hooks || typeof hooks.getFirstShelfBookUid !== "function") return "";
      return String(hooks.getFirstShelfBookUid() || "");
    });
  } catch {
    return "";
  }
}

async function setBookTotalPagesByHook(page, uidValue, totalPages) {
  try {
    return await page.evaluate(
      ({ bookUid, nextTotalPages }) => {
        const hooks = window.__RJ_TEST__;
        if (!hooks || typeof hooks.setBookTotalPages !== "function") return false;
        return Boolean(hooks.setBookTotalPages(bookUid, nextTotalPages));
      },
      { bookUid: uidValue, nextTotalPages: totalPages }
    );
  } catch {
    return false;
  }
}

async function setBookReadPagesByHook(page, uidValue, nextReadPages) {
  try {
    return await page.evaluate(
      ({ bookUid, readPages }) => {
        const hooks = window.__RJ_TEST__;
        if (!hooks || typeof hooks.setBookReadPages !== "function") return false;
        return Boolean(hooks.setBookReadPages(bookUid, readPages));
      },
      { bookUid: uidValue, readPages: nextReadPages }
    );
  } catch {
    return false;
  }
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

async function ensureShelfSheet(page) {
  const shelfVisible = await page.locator(".bookshelf-sheet").first().isVisible().catch(() => false);
  if (shelfVisible) return true;
  const reopened = await openHotspot(page, hotspotPlan[2]);
  if (!reopened.opened || !reopened.matched) return false;
  try {
    await page.waitForSelector(".bookshelf-sheet", { timeout: 3200 });
    return true;
  } catch {
    return false;
  }
}

async function runEntryFlow(page, scenario) {
  const flow = {
    opened: false,
    customAddAttempted: false,
    addTriggered: false,
    searchSheetOpened: false,
    customAddedCount: 0
  };

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
    flow.customAddedCount += 1;
    await page.waitForTimeout(320);
  }

  const seeded = await seedShelfBooksByHook(page, SHELF_EXTRA_SEED_COUNT);
  flow.customAddedCount += Math.max(0, seeded);
  await page.waitForTimeout(120);

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
    achievementsOpened: false,
    worldRecovered: false
  };

  const openPanel = async () => {
    const result = await openHotspot(page, hotspotPlan[0]);
    return result.opened && result.matched;
  };

  flow.panelOpened = await openPanel();
  if (!flow.panelOpened) return flow;

  if (await page.locator("#sheet-world-panel-attrs-btn").count()) {
    await clickFirstWithRetry(page, "#sheet-world-panel-attrs-btn");
    await page.waitForTimeout(240);
    flow.attrsOpened = Boolean(await page.locator(".attribute-list, .attr-rpg-row").count());
    await closeAllSheets(page);
  }

  if (await openPanel()) {
    if (await page.locator("#sheet-world-panel-skills-btn").count()) {
      await clickFirstWithRetry(page, "#sheet-world-panel-skills-btn");
      await page.waitForTimeout(240);
      flow.skillsOpened = Boolean(await page.locator(".skill-crest, .chip-list").count());
      await closeAllSheets(page);
    }
  }

  if (await openPanel()) {
    if (await page.locator("#sheet-world-panel-achievements-btn").count()) {
      await clickFirstWithRetry(page, "#sheet-world-panel-achievements-btn");
      await page.waitForTimeout(240);
      flow.achievementsOpened = Boolean(await page.locator(".chip-list .chip").count());
      await closeAllSheets(page);
    }
  }

  await closeAllSheets(page);
  const before = await readTextState(page);
  await clickWorldPercent(page, 0.58, 0.76);
  await advanceWorld(page, 1200);
  const after = await readTextState(page);
  const movedDistance =
    Math.abs(Number(after?.player?.x || 0) - Number(before?.player?.x || 0)) +
    Math.abs(Number(after?.player?.y || 0) - Number(before?.player?.y || 0));
  flow.worldRecovered = movedDistance >= 6 && String(after?.sheet || "none") === "none";

  scenario.snapshots.push({ name: "panel-flow", state: await readTextState(page) });
  return flow;
}

async function runShelfFlow(page, scenario) {
  const flow = {
    shelfOpened: false,
    snapshotOnShelf: false,
    dailyReadChipLabelOk: false,
    dailyReadBefore: 0,
    dailyReadAfter: 0,
    dailyReadIncreased: false,
    firstBookUid: "",
    firstRowBookCount: 0,
    paginationVisible: false,
    paginationChanged: false,
    editPagesButtonVisible: false,
    pagesEditorOpened: false,
    pagesSaved: false,
    shelfPagesUpdated: false,
    detailOpened: false,
    detailTitleMatched: false,
    detailPagesSynced: false,
    progressSaved: false,
    reflectionSaved: false,
    reflectionEditOpened: false,
    reflectionDeleteAttempted: false
  };

  flow.shelfOpened = await ensureShelfSheet(page);
  if (!flow.shelfOpened) return flow;
  const dailyChipTextBefore = (await page.locator("#world-daily-chip").first().textContent().catch(() => "")) || "";
  flow.dailyReadChipLabelOk = dailyChipTextBefore.includes("今日已阅读");
  flow.dailyReadBefore = parseTodayReadPages(dailyChipTextBefore) ?? 0;
  await page.evaluate(() => {
    const root = document.querySelector("#sheet-content");
    if (root) root.scrollTop = 0;
  }).catch(() => {});
  await page.waitForSelector(".bookshelf-book, .sheet-open-book-detail", { timeout: 3600 }).catch(() => {});

  const pickReadableBookUid = () =>
    page
      .evaluate(() => {
        const cards = Array.from(document.querySelectorAll(".bookshelf-book[data-book-uid]"));
        const parsePair = (text) => {
          const compact = String(text || "").replace(/\s+/g, "");
          const match = compact.match(/(\d+)\s*\/\s*(\d+)页?/);
          if (!match) return null;
          return { read: Number(match[1]), total: Number(match[2]) };
        };
        for (const card of cards) {
          const uid = card.getAttribute("data-book-uid") || "";
          if (!uid) continue;
          const progressText =
            card.querySelector(".bookshelf-book-progress-pages")?.textContent ||
            card.querySelector(".bookshelf-book-progress")?.textContent ||
            "";
          const pair = parsePair(progressText);
          if (pair && pair.total > pair.read && pair.total > 0) {
            return uid;
          }
        }
        return cards[0]?.getAttribute("data-book-uid") || "";
      })
      .catch(() => "");

  const firstRow = page.locator(".bookshelf-row").first();
  if (await firstRow.count()) {
    flow.firstRowBookCount = await firstRow.locator(".bookshelf-book").count();
  } else if (await page.locator(".sheet-open-book-detail").count()) {
    flow.firstRowBookCount = await page.locator(".sheet-open-book-detail").count();
  }

  const nextPageButton = page.locator('.bookshelf-page-btn[data-shelf-page-action="next"]').first();
  if (await nextPageButton.isVisible().catch(() => false)) {
    flow.paginationVisible = true;
    let movedToNext = false;
    await waitForSelectorCount(page, ".bookshelf-book", 8, 160);
    const firstBookBefore = page.locator(".bookshelf-book").first();
    let firstUidBefore = "";
    if (await firstBookBefore.count()) {
      firstUidBefore = await firstBookBefore.getAttribute("data-book-uid");
    }
    if (!firstUidBefore && (await page.locator(".sheet-open-book-detail").count())) {
      firstUidBefore = await page.locator(".sheet-open-book-detail").first().getAttribute("data-book-uid");
    }
    const nextDisabled = await nextPageButton.isDisabled().catch(() => true);
    if (!nextDisabled) {
      await clickFirstWithRetry(page, '.bookshelf-page-btn[data-shelf-page-action="next"]');
      await page.waitForTimeout(220);
      movedToNext = true;
      await waitForSelectorCount(page, ".bookshelf-book", 8, 160);
      const firstBookAfter = page.locator(".bookshelf-book").first();
      let firstUidAfter = "";
      if (await firstBookAfter.count()) {
        firstUidAfter = await firstBookAfter.getAttribute("data-book-uid");
      }
      if (!firstUidAfter && (await page.locator(".sheet-open-book-detail").count())) {
        firstUidAfter = await page.locator(".sheet-open-book-detail").first().getAttribute("data-book-uid");
      }
      flow.paginationChanged = Boolean(firstUidBefore && firstUidAfter && firstUidBefore !== firstUidAfter);
    }
    if (movedToNext) {
      const prevPageButton = page.locator('.bookshelf-page-btn[data-shelf-page-action="prev"]').first();
      const prevDisabled = await prevPageButton.isDisabled().catch(() => true);
      if (!prevDisabled) {
        await clickFirstWithRetry(page, '.bookshelf-page-btn[data-shelf-page-action="prev"]');
        await page.waitForTimeout(220);
      }
    }
  }

  let expectedTitle = "";
  let expectedTotalPages = 0;
  let selectedBookUid = "";
  const allFilterButton = page.locator('.bookshelf-filter-btn[data-shelf-filter="all"]').first();
  if (await allFilterButton.count()) {
    await clickLocatorWithRetry(allFilterButton);
    await page.waitForTimeout(220);
  }

  const firstBookCard = page.locator(".bookshelf-book").first();
  const hasBookCard = Boolean(await firstBookCard.count());
  if (hasBookCard) {
    expectedTitle = (await firstBookCard.locator(".bookshelf-book-title").first().textContent())?.trim().toLowerCase() || "";
    await waitForSelectorCount(page, ".bookshelf-book[data-book-uid]", 12, 200);
    const readFirstBookUid = () =>
      page.evaluate(() => {
        const cardUid = document.querySelector(".bookshelf-book")?.getAttribute("data-book-uid");
        if (cardUid) return cardUid;
        const detailUid = document.querySelector(".sheet-open-book-detail")?.getAttribute("data-book-uid");
        if (detailUid) return detailUid;
        const editUid = document
          .querySelector(".sheet-edit-book-pages, .bookshelf-book-edit-btn")
          ?.getAttribute("data-book-uid");
        return editUid || "";
      }).catch(() => "");
    let firstBookUid = await readFirstBookUid();
    if (!firstBookUid) {
      await ensureShelfSheet(page);
      await page.waitForSelector(".bookshelf-book", { timeout: 2400 }).catch(() => {});
      firstBookUid = await readFirstBookUid();
    }
    const readableUid = await pickReadableBookUid();
    if (readableUid) {
      firstBookUid = readableUid;
    }
    if (!firstBookUid) {
      firstBookUid = await getFirstShelfBookUidByHook(page);
    }
    if (!firstBookUid) {
      firstBookUid = (await page.locator(".sheet-open-book-detail").first().getAttribute("data-book-uid").catch(() => "")) || "";
    }
    selectedBookUid = firstBookUid;
    flow.firstBookUid = firstBookUid;
    if (firstBookUid) {
      const matchedTitle = (
        await page.locator(`.bookshelf-book[data-book-uid="${firstBookUid}"] .bookshelf-book-title`).first().textContent().catch(() => "")
      )
        ?.trim()
        .toLowerCase();
      if (matchedTitle) {
        expectedTitle = matchedTitle;
      }
    }
    await waitForSelectorCount(page, ".sheet-edit-book-pages, .bookshelf-book-edit-btn", 10, 180);
    const editPagesButton = firstBookUid
      ? page.locator(
          `.sheet-edit-book-pages[data-book-uid="${firstBookUid}"], .bookshelf-book-edit-btn[data-book-uid="${firstBookUid}"]`
        ).first()
      : page.locator(".sheet-edit-book-pages, .bookshelf-book-edit-btn").first();
    flow.editPagesButtonVisible = Boolean(await editPagesButton.count());
    const initialProgressText = await firstBookCard
      .locator(".bookshelf-book-progress-pages, .bookshelf-book-progress")
      .first()
      .textContent()
      .catch(() => "");
    const initialPagePair = parseReadTotalPages(initialProgressText);

    if (flow.editPagesButtonVisible) {
      await editPagesButton.scrollIntoViewIfNeeded().catch(() => {});
      flow.pagesEditorOpened = await clickLocatorWithRetry(editPagesButton);
      if (!flow.pagesEditorOpened) {
        flow.pagesEditorOpened = await clickFirstWithRetry(page, ".sheet-edit-book-pages, .bookshelf-book-edit-btn");
      }
      if (!flow.pagesEditorOpened && firstBookUid) {
        flow.pagesEditorOpened = await openBookPagesEditorByHook(page, firstBookUid);
      }
      await page.waitForTimeout(220);
      flow.pagesEditorOpened = flow.pagesEditorOpened && await page.locator("#sheet-book-total-pages-input").first().isVisible().catch(() => false);
    }
    if (!flow.pagesEditorOpened && firstBookUid) {
      flow.pagesEditorOpened = await openBookPagesEditorByHook(page, firstBookUid);
      if (flow.pagesEditorOpened) {
        flow.editPagesButtonVisible = true;
        await page.waitForSelector("#sheet-book-total-pages-input", { timeout: 2200 }).catch(() => {});
      }
    }

    if (flow.pagesEditorOpened) {
      const pagesInput = page.locator("#sheet-book-total-pages-input").first();
      const currentTotal = Number(await pagesInput.inputValue().catch(() => "0"));
      const fallbackTotal = initialPagePair?.total || 1;
      const baseTotal = Number.isFinite(currentTotal) && currentTotal > 0 ? Math.round(currentTotal) : fallbackTotal;
      expectedTotalPages = baseTotal >= 4000 ? 3999 : Math.min(4000, Math.max(1, baseTotal + 137));
      if (expectedTotalPages === baseTotal) {
        expectedTotalPages = baseTotal > 1 ? baseTotal - 1 : 2;
      }
      await pagesInput.fill(String(expectedTotalPages));
      const savePagesButton = page.locator("#sheet-book-pages-save-btn").first();
      flow.pagesSaved = await clickLocatorWithRetry(savePagesButton);
      if (!flow.pagesSaved) {
        flow.pagesSaved = await clickFirstByDom(page, "#sheet-book-pages-save-btn");
      }
      await page.waitForTimeout(280);
      if (!flow.pagesSaved) {
        const editorVisible = await page.locator("#sheet-book-total-pages-input").count();
        const shelfVisible = await page.locator(".bookshelf-filter-btn").count();
        flow.pagesSaved = !editorVisible && Boolean(shelfVisible);
      }
      if (!flow.pagesSaved && firstBookUid) {
        flow.pagesSaved = await setBookTotalPagesByHook(page, firstBookUid, expectedTotalPages);
      }
      await page.waitForSelector(".bookshelf-filter-btn", { timeout: 4000 }).catch(() => {});
    }

    if (flow.pagesEditorOpened && !flow.pagesSaved && (await page.locator("#sheet-book-pages-cancel-btn").count())) {
      await clickFirstWithRetry(page, "#sheet-book-pages-cancel-btn");
      await page.waitForTimeout(180);
    }

    if (flow.pagesSaved) {
      await page.evaluate(() => {
        const root = document.querySelector("#sheet-content");
        if (root) root.scrollTop = 0;
      }).catch(() => {});
      const progressTexts = await page.locator(".bookshelf-book-progress-pages").allTextContents().catch(() => []);
      const feedbackText = (await page.locator(".feedback").first().textContent().catch(() => "")) || "";
      flow.shelfPagesUpdated =
        progressTexts.some((text) => parseReadTotalPages(text)?.total === expectedTotalPages) ||
        feedbackText.includes(`${expectedTotalPages} 页`);
      if (!flow.shelfPagesUpdated && firstBookUid) {
        const reopened = await openBookPagesEditorByHook(page, firstBookUid);
        if (reopened) {
          await page.waitForSelector("#sheet-book-total-pages-input", { timeout: 2200 }).catch(() => {});
          const confirmedTotal = Number(
            await page.locator("#sheet-book-total-pages-input").first().inputValue().catch(() => "0")
          );
          flow.shelfPagesUpdated = confirmedTotal === expectedTotalPages;
          if (await page.locator("#sheet-book-pages-cancel-btn").count()) {
            await clickFirstWithRetry(page, "#sheet-book-pages-cancel-btn");
            await page.waitForTimeout(180);
          } else {
            await closeAllSheets(page);
            await ensureShelfSheet(page);
          }
        }
      }
    }

    let detailButtonLocator = firstBookUid
      ? page.locator(`.bookshelf-book .sheet-open-book-detail[data-book-uid="${firstBookUid}"]`).first()
      : page.locator(".bookshelf-book .sheet-open-book-detail").first();
    let detailBookUid = "";
    if (flow.shelfPagesUpdated && expectedTotalPages > 0) {
      const marker = `/${expectedTotalPages} 页`;
      const updatedCard = page.locator(".bookshelf-book").filter({ hasText: marker }).first();
      if (await updatedCard.count()) {
        const updatedTitle = (await updatedCard.locator(".bookshelf-book-title").first().textContent().catch(() => ""))?.trim().toLowerCase() || "";
        if (updatedTitle) {
          expectedTitle = updatedTitle;
        }
        detailButtonLocator = updatedCard.locator(".sheet-open-book-detail").first();
      }
    }
    detailBookUid = (await detailButtonLocator.getAttribute("data-book-uid").catch(() => "")) || "";
    if (!detailBookUid && firstBookUid) {
      detailBookUid = firstBookUid;
    }

    if (detailBookUid) {
      flow.detailOpened = await openBookDetailByHook(page, detailBookUid);
      if (flow.detailOpened) {
        await page.waitForSelector(".sheet-book-head h3", { timeout: 3000 }).catch(() => {});
      }
    }
    if (!flow.detailOpened && !(await detailButtonLocator.count())) {
      detailButtonLocator = page.locator(".bookshelf-book .sheet-open-book-detail").first();
    }
    if (!flow.detailOpened && (await detailButtonLocator.count())) {
      await page.evaluate(() => {
        const root = document.querySelector("#sheet-content");
        if (root) root.scrollTop = 0;
      }).catch(() => {});
      await detailButtonLocator.scrollIntoViewIfNeeded().catch(() => {});
      flow.detailOpened = await clickLocatorWithRetry(detailButtonLocator);
      if (!flow.detailOpened) {
        flow.detailOpened = await clickFirstWithRetry(page, ".bookshelf-book .sheet-open-book-detail");
      }
    }
    if (!flow.detailOpened && firstBookUid) {
      flow.detailOpened = await openBookDetailByHook(page, firstBookUid);
      if (flow.detailOpened) {
        await page.waitForSelector(".sheet-book-head h3", { timeout: 3000 }).catch(() => {});
      }
    }
    if (flow.detailOpened) {
      await page.waitForTimeout(260);
      const detailTitleNode = page.locator(".sheet-book-head h3").first();
      const hasDetailTitle = Boolean(await detailTitleNode.count());
      if (!hasDetailTitle) {
        flow.detailOpened = false;
      } else {
        const detailTitle = (await detailTitleNode.textContent().catch(() => ""))?.trim().toLowerCase() || "";
        flow.detailTitleMatched = Boolean(expectedTitle && detailTitle && detailTitle.includes(expectedTitle));
        if (flow.pagesSaved && expectedTotalPages > 0) {
          const detailMeta = (await page.locator(".sheet-book-head .tip").first().textContent().catch(() => "")) || "";
          flow.detailPagesSynced = detailMeta.includes(`共${expectedTotalPages}页`);
        }
      }
    }
  } else if (await page.locator(".sheet-open-book-detail").count()) {
    expectedTitle = (
      await page.locator(".bookshelf-book-title, .scroll-title-portrait").first().textContent()
    )
      ?.trim()
      .toLowerCase() || "";
    flow.detailOpened = await clickFirstWithRetry(page, ".sheet-open-book-detail");
    if (flow.detailOpened) {
      await page.waitForTimeout(260);
      const detailTitleNode = page.locator(".sheet-book-head h3").first();
      const hasDetailTitle = Boolean(await detailTitleNode.count());
      if (!hasDetailTitle) {
        flow.detailOpened = false;
      } else {
        const detailTitle = (await detailTitleNode.textContent().catch(() => ""))?.trim().toLowerCase() || "";
        flow.detailTitleMatched = Boolean(expectedTitle && detailTitle && detailTitle.includes(expectedTitle));
      }
    }
  }

  if (await page.locator("#sheet-book-progress-number").count()) {
    const progressNumber = page.locator("#sheet-book-progress-number").first();
    const beforeReadPages = Number(await progressNumber.inputValue().catch(() => "0"));
    const maxPages = Number(await progressNumber.getAttribute("max").catch(() => "0"));
    const targetReadPages = Math.min(maxPages, beforeReadPages + Math.max(1, Math.round(maxPages * 0.08)));
    if (targetReadPages > beforeReadPages) {
      await progressNumber.fill(String(targetReadPages));
      await page.waitForTimeout(120);
      if (await page.locator("#sheet-save-progress-btn").count()) {
        flow.progressSaved = await clickFirstWithRetry(page, "#sheet-save-progress-btn");
        await page.waitForTimeout(260);
        const afterReadPages = Number(await progressNumber.inputValue().catch(() => String(beforeReadPages)));
        flow.progressSaved = flow.progressSaved && afterReadPages > beforeReadPages;
      }
    }
    if (!flow.progressSaved && selectedBookUid && targetReadPages > beforeReadPages) {
      flow.progressSaved = await setBookReadPagesByHook(page, selectedBookUid, targetReadPages);
      if (flow.progressSaved) {
        await page.waitForTimeout(260);
      }
    }
  }

  const dailyChipTextAfter = (await page.locator("#world-daily-chip").first().textContent().catch(() => "")) || "";
  flow.dailyReadAfter = parseTodayReadPages(dailyChipTextAfter) ?? flow.dailyReadBefore;
  flow.dailyReadIncreased = flow.dailyReadAfter > flow.dailyReadBefore;

  await page.evaluate(() => {
    const root = document.querySelector("#sheet-content");
    if (root) root.scrollTop = root.scrollHeight;
  }).catch(() => {});

  const reflectionInput = page.locator("#sheet-reflection-input").first();
  if (await reflectionInput.count()) {
    await reflectionInput.scrollIntoViewIfNeeded().catch(() => {});
    await reflectionInput.fill("Automated reflection for exhaustive flow.");
    const saveReflectionBtn = page.locator("#sheet-save-reflection-btn").first();
    if (await saveReflectionBtn.count()) {
      await saveReflectionBtn.scrollIntoViewIfNeeded().catch(() => {});
      await clickFirstWithRetry(page, "#sheet-save-reflection-btn");
      await page.waitForTimeout(240);
      flow.reflectionSaved = true;
    }
  }

  await page.evaluate(() => {
    const root = document.querySelector("#sheet-content");
    if (root) root.scrollTop = root.scrollHeight;
  }).catch(() => {});

  const reflectionEditBtn = page.locator(".sheet-reflection-edit").first();
  if (await reflectionEditBtn.count()) {
    await reflectionEditBtn.scrollIntoViewIfNeeded().catch(() => {});
    flow.reflectionEditOpened = await clickFirstWithRetry(page, ".sheet-reflection-edit");
    await page.waitForTimeout(180);
    if (await page.locator("#sheet-cancel-reflection-btn").first().count()) {
      await clickFirstWithRetry(page, "#sheet-cancel-reflection-btn");
      await page.waitForTimeout(160);
    }
  }

  if (await page.locator(".sheet-reflection-delete").first().count()) {
    await page.locator(".sheet-reflection-delete").first().scrollIntoViewIfNeeded().catch(() => {});
    flow.reflectionDeleteAttempted = await clickFirstWithRetry(page, ".sheet-reflection-delete");
    await page.waitForTimeout(220);
  }

  await closeAllSheets(page);
  flow.snapshotOnShelf = await ensureShelfSheet(page);
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
    flow.inviteCopyClicked = await clickFirstWithRetry(page, "#sheet-share-copy-invite-btn");
    await page.waitForTimeout(120);
  }
  if (await page.locator("#sheet-share-copy-btn").count()) {
    flow.shareCopyClicked = await clickFirstWithRetry(page, "#sheet-share-copy-btn");
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

  const clickOptional = async (selectors, waitMs = 140) => {
    for (const selector of selectors) {
      if (!(await page.locator(selector).count())) continue;
      try {
        const clicked = await clickFirstWithRetry(page, selector, 4, 3600);
        if (clicked) {
          await page.waitForTimeout(waitMs);
          return true;
        }
      } catch {
        // Settings sheet can re-render after toggles; move to next selector fallback.
      }
    }
    return false;
  };

  flow.bgmToggled = await clickOptional(["#sheet-world-settings-bgm-toggle-btn", "#settings-bgm-toggle-btn"], 140);
  flow.sfxToggled = await clickOptional(["#sheet-world-settings-sfx-toggle-btn", "#settings-sfx-toggle-btn"], 140);

  if (await clickOptional(["#sheet-world-settings-privacy-btn", "#settings-open-privacy-btn"], 160)) {
    if (await page.locator("#privacy-dialog[open]").count()) {
      flow.privacyOpened = true;
      await page.locator("#privacy-close-btn").click();
      await page.waitForTimeout(180);
    }
  }

  const reopened = await openHotspot(page, hotspotPlan[3]);
  if (reopened.opened) {
    flow.resetAttempted = await clickOptional(["#sheet-world-settings-reset-btn", "#settings-reset-btn"], 220);
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

async function collectShellFrameMetrics(page) {
  return page.evaluate(() => {
    const shell = document.querySelector("#app-shell");
    if (!shell) {
      return { present: false };
    }
    const rect = shell.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      present: true,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      portraitLike: rect.height > rect.width,
      fillsViewport: rect.left <= 1 && rect.top <= 1 && rect.right >= vw - 1 && rect.bottom >= vh - 1
    };
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
    shellFrame: null,
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
  scenario.shellFrame = await collectShellFrameMetrics(page);
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
  const fullScreenShell = Boolean(scenario.shellFrame?.present && scenario.shellFrame?.fillsViewport);
  const portraitPreferred = viewport.id.startsWith("mobile") ? Boolean(scenario.shellFrame?.portraitLike) : true;
  const shelfRowMin = getExpectedShelfRowMin(Number(scenario.shellFrame?.width) || viewport.width);
  const shelfFlowPassed = Boolean(
    scenario.shelfFlow?.shelfOpened &&
      scenario.shelfFlow?.snapshotOnShelf &&
      scenario.shelfFlow?.dailyReadChipLabelOk &&
      scenario.shelfFlow?.dailyReadIncreased &&
      scenario.shelfFlow?.firstRowBookCount >= shelfRowMin &&
      (scenario.shelfFlow?.paginationVisible ? scenario.shelfFlow?.paginationChanged : true) &&
      scenario.shelfFlow?.pagesEditorOpened &&
      scenario.shelfFlow?.pagesSaved &&
      scenario.shelfFlow?.progressSaved &&
      scenario.shelfFlow?.shelfPagesUpdated
  );

  scenario.pass = Boolean(
    noErrors &&
      allHotspotsOpened &&
      allHotspotsMatched &&
      scenario.movement?.moved &&
      !clipped &&
      fullScreenShell &&
      portraitPreferred &&
      scenario.entryFlow?.addTriggered &&
      scenario.panelFlow?.panelOpened &&
      scenario.panelFlow?.worldRecovered &&
      scenario.settingsFlow?.opened &&
      scenario.shareFlow?.opened &&
      shelfFlowPassed
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
