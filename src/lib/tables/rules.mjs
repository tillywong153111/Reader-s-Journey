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
    "id": "insight-awakening",
    "name": "洞察",
    "path": "insight",
    "tier": 1,
    "description": "线索敏感度提升，能更快抓住关键信息。",
    "unlock_hint": "完成 2 本心理学书籍",
    "condition": {
      "type": "category_count",
      "category": "psychology",
      "count": 2
    },
    "effect": {
      "insight": 4
    }
  },
  {
    "id": "hawk-eye",
    "name": "火眼金睛",
    "path": "insight",
    "tier": 2,
    "requires": ["insight-awakening"],
    "description": "对信息噪声有更强辨别力，判断更稳定。",
    "unlock_hint": "前置：洞察；洞察力达到 85",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "insight",
      "value": 85
    },
    "effect": {
      "insight": 8,
      "logic": 3
    }
  },
  {
    "id": "micro-insight",
    "name": "明察秋毫",
    "path": "insight",
    "tier": 3,
    "requires": ["hawk-eye"],
    "description": "可从细节中识别模式，洞察层级进一步跃迁。",
    "unlock_hint": "前置：火眼金睛；洞察力达到 130",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "insight",
      "value": 130
    },
    "effect": {
      "insight": 12,
      "strategy": 4
    }
  },
  {
    "id": "pattern-foresight",
    "name": "模式预判",
    "path": "insight",
    "tier": 4,
    "requires": ["micro-insight"],
    "description": "从碎片信息中提炼模式，提前识别风险与机会。",
    "unlock_hint": "前置：明察秋毫；累计完成 10 本书",
    "condition": {
      "type": "completed_count",
      "count": 10
    },
    "effect": {
      "insight": 14,
      "strategy": 5
    }
  },
  {
    "id": "truth-gaze",
    "name": "真知凝视",
    "path": "insight",
    "tier": 5,
    "requires": ["pattern-foresight"],
    "description": "穿透表象直达核心矛盾，形成高维洞察能力。",
    "unlock_hint": "前置：模式预判；洞察力达到 210",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "insight",
      "value": 210
    },
    "effect": {
      "insight": 18,
      "logic": 6
    }
  },
  {
    "id": "will-steadfast",
    "name": "意志坚定",
    "path": "will",
    "tier": 1,
    "description": "面对困难时保持节奏，持续执行能力提升。",
    "unlock_hint": "累计完成 3 本书",
    "condition": {
      "type": "completed_count",
      "count": 3
    },
    "effect": {
      "will": 6
    }
  },
  {
    "id": "steel-will",
    "name": "钢铁意志",
    "path": "will",
    "tier": 2,
    "requires": ["will-steadfast"],
    "description": "长线任务中抗压能力显著增强。",
    "unlock_hint": "前置：意志坚定；意志力达到 120",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "will",
      "value": 120
    },
    "effect": {
      "will": 10,
      "strategy": 3
    }
  },
  {
    "id": "unyielding-heart",
    "name": "不屈心志",
    "path": "will",
    "tier": 3,
    "requires": ["steel-will"],
    "description": "遭遇波动也能稳态推进，形成自驱闭环。",
    "unlock_hint": "前置：钢铁意志；意志力达到 170",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "will",
      "value": 170
    },
    "effect": {
      "will": 14,
      "insight": 4
    }
  },
  {
    "id": "mind-fortress",
    "name": "心志壁垒",
    "path": "will",
    "tier": 4,
    "requires": ["unyielding-heart"],
    "description": "压力环境中维持长期投入，执行力不受波动干扰。",
    "unlock_hint": "前置：不屈心志；累计完成 12 本书",
    "condition": {
      "type": "completed_count",
      "count": 12
    },
    "effect": {
      "will": 16,
      "strategy": 4
    }
  },
  {
    "id": "titan-will",
    "name": "钢魂不灭",
    "path": "will",
    "tier": 5,
    "requires": ["mind-fortress"],
    "description": "形成长期主义心智，面对高压任务仍能稳定推进。",
    "unlock_hint": "前置：心志壁垒；意志力达到 220",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "will",
      "value": 220
    },
    "effect": {
      "will": 20,
      "insight": 5
    }
  },
  {
    "id": "critical-thinking",
    "name": "批判思维",
    "path": "logic",
    "tier": 1,
    "description": "建立论证框架，减少情绪化判断。",
    "unlock_hint": "完成 3 本逻辑类书籍",
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
    "name": "偏差识别",
    "path": "logic",
    "tier": 2,
    "requires": ["critical-thinking"],
    "description": "识别常见思维偏差，推理结果更可靠。",
    "unlock_hint": "前置：批判思维；完成 5 本心理学书籍",
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
    "id": "systems-thinking",
    "name": "系统推演",
    "path": "logic",
    "tier": 3,
    "requires": ["bias-detection"],
    "description": "把复杂问题拆分并重构，形成可复用思维模型。",
    "unlock_hint": "前置：偏差识别；逻辑力达到 130",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "logic",
      "value": 130
    },
    "effect": {
      "logic": 11,
      "insight": 3
    }
  },
  {
    "id": "model-synthesis",
    "name": "模型合成",
    "path": "logic",
    "tier": 4,
    "requires": ["systems-thinking"],
    "description": "将分散结论重构成可复用模型，提升复杂问题处理效率。",
    "unlock_hint": "前置：系统推演；逻辑力达到 165",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "logic",
      "value": 165
    },
    "effect": {
      "logic": 14,
      "strategy": 5
    }
  },
  {
    "id": "first-principle",
    "name": "第一性洞见",
    "path": "logic",
    "tier": 5,
    "requires": ["model-synthesis"],
    "description": "回到问题原点重新推演，构建跨领域推理能力。",
    "unlock_hint": "前置：模型合成；累计完成 20 本书",
    "condition": {
      "type": "completed_count",
      "count": 20
    },
    "effect": {
      "logic": 18,
      "insight": 6
    }
  },
  {
    "id": "game-theory",
    "name": "博弈应用",
    "path": "strategy",
    "tier": 1,
    "description": "在多方互动中寻找最优策略路径。",
    "unlock_hint": "完成 4 本战略类书籍",
    "condition": {
      "type": "category_count",
      "category": "strategy",
      "count": 4
    },
    "effect": {
      "strategy": 6
    }
  },
  {
    "id": "machiavellian",
    "name": "权谋心法",
    "path": "strategy",
    "tier": 2,
    "requires": ["game-theory"],
    "description": "在复杂环境下把握博弈节奏，提升全局控制力。",
    "unlock_hint": "前置：博弈应用；完成《君主论》或 The Prince",
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
  },
  {
    "id": "grand-strategy",
    "name": "全局统御",
    "path": "strategy",
    "tier": 3,
    "requires": ["machiavellian"],
    "description": "具备跨阶段资源统筹能力，行动更具前瞻性。",
    "unlock_hint": "前置：权谋心法；战略力达到 140",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "strategy",
      "value": 140
    },
    "effect": {
      "strategy": 12,
      "logic": 4
    }
  },
  {
    "id": "scenario-sandbox",
    "name": "局势沙盘",
    "path": "strategy",
    "tier": 4,
    "requires": ["grand-strategy"],
    "description": "可在多种局势中进行策略预演，减少决策失误。",
    "unlock_hint": "前置：全局统御；累计完成 15 本书",
    "condition": {
      "type": "completed_count",
      "count": 15
    },
    "effect": {
      "strategy": 15,
      "logic": 5
    }
  },
  {
    "id": "dominion-orchestration",
    "name": "统御编排",
    "path": "strategy",
    "tier": 5,
    "requires": ["scenario-sandbox"],
    "description": "将资源、节奏与目标统一编排，形成高阶统御能力。",
    "unlock_hint": "前置：局势沙盘；战略力达到 220",
    "condition": {
      "type": "attribute_threshold",
      "attribute": "strategy",
      "value": 220
    },
    "effect": {
      "strategy": 20,
      "will": 6
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
