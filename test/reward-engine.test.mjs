import test from "node:test";
import assert from "node:assert/strict";

import {
  applyExpGain,
  applyProgressReward,
  calculateEntryReward,
  calculateGrowthBase,
  evaluateAchievements,
  evaluateSkillUnlocks,
  getDailyEntryWeight,
  getHistoricalWeight,
  requiredExpForLevel
} from "../src/lib/reward-engine.mjs";

test("historical weight follows PRD thresholds", () => {
  assert.equal(getHistoricalWeight(1), 1);
  assert.equal(getHistoricalWeight(10), 1);
  assert.equal(getHistoricalWeight(11), 0.7);
  assert.equal(getHistoricalWeight(50), 0.7);
  assert.equal(getHistoricalWeight(51), 0.3);
});

test("daily entry weight follows soft rhythm rule", () => {
  assert.equal(getDailyEntryWeight(1), 1);
  assert.equal(getDailyEntryWeight(2), 0.8);
  assert.equal(getDailyEntryWeight(3), 0.5);
  assert.equal(getDailyEntryWeight(9), 0.5);
});

test("entry reward applies new book multiplier", () => {
  const fresh = calculateEntryReward({ historyIndex: 1, dailyIndex: 1, isNew: true });
  const old = calculateEntryReward({ historyIndex: 1, dailyIndex: 1, isNew: false });
  assert.equal(fresh.points > old.points, true);
});

test("growth base follows staged curve", () => {
  assert.equal(calculateGrowthBase(1), 10);
  assert.equal(calculateGrowthBase(50), 10);
  assert.equal(calculateGrowthBase(51), 6);
  assert.equal(calculateGrowthBase(100), 6);
  assert.equal(calculateGrowthBase(101), 3);
});

test("level curve scales with level", () => {
  assert.equal(requiredExpForLevel(1), 100);
  assert.equal(requiredExpForLevel(5) > requiredExpForLevel(2), true);
});

test("exp gain can level up multiple times", () => {
  const leveled = applyExpGain(1, 95, 220);
  assert.equal(leveled.level > 1, true);
  assert.equal(leveled.exp >= 0, true);
});

test("skill unlock handles category and special title", () => {
  const unlocked = evaluateSkillUnlocks({
    categoryCounts: {
      logic: 3,
      psychology: 0,
      strategy: 0
    },
    finishedTitles: ["君主论"],
    existingSkills: []
  });
  assert.equal(unlocked.some((item) => item.id === "critical-thinking"), true);
  assert.equal(unlocked.some((item) => item.id === "machiavellian"), true);
});

test("achievement unlock checks thresholds", () => {
  const unlocked = evaluateAchievements(50, []);
  assert.equal(unlocked.some((item) => item.threshold === 10), true);
  assert.equal(unlocked.some((item) => item.threshold === 50), true);
});

test("progress reward updates stats and marks completion", () => {
  const result = applyProgressReward({
    stats: {
      level: 1,
      exp: 0,
      attributes: {
        logic: 30,
        insight: 30,
        expression: 30,
        strategy: 30,
        will: 30,
        creativity: 30
      },
      skills: [],
      achievements: []
    },
    book: {
      title: "测试书",
      category: "logic"
    },
    previousProgress: 80,
    nextProgress: 100,
    completedCount: 2,
    categoryCounts: {
      logic: 2
    },
    finishedTitles: ["A", "B"]
  });

  assert.equal(result.reward.finishedNow, true);
  assert.equal(result.reward.expGain >= 45, true);
  assert.equal(result.updatedStats.attributes.logic > 30, true);
  assert.equal(result.updatedStats.skills.some((item) => item.id === "critical-thinking"), true);
});
