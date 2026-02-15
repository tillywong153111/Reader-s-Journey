import {
  ACHIEVEMENT_RULES,
  ATTRIBUTE_KEYS,
  CATEGORY_PROFILES,
  REWARD_POLICY,
  SKILL_RULES
} from "./constants.mjs";

export function clamp(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function getHistoricalWeight(index) {
  for (const item of REWARD_POLICY.entry.historical_weights) {
    if (item.max_inclusive === null || index <= item.max_inclusive) {
      return item.weight;
    }
  }
  return 1;
}

export function getDailyEntryWeight(index) {
  for (const item of REWARD_POLICY.entry.daily_weights) {
    if (item.max_inclusive === null || index <= item.max_inclusive) {
      return item.weight;
    }
  }
  return 1;
}

export function calculateEntryReward({ historyIndex, dailyIndex, isNew }) {
  const historicalWeight = getHistoricalWeight(historyIndex);
  const dailyWeight = getDailyEntryWeight(dailyIndex);
  const freshMultiplier = isNew ? REWARD_POLICY.entry.new_book_multiplier : 1;
  const points = Math.max(
    1,
    Math.round(REWARD_POLICY.entry.base_points * historicalWeight * dailyWeight * freshMultiplier)
  );

  return {
    points,
    historicalWeight,
    dailyWeight,
    freshMultiplier
  };
}

export function calculateGrowthBase(bookCountAfterFinish) {
  for (const item of REWARD_POLICY.growth.book_count_curves) {
    if (item.max_inclusive === null || bookCountAfterFinish <= item.max_inclusive) {
      return item.base_gain;
    }
  }
  return REWARD_POLICY.growth.book_count_curves[0].base_gain;
}

export function requiredExpForLevel(level) {
  return Math.floor(REWARD_POLICY.level.base * Math.pow(level, REWARD_POLICY.level.power));
}

export function applyExpGain(level, currentExp, gainExp) {
  let nextLevel = level;
  let expPool = currentExp + gainExp;
  let threshold = requiredExpForLevel(nextLevel);
  let levelUps = 0;

  while (expPool >= threshold) {
    expPool -= threshold;
    nextLevel += 1;
    levelUps += 1;
    threshold = requiredExpForLevel(nextLevel);
  }

  return {
    level: nextLevel,
    exp: expPool,
    nextLevelExp: threshold,
    levelUps
  };
}

export function distributeAttributeGain(category, baseGain) {
  const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES.general;
  const gains = {};

  ATTRIBUTE_KEYS.forEach((key) => {
    gains[key] = Math.max(1, Math.round((profile[key] * baseGain) / 5));
  });

  return gains;
}

export function evaluateSkillUnlocks({
  categoryCounts,
  finishedTitles,
  attributes = {},
  completedCount = 0,
  existingSkills = []
}) {
  const unlocked = [];
  const normalizedFinishedTitles = (finishedTitles || []).map((title) =>
    String(title || "").toLowerCase().trim()
  );
  const unlockedSet = new Set(existingSkills.map((skill) => skill.id));

  function isConditionMet(rule) {
    if (rule.conditionType === "special_title_any" || rule.specialTitle || (rule.specialTitles && rule.specialTitles.length > 0)) {
      const titles = rule.specialTitles && rule.specialTitles.length > 0
        ? rule.specialTitles
        : [rule.specialTitle];
      return titles.some((title) =>
        normalizedFinishedTitles.includes(String(title || "").toLowerCase().trim())
      );
    }

    if (rule.conditionType === "category_count") {
      const count = categoryCounts[rule.category] || 0;
      return count >= rule.count;
    }

    if (rule.conditionType === "attribute_threshold") {
      const current = Number(attributes[rule.attribute] || 0);
      return current >= Number(rule.value || 0);
    }

    if (rule.conditionType === "completed_count") {
      return completedCount >= Number(rule.count || 0);
    }

    return false;
  }

  let progress = true;
  while (progress) {
    progress = false;
    for (const rule of SKILL_RULES) {
      if (unlockedSet.has(rule.id)) continue;
      const requires = Array.isArray(rule.requires) ? rule.requires : [];
      const requiresMet = requires.every((requiredId) => unlockedSet.has(requiredId));
      if (!requiresMet) continue;
      if (!isConditionMet(rule)) continue;
      unlocked.push({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        path: rule.path || "general",
        tier: Math.max(1, Number(rule.tier) || 1)
      });
      unlockedSet.add(rule.id);
      progress = true;
    }
  }

  return unlocked;
}

export function evaluateAchievements(completedCount, existingAchievements = []) {
  const unlocked = [];
  const existing = new Set(existingAchievements.map((item) => item.name));

  for (const rule of ACHIEVEMENT_RULES) {
    if (completedCount >= rule.threshold && !existing.has(rule.name)) {
      unlocked.push(rule);
    }
  }

  return unlocked;
}

export function applyProgressReward({
  stats,
  book,
  previousProgress,
  nextProgress,
  completedCount,
  categoryCounts,
  finishedTitles
}) {
  const safePrev = clamp(previousProgress, 0, 100);
  const safeNext = clamp(nextProgress, 0, 100);
  const delta = Math.max(0, safeNext - safePrev);
  const finishedNow = safePrev < 100 && safeNext === 100;
  const completedAfterFinish = completedCount + (finishedNow ? 1 : 0);
  const growthBase = finishedNow ? calculateGrowthBase(completedAfterFinish) : 0;
  const progressBase = Math.max(1, Math.round(delta / 10));
  const baseGain = progressBase + (finishedNow ? Math.ceil(growthBase / 5) : 0);
  const attributeGain = distributeAttributeGain(book.category, baseGain);
  const expGain = Math.round(delta) + (finishedNow ? REWARD_POLICY.level.finish_bonus_exp : 0);

  const updatedAttributes = { ...stats.attributes };
  for (const key of ATTRIBUTE_KEYS) {
    updatedAttributes[key] += attributeGain[key];
  }

  const expResult = applyExpGain(stats.level, stats.exp, expGain);
  const newCategoryCounts = { ...categoryCounts };

  if (finishedNow) {
    newCategoryCounts[book.category] = (newCategoryCounts[book.category] || 0) + 1;
  }

  const newTitles = finishedNow ? [...finishedTitles, book.title] : [...finishedTitles];
  const newlyUnlockedSkills = evaluateSkillUnlocks({
    categoryCounts: newCategoryCounts,
    finishedTitles: newTitles,
    attributes: updatedAttributes,
    completedCount: completedAfterFinish,
    existingSkills: stats.skills
  });
  const allSkills = [...stats.skills, ...newlyUnlockedSkills];
  const newlyUnlockedAchievements = evaluateAchievements(completedAfterFinish, stats.achievements);
  const allAchievements = [...stats.achievements, ...newlyUnlockedAchievements];

  return {
    updatedStats: {
      ...stats,
      level: expResult.level,
      exp: expResult.exp,
      attributes: updatedAttributes,
      skills: allSkills,
      achievements: allAchievements
    },
    reward: {
      delta,
      expGain,
      levelUps: expResult.levelUps,
      finishedNow,
      growthBase,
      attributeGain,
      unlockedSkills: newlyUnlockedSkills,
      unlockedAchievements: newlyUnlockedAchievements
    }
  };
}
