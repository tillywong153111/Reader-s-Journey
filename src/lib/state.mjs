import { ATTRIBUTE_KEYS, PRESET_BOOKS } from "./constants.mjs";

export const STORAGE_KEY = "readers-journey-state-v2";

function clampPercent(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function getTodayStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildBaseAttributes() {
  const attributes = {};
  for (const key of ATTRIBUTE_KEYS) {
    attributes[key] = 30;
  }
  return attributes;
}

function buildDefaultAudioSettings() {
  return {
    masterEnabled: true,
    bgmEnabled: true,
    sfxEnabled: true,
    bgmVolume: 46,
    sfxVolume: 76,
    bgmBootstrapped: false
  };
}

function normalizeReflections(reflections, progress = 0) {
  if (!Array.isArray(reflections)) {
    return [];
  }
  const output = [];
  for (let i = 0; i < reflections.length; i += 1) {
    const item = reflections[i];
    const text = String(item?.text || "").trim();
    if (!text) continue;
    const createdAt = Number(item?.createdAt || Date.now());
    const updatedAt = Number(item?.updatedAt || createdAt);
    output.push({
      id: String(item?.id || `reflection-${createdAt}-${i + 1}`),
      text: text.slice(0, 1000),
      createdAt,
      updatedAt,
      progressAt: clampPercent(item?.progressAt, progress)
    });
  }
  output.sort((a, b) => b.createdAt - a.createdAt);
  return output;
}

function buildInitialBooks() {
  const initial = [
    { ...PRESET_BOOKS[0], status: "reading", progress: 38 },
    { ...PRESET_BOOKS[1], status: "planned", progress: 0 },
    { ...PRESET_BOOKS[2], status: "planned", progress: 0 }
  ];

  return initial.map((book, index) => ({
    ...book,
    uid: `${book.id}-${index + 1}`,
    progressPages: Math.round((book.pages * book.progress) / 100),
    createdAt: Date.now() - index * 1000,
    updatedAt: Date.now() - index * 1000,
    reflections: []
  }));
}

export function createInitialState() {
  return {
    profile: {
      nickname: "旅者001",
      inviteCode: "RJ-2026",
      audio: buildDefaultAudioSettings()
    },
    dayStamp: getTodayStamp(),
    todayEntries: 0,
    todayReadPages: 0,
    appMeta: {
      schemaVersion: 4,
      catalogVersion: "",
      lastSavedAt: ""
    },
    books: buildInitialBooks(),
    stats: {
      level: 1,
      exp: 0,
      attributes: buildBaseAttributes(),
      skills: [],
      achievements: []
    },
    feed: [
      "欢迎来到读者之旅：先录入一本书，再在面板卷轴里更新进度与感触。"
    ]
  };
}

function normalizeBooks(books) {
  return books
    .map((book, index) => ({
      status: "planned",
      progress: 0,
      progressPages: 0,
      category: "general",
      pages: 300,
      uid: `book-${Date.now()}-${index + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reflections: [],
      ...book
    }))
    .map((book) => {
      const progress = clampPercent(book.progress, 0);
      const pages = Math.max(1, Number(book.pages) || 300);
      return {
        ...book,
        pages,
        progress,
        progressPages: Math.round((pages * progress) / 100),
        updatedAt: Number(book.updatedAt || book.createdAt || Date.now()),
        reflections: normalizeReflections(book.reflections, progress)
      };
    });
}

export function normalizeState(rawState) {
  const initial = createInitialState();
  if (!rawState || typeof rawState !== "object") {
    return initial;
  }

  const state = {
    ...initial,
    ...rawState
  };

  const rawProfile = rawState.profile || {};
  state.profile = {
    ...initial.profile,
    ...rawProfile
  };
  const legacySoundEnabled =
    typeof rawProfile.soundEnabled === "boolean" ? rawProfile.soundEnabled : null;
  const mergedAudio = {
    ...buildDefaultAudioSettings(),
    ...((rawProfile.audio && typeof rawProfile.audio === "object") ? rawProfile.audio : {})
  };
  if (legacySoundEnabled === false) {
    mergedAudio.masterEnabled = false;
    mergedAudio.bgmEnabled = false;
    mergedAudio.sfxEnabled = false;
  } else if (legacySoundEnabled === true && !(rawProfile.audio && typeof rawProfile.audio === "object")) {
    mergedAudio.masterEnabled = true;
    mergedAudio.bgmEnabled = true;
    mergedAudio.sfxEnabled = true;
  }
  state.profile.audio = {
    masterEnabled: mergedAudio.masterEnabled !== false,
    bgmEnabled: mergedAudio.bgmEnabled !== false,
    sfxEnabled: mergedAudio.sfxEnabled !== false,
    bgmVolume: clampPercent(mergedAudio.bgmVolume, 52),
    sfxVolume: clampPercent(mergedAudio.sfxVolume, 82),
    bgmBootstrapped: Boolean(mergedAudio.bgmBootstrapped)
  };
  delete state.profile.soundEnabled;
  state.appMeta = {
    ...initial.appMeta,
    ...(rawState.appMeta || {})
  };
  state.appMeta.schemaVersion = 4;
  state.stats = {
    ...initial.stats,
    ...(rawState.stats || {})
  };
  state.stats.attributes = {
    ...buildBaseAttributes(),
    ...((rawState.stats && rawState.stats.attributes) || {})
  };
  state.stats.skills = [...((rawState.stats && rawState.stats.skills) || [])];
  state.stats.achievements = [...((rawState.stats && rawState.stats.achievements) || [])];
  state.books = normalizeBooks(rawState.books || initial.books);
  state.todayReadPages = Math.max(0, Math.round(Number(rawState.todayReadPages) || 0));
  state.feed = Array.isArray(rawState.feed) ? rawState.feed : [...initial.feed];

  return rotateDayIfNeeded(state);
}

export function rotateDayIfNeeded(state) {
  const today = getTodayStamp();
  if (state.dayStamp !== today) {
    state.dayStamp = today;
    state.todayEntries = 0;
    state.todayReadPages = 0;
  }
  return state;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialState();
    }
    return normalizeState(JSON.parse(raw));
  } catch {
    return createInitialState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getCompletedBooks(state) {
  return state.books.filter((book) => book.status === "finished");
}

export function getCategoryCounts(state) {
  const counts = {};
  for (const book of getCompletedBooks(state)) {
    counts[book.category] = (counts[book.category] || 0) + 1;
  }
  return counts;
}
