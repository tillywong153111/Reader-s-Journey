import {
  ACHIEVEMENT_RULES,
  ATTRIBUTE_KEYS,
  CATEGORY_PROFILES,
  SKILL_RULES
} from "./constants.mjs";

export function clamp(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function getHistoricalWeight(index) {
  if (index <= 10) {
    return 1;
  }
  if (index <= 50) {
    return 0.7;
  }
  return 0.3;
}

export function getDailyEntryWeight(index) {
  if (index <= 1) {
    return 1;
  }
  if (index === 2) {
    return 0.8;
  }
  return 0.5;
}

export function calculateEntryReward({ historyIndex, dailyIndex, isNew }) {
  const historicalWeight = getHistoricalWeight(historyIndex);
  const dailyWeight = getDailyEntryWeight(dailyIndex);
  const freshMultiplier = isNew ? 1.5 : 1;
  const points = Math.max(1, Math.round(8 * historicalWeight * dailyWeight * freshMultiplier));

  return {
    points,
    historicalWeight,
    dailyWeight,
    freshMultiplier
  };
}

export function calculateGrowthBase(bookCountAfterFinish) {
  if (bookCountAfterFinish <= 50) {
    return 10;
  }
  if (bookCountAfterFinish <= 100) {
    return 6;
  }
  return 3;
}

export function requiredExpForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.25));
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
  existingSkills = []
}) {
  const unlocked = [];

  for (const rule of SKILL_RULES) {
    const alreadyUnlocked = existingSkills.some((skill) => skill.id === rule.id);
    if (alreadyUnlocked) {
      continue;
    }

    if (rule.specialTitle) {
      if (finishedTitles.includes(rule.specialTitle)) {
        unlocked.push({
          id: rule.id,
          name: rule.name,
          description: rule.description
        });
      }
      continue;
    }

    const count = categoryCounts[rule.category] || 0;
    if (count >= rule.count) {
      unlocked.push({
        id: rule.id,
        name: rule.name,
        description: rule.description
      });
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
  const expGain = Math.round(delta) + (finishedNow ? 25 : 0);

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
