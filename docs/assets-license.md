# Assets & Data License Notes

## Catalog data
- Files:
  - `src/data/catalog/index.json`
  - `src/data/catalog/shards/*.json`
- Source (hybrid):
  - Douban 热门书单数据仓：`https://github.com/mylove1/doubanbook30000`
  - Douban Top250 种子：`https://github.com/free-learning-center/douban-top250-books`
  - Open Library Search API snapshot (`https://openlibrary.org/search.json`)
- Snapshot time: stored in `generated_at` field in `index.json`
- License note:
  - Open Library metadata follows its Open Data terms.
  - Douban 相关公开仓数据用于离线检索元数据（书名/作者/链接/分类），不分发受版权保护正文内容。
- Usage in this project: offline searchable catalog metadata only (title/author/isbn/pages/category/source link).

## Rule tables
- Files:
  - `src/data/category_profiles.json`
  - `src/data/reward_policies.json`
  - `src/data/skill_rules.json`
  - `src/data/achievement_rules.json`
- Source: project-authored configuration (original work).

## Audio assets
- Files:
  - `src/assets/audio/entry-success.wav`
  - `src/assets/audio/skill-unlock.wav`
  - `src/assets/audio/level-up.wav`
  - `src/assets/audio/bgm-astral-loop.wav`
  - `src/assets/audio/bgm-sanctum-loop.wav`
- Source: generated locally by `scripts/generate-audio-assets.mjs` (original work).
- Rendering note: BGM tracks use long-form ambient synthesis (no obvious beat pulse), loop length ~56-58s.
- License: project-owned generated assets.

## Font assets
- Files:
  - `src/assets/fonts/NotoSansCJKsc-Regular.otf`
  - `src/assets/fonts/NotoSerifCJKsc-Regular.otf`
- Source:
  - Noto CJK project by Adobe + Google
  - Repo: `https://github.com/notofonts/noto-cjk`
- License: SIL Open Font License 1.1 (OFL-1.1)

## Icon assets
- Files: `src/assets/icons/*.svg`
- Source: project-authored SVG icons (original work).
- License: project-owned generated assets.
