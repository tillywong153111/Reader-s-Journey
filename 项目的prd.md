《读者之旅 Reader’s Journey》PRD（增强细化版）
1. 产品概述

产品名：读者之旅（Reader’s Journey）

定位：将读书行为 RPG 化，提供即时反馈（属性点、技能、等级），增强用户的成就感与可视化收获。

目标人群：

爱读书但难以坚持的用户

追求学习成就感的年轻职场人

喜欢游戏化体验的轻阅读人群

特性：

“用完即走”，避免高粘性依赖

核心流程：录入书单 → 即时反馈 → 成长展示 → 成就分享

2. 产品目标

通过即时反馈满足用户的“即时满足感”

RPG 属性成长 + 技能树增强阅读的仪式感和成就感

提供“下一本推荐”，并支持购书跳转，形成轻量商业闭环

保持低频、轻量特性，让用户自然完成 100–200 本的生命周期

3. 功能模块
3.1 书籍录入

历史书单批量导入

前 10 本：100%计入

10–50 本：70%

50+ 本：30%

新增书籍奖励：属性点 ×1.5

每日录入节奏

第 1 本：100%

第 2 本：80%

第 3 本及以上：50%

录入方式：搜索书名/作者/ISBN（未来可支持扫码 ISBN）

3.2 阅读进度更新

输入阅读页数或百分比

即时计算奖励：属性点、技能解锁、等级变化

动画反馈：数字飘字 + 条上升 + 卡片闪光

音效反馈：轻快叮声/解锁音阶

3.3 属性与技能面板

六维属性：逻辑、洞察、表达、战略、意志、创造

技能树：按类别+数量触发，支持解锁/未解锁/升级

等级系统：指数曲线，前期快，中期减缓，后期趋稳

3.4 下一本推荐

用户计划书单（最多 3 本）

展示完成后预估收益（属性+技能）

提供购书跳转按钮（当当/京东联盟）

3.5 成就与分享

成就：10/50/100/200 本奖励徽章/称号

分享：生成角色卡片海报（属性、技能、等级、昵称、邀请码二维码）

支持分享到社交平台

3.6 AI 书童助手

人设：亲和、洞察真理的“哲学王”

职责：

回答阅读问题

查询书籍属性/技能

给出下一本推荐

记录进度并反馈奖励

技术：聊天模型 + 工具调用（非复杂 Agent）

4. 数值策划
4.1 属性成长曲线

1–50 本：每本 +10 点

51–100 本：每本 +6 点

101–200 本：每本 +3 点

200 本：主要产出荣誉称号

4.2 技能解锁

3 本逻辑类 →【批判性思维 Lv.1】

5 本心理学类 →【认知偏差识别】

10 本战略类 →【博弈论应用】

特殊彩蛋书籍（如《君主论》） →【权谋心法】

4.3 等级机制

每本书 ≈ 100 经验

升级曲线：低等级升级快，高等级升级慢（指数增长）

5. 数据与书库
5.1 数据扩展策略

热门书籍预置：直接写后端定时任务（如 Node.js + cron job），每 3 天从 Google Books/Open Library 拉取热门书 → 清洗 → upsert 入库。

舍弃 n8n，避免额外搭建工作流，直接在后端跑定时任务。

5.2 数据库表结构（详细）
1) books（书籍库）
字段	类型	说明
book_id	BIGSERIAL PK	自增ID
isbn13	VARCHAR(13) UNIQUE	ISBN13（标准化）
isbn10	VARCHAR(10)	ISBN10
title	TEXT	书名
title_normalized	TEXT	清洗后的书名
authors	TEXT[]	作者数组
publisher	TEXT	出版社
published_year	INT	出版年份
pages	INT	页数
language_code	VARCHAR(8)	语言（zh-CN/en 等）
category_codes	TEXT[]	分类（逻辑/心理学/文学/战略…）
cover_url	TEXT	封面图
description	TEXT	简介
source	JSONB	来源标识（google/openlib）
created_at	TIMESTAMPTZ	创建时间
updated_at	TIMESTAMPTZ	更新时间
2) book_attributes（书籍属性加成）
字段	类型	说明
book_id	BIGINT FK → books.book_id	关联书籍
logic	INT	逻辑加成
insight	INT	洞察加成
expression	INT	表达加成
strategy	INT	战略加成
will	INT	意志加成
creativity	INT	创造加成
3) skills_rules（技能解锁规则）
字段	类型	说明
skill_id	BIGSERIAL PK	技能ID
name	TEXT	技能名
description	TEXT	技能描述
condition	JSONB	触发条件（如：category=逻辑, count>=3）
effect	JSONB	效果（如 logic+5）
4) user_books（用户与书关系+进度）
字段	类型	说明
user_id	UUID	用户ID
book_id	BIGINT FK	关联书籍
progress_pct	NUMERIC(5,2)	阅读进度百分比
progress_page	INT	当前页数
status	ENUM	planned / reading / finished
updated_at	TIMESTAMPTZ	更新时间
5) user_stats（用户属性与等级）
字段	类型	说明
user_id	UUID PK	用户ID
level	INT	当前等级
exp	INT	当前经验值
logic	INT	逻辑力
insight	INT	洞察力
expression	INT	表达力
strategy	INT	战略力
will	INT	意志力
creativity	INT	创造力
unlocked_skills	JSONB	已解锁技能列表
achievements	JSONB	已获得成就
6) achievements（成就表）
字段	类型	说明
achievement_id	BIGSERIAL PK	成就ID
name	TEXT	成就名称
condition	JSONB	条件（如：books_read=10）
reward	JSONB	奖励（徽章/称号）
6. 美术与多媒体

UI：书页纹理背景，六维属性条，技能树节点，卡片模版，徽章/称号

动画：属性提升（数字飘字+条上升），技能解锁（卡片翻转+光效），等级提升（Lv.UP 动效），成就（徽章掉落）

音效：轻钢琴/lo-fi BGM；属性叮声、技能解锁光效声、等级上升音阶

7. 商业化

购书导流：推荐页跳转当当/京东，联盟分成

主题书单包：如“商业成长”“逻辑训练”“心理学路线”（一次性付费）

出版社合作推广：新书推广位（CPA/CPC 模式）

8. 技术架构
前端

MVP：Web + PWA（Next.js + Tailwind）

二阶段：Capacitor 打包 iOS

后端

数据库：Postgres + pgvector

服务层：Node.js/Express（API + Orchestrator）

定时任务：Node.js Cron Job（替代 n8n）

每 3 天拉取热门书籍 → 清洗 → upsert 入库

AI 模型

提供商：OpenRouter

模型组合：

主对话：GPT-4o-mini / Claude 3.5 Sonnet

Embedding：Voyage-large-2

Rerank：Cohere rerank-3

Moderation：OpenAI omni-moderation

模式：聊天模型 + 工具调用

9. 关键页面模块

录入页：搜索栏+批量导入提示（奖励衰减机制）

进度页：书籍封面+进度滑杆+即时奖励卡片

面板页：六维属性条+技能树+等级经验条+成就徽章位

推荐页：计划书单（最多 3 本）+收益预估+购书按钮

分享页：角色卡片海报（属性/技能/等级/邀请码）

聊天页（书童）：对话输入框+回复区+工具结果卡片展示

10. 生命周期体验

初次：录入历史书单 → 获得角色面板 → 快速满足感

使用：新增书籍 + 更新进度 → 即时奖励

分享：生成角色卡 → 社交传播

完成：达到 100–200 本 → 获得“毕业称号”，生命周期自然结束


11. 构建项目需要注意
把前后端的文件，都放在这个主文件里，方便我们以后用ai去修改代码，不用切换，而是可以同时检查前后端文件


12. 登录模块
登录模块用supabase来做
