import { ATTRIBUTE_KEYS, PRESET_BOOKS } from "./constants.mjs";

export const STORAGE_KEY = "readers-journey-state-v1";

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
    createdAt: Date.now() - index * 1000
  }));
}

export function createInitialState() {
  return {
    profile: {
      nickname: "旅者001",
      inviteCode: "RJ-2026"
    },
    dayStamp: getTodayStamp(),
    todayEntries: 0,
    books: buildInitialBooks(),
    stats: {
      level: 1,
      exp: 0,
      attributes: buildBaseAttributes(),
      skills: [],
      achievements: []
    },
    feed: [
      "欢迎来到读者之旅：先录入一本书，再去进度页体验即时反馈。"
    ]
  };
}

function normalizeBooks(books) {
  return books.map((book, index) => ({
    status: "planned",
    progress: 0,
    progressPages: 0,
    category: "general",
    pages: 300,
    uid: `book-${Date.now()}-${index + 1}`,
    createdAt: Date.now(),
    ...book
  }));
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

  state.profile = {
    ...initial.profile,
    ...(rawState.profile || {})
  };
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
  state.feed = Array.isArray(rawState.feed) ? rawState.feed : [...initial.feed];

  return rotateDayIfNeeded(state);
}

export function rotateDayIfNeeded(state) {
  const today = getTodayStamp();
  if (state.dayStamp !== today) {
    state.dayStamp = today;
    state.todayEntries = 0;
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
