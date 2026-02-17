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

const APP_VERSION = "1.7.0-pixel-rpg";
const ENTRY_CUSTOM_MULTIPLIER = REWARD_POLICY.entry.custom_entry_multiplier || 0.7;
const ENTRY_WILL_GAIN_MULTIPLIER = 0.45;
const ATTRIBUTE_DISPLAY_BASE = 90;
const ATTRIBUTE_DISPLAY_PER_LEVEL = 12;
const ATTRIBUTE_DISPLAY_HEADROOM = 40;
const ATTRIBUTE_DISPLAY_MAX = 360;
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
const PAGE_RESOLVE_TIMEOUT_MS = 5200;
const PAGE_RESOLVE_SCAN_LIMIT = 24;
const MAX_SHELF_PREVIEW = 6;
const MAX_REFLECTION_LENGTH = 1000;
const ENTRY_BOOK_PREVIEW_LIMIT = 3;
const SHELF_FILTER_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "reading", label: "在读" },
  { key: "planned", label: "待开始" },
  { key: "finished", label: "已完成" }
];
const WORLD_CANVAS_WIDTH = 390;
const WORLD_CANVAS_HEIGHT = 844;
const WORLD_MAP_WIDTH = 2496;
const WORLD_MAP_HEIGHT = 3456;
const WORLD_TILE_SIZE = 32;
const WORLD_PLAYER_START = { x: 1248, y: 2230 };
const WORLD_HOTSPOT_TRIGGER_DISTANCE = 148;
const WORLD_TARGET_STOP_DISTANCE = 24;
const WORLD_HOTSPOTS = [
  { id: "entry", label: "录入台", short: "录", type: "entry", x: 1020, y: 2150, color: 0x6fc6ff },
  { id: "panel", label: "星图神殿", short: "面", type: "panel", x: 1248, y: 1860, color: 0xf4c978 },
  { id: "shelf", label: "藏书阁", short: "阁", type: "shelf", x: 1488, y: 2150, color: 0xcda6ff },
  { id: "share", label: "信使驿站", short: "信", type: "share", x: 1488, y: 2480, color: 0x96e0c0 },
  { id: "settings", label: "工坊", short: "工", type: "settings", x: 1018, y: 2480, color: 0xf5b07b }
];
const ENTRY_CATEGORY_ORDER = ["logic", "psychology", "strategy", "literature", "creativity", "philosophy", "general"];
const SKILL_PATH_ORDER = ["insight", "will", "logic", "strategy"];
const SKILL_PATH_LABELS = {
  insight: "洞察线",
  will: "意志线",
  logic: "逻辑线",
  strategy: "战略线",
  general: "通识线"
};
const SKILL_MAX_TIER = SKILL_RULES.reduce(
  (max, rule) => Math.max(max, Math.max(1, Number(rule?.tier) || 1)),
  1
);
const HEADER_LOTTIE_PATH = "./assets/animations/header-sparkle.json";
const DEFAULT_AUDIO_PROFILE = {
  masterEnabled: true,
  bgmEnabled: true,
  sfxEnabled: true,
  bgmVolume: 46,
  sfxVolume: 76,
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

let activeTab = "world";
let entryMode = "catalog";
let entrySearchQuery = "";
let selectedCatalogKey = "";
let activeShelfUid = "";
let shelfPulseUid = "";
let densityMode = "regular";
let resizeRaf = 0;
let entrySearchTimer = 0;
let viewAnimationTimer = 0;
let lastHonorMessage = "每一次翻页，都会点亮你自己的星图。";
let panelSkillPulseId = "";
let panelSkillPulseTimer = 0;
let onlineSearchBusy = false;
let pageResolveBusy = false;
let onlineSearchProgressCompleted = 0;
let onlineSearchRequestId = 0;
let onlineSearchStatus = "idle";
let headerLottie = null;
const lastAttributeSnapshot = new Map();
const transientCatalogMap = new Map();
const pageResolutionCache = new Map();
const worldControlState = {
  left: false,
  right: false,
  up: false,
  down: false,
  pointerActive: false,
  targetX: WORLD_PLAYER_START.x,
  targetY: WORLD_PLAYER_START.y
};
const worldRuntime = {
  game: null,
  scene: null,
  activeZoneId: "",
  interactCooldownUntil: 0,
  autoTargetZoneId: "",
  keyboardUsed: false,
  debugTime: 0,
  resizeObserver: null
};
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
  shelfFilter: "all",
  shelfPage: 1,
  bookUid: "",
  editingReflectionId: ""
};
const sheetHistoryStack = [];

const elements = {
  shell: document.querySelector(".shell"),
  gameToastLayer: document.getElementById("game-toast-layer"),
  pageTitle: document.getElementById("app-page-title"),
  pageSubtitle: document.getElementById("app-page-subtitle"),
  headerLevelBadge: document.getElementById("header-level-badge"),
  headerShareBtn: document.getElementById("header-share-btn"),
  headerSparkLottie: document.getElementById("header-spark-lottie"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  views: Array.from(document.querySelectorAll(".view")),
  worldCanvas: document.getElementById("world-canvas"),
  worldZoneHint: document.getElementById("world-zone-hint"),
  worldLevelChip: document.getElementById("world-level-chip"),
  worldBookChip: document.getElementById("world-book-chip"),
  worldDailyChip: document.getElementById("world-daily-chip"),
  worldFocusChip: document.getElementById("world-focus-chip"),
  worldEntryBtn: document.getElementById("world-entry-btn"),
  worldShareBtn: document.getElementById("world-share-btn"),
  entryQuestCard: document.getElementById("entry-quest-card"),
  entryHonorCard: document.getElementById("entry-honor-card"),
  entrySearchInput: document.getElementById("entry-search-input"),
  entrySearchResults: document.getElementById("entry-search-results"),
  entrySearchMoreBtn: document.getElementById("entry-search-more-btn"),
  entryOnlineSearchBtn: document.getElementById("entry-online-search-btn"),
  entryCustomModeBtn: document.getElementById("entry-custom-mode-btn"),
  entrySelectionPill: document.getElementById("entry-selection-pill"),
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
  panelXpFill: document.getElementById("panel-xp-fill"),
  panelShelfList: document.getElementById("panel-shelf-list"),
  panelShelfMoreBtn: document.getElementById("panel-shelf-more-btn"),
  panelAttributeSummaryList: document.getElementById("panel-attribute-summary-list"),
  panelAttributesMoreBtn: document.getElementById("panel-attributes-more-btn"),
  panelSkillList: document.getElementById("panel-skill-list"),
  panelAchievementList: document.getElementById("panel-achievement-list"),
  panelSkillStarMap: document.getElementById("panel-skill-star-map"),
  panelSkillAutoSlots: document.getElementById("panel-skill-auto-slots"),
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
  settingsBgmToggleBtn: document.getElementById("settings-bgm-toggle-btn"),
  settingsSfxToggleBtn: document.getElementById("settings-sfx-toggle-btn"),
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
  sheetBackBtn: document.getElementById("sheet-back-btn"),
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

  const bgmEnabled = merged.bgmEnabled !== false;
  const sfxEnabled = merged.sfxEnabled !== false;

  state.profile.audio = {
    masterEnabled: bgmEnabled || sfxEnabled,
    bgmEnabled,
    sfxEnabled,
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

function compactLabel(text, max = 11) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function normalizePositivePages(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(4000, Math.round(parsed)));
}

function isCatalogPagesUntrusted(book) {
  const pages = normalizePositivePages(book?.pages, 0);
  const provider = String(book?.source?.provider || "");
  if (pages <= 0) return true;
  if (book?.pagesEstimated) return true;
  if (pages !== 320) return false;
  return provider === "douban_hot_repo" || provider === "openlibrary";
}

function formatPagesLabel(pages, pagesEstimated = false) {
  const safePages = normalizePositivePages(pages, 0);
  if (safePages <= 0) {
    return pagesEstimated ? "页数待核实" : "页数未知";
  }
  if (!pagesEstimated) {
    return `${safePages}页`;
  }
  if (safePages === 320) {
    return "页数待核实";
  }
  return `约${safePages}页`;
}

function getAttributeTier(value) {
  const score = Number(value) || 0;
  if (score >= 180) return "S";
  if (score >= 130) return "A";
  if (score >= 95) return "B";
  if (score >= 65) return "C";
  return "D";
}

function getAttributeProgressMeta(value) {
  const score = Math.max(0, Math.round(Number(value) || 0));
  const bands = [
    { tier: "D", min: 0, max: 65 },
    { tier: "C", min: 65, max: 95 },
    { tier: "B", min: 95, max: 130 },
    { tier: "A", min: 130, max: 180 }
  ];
  const currentBand = bands.find((band) => score < band.max) || { tier: "S", min: 180, max: 240 };
  const values = ATTRIBUTE_KEYS.map((key) => Math.max(0, Number(state.stats.attributes?.[key] || 0)));
  const highest = Math.max(...values, score);
  const levelBase = ATTRIBUTE_DISPLAY_BASE + Math.max(1, Number(state.stats.level) || 1) * ATTRIBUTE_DISPLAY_PER_LEVEL;
  const displayMax = Math.min(
    ATTRIBUTE_DISPLAY_MAX,
    Math.ceil(Math.max(65, levelBase, highest + ATTRIBUTE_DISPLAY_HEADROOM) / 5) * 5
  );
  const ratio = score / Math.max(1, displayMax);
  return {
    tier: currentBand.tier,
    min: currentBand.min,
    max: displayMax,
    barWidth: Math.max(0, Math.min(100, Math.round(ratio * 100)))
  };
}

function getSkillNodePosition(index, total, rule = null) {
  const path = String(rule?.path || "");
  const tier = Math.max(1, Number(rule?.tier) || 1);
  const laneIndex = SKILL_PATH_ORDER.indexOf(path);
  if (laneIndex >= 0) {
    const laneCount = SKILL_PATH_ORDER.length;
    const x = laneCount <= 1 ? 50 : 12 + (laneIndex * 76) / (laneCount - 1);
    const minY = 16;
    const maxY = 86;
    const tierSpan = Math.max(1, SKILL_MAX_TIER - 1);
    const tierStep = (maxY - minY) / tierSpan;
    const y = maxY - (Math.min(SKILL_MAX_TIER, tier) - 1) * tierStep;
    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2))
    };
  }

  const count = Math.max(1, total);
  const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / count;
  const radius = count <= 4 ? 34 : 38;
  const x = 50 + Math.cos(angle) * radius;
  const y = 50 + Math.sin(angle) * radius;
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2))
  };
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ""));
}

function getSkillRuleById(skillId) {
  return SKILL_RULES.find((item) => item.id === skillId) || null;
}

function getSkillPrerequisiteText(rule) {
  const requires = Array.isArray(rule?.requires) ? rule.requires : [];
  if (requires.length === 0) return "前置：无";
  const unlockedSet = new Set((state.stats.skills || []).map((item) => item.id));
  const labels = requires.map((id) => {
    const ref = getSkillRuleById(id);
    const label = ref?.name || id;
    return unlockedSet.has(id) ? `${label}✓` : `${label}…`;
  });
  return `前置：${labels.join(" → ")}`;
}

function getSkillConditionProgressText(rule) {
  const type = String(rule?.conditionType || "");
  if (type === "category_count") {
    const counts = getCategoryCounts(state);
    const current = counts[rule.category] || 0;
    return `分类进度：${CATEGORY_LABELS[rule.category] || "通识"} ${current}/${rule.count}`;
  }
  if (type === "attribute_threshold") {
    const key = String(rule.attribute || "");
    const current = Number(state.stats.attributes?.[key] || 0);
    const target = Number(rule.value || 0);
    return `属性进度：${ATTRIBUTE_LABELS[key] || key} ${current}/${target}`;
  }
  if (type === "completed_count") {
    const done = getCompletedBooks(state).length;
    return `完成进度：${done}/${rule.count} 本`;
  }
  if (type === "special_title_any") {
    const titles = Array.isArray(rule.specialTitles) && rule.specialTitles.length > 0
      ? rule.specialTitles
      : [rule.specialTitle];
    const finishedSet = new Set(
      getCompletedBooks(state).map((book) => String(book.title || "").toLowerCase().trim())
    );
    const hit = titles.some((title) => finishedSet.has(String(title || "").toLowerCase().trim()));
    return `彩蛋进度：${hit ? "已触发" : "未触发"}`;
  }
  return "继续推进阅读即可解锁。";
}

function buildSkillDetailHtml(rule, unlocked) {
  const pathLabel = SKILL_PATH_LABELS[rule.path] || SKILL_PATH_LABELS.general;
  const hint = rule.unlockHint || rule.description || "继续推进阅读即可点亮。";
  const statusText = unlocked ? "已点亮：该技能已进入自动装备星环。" : "尚未点亮：满足条件后会自动解锁。";
  return `
    <article class="skill-crest ${unlocked ? "active" : "empty"}">
      <p class="skill-crest-title">${escapeHtml(rule.name)}</p>
      <p class="skill-crest-sub">${escapeHtml(rule.description || "继续推进阅读即可点亮。")}</p>
    </article>
    <p class="tip">阶梯：${escapeHtml(pathLabel)} · 第 ${Math.max(1, Number(rule.tier) || 1)} 阶</p>
    <p class="tip">${escapeHtml(hint)}</p>
    <p class="tip">${escapeHtml(getSkillConditionProgressText(rule))}</p>
    <p class="tip">${escapeHtml(getSkillPrerequisiteText(rule))}</p>
    <p class="tip">${escapeHtml(statusText)}</p>
  `;
}

function getSkillRulesByPath(path) {
  return SKILL_RULES
    .filter((rule) => String(rule.path || "general") === path)
    .sort((a, b) => {
      const tierGap = (Number(a.tier) || 1) - (Number(b.tier) || 1);
      if (tierGap !== 0) return tierGap;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
    });
}

function buildSkillLaneProgressHtml(unlockedSet) {
  return SKILL_PATH_ORDER.map((path) => {
    const rules = getSkillRulesByPath(path);
    const unlockedCount = rules.filter((rule) => unlockedSet.has(rule.id)).length;
    const total = rules.length;
    const nextRule = rules.find((rule) => !unlockedSet.has(rule.id)) || null;
    const ratio = total > 0 ? Math.round((unlockedCount / total) * 100) : 0;
    const nextLine = nextRule
      ? `下一阶：${nextRule.name}（T${Math.max(1, Number(nextRule.tier) || 1)}）`
      : "已满阶：当前路径全部点亮";
    const progressLine = nextRule
      ? getSkillConditionProgressText(nextRule)
      : "可持续通过阅读维持该路径优势。";
    return `
      <article class="skill-lane-card path-${escapeHtml(path)}" data-skill-path="${escapeHtml(path)}">
        <div class="skill-lane-head">
          <strong>${escapeHtml(SKILL_PATH_LABELS[path] || SKILL_PATH_LABELS.general)}</strong>
          <span>${unlockedCount}/${total}</span>
        </div>
        <div class="skill-lane-track"><span class="skill-lane-fill" style="width:${ratio}%"></span></div>
        <p class="tip">${escapeHtml(nextLine)}</p>
        <p class="tip">${escapeHtml(progressLine)}</p>
      </article>
    `;
  }).join("");
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

function formatShortDate(stamp) {
  if (!stamp) return "刚刚";
  const date = new Date(Number(stamp));
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
}

function triggerHaptic(style = "light") {
  const ms = style === "heavy" ? 24 : style === "medium" ? 16 : 10;
  const capacitorHaptics = window?.Capacitor?.Plugins?.Haptics;
  if (capacitorHaptics?.impact) {
    const impactStyle =
      style === "heavy" ? "HEAVY" : style === "medium" ? "MEDIUM" : "LIGHT";
    capacitorHaptics.impact({ style: impactStyle }).catch(() => {});
    return;
  }
  if (navigator.vibrate) {
    navigator.vibrate(ms);
  }
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
  return Math.max(1, getBasePreviewLimit());
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
    pages: normalizePositivePages(pages, 1),
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
  activeShelfUid = "";
  shelfPulseUid = "";
  entryMode = "catalog";
  onlineSearchBusy = false;
  pageResolveBusy = false;
  onlineSearchProgressCompleted = 0;
  onlineSearchStatus = "idle";
  transientCatalogMap.clear();
  pageResolutionCache.clear();
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
  if (sheetState.type === "share") {
    renderShareSheet(text);
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

function spawnSparkBurst(anchor, tone = "info") {
  if (prefersReducedMotion()) return;
  if (!elements.gameToastLayer || !elements.shell) return;
  const shellRect = elements.shell.getBoundingClientRect();
  const anchorRect = anchor instanceof Element ? anchor.getBoundingClientRect() : shellRect;
  const originX = anchorRect.left - shellRect.left + anchorRect.width / 2;
  const originY = anchorRect.top - shellRect.top + Math.max(10, anchorRect.height / 2);

  for (let i = 0; i < 8; i += 1) {
    const spark = document.createElement("span");
    spark.className = `spark-particle ${tone}`;
    const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.2;
    const distance = 26 + Math.random() * 20;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 6;
    spark.style.left = `${originX}px`;
    spark.style.top = `${originY}px`;
    spark.style.setProperty("--dx", `${dx.toFixed(2)}px`);
    spark.style.setProperty("--dy", `${dy.toFixed(2)}px`);
    elements.gameToastLayer.appendChild(spark);
    window.setTimeout(() => spark.remove(), 760);
  }
}

function spawnGameToast(text, tone = "info", anchor = null) {
  if (!text || !elements.gameToastLayer || !elements.shell) return;
  const toast = document.createElement("p");
  toast.className = `game-toast ${tone}`;
  toast.textContent = text;

  const shellRect = elements.shell.getBoundingClientRect();
  const anchorRect = anchor instanceof Element ? anchor.getBoundingClientRect() : null;
  const y = anchorRect
    ? Math.max(58, anchorRect.top - shellRect.top - 8)
    : Math.max(58, shellRect.height * 0.22);
  toast.style.top = `${y}px`;

  elements.gameToastLayer.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });
  window.setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.add("hide");
  }, 1000);
  window.setTimeout(() => {
    toast.remove();
  }, 1600);
  spawnSparkBurst(anchor, tone);
}

async function initHeaderLottie() {
  const container = elements.headerSparkLottie;
  const lottie = typeof window !== "undefined" ? window.lottie : null;
  if (prefersReducedMotion()) {
    if (container instanceof HTMLElement) {
      container.classList.remove("ready");
    }
    return;
  }
  if (!(container instanceof HTMLElement) || !lottie?.loadAnimation) {
    return;
  }

  try {
    const response = await fetch(HEADER_LOTTIE_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Animation HTTP ${response.status}`);
    }
    const animationData = await response.json();
    headerLottie = lottie.loadAnimation({
      container,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData,
      rendererSettings: {
        preserveAspectRatio: "xMidYMid meet"
      }
    });
    headerLottie.setSpeed(0.78);
    container.classList.add("ready");
  } catch {
    container.classList.remove("ready");
    headerLottie = null;
  }
}

function pulseHeaderLottie(kind) {
  if (prefersReducedMotion() || !headerLottie?.playSegments) return;
  if (kind === "level") {
    headerLottie.playSegments([40, 88], true);
    return;
  }
  if (kind === "progress") {
    headerLottie.playSegments([20, 72], true);
    return;
  }
  headerLottie.playSegments([0, 54], true);
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
  pulseHeaderLottie(kind);
}

function flashShareCard() {
  if (!elements.shareCard) return;
  elements.shareCard.classList.remove("flash");
  void elements.shareCard.offsetWidth;
  elements.shareCard.classList.add("flash");
  const sheetShareCard = elements.sheetContent?.querySelector("#sheet-share-card");
  if (sheetShareCard instanceof HTMLElement) {
    sheetShareCard.classList.remove("flash");
    void sheetShareCard.offsetWidth;
    sheetShareCard.classList.add("flash");
  }
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
    pages: normalizePositivePages(book.pages, 1),
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
  const pageRaw = Number(rawDoc?.number_of_pages_median);
  const hasPageCount = Number.isFinite(pageRaw) && pageRaw > 0;
  const pageCount = hasPageCount ? normalizePositivePages(pageRaw, 0) : 0;
  const category = inferCategoryFromText(`${title} ${author} ${query}`);
  return {
    key: buildCatalogKey(title, author),
    title,
    author,
    isbn,
    pages: pageCount,
    pagesEstimated: !hasPageCount,
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
  const pageRaw = Number(volume.pageCount);
  const hasPageCount = Number.isFinite(pageRaw) && pageRaw > 0;
  const pageCount = hasPageCount ? normalizePositivePages(pageRaw, 0) : 0;
  const categories = Array.isArray(volume.categories) ? volume.categories.join(" ") : "";
  const category = inferCategoryFromText(`${title} ${author} ${categories} ${query}`);
  return {
    key: buildCatalogKey(title, author),
    title,
    author,
    isbn,
    pages: pageCount,
    pagesEstimated: !hasPageCount,
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

function buildPageResolutionCacheKey(book) {
  const isbn = normalizeIsbn13(book?.isbn || "");
  if (isbn) return `isbn:${isbn}`;
  return `${normalizeText(book?.title || "")}::${normalizeText(book?.author || "")}`;
}

function scorePageCandidate(target, candidate) {
  const compareQuery = `${target.title || ""} ${target.author || ""}`.trim();
  const targetIsbn = normalizeIsbn13(target.isbn || "");
  const candidateIsbn = normalizeIsbn13(candidate.isbn || "");
  let score = rankMatch(
    {
      title: candidate.title || "",
      author: candidate.author || "",
      isbn: candidateIsbn
    },
    compareQuery
  );
  if (targetIsbn && candidateIsbn && targetIsbn === candidateIsbn) {
    score += 600;
  }
  if (candidate.source?.provider === "googlebooks-live") {
    score += 24;
  } else if (candidate.source?.provider === "openlibrary-live") {
    score += 12;
  }
  if (candidate.pages !== 320) {
    score += 6;
  }
  return score;
}

function applyResolvedPagesToCatalogBook(book, pages) {
  const safePages = normalizePositivePages(pages, 0);
  if (safePages <= 0) return;
  book.pages = safePages;
  book.pagesEstimated = false;
  if (book.key && transientCatalogMap.has(book.key)) {
    const transient = transientCatalogMap.get(book.key);
    if (transient) {
      transient.pages = safePages;
      transient.pagesEstimated = false;
    }
  }
  if (book.key) {
    ensureMergedCatalog();
    const merged = catalogStore.mergedMap.get(book.key);
    if (merged) {
      merged.pages = safePages;
      merged.pagesEstimated = false;
    }
  }
  fillEntryFormFromCatalog(book);
}

async function resolveReliablePagesForCatalogBook(book) {
  if (!book) return null;
  const cacheKey = buildPageResolutionCacheKey(book);
  if (pageResolutionCache.has(cacheKey)) {
    return pageResolutionCache.get(cacheKey);
  }

  const queryParts = [String(book.title || "").trim(), String(book.author || "").trim()].filter(Boolean);
  const query = queryParts.join(" ");
  const isbn = normalizeIsbn13(book.isbn || "");
  if (!query && !isbn) {
    pageResolutionCache.set(cacheKey, null);
    return null;
  }

  const queryQueue = [];
  if (isbn) {
    queryQueue.push(`isbn:${isbn}`);
  }
  if (query) {
    queryQueue.push(query);
    if (hasCjk(query)) {
      queryQueue.push(`${query} language:chi`);
    }
  }

  const seenKeys = new Set();
  const candidates = [];
  for (const term of queryQueue) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PAGE_RESOLVE_TIMEOUT_MS);
    try {
      const settled = await Promise.allSettled([
        searchOnlineOpenLibrary(term, controller.signal),
        searchOnlineGoogleBooks(term, controller.signal)
      ]);
      for (const item of settled) {
        if (item.status !== "fulfilled") continue;
        const rows = Array.isArray(item.value) ? item.value : [];
        for (const row of rows.slice(0, PAGE_RESOLVE_SCAN_LIMIT)) {
          const safePages = normalizePositivePages(row.pages, 0);
          if (safePages <= 0 || row.pagesEstimated) continue;
          const rowKey = `${normalizeText(row.title)}::${normalizeText(row.author)}::${normalizeIsbn13(row.isbn || "")}::${safePages}`;
          if (seenKeys.has(rowKey)) continue;
          seenKeys.add(rowKey);
          candidates.push({
            ...row,
            pages: safePages,
            _score: scorePageCandidate(book, row)
          });
        }
      }
      if (candidates.length > 0) {
        break;
      }
    } catch {
      // ignore and continue fallback terms
    } finally {
      clearTimeout(timeout);
    }
  }

  if (candidates.length === 0) {
    pageResolutionCache.set(cacheKey, null);
    return null;
  }

  candidates.sort((a, b) => b._score - a._score);
  const best = candidates[0];
  const resolved = {
    pages: best.pages,
    provider: String(best.source?.provider || "online")
  };
  pageResolutionCache.set(cacheKey, resolved);
  return resolved;
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

  if (!queryNorm) {
    return {
      items: [],
      total: 0,
      truncated: false,
      message: "请输入书名 / 作者 / ISBN 后开始检索。"
    };
  }

  const catalog = buildOfflineCatalog();

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
  if (elements.entryPagesInput) {
    const safePages = normalizePositivePages(book.pages, 0);
    elements.entryPagesInput.value = safePages > 0 ? String(safePages) : "";
  }
}

function clearEntryCustomFields() {
  if (elements.entryTitleInput) elements.entryTitleInput.value = "";
  if (elements.entryAuthorInput) elements.entryAuthorInput.value = "";
  if (elements.entryIsbnInput) elements.entryIsbnInput.value = "";
  if (elements.entryPagesInput) elements.entryPagesInput.value = "";
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
    elements.entrySelectionPill?.classList.add("hidden");
    if (elements.entryAddBtn) {
      elements.entryAddBtn.textContent = "录入并结算";
      elements.entryAddBtn.classList.remove("armed");
      elements.entryAddBtn.classList.remove("armed-pulse");
    }
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
    elements.entrySelectionPill?.classList.add("hidden");
    if (elements.entryAddBtn) {
      elements.entryAddBtn.textContent = "录入并结算";
      elements.entryAddBtn.classList.remove("armed");
      elements.entryAddBtn.classList.remove("armed-pulse");
    }
    return;
  }
  elements.entrySelectedBook.classList.remove("hidden");
  elements.entrySelectedBook.innerHTML = `
    <p class="selection-title">${escapeHtml(selected.title)}</p>
    <p class="selection-sub">${escapeHtml(selected.author)} · ${escapeHtml(CATEGORY_LABELS[selected.category] || "通识")} · ${formatPagesLabel(selected.pages, Boolean(selected.pagesEstimated))}</p>
  `;
  if (elements.entrySelectionPill) {
    elements.entrySelectionPill.classList.remove("hidden");
    elements.entrySelectionPill.innerHTML = `
      <span class="selection-pill-kicker">已选择</span>
      <strong>${escapeHtml(selected.title)}</strong>
      <span class="selection-pill-sub">${escapeHtml(selected.author)}</span>
    `;
  }
  if (elements.entryAddBtn) {
    elements.entryAddBtn.textContent = `录入《${compactLabel(selected.title)}》并结算`;
    elements.entryAddBtn.classList.add("armed");
  }
}

function pulseSelectionAffordance() {
  if (elements.entrySelectionPill) {
    elements.entrySelectionPill.classList.remove("selection-pulse");
    void elements.entrySelectionPill.offsetWidth;
    elements.entrySelectionPill.classList.add("selection-pulse");
  }
  if (elements.entryAddBtn) {
    elements.entryAddBtn.classList.remove("armed-pulse");
    void elements.entryAddBtn.offsetWidth;
    elements.entryAddBtn.classList.add("armed-pulse");
  }
  audioEngine.playSfx("tap");
  triggerHaptic("light");
}

function buildSearchItemHtml(item, query, active, sheetMode = false) {
  const sourceLabel = item.source?.manual_online ? "联网" : "离线";
  const pagesText = formatPagesLabel(item.pages, Boolean(item.pagesEstimated));
  return `
    <button type="button" class="search-item${active ? " active" : ""}${sheetMode ? " sheet-select-book" : ""}" data-catalog-key="${escapeHtml(item.key)}">
      <p class="search-item-title">${highlightMatch(item.title, query)}</p>
      <p class="search-item-sub">${highlightMatch(item.author, query)} · ${escapeHtml(CATEGORY_LABELS[item.category] || "通识")} · ${pagesText} · ${sourceLabel}</p>
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
  const preview = state.books.slice(0, ENTRY_BOOK_PREVIEW_LIMIT);
  if (preview.length === 0) {
    elements.entryBookList.innerHTML =
      '<div class="item"><p class="item-title">还没有书籍</p><p class="item-sub">先录入一本，点亮你的第一颗星</p></div>';
    elements.entryBooksMoreBtn.disabled = true;
    return;
  }

  elements.entryBookList.innerHTML = preview
    .map((book) => {
      const statusText =
        book.status === "finished"
          ? "已完成"
          : book.status === "reading"
            ? `${book.progress}%`
            : "待开始";
      return `
        <div class="item item-preview">
          <p class="item-title">${escapeHtml(book.title)}</p>
          <span class="item-meta">${escapeHtml(statusText)}</span>
        </div>
      `;
    })
    .join("");
  elements.entryBooksMoreBtn.disabled = state.books.length <= ENTRY_BOOK_PREVIEW_LIMIT;
}

function renderEntry() {
  setEntryMode(entryMode);
  renderEntryQuestCard();
  renderEntryHonorCard();
  renderEntrySearchResults();
  renderSelectedBookCard();
  renderEntryBookPreview();
  if (elements.entryAddBtn) {
    elements.entryAddBtn.disabled = pageResolveBusy;
    if (pageResolveBusy) {
      elements.entryAddBtn.textContent = "核验页数中...";
    }
  }
}

function hasDuplicateBook(title, author) {
  const key = `${normalizeText(title)}::${normalizeText(author)}`;
  return state.books.some((book) => bookKey(book) === key);
}

function primeCustomEntryFieldsFromCatalog(book) {
  if (!book) return;
  if (elements.entryTitleInput) elements.entryTitleInput.value = book.title || "";
  if (elements.entryAuthorInput) elements.entryAuthorInput.value = book.author || "";
  if (elements.entryIsbnInput) elements.entryIsbnInput.value = book.isbn || "";
  if (elements.entryPagesInput) elements.entryPagesInput.value = "";
  if (elements.entryCategorySelect && !elements.entryCategorySelect.value) {
    elements.entryCategorySelect.value = book.category || "";
  }
}

function formatPagesResolveSource(provider) {
  if (provider === "googlebooks-live") return "Google Books";
  if (provider === "openlibrary-live") return "Open Library";
  return "联网书源";
}

async function ensureCatalogBookHasReliablePages(selected) {
  if (!selected) return false;
  const safePages = normalizePositivePages(selected.pages, 0);
  if (!isCatalogPagesUntrusted(selected) && safePages > 0) {
    return true;
  }
  if (pageResolveBusy) {
    setEntryFeedback("正在核验页数，请稍候...");
    return false;
  }
  pageResolveBusy = true;
  setEntryFeedback(`正在核验《${selected.title}》的真实页数...`);
  renderEntry();
  if (sheetState.type === "world-entry") {
    renderWorldEntrySheet(elements.entryFeedback?.textContent || "正在核验页数...");
  }
  try {
    const resolved = await resolveReliablePagesForCatalogBook(selected);
    if (!resolved || normalizePositivePages(resolved.pages, 0) <= 0) {
      primeCustomEntryFieldsFromCatalog(selected);
      setEntryMode("custom");
      setEntryFeedback("该书页数未能自动核验。请切换自编录入并填写真实页数后再录入。");
      renderEntry();
      if (sheetState.type === "world-entry") {
        renderWorldEntrySheet(elements.entryFeedback?.textContent || "");
      }
      return false;
    }
    applyResolvedPagesToCatalogBook(selected, resolved.pages);
    setEntryFeedback(`已核验页数：${resolved.pages}页（${formatPagesResolveSource(resolved.provider)}）。`);
    return true;
  } finally {
    pageResolveBusy = false;
  }
}

async function addEntryBook() {
  if (!elements.entryCategorySelect) return false;
  const category = elements.entryCategorySelect.value;
  if (!category) {
    setEntryFeedback("请先选择分类，再将这次阅读写入旅程。");
    return false;
  }

  let payload;
  let sourceType;
  let multiplier = 1;

  if (entryMode === "catalog") {
    const selected = getSelectedCatalogBook();
    if (!selected) {
      setEntryFeedback("先从搜索结果里选择一本书，再继续录入。");
      return false;
    }
    const resolved = await ensureCatalogBookHasReliablePages(selected);
    if (!resolved) {
      renderEntry();
      return false;
    }
    const catalogPages = normalizePositivePages(selected.pages, 0);
    if (catalogPages <= 0) {
      setEntryFeedback("页数核验失败，请改用自编录入并填写真实页数。");
      renderEntry();
      return false;
    }
    payload = {
      title: selected.title,
      author: selected.author,
      isbn: selected.isbn,
      pages: catalogPages,
      category
    };
    sourceType = selected.source?.manual_online ? "online" : "catalog";
  } else {
    const title = elements.entryTitleInput?.value.trim() || "";
    const author = elements.entryAuthorInput?.value.trim() || "未知作者";
    if (!title) {
      setEntryFeedback("自编录入需要先填写书名。");
      return false;
    }
    const customPages = normalizePositivePages(elements.entryPagesInput?.value, 0);
    if (customPages <= 0) {
      setEntryFeedback("请填写真实页数（1-4000）后再录入。");
      return false;
    }
    payload = {
      title,
      author,
      isbn: elements.entryIsbnInput?.value.trim() || "",
      pages: customPages,
      category
    };
    sourceType = "custom";
    multiplier = ENTRY_CUSTOM_MULTIPLIER;
  }

  if (hasDuplicateBook(payload.title, payload.author)) {
    setEntryFeedback("这本书已经在你的书单里了，不必重复录入。");
    return false;
  }

  const reward = calculateEntryReward({
    historyIndex: state.books.length + 1,
    dailyIndex: state.todayEntries + 1,
    isNew: true
  });
  const points = Math.max(1, Math.round(reward.points * multiplier));
  const willGain = Math.max(1, Math.round(points * ENTRY_WILL_GAIN_MULTIPLIER));
  const book = createBook({ ...payload, sourceType });

  state.books.unshift(book);
  invalidateCatalogMerge();
  state.todayEntries += 1;
  state.stats.attributes.will += willGain;
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
  setEntryFeedback(`已录入《${book.title}》，意志 +${willGain}，经验 +${points}${suffix}。`);
  lastHonorMessage = `《${book.title}》已登记入册。坚持今天的节奏，你会走得很远。`;
  renderAll();
  triggerShellBurst("entry");
  audioEngine.playSfx("entry");
  spawnGameToast(`录入成功 +${points}经验`, "gain", elements.entryAddBtn);
  return true;
}

function getShelfBooks() {
  const reading = state.books.filter((book) => book.status === "reading");
  const planned = state.books.filter((book) => book.status === "planned");
  const finished = state.books.filter((book) => book.status === "finished");
  const sortByUpdated = (a, b) => (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  reading.sort(sortByUpdated);
  planned.sort(sortByUpdated);
  finished.sort(sortByUpdated);
  return [...reading, ...planned, ...finished];
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
  return Math.max(1, Math.min(MAX_SHELF_PREVIEW, base));
}

function formatBookStatus(book) {
  if (book.status === "finished") return "已完成";
  if (book.status === "reading") return `阅读中 ${book.progress}%`;
  return "待开始";
}

function normalizeShelfFilter(filter) {
  return SHELF_FILTER_OPTIONS.some((item) => item.key === filter) ? filter : "all";
}

function getShelfLayoutConfig() {
  const widthHint =
    Number(elements.sheetContent?.clientWidth) ||
    Number(elements.shell?.clientWidth) ||
    Number(window.innerWidth) ||
    WORLD_CANVAS_WIDTH;

  let rowSize = 3;
  if (widthHint < 480) {
    rowSize = 2;
  } else if (widthHint >= 1180) {
    rowSize = 6;
  } else if (widthHint >= 920) {
    rowSize = 5;
  } else if (widthHint >= 680) {
    rowSize = 4;
  }
  const rowsPerPage = widthHint >= 920 ? 4 : 5;
  const pageSize = Math.max(1, rowSize * rowsPerPage);
  return { rowSize, rowsPerPage, pageSize };
}

function chunkBooksByRow(items, rowSize) {
  const rows = [];
  for (let index = 0; index < items.length; index += rowSize) {
    rows.push(items.slice(index, index + rowSize));
  }
  return rows;
}

function buildAttributeRowsHtml(keys = ATTRIBUTE_KEYS) {
  return keys.map((key) => {
    const value = state.stats.attributes[key] || 0;
    const meta = getAttributeProgressMeta(value);
    const width = value > 0 ? Math.max(2, meta.barWidth) : 0;
    return `
      <div class="attr-row">
        <span class="attr-label"><img class="attr-icon" src="./assets/icons/${key}.svg" alt="" />${ATTRIBUTE_LABELS[key]}</span>
        <div class="attr-track"><div class="attr-fill" style="width:${width}%"></div></div>
        <span class="attr-value" data-attr-key="${key}" data-attr-value="${value}">${value}/${meta.max}</span>
      </div>
    `;
  }).join("");
}

function applyBookProgressUpdate(book, nextProgressValue, { allowDecrease = false } = {}) {
  const previousProgress = Math.max(0, Math.min(100, Number(book.progress) || 0));
  const nextProgress = Math.max(0, Math.min(100, Number(nextProgressValue) || 0));
  const totalPages = Math.max(1, Number(book.pages) || 1);
  const previousReadPages = Math.max(
    0,
    Math.min(totalPages, Number(book.progressPages) || Math.round((totalPages * previousProgress) / 100))
  );
  const nextReadPages = Math.max(0, Math.min(totalPages, Math.round((totalPages * nextProgress) / 100)));
  const deltaReadPages = nextReadPages - previousReadPages;
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
    book.progressPages = nextReadPages;
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
  book.progressPages = nextReadPages;
  book.status = nextProgress >= 100 ? "finished" : "reading";
  if (deltaReadPages > 0) {
    state.todayReadPages = Math.max(0, Number(state.todayReadPages) || 0) + deltaReadPages;
  }
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
    !elements.panelAttributeSummaryList ||
    !elements.panelSkillList ||
    !elements.panelAchievementList
  ) {
    return;
  }

  const required = requiredExpForLevel(state.stats.level);
  const done = getCompletedBooks(state).length;
  const xpPercent = required > 0 ? Math.round((state.stats.exp / required) * 100) : 0;
  elements.panelLevelLine.textContent = `Lv.${state.stats.level} · 经验 ${state.stats.exp}/${required} · 已完成 ${done} 本 · 同步率 ${xpPercent}%`;
  if (elements.panelXpFill) {
    elements.panelXpFill.style.width = `${Math.max(0, Math.min(100, xpPercent))}%`;
  }

  elements.panelAttributeSummaryList.innerHTML = ATTRIBUTE_KEYS
    .map((key) => {
      const value = state.stats.attributes[key] || 0;
      const meta = getAttributeProgressMeta(value);
      const width = value > 0 ? Math.max(2, meta.barWidth) : 0;
      const tier = getAttributeTier(value);
      return `
        <article class="attr-rpg-row tier-${tier.toLowerCase()}">
          <div class="attr-rpg-head">
            <span class="attr-rpg-label"><img class="attr-icon" src="./assets/icons/${key}.svg" alt="" />${escapeHtml(ATTRIBUTE_LABELS[key])}</span>
            <span class="attr-rpg-tier">T${tier} · ${value}/${meta.max}</span>
          </div>
          <div class="attr-rpg-body">
            <b class="attr-rpg-value" data-attr-key="${key}" data-attr-value="${value}">${value}</b>
            <div class="attr-rpg-track"><div class="attr-rpg-fill" style="width:${width}%"></div></div>
          </div>
        </article>
      `;
    })
    .join("");

  elements.panelAttributeSummaryList.querySelectorAll(".attr-rpg-value").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const key = node.dataset.attrKey || "";
    const value = Number(node.dataset.attrValue || "0");
    animateNumber(node, key, value);
  });

  const unlockedSkills = state.stats.skills || [];
  const unlockedSet = new Set(unlockedSkills.map((skill) => skill.id));
  const autoSkills = [...unlockedSkills].slice(-3).reverse();
  const autoIds = new Set(autoSkills.map((skill) => skill.id));
  elements.panelSkillList.innerHTML = `
    <article class="skill-crest ${unlockedSkills.length > 0 ? "active" : "empty"}">
      <p class="skill-crest-title">${unlockedSkills.length > 0 ? `阶梯共鸣 ${unlockedSkills.length}/${SKILL_RULES.length}` : "尚未点亮技能星"} </p>
      <p class="skill-crest-sub">${unlockedSkills.length > 0 ? "技能沿阶梯逐层解锁，自动装备最近解锁的 3 星。" : "继续推进阅读进度，即可点亮第一阶技能。"}</p>
    </article>
    <div class="skill-lane-progress">${buildSkillLaneProgressHtml(unlockedSet)}</div>
  `;

  if (elements.panelSkillStarMap) {
    elements.panelSkillStarMap.style.setProperty("--skill-tier-count", String(SKILL_MAX_TIER));
    elements.panelSkillStarMap.style.setProperty("--skill-path-count", String(SKILL_PATH_ORDER.length));
    elements.panelSkillStarMap.innerHTML = SKILL_RULES
      .map((rule, index) => {
        const position = getSkillNodePosition(index, SKILL_RULES.length, rule);
        const unlocked = unlockedSet.has(rule.id);
        const equipped = autoIds.has(rule.id);
        const classes = [
          "skill-star-node",
          `path-${escapeHtml(rule.path || "general")}`,
          `tier-${Math.max(1, Number(rule.tier) || 1)}`,
          unlocked ? "unlocked" : "locked",
          equipped ? "equipped" : "",
          panelSkillPulseId && panelSkillPulseId === rule.id ? "pulse" : ""
        ]
          .filter(Boolean)
          .join(" ");
        return `
          <button
            type="button"
            class="${classes}"
            data-skill-id="${escapeHtml(rule.id)}"
            style="--x:${position.x}%; --y:${position.y}%"
            aria-label="${escapeHtml(rule.name)}"
          >
            <span class="skill-star-tier">T${Math.max(1, Number(rule.tier) || 1)}</span>
            <span class="skill-star-core" aria-hidden="true"></span>
            <span class="skill-star-name">${escapeHtml(rule.name)}</span>
          </button>
        `;
      })
      .join("");
  }

  if (elements.panelSkillAutoSlots) {
    const slots = [0, 1, 2].map((slotIndex) => autoSkills[slotIndex] || null);
    elements.panelSkillAutoSlots.innerHTML = slots
      .map((skill, idx) => {
        if (!skill) {
          return `<span class="auto-slot empty">槽位 ${idx + 1} · 待解锁</span>`;
        }
        return `<span class="auto-slot">槽位 ${idx + 1} · ${escapeHtml(skill.name)}</span>`;
      })
      .join("");
  }

  if (panelSkillPulseId) {
    if (panelSkillPulseTimer) {
      clearTimeout(panelSkillPulseTimer);
    }
    panelSkillPulseTimer = window.setTimeout(() => {
      panelSkillPulseTimer = 0;
      panelSkillPulseId = "";
      if (elements.panelSkillStarMap) {
        renderPanel();
      }
    }, 680);
  }

  const unlocked = new Set((state.stats.achievements || []).map((item) => item.name));
  const achievementPreview = ACHIEVEMENT_RULES.slice(0, 4);
  elements.panelAchievementList.innerHTML = achievementPreview
    .map((item) => `<span class="chip${unlocked.has(item.name) ? " active" : ""}">${item.threshold}本 · ${escapeHtml(item.name)}</span>`)
    .join("");
}

function renderShelf() {
  if (!elements.panelShelfList || !elements.panelShelfMoreBtn) return;

  const shelfBooks = getShelfBooks();
  if (activeShelfUid && !shelfBooks.some((item) => item.uid === activeShelfUid)) {
    activeShelfUid = "";
  }
  if (shelfPulseUid && !shelfBooks.some((item) => item.uid === shelfPulseUid)) {
    shelfPulseUid = "";
  }

  const shelfPreview = shelfBooks.slice(0, getPanelShelfPreviewLimit());
  if (shelfPreview.length === 0) {
    elements.panelShelfList.innerHTML = '<div class="scroll-empty">还没有在读或已完成书籍。先从录入页开始吧。</div>';
  } else {
    elements.panelShelfList.innerHTML = shelfPreview
      .map((book) => {
        const progress = Math.max(0, Math.min(100, Number(book.progress) || 0));
        const reflectionsCount = Array.isArray(book.reflections) ? book.reflections.length : 0;
        const readPages = Number(book.progressPages) || Math.round((book.pages * progress) / 100);
        const expanded = activeShelfUid === book.uid;
        const foldedStatus =
          book.status === "finished" ? "已完成" : book.status === "reading" ? "在读" : "待开始";
        return `
          <article class="panel-scroll-card${expanded ? " expanded" : ""}${shelfPulseUid === book.uid ? " pulse" : ""}" data-book-uid="${escapeHtml(book.uid)}">
            <button
              type="button"
              class="scroll-main-hit panel-open-book"
              data-book-uid="${escapeHtml(book.uid)}"
              aria-expanded="${expanded ? "true" : "false"}"
            >
              <div class="scroll-roll-shell">
                <span class="scroll-roll-end left" aria-hidden="true"></span>
                <div class="scroll-roll-core">
                  <p class="scroll-roll-title">${escapeHtml(book.title)}</p>
                  <div class="scroll-roll-meta">
                    <span class="scroll-roll-status">${escapeHtml(foldedStatus)}</span>
                    <span class="scroll-chevron${expanded ? " expanded" : ""}" aria-hidden="true"></span>
                  </div>
                </div>
                <span class="scroll-roll-end right" aria-hidden="true"></span>
              </div>
              <div class="scroll-unfurl" aria-hidden="${expanded ? "false" : "true"}">
                <div class="scroll-paper">
                  <div class="scroll-card-head">
                    <p class="scroll-title">${escapeHtml(book.title)}</p>
                    <div class="scroll-head-meta">
                      <span class="badge">${escapeHtml(formatBookStatus(book))}</span>
                      <span class="scroll-percent">${progress}%</span>
                    </div>
                  </div>
                  <p class="scroll-sub">${escapeHtml(book.author)} · ${escapeHtml(CATEGORY_LABELS[book.category] || "通识")}</p>
                  <div class="scroll-track"><div class="scroll-fill" style="width:${progress}%"></div></div>
                </div>
              </div>
            </button>
            <div class="scroll-detail">
              <p class="scroll-detail-meta">已读 ${readPages}/${book.pages} 页 · 感触 ${reflectionsCount} 条 · 更新于 ${formatShortDate(book.updatedAt || book.createdAt)}</p>
              <div class="scroll-detail-actions">
                <button type="button" class="btn-ghost scroll-inline-btn panel-open-book-detail-btn" data-book-uid="${escapeHtml(book.uid)}">查看并编辑</button>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  elements.panelShelfMoreBtn.disabled = shelfBooks.length <= shelfPreview.length;
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

function getSharePayload() {
  const nickname = state.profile.nickname || "旅者001";
  const done = getCompletedBooks(state).length;
  const sorted = [...ATTRIBUTE_KEYS].sort(
    (a, b) => (state.stats.attributes[b] || 0) - (state.stats.attributes[a] || 0)
  );
  const topAttrs = sorted.slice(0, 2);
  const topSkills = state.stats.skills.slice(0, 2);
  const invite = state.profile.inviteCode || "RJ-2026";
  const text = `我是${nickname}，当前 Lv.${state.stats.level}，已完成 ${done} 本，${ATTRIBUTE_LABELS[topAttrs[0]]} ${state.stats.attributes[topAttrs[0]]}。邀请码：${invite}`;
  return {
    nickname,
    done,
    topAttrs,
    topSkills,
    invite,
    text
  };
}

function renderShareSheet(feedbackText = "") {
  if (!elements.sheetTitle || !elements.sheetContent) return;
  const payload = getSharePayload();
  elements.sheetTitle.textContent = "星图证书";
  elements.sheetContent.innerHTML = `
    <section class="sheet-share-wrap">
      <label>
        昵称
        <input id="sheet-share-nickname-input" type="text" maxlength="24" value="${escapeHtml(payload.nickname)}" />
      </label>
      <article id="sheet-share-card" class="share-card">
        <h3>${escapeHtml(payload.nickname)}</h3>
        <p>Lv.${state.stats.level} · 已完成 ${payload.done} 本</p>
        <p>优势属性：${payload.topAttrs.map((key) => `${ATTRIBUTE_LABELS[key]} ${state.stats.attributes[key] || 0}`).join(" / ")}</p>
        <p>${payload.topSkills.length > 0 ? `代表技能：${payload.topSkills.map((skill) => skill.name).join(" / ")}` : "代表技能：尚未解锁"}</p>
        <p>邀请码：${escapeHtml(payload.invite)}</p>
      </article>
      <div class="inline-actions">
        <button id="sheet-share-copy-invite-btn" class="btn-secondary" type="button">复制邀请码</button>
        <button id="sheet-share-copy-btn" class="btn-primary" type="button">复制分享文案</button>
      </div>
      <p id="sheet-share-feedback" class="feedback">${escapeHtml(feedbackText)}</p>
    </section>
  `;
}

function getSheetFeedbackText() {
  const feedbackNode = elements.sheetContent?.querySelector(".feedback");
  if (!(feedbackNode instanceof HTMLElement)) return "";
  return String(feedbackNode.textContent || "").trim();
}

function snapshotCurrentSheet() {
  if (sheetState.type === "none") return null;
  if (sheetState.type === "generic") {
    return {
      type: "generic",
      title: sheetState.title,
      html: sheetState.html
    };
  }
  if (sheetState.type === "world-entry") {
    return {
      type: "world-entry",
      feedbackText: getSheetFeedbackText()
    };
  }
  if (sheetState.type === "world-panel") {
    return { type: "world-panel" };
  }
  if (sheetState.type === "world-settings") {
    return {
      type: "world-settings",
      feedbackText: getSheetFeedbackText()
    };
  }
  if (sheetState.type === "search") {
    return {
      type: "search",
      searchItems: [...sheetState.searchItems],
      searchTotal: sheetState.searchTotal,
      searchTruncated: sheetState.searchTruncated,
      searchLoaded: sheetState.searchLoaded,
      query: sheetState.query,
      searchMode: sheetState.searchMode
    };
  }
  if (sheetState.type === "book-detail") {
    return {
      type: "book-detail",
      bookUid: sheetState.bookUid,
      editingReflectionId: sheetState.editingReflectionId,
      feedbackText: getSheetFeedbackText()
    };
  }
  if (sheetState.type === "book-pages-editor") {
    return {
      type: "book-pages-editor",
      bookUid: sheetState.bookUid,
      feedbackText: getSheetFeedbackText()
    };
  }
  if (sheetState.type === "share") {
    return {
      type: "share",
      feedbackText: getSheetFeedbackText()
    };
  }
  return null;
}

function getSheetSnapshotKey(snapshot) {
  if (!snapshot) return "none";
  if (snapshot.type === "generic") {
    return `generic:${snapshot.title || ""}`;
  }
  if (snapshot.type === "search") {
    return `search:${snapshot.searchMode || "offline"}:${snapshot.query || ""}`;
  }
  if (snapshot.type === "book-detail") {
    return `book-detail:${snapshot.bookUid || ""}`;
  }
  if (snapshot.type === "book-pages-editor") {
    return `book-pages-editor:${snapshot.bookUid || ""}`;
  }
  return snapshot.type;
}

function syncSheetBackButtonState() {
  if (!(elements.sheetBackBtn instanceof HTMLButtonElement)) return;
  const canGoBack = sheetHistoryStack.length > 0;
  elements.sheetBackBtn.hidden = !canGoBack;
  elements.sheetBackBtn.disabled = !canGoBack;
}

function clearSheetHistory() {
  sheetHistoryStack.length = 0;
  syncSheetBackButtonState();
}

function rememberSheetForBack(nextSnapshotKey, skipHistory = false) {
  if (skipHistory) {
    syncSheetBackButtonState();
    return;
  }
  if (!(elements.sheetDialog instanceof HTMLElement) || !elements.sheetDialog.hasAttribute("open")) {
    syncSheetBackButtonState();
    return;
  }
  const current = snapshotCurrentSheet();
  if (!current) {
    syncSheetBackButtonState();
    return;
  }
  const currentKey = getSheetSnapshotKey(current);
  if (nextSnapshotKey && currentKey === nextSnapshotKey) {
    syncSheetBackButtonState();
    return;
  }
  const last = sheetHistoryStack[sheetHistoryStack.length - 1];
  if (!last || getSheetSnapshotKey(last) !== currentKey) {
    sheetHistoryStack.push(current);
    if (sheetHistoryStack.length > 16) {
      sheetHistoryStack.shift();
    }
  }
  syncSheetBackButtonState();
}

function restoreSheetFromSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.type === "world-entry") {
    openWorldEntrySheet(snapshot.feedbackText || "", { skipHistory: true });
    return;
  }
  if (snapshot.type === "world-panel") {
    openWorldPanelSheet({ skipHistory: true });
    return;
  }
  if (snapshot.type === "world-settings") {
    openWorldSettingsSheet(snapshot.feedbackText || "", { skipHistory: true });
    return;
  }
  if (snapshot.type === "share") {
    openShareSheet({ skipHistory: true, feedbackText: snapshot.feedbackText || "" });
    return;
  }
  if (snapshot.type === "search") {
    openSearchSheet(
      {
        items: Array.isArray(snapshot.searchItems) ? snapshot.searchItems : [],
        total: Number(snapshot.searchTotal) || 0,
        truncated: Boolean(snapshot.searchTruncated)
      },
      snapshot.searchMode || "offline",
      {
        skipHistory: true,
        loaded: Number(snapshot.searchLoaded) || SEARCH_SHEET_PAGE_SIZE,
        query: snapshot.query || ""
      }
    );
    return;
  }
  if (snapshot.type === "book-detail") {
    openBookDetailSheet(snapshot.bookUid, {
      skipHistory: true,
      feedbackText: snapshot.feedbackText || "",
      editingReflectionId: snapshot.editingReflectionId || ""
    });
    return;
  }
  if (snapshot.type === "book-pages-editor") {
    openBookPagesEditorSheet(snapshot.bookUid, {
      skipHistory: true,
      feedbackText: snapshot.feedbackText || ""
    });
    return;
  }
  if (snapshot.type === "generic") {
    openSheet(snapshot.title || "详情", snapshot.html || "", { skipHistory: true });
  }
}

function goBackSheet() {
  if (sheetHistoryStack.length === 0) return;
  const snapshot = sheetHistoryStack.pop();
  syncSheetBackButtonState();
  restoreSheetFromSnapshot(snapshot);
}

function openShareSheet(options = {}) {
  const { skipHistory = false, feedbackText = "" } = options;
  if (!elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  rememberSheetForBack("share", skipHistory);
  sheetState.type = "share";
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";
  renderShareSheet(feedbackText);
  elements.headerShareBtn?.classList.add("active");
  audioEngine.playSfx("tap");
  triggerHaptic("light");
  if (elements.sheetDialog.hasAttribute("open")) {
    syncWorldSceneState();
    return;
  }
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    syncWorldSceneState();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
  syncWorldSceneState();
  syncSheetBackButtonState();
}

function buildCategoryOptionsHtml(selectedCategory = "") {
  const selected = String(selectedCategory || "");
  return [
    '<option value="">请选择分类</option>',
    ...ENTRY_CATEGORY_ORDER.map(
      (key) =>
        `<option value="${key}"${selected === key ? " selected" : ""}>${escapeHtml(CATEGORY_LABELS[key] || key)}</option>`
    )
  ].join("");
}

function renderWorldEntrySheet(feedbackText = "") {
  if (!elements.sheetTitle || !elements.sheetContent) return;
  const selected = getSelectedCatalogBook();
  const query = String(entrySearchQuery || "").trim();
  const searchData = entryMode === "catalog" ? searchCatalogBooks() : null;
  const previewLimit = 8;
  const previewItems = searchData ? searchData.items.slice(0, previewLimit) : [];
  const resultHtml =
    entryMode !== "catalog"
      ? '<p class="tip">当前为自编录入模式，可直接填写书籍信息。</p>'
      : searchData?.message
        ? `<div class="search-empty">${escapeHtml(searchData.message)}</div>`
        : previewItems.length === 0
          ? '<div class="search-empty">暂无匹配，试试更换关键词或切换自编录入。</div>'
          : previewItems.map((item) => buildSearchItemHtml(item, query, selectedCatalogKey === item.key, true)).join("");

  const selectedHtml =
    entryMode === "catalog" && selected
      ? `
        <div class="selection-pill">
          <span class="selection-pill-kicker">已选择</span>
          <strong>${escapeHtml(selected.title)}</strong>
          <span class="selection-pill-sub">${escapeHtml(selected.author)} · ${formatPagesLabel(selected.pages, Boolean(selected.pagesEstimated))}</span>
        </div>
      `
      : "";

  const customValues = {
    title: elements.entryTitleInput?.value || "",
    author: elements.entryAuthorInput?.value || "",
    isbn: elements.entryIsbnInput?.value || "",
    pages: elements.entryPagesInput?.value || ""
  };

  const customFieldsHtml =
    entryMode === "custom"
      ? `
        <div class="field-grid two">
          <label>
            书名
            <input id="sheet-world-entry-title" type="text" maxlength="120" value="${escapeHtml(customValues.title)}" placeholder="自编书名" />
          </label>
          <label>
            作者
            <input id="sheet-world-entry-author" type="text" maxlength="120" value="${escapeHtml(customValues.author)}" placeholder="作者（可选）" />
          </label>
          <label>
            ISBN
            <input id="sheet-world-entry-isbn" type="text" maxlength="24" value="${escapeHtml(customValues.isbn)}" placeholder="978..." />
          </label>
          <label>
            页数
            <input id="sheet-world-entry-pages" type="number" min="1" max="4000" value="${escapeHtml(customValues.pages)}" placeholder="例如：368" />
          </label>
        </div>
      `
      : "";

  const currentCategory =
    entryMode === "catalog"
      ? selected?.category || elements.entryCategorySelect?.value || ""
      : elements.entryCategorySelect?.value || "";
  const modeHint =
    entryMode === "custom"
      ? "自编录入模式：可自由添加，奖励系数 x0.7。"
      : "书库录入模式：可离线检索，也可手动联网补充真实书籍。";
  const canShowMore =
    entryMode === "catalog" && searchData && !searchData.message && searchData.items.length > previewLimit;
  const statusLine = formatOnlineSearchStatusLine();
  const feedback = feedbackText || elements.entryFeedback?.textContent || statusLine || "";

  const recentBooks = state.books.slice(0, ENTRY_BOOK_PREVIEW_LIMIT);
  const recentHtml =
    recentBooks.length > 0
      ? recentBooks
          .map((book) => {
            const statusText =
              book.status === "finished" ? "已完成" : book.status === "reading" ? `阅读中 ${book.progress}%` : "待开始";
            return `<div class="item item-preview"><p class="item-title">${escapeHtml(book.title)}</p><span class="item-meta">${escapeHtml(statusText)}</span></div>`;
          })
          .join("")
      : '<div class="item"><p class="item-title">还没有书籍</p><p class="item-sub">先录入一本，点亮你的第一颗星</p></div>';

  elements.sheetTitle.textContent = "录入台";
  elements.sheetContent.innerHTML = `
    <section class="sheet-world-entry">
      <p class="tip strong">今日目标：再录入 ${Math.max(0, 3 - state.todayEntries)} 本（建议上限 3 本）。</p>
      <label>
        搜索书名 / 作者 / ISBN
        <input id="sheet-world-entry-search-input" type="text" value="${escapeHtml(query)}" placeholder="例如：思考，快与慢" />
      </label>
      <div id="sheet-world-entry-results" class="search-results">${resultHtml}</div>
      <div class="inline-actions">
        <button id="sheet-world-entry-more-btn" class="btn-ghost" type="button"${canShowMore ? "" : " disabled"}>
          ${searchData?.truncated ? `查看更多结果（共${searchData.total}）` : "查看更多结果"}
        </button>
        <button
          id="sheet-world-entry-online-btn"
          class="btn-ghost"
          type="button"
          ${entryMode !== "catalog" || query.length < 2 || onlineSearchBusy ? "disabled" : ""}
        >${onlineSearchBusy ? `联网中 ${onlineSearchProgressCompleted}/2` : "联网搜索"}</button>
        <button id="sheet-world-entry-mode-btn" class="btn-secondary" type="button">
          ${entryMode === "custom" ? "返回书库" : "自编录入"}
        </button>
      </div>
      ${selectedHtml}
      ${customFieldsHtml}
      <label>
        分类（必选）
        <select id="sheet-world-entry-category">${buildCategoryOptionsHtml(currentCategory)}</select>
      </label>
      <button id="sheet-world-entry-add-btn" class="btn-primary" type="button"${pageResolveBusy ? " disabled" : ""}>
        ${pageResolveBusy ? "核验页数中..." : entryMode === "catalog" && selected ? `录入《${escapeHtml(compactLabel(selected.title))}》并结算` : "录入并结算"}
      </button>
      <p class="tip">${escapeHtml(modeHint)}</p>
      ${feedback ? `<p class="feedback">${escapeHtml(feedback)}</p>` : ""}
      <section class="sheet-world-recent">
        <div class="card-head">
          <h3>正在阅读（3本为宜，不可贪多哦~）</h3>
        </div>
        <div class="stack-list compact">${recentHtml}</div>
      </section>
    </section>
  `;
}

function refreshWorldEntrySheetSearchSection() {
  if (sheetState.type !== "world-entry" || !elements.sheetContent) return;
  const query = String(entrySearchQuery || "").trim();
  const searchData = entryMode === "catalog" ? searchCatalogBooks() : null;
  const previewLimit = 8;
  const previewItems = searchData ? searchData.items.slice(0, previewLimit) : [];
  const resultHtml =
    entryMode !== "catalog"
      ? '<p class="tip">当前为自编录入模式，可直接填写书籍信息。</p>'
      : searchData?.message
        ? `<div class="search-empty">${escapeHtml(searchData.message)}</div>`
        : previewItems.length === 0
          ? '<div class="search-empty">暂无匹配，试试更换关键词或切换自编录入。</div>'
          : previewItems.map((item) => buildSearchItemHtml(item, query, selectedCatalogKey === item.key, true)).join("");

  const resultsRoot = elements.sheetContent.querySelector("#sheet-world-entry-results");
  if (resultsRoot instanceof HTMLElement) {
    resultsRoot.innerHTML = resultHtml;
  }

  const canShowMore =
    entryMode === "catalog" && searchData && !searchData.message && searchData.items.length > previewLimit;
  const moreBtn = elements.sheetContent.querySelector("#sheet-world-entry-more-btn");
  if (moreBtn instanceof HTMLButtonElement) {
    moreBtn.disabled = !canShowMore;
    moreBtn.textContent = searchData?.truncated ? `查看更多结果（共${searchData.total}）` : "查看更多结果";
  }

  const onlineBtn = elements.sheetContent.querySelector("#sheet-world-entry-online-btn");
  if (onlineBtn instanceof HTMLButtonElement) {
    onlineBtn.disabled = entryMode !== "catalog" || query.length < 2 || onlineSearchBusy;
    onlineBtn.textContent = onlineSearchBusy ? `联网中 ${onlineSearchProgressCompleted}/2` : "联网搜索";
  }

  if (!selectedCatalogKey) {
    const selectionPill = elements.sheetContent.querySelector(".sheet-world-entry .selection-pill");
    if (selectionPill instanceof HTMLElement) {
      selectionPill.remove();
    }
    const addBtn = elements.sheetContent.querySelector("#sheet-world-entry-add-btn");
    if (addBtn instanceof HTMLButtonElement) {
      addBtn.textContent = "录入并结算";
    }
  }
}

function openWorldEntrySheet(feedbackText = "", options = {}) {
  const { skipHistory = false } = options;
  if (!elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  rememberSheetForBack("world-entry", skipHistory);
  sheetState.type = "world-entry";
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";
  renderWorldEntrySheet(feedbackText);
  if (elements.sheetDialog.hasAttribute("open")) {
    syncWorldSceneState();
    return;
  }
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    syncWorldSceneState();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
  syncWorldSceneState();
  syncSheetBackButtonState();
}

function syncWorldEntrySheetFormToEntryElements() {
  const sheetRoot = elements.sheetContent;
  if (!(sheetRoot instanceof HTMLElement)) return;
  const queryInput = sheetRoot.querySelector("#sheet-world-entry-search-input");
  if (queryInput instanceof HTMLInputElement) {
    entrySearchQuery = queryInput.value || "";
    if (elements.entrySearchInput) {
      elements.entrySearchInput.value = entrySearchQuery;
    }
  }
  const categorySelect = sheetRoot.querySelector("#sheet-world-entry-category");
  if (categorySelect instanceof HTMLSelectElement && elements.entryCategorySelect) {
    elements.entryCategorySelect.value = categorySelect.value;
  }
  if (entryMode === "custom") {
    const titleInput = sheetRoot.querySelector("#sheet-world-entry-title");
    const authorInput = sheetRoot.querySelector("#sheet-world-entry-author");
    const isbnInput = sheetRoot.querySelector("#sheet-world-entry-isbn");
    const pagesInput = sheetRoot.querySelector("#sheet-world-entry-pages");
    if (titleInput instanceof HTMLInputElement && elements.entryTitleInput) {
      elements.entryTitleInput.value = titleInput.value;
    }
    if (authorInput instanceof HTMLInputElement && elements.entryAuthorInput) {
      elements.entryAuthorInput.value = authorInput.value;
    }
    if (isbnInput instanceof HTMLInputElement && elements.entryIsbnInput) {
      elements.entryIsbnInput.value = isbnInput.value;
    }
    if (pagesInput instanceof HTMLInputElement && elements.entryPagesInput) {
      elements.entryPagesInput.value = pagesInput.value;
    }
  }
}

function renderWorldPanelSheet() {
  if (!elements.sheetTitle || !elements.sheetContent) return;
  const required = requiredExpForLevel(state.stats.level);
  const done = getCompletedBooks(state).length;
  const unlocked = state.stats.skills || [];
  const unlockedMap = new Set(unlocked.map((item) => item.id));
  const unlockedAchievementNames = new Set((state.stats.achievements || []).map((item) => item.name));
  const unlockedAchievementCount = unlockedAchievementNames.size;
  const highestTierUnlocked = unlocked.reduce((maxTier, item) => {
    const rule = getSkillRuleById(item.id);
    return Math.max(maxTier, Math.max(1, Number(rule?.tier) || 1));
  }, 0);
  const pathProgress = SKILL_PATH_ORDER.map((path) => {
    const rules = getSkillRulesByPath(path);
    const unlockedCount = rules.filter((rule) => unlockedMap.has(rule.id)).length;
    const total = Math.max(1, rules.length);
    const ratio = Math.round((unlockedCount / total) * 100);
    const nextRule = rules.find((rule) => !unlockedMap.has(rule.id)) || null;
    return {
      path,
      unlockedCount,
      total: rules.length,
      ratio,
      nextRule
    };
  });
  const primaryPath = [...pathProgress].sort((a, b) => {
    if (b.unlockedCount !== a.unlockedCount) return b.unlockedCount - a.unlockedCount;
    return b.ratio - a.ratio;
  })[0] || null;
  const primaryPathText =
    primaryPath && primaryPath.unlockedCount > 0
      ? `${SKILL_PATH_LABELS[primaryPath.path] || SKILL_PATH_LABELS.general} ${primaryPath.unlockedCount}/${Math.max(
          1,
          primaryPath.total
        )}`
      : "尚未形成主修路径";
  const pathOverviewHtml = pathProgress
    .map((item) => {
      const nextText = item.nextRule
        ? `下一阶：${item.nextRule.name}（T${Math.max(1, Number(item.nextRule.tier) || 1)}）`
        : "已满阶：当前路线全部点亮";
      return `
        <article class="temple-path-card path-${escapeHtml(item.path)}">
          <div class="temple-path-head">
            <strong>${escapeHtml(SKILL_PATH_LABELS[item.path] || SKILL_PATH_LABELS.general)}</strong>
            <span>${item.unlockedCount}/${item.total}</span>
          </div>
          <div class="temple-path-track"><span class="temple-path-fill" style="width:${item.ratio}%"></span></div>
          <p class="tip">${escapeHtml(nextText)}</p>
        </article>
      `;
    })
    .join("");
  const skillPathLegendHtml = SKILL_PATH_ORDER.map((path) => {
    const label = SKILL_PATH_LABELS[path] || SKILL_PATH_LABELS.general;
    return `<span class="skill-path-legend path-${escapeHtml(path)}"><span class="skill-path-dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
  }).join("");
  const activeSkillsHtml =
    unlocked.length > 0
      ? unlocked
          .slice(-4)
          .reverse()
          .map((skill) => `<span class="chip active">${escapeHtml(skill.name)}</span>`)
          .join("")
      : '<span class="chip">尚未点亮技能</span>';

  const skillStarHtml = SKILL_RULES.map((rule, index) => {
    const pos = getSkillNodePosition(index, SKILL_RULES.length, rule);
    const classes = [
      "skill-star-node",
      `path-${escapeHtml(rule.path || "general")}`,
      `tier-${Math.max(1, Number(rule.tier) || 1)}`,
      unlockedMap.has(rule.id) ? "unlocked" : "locked"
    ].join(" ");
    return `
      <button
        type="button"
        class="${classes} sheet-world-skill-info"
        data-skill-id="${escapeHtml(rule.id)}"
        style="--x:${pos.x}%; --y:${pos.y}%"
      >
        <span class="skill-star-tier">T${Math.max(1, Number(rule.tier) || 1)}</span>
        <span class="skill-star-core" aria-hidden="true"></span>
        <span class="skill-star-name">${escapeHtml(rule.name)}</span>
      </button>
    `;
  }).join("");

  elements.sheetTitle.textContent = "星图神殿";
  elements.sheetContent.innerHTML = `
    <section class="sheet-world-panel temple-world-panel">
      <article class="panel-core temple-profile-card">
        <p class="panel-kicker">旅者档案</p>
        <p>Lv.${state.stats.level} · 经验 ${state.stats.exp}/${required} · 已完成 ${done} 本</p>
        <div class="xp-track"><div class="xp-fill" style="width:${Math.max(0, Math.min(100, Math.round((state.stats.exp / Math.max(1, required)) * 100)))}%"></div></div>
      </article>
      <div class="temple-quick-stats">
        <article class="temple-stat-chip">
          <span class="temple-stat-label">技能解锁</span>
          <strong>${unlocked.length}/${SKILL_RULES.length}</strong>
        </article>
        <article class="temple-stat-chip">
          <span class="temple-stat-label">最高阶</span>
          <strong>${highestTierUnlocked > 0 ? `T${highestTierUnlocked}` : "T0"}</strong>
        </article>
        <article class="temple-stat-chip">
          <span class="temple-stat-label">主修路线</span>
          <strong>${escapeHtml(primaryPathText)}</strong>
        </article>
        <article class="temple-stat-chip">
          <span class="temple-stat-label">成就进度</span>
          <strong>${unlockedAchievementCount}/${ACHIEVEMENT_RULES.length}</strong>
        </article>
      </div>
      <section class="temple-section temple-attrs-section">
        <div class="card-head">
          <h3>属性谱系</h3>
          <span class="badge">动态上限</span>
        </div>
        <div class="attribute-list">${buildAttributeRowsHtml()}</div>
      </section>
      <section class="temple-section temple-skill-map-section">
        <div class="card-head">
          <h3>技能星图</h3>
          <span class="tip">点击节点可查看解锁条件</span>
        </div>
        <div class="skill-path-legend-list">${skillPathLegendHtml}</div>
        <div class="skill-star-map" style="--skill-tier-count:${SKILL_MAX_TIER}; --skill-path-count:${SKILL_PATH_ORDER.length};">${skillStarHtml}</div>
      </section>
      <section class="temple-section temple-path-section">
        <div class="card-head">
          <h3>进阶路线</h3>
          <span class="badge">4 条</span>
        </div>
        <div class="temple-path-grid">${pathOverviewHtml}</div>
        <div class="skill-lane-progress">${buildSkillLaneProgressHtml(unlockedMap)}</div>
      </section>
      <section class="temple-section temple-achievement-section">
        <div class="card-head"><h3>当前共鸣与成就</h3></div>
        <div class="chip-list">
          ${activeSkillsHtml}
        </div>
        <div class="chip-list">
          ${ACHIEVEMENT_RULES.map((item) => `<span class="chip${unlockedAchievementNames.has(item.name) ? " active" : ""}">${item.threshold}本 · ${escapeHtml(item.name)}</span>`).join("")}
        </div>
      </section>
      <div class="inline-actions temple-actions">
        <button id="sheet-world-panel-attrs-btn" class="btn-secondary" type="button">属性全览</button>
        <button id="sheet-world-panel-skills-btn" class="btn-secondary" type="button">技能明细</button>
        <button id="sheet-world-panel-achievements-btn" class="btn-secondary" type="button">成就明细</button>
      </div>
    </section>
  `;
}

function openWorldPanelSheet(options = {}) {
  const { skipHistory = false } = options;
  if (!elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  rememberSheetForBack("world-panel", skipHistory);
  sheetState.type = "world-panel";
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";
  renderWorldPanelSheet();
  if (elements.sheetDialog.hasAttribute("open")) {
    syncWorldSceneState();
    return;
  }
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    syncWorldSceneState();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
  syncWorldSceneState();
  syncSheetBackButtonState();
}

function openWorldShelfSheet() {
  onPanelShelfMore();
}

function renderWorldSettingsSheet(feedbackText = "") {
  if (!elements.sheetTitle || !elements.sheetContent) return;
  const audioProfile = getAudioProfile();
  const usage = getStorageUsage();
  const audioStatus = audioEngine.getStatusText();
  const catalogMeta =
    catalogStore.status === "loading"
      ? "离线书库：加载中..."
      : catalogStore.status === "error"
        ? `离线书库：加载失败（${catalogStore.error || "未知错误"}）`
        : `离线书库：${catalogStore.meta.total} 本（来源 ${catalogStore.meta.source}）`;
  elements.sheetTitle.textContent = "工坊设置";
  elements.sheetContent.innerHTML = `
    <section class="sheet-world-settings">
      <section class="settings-block">
        <h3>音频与体验</h3>
        <p class="tip">${escapeHtml(audioStatus)}</p>
        <div class="button-stack">
          <button id="sheet-world-settings-bgm-toggle-btn" class="btn-secondary" type="button">
            背景音乐：${audioProfile.bgmEnabled ? "开启" : "关闭"}
          </button>
          <button id="sheet-world-settings-sfx-toggle-btn" class="btn-secondary" type="button">
            提示音：${audioProfile.sfxEnabled ? "开启" : "关闭"}
          </button>
        </div>
      </section>
      <section class="settings-block">
        <h3>数据与隐私</h3>
        <p class="tip strong">数据仅保存在本机，不会自动上传到云端。</p>
        <p class="tip">本项目数据：${formatBytes(usage.appBytes)} · 本机总占用：${formatBytes(usage.totalBytes)}</p>
        <p class="tip">最后保存：${formatDateTime(state.lastSavedAt)}</p>
        <p class="tip">${escapeHtml(catalogMeta)}</p>
        <div class="button-stack">
          <button id="sheet-world-settings-privacy-btn" class="btn-secondary" type="button">查看隐私政策</button>
          <button id="sheet-world-settings-export-btn" class="btn-secondary" type="button">导出数据（JSON）</button>
          <button id="sheet-world-settings-import-btn" class="btn-secondary" type="button">导入数据（JSON）</button>
          <button id="sheet-world-settings-reset-btn" class="btn-danger" type="button">重置全部数据</button>
        </div>
      </section>
      <section class="settings-block">
        <h3>版本与支持</h3>
        <p class="tip">版本号：${APP_VERSION}</p>
        <p class="tip">联系支持：<a href="mailto:tillywong15@gmail.com">tillywong15@gmail.com</a></p>
      </section>
      ${feedbackText ? `<p class="feedback">${escapeHtml(feedbackText)}</p>` : ""}
    </section>
  `;
}

function openWorldSettingsSheet(feedbackText = "", options = {}) {
  const { skipHistory = false } = options;
  if (!elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  rememberSheetForBack("world-settings", skipHistory);
  sheetState.type = "world-settings";
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";
  renderWorldSettingsSheet(feedbackText);
  if (elements.sheetDialog.hasAttribute("open")) {
    syncWorldSceneState();
    return;
  }
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    syncWorldSceneState();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
  syncWorldSceneState();
  syncSheetBackButtonState();
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

  if (elements.settingsBgmToggleBtn) {
    elements.settingsBgmToggleBtn.textContent = `背景音乐：${audioProfile.bgmEnabled ? "开启" : "关闭"}`;
    elements.settingsBgmToggleBtn.disabled = false;
  }
  if (elements.settingsSfxToggleBtn) {
    elements.settingsSfxToggleBtn.textContent = `提示音：${audioProfile.sfxEnabled ? "开启" : "关闭"}`;
    elements.settingsSfxToggleBtn.disabled = false;
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

function renderWorld() {
  if (elements.worldLevelChip) {
    elements.worldLevelChip.textContent = `Lv.${state.stats.level}`;
  }
  if (elements.worldBookChip) {
    elements.worldBookChip.textContent = `已完成 ${getCompletedBooks(state).length} 本`;
  }
  updateWorldOverviewHud();
  worldRuntime.scene?.updateWorldOverlay?.();
}

function updateWorldOverviewHud() {
  if (elements.worldDailyChip) {
    const todayReadPages = Math.max(0, Math.round(Number(state.todayReadPages) || 0));
    elements.worldDailyChip.textContent = `今日已阅读 ${todayReadPages} 页`;
    elements.worldDailyChip.classList.remove("ready");
  }
  if (elements.worldFocusChip) {
    const target = getWorldHotspot(worldRuntime.autoTargetZoneId);
    const active = getWorldHotspot(worldRuntime.activeZoneId);
    const label = target
      ? `正在前往：${target.label}`
      : active
        ? `最近地标：${active.label}`
        : "最近地标：自由探索";
    elements.worldFocusChip.textContent = label;
    elements.worldFocusChip.classList.toggle("hot", Boolean(target || active));
  }
}

function setWorldHint(text, hot = false) {
  const value = String(text || "");
  if (elements.worldZoneHint) {
    elements.worldZoneHint.textContent = value;
    elements.worldZoneHint.classList.toggle("world-zone-hot", hot);
  }
  updateWorldOverviewHud();
  worldRuntime.scene?.setWorldHintText?.(value, hot);
}

function setWorldMovement(direction, pressed) {
  if (direction === "left") worldControlState.left = Boolean(pressed);
  if (direction === "right") worldControlState.right = Boolean(pressed);
  if (direction === "up") worldControlState.up = Boolean(pressed);
  if (direction === "down") worldControlState.down = Boolean(pressed);
}

function getWorldHotspot(id) {
  return WORLD_HOTSPOTS.find((item) => item.id === id) || null;
}

function performWorldAction(zoneId) {
  if (!zoneId) return;
  const now = Date.now();
  if (now < worldRuntime.interactCooldownUntil) return;
  worldRuntime.interactCooldownUntil = now + 420;
  const hotspot = getWorldHotspot(zoneId);
  const label = hotspot?.label || "交互点";
  worldRuntime.scene?.triggerHotspotFx?.(zoneId);
  audioEngine.playSfx("tap");
  triggerHaptic("medium");
  const toastAnchor = activeTab === "world" ? elements.worldCanvas : elements.worldZoneHint;
  spawnGameToast(`进入${label}`, "info", toastAnchor);
  if (zoneId === "entry") {
    openWorldEntrySheet();
    return;
  }
  if (zoneId === "panel") {
    openWorldPanelSheet();
    return;
  }
  if (zoneId === "shelf") {
    openWorldShelfSheet();
    return;
  }
  if (zoneId === "settings") {
    openWorldSettingsSheet();
    return;
  }
  if (zoneId === "share") {
    openShareSheet();
  }
  updateWorldOverviewHud();
}

function syncWorldSceneState() {
  if (!worldRuntime.scene) return;
  const scene = worldRuntime.scene;
  if (!scene.scene || !scene.physics?.world) return;
  const sheetOpen = Boolean(elements.sheetDialog?.hasAttribute("open"));
  if (!sheetOpen && (sheetState.type !== "none" || sheetHistoryStack.length > 0)) {
    clearSheetHistory();
    resetSheetDialogState();
  }
  const isInteractiveWorld = activeTab === "world" && !sheetOpen && sheetState.type === "none";
  const keyboard = scene.input?.keyboard;
  if (keyboard) {
    keyboard.enabled = isInteractiveWorld;
    if (isInteractiveWorld) {
      keyboard.enableGlobalCapture?.();
    } else {
      keyboard.disableGlobalCapture?.();
      keyboard.resetKeys?.();
    }
  }
  if (isInteractiveWorld) {
    scene.scene.resume();
    scene.physics.world.resume();
    return;
  }
  scene.physics.world.pause();
  scene.scene.pause();
}

function initWorldEngine() {
  if (!(elements.worldCanvas instanceof HTMLElement)) return;
  const PhaserApi = typeof window !== "undefined" ? window.Phaser : null;
  if (!PhaserApi?.Game) {
    setWorldHint("世界场景加载失败，请重新安装依赖后重启。");
    return;
  }
  if (worldRuntime.game) return;

  const scene = new PhaserApi.Scene("reader-room");
  scene.player = null;
  scene.keys = null;
  scene.hotspots = [];
  scene.activeHotspotId = "";
  scene.groundLayer = null;
  scene.staticObstacles = [];
  scene.rows = Math.floor(WORLD_MAP_HEIGHT / WORLD_TILE_SIZE);
  scene.cols = Math.floor(WORLD_MAP_WIDTH / WORLD_TILE_SIZE);
  scene.playerMoveState = { moving: false };

  scene.createCanvasTexture = function createCanvasTexture(key, width, height, painter) {
    if (this.textures.exists(key)) return;
    const texture = this.textures.createCanvas(key, width, height);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    painter(ctx, width, height);
    texture.refresh();
  };

  scene.createTileAtlasTexture = function createTileAtlasTexture() {
    if (this.textures.exists("rj-world-tiles")) return;
    const size = WORLD_TILE_SIZE;
    this.createCanvasTexture("rj-world-tiles", size * 24, size, (ctx) => {
      const drawTile = (index, draw) => {
        ctx.save();
        ctx.translate(index * size, 0);
        draw(ctx, size);
        ctx.restore();
      };

      drawTile(0, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#8fda70";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#7dcc60";
        for (let y = 0; y < tileSize; y += 3) {
          for (let x = (y % 2) * 2; x < tileSize; x += 5) {
            tileCtx.fillRect(x, y, 2, 1);
          }
        }
        tileCtx.fillStyle = "#9ce17e";
        for (let i = 0; i < tileSize; i += 6) {
          tileCtx.fillRect((i * 3) % tileSize, 6 + (i % 8), 2, 2);
        }
      });

      drawTile(1, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#85d768";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#6ac154";
        for (let y = 1; y < tileSize; y += 5) {
          tileCtx.fillRect(0, y, tileSize, 1);
        }
        tileCtx.fillStyle = "#9fe38a";
        for (let i = 0; i < tileSize; i += 7) {
          tileCtx.fillRect((i * 2) % tileSize, 4 + (i % 9), 2, 2);
        }
      });

      drawTile(2, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#9adf79";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#7dcc5f";
        for (let x = 0; x < tileSize; x += 4) {
          tileCtx.fillRect(x, 0, 1, tileSize);
        }
        tileCtx.fillStyle = "#f4c7d3";
        for (let i = 0; i < 5; i += 1) {
          tileCtx.fillRect(5 + i * 5, 8 + (i % 2) * 8, 2, 2);
          tileCtx.fillRect(8 + i * 4, 19 + ((i + 1) % 2) * 4, 1, 1);
        }
        tileCtx.fillStyle = "#f9efbb";
        tileCtx.fillRect(14, 11, 2, 2);
        tileCtx.fillRect(22, 22, 2, 2);
      });

      drawTile(3, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#d7b17d";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#be9464";
        for (let y = 3; y < tileSize; y += 6) {
          tileCtx.fillRect(0, y, tileSize, 1);
        }
        tileCtx.fillStyle = "#e8c893";
        for (let i = 0; i < tileSize; i += 6) {
          tileCtx.fillRect((i * 3) % tileSize, 2 + (i % 10), 2, 2);
        }
      });

      drawTile(4, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#c39d6b";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#ab8255";
        for (let x = 1; x < tileSize; x += 5) {
          tileCtx.fillRect(x, 0, 2, tileSize);
        }
        tileCtx.fillStyle = "#d6b583";
        tileCtx.fillRect(0, 0, tileSize, 3);
        tileCtx.fillRect(0, tileSize - 2, tileSize, 2);
      });

      drawTile(5, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#5ab8ec";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#8fd6f6";
        for (let y = 2; y < tileSize; y += 6) {
          tileCtx.fillRect(0, y, tileSize, 1);
        }
        tileCtx.fillStyle = "#419dd0";
        for (let x = 0; x < tileSize; x += 5) {
          tileCtx.fillRect(x, 24, 3, 2);
        }
      });

      drawTile(6, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#67c2f1";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#9adff9";
        for (let y = 1; y < tileSize; y += 7) {
          tileCtx.fillRect(0, y, tileSize, 1);
        }
        tileCtx.fillStyle = "#4caedc";
        tileCtx.fillRect(0, tileSize - 5, tileSize, 5);
      });

      drawTile(7, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#d0bc95";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#8ccf63";
        tileCtx.fillRect(0, 0, tileSize, 7);
        tileCtx.fillStyle = "#6ebc4d";
        for (let x = 0; x < tileSize; x += 4) {
          tileCtx.fillRect(x, 3, 2, 2);
        }
        tileCtx.fillStyle = "#c7a97a";
        tileCtx.fillRect(0, 7, tileSize, tileSize - 7);
        tileCtx.fillStyle = "#b29162";
        tileCtx.fillRect(0, tileSize - 4, tileSize, 4);
      });

      drawTile(8, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#9f6f3f";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#8b5c31";
        for (let x = 0; x < tileSize; x += 4) {
          tileCtx.fillRect(x, 0, 2, tileSize);
        }
        tileCtx.fillStyle = "#c88f57";
        tileCtx.fillRect(0, 0, tileSize, 2);
        tileCtx.fillRect(0, tileSize - 2, tileSize, 2);
      });

      drawTile(9, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#d4c3a0";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#beac87";
        for (let y = 2; y < tileSize; y += 8) {
          tileCtx.fillRect(0, y, tileSize, 1);
        }
        for (let x = 2; x < tileSize; x += 8) {
          tileCtx.fillRect(x, 0, 1, tileSize);
        }
        tileCtx.fillStyle = "#e8dcc2";
        tileCtx.fillRect(1, 1, tileSize - 2, 1);
      });

      drawTile(10, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#8fdd76";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        const petals = ["#ff8ea8", "#ffc978", "#a4d7ff", "#ccafff"];
        for (let i = 0; i < 8; i += 1) {
          tileCtx.fillStyle = petals[i % petals.length];
          tileCtx.fillRect(3 + ((i * 5) % (tileSize - 6)), 4 + ((i * 7) % (tileSize - 6)), 2, 2);
        }
      });

      drawTile(11, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#86d364";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#5cad49";
        tileCtx.fillRect(4, 8, tileSize - 8, tileSize - 10);
        tileCtx.fillStyle = "#79d06a";
        tileCtx.fillRect(7, 11, tileSize - 14, 6);
      });

      drawTile(12, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#b48b52";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#9f753f";
        for (let y = 1; y < tileSize; y += 5) {
          tileCtx.fillRect(0, y, tileSize, 1);
        }
        tileCtx.fillStyle = "#cca368";
        for (let x = 2; x < tileSize; x += 6) {
          tileCtx.fillRect(x, 0, 1, tileSize);
        }
      });

      drawTile(13, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#a4b0bf";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#8d99a9";
        for (let i = 0; i < tileSize; i += 8) {
          tileCtx.fillRect(i, 0, 1, tileSize);
          tileCtx.fillRect(0, i, tileSize, 1);
        }
        tileCtx.fillStyle = "#c5cfdb";
        tileCtx.fillRect(0, 0, tileSize, 2);
      });

      drawTile(14, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#59aa57";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#82cb72";
        tileCtx.fillRect(0, tileSize - 8, tileSize, 8);
        tileCtx.fillStyle = "#91d883";
        tileCtx.fillRect(3, 4, tileSize - 6, 6);
      });

      drawTile(15, (tileCtx, tileSize) => {
        tileCtx.clearRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#fff6e1";
        for (let i = 0; i < 10; i += 1) {
          const x = 2 + ((i * 7) % (tileSize - 4));
          const y = 2 + ((i * 11) % (tileSize - 4));
          tileCtx.fillRect(x, y, 1, 1);
        }
      });

      drawTile(16, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#7fd160";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#60b748";
        tileCtx.fillRect(3, 7, tileSize - 6, tileSize - 9);
        tileCtx.fillStyle = "#8bde7a";
        tileCtx.fillRect(7, 11, tileSize - 14, 5);
      });

      drawTile(17, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#d6b781";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#bc9a69";
        tileCtx.fillRect(0, tileSize - 8, tileSize, 8);
        tileCtx.fillStyle = "#ead3a2";
        for (let x = 0; x < tileSize; x += 5) {
          tileCtx.fillRect(x, 4, 2, 1);
        }
      });

      drawTile(18, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#835934";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#9f6c43";
        for (let y = 0; y < tileSize; y += 5) {
          tileCtx.fillRect(0, y, tileSize, 2);
        }
        tileCtx.fillStyle = "#6f4728";
        for (let x = 2; x < tileSize; x += 8) {
          tileCtx.fillRect(x, 0, 1, tileSize);
        }
      });

      drawTile(19, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#94df7d";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#7fd068";
        for (let y = 0; y < tileSize; y += 4) {
          tileCtx.fillRect(0, y, tileSize, 1);
        }
        tileCtx.fillStyle = "#e2ddd1";
        for (let i = 0; i < 7; i += 1) {
          tileCtx.fillRect(4 + (i * 4) % (tileSize - 8), 4 + (i * 7) % (tileSize - 8), 2, 2);
        }
      });

      drawTile(20, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#68844f";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#86a665";
        tileCtx.fillRect(0, 0, tileSize, 6);
        tileCtx.fillStyle = "#4f6a3d";
        tileCtx.fillRect(0, tileSize - 6, tileSize, 6);
      });

      drawTile(21, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#deb684";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#c59a67";
        tileCtx.fillRect(0, 0, tileSize, 2);
        for (let y = 4; y < tileSize; y += 6) {
          tileCtx.fillRect(0, y, tileSize, 1);
        }
      });

      drawTile(22, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#76bfeb";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#9ad8f5";
        for (let y = 0; y < tileSize; y += 5) {
          tileCtx.fillRect(0, y, tileSize, 1);
        }
        tileCtx.fillStyle = "#5fa7d4";
        tileCtx.fillRect(0, tileSize - 6, tileSize, 6);
      });

      drawTile(23, (tileCtx, tileSize) => {
        tileCtx.fillStyle = "#6db86b";
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = "#4f994f";
        for (let x = 1; x < tileSize; x += 6) {
          tileCtx.fillRect(x, 0, 2, tileSize);
        }
        tileCtx.fillStyle = "#8ad27d";
        tileCtx.fillRect(0, 0, tileSize, 4);
      });
    });
  };

  scene.createCharacterTextures = function createCharacterTextures() {
    const drawHero = (key, step = 0) => {
      this.createCanvasTexture(key, 30, 38, (ctx, width, height) => {
        ctx.clearRect(0, 0, width, height);
        const sway = step === 0 ? 0 : step > 0 ? 1 : -1;
        ctx.fillStyle = "#1f1a34";
        ctx.fillRect(9, 15, 12, 18);
        ctx.fillStyle = "#6c52ff";
        ctx.fillRect(10, 16, 10, 15);
        ctx.fillStyle = "#8a71ff";
        ctx.fillRect(11, 17, 8, 4);
        ctx.fillStyle = "#f6d4b4";
        ctx.fillRect(11, 8, 8, 8);
        ctx.fillStyle = "#e7bf7d";
        ctx.fillRect(11, 5, 8, 3);
        ctx.fillStyle = "#d9a354";
        ctx.fillRect(10, 4, 10, 1);
        ctx.fillStyle = "#4f39b8";
        ctx.fillRect(7 + sway, 18, 3, 10);
        ctx.fillRect(20 + sway, 18, 3, 10);
        ctx.fillStyle = "#2c2170";
        ctx.fillRect(11, 31 + (step > 0 ? 1 : 0), 3, 5);
        ctx.fillRect(16, 31 + (step < 0 ? 1 : 0), 3, 5);
        ctx.fillStyle = "#201a3b";
        ctx.fillRect(13, 11, 1, 1);
        ctx.fillRect(16, 11, 1, 1);
        ctx.fillStyle = "#ffe8c6";
        ctx.fillRect(13, 13, 4, 1);
      });
    };

    drawHero("rj-hero-idle", 0);
    drawHero("rj-hero-step-a", 1);
    drawHero("rj-hero-step-b", -1);
  };

  scene.createBuildingTextures = function createBuildingTextures() {
    const drawBuilding = (key, config) => {
      this.createCanvasTexture(key, 124, 152, (ctx, width, height) => {
        ctx.clearRect(0, 0, width, height);
        const left = 18;
        const top = 44;
        const bodyW = width - 36;
        const bodyH = height - 34;

        ctx.fillStyle = "#5a4124";
        ctx.fillRect(left - 2, top - 2, bodyW + 4, bodyH + 4);
        ctx.fillStyle = config.wall || "#e8d7b4";
        ctx.fillRect(left, top, bodyW, bodyH);
        ctx.fillStyle = "#f7efd8";
        ctx.fillRect(left + 3, top + 3, bodyW - 6, 4);

        ctx.fillStyle = config.roofShadow || "#8a532f";
        ctx.fillRect(8, 24, width - 16, 12);
        ctx.fillStyle = config.roof || "#cb8755";
        ctx.fillRect(4, 16, width - 8, 18);
        ctx.fillStyle = config.roofHighlight || "#e09f6a";
        for (let x = 10; x < width - 10; x += 11) {
          ctx.fillRect(x, 18, 7, 2);
        }
        ctx.fillStyle = "#5e3b24";
        ctx.fillRect(3, 34, width - 6, 3);

        ctx.fillStyle = "#61472a";
        ctx.fillRect(width / 2 - 13, height - 43, 26, 39);
        ctx.fillStyle = "#f6ebd2";
        ctx.fillRect(width / 2 - 9, height - 38, 18, 27);
        ctx.fillStyle = "#6b4f2f";
        ctx.fillRect(width / 2 - 1, height - 38, 2, 27);
        ctx.fillStyle = "#ad7a47";
        ctx.fillRect(width / 2 - 9, height - 41, 18, 3);

        const winX = [left + 12, width - left - 28];
        const winY = [top + 14, top + 40];
        ctx.fillStyle = config.window || "#94cfff";
        for (const x of winX) {
          for (const y of winY) {
            ctx.fillRect(x, y, 16, 14);
            ctx.fillStyle = "#d6f0ff";
            ctx.fillRect(x + 2, y + 2, 12, 4);
            ctx.fillStyle = config.window || "#94cfff";
          }
        }

        ctx.fillStyle = config.signBg || "#6d56b1";
        ctx.fillRect(width / 2 - 26, top + 6, 52, 12);
        ctx.fillStyle = config.signInner || "#ede4c9";
        ctx.fillRect(width / 2 - 22, top + 9, 44, 6);
        ctx.fillStyle = config.awning || "#e5cb8f";
        ctx.fillRect(left + 4, top + 62, bodyW - 8, 4);

        if (config.marker === "entry") {
          ctx.fillStyle = "#f3f2de";
          ctx.fillRect(width / 2 - 18, 28, 36, 10);
          ctx.fillStyle = "#7f5930";
          ctx.fillRect(width / 2 - 15, 30, 30, 6);
          ctx.fillStyle = "#6ea5ff";
          ctx.fillRect(width / 2 - 5, 26, 10, 4);
          ctx.fillStyle = "#f6d585";
          ctx.fillRect(width / 2 - 6, 33, 12, 2);
        } else if (config.marker === "panel") {
          ctx.fillStyle = "#73baf8";
          ctx.fillRect(width / 2 - 6, 3, 12, 16);
          ctx.fillStyle = "#cee9ff";
          ctx.fillRect(width / 2 - 2, 7, 4, 8);
          ctx.fillStyle = "#ffd987";
          ctx.fillRect(width / 2 - 2, 2, 4, 2);
          ctx.fillStyle = "#735135";
          ctx.fillRect(width / 2 - 23, 42, 6, 20);
          ctx.fillRect(width / 2 + 17, 42, 6, 20);
        } else if (config.marker === "shelf") {
          ctx.fillStyle = "#684226";
          ctx.fillRect(width / 2 - 24, 28, 48, 12);
          const books = ["#dd9e54", "#7bb8ff", "#cf9dfa", "#8dd37b", "#f18f8f"];
          books.forEach((color, idx) => {
            ctx.fillStyle = color;
            ctx.fillRect(width / 2 - 21 + idx * 9, 29, 6, 10);
          });
          ctx.fillStyle = "#7c5631";
          ctx.fillRect(width - 24, 46, 12, 32);
          ctx.fillStyle = "#d49658";
          ctx.fillRect(width - 22, 48, 8, 5);
          ctx.fillStyle = "#8fc4ff";
          ctx.fillRect(width - 22, 56, 8, 5);
          ctx.fillStyle = "#dca8ff";
          ctx.fillRect(width - 22, 64, 8, 5);
        } else if (config.marker === "share") {
          ctx.fillStyle = "#538f66";
          ctx.fillRect(width / 2 - 2, 0, 4, 14);
          ctx.fillStyle = "#fff1cb";
          ctx.fillRect(width / 2 + 3, 2, 13, 9);
          ctx.fillStyle = "#f49b93";
          ctx.fillRect(width / 2 + 5, 4, 9, 2);
          ctx.fillStyle = "#cb6f62";
          ctx.fillRect(width - 19, height - 36, 10, 12);
          ctx.fillStyle = "#ffe3bc";
          ctx.fillRect(width - 17, height - 34, 6, 4);
        } else if (config.marker === "settings") {
          ctx.fillStyle = "#6f4528";
          ctx.fillRect(width / 2 - 12, 28, 24, 11);
          ctx.fillStyle = "#feb877";
          ctx.fillRect(width / 2 - 8, 23, 16, 6);
          ctx.fillStyle = "#ff9162";
          ctx.fillRect(width / 2 - 3, 23, 6, 6);
          ctx.fillStyle = "#6c6c6c";
          ctx.fillRect(width - 22, 16, 7, 18);
          ctx.fillStyle = "#d8d8d8";
          ctx.fillRect(width - 21, 14, 5, 3);
        }

        ctx.fillStyle = "#6b5435";
        ctx.fillRect(left + 2, height - 11, bodyW - 4, 6);
      });
    };

    drawBuilding("rj-building-entry", {
      wall: "#efe0b9",
      roof: "#cc8251",
      roofShadow: "#9f5b34",
      roofHighlight: "#e3a26c",
      window: "#90cbf8",
      signBg: "#87532d",
      signInner: "#f5edd7",
      awning: "#f0cb83",
      marker: "entry"
    });
    drawBuilding("rj-building-panel", {
      wall: "#e8d7b5",
      roof: "#8a7ac7",
      roofShadow: "#6756a8",
      roofHighlight: "#9d8fdb",
      window: "#ade1ff",
      signBg: "#6b58ad",
      signInner: "#efe8cf",
      awning: "#dfc686",
      marker: "panel"
    });
    drawBuilding("rj-building-shelf", {
      wall: "#ead8b9",
      roof: "#9d7754",
      roofShadow: "#755539",
      roofHighlight: "#b38961",
      window: "#a8d9ff",
      signBg: "#795737",
      signInner: "#f2e7cf",
      awning: "#e9cd94",
      marker: "shelf"
    });
    drawBuilding("rj-building-share", {
      wall: "#efddbf",
      roof: "#d37f67",
      roofShadow: "#ad5746",
      roofHighlight: "#e59f8a",
      window: "#9fd9ff",
      signBg: "#a85f53",
      signInner: "#f8ead4",
      awning: "#e8c68e",
      marker: "share"
    });
    drawBuilding("rj-building-settings", {
      wall: "#ecdcc4",
      roof: "#918f74",
      roofShadow: "#6f6c53",
      roofHighlight: "#a9a68b",
      window: "#97c5e6",
      signBg: "#7d7a62",
      signInner: "#f2ead5",
      awning: "#e6c182",
      marker: "settings"
    });
  };

  scene.createPropTextures = function createPropTextures() {
    this.createCanvasTexture("rj-tree-a", 48, 68, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#6a4524";
      ctx.fillRect(width / 2 - 4, height - 20, 8, 20);
      ctx.fillStyle = "#2f8d4a";
      ctx.fillRect(6, 18, width - 12, 18);
      ctx.fillRect(12, 6, width - 24, 14);
      ctx.fillRect(4, 30, width - 8, 18);
      ctx.fillStyle = "#63c675";
      ctx.fillRect(11, 13, width - 22, 8);
      ctx.fillRect(9, 35, width - 18, 6);
    });

    this.createCanvasTexture("rj-tree-b", 48, 68, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#71492a";
      ctx.fillRect(width / 2 - 4, height - 19, 8, 19);
      ctx.fillStyle = "#338f58";
      ctx.fillRect(7, 20, width - 14, 17);
      ctx.fillRect(10, 10, width - 20, 13);
      ctx.fillRect(4, 32, width - 8, 16);
      ctx.fillStyle = "#70d48a";
      ctx.fillRect(12, 14, width - 24, 7);
      ctx.fillRect(10, 36, width - 20, 5);
    });

    this.createCanvasTexture("rj-tree-c", 42, 58, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#6d4725";
      ctx.fillRect(width / 2 - 3, height - 18, 6, 18);
      ctx.fillStyle = "#3d9f56";
      ctx.fillRect(6, 20, width - 12, 12);
      ctx.fillRect(11, 12, width - 22, 12);
      ctx.fillRect(4, 28, width - 8, 13);
      ctx.fillStyle = "#83dd96";
      ctx.fillRect(12, 14, width - 24, 5);
    });

    this.createCanvasTexture("rj-bush", 28, 20, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#4ea552";
      ctx.fillRect(1, 7, width - 2, height - 7);
      ctx.fillStyle = "#71ca70";
      ctx.fillRect(4, 4, width - 8, 5);
      ctx.fillStyle = "#2e7d3f";
      ctx.fillRect(2, height - 4, width - 4, 2);
    });

    this.createCanvasTexture("rj-fence", 44, 24, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#8f643c";
      ctx.fillRect(0, 6, width, 3);
      ctx.fillRect(0, 15, width, 3);
      for (let x = 4; x < width; x += 10) {
        ctx.fillStyle = "#77512e";
        ctx.fillRect(x, 0, 4, height - 2);
        ctx.fillStyle = "#a17447";
        ctx.fillRect(x + 1, 1, 2, height - 6);
      }
    });

    this.createCanvasTexture("rj-crate", 22, 22, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#8a5c35";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#a57042";
      ctx.fillRect(2, 2, width - 4, height - 4);
      ctx.fillStyle = "#714a2a";
      ctx.fillRect(0, 10, width, 2);
      ctx.fillRect(10, 0, 2, height);
    });

    this.createCanvasTexture("rj-lantern", 20, 36, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#5d4a36";
      ctx.fillRect(9, 3, 2, height - 3);
      ctx.fillStyle = "#f5cc73";
      ctx.fillRect(6, 9, 8, 8);
      ctx.fillStyle = "#db9c45";
      ctx.fillRect(7, 10, 6, 6);
      ctx.fillStyle = "#8f6e48";
      ctx.fillRect(5, 17, 10, 2);
    });

    this.createCanvasTexture("rj-dust", 8, 8, (ctx) => {
      ctx.clearRect(0, 0, 8, 8);
      ctx.fillStyle = "#fff1cf";
      ctx.fillRect(2, 2, 4, 4);
    });

    this.createCanvasTexture("rj-target", 28, 28, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#ffd98e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#fff7e5";
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffd98e";
      ctx.fillRect(width / 2 - 1, 3, 2, 4);
      ctx.fillRect(width / 2 - 1, height - 7, 2, 4);
      ctx.fillRect(3, height / 2 - 1, 4, 2);
      ctx.fillRect(width - 7, height / 2 - 1, 4, 2);
    });

    this.createCanvasTexture("rj-rune", 34, 34, (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#f5d38e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#9fc8ff";
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(width / 2, 6);
      ctx.lineTo(width / 2, height - 6);
      ctx.moveTo(6, height / 2);
      ctx.lineTo(width - 6, height / 2);
      ctx.stroke();
    });
  };

  scene.createNpcTextures = function createNpcTextures() {
    const drawNpc = (key, palette, step = 0) => {
      this.createCanvasTexture(key, 28, 36, (ctx, width, height) => {
        ctx.clearRect(0, 0, width, height);
        const sway = step > 0 ? 1 : step < 0 ? -1 : 0;
        ctx.fillStyle = palette.outline;
        ctx.fillRect(8, 13, 12, 18);
        ctx.fillStyle = palette.body;
        ctx.fillRect(9, 14, 10, 15);
        ctx.fillStyle = palette.bodyHi;
        ctx.fillRect(10, 15, 8, 4);
        ctx.fillStyle = palette.skin;
        ctx.fillRect(10, 6, 8, 8);
        ctx.fillStyle = palette.hair;
        ctx.fillRect(9, 4, 10, 3);
        ctx.fillStyle = palette.sleeve;
        ctx.fillRect(6 + sway, 16, 3, 10);
        ctx.fillRect(19 + sway, 16, 3, 10);
        ctx.fillStyle = palette.boot;
        ctx.fillRect(10, 29 + (step > 0 ? 1 : 0), 3, 5);
        ctx.fillRect(15, 29 + (step < 0 ? 1 : 0), 3, 5);
        ctx.fillStyle = "#271a19";
        ctx.fillRect(12, 10, 1, 1);
        ctx.fillRect(15, 10, 1, 1);
      });
    };

    drawNpc(
      "rj-npc-a-idle",
      {
        outline: "#2c223f",
        body: "#ff7e87",
        bodyHi: "#ff9ea4",
        skin: "#f4d3b3",
        hair: "#8c5d2a",
        sleeve: "#d15d66",
        boot: "#4b355e"
      },
      0
    );
    drawNpc(
      "rj-npc-a-step",
      {
        outline: "#2c223f",
        body: "#ff7e87",
        bodyHi: "#ff9ea4",
        skin: "#f4d3b3",
        hair: "#8c5d2a",
        sleeve: "#d15d66",
        boot: "#4b355e"
      },
      1
    );
    drawNpc(
      "rj-npc-b-idle",
      {
        outline: "#213346",
        body: "#4f97ff",
        bodyHi: "#73b1ff",
        skin: "#f3cfaa",
        hair: "#5d3b1e",
        sleeve: "#3c7ad7",
        boot: "#223e66"
      },
      0
    );
    drawNpc(
      "rj-npc-b-step",
      {
        outline: "#213346",
        body: "#4f97ff",
        bodyHi: "#73b1ff",
        skin: "#f3cfaa",
        hair: "#5d3b1e",
        sleeve: "#3c7ad7",
        boot: "#223e66"
      },
      -1
    );
  };

  scene.createRoomTextures = function createRoomTextures() {
    this.createTileAtlasTexture();
    this.createCharacterTextures();
    this.createBuildingTextures();
    this.createPropTextures();
    this.createNpcTextures();
  };

  scene.makeLayerData = function makeLayerData(fillValue = -1) {
    return Array.from({ length: this.rows }, () => Array(this.cols).fill(fillValue));
  };

  scene.worldToTile = function worldToTile(x, y) {
    return {
      tx: PhaserApi.Math.Clamp(Math.floor(x / WORLD_TILE_SIZE), 0, this.cols - 1),
      ty: PhaserApi.Math.Clamp(Math.floor(y / WORLD_TILE_SIZE), 0, this.rows - 1)
    };
  };

  scene.paintCircleToData = function paintCircleToData(layer, tx, ty, radius, value, options = {}) {
    const preserveWater = Boolean(options.preserveWater);
    for (let y = ty - radius; y <= ty + radius; y += 1) {
      if (y < 0 || y >= this.rows) continue;
      for (let x = tx - radius; x <= tx + radius; x += 1) {
        if (x < 0 || x >= this.cols) continue;
        if ((x - tx) ** 2 + (y - ty) ** 2 > radius ** 2 + 0.4) continue;
        if (preserveWater && this.waterData?.[y]?.[x] >= 0) {
          layer[y][x] = 8;
        } else {
          layer[y][x] = value;
        }
      }
    }
  };

  scene.paintRectToData = function paintRectToData(layer, tx, ty, width, height, value) {
    for (let y = ty; y < ty + height; y += 1) {
      if (y < 0 || y >= this.rows) continue;
      for (let x = tx; x < tx + width; x += 1) {
        if (x < 0 || x >= this.cols) continue;
        layer[y][x] = value;
      }
    }
  };

  scene.paintPathLine = function paintPathLine(layer, fromWorld, toWorld, width = 2, value = 3) {
    const from = this.worldToTile(fromWorld.x, fromWorld.y);
    const to = this.worldToTile(toWorld.x, toWorld.y);
    let x0 = from.tx;
    let y0 = from.ty;
    const x1 = to.tx;
    const y1 = to.ty;
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;

    while (true) {
      this.paintCircleToData(layer, x0, y0, width, value, { preserveWater: true });
      if (x0 === x1 && y0 === y1) break;
      const e2 = err * 2;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  scene.generateTerrainData = function generateTerrainData() {
    this.groundData = this.makeLayerData(0);
    this.pathData = this.makeLayerData(-1);
    this.waterData = this.makeLayerData(-1);
    this.decoData = this.makeLayerData(-1);

    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const noise =
          Math.sin(x * 0.24 + y * 0.09) +
          Math.sin(y * 0.19) * 0.8 +
          Math.sin((x - y) * 0.1) * 0.6;
        this.groundData[y][x] = noise > 1.3 ? 2 : noise > 0.35 ? 1 : noise < -1.1 ? 19 : 0;
      }
    }

    for (let y = 0; y < this.rows; y += 1) {
      const riverCenter =
        Math.floor(this.cols * 0.63 + Math.sin(y * 0.07) * 8 + Math.sin(y * 0.02) * 5);
      const riverRadius = y < this.rows * 0.22 ? 3 : y < this.rows * 0.7 ? 5 : 7;
      for (let x = riverCenter - riverRadius; x <= riverCenter + riverRadius; x += 1) {
        if (x < 0 || x >= this.cols) continue;
        const edge = Math.abs(x - riverCenter) >= riverRadius - 1;
        this.waterData[y][x] = edge ? 7 : y % 2 === 0 ? 5 : 22;
      }
    }

    const panelCenter = this.worldToTile(WORLD_HOTSPOTS[1].x, WORLD_HOTSPOTS[1].y + 128);
    this.paintRectToData(this.pathData, panelCenter.tx - 8, panelCenter.ty - 6, 17, 12, 9);
    this.paintRectToData(this.pathData, panelCenter.tx - 3, panelCenter.ty + 6, 7, 8, 13);

    const routePoints = [
      WORLD_PLAYER_START,
      WORLD_HOTSPOTS[0],
      WORLD_HOTSPOTS[1],
      WORLD_HOTSPOTS[2],
      WORLD_HOTSPOTS[3],
      WORLD_HOTSPOTS[4],
      WORLD_HOTSPOTS[1],
      WORLD_PLAYER_START
    ];
    for (let i = 0; i < routePoints.length - 1; i += 1) {
      const mainRoad = i <= 2 || i === routePoints.length - 2;
      this.paintPathLine(
        this.pathData,
        routePoints[i],
        routePoints[i + 1],
        mainRoad ? 3 : 2,
        mainRoad ? 4 : 3
      );
    }

    for (const spot of WORLD_HOTSPOTS) {
      const tile = this.worldToTile(spot.x, spot.y + 104);
      this.paintCircleToData(this.pathData, tile.tx, tile.ty, 3, 9);
      this.paintCircleToData(this.pathData, tile.tx, tile.ty + 3, 2, 4, { preserveWater: true });
    }

    const farmStart = this.worldToTile(WORLD_PLAYER_START.x - 380, WORLD_PLAYER_START.y + 620);
    this.paintRectToData(this.groundData, farmStart.tx, farmStart.ty, 13, 11, 12);
    this.paintRectToData(this.groundData, farmStart.tx + 15, farmStart.ty + 1, 10, 9, 12);

    for (let y = 2; y < this.rows - 2; y += 1) {
      for (let x = 2; x < this.cols - 2; x += 1) {
        if (this.pathData[y][x] >= 0 || this.waterData[y][x] >= 0) continue;
        const noise = Math.sin(x * 0.38 + y * 0.15) + Math.sin((x + y) * 0.11);
        if (noise > 1.2) {
          this.decoData[y][x] = 10;
        } else if (noise < -1.35) {
          this.decoData[y][x] = 11;
        } else if (noise > 0.8 && y % 6 === 0) {
          this.decoData[y][x] = 15;
        } else if (noise > 0.45 && (x + y) % 11 === 0) {
          this.decoData[y][x] = 16;
        } else if (noise < -0.45 && (x * y) % 29 === 0) {
          this.decoData[y][x] = 17;
        }
      }
    }
  };

  scene.createTileLayer = function createTileLayer(data, depth, alpha = 1) {
    const map = this.make.tilemap({
      data,
      tileWidth: WORLD_TILE_SIZE,
      tileHeight: WORLD_TILE_SIZE
    });
    const tileset = map.addTilesetImage(
      "rj-world-tiles",
      "rj-world-tiles",
      WORLD_TILE_SIZE,
      WORLD_TILE_SIZE,
      0,
      0
    );
    const layer = map.createLayer(0, tileset, 0, 0);
    layer.setDepth(depth);
    layer.setAlpha(alpha);
    return layer;
  };

  scene.createAmbientLayers = function createAmbientLayers() {
    const mapW = WORLD_MAP_WIDTH;
    const mapH = WORLD_MAP_HEIGHT;
    this.add.rectangle(mapW / 2, mapH / 2, mapW, mapH, 0x87d469, 1).setDepth(-32);
    this.add.rectangle(mapW / 2, mapH * 0.18, mapW, mapH * 0.36, 0xf1f9ff, 0.28).setDepth(-30);
    this.add.rectangle(mapW / 2, mapH * 0.86, mapW, mapH * 0.5, 0x77c95f, 0.24).setDepth(-28);

    for (let i = 0; i < 24; i += 1) {
      const cloud = this.add.ellipse(
        140 + Math.random() * (mapW - 280),
        110 + Math.random() * (mapH * 0.18),
        70 + Math.random() * 56,
        12 + Math.random() * 10,
        0xffffff,
        0.2
      );
      cloud.setDepth(-24);
      this.tweens.add({
        targets: cloud,
        x: cloud.x + 24 + Math.random() * 80,
        duration: 13000 + Math.random() * 6500,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut"
      });
    }
  };

  scene.scatterTrees = function scatterTrees() {
    const tries = 620;
    for (let i = 0; i < tries; i += 1) {
      const x = 44 + Math.random() * (WORLD_MAP_WIDTH - 88);
      const y = 120 + Math.random() * (WORLD_MAP_HEIGHT - 210);
      const tooCloseToHotspot = WORLD_HOTSPOTS.some((spot) => Math.hypot(spot.x - x, spot.y - y) < 210);
      if (tooCloseToHotspot) continue;
      const tile = this.worldToTile(x, y);
      if (this.pathData[tile.ty][tile.tx] >= 0) continue;
      if (this.waterData[tile.ty][tile.tx] >= 0) continue;
      const chance = Math.random();
      if (chance > 0.86) {
        const lantern = this.add.image(x, y, "rj-lantern").setOrigin(0.5, 1);
        lantern.setDepth(190 + y);
        continue;
      }
      if (chance > 0.7) {
        const bush = this.add.image(x, y, "rj-bush").setOrigin(0.5, 1);
        bush.setDepth(185 + y);
        continue;
      }
      const key = chance > 0.44 ? "rj-tree-a" : chance > 0.24 ? "rj-tree-b" : "rj-tree-c";
      const sprite = this.add.image(x, y, key).setOrigin(0.5, 1);
      sprite.setScale(1.22 + Math.random() * 0.32);
      sprite.setDepth(180 + y);
      sprite.setTint(Math.random() > 0.55 ? 0xf2ffe6 : 0xffffff);
    }
  };

  scene.createTownDecor = function createTownDecor() {
    const decorSpots = [
      { x: WORLD_HOTSPOTS[0].x - 150, y: WORLD_HOTSPOTS[0].y + 260, kind: "fence" },
      { x: WORLD_HOTSPOTS[2].x + 154, y: WORLD_HOTSPOTS[2].y + 254, kind: "fence" },
      { x: WORLD_HOTSPOTS[4].x - 178, y: WORLD_HOTSPOTS[4].y - 10, kind: "crate" },
      { x: WORLD_HOTSPOTS[3].x + 162, y: WORLD_HOTSPOTS[3].y + 30, kind: "crate" },
      { x: WORLD_HOTSPOTS[1].x - 262, y: WORLD_HOTSPOTS[1].y + 30, kind: "tree" },
      { x: WORLD_HOTSPOTS[1].x + 268, y: WORLD_HOTSPOTS[1].y + 40, kind: "tree" }
    ];
    for (const item of decorSpots) {
      if (item.kind === "fence") {
        const fence = this.add.image(item.x, item.y, "rj-fence").setOrigin(0.5, 1);
        fence.setDepth(206 + item.y);
      } else if (item.kind === "crate") {
        const crate = this.add.image(item.x, item.y, "rj-crate").setOrigin(0.5, 1);
        crate.setDepth(208 + item.y);
      } else {
        const tree = this.add.image(item.x, item.y, "rj-tree-c").setOrigin(0.5, 1);
        tree.setScale(1.12);
        tree.setDepth(202 + item.y);
      }
    }
  };

  scene.spawnAmbientNpcs = function spawnAmbientNpcs() {
    const routes = [
      {
        points: [
          { x: WORLD_HOTSPOTS[0].x + 40, y: WORLD_HOTSPOTS[0].y + 192 },
          { x: WORLD_HOTSPOTS[1].x - 50, y: WORLD_HOTSPOTS[1].y + 188 },
          { x: WORLD_HOTSPOTS[2].x - 10, y: WORLD_HOTSPOTS[2].y + 184 }
        ],
        textureIdle: "rj-npc-a-idle",
        textureStep: "rj-npc-a-step",
        duration: 3800
      },
      {
        points: [
          { x: WORLD_HOTSPOTS[4].x + 40, y: WORLD_HOTSPOTS[4].y + 172 },
          { x: WORLD_HOTSPOTS[1].x + 10, y: WORLD_HOTSPOTS[1].y + 246 },
          { x: WORLD_HOTSPOTS[3].x - 34, y: WORLD_HOTSPOTS[3].y + 178 }
        ],
        textureIdle: "rj-npc-b-idle",
        textureStep: "rj-npc-b-step",
        duration: 4300
      }
    ];
    this.npcs = [];
    routes.forEach((route, idx) => {
      const start = route.points[0];
      const npc = this.add.image(start.x, start.y, route.textureIdle).setOrigin(0.5, 1);
      npc.setScale(1.55);
      npc.setDepth(390 + start.y);
      this.npcs.push(npc);
      let lastX = npc.x;

      const patrolTweens = route.points.slice(1).map((point) => ({
        x: point.x,
        y: point.y,
        duration: route.duration,
        ease: "Sine.easeInOut",
        onUpdate: () => {
          npc.setTexture(Math.floor(this.time.now / 170) % 2 === 0 ? route.textureStep : route.textureIdle);
          if (npc.x !== lastX) {
            npc.setFlipX(npc.x < lastX);
            lastX = npc.x;
          }
          npc.setDepth(390 + npc.y);
        },
        onComplete: () => {
          npc.setTexture(route.textureIdle);
        }
      }));
      this.tweens.chain({
        targets: npc,
        tweens: patrolTweens,
        loop: -1,
        yoyo: true
      });

      this.tweens.add({
        targets: npc,
        y: npc.y - 2,
        duration: 620 + idx * 120,
        repeat: -1,
        yoyo: true,
        ease: "Sine.easeInOut"
      });
    });
  };

  scene.createStructureForHotspot = function createStructureForHotspot(point) {
    const depth = 260 + point.y;
    const scaleByType = {
      panel: 1.28,
      entry: 1.17,
      shelf: 1.2,
      share: 1.18,
      settings: 1.18
    };
    const baseScale = scaleByType[point.type] || 1.34;
    const shadow = this.add.ellipse(point.x, point.y + 72, 230, 68, 0x23412c, 0.3).setDepth(depth - 44);
    const plaza = this.add.ellipse(point.x, point.y + 66, 190, 58, 0xe9d7b6, 0.5).setDepth(depth - 36);
    const buildingKey = `rj-building-${point.type}`;
    const structure = this.add.image(point.x, point.y + 74, buildingKey).setOrigin(0.5, 1).setDepth(depth);
    structure.setScale(baseScale);

    const ring = this.add.image(point.x, point.y - 66, "rj-rune").setDepth(depth + 14).setScale(1.06);
    ring.setTint(point.color);
    const glow = this.add.circle(point.x, point.y - 66, 56, point.color, 0.16).setDepth(depth - 20);
    this.tweens.add({
      targets: [ring, glow],
      y: "-=7",
      duration: 860 + (point.x % 7) * 110,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });
    this.tweens.add({
      targets: glow,
      alpha: 0.06,
      duration: 760,
      yoyo: true,
      repeat: -1
    });

    const titlePlate = this.add
      .rectangle(point.x, point.y + 144, 188, 36, 0x3f2f1a, 0.82)
      .setDepth(depth + 16);
    titlePlate.setStrokeStyle(2, 0xf1d59e, 0.45);
    const titleAccent = this.add.rectangle(point.x, point.y + 128, 112, 6, point.color, 0.55).setDepth(depth + 16);
    const title = this.add
      .text(point.x, point.y + 144, point.label, {
        fontFamily: "JourneySans",
        fontSize: "24px",
        color: "#fff3d6",
        stroke: "#37250e",
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(depth + 18);

    const hit = this.add.zone(point.x, point.y + 56, 252, 224).setDepth(depth + 20);
    hit.setInteractive({ useHandCursor: true });
    hit.setData("hotspotId", point.id);
    hit.on("pointerdown", (pointer, localX, localY, event) => {
      event?.stopPropagation?.();
      this.queueHotspotAction(point.id);
    });

    const blocker = this.add.zone(point.x, point.y + 80, 146, 78).setDepth(depth - 10);
    blocker.setVisible(false);
    this.physics.add.existing(blocker, true);
    if (this.player && blocker.body) {
      this.physics.add.collider(this.player, blocker);
    }
    this.staticObstacles.push(blocker);

    return {
      ...point,
      walkY: point.y + 108,
      baseScale,
      shadow,
      plaza,
      structure,
      ring,
      glow,
      titlePlate,
      titleAccent,
      title,
      hit,
      blocker
    };
  };

  scene.createHotspots = function createHotspots() {
    this.hotspots = [];
    for (const point of WORLD_HOTSPOTS) {
      this.hotspots.push(this.createStructureForHotspot(point));
    }
  };

  scene.getHotspotById = function getHotspotById(zoneId) {
    return this.hotspots.find((hotspot) => hotspot.id === zoneId) || null;
  };

  scene.distanceToHotspot = function distanceToHotspot(hotspot) {
    if (!this.player || !hotspot) return Number.POSITIVE_INFINITY;
    return Math.hypot(this.player.x - hotspot.x, this.player.y - hotspot.y);
  };

  scene.queueHotspotAction = function queueHotspotAction(zoneId) {
    const hotspot = this.getHotspotById(zoneId);
    if (!hotspot) return;
    const distance = this.distanceToHotspot(hotspot);
    if (distance <= WORLD_HOTSPOT_TRIGGER_DISTANCE) {
      worldRuntime.autoTargetZoneId = "";
      worldControlState.pointerActive = false;
      performWorldAction(zoneId);
      return;
    }
    worldRuntime.autoTargetZoneId = zoneId;
    worldControlState.pointerActive = true;
    worldControlState.targetX = hotspot.x;
    worldControlState.targetY = hotspot.walkY || hotspot.y;
    setWorldHint(`正在前往 ${hotspot.label}...`, true);
    updateWorldOverviewHud();
  };

  scene.updatePointerTarget = function updatePointerTarget(pointer) {
    const point = pointer.positionToCamera(this.cameras.main);
    worldRuntime.autoTargetZoneId = "";
    worldControlState.pointerActive = true;
    worldControlState.targetX = PhaserApi.Math.Clamp(point.x, 24, WORLD_MAP_WIDTH - 24);
    worldControlState.targetY = PhaserApi.Math.Clamp(point.y, 56, WORLD_MAP_HEIGHT - 32);
    if (this.destinationMarker) {
      this.destinationMarker.setPosition(worldControlState.targetX, worldControlState.targetY);
      this.destinationMarker.setScale(1.1);
      this.destinationMarker.setAlpha(0.84);
      this.tweens.killTweensOf(this.destinationMarker);
      this.tweens.add({
        targets: this.destinationMarker,
        alpha: 0.2,
        scale: 1.45,
        duration: 440,
        ease: "Sine.easeOut"
      });
    }
  };

  scene.refreshCamera = function refreshCamera() {
    const camera = this.cameras?.main;
    if (!camera || !this.player) return;
    const width = this.scale?.width || WORLD_CANVAS_WIDTH;
    const height = this.scale?.height || WORLD_CANVAS_HEIGHT;
    const zoomBase = Math.min(width / 390, height / 844);
    const zoom = PhaserApi.Math.Clamp(zoomBase * 1.34, 0.98, 1.84);
    camera.setZoom(zoom);
    camera.setDeadzone(Math.max(72, width / zoom * 0.18), Math.max(96, height / zoom * 0.2));
    camera.startFollow(this.player, true, 0.09, 0.09);
  };

  scene.create = function createScene() {
    this.createRoomTextures();
    this.generateTerrainData();
    this.createAmbientLayers();

    this.groundLayer = this.createTileLayer(this.groundData, 4);
    this.waterLayer = this.createTileLayer(this.waterData, 6, 0.94);
    this.pathLayer = this.createTileLayer(this.pathData, 10);
    this.decoLayer = this.createTileLayer(this.decoData, 12);
    this.tweens.add({
      targets: this.waterLayer,
      alpha: 0.88,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });
    this.scatterTrees();
    this.createTownDecor();

    this.physics.world.setBounds(0, 0, WORLD_MAP_WIDTH, WORLD_MAP_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_MAP_WIDTH, WORLD_MAP_HEIGHT);

    this.player = this.physics.add.sprite(WORLD_PLAYER_START.x, WORLD_PLAYER_START.y, "rj-hero-idle");
    this.player.setCollideWorldBounds(true);
    this.player.body.setCircle(7, 8, 22);
    this.player.setScale(1.88);
    this.player.setDepth(340 + WORLD_PLAYER_START.y);

    this.createHotspots();
    this.spawnAmbientNpcs();

    this.dustTrail = this.add.particles(0, 0, "rj-dust", {
      speed: { min: 10, max: 28 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 },
      lifespan: 280,
      frequency: 58,
      quantity: 1,
      blendMode: "NORMAL"
    });
    this.dustTrail.setDepth(9000);
    this.dustTrail.stop();

    this.destinationMarker = this.add.image(WORLD_PLAYER_START.x, WORLD_PLAYER_START.y, "rj-target");
    this.destinationMarker.setDepth(9998);
    this.destinationMarker.setAlpha(0);
    this.destinationMarker.setScale(0.82);

    this.keys = this.input.keyboard.addKeys({
      left: "LEFT",
      right: "RIGHT",
      up: "UP",
      down: "DOWN",
      a: "A",
      d: "D",
      w: "W",
      s: "S"
    });

    this.input.on("pointerdown", (pointer, currentlyOver = []) => {
      const shouldSkipMove = currentlyOver.some((item) => {
        const target = item?.gameObject || item;
        if (!target?.getData) return false;
        return Boolean(target.getData("hotspotId") || target.getData("worldUiAction"));
      });
      if (shouldSkipMove) {
        return;
      }
      this.updatePointerTarget(pointer);
    });
    this.input.on("pointermove", (pointer) => {
      if (!pointer.isDown) return;
      this.updatePointerTarget(pointer);
    });

    this.refreshCamera();
    setWorldHint("点地移动，靠近并点击建筑即可交互。");
  };

  scene.triggerHotspotFx = function triggerHotspotFx(zoneId) {
    const hotspot = this.getHotspotById(zoneId);
    if (!hotspot) return;
    this.cameras.main.shake(110, 0.0015, false);
    hotspot.structure.setScale((hotspot.baseScale || 1.2) + 0.14);
    hotspot.ring.setScale(1.34);
    hotspot.glow.setAlpha(0.32);
    this.tweens.add({
      targets: [hotspot.structure, hotspot.ring],
      scale: hotspot.baseScale || 1.2,
      duration: 220,
      ease: "Back.easeOut"
    });
    this.tweens.add({
      targets: hotspot.glow,
      alpha: 0.14,
      duration: 260,
      ease: "Sine.easeOut"
    });

    for (let i = 0; i < 16; i += 1) {
      const spark = this.add.rectangle(hotspot.x, hotspot.y - 66, 4, 4, hotspot.color, 0.85);
      spark.setDepth(9999);
      this.tweens.add({
        targets: spark,
        x: hotspot.x + (Math.random() * 2 - 1) * 80,
        y: hotspot.y - 66 + (Math.random() * 2 - 1) * 76,
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 300 + Math.random() * 240,
        ease: "Sine.easeOut",
        onComplete: () => spark.destroy()
      });
    }
  };

  scene.resolveNearestHotspot = function resolveNearestHotspot() {
    if (!this.player) return null;
    let nearest = null;
    let best = Number.POSITIVE_INFINITY;
    for (const hotspot of this.hotspots) {
      const dist = Math.hypot(this.player.x - hotspot.x, this.player.y - hotspot.y);
      if (dist <= WORLD_HOTSPOT_TRIGGER_DISTANCE && dist < best) {
        nearest = hotspot;
        best = dist;
      }
    }
    return nearest;
  };

  scene.updateHotspotUi = function updateHotspotUi() {
    const nearest = this.resolveNearestHotspot();
    const nextId = nearest?.id || "";
    if (nextId !== this.activeHotspotId) {
      this.activeHotspotId = nextId;
      worldRuntime.activeZoneId = nextId;
      if (nearest) {
        setWorldHint(`已靠近 ${nearest.label}，点击建筑进入。`, true);
      } else {
        setWorldHint("点地移动，靠近并点击建筑即可交互。", false);
      }
      updateWorldOverviewHud();
    }
    for (const hotspot of this.hotspots) {
      const active = hotspot.id === this.activeHotspotId;
      hotspot.ring.setScale(active ? 1.22 : 1.06);
      hotspot.structure.setScale((hotspot.baseScale || 1.2) + (active ? 0.04 : 0));
      hotspot.title.setColor(active ? "#fff8e7" : "#f8edcd");
      hotspot.titlePlate.setStrokeStyle(2, active ? 0xffdf9a : 0xf1d59e, active ? 0.8 : 0.45);
      hotspot.titleAccent.setAlpha(active ? 0.78 : 0.55);
      hotspot.glow.setAlpha(active ? 0.24 : 0.14);
      hotspot.shadow.setAlpha(active ? 0.42 : 0.3);
    }
  };

  scene.updatePlayer = function updatePlayer(timeNow) {
    if (!this.player || !this.keys) return;
    const keyboardX =
      (worldControlState.right || this.keys.right.isDown || this.keys.d.isDown ? 1 : 0) -
      (worldControlState.left || this.keys.left.isDown || this.keys.a.isDown ? 1 : 0);
    const keyboardY =
      (worldControlState.down || this.keys.down.isDown || this.keys.s.isDown ? 1 : 0) -
      (worldControlState.up || this.keys.up.isDown || this.keys.w.isDown ? 1 : 0);
    const speed = 206;
    let velocityX = 0;
    let velocityY = 0;

    if (keyboardX !== 0 || keyboardY !== 0) {
      worldControlState.pointerActive = false;
      worldRuntime.autoTargetZoneId = "";
      worldRuntime.keyboardUsed = true;
      this.destinationMarker?.setAlpha(0);
      const len = Math.hypot(keyboardX, keyboardY) || 1;
      velocityX = (keyboardX / len) * speed;
      velocityY = (keyboardY / len) * speed;
    } else if (worldControlState.pointerActive) {
      const dx = worldControlState.targetX - this.player.x;
      const dy = worldControlState.targetY - this.player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > WORLD_TARGET_STOP_DISTANCE) {
        const len = distance || 1;
        velocityX = (dx / len) * speed;
        velocityY = (dy / len) * speed;
      } else {
        worldControlState.pointerActive = false;
        this.destinationMarker?.setAlpha(0);
        if (worldRuntime.autoTargetZoneId) {
          const zoneId = worldRuntime.autoTargetZoneId;
          worldRuntime.autoTargetZoneId = "";
          performWorldAction(zoneId);
        }
      }
    }

    this.player.setVelocity(velocityX, velocityY);
    if (velocityX !== 0) {
      this.player.setFlipX(velocityX < 0);
    }

    const moving = velocityX !== 0 || velocityY !== 0;
    if (moving) {
      const useAlt = Math.floor(timeNow / 130) % 2 === 0;
      this.player.setTexture(useAlt ? "rj-hero-step-a" : "rj-hero-step-b");
      this.player.setScale(1.92, 1.84);
      this.dustTrail?.setPosition(this.player.x, this.player.y + 24);
      if (!this.playerMoveState.moving) {
        this.dustTrail?.start();
      }
    } else {
      this.player.setTexture("rj-hero-idle");
      this.player.setScale(1.88, 1.88);
      if (this.playerMoveState.moving) {
        this.dustTrail?.stop();
      }
    }
    this.playerMoveState.moving = moving;
    this.player.setDepth(340 + this.player.y);
  };

  scene.getStateSnapshot = function getStateSnapshot() {
    const activeHotspot = this.getHotspotById(this.activeHotspotId);
    const payload = {
      coordinate: "origin=top-left,x→right,y→down",
      scene: "world",
      player: this.player
        ? {
            x: Number(this.player.x.toFixed(1)),
            y: Number(this.player.y.toFixed(1)),
            vx: Number(this.player.body?.velocity?.x?.toFixed?.(1) || 0),
            vy: Number(this.player.body?.velocity?.y?.toFixed?.(1) || 0)
          }
        : null,
      interaction: {
        activeZoneId: this.activeHotspotId || "",
        activeZoneLabel: activeHotspot?.label || "",
        autoTargetZoneId: worldRuntime.autoTargetZoneId || "",
        pointerTarget: worldControlState.pointerActive
          ? {
              x: Number(worldControlState.targetX.toFixed(1)),
              y: Number(worldControlState.targetY.toFixed(1))
            }
          : null
      },
      ui: {
        sheet: sheetState.type,
        level: state.stats.level,
        completedBooks: getCompletedBooks(state).length
      }
    };
    return payload;
  };

  scene.update = function updateScene(timeNow) {
    this.updatePlayer(timeNow);
    this.updateHotspotUi();
    if (worldRuntime.autoTargetZoneId) {
      const hotspot = this.getHotspotById(worldRuntime.autoTargetZoneId);
      if (hotspot && this.distanceToHotspot(hotspot) <= WORLD_HOTSPOT_TRIGGER_DISTANCE) {
        const zoneId = worldRuntime.autoTargetZoneId;
        worldRuntime.autoTargetZoneId = "";
        worldControlState.pointerActive = false;
        performWorldAction(zoneId);
      }
    }
  };

  worldRuntime.scene = scene;
  worldRuntime.game = new PhaserApi.Game({
    type: PhaserApi.CANVAS,
    parent: elements.worldCanvas,
    transparent: false,
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    backgroundColor: "#72abd9",
    render: {
      pixelArt: true,
      antialias: false,
      roundPixels: true,
      clearBeforeRender: true
    },
    scale: {
      mode: PhaserApi.Scale.RESIZE,
      autoCenter: PhaserApi.Scale.NO_CENTER,
      width: WORLD_CANVAS_WIDTH,
      height: WORLD_CANVAS_HEIGHT
    },
    physics: {
      default: "arcade",
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false
      }
    },
    scene
  });

  worldRuntime.game.scale.on("resize", () => {
    if (scene && scene.scene?.isActive()) {
      scene.refreshCamera();
    }
  });

  const syncCanvasSize = () => {
    if (!(elements.worldCanvas instanceof HTMLElement) || !worldRuntime.game?.scale) return;
    const width = Math.max(1, Math.floor(elements.worldCanvas.clientWidth));
    const height = Math.max(1, Math.floor(elements.worldCanvas.clientHeight));
    worldRuntime.game.scale.resize(width, height);
    if (scene.scene?.isActive()) {
      scene.refreshCamera();
    }
  };

  if (typeof ResizeObserver === "function" && elements.worldCanvas instanceof HTMLElement) {
    worldRuntime.resizeObserver = new ResizeObserver(() => {
      syncCanvasSize();
    });
    worldRuntime.resizeObserver.observe(elements.worldCanvas);
  } else {
    window.addEventListener("resize", syncCanvasSize, { passive: true });
  }

  syncCanvasSize();
}

function renderHeader() {
  const current = elements.views.find((view) => view.dataset.view === activeTab);
  if (!current || !elements.pageTitle || !elements.pageSubtitle) return;
  elements.pageTitle.textContent = current.dataset.title || "";
  elements.pageSubtitle.textContent = current.dataset.subtitle || "";
  if (elements.shell) {
    elements.shell.dataset.scene = activeTab;
  }
  if (elements.headerLevelBadge) {
    elements.headerLevelBadge.textContent = `Lv.${state.stats.level}`;
  }
  if (elements.headerShareBtn) {
    elements.headerShareBtn.classList.toggle("active", sheetState.type === "share");
  }
}

function renderGameToTextState() {
  const scene = worldRuntime.scene;
  const base = {
    coordinate: "origin=top-left,x→right,y→down",
    scene: activeTab,
    level: state.stats.level,
    completedBooks: getCompletedBooks(state).length,
    sheet: sheetState.type
  };
  if (!scene || !scene.getStateSnapshot) {
    return JSON.stringify(base);
  }
  try {
    const snapshot = scene.getStateSnapshot();
    return JSON.stringify({
      ...base,
      ...snapshot
    });
  } catch {
    return JSON.stringify(base);
  }
}

function advanceWorldTime(ms = 1000 / 60) {
  const scene = worldRuntime.scene;
  if (!scene) {
    return false;
  }
  if (scene.scene && !scene.scene.isActive()) {
    scene.scene.resume();
  }
  if (scene.physics?.world?.isPaused) {
    scene.physics.world.resume();
  }
  const frameMs = 1000 / 60;
  const steps = Math.max(1, Math.round(Math.max(1, Number(ms) || frameMs) / frameMs));
  for (let i = 0; i < steps; i += 1) {
    worldRuntime.debugTime += frameMs;
    const playerBeforeX = scene.player?.x ?? 0;
    const playerBeforeY = scene.player?.y ?? 0;
    if (typeof scene.update === "function") {
      scene.update(worldRuntime.debugTime, frameMs);
    }
    if (scene.physics?.world) {
      if (typeof scene.physics.world.update === "function") {
        scene.physics.world.update(worldRuntime.debugTime, frameMs);
        if (typeof scene.physics.world.postUpdate === "function") {
          scene.physics.world.postUpdate();
        }
      } else if (typeof scene.physics.world.step === "function") {
        scene.physics.world.step(frameMs / 1000);
      }
    }
    if (scene.player?.body) {
      const movedByWorld =
        Math.abs((scene.player.x ?? 0) - playerBeforeX) + Math.abs((scene.player.y ?? 0) - playerBeforeY);
      if (movedByWorld < 0.001) {
        scene.player.x = Math.min(
          WORLD_MAP_WIDTH - 8,
          Math.max(8, scene.player.x + ((scene.player.body.velocity?.x || 0) * frameMs) / 1000)
        );
        scene.player.y = Math.min(
          WORLD_MAP_HEIGHT - 8,
          Math.max(8, scene.player.y + ((scene.player.body.velocity?.y || 0) * frameMs) / 1000)
        );
      }
    }
    scene.children?.depthSort?.();
  }
  return true;
}

function seedShelfBooksForTesting(count = 0) {
  const target = Math.max(0, Math.min(60, Number(count) || 0));
  if (target <= 0) return 0;
  const categories = [...ENTRY_CATEGORY_ORDER];
  const stamp = Date.now();
  let added = 0;

  for (let index = 0; index < target; index += 1) {
    const title = `Exhaustive Seed Book ${stamp}-${index + 1}`;
    const author = `Shelf Bot ${index % 5}`;
    if (hasDuplicateBook(title, author)) continue;
    const pages = 160 + ((index * 37) % 520);
    const category = categories[index % categories.length] || "general";
    const created = createBook({
      title,
      author,
      isbn: `RJ-T-${stamp}-${index}`,
      pages,
      category,
      sourceType: "custom"
    });

    if (index % 6 === 0) {
      created.progress = 100;
      created.status = "finished";
      created.progressPages = created.pages;
    } else if (index % 2 === 0) {
      const progress = Math.min(95, 22 + (index % 58));
      created.progress = progress;
      created.status = "reading";
      created.progressPages = Math.round((created.pages * progress) / 100);
    }
    created.updatedAt = Date.now() + index;
    state.books.unshift(created);
    added += 1;
  }

  if (added > 0) {
    invalidateCatalogMerge();
    persist();
    renderAll();
  }
  return added;
}

function exposeWorldTestingHooks() {
  if (typeof window === "undefined") return;
  window.render_game_to_text = () => renderGameToTextState();
  window.advanceTime = (ms) => advanceWorldTime(ms);
  const validZones = new Set(WORLD_HOTSPOTS.map((item) => item.id));
  window.__RJ_TEST__ = {
    ...(window.__RJ_TEST__ || {}),
    queueWorldHotspot: (zoneId) => {
      if (!validZones.has(zoneId)) return false;
      const scene = worldRuntime.scene;
      if (!scene || typeof scene.queueHotspotAction !== "function") return false;
      scene.queueHotspotAction(zoneId);
      return true;
    },
    triggerWorldAction: (zoneId) => {
      if (!validZones.has(zoneId)) return false;
      performWorldAction(zoneId);
      return true;
    },
    clearWorldPointerTarget: () => {
      worldRuntime.autoTargetZoneId = "";
      worldControlState.pointerActive = false;
      worldRuntime.scene?.destinationMarker?.setAlpha?.(0);
      return true;
    },
    clearWorldInteractCooldown: () => {
      worldRuntime.interactCooldownUntil = 0;
      return true;
    },
    seedShelfBooks: (count) => {
      return seedShelfBooksForTesting(count);
    },
    openShelfSheet: () => {
      onPanelShelfMore({ skipHistory: true });
      return true;
    },
    openBookDetail: (uidValue) => {
      const book = getBookByUid(uidValue);
      if (!book) return false;
      openBookDetailSheet(book.uid, { skipHistory: true });
      return true;
    },
    openBookPagesEditor: (uidValue) => {
      const book = getBookByUid(uidValue);
      if (!book) return false;
      openBookPagesEditorSheet(book.uid, { skipHistory: true });
      return true;
    },
    setBookTotalPages: (uidValue, nextTotalValue) => {
      const book = getBookByUid(uidValue);
      const nextTotalPages = Number(nextTotalValue);
      if (!book || !Number.isInteger(nextTotalPages) || nextTotalPages < 1 || nextTotalPages > 4000) {
        return false;
      }
      const currentTotalPages = Math.max(1, Number(book.pages) || 1);
      const currentProgress = Math.max(0, Math.min(100, Number(book.progress) || 0));
      const oldReadPages = Math.max(
        0,
        Math.min(currentTotalPages, Number(book.progressPages) || Math.round((currentTotalPages * currentProgress) / 100))
      );
      const nextReadPages = Math.min(oldReadPages, nextTotalPages);
      const nextProgress = Math.max(0, Math.min(100, Math.round((nextReadPages / nextTotalPages) * 100)));
      book.pages = nextTotalPages;
      book.progressPages = nextReadPages;
      book.progress = nextProgress;
      book.status = nextProgress >= 100 ? "finished" : nextProgress > 0 ? "reading" : "planned";
      book.pagesEstimated = false;
      book.updatedAt = Date.now();
      persist();
      renderAll();
      onPanelShelfMore({
        skipHistory: true,
        feedbackText: `《${book.title}》总页数已更新为 ${nextTotalPages} 页（已读 ${nextReadPages} 页，不触发奖励）。`
      });
      return true;
    },
    getFirstShelfBookUid: () => {
      const firstBook = getShelfBooks()[0];
      return firstBook?.uid || "";
    }
  };
}

function getActiveViewElement() {
  return elements.views.find((view) => view.dataset.view === activeTab) || null;
}

function enforceHeightSentinel() {
  const activeView = getActiveViewElement();
  if (!activeView) return;
  if (elements.shell) {
    elements.shell.dataset.overflowLevel = "0";
    elements.shell.dataset.heightAlert = "0";
  }
}

function renderAll({ skipHeightSentinel = false } = {}) {
  rotateDayIfNeeded(state);
  applyDensityMode();
  renderHeader();
  renderWorld();
  renderEntry();
  renderPanel();
  renderShelf();
  renderShare();
  renderSettings();

  if (!skipHeightSentinel) {
    requestAnimationFrame(() => {
      enforceHeightSentinel();
    });
  }
}

function createAudioEngine() {
  const HowlCtor = typeof window !== "undefined" ? window.Howl : null;
  const HowlerApi = typeof window !== "undefined" ? window.Howler : null;
  const supportsHowler = Boolean(HowlCtor && HowlerApi);
  const supportsNativeAudio = typeof Audio !== "undefined";
  const supportsAudio = supportsHowler || supportsNativeAudio;
  const bgmSources = [
    "./assets/audio/bgm-astral-loop.wav",
    "./assets/audio/bgm-sanctum-loop.wav"
  ];
  const sceneIndex = {
    world: 0,
    entry: 0,
    panel: 1,
    shelf: 1,
    share: 1,
    settings: 1
  };

  if (supportsHowler) {
    HowlerApi.autoSuspend = false;
  }

  const bgmTracks = supportsHowler
    ? bgmSources.map((src) =>
        new HowlCtor({
          src: [src],
          loop: true,
          preload: true,
          volume: 0,
          html5: false
        })
      )
    : supportsNativeAudio
      ? bgmSources.map((src) => {
          const audio = new Audio(src);
          audio.loop = true;
          audio.preload = "auto";
          audio.volume = 0;
          return audio;
        })
      : [];
  const sfx = supportsHowler
    ? {
        entry: new HowlCtor({
          src: ["./assets/audio/entry-success.wav"],
          preload: true,
          volume: clamp01(getAudioProfile().sfxVolume / 100),
          html5: false
        }),
        skill: new HowlCtor({
          src: ["./assets/audio/skill-unlock.wav"],
          preload: true,
          volume: clamp01(getAudioProfile().sfxVolume / 100),
          html5: false
        }),
        level: new HowlCtor({
          src: ["./assets/audio/level-up.wav"],
          preload: true,
          volume: clamp01(getAudioProfile().sfxVolume / 100),
          html5: false
        }),
        tap: new HowlCtor({
          src: ["./assets/audio/ui-tap.wav"],
          preload: true,
          volume: clamp01(getAudioProfile().sfxVolume / 100) * 0.56,
          html5: false
        })
      }
    : supportsNativeAudio
      ? {
          entry: new Audio("./assets/audio/entry-success.wav"),
          skill: new Audio("./assets/audio/skill-unlock.wav"),
          level: new Audio("./assets/audio/level-up.wav"),
          tap: new Audio("./assets/audio/ui-tap.wav")
        }
      : {};

  let currentTrack = null;
  let fadeToken = 0;
  let fadeTimer = 0;
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

  const clearFadeTimer = () => {
    if (fadeTimer) {
      clearTimeout(fadeTimer);
      fadeTimer = 0;
    }
  };

  const getTrackVolume = (track) => {
    if (supportsHowler) return clamp01(track.volume());
    return clamp01(track.volume);
  };

  const setTrackVolume = (track, value) => {
    const next = clamp01(value);
    if (supportsHowler) {
      track.volume(next);
      return;
    }
    track.volume = next;
  };

  const isTrackPlaying = (track) => {
    if (supportsHowler) {
      return track.playing();
    }
    return !track.paused;
  };

  const startTrack = (track, volume) => {
    if (supportsHowler) {
      if (!track.playing()) {
        track.play();
      }
      track.volume(clamp01(volume));
      return;
    }
    track.volume = clamp01(volume);
    track.play().catch(() => {});
  };

  const stopTrack = (track) => {
    if (supportsHowler) {
      track.stop();
      track.volume(0);
      return;
    }
    track.pause();
    track.volume = 0;
  };

  function stopBgm(immediate = false) {
    fadeToken += 1;
    clearFadeTimer();
    const tracks = currentTrack
      ? [currentTrack]
      : bgmTracks.filter((track) => isTrackPlaying(track) || getTrackVolume(track) > 0.001);
    if (immediate || prefersReducedMotion()) {
      tracks.forEach((track) => {
        stopTrack(track);
      });
      currentTrack = null;
      return;
    }
    if (tracks.length === 0) {
      currentTrack = null;
      return;
    }

    const localToken = fadeToken;
    const duration = 860;
    const fromVolumes = tracks.map((track) => getTrackVolume(track));

    if (supportsHowler) {
      tracks.forEach((track, index) => {
        track.fade(fromVolumes[index], 0, duration);
      });
      fadeTimer = window.setTimeout(() => {
        if (localToken !== fadeToken) return;
        tracks.forEach((track) => {
          stopTrack(track);
        });
        currentTrack = null;
      }, duration + 24);
      return;
    }

    const start = performance.now();
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
          stopTrack(track);
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
      startTrack(nextTrack, targetVolume);
      return;
    }

    const previousTrack = currentTrack;
    currentTrack = nextTrack;
    fadeToken += 1;
    clearFadeTimer();
    const localToken = fadeToken;
    const startVolume = immediate || prefersReducedMotion() ? targetVolume : 0;
    startTrack(nextTrack, startVolume);

    if (!previousTrack || immediate || prefersReducedMotion()) {
      if (previousTrack && previousTrack !== nextTrack) {
        stopTrack(previousTrack);
      }
      setTrackVolume(nextTrack, targetVolume);
      return;
    }

    const duration = 1200;
    const fromVolume = getTrackVolume(previousTrack) || targetVolume;

    if (supportsHowler) {
      previousTrack.fade(fromVolume, 0, duration);
      nextTrack.fade(startVolume, targetVolume, duration);
      fadeTimer = window.setTimeout(() => {
        if (localToken !== fadeToken) return;
        stopTrack(previousTrack);
        setTrackVolume(nextTrack, targetVolume);
      }, duration + 24);
      return;
    }

    const start = performance.now();

    const step = (now) => {
      if (localToken !== fadeToken) return;
      const progress = Math.min(1, (now - start) / duration);
      previousTrack.volume = fromVolume * (1 - progress);
      nextTrack.volume = targetVolume * progress;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        stopTrack(previousTrack);
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
    if (supportsHowler) {
      HowlerApi.mute(!getAudioProfile().masterEnabled);
    }
    if (!canPlayBgm()) {
      stopBgm(false);
    } else {
      setScene(activeTab, false);
    }
    const sfxVolume = getSfxVolume();
    Object.entries(sfx).forEach(([kind, audioNode]) => {
      const volume = kind === "tap" ? sfxVolume * 0.56 : sfxVolume;
      if (supportsHowler) {
        audioNode.volume(volume);
      } else {
        audioNode.volume = volume;
      }
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
    if (supportsHowler) {
      target.volume(getSfxVolume());
      target.stop();
      target.play();
      return;
    }
    target.currentTime = 0;
    target.volume = getSfxVolume();
    target.play().catch(() => {});
  }

  function getStatusText() {
    const audio = getAudioProfile();
    if (!supportsAudio) {
      return "当前环境不支持音频播放。";
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
    worldRuntime.game?.scale?.refresh?.();
    renderAll();
  });
}

function switchTab(tab, { skipAnimation = false } = {}) {
  const previousTab = activeTab;
  const safeTab = elements.views.some((view) => view.dataset.view === tab) ? tab : "world";
  activeTab = safeTab;
  if (safeTab !== "world") {
    setWorldMovement("left", false);
    setWorldMovement("right", false);
    setWorldMovement("up", false);
    setWorldMovement("down", false);
  }
  if (safeTab !== "shelf") {
    activeShelfUid = "";
    shelfPulseUid = "";
  }
  elements.tabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === safeTab);
  });

  if (!skipAnimation && safeTab !== previousTab) {
    audioEngine.playSfx("tap");
    triggerHaptic("light");
    if (safeTab === "shelf") {
      spawnGameToast("进入藏书阁", "skill", elements.headerLevelBadge);
    } else if (safeTab === "world") {
      spawnGameToast("进入旅者小屋", "info", elements.headerLevelBadge);
    }
  }

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
  syncWorldSceneState();
  if (elements.shell) {
    elements.shell.dataset.overflowLevel = "0";
  }
  renderAll({ skipHeightSentinel: true });
  requestAnimationFrame(() => {
    enforceHeightSentinel();
  });
}

function openSheet(title, contentHtml, options = {}) {
  const { skipHistory = false } = options;
  if (!elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  rememberSheetForBack(`generic:${title}`, skipHistory);
  audioEngine.playSfx("tap");
  triggerHaptic("light");
  sheetState.type = "generic";
  sheetState.title = title;
  sheetState.html = contentHtml;
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";
  elements.sheetTitle.textContent = title;
  elements.sheetContent.innerHTML = contentHtml;
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    syncWorldSceneState();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
  syncWorldSceneState();
  syncSheetBackButtonState();
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

function openSearchSheet(searchData, mode = "offline", options = {}) {
  const { skipHistory = false, loaded = SEARCH_SHEET_PAGE_SIZE, query = String(entrySearchQuery || "").trim() } = options;
  if (!elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  rememberSheetForBack(`search:${mode}:${query}`, skipHistory);
  audioEngine.playSfx("tap");
  triggerHaptic("light");
  sheetState.type = "search";
  sheetState.title = "书库搜索结果";
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";
  sheetState.searchItems = searchData.items;
  sheetState.searchTotal = searchData.total;
  sheetState.searchTruncated = searchData.truncated;
  sheetState.searchLoaded = Math.min(Math.max(SEARCH_SHEET_PAGE_SIZE, Number(loaded) || SEARCH_SHEET_PAGE_SIZE), searchData.items.length);
  sheetState.query = query;
  sheetState.searchMode = mode;
  renderSearchSheet();

  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    syncWorldSceneState();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
  syncWorldSceneState();
  syncSheetBackButtonState();
}

function closeSheet() {
  if (!elements.sheetDialog) return;
  audioEngine.playSfx("tap");
  clearSheetHistory();
  resetSheetDialogState();

  if (typeof elements.sheetDialog.close === "function") {
    elements.sheetDialog.close();
  } else {
    elements.sheetDialog.removeAttribute("open");
  }
  if (activeTab !== "world") {
    switchTab("world", { skipAnimation: true });
    return;
  }
  syncWorldSceneState();
  syncSheetBackButtonState();
}

function resetSheetDialogState() {
  sheetState.type = "none";
  sheetState.html = "";
  sheetState.searchItems = [];
  sheetState.searchTotal = 0;
  sheetState.searchTruncated = false;
  sheetState.searchLoaded = SEARCH_SHEET_PAGE_SIZE;
  sheetState.searchMode = "offline";
  sheetState.bookUid = "";
  sheetState.editingReflectionId = "";
  elements.headerShareBtn?.classList.remove("active");
}

function syncAfterNativeSheetClose() {
  const hasDanglingState = sheetState.type !== "none" || sheetHistoryStack.length > 0;
  if (!hasDanglingState) {
    syncWorldSceneState();
    syncSheetBackButtonState();
    return;
  }

  clearSheetHistory();
  resetSheetDialogState();

  if (activeTab !== "world") {
    switchTab("world", { skipAnimation: true });
    return;
  }

  syncWorldSceneState();
  syncSheetBackButtonState();
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
  pulseSelectionAffordance();
  spawnGameToast("已选中目标书籍", "info", button);
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
  if (sheetState.type === "world-entry") {
    renderWorldEntrySheet(elements.entryFeedback?.textContent || "");
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

function openBookDetailSheet(uidValue, options = {}) {
  const { skipHistory = false, feedbackText = "", editingReflectionId = "" } = options;
  const book = getBookByUid(uidValue);
  if (!book || !elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  rememberSheetForBack(`book-detail:${book.uid}`, skipHistory);
  audioEngine.playSfx("tap");
  triggerHaptic("medium");
  sheetState.type = "book-detail";
  sheetState.bookUid = book.uid;
  sheetState.editingReflectionId = editingReflectionId;
  renderBookDetailSheet(feedbackText);
  if (elements.sheetDialog.hasAttribute("open")) {
    syncWorldSceneState();
    return;
  }
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    syncWorldSceneState();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
  syncWorldSceneState();
  syncSheetBackButtonState();
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

  const totalPages = Math.max(1, Number(book.pages) || 1);
  const progressValue = Math.max(0, Math.min(100, Number(book.progress) || 0));
  const readPages = Math.max(
    0,
    Math.min(totalPages, Number(book.progressPages) || Math.round((totalPages * progressValue) / 100))
  );
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
          <input
            id="sheet-book-progress-number"
            type="number"
            min="0"
            max="${totalPages}"
            value="${readPages}"
            inputmode="numeric"
            aria-label="已读页数"
          />
          <button type="button" class="btn-primary" id="sheet-save-progress-btn">保存进度</button>
        </div>
        <p class="tip">输入已读页数，进度条会自动换算百分比。</p>
        <p id="sheet-book-pages-label" class="tip">已读 ${readPages} / ${totalPages} 页</p>
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
  const totalPages = Math.max(1, Number(book.pages) || 1);
  const sourceValue = source instanceof HTMLInputElement ? source.value : range.value;
  const isPagesInput = source instanceof HTMLInputElement && source.id === "sheet-book-progress-number";
  const pagesValue = isPagesInput
    ? Math.max(0, Math.min(totalPages, Math.round(Number(sourceValue) || 0)))
    : Math.round((totalPages * (Math.max(0, Math.min(100, Number(sourceValue) || 0)))) / 100);
  const progressValue = Math.max(0, Math.min(100, Math.round((pagesValue / totalPages) * 100)));
  range.value = String(progressValue);
  numberInput.value = String(pagesValue);
  if (label instanceof HTMLElement) {
    label.textContent = `${progressValue}%`;
  }
  if (pagesLabel instanceof HTMLElement) {
    pagesLabel.textContent = `已读 ${pagesValue} / ${totalPages} 页`;
  }
}

function handleBookProgressSave() {
  const book = getBookByUid(sheetState.bookUid);
  const numberInput = elements.sheetContent?.querySelector("#sheet-book-progress-number");
  if (!book || !(numberInput instanceof HTMLInputElement)) return;
  const totalPages = Math.max(1, Number(book.pages) || 1);
  const readPages = Math.max(0, Math.min(totalPages, Math.round(Number(numberInput.value) || 0)));
  numberInput.value = String(readPages);
  const nextProgress = Math.max(0, Math.min(100, Math.round((readPages / totalPages) * 100)));
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
    const progressButton = elements.sheetContent?.querySelector("#sheet-save-progress-btn");
    spawnGameToast("进度已校正", "info", progressButton instanceof Element ? progressButton : null);
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
      spawnGameToast(`等级提升到 Lv.${state.stats.level}`, "level", elements.headerLevelBadge);
    } else if (reward.unlockedSkills.length > 0) {
      triggerShellBurst("progress");
      audioEngine.playSfx("skill");
      const unlockedName = reward.unlockedSkills[0]?.name || "新技能";
      panelSkillPulseId = reward.unlockedSkills[0]?.id || "";
      spawnGameToast(`技能解锁：${unlockedName}`, "skill", elements.headerLevelBadge);
    } else {
      triggerShellBurst("progress");
      audioEngine.playSfx("entry");
      const progressButton = elements.sheetContent?.querySelector("#sheet-save-progress-btn");
      spawnGameToast(`经验 +${reward.expGain}`, "gain", progressButton instanceof Element ? progressButton : null);
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

function openBookPagesEditorSheet(uidValue, options = {}) {
  const { skipHistory = false, feedbackText = "" } = options;
  const book = getBookByUid(uidValue);
  if (!book || !elements.sheetDialog || !elements.sheetTitle || !elements.sheetContent) return;
  rememberSheetForBack(`book-pages-editor:${book.uid}`, skipHistory);
  audioEngine.playSfx("tap");
  triggerHaptic("light");
  sheetState.type = "book-pages-editor";
  sheetState.bookUid = book.uid;
  sheetState.editingReflectionId = "";
  renderBookPagesEditorContent(book, feedbackText);
  if (elements.sheetDialog.hasAttribute("open")) {
    syncWorldSceneState();
    return;
  }
  if (typeof elements.sheetDialog.showModal === "function") {
    elements.sheetDialog.showModal();
    syncWorldSceneState();
    return;
  }
  elements.sheetDialog.setAttribute("open", "");
  syncWorldSceneState();
  syncSheetBackButtonState();
}

function renderBookPagesEditorContent(book, feedbackText = "") {
  if (!elements.sheetTitle || !elements.sheetContent) return;
  const targetBook = book || getBookByUid(sheetState.bookUid);
  if (!targetBook) {
    elements.sheetTitle.textContent = "编辑页数";
    elements.sheetContent.innerHTML = '<p class="tip">该书已不存在。</p>';
    return;
  }
  const totalPages = Math.max(1, Number(targetBook.pages) || 1);
  const progressValue = Math.max(0, Math.min(100, Number(targetBook.progress) || 0));
  const readPages = Math.max(
    0,
    Math.min(totalPages, Number(targetBook.progressPages) || Math.round((totalPages * progressValue) / 100))
  );
  elements.sheetTitle.textContent = "编辑页数";
  elements.sheetContent.innerHTML = `
    <section class="sheet-book-pages-editor">
      <div class="sheet-book-head">
        <h3>${escapeHtml(targetBook.title)}</h3>
        <p class="tip">${escapeHtml(targetBook.author)} · ${escapeHtml(CATEGORY_LABELS[targetBook.category] || "通识")}</p>
      </div>
      <section class="sheet-progress-editor">
        <p class="tip">当前总页数：${totalPages} 页</p>
        <p class="tip">当前已读：${readPages} 页（${progressValue}%）</p>
        <label>
          修正总页数（1-4000）
          <input
            id="sheet-book-total-pages-input"
            type="number"
            min="1"
            max="4000"
            step="1"
            value="${totalPages}"
            inputmode="numeric"
            aria-label="书籍总页数"
          />
        </label>
        <p class="tip">保存后会尽量保持已读页数不变（超出会自动截断），并自动换算进度与状态；不发放奖励。</p>
        <div class="inline-actions">
          <button type="button" class="btn-primary" id="sheet-book-pages-save-btn" data-book-uid="${escapeHtml(targetBook.uid)}">保存页数</button>
          <button type="button" class="btn-secondary" id="sheet-book-pages-cancel-btn">返回藏书阁</button>
        </div>
      </section>
      ${feedbackText ? `<p class="feedback">${escapeHtml(feedbackText)}</p>` : ""}
    </section>
  `;
}

function handleBookTotalPagesSave(uidValue = "") {
  const bookUid = String(uidValue || sheetState.bookUid || "").trim();
  const book = getBookByUid(bookUid);
  const pagesInput = elements.sheetContent?.querySelector("#sheet-book-total-pages-input");
  if (!book || !(pagesInput instanceof HTMLInputElement)) return;
  const parsedValue = Number(pagesInput.value);
  if (!Number.isFinite(parsedValue) || !Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 4000) {
    renderBookPagesEditorContent(book, "请输入 1~4000 的整数页数。");
    return;
  }

  const currentTotalPages = Math.max(1, Number(book.pages) || 1);
  const currentProgress = Math.max(0, Math.min(100, Number(book.progress) || 0));
  const oldReadPages = Math.max(
    0,
    Math.min(currentTotalPages, Number(book.progressPages) || Math.round((currentTotalPages * currentProgress) / 100))
  );
  const nextTotalPages = parsedValue;
  const nextReadPages = Math.min(oldReadPages, nextTotalPages);
  const nextProgress = Math.max(0, Math.min(100, Math.round((nextReadPages / nextTotalPages) * 100)));

  book.pages = nextTotalPages;
  book.progressPages = nextReadPages;
  book.progress = nextProgress;
  book.status = nextProgress >= 100 ? "finished" : nextProgress > 0 ? "reading" : "planned";
  book.pagesEstimated = false;
  book.updatedAt = Date.now();
  persist();
  renderAll();

  const successText = `《${book.title}》总页数已更新为 ${nextTotalPages} 页（已读 ${nextReadPages} 页，不触发奖励）。`;
  setEntryFeedback(successText);
  onPanelShelfMore({ skipHistory: true, feedbackText: successText });
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

function onPanelShelfMore(options = {}) {
  const { skipHistory = false, feedbackText = "" } = options;
  const books = getShelfBooks();
  const counts = {
    all: books.length,
    reading: books.filter((book) => book.status === "reading").length,
    planned: books.filter((book) => book.status === "planned").length,
    finished: books.filter((book) => book.status === "finished").length
  };
  const activeFilter = normalizeShelfFilter(sheetState.shelfFilter);
  const filteredBooks =
    activeFilter === "all" ? books : books.filter((book) => String(book.status || "") === activeFilter);
  const { rowSize, pageSize } = getShelfLayoutConfig();
  const totalPages = Math.max(1, Math.ceil(filteredBooks.length / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Number(sheetState.shelfPage) || 1));
  const startIndex = (currentPage - 1) * pageSize;
  const pageBooks = filteredBooks.slice(startIndex, startIndex + pageSize);
  const pageRows = chunkBooksByRow(pageBooks, rowSize);
  const hasBooks = books.length > 0;

  sheetState.shelfFilter = activeFilter;
  sheetState.shelfPage = currentPage;

  const filterButtons = SHELF_FILTER_OPTIONS.map((item) => {
    const activeClass = item.key === activeFilter ? " active" : "";
    const count = counts[item.key] || 0;
    return `
      <button type="button" class="bookshelf-filter-btn${activeClass}" data-shelf-filter="${item.key}">
        ${escapeHtml(item.label)}<span class="bookshelf-filter-count">${count}</span>
      </button>
    `;
  }).join("");

  const rowsHtml = pageRows
    .map((row) => {
      const booksHtml = row
        .map((book) => {
          const progress = Math.max(0, Math.min(100, Number(book.progress) || 0));
          const totalPages = Math.max(1, Number(book.pages) || 1);
          const readPages = Math.max(
            0,
            Math.min(totalPages, Number(book.progressPages) || Math.round((totalPages * progress) / 100))
          );
          return `
            <article class="bookshelf-book" data-book-uid="${escapeHtml(book.uid)}">
              <div class="bookshelf-book-paper">
                <span class="bookshelf-book-status">${escapeHtml(formatBookStatus(book))}</span>
                <p class="bookshelf-book-title">${escapeHtml(book.title)}</p>
                <p class="bookshelf-book-meta">${escapeHtml(book.author)} · ${escapeHtml(CATEGORY_LABELS[book.category] || "通识")}</p>
                <div class="bookshelf-track"><div class="bookshelf-fill" style="width:${progress}%"></div></div>
                <p class="bookshelf-book-progress">
                  <span class="bookshelf-book-progress-percent">阅读进度 ${progress}%</span>
                  <span class="bookshelf-book-progress-pages">${readPages}/${totalPages} 页</span>
                </p>
              </div>
              <div class="bookshelf-book-actions">
                <button type="button" class="bookshelf-book-open-btn sheet-open-book-detail" data-book-uid="${escapeHtml(book.uid)}">书卷详情</button>
                <button type="button" class="bookshelf-book-edit-btn sheet-edit-book-pages" data-book-uid="${escapeHtml(book.uid)}">编辑页数</button>
              </div>
            </article>
          `;
        })
        .join("");
      return `<div class="bookshelf-row">${booksHtml}</div>`;
    })
    .join("");

  const emptyHtml = hasBooks
    ? '<div class="bookshelf-empty">当前筛选下暂无书卷，试试切换筛选条件。</div>'
    : '<div class="bookshelf-empty">书架还是空的，先去录入台登记第一本书吧。</div>';

  const paginationHtml =
    filteredBooks.length > pageSize
      ? `
        <div class="bookshelf-pagination">
          <button type="button" class="bookshelf-page-btn btn-secondary" data-shelf-page-action="prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
          <p class="bookshelf-page-label">第 ${currentPage} / ${totalPages} 页</p>
          <button type="button" class="bookshelf-page-btn btn-secondary" data-shelf-page-action="next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      `
      : "";

  const html = `
    <section class="bookshelf-sheet">
      <header class="bookshelf-head">
        <div class="bookshelf-head-main">
          <p class="bookshelf-head-title">藏书阁</p>
          <p class="bookshelf-head-sub">共 ${books.length} 本 · 当前展示 ${filteredBooks.length} 本</p>
        </div>
        <p class="bookshelf-head-meta">${rowSize} 本/层 · ${filteredBooks.length > 0 ? Math.ceil(filteredBooks.length / rowSize) : 0} 层</p>
      </header>
      <div class="bookshelf-filter" role="tablist" aria-label="书架筛选">
        ${filterButtons}
      </div>
      <div class="bookshelf-rack" style="--bookshelf-row-size:${rowSize};">
        ${pageRows.length > 0 ? rowsHtml : emptyHtml}
      </div>
      ${paginationHtml}
      ${feedbackText ? `<p class="feedback">${escapeHtml(feedbackText)}</p>` : ""}
    </section>
  `;
  openSheet("藏书阁", html, { skipHistory });
}

function onPanelSkillsMore() {
  const unlockedSet = new Set((state.stats.skills || []).map((item) => item.id));
  const html = SKILL_PATH_ORDER.map((path) => {
    const rules = getSkillRulesByPath(path);
    const unlockedCount = rules.filter((rule) => unlockedSet.has(rule.id)).length;
    const rows = rules
      .map((rule) => {
        const unlocked = unlockedSet.has(rule.id);
        return `
          <article class="skill-crest ${unlocked ? "active" : "empty"}">
            <p class="skill-crest-title">${escapeHtml(rule.name)} · 第${Math.max(1, Number(rule.tier) || 1)}阶</p>
            <p class="skill-crest-sub">${escapeHtml(rule.description || "已掌握，可持续通过阅读强化。")}</p>
            <p class="tip">${escapeHtml(rule.unlockHint || "持续阅读可解锁")}</p>
            <p class="tip">${escapeHtml(getSkillConditionProgressText(rule))}</p>
            <p class="tip">${escapeHtml(getSkillPrerequisiteText(rule))}</p>
          </article>
        `;
      })
      .join("");
    return `
      <section class="skill-ladder-group">
        <div class="card-head">
          <h3>${escapeHtml(SKILL_PATH_LABELS[path] || SKILL_PATH_LABELS.general)}</h3>
          <span class="badge">${unlockedCount}/${rules.length}</span>
        </div>
        <div class="skill-ladder-list">${rows}</div>
      </section>
    `;
  }).join("");
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
  const code = getSharePayload().invite;
  try {
    await copyText(code);
    setShareFeedback("邀请码已复制。愿你把阅读火种传给下一位旅者。");
    flashShareCard();
  } catch {
    setShareFeedback(`复制失败，请手动复制：${code}`);
  }
}

async function onCopyShare() {
  const text = getSharePayload().text;
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
      if (sheetState.type === "world-settings") {
        renderWorldSettingsSheet("导入成功。你的旅程已恢复。");
      }
    } catch {
      setSettingsFeedback("导入失败：文件格式无效。");
      if (sheetState.type === "world-settings") {
        renderWorldSettingsSheet("导入失败：文件格式无效。");
      }
    }
  };
  reader.onerror = () => {
    setSettingsFeedback("导入失败：读取文件失败。");
    if (sheetState.type === "world-settings") {
      renderWorldSettingsSheet("导入失败：读取文件失败。");
    }
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
  if (sheetState.type !== "none") {
    closeSheet();
    return;
  }
  if (activeTab !== "world") {
    switchTab("world", { skipAnimation: true });
  }
}

function updateAudioSetting(patch) {
  const audio = getAudioProfile();
  Object.assign(audio, patch);
  audio.masterEnabled = Boolean(audio.bgmEnabled || audio.sfxEnabled);
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
      switchTab(tab.dataset.tab || "world");
    });
  });

  window.addEventListener("resize", onViewportResize, { passive: true });
  window.visualViewport?.addEventListener("resize", onViewportResize, { passive: true });
  reduceMotionQuery?.addEventListener("change", () => {
    renderAll();
  });

  elements.headerShareBtn?.addEventListener("click", openShareSheet);
  elements.worldEntryBtn?.addEventListener("click", () => {
    performWorldAction("entry");
  });
  elements.worldShareBtn?.addEventListener("click", () => {
    performWorldAction("share");
  });

  elements.entrySearchInput?.addEventListener("input", onEntrySearchInput);
  elements.entrySearchResults?.addEventListener("click", onEntrySearchResultsClick);
  elements.entrySearchMoreBtn?.addEventListener("click", onEntrySearchMore);
  elements.entryOnlineSearchBtn?.addEventListener("click", () => {
    onEntryOnlineSearch().catch(() => setEntryFeedback("联网搜索失败，请稍后再试。"));
  });
  elements.entryCustomModeBtn?.addEventListener("click", onEntryModeToggle);
  elements.entryAddBtn?.addEventListener("click", () => {
    addEntryBook().catch(() => {
      setEntryFeedback("录入失败，请稍后重试。");
      renderEntry();
    });
  });
  elements.entryBooksMoreBtn?.addEventListener("click", onEntryBooksMore);

  elements.panelAttributesMoreBtn?.addEventListener("click", onPanelAttributesMore);
  elements.panelShelfMoreBtn?.addEventListener("click", onPanelShelfMore);
  elements.panelShelfList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const openDetailButton = target.closest(".panel-open-book-detail-btn");
    if (openDetailButton instanceof HTMLButtonElement) {
      const uidValue = openDetailButton.dataset.bookUid;
      if (!uidValue) return;
      openBookDetailSheet(uidValue);
      return;
    }

    const mainButton = target.closest(".panel-open-book");
    if (!(mainButton instanceof HTMLButtonElement)) return;
    const uidValue = mainButton.dataset.bookUid;
    if (!uidValue) return;
    shelfPulseUid = uidValue;
    window.setTimeout(() => {
      if (shelfPulseUid === uidValue) {
        shelfPulseUid = "";
        renderShelf();
      }
    }, 320);
    if (activeShelfUid === uidValue) {
      activeShelfUid = "";
      audioEngine.playSfx("tap");
      triggerHaptic("light");
      renderAll();
      return;
    }
    activeShelfUid = uidValue;
    audioEngine.playSfx("tap");
    triggerHaptic("light");
    renderAll();
  });
  elements.panelSkillStarMap?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const starNode = target.closest(".skill-star-node");
    if (!(starNode instanceof HTMLButtonElement)) return;
    const skillId = starNode.dataset.skillId;
    if (!skillId) return;
    const rule = getSkillRuleById(skillId);
    if (!rule) return;
    const unlocked = state.stats.skills.some((item) => item.id === skillId);
    const html = buildSkillDetailHtml(rule, unlocked);
    openSheet("技能星详情", html);
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

  elements.settingsBgmToggleBtn?.addEventListener("click", () => {
    const audio = getAudioProfile();
    const nextValue = !audio.bgmEnabled;
    updateAudioSetting({ bgmEnabled: nextValue });
    setSettingsFeedback(nextValue ? "背景音乐已开启。" : "背景音乐已关闭。");
    spawnGameToast(nextValue ? "背景音乐开启" : "背景音乐关闭", "info", elements.settingsBgmToggleBtn);
  });

  elements.settingsSfxToggleBtn?.addEventListener("click", () => {
    const audio = getAudioProfile();
    const nextValue = !audio.sfxEnabled;
    updateAudioSetting({ sfxEnabled: nextValue });
    setSettingsFeedback(nextValue ? "提示音已开启。" : "提示音已关闭。");
    spawnGameToast(nextValue ? "提示音开启" : "提示音关闭", "info", elements.settingsSfxToggleBtn);
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

  elements.sheetBackBtn?.addEventListener("click", goBackSheet);
  elements.sheetCloseBtn?.addEventListener("click", closeSheet);
  elements.sheetDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSheet();
  });
  elements.sheetDialog?.addEventListener("close", () => {
    syncAfterNativeSheetClose();
  });
  elements.sheetDialog?.addEventListener("click", (event) => {
    if (event.target === elements.sheetDialog) {
      closeSheet();
    }
  });

  elements.sheetContent?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("#sheet-world-entry-mode-btn")) {
      if (entryMode === "catalog") {
        entryMode = "custom";
        selectedCatalogKey = "";
      } else {
        entryMode = "catalog";
      }
      renderWorldEntrySheet(entryMode === "custom" ? "已切换到自编录入模式。" : "已切换到书库录入模式。");
      return;
    }

    if (target.closest("#sheet-world-entry-more-btn")) {
      const searchData = searchCatalogBooks();
      const previewLimit = 8;
      if (!searchData.message && searchData.items.length > previewLimit) {
        openSearchSheet(searchData, "offline");
      }
      return;
    }

    if (target.closest("#sheet-world-entry-online-btn")) {
      syncWorldEntrySheetFormToEntryElements();
      renderWorldEntrySheet("正在联网搜索，请稍候...");
      onEntryOnlineSearch()
        .catch(() => {
          setEntryFeedback("联网搜索失败，请稍后再试。");
        })
        .finally(() => {
          if (sheetState.type === "world-entry") {
            renderWorldEntrySheet(elements.entryFeedback?.textContent || "");
          }
        });
      return;
    }

    if (target.closest("#sheet-world-entry-add-btn")) {
      syncWorldEntrySheetFormToEntryElements();
      const added = await addEntryBook().catch(() => {
        setEntryFeedback("录入失败，请稍后重试。");
        return false;
      });
      renderWorldEntrySheet(
        added
          ? elements.entryFeedback?.textContent || "录入成功。"
          : elements.entryFeedback?.textContent || "录入失败，请检查输入。"
      );
      return;
    }

    if (target.closest("#sheet-world-panel-attrs-btn")) {
      onPanelAttributesMore();
      return;
    }

    if (target.closest("#sheet-world-panel-skills-btn")) {
      onPanelSkillsMore();
      return;
    }

    if (target.closest("#sheet-world-panel-achievements-btn")) {
      onPanelAchievementsMore();
      return;
    }

    const worldSkillButton = target.closest(".sheet-world-skill-info");
    if (worldSkillButton instanceof HTMLButtonElement) {
      const skillId = worldSkillButton.dataset.skillId;
      if (!skillId) return;
      const rule = getSkillRuleById(skillId);
      if (!rule) return;
      const unlocked = state.stats.skills.some((item) => item.id === skillId);
      openSheet("技能星详情", buildSkillDetailHtml(rule, unlocked));
      return;
    }

    if (target.closest("#sheet-world-settings-bgm-toggle-btn")) {
      const audio = getAudioProfile();
      const nextValue = !audio.bgmEnabled;
      updateAudioSetting({ bgmEnabled: nextValue });
      renderWorldSettingsSheet(nextValue ? "背景音乐已开启。" : "背景音乐已关闭。");
      spawnGameToast(nextValue ? "背景音乐开启" : "背景音乐关闭", "info", elements.sheetContent);
      return;
    }

    if (target.closest("#sheet-world-settings-sfx-toggle-btn")) {
      const audio = getAudioProfile();
      const nextValue = !audio.sfxEnabled;
      updateAudioSetting({ sfxEnabled: nextValue });
      renderWorldSettingsSheet(nextValue ? "提示音已开启。" : "提示音已关闭。");
      spawnGameToast(nextValue ? "提示音开启" : "提示音关闭", "info", elements.sheetContent);
      return;
    }

    if (target.closest("#sheet-world-settings-export-btn")) {
      try {
        exportData();
        renderWorldSettingsSheet("导出成功。备份文件已生成。");
      } catch {
        renderWorldSettingsSheet("导出失败，请稍后重试。");
      }
      return;
    }

    if (target.closest("#sheet-world-settings-import-btn")) {
      elements.settingsImportFile?.click();
      return;
    }

    if (target.closest("#sheet-world-settings-reset-btn")) {
      resetData();
      renderWorldSettingsSheet(elements.settingsFeedback?.textContent || "数据已重置。");
      return;
    }

    if (target.closest("#sheet-world-settings-privacy-btn")) {
      openPrivacyDialog();
      return;
    }

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

    const savePagesButton = target.closest("#sheet-book-pages-save-btn");
    if (savePagesButton instanceof HTMLButtonElement) {
      handleBookTotalPagesSave(savePagesButton.dataset.bookUid || sheetState.bookUid);
      return;
    }

    if (target.closest("#sheet-book-pages-cancel-btn")) {
      onPanelShelfMore({ skipHistory: true });
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

    if (target.closest("#sheet-share-copy-invite-btn")) {
      onCopyInvite().catch(() => setShareFeedback("复制失败，请稍后重试。"));
      return;
    }

    if (target.closest("#sheet-share-copy-btn")) {
      onCopyShare().catch(() => setShareFeedback("复制失败，请稍后重试。"));
      return;
    }

    const editPagesButton = target.closest(".sheet-edit-book-pages");
    if (editPagesButton instanceof HTMLButtonElement) {
      const uidValue = editPagesButton.dataset.bookUid;
      if (!uidValue) return;
      openBookPagesEditorSheet(uidValue);
      return;
    }

    const filterButton = target.closest(".bookshelf-filter-btn");
    if (filterButton instanceof HTMLButtonElement) {
      const nextFilter = normalizeShelfFilter(filterButton.dataset.shelfFilter || "all");
      sheetState.shelfFilter = nextFilter;
      sheetState.shelfPage = 1;
      onPanelShelfMore({ skipHistory: true });
      return;
    }

    const pageButton = target.closest(".bookshelf-page-btn");
    if (pageButton instanceof HTMLButtonElement) {
      const action = pageButton.dataset.shelfPageAction;
      if (action === "prev") {
        sheetState.shelfPage = Math.max(1, Number(sheetState.shelfPage) - 1 || 1);
      } else if (action === "next") {
        sheetState.shelfPage = Math.max(1, Number(sheetState.shelfPage) + 1 || 1);
      }
      onPanelShelfMore({ skipHistory: true });
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
    pulseSelectionAffordance();
    spawnGameToast("已选中目标书籍", "info", button);
    if (sheetState.type === "search" || sheetState.type === "world-entry") {
      openWorldEntrySheet("书籍已选择，准备录入。");
      return;
    }
    closeSheet();
  });

  elements.sheetContent?.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === "sheet-world-entry-search-input") {
      const caret = typeof target.selectionStart === "number" ? target.selectionStart : target.value.length;
      entrySearchQuery = target.value || "";
      if (elements.entrySearchInput) {
        elements.entrySearchInput.value = entrySearchQuery;
      }
      const switchedMode = entryMode !== "catalog";
      if (entryMode !== "catalog") {
        entryMode = "catalog";
      }
      selectedCatalogKey = "";
      if (switchedMode) {
        renderWorldEntrySheet();
        const nextInput = elements.sheetContent?.querySelector("#sheet-world-entry-search-input");
        if (nextInput instanceof HTMLInputElement) {
          nextInput.focus({ preventScroll: true });
          const nextCaret = Math.max(0, Math.min(caret, nextInput.value.length));
          nextInput.setSelectionRange(nextCaret, nextCaret);
        }
      } else {
        refreshWorldEntrySheetSearchSection();
      }
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "sheet-share-nickname-input") {
      state.profile.nickname = target.value.trim() || "旅者001";
      persist();
      renderShare();
      const payload = getSharePayload();
      const sheetName = elements.sheetContent?.querySelector("#sheet-share-card h3");
      if (sheetName instanceof HTMLElement) {
        sheetName.textContent = payload.nickname;
      }
      return;
    }
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
initWorldEngine();
exposeWorldTestingHooks();
initHeaderLottie().catch(() => {});
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
