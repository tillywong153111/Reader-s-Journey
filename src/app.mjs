import {
  ACHIEVEMENT_RULES,
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  CATEGORY_LABELS,
  REWARD_POLICY,
  SKILL_RULES
} from "./lib/constants.mjs";
import { loadCatalogData } from "./lib/catalog-loader.mjs";
import {
  applyExpGain,
  applyProgressReward,
  calculateEntryReward,
  requiredExpForLevel
} from "./lib/reward-engine.mjs";
import {
  STORAGE_KEY,
  createInitialState,
  getCategoryCounts,
  getCompletedBooks,
  loadState,
  normalizeState,
  rotateDayIfNeeded,
  saveState
} from "./lib/state.mjs";

const APP_VERSION = "1.5.0-scrolls";
const ENTRY_CUSTOM_MULTIPLIER = REWARD_POLICY.entry.custom_entry_multiplier || 0.7;
const REGULAR_PREVIEW_LIMIT = 3;
const COMPACT_PREVIEW_LIMIT = 2;
const TIGHT_PREVIEW_LIMIT = 1;
const ULTRA_TIGHT_PREVIEW_LIMIT = 1;
const COMPACT_HEIGHT = 860;
const TIGHT_HEIGHT = 780;
const ULTRA_TIGHT_HEIGHT = 700;
const DEFAULT_SUGGESTION_LIMIT = 120;
const MAX_SEARCH_RESULTS = 300;
const SEARCH_SHEET_PAGE_SIZE = 40;
const MAX_ONLINE_RESULTS = 120;
const ONLINE_OPENLIB_LIMIT = 60;
const ONLINE_GOOGLE_LIMIT = 40;
const NETWORK_TIMEOUT_MS = 8000;
const MAX_OVERFLOW_COMPENSATION = 5;
const MAX_SHELF_PREVIEW = 6;
const MAX_REFLECTION_LENGTH = 1000;
const DEFAULT_AUDIO_PROFILE = {
  masterEnabled: true,
  bgmEnabled: true,
  sfxEnabled: true,
  bgmVolume: 52,
  sfxVolume: 82,
  bgmBootstrapped: false
};

const state = rotateDayIfNeeded(loadState());
if (!state.lastSavedAt) {
  state.lastSavedAt = new Date().toISOString();
}
if (!state.appMeta || typeof state.appMeta !== "object") {
  state.appMeta = {};
}
if (!state.appMeta.catalogVersion) {
  state.appMeta.catalogVersion = "";
}
state.appMeta.schemaVersion = 4;

let activeTab = "entry";
let entryMode = "catalog";
let entrySearchQuery = "";
let selectedCatalogKey = "";
let densityMode = "regular";
let resizeRaf = 0;
let entrySearchTimer = 0;
let overflowCompensation = 0;
let viewAnimationTimer = 0;
let lastHonorMessage = "每一次翻页，都会点亮你自己的星图。";
let onlineSearchBusy = false;
let onlineSearchProgressCompleted = 0;
let onlineSearchRequestId = 0;
let onlineSearchStatus = "idle";
const lastAttributeSnapshot = new Map();
const transientCatalogMap = new Map();
const reduceMotionQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

const catalogStore = {
  status: "idle",
  error: "",
  meta: {
    source: "Open Library",
    generatedAt: "",
    total: 0,
    shardCount: 0
  },
  baseList: [],
  mergedList: [],
  mergedMap: new Map(),
  mergeDirty: true
};

const sheetState = {
  type: "none",
  title: "",
  html: "",
  searchItems: [],
  searchTotal: 0,
  searchTruncated: false,
  searchLoaded: SEARCH_SHEET_PAGE_SIZE,
  query: "",
  searchMode: "offline",
  bookUid: "",
  editingReflectionId: ""
};

const elements = {
  shell: document.querySelector(".shell"),
  pageTitle: document.getElementById("app-page-title"),
  pageSubtitle: document.getElementById("app-page-subtitle"),
  headerLevelBadge: document.getElementById("header-level-badge"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  views: Array.from(document.querySelectorAll(".view")),
  entryQuestCard: document.getElementById("entry-quest-card"),
  entryHonorCard: document.getElementById("entry-honor-card"),
  entrySearchInput: document.getElementById("entry-search-input"),
  entrySearchResults: document.getElementById("entry-search-results"),
  entrySearchMoreBtn: document.getElementById("entry-search-more-btn"),
  entryOnlineSearchBtn: document.getElementById("entry-online-search-btn"),
  entryCustomModeBtn: document.getElementById("entry-custom-mode-btn"),
  entrySelectedBook: document.getElementById("entry-selected-book"),
  entryCustomFields: document.getElementById("entry-custom-fields"),
  entryTitleInput: document.getElementById("entry-title-input"),
  entryAuthorInput: document.getElementById("entry-author-input"),
  entryIsbnInput: document.getElementById("entry-isbn-input"),
  entryPagesInput: document.getElementById("entry-pages-input"),
  entryCategorySelect: document.getElementById("entry-category-select"),
  entryAddBtn: document.getElementById("entry-add-btn"),
  entryModeHint: document.getElementById("entry-mode-hint"),
  entryFeedback: document.getElementById("entry-feedback"),
  entryBooksMoreBtn: document.getElementById("entry-books-more-btn"),
  entryBookList: document.getElementById("entry-book-list"),
  panelLevelLine: document.getElementById("panel-level-line"),
  panelShelfList: document.getElementById("panel-shelf-list"),
  panelShelfMoreBtn: document.getElementById("panel-shelf-more-btn"),
  panelAttributeSummaryList: document.getElementById("panel-attribute-summary-list"),
  panelAttributesMoreBtn: document.getElementById("panel-attributes-more-btn"),
  panelSkillList: document.getElementById("panel-skill-list"),
  panelAchievementList: document.getElementById("panel-achievement-list"),
  panelSkillsMoreBtn: document.getElementById("panel-skills-more-btn"),
  panelAchievementsMoreBtn: document.getElementById("panel-achievements-more-btn"),
  shareNicknameInput: document.getElementById("share-nickname-input"),
  shareCard: document.getElementById("share-card"),
  shareCardName: document.getElementById("share-card-name"),
  shareCardLevel: document.getElementById("share-card-level"),
  shareCardAttrs: document.getElementById("share-card-attrs"),
  shareCardSkills: document.getElementById("share-card-skills"),
  shareCardInvite: document.getElementById("share-card-invite"),
  shareCopyInviteBtn: document.getElementById("share-copy-invite-btn"),
  shareCopyBtn: document.getElementById("share-copy-btn"),
  shareFeedback: document.getElementById("share-feedback"),
  settingsAudioMasterBtn: document.getElementById("settings-audio-master-btn"),
  settingsBgmToggleBtn: document.getElementById("settings-bgm-toggle-btn"),
  settingsSfxToggleBtn: document.getElementById("settings-sfx-toggle-btn"),
  settingsBgmVolume: document.getElementById("settings-bgm-volume"),
  settingsSfxVolume: document.getElementById("settings-sfx-volume"),
  settingsAudioStatus: document.getElementById("settings-audio-status"),
  settingsOpenPrivacyBtn: document.getElementById("settings-open-privacy-btn"),
  settingsExportBtn: document.getElementById("settings-export-btn"),
  settingsImportBtn: document.getElementById("settings-import-btn"),
  settingsResetBtn: document.getElementById("settings-reset-btn"),
  settingsImportFile: document.getElementById("settings-import-file"),
  settingsStorageStatus: document.getElementById("settings-storage-status"),
  settingsLastSaved: document.getElementById("settings-last-saved"),
  settingsVersion: document.getElementById("settings-version"),
  settingsFeedback: document.getElementById("settings-feedback"),
  settingsCatalogMeta: document.getElementById("settings-catalog-meta"),
  privacyDialog: document.getElementById("privacy-dialog"),
  privacyCloseBtn: document.getElementById("privacy-close-btn"),
  sheetDialog: document.getElementById("sheet-dialog"),
  sheetTitle: document.getElementById("sheet-title"),
  sheetContent: document.getElementById("sheet-content"),
  sheetCloseBtn: document.getElementById("sheet-close-btn")
};

function clampPercent(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function prefersReducedMotion() {
  return Boolean(reduceMotionQuery?.matches);
}

function getAudioProfile() {
  if (!state.profile || typeof state.profile !== "object") {
    state.profile = {
      nickname: "旅者001",
      inviteCode: "RJ-2026"
    };
  }
  const legacySoundEnabled =
    typeof state.profile.soundEnabled === "boolean" ? state.profile.soundEnabled : null;
  const merged = {
    ...DEFAULT_AUDIO_PROFILE,
    ...((state.profile.audio && typeof state.profile.audio === "object") ? state.profile.audio : {})
  };

  if (legacySoundEnabled === false) {
    merged.masterEnabled = false;
    merged.bgmEnabled = false;
    merged.sfxEnabled = false;
  }

  state.profile.audio = {
    masterEnabled: merged.masterEnabled !== false,
    bgmEnabled: merged.bgmEnabled !== false,
    sfxEnabled: merged.sfxEnabled !== false,
    bgmVolume: clampPercent(merged.bgmVolume, DEFAULT_AUDIO_PROFILE.bgmVolume),
    sfxVolume: clampPercent(merged.sfxVolume, DEFAULT_AUDIO_PROFILE.sfxVolume),
    bgmBootstrapped: Boolean(merged.bgmBootstrapped)
  };
  delete state.profile.soundEnabled;
  return state.profile.audio;
}

getAudioProfile();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function uid() {
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, "");
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ""));
}

function normalizeIsbn13(value) {
  const cleaned = String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (cleaned.length === 13) return cleaned;
  return "";
}

function formatDateTime(iso) {
  if (!iso) return "未保存";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "未保存";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getViewportHeight() {
  const shellHeight = elements.shell?.getBoundingClientRect().height || 0;
  if (shellHeight > 0) {
    return shellHeight;
  }
  if (window.visualViewport?.height) {
    return window.visualViewport.height;
  }
  return window.innerHeight || 844;
}

function getNextDensityMode() {
  const height = getViewportHeight();
  if (height <= ULTRA_TIGHT_HEIGHT) return "ultra-tight";
  if (height <= TIGHT_HEIGHT) return "tight";
  if (height <= COMPACT_HEIGHT) return "compact";
  return "regular";
}

function getBasePreviewLimit() {
  if (densityMode === "ultra-tight") return ULTRA_TIGHT_PREVIEW_LIMIT;
  if (densityMode === "tight") return TIGHT_PREVIEW_LIMIT;
  if (densityMode === "compact") return COMPACT_PREVIEW_LIMIT;
  return REGULAR_PREVIEW_LIMIT;
}

function getPreviewLimit() {
  return Math.max(1, getBasePreviewLimit() - overflowCompensation);
}

function applyDensityMode() {
  const next = getNextDensityMode();
  densityMode = next;
  if (elements.shell) {
    elements.shell.dataset.density = next;
  }
}

function createBook({
  title,
  author,
  isbn,
  pages,
  category,
  sourceType = "catalog"
}) {
  return {
    id: uid(),
    uid: uid(),
    title: title.trim(),
    author: author.trim() || "未知作者",
    isbn: isbn.trim(),
    pages: Math.max(1, Number(pages) || 320),
    category,
    sourceType,
    status: "planned",
    progress: 0,
    progressPages: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reflections: []
  };
}

function persist() {
  state.lastSavedAt = new Date().toISOString();
  if (!state.appMeta || typeof state.appMeta !== "object") {
    state.appMeta = {};
  }
  state.appMeta.lastSavedAt = state.lastSavedAt;
  state.appMeta.catalogVersion =
    catalogStore.meta.generatedAt || state.appMeta.catalogVersion || "";
  state.appMeta.schemaVersion = 4;
  saveState(state);
}

function replaceState(nextState) {
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, rotateDayIfNeeded(normalizeState(nextState)));
  getAudioProfile();
  state.lastSavedAt = state.lastSavedAt || new Date().toISOString();
  entrySearchQuery = "";
  selectedCatalogKey = "";
  entryMode = "catalog";
  onlineSearchBusy = false;
  onlineSearchProgressCompleted = 0;
  onlineSearchStatus = "idle";
  transientCatalogMap.clear();
  invalidateCatalogMerge();
}

function setEntryFeedback(text) {
  if (elements.entryFeedback) {
    elements.entryFeedback.textContent = text;
    animatePulse(elements.entryFeedback);
  }
}

function setShareFeedback(text) {
  if (elements.shareFeedback) {
    elements.shareFeedback.textContent = text;
    animatePulse(elements.shareFeedback);
  }
}

function setSettingsFeedback(text) {
  if (elements.settingsFeedback) {
    elements.settingsFeedback.textContent = text;
    animatePulse(elements.settingsFeedback);
  }
}

function animatePulse(node) {
  node.classList.remove("feedback-pulse");
  void node.offsetWidth;
  node.classList.add("feedback-pulse");
}

function triggerShellBurst(kind) {
  if (!elements.shell) return;
  const className = kind === "level" ? "burst-level" : kind === "progress" ? "burst-progress" : "burst-entry";
  elements.shell.classList.remove("burst-entry", "burst-progress", "burst-level");
  void elements.shell.offsetWidth;
  elements.shell.classList.add(className);
  window.setTimeout(() => {
    elements.shell?.classList.remove(className);
  }, 700);
}

function flashShareCard() {
  if (!elements.shareCard) return;
  elements.shareCard.classList.remove("flash");
  void elements.shareCard.offsetWidth;
  elements.shareCard.classList.add("flash");
}

function bookKey(book) {
  return `${normalizeText(book.title)}::${normalizeText(book.author)}`;
}

function invalidateCatalogMerge() {
  catalogStore.mergeDirty = true;
}

function buildCatalogItemFromStateBook(book) {
  return {
    key: `${normalizeText(book.title)}::${normalizeText(book.author)}`,
    title: book.title,
    author: book.author || "未知作者",
    isbn: book.isbn || "",
    pages: Math.max(1, Number(book.pages) || 320),
    category: book.category || "general",
    source: null
  };
}

function ensureMergedCatalog() {
  if (!catalogStore.mergeDirty) return;
  const mergedList = [...catalogStore.baseList];
  const mergedMap = new Map(catalogStore.baseList.map((item) => [item.key, item]));
  for (const book of state.books) {
    const item = buildCatalogItemFromStateBook(book);
    if (mergedMap.has(item.key)) continue;
    mergedMap.set(item.key, item);
    mergedList.push(item);
  }
  catalogStore.mergedList = mergedList;
  catalogStore.mergedMap = mergedMap;
  catalogStore.mergeDirty = false;
}

function getCatalogByKey(key) {
  if (transientCatalogMap.has(key)) {
    return transientCatalogMap.get(key) || null;
  }
  ensureMergedCatalog();
  return catalogStore.mergedMap.get(key) || null;
}

function buildOfflineCatalog() {
  ensureMergedCatalog();
  return catalogStore.mergedList;
}

function highlightMatch(text, query) {
  const value = String(text || "");
  const q = String(query || "").trim();
  if (!q) return escapeHtml(value);

  const valueLower = value.toLowerCase();
  const qLower = q.toLowerCase();
  const index = valueLower.indexOf(qLower);
  if (index === -1) return escapeHtml(value);
  const end = index + q.length;
  return `${escapeHtml(value.slice(0, index))}<mark>${escapeHtml(value.slice(index, end))}</mark>${escapeHtml(value.slice(end))}`;
}

function rankMatch(book, query) {
  const queryNorm = normalizeText(query);
  const titleNorm = normalizeText(book.title);
  const authorNorm = normalizeText(book.author);
  const isbnNorm = normalizeText(book.isbn);

  let score = 0;
  if (titleNorm === queryNorm) score += 420;
  if (titleNorm.startsWith(queryNorm)) score += 260;
  else if (titleNorm.includes(queryNorm)) score += 180;

  if (authorNorm.startsWith(queryNorm)) score += 130;
  else if (authorNorm.includes(queryNorm)) score += 90;

  if (isbnNorm.startsWith(queryNorm)) score += 70;
  else if (isbnNorm.includes(queryNorm)) score += 45;

  score += Math.max(0, 20 - Math.min(20, Math.floor(book.title.length / 2)));
  return score;
}

function inferCategoryFromText(text) {
  const source = String(text || "");
  const normalized = normalizeText(source);
  if (!normalized) return "general";
  if (/逻辑|数学|统计|算法|推理|思维|证明|批判|认知偏差|博弈|概率/.test(source)) return "logic";
  if (/心理|情绪|情感|行为|人格|认知|疗愈|精神|关系/.test(source)) return "psychology";
  if (/战略|策略|管理|商业|领导|组织|战争|投资|决策|谈判/.test(source)) return "strategy";
  if (/文学|小说|诗|散文|随笔|故事|戏剧|古典|科幻|奇幻|武侠|言情|漫画/.test(source)) return "literature";
  if (/创造|创意|设计|写作|艺术|绘画|音乐|摄影|灵感/.test(source)) return "creativity";
  if (/哲学|思想|伦理|宗教|佛|道|儒|存在|历史观/.test(source)) return "philosophy";
  return "general";
}

function buildCatalogKey(title, author) {
  return `${normalizeText(title)}::${normalizeText(author)}`;
}

function pickOpenLibraryIsbn(rawList) {
  if (!Array.isArray(rawList)) return "";
  for (const raw of rawList) {
    const normalized = normalizeIsbn13(raw);
    if (normalized) return normalized;
  }
  return "";
}

function toOnlineCatalogItemFromOpenLibrary(rawDoc, query) {
  const title = String(rawDoc?.title || "").trim();
  const author =
    Array.isArray(rawDoc?.author_name) && rawDoc.author_name[0]
      ? String(rawDoc.author_name[0]).trim()
      : "未知作者";
  if (!title) return null;
  const isbn = pickOpenLibraryIsbn(rawDoc?.isbn);
  const workKey = String(rawDoc?.key || "");
  const pageCount = Math.max(40, Math.min(2000, Number(rawDoc?.number_of_pages_median) || 320));
  const category = inferCategoryFromText(`${title} ${author} ${query}`);
  return {
    key: buildCatalogKey(title, author),
    title,
    author,
    isbn,
    pages: pageCount,
    category,
    source: {
      provider: "openlibrary-live",
      manual_online: true,
      work_url: workKey ? `https://openlibrary.org${workKey}` : "https://openlibrary.org"
    }
  };
}

function toOnlineCatalogItemFromGoogle(rawDoc, query) {
  const volume = rawDoc?.volumeInfo || {};
  const title = String(volume.title || "").trim();
  const author = Array.isArray(volume.authors) && volume.authors[0]
    ? String(volume.authors[0]).trim()
    : "未知作者";
  if (!title) return null;
  const identifiers = Array.isArray(volume.industryIdentifiers) ? volume.industryIdentifiers : [];
  let isbn = "";
  for (const item of identifiers) {
    const normalized = normalizeIsbn13(item?.identifier || "");
    if (normalized) {
      isbn = normalized;
      break;
    }
  }
  const pageCount = Math.max(40, Math.min(2000, Number(volume.pageCount) || 320));
  const categories = Array.isArray(volume.categories) ? volume.categories.join(" ") : "";
  const category = inferCategoryFromText(`${title} ${author} ${categories} ${query}`);
  return {
    key: buildCatalogKey(title, author),
    title,
    author,
    isbn,
    pages: pageCount,
    category,
    source: {
      provider: "googlebooks-live",
      manual_online: true,
      work_url: String(volume.infoLink || rawDoc?.selfLink || "https://books.google.com")
    }
  };
}

function isTimeoutLikeError(error) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  return error.name === "AbortError" || message.includes("timeout") || message.includes("aborted");
}

function toProviderMessage(provider, error) {
  if (isTimeoutLikeError(error)) {
    return `${provider} 超时`;
  }
  const message = String(error?.message || "").replace(/^error:\s*/i, "").trim();
  if (!message) return `${provider} 失败`;
  if (message.startsWith("HTTP")) return `${provider} ${message}`;
  return `${provider} 失败`;
}

async function fetchJsonWithRetry(url, options = {}) {
  const {
    retries = 2,
    timeoutMs = NETWORK_TIMEOUT_MS,
    signal = null
  } = options;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort(new DOMException("Request timeout", "AbortError"));
    }, timeoutMs);
    const abortRelay = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeout);
        throw signal.reason || new DOMException("Aborted", "AbortError");
      }
      signal.addEventListener("abort", abortRelay, { once: true });
    }
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (signal?.aborted) {
        throw signal.reason || error;
      }
      if (attempt < retries) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 240 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener("abort", abortRelay);
      }
    }
  }
  throw lastError || new Error("request failed");
}

async function searchOnlineOpenLibrary(query, signal) {
  const requests = [];
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(ONLINE_OPENLIB_LIMIT, 100)),
    fields: "key,title,author_name,isbn,number_of_pages_median,language"
  });
  if (hasCjk(query)) {
    params.set("language", "chi");
  }
  requests.push(fetchJsonWithRetry(`https://openlibrary.org/search.json?${params.toString()}`, { retries: 2, signal }));

  if (hasCjk(query)) {
    const backup = new URLSearchParams({
      q: `${query} language:chi`,
      limit: "40",
      fields: "key,title,author_name,isbn,number_of_pages_median,language"
    });
    requests.push(fetchJsonWithRetry(`https://openlibrary.org/search.json?${backup.toString()}`, { retries: 2, signal }));
  }

  const payloads = await Promise.allSettled(requests);
  const docs = [];
  for (const payload of payloads) {
    if (payload.status !== "fulfilled") continue;
    const nextDocs = Array.isArray(payload.value?.docs) ? payload.value.docs : [];
    docs.push(...nextDocs);
  }
  return docs
    .map((item) => toOnlineCatalogItemFromOpenLibrary(item, query))
    .filter(Boolean);
}

async function searchOnlineGoogleBooks(query, signal) {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(Math.min(ONLINE_GOOGLE_LIMIT, 40)),
    printType: "books"
  });
  if (hasCjk(query)) {
    params.set("langRestrict", "zh");
  }
  const payload = await fetchJsonWithRetry(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`, { retries: 2, signal });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item) => toOnlineCatalogItemFromGoogle(item, query))
    .filter(Boolean);
}

function dedupeAndRankOnlineResults(items, query) {
  const ranked = new Map();
  for (const item of items) {
    const existing = ranked.get(item.key);
    const scoreBase = rankMatch(item, query);
    const cjkBonus = hasCjk(item.title) || hasCjk(item.author) ? 220 : 0;
    const isbnBonus = item.isbn ? 40 : 0;
    const providerBonus = item.source?.provider === "openlibrary-live" ? 30 : 0;
    const score = scoreBase + cjkBonus + isbnBonus + providerBonus;
    const candidate = { ...item, _score: score };
    if (!existing || candidate._score > existing._score) {
      ranked.set(item.key, candidate);
    }
  }
  return [...ranked.values()]
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return a.title.localeCompare(b.title, "zh-CN");
    })
    .slice(0, MAX_ONLINE_RESULTS)
    .map(({ _score, ...book }) => book);
}

function searchCatalogBooks() {
  if (catalogStore.status === "loading") {
    return {
      items: [],
      total: 0,
      truncated: false,
      message: "离线书库加载中，请稍候..."
    };
  }
  if (catalogStore.status === "error") {
    return {
      items: [],
      total: 0,
      truncated: false,
      message: `书库加载失败：${catalogStore.error || "未知错误"}`
    };
  }

  const query = String(entrySearchQuery || "").trim();
  const queryNorm = normalizeText(query);
  const catalog = buildOfflineCatalog();

  if (!queryNorm) {
    const items = catalog.slice(0, DEFAULT_SUGGESTION_LIMIT);
    return {
      items,
      total: catalog.length,
      truncated: catalog.length > items.length,
      message: ""
    };
  }

  const hits = [];
  let total = 0;
  for (const book of catalog) {
    if (
      normalizeText(book.title).includes(queryNorm) ||
      normalizeText(book.author).includes(queryNorm) ||
      normalizeText(book.isbn).includes(queryNorm)
    ) {
      total += 1;
      hits.push({ book, score: rankMatch(book, query) });
    }
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.book.title.localeCompare(b.book.title, "zh-CN");
  });

  const items = hits.slice(0, MAX_SEARCH_RESULTS).map((item) => item.book);
  return {
    items,
    total,
    truncated: total > items.length,
    message: ""
  };
}

function getSelectedCatalogBook() {
  if (!selectedCatalogKey) return null;
  return getCatalogByKey(selectedCatalogKey);
}

function fillEntryFormFromCatalog(book) {
  if (!elements.entryCategorySelect) return;
  elements.entryCategorySelect.value = book.category || "";
  if (elements.entryTitleInput) elements.entryTitleInput.value = book.title || "";
  if (elements.entryAuthorInput) elements.entryAuthorInput.value = book.author || "";
  if (elements.entryIsbnInput) elements.entryIsbnInput.value = book.isbn || "";
  if (elements.entryPagesInput) elements.entryPagesInput.value = String(book.pages || 320);
}

function clearEntryCustomFields() {
  if (elements.entryTitleInput) elements.entryTitleInput.value = "";
  if (elements.entryAuthorInput) elements.entryAuthorInput.value = "";
  if (elements.entryIsbnInput) elements.entryIsbnInput.value = "";
  if (elements.entryPagesInput) elements.entryPagesInput.value = "320";
}

function setEntryMode(mode) {
  entryMode = mode;
  if (
    !elements.entryCustomModeBtn ||
    !elements.entryOnlineSearchBtn ||
    !elements.entryModeHint ||
    !elements.entryCustomFields ||
    !elements.entrySelectedBook ||
    !elements.entrySearchResults ||
    !elements.entrySearchMoreBtn
  ) {
    return;
  }

  if (mode === "custom") {
    elements.entryCustomModeBtn.textContent = "返回书库";
    elements.entryModeHint.textContent = "自编录入模式：可自由添加，奖励系数 x0.7";
    elements.entryCustomFields.classList.remove("hidden");
    elements.entrySelectedBook.classList.add("hidden");
    elements.entrySearchResults.classList.add("hidden");
    elements.entrySearchMoreBtn.classList.add("hidden");
    elements.entryOnlineSearchBtn.classList.add("hidden");
  } else {
    elements.entryCustomModeBtn.textContent = "自编录入";
    elements.entryModeHint.textContent = "书库录入模式：完整奖励；也可手动联网搜索真实书籍";
    elements.entryCustomFields.classList.add("hidden");
    elements.entrySelectedBook.classList.remove("hidden");
    elements.entrySearchResults.classList.remove("hidden");
    elements.entrySearchMoreBtn.classList.remove("hidden");
    elements.entryOnlineSearchBtn.classList.remove("hidden");
  }
}

function renderEntryQuestCard() {
  if (!elements.entryQuestCard) return;
  const remaining = Math.max(0, 3 - state.todayEntries);
  const done = getCompletedBooks(state).length;
  const questLine = remaining > 0
    ? `今日再录入 ${remaining} 本可完成节奏目标（建议上限 3 本）`
    : "今日节奏目标已完成，继续保持就很好。";
  elements.entryQuestCard.innerHTML = `
    <p class="quest-title">今日旅程任务</p>
    <p class="quest-sub">${escapeHtml(questLine)}</p>
    <p class="quest-sub">已完成 ${done} 本，当前 Lv.${state.stats.level}</p>
  `;
}

function renderEntryHonorCard() {
  if (!elements.entryHonorCard) return;
  if (!lastHonorMessage) {
    elements.entryHonorCard.classList.add("hidden");
    return;
  }
  elements.entryHonorCard.classList.remove("hidden");
  elements.entryHonorCard.textContent = lastHonorMessage;
}

function renderSelectedBookCard() {
  if (!elements.entrySelectedBook) return;
  if (entryMode === "custom") return;
  const selected = getSelectedCatalogBook();
  if (!selected) {
    elements.entrySelectedBook.classList.add("hidden");
    return;
  }
  elements.entrySelectedBook.classList.remove("hidden");
  elements.entrySelectedBook.innerHTML = `
    <p class="selection-title">${escapeHtml(selected.title)}</p>
    <p class="selection-sub">${escapeHtml(selected.author)} · ${escapeHtml(CATEGORY_LABELS[selected.category] || "通识")} · ${selected.pages}页</p>
  `;
}

function buildSearchItemHtml(item, query, active, sheetMode = false) {
  const sourceLabel = item.source?.manual_online ? "联网" : "离线";
  return `
    <button type="button" class="search-item${active ? " active" : ""}${sheetMode ? " sheet-select-book" : ""}" data-catalog-key="${escapeHtml(item.key)}">
      <p class="search-item-title">${highlightMatch(item.title, query)}</p>
      <p class="search-item-sub">${highlightMatch(item.author, query)} · ${escapeHtml(CATEGORY_LABELS[item.category] || "通识")} · ${item.pages}页 · ${sourceLabel}</p>
    </button>
  `;
}

function renderEntrySearchResults() {
  if (!elements.entrySearchResults || !elements.entrySearchMoreBtn || !elements.entryOnlineSearchBtn) return;
  const searchData = searchCatalogBooks();
  const results = searchData.items;
  const previewLimit = getPreviewLimit();
  const preview = results.slice(0, previewLimit);
  const query = String(entrySearchQuery || "").trim();

  if (searchData.message) {
    elements.entrySearchResults.innerHTML = `<div class="search-empty">${escapeHtml(searchData.message)}</div>`;
  } else if (preview.length === 0) {
    elements.entrySearchResults.innerHTML = '<div class="search-empty">没有匹配结果，可以切换到自编录入继续前进。</div>';
  } else {
    elements.entrySearchResults.innerHTML = preview
      .map((item) => buildSearchItemHtml(item, query, selectedCatalogKey === item.key))
      .join("");
  }

  elements.entrySearchMoreBtn.disabled =
    searchData.message !== "" || results.length <= previewLimit;
  if (searchData.truncated) {
    elements.entrySearchMoreBtn.textContent = `查看更多结果（共${searchData.total}）`;
  } else {
    elements.entrySearchMoreBtn.textContent = "查看更多结果";
  }

  elements.entryOnlineSearchBtn.disabled = onlineSearchBusy || query.length < 2 || entryMode !== "catalog";
  elements.entryOnlineSearchBtn.textContent = onlineSearchBusy
    ? `联网中 ${onlineSearchProgressCompleted}/2`
    : "联网搜索";
}

function renderEntryBookPreview() {
  if (!elements.entryBookList || !elements.entryBooksMoreBtn) return;
  const previewLimit = getPreviewLimit();
  const preview = state.books.slice(0, previewLimit);
  if (preview.length === 0) {
    elements.entryBookList.innerHTML =
      '<div class="item"><p class="item-title">还没有书籍</p><p class="item-sub">先录入一本，点亮你的第一颗星</p></div>';
    elements.entryBooksMoreBtn.disabled = true;
    return;
  }

  elements.entryBookList.innerHTML = preview
    .map((book) => {
      const status =
        book.status === "finished"
          ? "已完成"
          : book.status === "reading"
            ? `阅读中 ${book.progress}%`
            : "待开始";
      const source =
        book.sourceType === "custom"
          ? "自编"
          : book.sourceType === "online"
            ? "联网"
            : "书库";
      return `
        <div class="item">
          <div class="item-top">
            <p class="item-title">${escapeHtml(book.title)}</p>
            <span class="badge">${escapeHtml(status)}</span>
          </div>
          <p class="item-sub">${escapeHtml(book.author)} · ${escapeHtml(CATEGORY_LABELS[book.category] || "通识")} · ${source}</p>
        </div>
      `;
    })
    .join("");
  elements.entryBooksMoreBtn.disabled = state.books.length <= previewLimit;
}

function renderEntry() {
  setEntryMode(entryMode);
  renderEntryQuestCard();
  renderEntryHonorCard();
  renderEntrySearchResults();
  renderSelectedBookCard();
  renderEntryBookPreview();
}

function hasDuplicateBook(title, author) {
  const key = `${normalizeText(title)}::${normalizeText(author)}`;
  return state.books.some((book) => bookKey(book) === key);
}

function addEntryBook() {
  if (!elements.entryCategorySelect) return;
  const category = elements.entryCategorySelect.value;
  if (!category) {
    setEntryFeedback("请先选择分类，再将这次阅读写入旅程。");
    return;
  }

  let payload;
  let sourceType;
  let multiplier = 1;

  if (entryMode === "catalog") {
    const selected = getSelectedCatalogBook();
    if (!selected) {
      setEntryFeedback("先从搜索结果里选择一本书，再继续录入。");
      return;
    }
    payload = {
      title: selected.title,
      author: selected.author,
      isbn: selected.isbn,
      pages: selected.pages,
      category
    };
    sourceType = selected.source?.manual_online ? "online" : "catalog";
  } else {
    const title = elements.entryTitleInput?.value.trim() || "";
    const author = elements.entryAuthorInput?.value.trim() || "未知作者";
    if (!title) {
      setEntryFeedback("自编录入需要先填写书名。");
      return;
    }
    payload = {
      title,
      author,
      isbn: elements.entryIsbnInput?.value.trim() || "",
      pages: Number(elements.entryPagesInput?.value || 320),
      category
    };
    sourceType = "custom";
    multiplier = ENTRY_CUSTOM_MULTIPLIER;
  }

  if (hasDuplicateBook(payload.title, payload.author)) {
    setEntryFeedback("这本书已经在你的书单里了，不必重复录入。");
    return;
  }

  const reward = calculateEntryReward({
    historyIndex: state.books.length + 1,
    dailyIndex: state.todayEntries + 1,
    isNew: true
  });
  const points = Math.max(1, Math.round(reward.points * multiplier));
  const book = createBook({ ...payload, sourceType });

  state.books.unshift(book);
  invalidateCatalogMerge();
  state.todayEntries += 1;
  state.stats.attributes.will += points;
  const expResult = applyExpGain(state.stats.level, state.stats.exp, points);
  state.stats.level = expResult.level;
  state.stats.exp = expResult.exp;

  persist();
  selectedCatalogKey = "";
  entrySearchQuery = "";
  if (elements.entrySearchInput) elements.entrySearchInput.value = "";
  if (elements.entryCategorySelect) elements.entryCategorySelect.value = "";
  clearEntryCustomFields();
  setEntryMode("catalog");

  const suffix = sourceType === "custom" ? "（自编 x0.7）" : "";
  setEntryFeedback(`已录入《${book.title}》，意志 +${points}，经验 +${points}${suffix}。`);
  lastHonorMessage = `《${book.title}》已登记入册。坚持今天的节奏，你会走得很远。`;
  renderAll();
  triggerShellBurst("entry");
  audioEngine.playSfx("entry");
}

function getShelfBooks() {
  const reading = state.books.filter((book) => book.status === "reading");
  const finished = state.books.filter((book) => book.status === "finished");
  const sortByUpdated = (a, b) => (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  reading.sort(sortByUpdated);
  finished.sort(sortByUpdated);
  return [...reading, ...finished];
}

function getBookByUid(uidValue) {
  if (!uidValue) return null;
  return state.books.find((book) => book.uid === uidValue) || null;
}

function getPanelShelfPreviewLimit() {
  const base =
    densityMode === "ultra-tight" || densityMode === "tight"
      ? 2
      : densityMode === "compact"
        ? 3
        : 4;
  const reduced = Math.max(0, overflowCompensation - 1);
  return Math.max(1, Math.min(MAX_SHELF_PREVIEW, base - reduced));
}

function formatBookStatus(book) {
  if (book.status === "finished") return "已完成";
  if (book.status === "reading") return `阅读中 ${book.progress}%`;
  return "待开始";
}

function buildAttributeRowsHtml(keys = ATTRIBUTE_KEYS) {
  const maxAttr = Math.max(50, ...ATTRIBUTE_KEYS.map((key) => state.stats.attributes[key] || 0));
  return keys.map((key) => {
    const value = state.stats.attributes[key] || 0;
    const width = Math.max(4, Math.round((value / maxAttr) * 100));
    return `
      <div class="attr-row">
        <span class="attr-label"><img class="attr-icon" src="./assets/icons/${key}.svg" alt="" />${ATTRIBUTE_LABELS[key]}</span>
        <div class="attr-track"><div class="attr-fill" style="width:${width}%"></div></div>
        <span class="attr-value" data-attr-key="${key}" data-attr-value="${value}">${value}</span>
      </div>
    `;
  }).join("");
}

function applyBookProgressUpdate(book, nextProgressValue, { allowDecrease = false } = {}) {
  const previousProgress = Math.max(0, Math.min(100, Number(book.progress) || 0));
  const nextProgress = Math.max(0, Math.min(100, Number(nextProgressValue) || 0));
  if (nextProgress === previousProgress) {
    return {
      ok: false,
      code: "same",
      message: "进度未变化，无需保存。"
    };
  }

  if (nextProgress < previousProgress && !allowDecrease) {
    return {
      ok: false,
      code: "decrease",
      message: "新进度低于当前进度，请确认是否做校正。"
    };
  }

  if (nextProgress < previousProgress) {
    book.progress = nextProgress;
    book.progressPages = Math.round((book.pages * nextProgress) / 100);
    book.status = nextProgress >= 100 ? "finished" : nextProgress > 0 ? "reading" : "planned";
    book.updatedAt = Date.now();
    persist();
    return {
      ok: true,
      code: "corrected",
      message: `已校正到 ${nextProgress}%（不触发奖励）。`
    };
  }

  const completedBefore = getCompletedBooks(state);
  const result = applyProgressReward({
    stats: state.stats,
    book,
    previousProgress,
    nextProgress,
    completedCount: completedBefore.length,
    categoryCounts: getCategoryCounts(state),
    finishedTitles: completedBefore.map((item) => item.title)
  });

  state.stats = result.updatedStats;
  book.progress = nextProgress;
  book.progressPages = Math.round((book.pages * nextProgress) / 100);
  book.status = nextProgress >= 100 ? "finished" : "reading";
  book.updatedAt = Date.now();
  persist();
  return {
    ok: true,
    code: "reward",
    result
  };
}

function animateNumber(node, key, targetValue) {
  const target = Math.max(0, Number(targetValue) || 0);
  const from = lastAttributeSnapshot.has(key) ? lastAttributeSnapshot.get(key) : target;
  lastAttributeSnapshot.set(key, target);
  if (prefersReducedMotion() || from === target) {
    node.textContent = String(target);
    return;
  }

  const startTime = performance.now();
  const duration = 420;
  const tick = (now) => {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - (1 - progress) * (1 - progress);
    const value = Math.round(from + (target - from) * eased);
    node.textContent = String(value);
    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

function renderPanel() {
  if (
    !elements.panelLevelLine ||
    !elements.panelShelfList ||
    !elements.panelAttributeSummaryList ||
    !elements.panelSkillList ||
    !elements.panelAchievementList ||
    !elements.panelShelfMoreBtn
  ) {
    return;
  }

  const required = requiredExpForLevel(state.stats.level);
  const done = getCompletedBooks(state).length;
  elements.panelLevelLine.textContent = `Lv.${state.stats.level} · 经验 ${state.stats.exp}/${required} · 已完成 ${done} 本`;

  const topAttributes = [...ATTRIBUTE_KEYS]
    .sort((a, b) => (state.stats.attributes[b] || 0) - (state.stats.attributes[a] || 0))
    .slice(0, 3);
  elements.panelAttributeSummaryList.innerHTML = topAttributes
    .map((key) => {
      const value = state.stats.attributes[key] || 0;
      return `
        <div class="attr-mini-row">
          <span>${escapeHtml(ATTRIBUTE_LABELS[key])}</span>
          <b class="attr-mini-value" data-attr-key="${key}" data-attr-value="${value}">${value}</b>
        </div>
      `;
    })
    .join("");

  elements.panelAttributeSummaryList.querySelectorAll(".attr-mini-value").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const key = node.dataset.attrKey || "";
    const value = Number(node.dataset.attrValue || "0");
    animateNumber(node, key, value);
  });

  const shelfBooks = getShelfBooks();
  const shelfPreview = shelfBooks.slice(0, getPanelShelfPreviewLimit());
  if (shelfPreview.length === 0) {
    elements.panelShelfList.innerHTML = '<div class="scroll-empty">还没有在读或已完成书籍。先从录入页开始吧。</div>';
  } else {
    elements.panelShelfList.innerHTML = shelfPreview
      .map((book) => {
        const progress = Math.max(0, Math.min(100, Number(book.progress) || 0));
        return `
          <button type="button" class="scroll-card panel-open-book" data-book-uid="${escapeHtml(book.uid)}">
            <div class="scroll-card-head">
              <p class="scroll-title">${escapeHtml(book.title)}</p>
              <span class="badge">${escapeHtml(formatBookStatus(book))}</span>
            </div>
            <p class="scroll-sub">${escapeHtml(book.author)} · ${escapeHtml(CATEGORY_LABELS[book.category] || "通识")}</p>
            <div class="scroll-track"><div class="scroll-fill" style="width:${progress}%"></div></div>
          </button>
        `;
      })
      .join("");
  }
  elements.panelShelfMoreBtn.disabled = shelfBooks.length <= shelfPreview.length;

  const previewLimit = Math.max(1, Math.min(3, getPreviewLimit()));
  const skillPreview = state.stats.skills.slice(0, previewLimit);
  elements.panelSkillList.innerHTML =
    skillPreview.length > 0
      ? skillPreview.map((skill) => `<span class="chip active">${escapeHtml(skill.name)}</span>`).join("")
      : '<span class="chip">暂无技能</span>';

  const unlocked = new Set((state.stats.achievements || []).map((item) => item.name));
  const achievementPreview = ACHIEVEMENT_RULES.slice(0, previewLimit);
  elements.panelAchievementList.innerHTML = achievementPreview
    .map((item) => `<span class="chip${unlocked.has(item.name) ? " active" : ""}">${item.threshold}本 · ${escapeHtml(item.name)}</span>`)
    .join("");
}

function renderShare() {
  if (
    !elements.shareNicknameInput ||
    !elements.shareCardName ||
    !elements.shareCardLevel ||
    !elements.shareCardAttrs ||
    !elements.shareCardSkills ||
    !elements.shareCardInvite
  ) {
    return;
  }

  const nickname = state.profile.nickname || "旅者001";
  const done = getCompletedBooks(state).length;
  const sorted = [...ATTRIBUTE_KEYS].sort(
    (a, b) => (state.stats.attributes[b] || 0) - (state.stats.attributes[a] || 0)
  );
  const topAttrs = sorted.slice(0, 2);
  const topSkills = state.stats.skills.slice(0, 2);
  const invite = state.profile.inviteCode || "RJ-2026";

  elements.shareNicknameInput.value = nickname;
  elements.shareCardName.textContent = nickname;
  elements.shareCardLevel.textContent = `Lv.${state.stats.level} · 已完成 ${done} 本`;
  elements.shareCardAttrs.textContent = `优势属性：${topAttrs.map((key) => `${ATTRIBUTE_LABELS[key]} ${state.stats.attributes[key]}`).join(" / ")}`;
  elements.shareCardSkills.textContent =
    topSkills.length > 0
      ? `代表技能：${topSkills.map((skill) => skill.name).join(" / ")}`
      : "代表技能：尚未解锁";
  elements.shareCardInvite.textContent = `邀请码：${invite}`;
}

function getStorageUsage() {
  let totalBytes = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    const value = localStorage.getItem(key) || "";
    totalBytes += (key.length + value.length) * 2;
  }
  const appData = localStorage.getItem(STORAGE_KEY) || "";
  return {
    totalBytes,
    appBytes: appData.length * 2
  };
}

function renderSettings() {
  if (!elements.settingsStorageStatus || !elements.settingsLastSaved || !elements.settingsVersion) return;
  const usage = getStorageUsage();
  const audioProfile = getAudioProfile();

  elements.settingsStorageStatus.textContent = `本项目数据：${formatBytes(usage.appBytes)} · 本机总占用：${formatBytes(usage.totalBytes)}`;
  elements.settingsLastSaved.textContent = `最后保存：${formatDateTime(state.lastSavedAt)}`;
  elements.settingsVersion.textContent = APP_VERSION;

  if (elements.settingsAudioMasterBtn) {
    elements.settingsAudioMasterBtn.textContent = `主音频：${audioProfile.masterEnabled ? "开启" : "关闭"}`;
  }
  if (elements.settingsBgmToggleBtn) {
    elements.settingsBgmToggleBtn.textContent = `背景音乐：${audioProfile.bgmEnabled ? "开启" : "关闭"}`;
    elements.settingsBgmToggleBtn.disabled = !audioProfile.masterEnabled;
  }
  if (elements.settingsSfxToggleBtn) {
    elements.settingsSfxToggleBtn.textContent = `提示音：${audioProfile.sfxEnabled ? "开启" : "关闭"}`;
    elements.settingsSfxToggleBtn.disabled = !audioProfile.masterEnabled;
  }
  if (elements.settingsBgmVolume) {
    elements.settingsBgmVolume.value = String(audioProfile.bgmVolume);
    elements.settingsBgmVolume.disabled = !audioProfile.masterEnabled || !audioProfile.bgmEnabled;
  }
  if (elements.settingsSfxVolume) {
    elements.settingsSfxVolume.value = String(audioProfile.sfxVolume);
    elements.settingsSfxVolume.disabled = !audioProfile.masterEnabled || !audioProfile.sfxEnabled;
  }
  if (elements.settingsAudioStatus) {
    elements.settingsAudioStatus.textContent = audioEngine.getStatusText();
  }

  if (elements.settingsCatalogMeta) {
    if (catalogStore.status === "loading") {
      elements.settingsCatalogMeta.textContent = "离线书库：加载中...";
    } else if (catalogStore.status === "error") {
      elements.settingsCatalogMeta.textContent = `离线书库：加载失败（${catalogStore.error || "未知错误"}）`;
    } else {
      elements.settingsCatalogMeta.textContent =
        `离线书库：${catalogStore.meta.total} 本（来源 ${catalogStore.meta.source}，分片 ${catalogStore.meta.shardCount} 个，构建于 ${formatDateTime(catalogStore.meta.generatedAt)}）`;
    }
  }
}

function renderHeader() {
  const current = elements.views.find((view) => view.dataset.view === activeTab);
  if (!current || !elements.pageTitle || !elements.pageSubtitle) return;
  elements.pageTitle.textContent = current.dataset.title || "";
  elements.pageSubtitle.textContent = current.dataset.subtitle || "";
  if (elements.headerLevelBadge) {
    elements.headerLevelBadge.textContent = `Lv.${state.stats.level}`;
  }
}

function getActiveViewElement() {
  return elements.views.find((view) => view.dataset.view === activeTab) || null;
}

function hasInternalCardOverflow(activeView) {
  if (!(activeView instanceof HTMLElement)) return false;
  const cards = activeView.querySelectorAll(".card");
  for (const card of cards) {
    if (!(card instanceof HTMLElement)) continue;
    if (card.classList.contains("settings-main-card")) continue;
    const style = window.getComputedStyle(card);
    const overflowY = style.overflowY || style.overflow;
    if (overflowY === "visible" || overflowY === "auto" || overflowY === "scroll") {
      continue;
    }
    if (card.scrollHeight > card.clientHeight + 2) {
      return true;
    }
  }
  return false;
}

function enforceHeightSentinel() {
  const activeView = getActiveViewElement();
  if (!activeView) return;
  const hasOverflow =
    activeView.scrollHeight > activeView.clientHeight + 2 ||
    hasInternalCardOverflow(activeView);
  if (elements.shell) {
    elements.shell.dataset.overflowLevel = String(overflowCompensation);
  }
  if (elements.shell) {
    elements.shell.dataset.heightAlert = hasOverflow ? "1" : "0";
  }
  if (hasOverflow && overflowCompensation < MAX_OVERFLOW_COMPENSATION) {
    overflowCompensation += 1;
    if (elements.shell) {
      elements.shell.dataset.overflowLevel = String(overflowCompensation);
    }
    renderAll({ skipHeightSentinel: true });
    requestAnimationFrame(() => {
      enforceHeightSentinel();
    });
  }
}

function renderAll({ skipHeightSentinel = false } = {}) {
  rotateDayIfNeeded(state);
  applyDensityMode();
  renderHeader();
  renderEntry();
  renderPanel();
  renderShare();
  renderSettings();

  if (!skipHeightSentinel) {
    requestAnimationFrame(() => {
      enforceHeightSentinel();
    });
  }
}

function createAudioEngine() {
  const supportsAudio = typeof Audio !== "undefined";
  const bgmSources = [
    "./assets/audio/bgm-astral-loop.wav",
    "./assets/audio/bgm-sanctum-loop.wav"
  ];
  const sceneIndex = {
    entry: 0,
    panel: 1,
    share: 1,
    settings: 1
  };

  const bgmTracks = supportsAudio
    ? bgmSources.map((src) => {
        const audio = new Audio(src);
        audio.loop = true;
        audio.preload = "auto";
        audio.volume = 0;
        return audio;
      })
    : [];
  const sfx = supportsAudio
    ? {
        entry: new Audio("./assets/audio/entry-success.wav"),
        skill: new Audio("./assets/audio/skill-unlock.wav"),
        level: new Audio("./assets/audio/level-up.wav")
      }
    : {};

  let currentTrack = null;
  let fadeToken = 0;
  let bootstrapped = Boolean(getAudioProfile().bgmBootstrapped);

  const getBgmVolume = () => clamp01(getAudioProfile().bgmVolume / 100);
  const getSfxVolume = () => clamp01(getAudioProfile().sfxVolume / 100);

  const canPlayBgm = () => {
    const audio = getAudioProfile();
    return supportsAudio && bootstrapped && audio.masterEnabled && audio.bgmEnabled;
  };

  const canPlaySfx = () => {
    const audio = getAudioProfile();
    return supportsAudio && audio.masterEnabled && audio.sfxEnabled;
  };

  function stopBgm(immediate = false) {
    fadeToken += 1;
    const tracks = currentTrack ? [currentTrack] : bgmTracks;
    if (immediate || prefersReducedMotion()) {
      tracks.forEach((track) => {
        track.pause();
        track.volume = 0;
      });
      currentTrack = null;
      return;
    }

    const localToken = fadeToken;
    const start = performance.now();
    const duration = 860;
    const fromVolumes = tracks.map((track) => track.volume);
    const step = (now) => {
      if (localToken !== fadeToken) return;
      const progress = Math.min(1, (now - start) / duration);
      tracks.forEach((track, index) => {
        track.volume = fromVolumes[index] * (1 - progress);
      });
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        tracks.forEach((track) => {
          track.pause();
          track.volume = 0;
        });
        currentTrack = null;
      }
    };
    requestAnimationFrame(step);
  }

  function crossfadeTo(nextTrack, immediate = false) {
    if (!nextTrack) return;
    const targetVolume = getBgmVolume();

    if (currentTrack === nextTrack) {
      nextTrack.volume = targetVolume;
      if (nextTrack.paused) {
        nextTrack.play().catch(() => {});
      }
      return;
    }

    const previousTrack = currentTrack;
    currentTrack = nextTrack;
    fadeToken += 1;
    const localToken = fadeToken;
    nextTrack.volume = immediate || prefersReducedMotion() ? targetVolume : 0;
    nextTrack.play().catch(() => {});

    if (!previousTrack || immediate || prefersReducedMotion()) {
      if (previousTrack && previousTrack !== nextTrack) {
        previousTrack.pause();
        previousTrack.volume = 0;
      }
      nextTrack.volume = targetVolume;
      return;
    }

    const fromVolume = previousTrack.volume || targetVolume;
    const start = performance.now();
    const duration = 1200;

    const step = (now) => {
      if (localToken !== fadeToken) return;
      const progress = Math.min(1, (now - start) / duration);
      previousTrack.volume = fromVolume * (1 - progress);
      nextTrack.volume = targetVolume * progress;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        previousTrack.pause();
        previousTrack.volume = 0;
        nextTrack.volume = targetVolume;
      }
    };
    requestAnimationFrame(step);
  }

  function setScene(scene, immediate = false) {
    if (!supportsAudio) return;
    if (!canPlayBgm()) {
      stopBgm(false);
      return;
    }
    const index = sceneIndex[scene] ?? 0;
    const nextTrack = bgmTracks[index] || bgmTracks[0] || null;
    crossfadeTo(nextTrack, immediate);
  }

  function syncProfile() {
    if (!supportsAudio) return;
    if (!canPlayBgm()) {
      stopBgm(false);
    } else {
      setScene(activeTab, false);
    }
    const sfxVolume = getSfxVolume();
    Object.values(sfx).forEach((audio) => {
      audio.volume = sfxVolume;
    });
  }

  function bootstrap() {
    if (!supportsAudio) return;
    if (bootstrapped) {
      syncProfile();
      return;
    }
    bootstrapped = true;
    const audio = getAudioProfile();
    audio.bgmBootstrapped = true;
    persist();
    syncProfile();
  }

  function playSfx(kind) {
    if (!canPlaySfx()) return;
    const target = sfx[kind];
    if (!target) return;
    target.currentTime = 0;
    target.volume = getSfxVolume();
    target.play().catch(() => {});
  }

  function getStatusText() {
    const audio = getAudioProfile();
    if (!supportsAudio) {
      return "当前环境不支持音频播放。";
    }
    if (!audio.masterEnabled) {
      return "主音频已关闭。";
    }
    if (!bootstrapped) {
      return "等待首次点击后自动接入背景音乐。";
    }
    if (!audio.bgmEnabled && !audio.sfxEnabled) {
      return "背景音乐和提示音都已关闭。";
    }
    if (!audio.bgmEnabled) {
      return "背景音乐已关闭，仅保留提示音。";
    }
    if (!audio.sfxEnabled) {
      return "提示音已关闭，仅播放背景音乐。";
    }
    return "音频已开启：长音氛围背景音乐与提示音均可用。";
  }

  return {
    bootstrap,
    syncProfile,
    setScene,
    playSfx,
    getStatusText
  };
}

const audioEngine = createAudioEngine();

async function initializeCatalog() {
  catalogStore.status = "loading";
  catalogStore.error = "";
  renderEntrySearchResults();
  renderSettings();
  try {
    const loaded = await loadCatalogData();
    catalogStore.status = "ready";
    catalogStore.meta = loaded.meta;
    catalogStore.baseList = loaded.books;
    invalidateCatalogMerge();
    const nextVersion = loaded.meta.generatedAt || "";
    if (state.appMeta.catalogVersion !== nextVersion) {
      state.appMeta.catalogVersion = nextVersion;
      persist();
    }
  } catch (error) {
    catalogStore.status = "error";
    catalogStore.error = error instanceof Error ? error.message : "未知错误";
  }
  renderAll();
}

function onViewportResize() {
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
  }
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    overflowCompensation = 0;
    renderAll();
  });
}

function switchTab(tab, { skipAnimation = false } = {}) {
  const safeTab = elements.views.some((view) => view.dataset.view === tab) ? tab : "entry";
  activeTab = safeTab;
  elements.tabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === safeTab);
  });

  let currentView = null;
  elements.views.forEach((view) => {
    const active = view.dataset.view === safeTab;
    view.classList.toggle("active", active);
    if (active) {
      currentView = view;
    }
  });

  if (currentView && !skipAnimation && !prefersReducedMotion()) {
    currentView.classList.remove("view-enter");
    void currentView.offsetWidth;
    currentView.classList.add("view-enter");
    if (viewAnimationTimer) {
      clearTimeout(viewAnimationTimer);
    }
    viewAnimationTimer = window.setTimeout(() => {
      currentView?.classList.remove("view-enter");
    }, 260);
  }

  audioEngine.setScene(safeTab, false);
  overflowCompensation = 0;
  if (elements.shell) {
    elements.shell.dataset.overflowLevel = "0";
  }
  renderAll({ skipHeightSentinel: true });
  requestAnimationFrame(() => {
    enforceHeightSentinel();
  });
}

function openSheet(title, contentHtml) {
  if (!elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  sheetState.type = "generic";
  sheetState.title = title;
  sheetState.html = contentHtml;
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";
  elements.sheetTitle.textContent = title;
  elements.sheetContent.innerHTML = contentHtml;
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
}

function renderSearchSheet() {
  if (!elements.sheetTitle || !elements.sheetContent) return;
  const visible = sheetState.searchItems.slice(0, sheetState.searchLoaded);
  const hasMore = sheetState.searchLoaded < sheetState.searchItems.length;

  const itemsHtml = visible.length > 0
    ? visible
        .map((item) => buildSearchItemHtml(item, sheetState.query, selectedCatalogKey === item.key, true))
        .join("")
    : '<div class="search-empty">暂无可展示结果</div>';

  const footerHtml = hasMore
    ? `
      <div class="sheet-footer">
        <button type="button" class="btn-secondary sheet-load-more" id="sheet-load-more-btn">
          继续加载（剩余 ${sheetState.searchItems.length - sheetState.searchLoaded} 条）
        </button>
      </div>
    `
    : "";

  const offlineTruncatedNote = sheetState.searchTruncated
    ? `<p class="tip">当前仅缓存并展示前 ${sheetState.searchItems.length} 条，实际命中 ${sheetState.searchTotal} 条。</p>`
    : "";
  const onlineNote = sheetState.searchMode === "online"
    ? '<p class="tip">该结果来自手动联网搜索，选择后会写入你的本地书单。</p>'
    : "";
  const noteHtml = `${offlineTruncatedNote}${onlineNote}`;

  const shown = Math.min(sheetState.searchLoaded, sheetState.searchItems.length);
  if (sheetState.searchMode === "online") {
    elements.sheetTitle.textContent = `联网搜索结果（已展示 ${shown} / ${sheetState.searchTotal}）`;
  } else {
    elements.sheetTitle.textContent = `书库搜索结果（已展示 ${shown} / ${sheetState.searchTotal}）`;
  }
  elements.sheetContent.innerHTML = `${itemsHtml}${footerHtml}${noteHtml}`;
}

function openSearchSheet(searchData, mode = "offline") {
  if (!elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  sheetState.type = "search";
  sheetState.title = "书库搜索结果";
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";
  sheetState.searchItems = searchData.items;
  sheetState.searchTotal = searchData.total;
  sheetState.searchTruncated = searchData.truncated;
  sheetState.searchLoaded = Math.min(SEARCH_SHEET_PAGE_SIZE, searchData.items.length);
  sheetState.query = String(entrySearchQuery || "").trim();
  sheetState.searchMode = mode;
  renderSearchSheet();

  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
}

function closeSheet() {
  if (!elements.sheetDialog) return;
  sheetState.type = "none";
  sheetState.html = "";
  sheetState.searchItems = [];
  sheetState.searchTotal = 0;
  sheetState.searchTruncated = false;
  sheetState.searchLoaded = SEARCH_SHEET_PAGE_SIZE;
  sheetState.searchMode = "offline";
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";

  if (typeof elements.sheetDialog.close === "function") {
    elements.sheetDialog.close();
    return;
  }
  elements.sheetDialog.removeAttribute("open");
}

function onEntrySearchInput() {
  entrySearchQuery = elements.entrySearchInput?.value || "";
  selectedCatalogKey = "";
  if (entryMode !== "catalog") {
    setEntryMode("catalog");
  }
  if (entrySearchTimer) {
    clearTimeout(entrySearchTimer);
  }
  entrySearchTimer = window.setTimeout(() => {
    renderEntrySearchResults();
    renderSelectedBookCard();
  }, 120);
}

function onEntrySearchResultsClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest(".search-item");
  if (!(button instanceof HTMLButtonElement)) return;
  const key = button.dataset.catalogKey;
  if (!key) return;
  const selected = getCatalogByKey(key);
  if (!selected) return;
  selectedCatalogKey = key;
  fillEntryFormFromCatalog(selected);
  setEntryMode("catalog");
  setEntryFeedback("书籍已就位，点击“录入并结算”即可获得奖励。");
  renderEntrySearchResults();
  renderSelectedBookCard();
}

function onEntrySearchMore() {
  const searchData = searchCatalogBooks();
  const results = searchData.items;
  const previewLimit = getPreviewLimit();
  if (results.length <= previewLimit) return;
  openSearchSheet(searchData, "offline");
}

function setOnlineSearchBusy(nextBusy, completed = 0, total = 2) {
  onlineSearchBusy = nextBusy;
  if (elements.entryOnlineSearchBtn) {
    elements.entryOnlineSearchBtn.disabled =
      onlineSearchBusy || String(entrySearchQuery || "").trim().length < 2 || entryMode !== "catalog";
    elements.entryOnlineSearchBtn.textContent = onlineSearchBusy ? `联网中 ${completed}/${total}` : "联网搜索";
  }
}

function formatOnlineSearchStatusLine() {
  if (onlineSearchBusy) return "";
  if (onlineSearchStatus === "partial") {
    return "联网搜索部分返回，已优先展示可用结果。";
  }
  if (onlineSearchStatus === "success") {
    return "联网搜索完成，你可以从结果中直接选择入库。";
  }
  return "";
}

async function onEntryOnlineSearch() {
  if (onlineSearchBusy) return;
  const requestId = ++onlineSearchRequestId;
  const query = String(elements.entrySearchInput?.value || entrySearchQuery || "").trim();
  if (query.length < 2) {
    setEntryFeedback("请输入至少 2 个字符，再执行联网搜索。");
    return;
  }
  entrySearchQuery = query;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setEntryFeedback("当前离线，无法联网搜索。你仍可使用离线书库或自编录入。");
    return;
  }

  setOnlineSearchBusy(true, 0, 2);
  onlineSearchStatus = "loading";
  onlineSearchProgressCompleted = 0;
  setEntryFeedback("正在联网搜索，请稍候...");
  const requestController = new AbortController();

  const providers = [
    {
      key: "openlibrary",
      label: "OpenLibrary",
      run: () => searchOnlineOpenLibrary(query, requestController.signal)
    },
    {
      key: "googlebooks",
      label: "GoogleBooks",
      run: () => searchOnlineGoogleBooks(query, requestController.signal)
    }
  ];

  async function runProvider(provider) {
    try {
      const items = await provider.run();
      return {
        provider: provider.label,
        ok: true,
        items
      };
    } catch (error) {
      return {
        provider: provider.label,
        ok: false,
        items: [],
        error
      };
    } finally {
      if (requestId !== onlineSearchRequestId) {
        return;
      }
      onlineSearchProgressCompleted += 1;
      setOnlineSearchBusy(true, onlineSearchProgressCompleted, providers.length);
    }
  }

  try {
    const results = await Promise.all(providers.map((provider) => runProvider(provider)));
    if (requestId !== onlineSearchRequestId) {
      return;
    }
    const successResults = results.filter((item) => item.ok);
    const failResults = results.filter((item) => !item.ok);
    const merged = dedupeAndRankOnlineResults(
      successResults.flatMap((item) => item.items),
      query
    );

    if (merged.length === 0) {
      onlineSearchStatus = successResults.length > 0 ? "success" : "fail";
      if (successResults.length > 0) {
        setEntryFeedback("联网搜索未命中，建议更换关键词或使用自编录入。");
      } else {
        onlineSearchStatus = failResults.some((item) => isTimeoutLikeError(item.error)) ? "timeout" : "fail";
        const failText = failResults.map((item) => toProviderMessage(item.provider, item.error)).join("，");
        setEntryFeedback(`联网搜索失败：${failText}。可继续用离线书库或自编录入。`);
      }
      return;
    }

    for (const item of merged) {
      transientCatalogMap.set(item.key, item);
    }
    selectedCatalogKey = "";
    openSearchSheet(
      {
        items: merged,
        total: merged.length,
        truncated: false
      },
      "online"
    );
    if (failResults.length > 0) {
      onlineSearchStatus = "partial";
      const failText = failResults.map((item) => toProviderMessage(item.provider, item.error)).join("，");
      setEntryFeedback(`已展示部分联网结果（${merged.length} 本）。${failText}。`);
    } else {
      onlineSearchStatus = "success";
      setEntryFeedback(`联网搜索完成，找到 ${merged.length} 本候选书。`);
    }
  } catch {
    if (requestId !== onlineSearchRequestId) {
      return;
    }
    onlineSearchStatus = "timeout";
    setEntryFeedback("联网搜索失败，请稍后重试。");
  } finally {
    requestController.abort();
    if (requestId !== onlineSearchRequestId) {
      return;
    }
    onlineSearchProgressCompleted = 0;
    setOnlineSearchBusy(false);
    const statusLine = formatOnlineSearchStatusLine();
    if (statusLine) {
      setEntryFeedback(statusLine);
    }
    renderEntrySearchResults();
  }
}

function onEntryModeToggle() {
  if (entryMode === "catalog") {
    entryMode = "custom";
    selectedCatalogKey = "";
    clearEntryCustomFields();
    setEntryFeedback("已切换到自编录入，继续记录你的阅读。");
  } else {
    entryMode = "catalog";
    setEntryFeedback("已切换到书库选择模式。");
  }
  setEntryMode(entryMode);
  renderEntry();
}

function onEntryBooksMore() {
  const previewLimit = getPreviewLimit();
  if (state.books.length <= previewLimit) return;
  const html = state.books
    .map((book) => {
      const status =
        book.status === "finished"
          ? "已完成"
          : book.status === "reading"
            ? `阅读中 ${book.progress}%`
            : "待开始";
      return `
        <div class="item">
          <div class="item-top">
            <p class="item-title">${escapeHtml(book.title)}</p>
            <span class="badge">${escapeHtml(status)}</span>
          </div>
          <p class="item-sub">${escapeHtml(book.author)} · ${escapeHtml(CATEGORY_LABELS[book.category] || "通识")} · ${book.pages}页</p>
        </div>
      `;
    })
    .join("");
  openSheet("全部书单", html);
}

function formatReflectionDate(stamp) {
  const date = new Date(Number(stamp) || Date.now());
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function openBookDetailSheet(uidValue) {
  const book = getBookByUid(uidValue);
  if (!book || !elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  sheetState.type = "book-detail";
  sheetState.bookUid = book.uid;
  sheetState.editingReflectionId = "";
  renderBookDetailSheet();
  if (elements.sheetDialog.hasAttribute("open")) {
    return;
  }
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
}

function renderBookDetailSheet(feedbackText = "") {
  if (!elements.sheetTitle || !elements.sheetContent) return;
  const book = getBookByUid(sheetState.bookUid);
  if (!book) {
    elements.sheetTitle.textContent = "书卷详情";
    elements.sheetContent.innerHTML = '<p class="tip">该书已不存在。</p>';
    return;
  }

  const reflections = Array.isArray(book.reflections) ? [...book.reflections] : [];
  reflections.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const editingId = sheetState.editingReflectionId;
  const editingItem = editingId ? reflections.find((item) => item.id === editingId) : null;
  const reflectionValue = editingItem ? editingItem.text : "";

  const reflectionItemsHtml = reflections.length > 0
    ? reflections
        .map((item) => {
          const formatted = escapeHtml(item.text || "").replaceAll("\n", "<br />");
          return `
            <article class="reflection-item">
              <p class="reflection-meta">${formatReflectionDate(item.createdAt)} · 记录时进度 ${Number(item.progressAt || 0)}%</p>
              <p class="reflection-text">${formatted}</p>
              <div class="head-actions">
                <button type="button" class="text-btn sheet-reflection-edit" data-reflection-id="${escapeHtml(item.id)}">编辑</button>
                <button type="button" class="text-btn sheet-reflection-delete" data-reflection-id="${escapeHtml(item.id)}">删除</button>
              </div>
            </article>
          `;
        })
        .join("")
    : '<div class="scroll-empty">还没有感触记录。写下一句今日心得吧。</div>';

  const progressValue = Math.max(0, Math.min(100, Number(book.progress) || 0));
  elements.sheetTitle.textContent = "书卷详情";
  elements.sheetContent.innerHTML = `
    <section class="sheet-book-detail">
      <div class="sheet-book-head">
        <h3>${escapeHtml(book.title)}</h3>
        <p class="tip">${escapeHtml(book.author)} · ${escapeHtml(CATEGORY_LABELS[book.category] || "通识")} · 共${book.pages}页</p>
      </div>
      <section class="sheet-progress-editor">
        <div class="progress-header">
          <span>阅读进度</span>
          <strong id="sheet-book-progress-label">${progressValue}%</strong>
        </div>
        <input id="sheet-book-progress-range" type="range" min="0" max="100" value="${progressValue}" />
        <div class="sheet-progress-row">
          <input id="sheet-book-progress-number" type="number" min="0" max="100" value="${progressValue}" />
          <button type="button" class="btn-primary" id="sheet-save-progress-btn">保存进度</button>
        </div>
        <p id="sheet-book-pages-label" class="tip">已读 ${book.progressPages || 0} / ${book.pages} 页</p>
      </section>
      <section class="sheet-reflection-editor">
        <label>
          阅读感触（最多1000字）
          <textarea id="sheet-reflection-input" rows="4" maxlength="${MAX_REFLECTION_LENGTH}" placeholder="写下这次阅读带给你的启发...">${escapeHtml(reflectionValue)}</textarea>
        </label>
        <div class="inline-actions">
          <button type="button" class="btn-secondary" id="sheet-save-reflection-btn">${editingItem ? "更新感触" : "新增感触"}</button>
          ${editingItem ? '<button type="button" class="btn-ghost" id="sheet-cancel-reflection-btn">取消编辑</button>' : '<span class="tip">完整时间线会保留每一条记录</span>'}
        </div>
      </section>
      <section class="sheet-reflection-list">
        <h3>感触时间线（${reflections.length}）</h3>
        ${reflectionItemsHtml}
      </section>
      ${feedbackText ? `<p class="feedback">${escapeHtml(feedbackText)}</p>` : ""}
    </section>
  `;
}

function syncBookDetailProgressFromInput(source) {
  if (sheetState.type !== "book-detail") return;
  const range = elements.sheetContent?.querySelector("#sheet-book-progress-range");
  const numberInput = elements.sheetContent?.querySelector("#sheet-book-progress-number");
  const label = elements.sheetContent?.querySelector("#sheet-book-progress-label");
  const pagesLabel = elements.sheetContent?.querySelector("#sheet-book-pages-label");
  const book = getBookByUid(sheetState.bookUid);
  if (!(range instanceof HTMLInputElement) || !(numberInput instanceof HTMLInputElement) || !book) return;
  const value = Math.max(0, Math.min(100, Number(source instanceof HTMLInputElement ? source.value : range.value) || 0));
  range.value = String(value);
  numberInput.value = String(value);
  if (label instanceof HTMLElement) {
    label.textContent = `${value}%`;
  }
  if (pagesLabel instanceof HTMLElement) {
    pagesLabel.textContent = `已读 ${Math.round((book.pages * value) / 100)} / ${book.pages} 页`;
  }
}

function handleBookProgressSave() {
  const book = getBookByUid(sheetState.bookUid);
  const numberInput = elements.sheetContent?.querySelector("#sheet-book-progress-number");
  if (!book || !(numberInput instanceof HTMLInputElement)) return;
  const nextProgress = Math.max(0, Math.min(100, Number(numberInput.value) || 0));
  let update = applyBookProgressUpdate(book, nextProgress);
  if (!update.ok && update.code === "decrease") {
    const confirmed = window.confirm("你正在回退进度，这将作为手动校正且不会发放奖励。是否继续？");
    if (!confirmed) {
      renderBookDetailSheet("已取消进度回退。");
      return;
    }
    update = applyBookProgressUpdate(book, nextProgress, { allowDecrease: true });
  }
  if (!update.ok) {
    renderBookDetailSheet(update.message);
    return;
  }

  if (update.code === "corrected") {
    setEntryFeedback(`《${book.title}》${update.message}`);
    renderAll();
    renderBookDetailSheet(update.message);
    return;
  }

  const reward = update.result?.reward;
  if (reward) {
    if (reward.finishedNow) {
      lastHonorMessage = `《${book.title}》已完成，恭喜你把坚持变成了看得见的成果。`;
    } else {
      lastHonorMessage = `《${book.title}》推进到 ${book.progress}% ，稳稳地向前就很了不起。`;
    }
    if (reward.levelUps > 0) {
      triggerShellBurst("level");
      audioEngine.playSfx("level");
    } else if (reward.unlockedSkills.length > 0) {
      triggerShellBurst("progress");
      audioEngine.playSfx("skill");
    } else {
      triggerShellBurst("progress");
      audioEngine.playSfx("entry");
    }
    const topAttrs = Object.entries(reward.attributeGain || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1);
    const attrText = topAttrs.length > 0 ? `${ATTRIBUTE_LABELS[topAttrs[0][0]]} +${topAttrs[0][1]}` : "属性增长";
    setEntryFeedback(`已结算：经验 +${reward.expGain}，${attrText}。`);
  }

  renderAll();
  renderBookDetailSheet("进度已保存并完成结算。");
}

function handleReflectionSave() {
  const book = getBookByUid(sheetState.bookUid);
  const textarea = elements.sheetContent?.querySelector("#sheet-reflection-input");
  if (!book || !(textarea instanceof HTMLTextAreaElement)) return;
  const text = textarea.value.trim();
  if (!text) {
    renderBookDetailSheet("请先输入感触内容。");
    return;
  }
  if (text.length > MAX_REFLECTION_LENGTH) {
    renderBookDetailSheet(`单条感触最多 ${MAX_REFLECTION_LENGTH} 字。`);
    return;
  }

  const now = Date.now();
  if (!Array.isArray(book.reflections)) {
    book.reflections = [];
  }
  if (sheetState.editingReflectionId) {
    const target = book.reflections.find((item) => item.id === sheetState.editingReflectionId);
    if (target) {
      target.text = text;
      target.updatedAt = now;
      target.progressAt = book.progress;
    }
  } else {
    book.reflections.unshift({
      id: `reflection-${now}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      createdAt: now,
      updatedAt: now,
      progressAt: book.progress
    });
  }
  book.reflections.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  sheetState.editingReflectionId = "";
  book.updatedAt = now;
  persist();
  renderAll();
  renderBookDetailSheet("感触已保存。");
}

function handleReflectionEdit(reflectionId) {
  sheetState.editingReflectionId = reflectionId;
  renderBookDetailSheet("已进入编辑模式。");
}

function handleReflectionDelete(reflectionId) {
  const book = getBookByUid(sheetState.bookUid);
  if (!book || !Array.isArray(book.reflections)) return;
  const confirmed = window.confirm("确定删除这条感触吗？");
  if (!confirmed) return;
  book.reflections = book.reflections.filter((item) => item.id !== reflectionId);
  book.updatedAt = Date.now();
  persist();
  renderAll();
  renderBookDetailSheet("感触已删除。");
}

function onPanelAttributesMore() {
  const html = `<div class="attribute-list">${buildAttributeRowsHtml()}</div>`;
  openSheet("全部属性", html);
}

function onPanelShelfMore() {
  const books = getShelfBooks();
  if (books.length === 0) {
    openSheet("卷轴书架", '<div class="scroll-empty">还没有在读或已完成书籍。</div>');
    return;
  }
  const html = books
    .map((book) => {
      const progress = Math.max(0, Math.min(100, Number(book.progress) || 0));
      return `
        <button type="button" class="scroll-card sheet-open-book-detail" data-book-uid="${escapeHtml(book.uid)}">
          <div class="scroll-card-head">
            <p class="scroll-title">${escapeHtml(book.title)}</p>
            <span class="badge">${escapeHtml(formatBookStatus(book))}</span>
          </div>
          <p class="scroll-sub">${escapeHtml(book.author)} · ${escapeHtml(CATEGORY_LABELS[book.category] || "通识")}</p>
          <div class="scroll-track"><div class="scroll-fill" style="width:${progress}%"></div></div>
        </button>
      `;
    })
    .join("");
  openSheet("卷轴书架（全部）", html);
}

function onPanelSkillsMore() {
  const html =
    state.stats.skills.length > 0
      ? state.stats.skills
          .map((skill) => `<span class="chip active">${escapeHtml(skill.name)}</span>`)
          .join("")
      : '<span class="chip">暂无技能</span>';
  openSheet("全部技能", html);
}

function onPanelAchievementsMore() {
  const unlocked = new Set((state.stats.achievements || []).map((item) => item.name));
  const html = ACHIEVEMENT_RULES
    .map((item) => {
      return `<span class="chip${unlocked.has(item.name) ? " active" : ""}">${item.threshold}本 · ${escapeHtml(item.name)} · ${escapeHtml(item.title)}</span>`;
    })
    .join("");
  openSheet("全部成就", html);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function onNicknameChange() {
  if (!elements.shareNicknameInput) return;
  state.profile.nickname = elements.shareNicknameInput.value.trim() || "旅者001";
  persist();
  renderShare();
}

async function onCopyInvite() {
  const code = state.profile.inviteCode || "RJ-2026";
  try {
    await copyText(code);
    setShareFeedback("邀请码已复制。愿你把阅读火种传给下一位旅者。");
    flashShareCard();
  } catch {
    setShareFeedback(`复制失败，请手动复制：${code}`);
  }
}

async function onCopyShare() {
  const nickname = state.profile.nickname || "旅者001";
  const done = getCompletedBooks(state).length;
  const topKey = [...ATTRIBUTE_KEYS].sort(
    (a, b) => (state.stats.attributes[b] || 0) - (state.stats.attributes[a] || 0)
  )[0];
  const text = `我是${nickname}，当前 Lv.${state.stats.level}，已完成 ${done} 本，${ATTRIBUTE_LABELS[topKey]} ${state.stats.attributes[topKey]}。邀请码：${state.profile.inviteCode || "RJ-2026"}`;
  try {
    await copyText(text);
    setShareFeedback("分享文案已复制，去告诉朋友你的阅读轨迹吧。");
    flashShareCard();
  } catch {
    setShareFeedback(text);
  }
}

function exportData() {
  const payload = {
    app: "readers-journey",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `readers-journey-backup-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function importDataFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const nextState =
        parsed && typeof parsed === "object" && parsed.state ? parsed.state : parsed;
      replaceState(nextState);
      persist();
      audioEngine.syncProfile();
      renderAll();
      setSettingsFeedback("导入成功。你的旅程已恢复。");
    } catch {
      setSettingsFeedback("导入失败：文件格式无效。");
    }
  };
  reader.onerror = () => {
    setSettingsFeedback("导入失败：读取文件失败。");
  };
  reader.readAsText(file, "utf-8");
}

function resetData() {
  const confirmed = window.confirm("确定重置全部本地数据吗？该操作不可撤销。");
  if (!confirmed) return;
  replaceState(createInitialState());
  persist();
  audioEngine.syncProfile();
  lastHonorMessage = "欢迎回来。新的旅程已经准备好。";
  renderAll();
  setSettingsFeedback("数据已重置。新旅程已就绪。");
}

function openPrivacyDialog() {
  if (!elements.privacyDialog) return;
  if (typeof elements.privacyDialog.showModal === "function") {
    elements.privacyDialog.showModal();
  } else {
    elements.privacyDialog.setAttribute("open", "");
  }
}

function closePrivacyDialog() {
  if (!elements.privacyDialog) return;
  if (typeof elements.privacyDialog.close === "function") {
    elements.privacyDialog.close();
  } else {
    elements.privacyDialog.removeAttribute("open");
  }
}

function updateAudioSetting(patch) {
  const audio = getAudioProfile();
  Object.assign(audio, patch);
  audio.bgmVolume = clampPercent(audio.bgmVolume, DEFAULT_AUDIO_PROFILE.bgmVolume);
  audio.sfxVolume = clampPercent(audio.sfxVolume, DEFAULT_AUDIO_PROFILE.sfxVolume);
  persist();
  audioEngine.syncProfile();
  renderSettings();
}

function bindAudioBootstrap() {
  const onFirstGesture = () => {
    audioEngine.bootstrap();
    audioEngine.setScene(activeTab, true);
    renderSettings();
  };
  document.addEventListener("pointerdown", onFirstGesture, { capture: true, once: true });
  document.addEventListener("keydown", onFirstGesture, { capture: true, once: true });
}

function bindEvents() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      switchTab(tab.dataset.tab || "entry");
    });
  });

  window.addEventListener("resize", onViewportResize, { passive: true });
  window.visualViewport?.addEventListener("resize", onViewportResize, { passive: true });
  reduceMotionQuery?.addEventListener("change", () => {
    renderAll();
  });

  elements.entrySearchInput?.addEventListener("input", onEntrySearchInput);
  elements.entrySearchResults?.addEventListener("click", onEntrySearchResultsClick);
  elements.entrySearchMoreBtn?.addEventListener("click", onEntrySearchMore);
  elements.entryOnlineSearchBtn?.addEventListener("click", () => {
    onEntryOnlineSearch().catch(() => setEntryFeedback("联网搜索失败，请稍后再试。"));
  });
  elements.entryCustomModeBtn?.addEventListener("click", onEntryModeToggle);
  elements.entryAddBtn?.addEventListener("click", addEntryBook);
  elements.entryBooksMoreBtn?.addEventListener("click", onEntryBooksMore);

  elements.panelAttributesMoreBtn?.addEventListener("click", onPanelAttributesMore);
  elements.panelShelfMoreBtn?.addEventListener("click", onPanelShelfMore);
  elements.panelShelfList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest(".panel-open-book");
    if (!(button instanceof HTMLButtonElement)) return;
    const uidValue = button.dataset.bookUid;
    if (!uidValue) return;
    openBookDetailSheet(uidValue);
  });
  elements.panelSkillsMoreBtn?.addEventListener("click", onPanelSkillsMore);
  elements.panelAchievementsMoreBtn?.addEventListener("click", onPanelAchievementsMore);

  elements.shareNicknameInput?.addEventListener("change", onNicknameChange);
  elements.shareCopyInviteBtn?.addEventListener("click", () => {
    onCopyInvite().catch(() => setShareFeedback("复制失败，请稍后重试。"));
  });
  elements.shareCopyBtn?.addEventListener("click", () => {
    onCopyShare().catch(() => setShareFeedback("复制失败，请稍后重试。"));
  });

  elements.settingsAudioMasterBtn?.addEventListener("click", () => {
    const audio = getAudioProfile();
    const nextMaster = !audio.masterEnabled;
    updateAudioSetting({ masterEnabled: nextMaster });
    setSettingsFeedback(nextMaster ? "主音频已开启。" : "主音频已关闭。");
  });

  elements.settingsBgmToggleBtn?.addEventListener("click", () => {
    const audio = getAudioProfile();
    const nextValue = !audio.bgmEnabled;
    updateAudioSetting({ bgmEnabled: nextValue, masterEnabled: audio.masterEnabled || nextValue });
    setSettingsFeedback(nextValue ? "背景音乐已开启。" : "背景音乐已关闭。");
  });

  elements.settingsSfxToggleBtn?.addEventListener("click", () => {
    const audio = getAudioProfile();
    const nextValue = !audio.sfxEnabled;
    updateAudioSetting({ sfxEnabled: nextValue, masterEnabled: audio.masterEnabled || nextValue });
    setSettingsFeedback(nextValue ? "提示音已开启。" : "提示音已关闭。");
  });

  elements.settingsBgmVolume?.addEventListener("input", () => {
    const value = Number(elements.settingsBgmVolume?.value || 0);
    updateAudioSetting({ bgmVolume: value });
  });

  elements.settingsSfxVolume?.addEventListener("input", () => {
    const value = Number(elements.settingsSfxVolume?.value || 0);
    updateAudioSetting({ sfxVolume: value });
  });

  elements.settingsOpenPrivacyBtn?.addEventListener("click", openPrivacyDialog);
  elements.privacyCloseBtn?.addEventListener("click", closePrivacyDialog);

  elements.settingsExportBtn?.addEventListener("click", () => {
    try {
      exportData();
      setSettingsFeedback("导出成功。备份文件已生成。");
    } catch {
      setSettingsFeedback("导出失败，请稍后重试。");
    }
  });

  elements.settingsImportBtn?.addEventListener("click", () => {
    elements.settingsImportFile?.click();
  });

  elements.settingsImportFile?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files && input.files[0];
    if (!file) return;
    importDataFromFile(file);
    input.value = "";
  });

  elements.settingsResetBtn?.addEventListener("click", resetData);

  elements.sheetCloseBtn?.addEventListener("click", closeSheet);
  elements.sheetDialog?.addEventListener("click", (event) => {
    if (event.target === elements.sheetDialog) {
      closeSheet();
    }
  });

  elements.sheetContent?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("#sheet-load-more-btn")) {
      if (sheetState.type === "search") {
        sheetState.searchLoaded = Math.min(
          sheetState.searchItems.length,
          sheetState.searchLoaded + SEARCH_SHEET_PAGE_SIZE
        );
        renderSearchSheet();
      }
      return;
    }

    if (target.closest("#sheet-save-progress-btn")) {
      handleBookProgressSave();
      return;
    }

    if (target.closest("#sheet-save-reflection-btn")) {
      handleReflectionSave();
      return;
    }

    if (target.closest("#sheet-cancel-reflection-btn")) {
      sheetState.editingReflectionId = "";
      renderBookDetailSheet("已取消编辑。");
      return;
    }

    const openBookButton = target.closest(".sheet-open-book-detail");
    if (openBookButton instanceof HTMLButtonElement) {
      const uidValue = openBookButton.dataset.bookUid;
      if (!uidValue) return;
      openBookDetailSheet(uidValue);
      return;
    }

    const editButton = target.closest(".sheet-reflection-edit");
    if (editButton instanceof HTMLButtonElement) {
      const reflectionId = editButton.dataset.reflectionId;
      if (!reflectionId) return;
      handleReflectionEdit(reflectionId);
      return;
    }

    const deleteButton = target.closest(".sheet-reflection-delete");
    if (deleteButton instanceof HTMLButtonElement) {
      const reflectionId = deleteButton.dataset.reflectionId;
      if (!reflectionId) return;
      handleReflectionDelete(reflectionId);
      return;
    }

    const button = target.closest(".sheet-select-book");
    if (!(button instanceof HTMLButtonElement)) return;
    const key = button.dataset.catalogKey;
    if (!key) return;
    const selected = getCatalogByKey(key);
    if (!selected) return;
    selectedCatalogKey = key;
    fillEntryFormFromCatalog(selected);
    setEntryMode("catalog");
    setEntryFeedback("书籍已选择，准备录入。");
    renderEntry();
    closeSheet();
  });

  elements.sheetContent?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === "sheet-book-progress-range" || target.id === "sheet-book-progress-number") {
      syncBookDetailProgressFromInput(target);
    }
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

bindEvents();
bindAudioBootstrap();
setEntryMode("catalog");
switchTab(activeTab, { skipAnimation: true });
renderAll();
audioEngine.syncProfile();
initializeCatalog().catch(() => {
  catalogStore.status = "error";
  catalogStore.error = "离线书库初始化失败";
  renderAll();
});
registerServiceWorker();
