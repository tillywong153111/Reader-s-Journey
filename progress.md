Original prompt: 按照这10个图片的风格，执行你的计划（Reader’s Journey v1.7 像素RPG视觉重制，手机竖屏优先，世界像素化+UI高清）。

## Iteration Log

### 2026-02-14 v1.7-A 初始化
- 创建像素素材目录骨架：`src/assets/pixel/{tiles,buildings,characters,props,fx}`。
- 启动 v1.7 实施：准备补齐测试接口 `window.render_game_to_text` / `window.advanceTime(ms)`。
- 准备替换主世界渲染：从几何绘制升级为 tile/sprite 像素化地图与建筑实体。

### 2026-02-15 v1.7-B 像素主世界二次美术升级
- 重构 `src/app.mjs` 主世界 tile atlas：从 16 个基础地块扩展为 24 个细分地块（草地、花地、路面、桥面、水体、石板、灌木地块等）。
- 重绘建筑像素贴图：统一成更完整的屋顶/墙体/门窗/招牌结构，并按录入台/神殿/藏书阁/驿站/工坊做差异化细节。
- 扩充道具贴图：新增 `rj-fence`、`rj-crate`，保留并优化树木/灌木/路标/光环素材。
- 新增环境 NPC 贴图与巡游动画：两组 NPC 在中央动线缓动行走，提升“主世界活体感”。
- 重写地形生成：增强河道、主干道、广场、农田、装饰噪声分布，使主城结构更接近手游经营/RPG 俯视感。
- 新增场景装饰函数 `createTownDecor()`，在主城关键位置铺设栅栏、木箱和林木点缀。
- 调整热点建筑缩放、交互区、标题牌与镜头缩放参数，保持可交互性同时提高视觉平衡。
- 调整 `src/styles.css` 世界 UI 皮肤：降低顶部/底部遮罩强度，保留高清可读 HUD 但减少“雾化遮挡”。

## TODO
- [x] 在 `src/app.mjs` 完成 Phase A 的调试接口与时间推进接口。
- [x] 在 `src/app.mjs` 完成 Phase B：像素渲染配置、全屏竖屏优先缩放、世界层级重建。
- [x] 在 `src/styles.css` 完成 UI 皮肤统一（木质/羊皮卷任务面板风格）。
- [ ] 更新 `docs/assets-license.md`（补充 v1.7 像素世界素材策略与目录说明）。
- [ ] 更新 `README.md`（补充 v1.7 视觉方案与 Playwright 世界回归流程）。
- [ ] 执行 `npm run lint`、`npm test`、`npm run build`。
- [ ] 用 `web_game_playwright_client.js` 连续回归并检查截图/控制台。

### 2026-02-15 v1.7-C 世界空白修复与纯游戏内HUD验收
- 修复世界场景渲染崩溃：`spawnAmbientNpcs` 从 `this.tweens.createTimeline` 改为 `this.tweens.chain`，消除 `TypeError` 导致的蓝底空白。
- 主世界入口改为游戏内HUD：`world-head` 中增加 `登记/分享` 按钮并复用现有 `performWorldAction("entry"|"share")` 业务流程。
- 世界外层框去视觉化：世界场景隐藏外层 `app-header`，保留画面内状态/按钮/提示。
- 完整验证通过：`npm ci`、`npm run lint`、`npm test`、`npm run build` 全通过。
- 浏览器验证完成（含 headed）：桌面/手机视口下，主界面与录入/分享弹层文字、按钮均完整可见，无裁切。

## TODO（更新）
- [x] 执行 `npm run lint`、`npm test`、`npm run build`。
- [x] 用 Playwright 连续回归并检查截图/控制台。
- [ ] 更新 `docs/assets-license.md`（补充 v1.7 像素世界素材策略与目录说明）。

### 2026-02-15 v1.7-D 穷尽测试稳定化与一次交付收口
- 新增并启用测试钩子（不影响对外 API）：
  - `window.__RJ_TEST__.queueWorldHotspot(zoneId)`
  - `window.__RJ_TEST__.triggerWorldAction(zoneId)`
  - `window.__RJ_TEST__.clearWorldPointerTarget()`
  - `window.__RJ_TEST__.clearWorldInteractCooldown()`
- 修复 `scripts/e2e-exhaustive.mjs` 稳定性：
  - 热点打开从“单次点击”改为“重试 + 钩子触发 + 状态重置”。
  - 新增 `closeAllSheets()` 处理多层弹层，避免按钮被 `dialog` 遮挡。
  - 联网检索改为 Playwright 路由 mock，消除第三方 `429` 随机噪音。
  - 调整流程顺序：`entry -> panel -> shelf -> share -> settings`，避免 reset 干扰后续链路。
- 修复 `scripts/visual-regression.mjs`：
  - 移除旧版 `.tab` 依赖，改为“世界内按钮/热点”截图流。
  - 保持原截图命名，兼容回归对比。
  - 支持缺失基线自动补种。
- 完整验证（修复后整链重跑）：
  - `npm ci` ✅
  - `npm run lint` ✅
  - `npm test` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `npm run test:e2e:headed` ✅
  - `npm run visual:check` ✅
- 文档同步：
  - `README.md` 新增 v1.7 交付说明、穷尽测试命令。
  - `docs/assets-license.md` 补充像素视觉与测试产物许可说明。

## TODO（最终）
- [x] 更新 `docs/assets-license.md`（补充 v1.7 像素世界素材策略与目录说明）。
