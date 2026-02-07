# 读者之旅 Reader’s Journey

离线纯前端的阅读 RPG 应用。

## 产品定位

1. 将读书行为 RPG 化，提供即时反馈（属性、技能、等级）。
2. 强调“用完即走”的轻量体验，不追求高粘性。
3. 核心流程：录入书单 -> 进度更新 -> 成长展示 -> 分享。

## 本版本目标（MVP）

1. 支持 iOS 上架前的最小可行体验。
2. 五个核心页面可稳定离线使用。
3. 默认一屏式移动端体验（主页面不出现纵向滚动）。

## 页面边界

### 保留页面
1. 录入页
2. 进度页
3. 面板页
4. 分享页
5. 设置页

### 删除模块（本版本不做）
1. AI 书童助手
2. 下一本推荐页面与导航入口
3. 购书跳转与联盟导流

## 功能清单

### 录入页
1. 离线书库搜索（书名/作者/ISBN）。
2. 搜索结果选择后入库。
3. 无匹配时支持自编录入。
4. 分类必选。

### 进度页
1. 选择未完成书籍更新阅读进度。
2. 按进度结算经验、属性、技能、成就。
3. 提供轻量即时反馈。

### 面板页
1. 展示等级与经验。
2. 展示六维属性。
3. 展示技能与成就摘要，超出走底部弹层。

### 分享页
1. 生成角色卡信息（昵称、等级、优势属性、技能摘要、邀请码）。
2. 复制邀请码。
3. 复制分享文案。

### 设置页
1. 隐私政策入口（App 内可访问）。
2. 数据导出（JSON）。
3. 数据导入（JSON）。
4. 数据重置。
5. 本地存储状态提示。
6. 版本号显示。
7. 关于与支持（邮箱）。
8. 数据仅保存在本机提示。

## 数值规则

1. 历史权重：前10本100%，10-50本70%，50+本30%。
2. 每日录入节奏：第1本100%，第2本80%，第3本及以上50%。
3. 新增书奖励：x1.5。
4. 自编录入奖励：x0.7。
5. 成长曲线：1-50本+10，51-100本+6，101-200本+3。
6. 技能示例：逻辑3本、心理5本、战略10本、特殊书名彩蛋。

## 离线数据方案

1. 预置离线书库随应用打包。
2. 用户数据保存在本机（localStorage/IndexedDB）。
3. 数据支持 JSON 导出/导入。
4. 默认不做自动云同步。
5. 书籍数据要求真实可追溯，不允许手工虚构条目。

### 本地数据“表”
1. `catalog/index + catalog/shards`
2. `category_profiles`
3. `reward_policies`
4. `skill_rules`
5. `achievement_rules`
6. `user_books`
7. `user_stats`
8. `app_meta`

## 真实书籍数据来源与刷新

1. 当前离线书库来自 Open Library Search API。
2. 数据索引文件：`src/data/catalog/index.json`（分片在 `src/data/catalog/shards/`）。
3. 刷新流程：`npm run data:fetch` -> `npm run data:build-modules` -> `npm run data:verify`。
4. 一键执行：`npm run data:refresh`。
5. 全量来源校验：`npm run data:verify:full`。
6. 当前默认目标规模：每类 7200，本地总量约 50400 本。
7. 说明：全量来源校验耗时很长（可能数小时），日常开发建议先跑 `npm run data:verify` 抽样校验。

## 素材资源（当前实现）

1. 音效：`src/assets/audio/*.wav`，由脚本本地生成（非外采）。
2. 图像：`src/assets/icons/*.svg`，项目内原创图标。
3. 动画：CSS 轻动效（反馈脉冲、奖励项上浮）。
4. 许可清单：`docs/assets-license.md`。

## 技术架构（本版本）

1. 纯前端：HTML + CSS + JavaScript（PWA）。
2. Service Worker 离线缓存。
3. 无后端服务、无定时拉书、无在线 API 依赖。
4. 无账号登录、无跨端同步。

## 设计与素材原则

1. UI 目标是“软件感”，避免网页模板感。
2. 一屏优先，摘要展示，详情走底部弹层（sheet）。
3. 动效轻量，单次反馈不拖沓。
4. 素材优先开源可商用或 AI 生成。
5. 非必要图片可省略（例如书籍封面）。
6. 所有外部素材需记录来源与授权。

## 非目标（再次确认）

1. 商业化导流与联盟分成。
2. 在线书库抓取与后端定时任务。
3. AI 对话与 Agent 工具链。
4. Supabase 登录与服务端数据库。

## 验收标准

1. 断网下可完成完整主流程。
2. 五个页面核心交互可用。
3. 一屏布局无内容截断。
4. 数据重启后可恢复。
5. `lint`、`test`、`build` 全通过。

## 本地运行

1. 安装依赖：`npm install`
2. 启动开发服务：`npm run dev`
3. 代码检查：`npm run lint`
4. 测试：`npm test`
5. 构建：`npm run build`
6. 预览构建产物：`npm run preview`
7. 生成音效素材：`npm run assets:audio`

## 项目结构

1. `src/index.html` 页面结构
2. `src/styles.css` 全局样式
3. `src/app.mjs` 交互逻辑与状态流转
4. `src/lib/constants.mjs` 规则与基础数据
5. `src/lib/reward-engine.mjs` 数值计算
6. `src/lib/state.mjs` 本地存储与状态管理
7. `src/manifest.webmanifest` PWA 配置
8. `src/sw.js` Service Worker
9. `src/offline.html` 离线兜底页
10. `src/data/*.json` 离线数据表
11. `src/lib/tables/*.mjs` 数据表模块
12. `scripts/fetch-catalog.mjs` 真实书籍抓取脚本
13. `scripts/build-data-modules.mjs` 数据模块构建脚本
14. `scripts/verify-catalog.mjs` 书籍来源校验脚本
15. `scripts/generate-audio-assets.mjs` 音效生成脚本
16. `docs/assets-license.md` 素材与数据许可说明
