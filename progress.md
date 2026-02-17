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

### 2026-02-15 v1.8-E UI 视觉打磨（skills: develop-web-game + playwright）
- 检查并确认可用 skill：`develop-web-game`、`playwright`、`figma`、`figma-implement-design`、`screenshot`；当前任务采用 `develop-web-game + playwright`。
- 完成全局视觉增强（主要改 `src/styles.css`，玩法不变）：
  - 世界 HUD：顶部状态徽章/登记分享按钮强化为经营风按钮，增加质感层次与点击反馈一致性。
  - 主卡片与按钮体系：统一木纹纸感边框、阴影、圆角和字体权重。
  - 录入列表可读性：`search-item` 标题与副标题改为双行截断，避免窄屏半截难读。
  - Sheet：增加卷轴侧边导轨、标题牌和关闭按钮质感，提升“卷轴弹层”观感。
  - 分享/设置卡片：补充章纹与层次细节，统一到木质卷轴视觉语言。
- Playwright 回归：
  - 运行 `npm run test:e2e` 并人工检查最新截图（移动端+桌面）。
  - 重点确认：文字完整、按钮可读、弹层无裁切。
- 命令链验证：
  - `npm ci` ✅
  - `npm run lint` ✅
  - `npm test` ✅
  - `npm run build` ✅

### 2026-02-15 v1.8-F 弹层导航与藏书阁可读性修复（skills: develop-web-game + playwright）
- 修复藏书阁标题文案：`openSheet("藏书阁（全部）")` 改为 `openSheet("藏书阁")`。
- 新增弹层“返回上一层”能力（最小历史栈）：
  - `src/index.html` 在 `sheet-head` 增加 `#sheet-back-btn`，与 `#sheet-close-btn` 并列。
  - `src/app.mjs` 增加 `sheetHistoryStack` + 快照恢复：支持 `world-entry / world-panel / world-settings / share / search / book-detail / generic` 多层回退。
  - `closeSheet()` 时清空历史，确保“回到世界”语义稳定。
- 提升藏书阁书名可读性：
  - `src/styles.css` 增加 `.scroll-title.scroll-title-portrait` 强覆盖（深色 + 更高字重 + 浅色浮雕投影）。
  - 同步增强 `.scroll-sub.scroll-sub-portrait` 对比度。
- Playwright 定向验证：
  - 世界触发 `shelf` 后标题为“藏书阁”。
  - 进入书卷详情后“返回”按钮出现，点击可回到藏书阁。
  - 书名计算样式为 `rgb(61, 37, 14)`，可读性恢复。

### 2026-02-15 v1.8-G 藏书阁录入可见性修复
- 复现问题：新增录入后，藏书阁不变化。
- 根因：`createBook()` 默认 `status: "planned"`，但 `getShelfBooks()` 只返回 `reading/finished`，导致新录入被过滤。
- 修复：`getShelfBooks()` 改为返回 `reading + planned + finished`（各组按更新时间倒序）。
- 文档：README 藏书阁说明更新为“在读 + 待开始 + 已完成”。
- Playwright 验证：录入前 `countBefore=3`，录入后 `countAfter=4`，截图 `output/playwright/shelf-after-new-entry.png`。

### 2026-02-15 v1.8-H 书卷页数输入修复 + 页数数据透明化
- 修复书卷详情进度编辑语义：`#sheet-book-progress-number` 从“百分比输入”改为“已读页数输入”。
- 实现双向联动：
  - 拖动进度条（百分比）会同步换算页数。
  - 输入页数会自动换算并回写百分比标签与进度条。
- 保存逻辑修正：保存时按 `已读页数 / 总页数` 计算目标百分比，再复用既有奖励结算流程。
- 修复录入台搜索输入焦点稳定性：切模式导致重渲染时，恢复输入焦点与光标位置，避免“输入/删字时跳出输入框”。
- 补充页数可信度标识：
  - 离线目录与联网结果新增 `pagesEstimated` 标记。
  - 搜索结果与选中书籍显示“约320页”用于提示估算值，减少误判为真实页数。
- 数据检查结论（脚本统计）：
  - 总书目：`50400`
  - `320` 页：`37084`（`73.58%`）
  - `douban_hot_repo`：`31543/31543` 全为 `320` 页（主因）
  - `openlibrary`：`5541/18857` 为 `320` 页（次因）
- 验证：
  - `npm ci` / `npm run lint` / `npm test` / `npm run build` 全通过。
  - `npm run test:e2e` 通过。
  - `npm run visual:check` 先因基线差异失败，更新基线后复检通过。

### 2026-02-16 v1.8-I 技能星图阶梯化扩展（skills: develop-web-game + playwright）
- 技能规则扩展为 4 条路径 × 5 阶（共 20 技能），新增 T4/T5 进阶节点与前置依赖。
- 星图节点定位改为动态 tier 间距（基于 `SKILL_MAX_TIER`），不再固定 4 层。
- 新增路径阶梯进度卡：每条路径显示 `已解锁/总阶数`、下一阶名称与条件进度。
- 技能明细改为按路径分组、组内按阶排序，强化“阶梯式成长”可读性。
- e2e 稳定性修复：`scripts/e2e-exhaustive.mjs` 中书卷感触输入从 `count()` 判定改为 `isVisible()` 判定，规避 DOM 存在但不可编辑导致的 `locator.fill` 超时。
- 验证结果：
  - `npm ci` ✅
  - `npm run lint` ✅
  - `npm test` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅
  - `npm run test:e2e:headed` ✅
  - `npm run visual:baseline` ✅（因技能界面视觉升级，刷新基线）
  - `npm run visual:check` ✅

### 2026-02-16 v1.8-J 全局竖屏化（手机单手优先）
- 统一 UI 竖屏框：`src/styles.css` 新增 `--app-frame-width` 变量，`.shell` 从铺满 `100vw` 改为居中竖向画幅。
- 统一弹层竖屏框：`.sheet-dialog` 改为固定定位并按 `--app-frame-width` 约束宽度，避免桌面/横屏全宽展开。
- PWA 方向声明：`src/manifest.webmanifest` 增加 `"orientation": "portrait"`。
- 穷尽测试补充：`scripts/e2e-exhaustive.mjs` 新增 `collectShellFrameMetrics()`，并将“壳层竖屏 + 居中”纳入 pass 条件。
- 文档同步：`README.md` 新增 `v1.7.3 全局竖屏化` 说明。

### 2026-02-16 v1.8-K 页数真实性修复（320 占位治理）
- 根因定位：`douban_hot_repo` 历史目录数据大量使用 `320` 作为占位页数，录入链路又存在 `320` 默认兜底，导致“真实页数感”被破坏。
- 录入链路修复（`src/app.mjs`）：
  - 新增 catalog 页数可信度判断与核验流程：对“页数待核实”的书先做联网核验，再允许录入。
  - 核验失败时不再落库 320，改为自动切到自编录入并要求用户填写真实页数。
  - 移除主录入与 Sheet 录入中的 `320` 默认值（含输入框默认值与 payload 默认）。
  - 新增核验态按钮禁用与反馈文案，避免重复提交。
- 目录加载修复（`src/lib/catalog-loader.mjs`）：
  - 将 `douban_hot_repo + 320` 识别为占位值并转换为“待核实”展示，不再当作可信页数。
  - 将离线 `openlibrary + 320` 也纳入“待核实”范围，避免中位数/占位值混入真实录入链路。
- 数据构建脚本防回归（`scripts/fetch-catalog.mjs` / `scripts/fetch-openlibrary-catalog.mjs`）：
  - 生成阶段不再默认填充 320；改为 `pages=0` + `pages_estimated=true`。
- 稳定性修复（`scripts/e2e-exhaustive.mjs`）：
  - 修复 shelf 流程中反射保存按钮偶发 detached 导致的超时，统一改为重试点击。
- 实测结论：
  - 搜索结果中占位书显示“页数待核实”，不再展示 320 误导值。
  - 录入“页数待核实”书籍时，可核验成功并写入非 320 页数（示例：`广告学教程 -> 261 页`）。
  - 自编录入必须显式填写页数，写入值与输入一致（示例：`186 页`）。
  - 离线目录统计口径：`50400` 本中原始 `320` 页 `37084` 本，现已在加载阶段全部标注为待核实（不再直接信任）。
- 验证：
  - `npm ci` ✅
  - `npm run lint` ✅
  - `npm test` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅（修复后重跑）
  - `npm run test:e2e:headed` ✅
  - `npm run visual:check` ✅

### 2026-02-16 v1.8-L 星图神殿关闭后世界卡住修复（兜底 + 回归）
- 根因兜底增强（`src/app.mjs`）：
  - 在 `syncWorldSceneState()` 增加“状态自愈”逻辑：若 `#sheet-dialog` 已关闭，但 `sheetState` 或 `sheetHistoryStack` 残留，则自动清理并恢复世界交互。
  - 交互判定改为 `activeTab === "world" && !sheetOpen && sheetState.type === "none"`，避免“状态残留导致误暂停”。
- 自动化回归增强（`scripts/e2e-exhaustive.mjs`）：
  - `runPanelFlow()` 新增 `worldRecovered` 断言：打开星图神殿 -> 关闭 -> 地图点击移动，确认玩家坐标发生变化且 `sheet === none`。
  - 将 `worldRecovered` 纳入场景 pass 条件，防止回归。
- 验证结果：
  - `npm ci` ✅
  - `npm run lint` ✅
  - `npm test` ✅
  - `npm run build` ✅
  - `npm run test:e2e` ✅（3 个视口下 `panelFlow.worldRecovered=true`）

### 2026-02-16 v1.8-M 星图神殿 UI 全面优化（game-art + 2d-games 落地）
- `src/app.mjs`：重构 `renderWorldPanelSheet()` 为分区结构（档案卡、关键指标、属性谱系、技能星图、进阶路线、成就区），并补充主修路线/最高阶/成就进度等即时信息。
- `src/app.mjs`：`buildSkillLaneProgressHtml()` 增加路径 class 与 `data-skill-path`，便于路径配色与层级样式。
- `src/styles.css`：新增神殿专属样式族（`.temple-*`），优化节点尺寸、路径图例、进阶路线卡、竖屏排版和按钮布局，避免文字互相遮挡。
- 可视核验：检查 `output/playwright/e2e-exhaustive/mobile-390x844-hotspot-panel.png`，星图神殿在竖屏下信息完整可读。

### 2026-02-17 v1.8-N 藏书阁可读性 + 编辑页数（skills: develop-web-game + playwright）
- `src/app.mjs`：藏书阁书卡从“整卡点击”改为“信息区 + 双按钮（书卷详情/编辑页数）”，并保留 `data-book-uid` 以稳定事件委托。
- `src/app.mjs`：新增 `openBookPagesEditorSheet()`、`renderBookPagesEditorContent()`、`handleBookTotalPagesSave()`；保存规则固定为 1~4000、保持已读页数优先、自动重算 `progress/progressPages/status`、不触发奖励、`pagesEstimated=false`。
- `src/app.mjs`：新增 `book-pages-editor` 快照恢复分支，支持多层弹层返回。
- `src/styles.css`：重做 `.bookshelf-book*` 文本与动作区布局，状态徽章改为流式，标题/作者/进度支持多行可读；新增 `.bookshelf-book-actions`、`.bookshelf-book-open-btn`、`.bookshelf-book-edit-btn`。
- `scripts/e2e-exhaustive.mjs`：`runShelfFlow()` 增加“编辑页数按钮可见 -> 打开编辑 -> 保存 -> 卡片总页更新 -> 详情共页数一致”断言链，并纳入场景 pass 条件。
- `README.md`：新增 v1.7.5 说明，补充“编辑页数仅做校正、不发奖励”。
- 待执行验证链：`npm ci` -> `npm run lint` -> `npm test` -> `npm run build` -> `npm run test:e2e` -> `npm run test:e2e:headed` -> `npm run visual:check`。
