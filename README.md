# 读者之旅 Reader’s Journey

将阅读行为 RPG 化的轻量化体验：录入书单、进度更新、角色面板、下一本推荐与成就分享，配合即时反馈，形成低频但持续的成长轨迹。

## 本地运行
1. 安装依赖
   - `npm install`
2. 启动开发服务
   - `npm run dev`
3. 代码检查
   - `npm run lint`
4. 测试
   - `npm run test`
5. 构建
   - `npm run build`
6. 预览构建产物
   - `npm run preview`

## 目录结构
- `src/index.html` 主页面，包含 5 个核心页面的 UI 线框实现
- `src/styles.css` 全局样式与动效
- `src/app.mjs` 交互逻辑与数据填充
- `src/lib/constants.mjs` 产品数据与规则
- `src/manifest.webmanifest` PWA 配置
- `src/sw.js` Service Worker
- `src/offline.html` 离线兜底页

## 说明
- 本项目为静态站点，通过脚本将 `src` 复制到 `dist`。
- 购书跳转、技能树与成就规则均为占位，可在 `src/lib/constants.mjs` 扩展。
