import {
  ACHIEVEMENT_RULES,
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  CATEGORY_LABELS,
  PRESET_BOOKS,
  SKILL_RULES
} from "./lib/constants.mjs";
import {
  applyExpGain,
  applyProgressReward,
  calculateEntryReward,
  distributeAttributeGain,
  requiredExpForLevel
} from "./lib/reward-engine.mjs";
import {
  getCategoryCounts,
  getCompletedBooks,
  loadState,
  rotateDayIfNeeded,
  saveState
} from "./lib/state.mjs";

const state = rotateDayIfNeeded(loadState());
let selectedProgressUid = null;
let latestProgressRewardHtml = "";

const elements = {
  entrySearchInput: document.getElementById("entry-search-input"),
  entryIsbnInput: document.getElementById("entry-isbn-input"),
  entryManualInput: document.getElementById("entry-manual-input"),
  entryNextBtn: document.getElementById("entry-next-btn"),
  entryFeedback: document.getElementById("entry-feedback"),
  historyList: document.getElementById("history-list"),
  progressTitle: document.getElementById("progress-title"),
  progressAuthor: document.getElementById("progress-author"),
  progressRange: document.getElementById("progress-range"),
  progressFill: document.getElementById("progress-fill"),
  progressPercent: document.getElementById("progress-percent"),
  progressPage: document.getElementById("progress-page"),
  progressUpdateBtn: document.getElementById("progress-update-btn"),
  rewardGrid: document.getElementById("reward-grid"),
  progressSkills: document.getElementById("progress-skills"),
  panelNickname: document.getElementById("panel-nickname"),
  panelLevelLine: document.getElementById("panel-level-line"),
  statList: document.getElementById("stat-list"),
  panelSkills: document.getElementById("panel-skills"),
  recommendTitle: document.getElementById("recommend-title"),
  recommendAuthor: document.getElementById("recommend-author"),
  recommendReward: document.getElementById("recommend-reward"),
  recommendBuyBtn: document.getElementById("recommend-buy-btn"),
  buyDangdangBtn: document.getElementById("buy-dangdang-btn"),
  buyJdBtn: document.getElementById("buy-jd-btn"),
  planList: document.getElementById("plan-list"),
  planSkills: document.getElementById("plan-skills"),
  shareSummary: document.getElementById("share-summary"),
  shareAttributes: document.getElementById("share-attributes"),
  achievementGrid: document.getElementById("achievement-grid"),
  inviteCode: document.getElementById("invite-code"),
  copyInviteBtn: document.getElementById("copy-invite-btn"),
  shareBtn: document.getElementById("share-btn"),
  shareFeedback: document.getElementById("share-feedback")
};

function persist() {
  saveState(state);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function uid() {
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function inferCategory(rawText) {
  const text = rawText.toLowerCase();
  if (text.includes("逻辑") || text.includes("logic")) return "logic";
  if (text.includes("心理") || text.includes("psych")) return "psychology";
  if (text.includes("战略") || text.includes("策略") || text.includes("strategy")) return "strategy";
  if (text.includes("文学") || text.includes("小说") || text.includes("literature")) return "literature";
  if (text.includes("创造") || text.includes("写作") || text.includes("creative")) return "creativity";
  if (text.includes("哲学") || text.includes("philosophy")) return "philosophy";
  return "general";
}

function inferPages(rawText) {
  const matched = rawText.match(/(\d{2,5})\s*页/);
  if (!matched) {
    return 320;
  }
  return Math.max(60, Math.min(3000, Number(matched[1])));
}

function parseTitleAndAuthor(rawInput) {
  const input = rawInput.trim();
  if (!input) {
    return null;
  }

  const separators = [" / ", "/", "|", "｜", " by ", " BY "];
  for (const separator of separators) {
    if (input.includes(separator)) {
      const [title, author] = input.split(separator);
      if (title.trim()) {
        return {
          title: title.trim(),
          author: (author || "未知作者").trim()
        };
      }
    }
  }

  return {
    title: input,
    author: "未知作者"
  };
}

function createBook({ title, author, isbn, manual }) {
  return {
    uid: uid(),
    id: uid(),
    title,
    author,
    isbn: isbn || "",
    pages: inferPages(manual),
    category: inferCategory(`${title} ${author} ${manual}`),
    status: "planned",
    progress: 0,
    progressPages: 0,
    buyLink: "https://union-click.jd.com/jdc?e=reader-journey-manual",
    createdAt: Date.now()
  };
}

function getOpenBooks() {
  return state.books.filter((book) => book.status !== "finished");
}

function ensureSelectedProgressBook() {
  const openBooks = getOpenBooks();
  if (openBooks.length === 0) {
    selectedProgressUid = null;
    return null;
  }

  const selected = openBooks.find((book) => book.uid === selectedProgressUid);
  if (selected) {
    return selected;
  }
  selectedProgressUid = openBooks[0].uid;
  return openBooks[0];
}

function buildRewardItem(title, value) {
  return `<div class="reward-item"><div>${escapeHtml(title)}</div><strong>${escapeHtml(value)}</strong></div>`;
}

function showEntryFeedback(text) {
  if (!elements.entryFeedback) {
    return;
  }
  elements.entryFeedback.textContent = text;
}

function showShareFeedback(text) {
  if (!elements.shareFeedback) {
    return;
  }
  elements.shareFeedback.textContent = text;
}

function renderHistory() {
  if (!elements.historyList) {
    return;
  }

  const list = state.books.slice(0, 6);
  if (list.length === 0) {
    elements.historyList.innerHTML = '<div class="entry-item"><div><strong>暂无书籍</strong><div>请先录入一本</div></div><span>待开始</span></div>';
    return;
  }

  elements.historyList.innerHTML = list
    .map((book) => {
      const status =
        book.status === "finished"
          ? "已完成"
          : book.status === "reading"
            ? `进行中 ${book.progress}%`
            : "已导入";
      return `
        <div class="entry-item">
          <div>
            <strong>${escapeHtml(book.title)}</strong>
            <div>${escapeHtml(book.author)}</div>
          </div>
          <span>${escapeHtml(status)}</span>
        </div>
      `;
    })
    .join("");
}

function renderProgressPreview(book, percent) {
  if (
    !elements.progressFill ||
    !elements.progressPercent ||
    !elements.progressPage ||
    !elements.rewardGrid
  ) {
    return;
  }

  const delta = Math.max(0, percent - book.progress);
  const base = Math.max(1, Math.round(delta / 15));
  const gains = distributeAttributeGain(book.category, base);
  const top = Object.entries(gains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  elements.progressFill.style.width = `${percent}%`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressPage.textContent = String(Math.round((book.pages * percent) / 100));
  elements.rewardGrid.innerHTML = [
    buildRewardItem("预计经验", `+${Math.round(delta)}`),
    buildRewardItem(ATTRIBUTE_LABELS[top[0][0]], `+${top[0][1]}`),
    buildRewardItem(ATTRIBUTE_LABELS[top[1][0]], `+${top[1][1]}`)
  ].join("");
}

function renderProgressSection() {
  const book = ensureSelectedProgressBook();
  if (!book) {
    latestProgressRewardHtml = "";
    if (elements.progressTitle) elements.progressTitle.textContent = "暂无可更新书籍";
    if (elements.progressAuthor) elements.progressAuthor.textContent = "先去录入页添加一本书";
    if (elements.progressRange) {
      elements.progressRange.value = "0";
      elements.progressRange.disabled = true;
    }
    if (elements.progressUpdateBtn) elements.progressUpdateBtn.disabled = true;
    if (elements.rewardGrid) {
      elements.rewardGrid.innerHTML = [
        buildRewardItem("状态", "等待录入"),
        buildRewardItem("建议", "先添加书籍"),
        buildRewardItem("奖励", "--")
      ].join("");
    }
    return;
  }

  if (elements.progressTitle) elements.progressTitle.textContent = book.title;
  if (elements.progressAuthor) {
    elements.progressAuthor.textContent = `${book.author} · ${CATEGORY_LABELS[book.category] || "通识"}`;
  }
  if (elements.progressRange) {
    elements.progressRange.disabled = false;
    elements.progressRange.value = String(book.progress);
  }
  if (elements.progressUpdateBtn) elements.progressUpdateBtn.disabled = false;
  if (latestProgressRewardHtml && elements.rewardGrid) {
    elements.rewardGrid.innerHTML = latestProgressRewardHtml;
  } else {
    renderProgressPreview(book, book.progress);
  }
}

function renderProgressSkills() {
  if (!elements.progressSkills || !elements.panelSkills || !elements.planSkills) {
    return;
  }

  const unlocked = new Set(state.stats.skills.map((skill) => skill.id));
  const createSkill = (name, active) =>
    `<span class="skill-pill${active ? " active" : " muted"}">${escapeHtml(name)}</span>`;

  elements.progressSkills.innerHTML = SKILL_RULES.slice(0, 3)
    .map((rule) => createSkill(rule.name, unlocked.has(rule.id)))
    .join("");

  elements.panelSkills.innerHTML = SKILL_RULES.map((rule) =>
    createSkill(rule.name, unlocked.has(rule.id))
  ).join("");

  elements.planSkills.innerHTML = SKILL_RULES.slice(1, 4)
    .map((rule) => createSkill(rule.name, !unlocked.has(rule.id)))
    .join("");
}

function renderPanel() {
  if (!elements.statList || !elements.panelNickname || !elements.panelLevelLine) {
    return;
  }

  const nickname = state.profile.nickname || "旅者001";
  const needed = requiredExpForLevel(state.stats.level);
  elements.panelNickname.textContent = `昵称：${nickname}`;
  elements.panelLevelLine.textContent = `Lv. ${state.stats.level} · 经验值 ${state.stats.exp}/${needed}`;

  const maxValue = Math.max(60, ...ATTRIBUTE_KEYS.map((key) => state.stats.attributes[key] || 0));
  elements.statList.innerHTML = ATTRIBUTE_KEYS.map((key) => {
    const value = state.stats.attributes[key] || 0;
    const pct = Math.max(4, Math.round((value / maxValue) * 100));
    return `
      <div class="stat-item">
        <header>
          <span>${ATTRIBUTE_LABELS[key]}</span>
          <strong>${value}</strong>
        </header>
        <div class="stat-bar"><span style="width: ${pct}%"></span></div>
      </div>
    `;
  }).join("");
}

function getRecommendationBooks() {
  const unfinished = state.books.filter((book) => book.status !== "finished");
  const picks = [...unfinished];

  for (const preset of PRESET_BOOKS) {
    if (picks.length >= 3) {
      break;
    }
    const exists = picks.some((book) => book.title === preset.title);
    if (!exists) {
      picks.push({
        ...preset,
        uid: uid(),
        status: "planned",
        progress: 0,
        progressPages: 0
      });
    }
  }

  return picks.slice(0, 3);
}

function renderRecommendation() {
  if (
    !elements.recommendTitle ||
    !elements.recommendAuthor ||
    !elements.recommendReward ||
    !elements.planList ||
    !elements.recommendBuyBtn
  ) {
    return;
  }

  const picks = getRecommendationBooks();
  const top = picks[0];

  if (top) {
    const gains = distributeAttributeGain(top.category, 4);
    const total = Object.values(gains).reduce((sum, item) => sum + item, 0);
    elements.recommendTitle.textContent = top.title;
    elements.recommendAuthor.textContent = top.author;
    elements.recommendReward.textContent = `完成后预计 +${total} 属性，约 +100 经验`;
    elements.recommendBuyBtn.dataset.link = top.buyLink || "https://union-click.jd.com";
    if (elements.buyDangdangBtn) elements.buyDangdangBtn.dataset.link = top.buyLink || "";
    if (elements.buyJdBtn) elements.buyJdBtn.dataset.link = top.buyLink || "";
  }

  elements.planList.innerHTML = picks
    .map((book) => {
      const gains = distributeAttributeGain(book.category, 4);
      const total = Object.values(gains).reduce((sum, item) => sum + item, 0);
      return `
        <div class="plan-item">
          <strong>${escapeHtml(book.title)}</strong>
          <span>${escapeHtml(book.author)}</span>
          <span>预计 +${total} 属性</span>
        </div>
      `;
    })
    .join("");
}

function renderShare() {
  if (
    !elements.shareSummary ||
    !elements.shareAttributes ||
    !elements.achievementGrid ||
    !elements.inviteCode
  ) {
    return;
  }

  const nickname = state.profile.nickname || "旅者001";
  const completed = getCompletedBooks(state).length;
  elements.shareSummary.textContent = `昵称：${nickname} · Lv. ${state.stats.level} · 完成 ${completed} 本`;
  elements.inviteCode.textContent = `邀请码 ${state.profile.inviteCode || "RJ-2026"}`;

  elements.shareAttributes.innerHTML = ATTRIBUTE_KEYS.map((key) => {
    const value = state.stats.attributes[key] || 0;
    return `
      <div class="attribute-item">
        <span>${ATTRIBUTE_LABELS[key]}</span>
        <strong>${value}</strong>
      </div>
    `;
  }).join("");

  const unlocked = new Set((state.stats.achievements || []).map((item) => item.name));
  elements.achievementGrid.innerHTML = ACHIEVEMENT_RULES.map((item) => {
    const isUnlocked = unlocked.has(item.name);
    return `
      <div class="achievement-item${isUnlocked ? " unlocked" : " locked"}">
        <strong>${item.threshold} 本</strong>
        <div>${item.name}</div>
        <span>${item.title}</span>
      </div>
    `;
  }).join("");
}

function renderAll() {
  rotateDayIfNeeded(state);
  renderHistory();
  renderProgressSection();
  renderProgressSkills();
  renderPanel();
  renderRecommendation();
  renderShare();
}

function handleEntrySubmit() {
  if (!elements.entrySearchInput || !elements.entryManualInput || !elements.entryIsbnInput) {
    return;
  }

  const parsed = parseTitleAndAuthor(elements.entrySearchInput.value);
  if (!parsed) {
    showEntryFeedback("请先填写书名（可选：书名 / 作者）。");
    return;
  }

  const book = createBook({
    title: parsed.title,
    author: parsed.author,
    isbn: elements.entryIsbnInput.value.trim(),
    manual: elements.entryManualInput.value.trim()
  });

  const reward = calculateEntryReward({
    historyIndex: state.books.length + 1,
    dailyIndex: state.todayEntries + 1,
    isNew: true
  });
  state.todayEntries += 1;
  state.books.unshift(book);
  state.stats.attributes.will += reward.points;
  const expResult = applyExpGain(state.stats.level, state.stats.exp, reward.points);
  state.stats.level = expResult.level;
  state.stats.exp = expResult.exp;

  persist();
  renderAll();
  showEntryFeedback(`已录入《${book.title}》，意志力 +${reward.points}，经验 +${reward.points}。`);
  elements.entrySearchInput.value = "";
  elements.entryIsbnInput.value = "";
  elements.entryManualInput.value = "";
}

function handleProgressRangeInput() {
  const book = ensureSelectedProgressBook();
  if (!book || !elements.progressRange) {
    return;
  }
  latestProgressRewardHtml = "";
  const percent = Math.max(0, Math.min(100, Number(elements.progressRange.value) || 0));
  renderProgressPreview(book, percent);
}

function handleProgressUpdate() {
  const book = ensureSelectedProgressBook();
  if (!book || !elements.progressRange || !elements.rewardGrid) {
    return;
  }

  const nextProgress = Math.max(0, Math.min(100, Number(elements.progressRange.value) || 0));
  if (nextProgress <= book.progress) {
    latestProgressRewardHtml = [
      buildRewardItem("提示", "进度未变化"),
      buildRewardItem("当前进度", `${book.progress}%`),
      buildRewardItem("目标进度", `${nextProgress}%`)
    ].join("");
    elements.rewardGrid.innerHTML = latestProgressRewardHtml;
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
  if (nextProgress >= 100) {
    book.status = "finished";
  } else if (nextProgress > 0) {
    book.status = "reading";
  }

  const topAttrs = Object.entries(result.reward.attributeGain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  const rewardItems = [
    buildRewardItem("经验", `+${result.reward.expGain}`),
    buildRewardItem(ATTRIBUTE_LABELS[topAttrs[0][0]], `+${topAttrs[0][1]}`),
    buildRewardItem(ATTRIBUTE_LABELS[topAttrs[1][0]], `+${topAttrs[1][1]}`)
  ];

  if (result.reward.unlockedSkills.length > 0) {
    rewardItems.push(buildRewardItem("解锁技能", result.reward.unlockedSkills[0].name));
  } else if (result.reward.finishedNow) {
    rewardItems.push(buildRewardItem("完成状态", "本书已读完"));
  }
  latestProgressRewardHtml = rewardItems.join("");
  elements.rewardGrid.innerHTML = latestProgressRewardHtml;

  persist();
  renderAll();
}

function openBuyLink(link) {
  if (!link) {
    return;
  }
  window.open(link, "_blank", "noopener");
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

async function handleCopyInvite() {
  const code = state.profile.inviteCode || "RJ-2026";
  try {
    await copyText(code);
    showShareFeedback("邀请码已复制。");
  } catch {
    showShareFeedback(`复制失败，请手动复制：${code}`);
  }
}

async function handleShare() {
  const nickname = state.profile.nickname || "旅者001";
  const completed = getCompletedBooks(state).length;
  const sorted = [...ATTRIBUTE_KEYS].sort(
    (a, b) => (state.stats.attributes[b] || 0) - (state.stats.attributes[a] || 0)
  );
  const topKey = sorted[0];
  const text = `我是${nickname}，当前 Lv.${state.stats.level}，已完成 ${completed} 本，${ATTRIBUTE_LABELS[topKey]} ${state.stats.attributes[topKey]}。邀请码：${state.profile.inviteCode || "RJ-2026"}`;
  try {
    await copyText(text);
    showShareFeedback("分享文案已复制，可直接粘贴发送。");
  } catch {
    showShareFeedback(text);
  }
}

function bindEvents() {
  elements.entryNextBtn?.addEventListener("click", handleEntrySubmit);
  elements.progressRange?.addEventListener("input", handleProgressRangeInput);
  elements.progressUpdateBtn?.addEventListener("click", handleProgressUpdate);
  elements.recommendBuyBtn?.addEventListener("click", () =>
    openBuyLink(elements.recommendBuyBtn?.dataset.link || "")
  );
  elements.buyDangdangBtn?.addEventListener("click", () =>
    openBuyLink(elements.buyDangdangBtn?.dataset.link || "")
  );
  elements.buyJdBtn?.addEventListener("click", () =>
    openBuyLink(elements.buyJdBtn?.dataset.link || "")
  );
  elements.copyInviteBtn?.addEventListener("click", () => {
    handleCopyInvite().catch(() => showShareFeedback("复制失败，请稍后重试。"));
  });
  elements.shareBtn?.addEventListener("click", () => {
    handleShare().catch(() => showShareFeedback("分享文案生成失败，请稍后重试。"));
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

bindEvents();
renderAll();
registerServiceWorker();
