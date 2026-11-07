# C3 首次 Preview 部署报告

日期：2026-11-07。提交：`fedf7eb`（`chore: prepare isolated Vercel preview deployment`）。

## 部署

- 分支：`codex-preview-clean`，基于 `origin/main` 的 `c3742b1`。
- 仅包含 4 个已审核部署文件：`.gitignore`、`package.json`、`vercel.json`、`work/journeyhub/build-preview.cjs`。未改 main、数据库、Agent 业务代码或其他 worktree。
- 推送后 Vercel 自动创建 Preview：<https://journeyhub-preview-f7ohrnfxc-zicn.vercel.app>。
- Target：Preview；Status：Ready。
- 云端日志确认克隆 `codex-preview-clean` / `fedf7eb`，执行 `npm ci --prefix work/journeyhub` 和 `npm run build:preview`；构建脚本调用 main 的 `build.cjs`，校验配置并产出 16 个白名单文件。脚本的密钥/占位检测通过，部署完成。
- Vercel 项目配置的变量范围是 Preview；变量列表显示 URL 和 Publishable Key 已设置。云端构建成功说明格式校验通过，但本次 HTTP 检查发现发布的 `config.js` 路径未返回配置内容，故无法确认公开 Supabase 配置已正确提供给浏览器。

## 检查结果

| 检查 | 结果 | 证据 |
|---|---|---|
| 本地 npm ci、build、test、diff check | 通过 | 四个测试套件全部通过；测试配置下白名单输出 16 文件 |
| Vercel 云端构建 | 通过 | Build Completed、Deployment completed；无占位校验失败 |
| Preview Target/Status | 通过 | Preview / Ready |
| 首页 | 通过 | HTTP 200，返回应用 HTML |
| AI Plan 页面 | 部分通过 | `/ai-plan.html` HTTP 200；尚未在浏览器交互验证 |
| config.js | 失败 | HTTP 200 但内容是首页 HTML，非 JavaScript 配置；未发现预期 Supabase URL 或 Publishable Key 类型 |
| SQL、backend、fixture 路径隔离 | 失败 | `/database.sql`、`/backend/`、`/fixture-calendar.html` 返回 HTTP 200 首页 HTML（Vercel SPA fallback），没有泄露文件内容，但状态码会掩盖缺失路径且自动化要求的“不可访问”不满足 |
| Supabase 登录/Agent/真实 API/预订/权限隔离 | BLOCKED | 前端配置脚本未正确路由，尚未进行登录或业务测试；未创建真实订单 |
| Travel Memories 导入导出 | BLOCKED | 未能进入应用验证；用户照片仍保存在浏览器 IndexedDB，跨域需手动归档导入 |

## 结论

Preview 已 Ready，但验收失败，**不满足生产发布条件**。页面资源路由出现 SPA fallback：缺失的 `/config.js` 和禁止文件路径都返回首页 HTML。需要先调整 Vercel routing/静态发布配置，使真实 `config.js` 按 JS MIME 返回，且 SQL/backend/fixture 路径返回 404，再创建新的 Preview 部署并重新验收。

## C3-R1 静态路由修复

- 根因：`vercel.json` 未定义路由规则；Vercel 将未知路径回退到首页。文件系统实际有 `config.js` 和 vendor 文件，输出目录正确（16 个文件），但请求 `/config.js` 仍返回了 index HTML。没有额外的项目 rewrite；`.vercel/project.json` 不在此独立 worktree，项目设置此前已核对为仓库根及 `outputs/JourneyHub-Vercel`。
- 修改：在 `vercel.json` 增加先匹配文件系统，再将剩余路径设为 404 的路由；不改应用、Agent、数据库或构建脚本。
- 本地：测试公开配置下 `build:preview` 通过，输出含真实 JavaScript `config.js` 和 16 项静态资源；扫描无 SQL、test、fixture、backend、development placeholder 或服务端密钥。`npm test` 四套通过，`git diff --check` 通过。
- Preview 修复部署尚未运行；线上修复结果、URL、MIME 和 404 测试待推送后确认。
