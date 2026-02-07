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
  distributeAttributeGain,
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

const APP_VERSION = "1.3.0-offline-data";
const ENTRY_CUSTOM_MULTIPLIER = REWARD_POLICY.entry.custom_entry_multiplier || 0.7;
const REGULAR_PREVIEW_LIMIT = 3;
const COMPACT_PREVIEW_LIMIT = 2;
const TIGHT_PREVIEW_LIMIT = 1;
const COMPACT_HEIGHT = 860;
const TIGHT_HEIGHT = 780;
const DEFAULT_SUGGESTION_LIMIT = 120;
const MAX_SEARCH_RESULTS = 300;

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
if (!state.appMeta.schemaVersion) {
  state.appMeta.schemaVersion = 2;
}
if (typeof state.profile.soundEnabled !== "boolean") {
  state.profile.soundEnabled = false;
}

let activeTab = "entry";
let selectedProgressUid = null;
let latestRewardItems = [];
let entryMode = "catalog";
let entrySearchQuery = "";
let selectedCatalogKey = "";
let densityMode = "regular";
let resizeRaf = 0;
let entrySearchTimer = 0;
const audio = typeof Audio === "undefined"
  ? {}
  : {
      entry: new Audio("./assets/audio/entry-success.wav"),
      skill: new Audio("./assets/audio/skill-unlock.wav"),
      level: new Audio("./assets/audio/level-up.wav")
    };

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

const elements = {
  shell: document.querySelector(".shell"),
  pageTitle: document.getElementById("app-page-title"),
  pageSubtitle: document.getElementById("app-page-subtitle"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  views: Array.from(document.querySelectorAll(".view")),
  entrySearchInput: document.getElementById("entry-search-input"),
  entrySearchResults: document.getElementById("entry-search-results"),
  entrySearchMoreBtn: document.getElementById("entry-search-more-btn"),
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
  progressBookSelect: document.getElementById("progress-book-select"),
  progressBookMeta: document.getElementById("progress-book-meta"),
  progressRange: document.getElementById("progress-range"),
  progressPercent: document.getElementById("progress-percent"),
  progressPages: document.getElementById("progress-pages"),
  progressRewardList: document.getElementById("progress-reward-list"),
  progressUpdateBtn: document.getElementById("progress-update-btn"),
  progressSkillList: document.getElementById("progress-skill-list"),
  progressSkillsMoreBtn: document.getElementById("progress-skills-more-btn"),
  panelLevelLine: document.getElementById("panel-level-line"),
  panelAttributeList: document.getElementById("panel-attribute-list"),
  panelSkillList: document.getElementById("panel-skill-list"),
  panelAchievementList: document.getElementById("panel-achievement-list"),
  panelSkillsMoreBtn: document.getElementById("panel-skills-more-btn"),
  panelAchievementsMoreBtn: document.getElementById("panel-achievements-more-btn"),
  shareNicknameInput: document.getElementById("share-nickname-input"),
  shareCardName: document.getElementById("share-card-name"),
  shareCardLevel: document.getElementById("share-card-level"),
  shareCardAttrs: document.getElementById("share-card-attrs"),
  shareCardSkills: document.getElementById("share-card-skills"),
  shareCardInvite: document.getElementById("share-card-invite"),
  shareCopyInviteBtn: document.getElementById("share-copy-invite-btn"),
  shareCopyBtn: document.getElementById("share-copy-btn"),
  shareFeedback: document.getElementById("share-feedback"),
  settingsOpenPrivacyBtn: document.getElementById("settings-open-privacy-btn"),
  settingsExportBtn: document.getElementById("settings-export-btn"),
  settingsImportBtn: document.getElementById("settings-import-btn"),
  settingsResetBtn: document.getElementById("settings-reset-btn"),
  settingsImportFile: document.getElementById("settings-import-file"),
  settingsStorageStatus: document.getElementById("settings-storage-status"),
  settingsLastSaved: document.getElementById("settings-last-saved"),
  settingsVersion: document.getElementById("settings-version"),
  settingsFeedback: document.getElementById("settings-feedback"),
  settingsAudioToggleBtn: document.getElementById("settings-audio-toggle-btn"),
  settingsCatalogMeta: document.getElementById("settings-catalog-meta"),
  privacyDialog: document.getElementById("privacy-dialog"),
  privacyCloseBtn: document.getElementById("privacy-close-btn"),
  sheetDialog: document.getElementById("sheet-dialog"),
  sheetTitle: document.getElementById("sheet-title"),
  sheetContent: document.getElementById("sheet-content"),
  sheetCloseBtn: document.getElementById("sheet-close-btn")
};

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
  if (height <= TIGHT_HEIGHT) return "tight";
  if (height <= COMPACT_HEIGHT) return "compact";
  return "regular";
}

function getPreviewLimit() {
  if (densityMode === "tight") return TIGHT_PREVIEW_LIMIT;
  if (densityMode === "compact") return COMPACT_PREVIEW_LIMIT;
  return REGULAR_PREVIEW_LIMIT;
}

function applyDensityMode() {
  const next = getNextDensityMode();
  const changed = next !== densityMode;
  densityMode = next;
  if (elements.shell) {
    elements.shell.dataset.density = next;
  }
  return changed;
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
    createdAt: Date.now()
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
  state.appMeta.schemaVersion = 2;
  saveState(state);
}

function replaceState(nextState) {
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, rotateDayIfNeeded(normalizeState(nextState)));
  state.lastSavedAt = state.lastSavedAt || new Date().toISOString();
  selectedProgressUid = null;
  latestRewardItems = [];
  entrySearchQuery = "";
  selectedCatalogKey = "";
  entryMode = "catalog";
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

function playSound(kind) {
  if (!state.profile.soundEnabled) return;
  const target = audio[kind];
  if (!target) return;
  target.currentTime = 0;
  target.play().catch(() => {});
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

function buildRewardItemHtml(label, value) {
  return `<div class="reward-item"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
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
  ensureMergedCatalog();
  return catalogStore.mergedMap.get(key) || null;
}

function buildOfflineCatalog() {
  ensureMergedCatalog();
  return catalogStore.mergedList;
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

  const query = normalizeText(entrySearchQuery);
  const catalog = buildOfflineCatalog();
  if (!query) {
    const items = catalog.slice(0, DEFAULT_SUGGESTION_LIMIT);
    return {
      items,
      total: catalog.length,
      truncated: catalog.length > items.length,
      message: ""
    };
  }

  const items = [];
  let total = 0;
  for (const book of catalog) {
    if (
      normalizeText(book.title).includes(query) ||
      normalizeText(book.author).includes(query) ||
      normalizeText(book.isbn).includes(query)
    ) {
      total += 1;
      if (items.length < MAX_SEARCH_RESULTS) {
        items.push(book);
      }
    }
  }
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
  if (!elements.entryCustomModeBtn || !elements.entryModeHint || !elements.entryCustomFields || !elements.entrySelectedBook || !elements.entrySearchResults || !elements.entrySearchMoreBtn) {
    return;
  }

  if (mode === "custom") {
    elements.entryCustomModeBtn.textContent = "返回书库";
    elements.entryModeHint.textContent = "自编录入模式：奖励系数 x0.7";
    elements.entryCustomFields.classList.remove("hidden");
    elements.entrySelectedBook.classList.add("hidden");
    elements.entrySearchResults.classList.add("hidden");
    elements.entrySearchMoreBtn.classList.add("hidden");
  } else {
    elements.entryCustomModeBtn.textContent = "自编录入";
    elements.entryModeHint.textContent = "书库选择模式：完整奖励";
    elements.entryCustomFields.classList.add("hidden");
    elements.entrySelectedBook.classList.remove("hidden");
    elements.entrySearchResults.classList.remove("hidden");
    elements.entrySearchMoreBtn.classList.remove("hidden");
  }
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

function renderEntrySearchResults() {
  if (!elements.entrySearchResults || !elements.entrySearchMoreBtn) return;
  const searchData = searchCatalogBooks();
  const results = searchData.items;
  const previewLimit = getPreviewLimit();
  const preview = results.slice(0, previewLimit);

  if (searchData.message) {
    elements.entrySearchResults.innerHTML = `<div class="search-empty">${escapeHtml(searchData.message)}</div>`;
  } else if (preview.length === 0) {
    elements.entrySearchResults.innerHTML = '<div class="search-empty">没有匹配结果，可使用自编录入。</div>';
  } else {
    elements.entrySearchResults.innerHTML = preview
      .map((item) => {
        const active = selectedCatalogKey === item.key;
        return `
          <button type="button" class="search-item${active ? " active" : ""}" data-catalog-key="${escapeHtml(item.key)}">
            <p class="search-item-title">${escapeHtml(item.title)}</p>
            <p class="search-item-sub">${escapeHtml(item.author)} · ${escapeHtml(CATEGORY_LABELS[item.category] || "通识")} · ${item.pages}页</p>
          </button>
        `;
      })
      .join("");
  }

  elements.entrySearchMoreBtn.disabled =
    searchData.message !== "" || results.length <= previewLimit;
  if (searchData.truncated) {
    elements.entrySearchMoreBtn.textContent = `查看更多结果（共${searchData.total}）`;
  } else {
    elements.entrySearchMoreBtn.textContent = "查看更多结果";
  }
}

function renderEntryBookPreview() {
  if (!elements.entryBookList || !elements.entryBooksMoreBtn) return;
  const previewLimit = getPreviewLimit();
  const preview = state.books.slice(0, previewLimit);
  if (preview.length === 0) {
    elements.entryBookList.innerHTML =
      '<div class="item"><p class="item-title">暂无书籍</p><p class="item-sub">先完成一次录入</p></div>';
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
      const source = book.sourceType === "custom" ? "自编" : "书库";
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
    setEntryFeedback("分类为必选项，请先选择分类。");
    return;
  }

  let payload;
  let sourceType;
  let multiplier = 1;

  if (entryMode === "catalog") {
    const selected = getSelectedCatalogBook();
    if (!selected) {
      setEntryFeedback("请先从搜索结果中选择一本书。");
      return;
    }
    payload = {
      title: selected.title,
      author: selected.author,
      isbn: selected.isbn,
      pages: selected.pages,
      category
    };
    sourceType = "catalog";
  } else {
    const title = elements.entryTitleInput?.value.trim() || "";
    const author = elements.entryAuthorInput?.value.trim() || "未知作者";
    if (!title) {
      setEntryFeedback("自编录入需要填写书名。");
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
    setEntryFeedback("书单中已存在同名书籍，无需重复录入。");
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
  selectedProgressUid = book.uid;
  selectedCatalogKey = "";
  entrySearchQuery = "";
  if (elements.entrySearchInput) elements.entrySearchInput.value = "";
  if (elements.entryCategorySelect) elements.entryCategorySelect.value = "";
  clearEntryCustomFields();
  setEntryMode("catalog");
  latestRewardItems = [];
  renderAll();

  setEntryFeedback(
    `已录入《${book.title}》，意志力 +${points}，经验 +${points}${sourceType === "custom" ? "（自编x0.7）" : ""}。`
  );
  playSound("entry");
}

function getOpenBooks() {
  return state.books.filter((book) => book.status !== "finished");
}

function ensureProgressSelection() {
  const openBooks = getOpenBooks();
  if (openBooks.length === 0) {
    selectedProgressUid = null;
    return null;
  }
  const selected = openBooks.find((book) => book.uid === selectedProgressUid);
  if (selected) return selected;
  selectedProgressUid = openBooks[0].uid;
  return openBooks[0];
}

function renderProgressPreview(book, targetProgress) {
  const progress = Math.max(0, Math.min(100, Number(targetProgress) || 0));
  const pages = Math.round((book.pages * progress) / 100);
  if (elements.progressPercent) elements.progressPercent.textContent = `${progress}%`;
  if (elements.progressPages) elements.progressPages.textContent = String(pages);

  const delta = Math.max(0, progress - book.progress);
  const gains = distributeAttributeGain(book.category, Math.max(1, Math.round(delta / 15)));
  const top = Object.entries(gains).sort((a, b) => b[1] - a[1]).slice(0, 2);
  latestRewardItems = [
    { label: "预计经验", value: `+${Math.round(delta)}` },
    { label: ATTRIBUTE_LABELS[top[0][0]], value: `+${top[0][1]}` },
    { label: ATTRIBUTE_LABELS[top[1][0]], value: `+${top[1][1]}` }
  ];
}

function renderRewardItems() {
  if (!elements.progressRewardList) return;
  elements.progressRewardList.innerHTML = latestRewardItems
    .map((item) => buildRewardItemHtml(item.label, item.value))
    .join("");
}

function renderProgressSkillPreview() {
  if (!elements.progressSkillList || !elements.progressSkillsMoreBtn) return;
  const previewLimit = getPreviewLimit();
  const preview = state.stats.skills.slice(0, previewLimit);
  if (preview.length === 0) {
    elements.progressSkillList.innerHTML = '<span class="chip">暂无技能</span>';
    elements.progressSkillsMoreBtn.disabled = SKILL_RULES.length <= previewLimit;
    return;
  }
  elements.progressSkillList.innerHTML = preview
    .map((skill) => `<span class="chip active">${escapeHtml(skill.name)}</span>`)
    .join("");
  elements.progressSkillsMoreBtn.disabled = state.stats.skills.length <= previewLimit;
}

function renderProgress() {
  if (!elements.progressBookSelect || !elements.progressBookMeta || !elements.progressRange) return;
  const openBooks = getOpenBooks();
  if (openBooks.length === 0) {
    elements.progressBookSelect.innerHTML = '<option value="">暂无可更新书籍</option>';
    elements.progressBookSelect.disabled = true;
    elements.progressRange.disabled = true;
    if (elements.progressUpdateBtn) elements.progressUpdateBtn.disabled = true;
    elements.progressBookMeta.textContent = "请先在录入页添加一本书。";
    if (elements.progressPercent) elements.progressPercent.textContent = "0%";
    if (elements.progressPages) elements.progressPages.textContent = "0";
    latestRewardItems = [
      { label: "状态", value: "等待录入" },
      { label: "提示", value: "暂无可更新书籍" }
    ];
    renderRewardItems();
    renderProgressSkillPreview();
    return;
  }

  elements.progressBookSelect.disabled = false;
  elements.progressBookSelect.innerHTML = openBooks
    .map((book) => `<option value="${book.uid}">${escapeHtml(book.title)} · ${book.progress}%</option>`)
    .join("");
  const current = ensureProgressSelection();
  if (!current) return;
  elements.progressBookSelect.value = current.uid;
  elements.progressRange.disabled = false;
  elements.progressRange.value = String(current.progress);
  if (elements.progressUpdateBtn) elements.progressUpdateBtn.disabled = false;
  elements.progressBookMeta.textContent = `${current.author} · ${CATEGORY_LABELS[current.category] || "通识"} · 共 ${current.pages} 页`;

  if (latestRewardItems.length === 0) {
    renderProgressPreview(current, current.progress);
  } else {
    if (elements.progressPercent) elements.progressPercent.textContent = `${current.progress}%`;
    if (elements.progressPages) {
      elements.progressPages.textContent = String(Math.round((current.pages * current.progress) / 100));
    }
  }
  renderRewardItems();
  renderProgressSkillPreview();
}

function renderPanel() {
  if (!elements.panelLevelLine || !elements.panelAttributeList || !elements.panelSkillList || !elements.panelAchievementList) {
    return;
  }

  const required = requiredExpForLevel(state.stats.level);
  const done = getCompletedBooks(state).length;
  elements.panelLevelLine.textContent = `Lv.${state.stats.level} · 经验 ${state.stats.exp}/${required} · 已完成 ${done} 本`;

  const maxAttr = Math.max(50, ...ATTRIBUTE_KEYS.map((key) => state.stats.attributes[key] || 0));
  elements.panelAttributeList.innerHTML = ATTRIBUTE_KEYS.map((key) => {
    const value = state.stats.attributes[key] || 0;
    const width = Math.max(4, Math.round((value / maxAttr) * 100));
    return `
      <div class="attr-row">
        <span class="attr-label"><img class="attr-icon" src="./assets/icons/${key}.svg" alt="" />${ATTRIBUTE_LABELS[key]}</span>
        <div class="attr-track"><div class="attr-fill" style="width:${width}%"></div></div>
        <span class="attr-value">${value}</span>
      </div>
    `;
  }).join("");

  const previewLimit = getPreviewLimit();
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

function renderSettings() {
  if (!elements.settingsStorageStatus || !elements.settingsLastSaved || !elements.settingsVersion) return;
  const usage = getStorageUsage();
  elements.settingsStorageStatus.textContent = `本项目数据：${formatBytes(usage.appBytes)} · 本机总占用：${formatBytes(usage.totalBytes)}`;
  elements.settingsLastSaved.textContent = `最后保存：${formatDateTime(state.lastSavedAt)}`;
  elements.settingsVersion.textContent = APP_VERSION;
  if (elements.settingsAudioToggleBtn) {
    elements.settingsAudioToggleBtn.textContent = state.profile.soundEnabled ? "关闭提示音" : "开启提示音";
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
}

function renderAll() {
  rotateDayIfNeeded(state);
  applyDensityMode();
  renderHeader();
  renderEntry();
  renderProgress();
  renderPanel();
  renderShare();
  renderSettings();
}

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
    renderAll();
  });
}

function switchTab(tab) {
  activeTab = tab;
  elements.tabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  elements.views.forEach((view) => {
    view.classList.toggle("active", view.dataset.view === tab);
  });
  renderHeader();
}

function openSheet(title, contentHtml) {
  if (!elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  elements.sheetTitle.textContent = title;
  elements.sheetContent.innerHTML = contentHtml;
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
}

function closeSheet() {
  if (!elements.sheetDialog) return;
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
  setEntryFeedback("已选择书籍，可直接录入。");
  renderEntrySearchResults();
  renderSelectedBookCard();
}

function onEntrySearchMore() {
  const searchData = searchCatalogBooks();
  const results = searchData.items;
  const previewLimit = getPreviewLimit();
  if (results.length <= previewLimit) return;
  const html = results
    .map((item) => {
      return `
        <button type="button" class="search-item sheet-select-book" data-catalog-key="${escapeHtml(item.key)}">
          <p class="search-item-title">${escapeHtml(item.title)}</p>
          <p class="search-item-sub">${escapeHtml(item.author)} · ${escapeHtml(CATEGORY_LABELS[item.category] || "通识")} · ${item.pages}页</p>
        </button>
      `;
    })
    .join("");
  const title = searchData.truncated
    ? `书库搜索结果（展示前 ${results.length} 条，共 ${searchData.total} 条）`
    : "书库搜索结果";
  openSheet(title, html);
}

function onEntryModeToggle() {
  if (entryMode === "catalog") {
    entryMode = "custom";
    selectedCatalogKey = "";
    clearEntryCustomFields();
    setEntryFeedback("已切换到自编录入。");
  } else {
    entryMode = "catalog";
    setEntryFeedback("已切换到书库选择。");
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

function onProgressSelectionChange() {
  if (!elements.progressBookSelect) return;
  selectedProgressUid = elements.progressBookSelect.value;
  latestRewardItems = [];
  renderProgress();
}

function onProgressRangeInput() {
  if (!elements.progressRange) return;
  const book = ensureProgressSelection();
  if (!book) return;
  latestRewardItems = [];
  renderProgressPreview(book, elements.progressRange.value);
  renderRewardItems();
}

function onProgressUpdate() {
  if (!elements.progressRange) return;
  const book = ensureProgressSelection();
  if (!book) return;

  const nextProgress = Math.max(0, Math.min(100, Number(elements.progressRange.value) || 0));
  if (nextProgress <= book.progress) {
    latestRewardItems = [
      { label: "提示", value: "新进度需大于当前进度" },
      { label: "当前", value: `${book.progress}%` }
    ];
    renderRewardItems();
    return;
  }

  const completedBefore = getCompletedBooks(state);
  const result = applyProgressReward({
    stats: state.stats,
    book,
    previousProgress: book.progress,
    nextProgress,
    completedCount: completedBefore.length,
    categoryCounts: getCategoryCounts(state),
    finishedTitles: completedBefore.map((item) => item.title)
  });

  state.stats = result.updatedStats;
  book.progress = nextProgress;
  book.progressPages = Math.round((book.pages * nextProgress) / 100);
  book.status = nextProgress >= 100 ? "finished" : "reading";

  const topAttrs = Object.entries(result.reward.attributeGain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  latestRewardItems = [
    { label: "经验", value: `+${result.reward.expGain}` },
    { label: ATTRIBUTE_LABELS[topAttrs[0][0]], value: `+${topAttrs[0][1]}` },
    { label: ATTRIBUTE_LABELS[topAttrs[1][0]], value: `+${topAttrs[1][1]}` }
  ];
  if (result.reward.unlockedSkills.length > 0) {
    latestRewardItems.push({ label: "新技能", value: result.reward.unlockedSkills[0].name });
  } else if (result.reward.finishedNow) {
    latestRewardItems.push({ label: "完成", value: "本书已读完" });
  }

  persist();
  renderAll();
  renderRewardItems();

  if (result.reward.unlockedSkills.length > 0) {
    playSound("skill");
  } else if (result.reward.levelUps > 0) {
    playSound("level");
  } else {
    playSound("entry");
  }
}

function onProgressSkillsMore() {
  const all = state.stats.skills.length > 0 ? state.stats.skills : SKILL_RULES;
  const html = all
    .map((skill) => {
      const unlocked = state.stats.skills.some((item) => item.id === skill.id);
      return `<span class="chip${unlocked ? " active" : ""}">${escapeHtml(skill.name)}</span>`;
    })
    .join("");
  openSheet("技能列表", html || '<span class="chip">暂无技能</span>');
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
    setShareFeedback("邀请码已复制。");
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
    setShareFeedback("分享文案已复制，可直接粘贴发送。");
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
      renderAll();
      setSettingsFeedback("导入成功。");
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
  renderAll();
  setSettingsFeedback("数据已重置。");
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

function bindEvents() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      switchTab(tab.dataset.tab || "entry");
    });
  });

  window.addEventListener("resize", onViewportResize, { passive: true });
  window.visualViewport?.addEventListener("resize", onViewportResize, { passive: true });

  elements.entrySearchInput?.addEventListener("input", onEntrySearchInput);
  elements.entrySearchResults?.addEventListener("click", onEntrySearchResultsClick);
  elements.entrySearchMoreBtn?.addEventListener("click", onEntrySearchMore);
  elements.entryCustomModeBtn?.addEventListener("click", onEntryModeToggle);
  elements.entryAddBtn?.addEventListener("click", addEntryBook);
  elements.entryBooksMoreBtn?.addEventListener("click", onEntryBooksMore);

  elements.progressBookSelect?.addEventListener("change", onProgressSelectionChange);
  elements.progressRange?.addEventListener("input", onProgressRangeInput);
  elements.progressUpdateBtn?.addEventListener("click", onProgressUpdate);
  elements.progressSkillsMoreBtn?.addEventListener("click", onProgressSkillsMore);

  elements.panelSkillsMoreBtn?.addEventListener("click", onPanelSkillsMore);
  elements.panelAchievementsMoreBtn?.addEventListener("click", onPanelAchievementsMore);

  elements.shareNicknameInput?.addEventListener("change", onNicknameChange);
  elements.shareCopyInviteBtn?.addEventListener("click", () => {
    onCopyInvite().catch(() => setShareFeedback("复制失败，请稍后重试。"));
  });
  elements.shareCopyBtn?.addEventListener("click", () => {
    onCopyShare().catch(() => setShareFeedback("复制失败，请稍后重试。"));
  });

  elements.settingsOpenPrivacyBtn?.addEventListener("click", openPrivacyDialog);
  elements.privacyCloseBtn?.addEventListener("click", closePrivacyDialog);
  elements.settingsExportBtn?.addEventListener("click", () => {
    try {
      exportData();
      setSettingsFeedback("导出成功。");
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
  elements.settingsAudioToggleBtn?.addEventListener("click", () => {
    state.profile.soundEnabled = !state.profile.soundEnabled;
    persist();
    renderSettings();
    setSettingsFeedback(state.profile.soundEnabled ? "提示音已开启。" : "提示音已关闭。");
  });

  elements.sheetCloseBtn?.addEventListener("click", closeSheet);
  elements.sheetDialog?.addEventListener("click", (event) => {
    if (event.target === elements.sheetDialog) {
      closeSheet();
    }
  });
  elements.sheetContent?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest(".sheet-select-book");
    if (!(button instanceof HTMLButtonElement)) return;
    const key = button.dataset.catalogKey;
    if (!key) return;
    const selected = getCatalogByKey(key);
    if (!selected) return;
    selectedCatalogKey = key;
    fillEntryFormFromCatalog(selected);
    setEntryMode("catalog");
    setEntryFeedback("已选择书籍，可直接录入。");
    renderEntry();
    closeSheet();
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

bindEvents();
setEntryMode("catalog");
switchTab(activeTab);
renderAll();
initializeCatalog().catch(() => {
  catalogStore.status = "error";
  catalogStore.error = "离线书库初始化失败";
  renderAll();
});
registerServiceWorker();
