import {
  ACHIEVEMENT_RULES_TABLE,
  CATEGORY_PROFILES_TABLE,
  REWARD_POLICIES,
  SKILL_RULES_TABLE
} from "./tables/rules.mjs";
import { STARTER_BOOKS } from "./tables/starter-books.mjs";

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

export const CATEGORY_PROFILES = CATEGORY_PROFILES_TABLE;
export const PRESET_BOOKS = STARTER_BOOKS;
export const REWARD_POLICY = REWARD_POLICIES;

export const SKILL_RULES = SKILL_RULES_TABLE.map((rule) => {
  const normalized = {
    id: rule.id,
    name: rule.name,
    description: rule.description
  };
  if (rule.condition?.type === "category_count") {
    normalized.category = rule.condition.category;
    normalized.count = rule.condition.count;
  }
  if (rule.condition?.type === "special_title_any") {
    normalized.specialTitles = Array.isArray(rule.condition.titles) ? rule.condition.titles : [];
    normalized.specialTitle = normalized.specialTitles[0] || "";
  }
  return normalized;
});

export const ACHIEVEMENT_RULES = ACHIEVEMENT_RULES_TABLE;
