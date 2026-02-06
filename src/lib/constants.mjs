export const ATTRIBUTE_KEYS = [
  "logic",
  "insight",
  "expression",
  "strategy",
  "will",
  "creativity"
];

export const ATTRIBUTE_LABELS = {
  logic: "逻辑力",
  insight: "洞察力",
  expression: "表达力",
  strategy: "战略力",
  will: "意志力",
  creativity: "创造力"
};

export const CATEGORY_LABELS = {
  logic: "逻辑",
  psychology: "心理学",
  strategy: "战略",
  literature: "文学",
  creativity: "创造",
  philosophy: "哲学",
  general: "通识"
};

export const CATEGORY_PROFILES = {
  logic: {
    logic: 4,
    insight: 2,
    expression: 1,
    strategy: 2,
    will: 1,
    creativity: 1
  },
  psychology: {
    logic: 1,
    insight: 4,
    expression: 2,
    strategy: 1,
    will: 2,
    creativity: 1
  },
  strategy: {
    logic: 2,
    insight: 1,
    expression: 1,
    strategy: 4,
    will: 2,
    creativity: 1
  },
  literature: {
    logic: 1,
    insight: 2,
    expression: 4,
    strategy: 1,
    will: 1,
    creativity: 3
  },
  creativity: {
    logic: 1,
    insight: 1,
    expression: 2,
    strategy: 1,
    will: 1,
    creativity: 4
  },
  philosophy: {
    logic: 2,
    insight: 3,
    expression: 2,
    strategy: 2,
    will: 2,
    creativity: 2
  },
  general: {
    logic: 2,
    insight: 2,
    expression: 2,
    strategy: 2,
    will: 2,
    creativity: 2
  }
};

export const SKILL_RULES = [
  {
    id: "critical-thinking",
    name: "批判性思维 Lv.1",
    description: "完成 3 本逻辑类书籍后解锁",
    category: "logic",
    count: 3
  },
  {
    id: "bias-detection",
    name: "认知偏差识别",
    description: "完成 5 本心理学书籍后解锁",
    category: "psychology",
    count: 5
  },
  {
    id: "game-theory",
    name: "博弈论应用",
    description: "完成 10 本战略类书籍后解锁",
    category: "strategy",
    count: 10
  },
  {
    id: "machiavellian",
    name: "权谋心法",
    description: "完成《君主论》后触发彩蛋技能",
    specialTitle: "君主论"
  }
];

export const ACHIEVEMENT_RULES = [
  { threshold: 10, name: "十书行者", title: "青铜读者" },
  { threshold: 50, name: "五十书者", title: "白银读者" },
  { threshold: 100, name: "百书战士", title: "黄金读者" },
  { threshold: 200, name: "二百书宗师", title: "传奇读者" }
];

export const PRESET_BOOKS = [
  {
    id: "preset-1",
    title: "思考，快与慢",
    author: "丹尼尔·卡尼曼",
    category: "psychology",
    pages: 424,
    isbn: "9787508633559",
    buyLink: "https://union-click.jd.com/jdc?e=reader-journey-thinking-fast-slow"
  },
  {
    id: "preset-2",
    title: "金字塔原理",
    author: "芭芭拉·明托",
    category: "logic",
    pages: 336,
    isbn: "9787508644449",
    buyLink: "https://union-click.jd.com/jdc?e=reader-journey-pyramid-principle"
  },
  {
    id: "preset-3",
    title: "原则",
    author: "瑞·达利欧",
    category: "strategy",
    pages: 576,
    isbn: "9787508684032",
    buyLink: "https://union-click.jd.com/jdc?e=reader-journey-principles"
  },
  {
    id: "preset-4",
    title: "君主论",
    author: "马基雅维利",
    category: "strategy",
    pages: 248,
    isbn: "9787108069970",
    buyLink: "https://union-click.jd.com/jdc?e=reader-journey-the-prince"
  },
  {
    id: "preset-5",
    title: "人类简史",
    author: "尤瓦尔·赫拉利",
    category: "philosophy",
    pages: 496,
    isbn: "9787508647358",
    buyLink: "https://union-click.jd.com/jdc?e=reader-journey-sapiens"
  },
  {
    id: "preset-6",
    title: "写作这回事",
    author: "斯蒂芬·金",
    category: "literature",
    pages: 352,
    isbn: "9787532793670",
    buyLink: "https://union-click.jd.com/jdc?e=reader-journey-on-writing"
  }
];
