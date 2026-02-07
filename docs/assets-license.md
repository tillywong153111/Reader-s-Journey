# Assets & Data License Notes

## Catalog data
- Files:
  - `src/data/catalog/index.json`
  - `src/data/catalog/shards/*.json`
- Source: Open Library Search API (`https://openlibrary.org/search.json`)
- Snapshot time: stored in `generated_at` field in `index.json`
- License note: Open Library metadata is provided under Open Data terms by the Internet Archive/Open Library project.
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
- Source: generated locally by `scripts/generate-audio-assets.mjs` (original work).
- License: project-owned generated assets.

## Icon assets
- Files: `src/assets/icons/*.svg`
- Source: project-authored SVG icons (original work).
- License: project-owned generated assets.
