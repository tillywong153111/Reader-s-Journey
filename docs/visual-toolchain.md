# Reader's Journey 视觉工具链（Web 栈、开源优先）

本文档说明当前项目采用的主世界 UI 升级工具链，以及推荐的执行顺序。目标是保证视觉改造可迭代、可回归、可量化。

## 1. 工具链组成

1. 设计系统层（零新增依赖）
   - 文件：`src/styles.css`
   - 方式：统一 token（木纹、纸张、按钮、阴影、圆角、状态色）+ 组件化样式分层
   - 目标：保证主世界和各 Sheet 视觉一致，不出现“拼接感”

2. 交互渲染层（Phaser + DOM HUD）
   - 文件：`src/app.mjs`、`src/index.html`
   - 方式：主世界场景继续由 Phaser 渲染，顶层状态与操作入口用轻量 DOM HUD 叠加
   - 目标：维持流畅度，同时保证按钮、文字在移动端可读可点

3. 穷尽流程层（Playwright）
   - 文件：`scripts/e2e-exhaustive.mjs`
   - 命令：`npm run test:e2e` / `npm run test:e2e:headed`
   - 目标：覆盖主世界移动、热点交互、多层弹层链路，避免视觉改造引发功能回归

4. 视觉回归层（截图 + 像素对比）
   - 文件：`scripts/visual-regression.mjs`
   - 命令：`npm run visual:baseline` / `npm run visual:check`
   - 目标：捕捉按钮样式漂移、排版裁切、状态展示异常

5. 一键流水线（本次新增）
   - 文件：`scripts/ui-pipeline.mjs`
   - 命令：
     - `npm run ui:check`：`lint -> test -> build -> e2e -> visual:check`
     - `npm run ui:baseline`：`lint -> test -> build -> e2e -> visual:baseline -> visual:check`
   - 目标：把视觉升级验收标准变成固定命令，降低人工遗漏

## 2. 本次主世界 UI 升级内容

1. 新增主世界概览 HUD
   - 今日录入进度：`今日录入 x/3`（达标后切换高亮态）
   - 目标地标提示：`正在前往 / 最近地标`
2. 主世界右上按钮（登记/分享）增加语义化样式分化与可见焦点态
3. 小屏（<=360px）下的概览 HUD 压缩策略，避免文本半截与遮挡

## 3. 推荐执行流程

1. 视觉开发阶段
   - 先改 `styles.css` token 与组件皮肤
   - 再改 `app.mjs` / `index.html` 的状态与结构钩子
2. 回归阶段
   - 运行 `npm run ui:check`
3. 需要更新视觉基线时
   - 先确认改动通过设计评审，再运行 `npm run ui:baseline`

## 4. 可选扩展（不影响当前构建）

1. 若后续引入 Figma 设计稿，可使用 MCP/Figma 工作流做设计到代码对照。
2. 若后续引入 UI 动画资产，可优先使用开源格式（Lottie JSON）并纳入 `visual:check` 基线。
3. 新增第三方素材时，必须同步更新 `docs/assets-license.md`。
