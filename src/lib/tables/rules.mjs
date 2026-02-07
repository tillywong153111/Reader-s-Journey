export const CATEGORY_PROFILES_TABLE = {
  "logic": {
    "logic": 4,
    "insight": 2,
    "expression": 1,
    "strategy": 2,
    "will": 1,
    "creativity": 1
  },
  "psychology": {
    "logic": 1,
    "insight": 4,
    "expression": 2,
    "strategy": 1,
    "will": 2,
    "creativity": 1
  },
  "strategy": {
    "logic": 2,
    "insight": 1,
    "expression": 1,
    "strategy": 4,
    "will": 2,
    "creativity": 1
  },
  "literature": {
    "logic": 1,
    "insight": 2,
    "expression": 4,
    "strategy": 1,
    "will": 1,
    "creativity": 3
  },
  "creativity": {
    "logic": 1,
    "insight": 1,
    "expression": 2,
    "strategy": 1,
    "will": 1,
    "creativity": 4
  },
  "philosophy": {
    "logic": 2,
    "insight": 3,
    "expression": 2,
    "strategy": 2,
    "will": 2,
    "creativity": 2
  },
  "general": {
    "logic": 2,
    "insight": 2,
    "expression": 2,
    "strategy": 2,
    "will": 2,
    "creativity": 2
  }
};

export const REWARD_POLICIES = {
  "schema": "reward_policies.v1",
  "entry": {
    "base_points": 8,
    "new_book_multiplier": 1.5,
    "custom_entry_multiplier": 0.7,
    "historical_weights": [
      {
        "max_inclusive": 10,
        "weight": 1
      },
      {
        "max_inclusive": 50,
        "weight": 0.7
      },
      {
        "max_inclusive": null,
        "weight": 0.3
      }
    ],
    "daily_weights": [
      {
        "max_inclusive": 1,
        "weight": 1
      },
      {
        "max_inclusive": 2,
        "weight": 0.8
      },
      {
        "max_inclusive": null,
        "weight": 0.5
      }
    ]
  },
  "growth": {
    "book_count_curves": [
      {
        "max_inclusive": 50,
        "base_gain": 10
      },
      {
        "max_inclusive": 100,
        "base_gain": 6
      },
      {
        "max_inclusive": null,
        "base_gain": 3
      }
    ]
  },
  "level": {
    "base": 100,
    "power": 1.25,
    "finish_bonus_exp": 25
  }
};

export const SKILL_RULES_TABLE = [
  {
    "id": "critical-thinking",
    "name": "批判性思维 Lv.1",
    "description": "完成 3 本逻辑类书籍后解锁",
    "condition": {
      "type": "category_count",
      "category": "logic",
      "count": 3
    },
    "effect": {
      "logic": 5
    }
  },
  {
    "id": "bias-detection",
    "name": "认知偏差识别",
    "description": "完成 5 本心理学书籍后解锁",
    "condition": {
      "type": "category_count",
      "category": "psychology",
      "count": 5
    },
    "effect": {
      "insight": 5
    }
  },
  {
    "id": "game-theory",
    "name": "博弈论应用",
    "description": "完成 10 本战略类书籍后解锁",
    "condition": {
      "type": "category_count",
      "category": "strategy",
      "count": 10
    },
    "effect": {
      "strategy": 6
    }
  },
  {
    "id": "machiavellian",
    "name": "权谋心法",
    "description": "完成《君主论》或 The Prince 后触发彩蛋技能",
    "condition": {
      "type": "special_title_any",
      "titles": [
        "君主论",
        "The Prince"
      ]
    },
    "effect": {
      "strategy": 8,
      "insight": 4
    }
  }
];

export const ACHIEVEMENT_RULES_TABLE = [
  {
    "threshold": 10,
    "name": "十书行者",
    "title": "青铜读者"
  },
  {
    "threshold": 50,
    "name": "五十书者",
    "title": "白银读者"
  },
  {
    "threshold": 100,
    "name": "百书战士",
    "title": "黄金读者"
  },
  {
    "threshold": 200,
    "name": "二百书宗师",
    "title": "传奇读者"
  }
];
