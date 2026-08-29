# Local Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 用户明确要求在当前演示文件夹实施；保持本目录，不另建 worktree。

**Goal:** 将现有驾驶舱变为完全脱敏、可本地持久化并保留导出与 Telegram 的独立演示项目。

**Architecture:** React 保留业务组件和缓存，本地 Python API 提供 SQLite 数据及业务动作。使用同源 API、环回监听和虚构种子，不转发任何原业务服务。

**Tech Stack:** React/TypeScript/Vite、Python 3.11+、SQLite、openpyxl、python-docx。

**Spec:** docs/superpowers/specs/2026-08-27-local-demo-design.md

## Global Constraints

- 只绑定环回地址，业务数据存放在项目 `data/`，不访问原业务系统。
- 至少 60 个虚构客户、1000 份合同、2000 条联系单及关联数据，覆盖当前月和两年以上历史。
- 保留已有财务和状态口径，不凭空确认利润。
- 所有模板和示例必须虚构；Bot Token、Chat ID、运行数据库不进入 Git。
- 只用 Edge 做浏览器验收。
- 新仓库为私有 `jedliuai/trade-order-dashboard-demo`，首次提交之前完成脱敏；子任务不得提交或推送尚含旧敏感内容的工作区。

### Task 1: 本地 Python 数据与导出服务

**Files:** Create `local_api/__init__.py`, `local_api/server.py`, `local_api/store.py`, `local_api/seed.py`, `local_api/actions.py`, `local_api/metrics.py`, `local_api/exports.py`, `local_api/telegram.py`, `local_api/tests/test_local_api.py`, `requirements.txt`, `data/demo-seed.json`.

**Interfaces:** 前端调用 `GET/POST/PATCH/DELETE /api/data/{table}?select=*&id=eq.<id>&order=id.asc&limit=1000&offset=0`；动作 `/api/data/rpc/{name}` 采用现有前端 p_ 参数与响应结构。`X-Demo-User` 为演示角色 ID，默认 `demo-sales-1`；角色 ID 还包括 `demo-sales-2`, `demo-sales-3`, `demo-manager`, `demo-owner`。经理读取三名业务员数据；老板读取全部；经理/老板只读。公共汇率 owner 为 `demo-shared`。`GET /api/health` 返回 status/counts；`POST /api/reset` 需 `{"confirm":"RESET_DEMO"}`，先备份；`POST /api/export/{command}` 接受筛选并直接返回下载文件；`GET /api/telegram/status`、`POST /api/telegram/preview`、`POST /api/telegram/send` 接受 `{mode, recipient}`，mode 为 current_month/previous_month/fiscal_year，recipient 为 manager/owner。预览返回 `{text, report}`；发送还需 `confirmed:true`，接收人映射只来自环境配置。`GET /api/backup` 返回完整 JSON 快照。

- [ ] RED: 编写真实 SQLite 临时目录测试，检查 `seed.build_seed(date(2026,8,27))` 数量及关联，重启 `Store(path)` 后客户更新仍存在，非法组合写入回滚，未知表和动作拒绝；未配置 Telegram 不联网且报错。先运行 `python -m unittest discover -s local_api/tests -v` 验证失败。
- [ ] GREEN: `build_seed(as_of)` 返回以现有 REST 表名为 key 的字典；`Store(path, seed_path=None)` 提供事务保护数据操作。检查 frontend/src/services/dataStore.ts、masterDataService.ts、customerOrdering.ts、dashboardOperatingMetrics.ts 的全部调用，支持其实际 query/RPC，不静默返回成功或空值隐藏未实现功能。
- [ ] GREEN: 实现合同、联系单、批次、发货组/明细、收款主单/分摊、开票、产品与包装、偏好与提醒动作；未知动作返回可读错误。检查外键、数量上限和金额正数；查询/写入按演示角色范围。
- [ ] GREEN: 本地指标与 Telegram 共用 metrics；所有十类现有导出命令接受原筛选字段，Word 从通用空白文档生成。用 openpyxl/Document 重新打开结果并断言数据和筛选，不能只是检查文件存在。
- [ ] GREEN: `python -m local_api.server --port 8765` 启动服务并初始化种子；`python -m local_api.seed` 可重建虚构种子。环境配置只从 `.env.local` 读取 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_MANAGER_CHAT_ID`, `TELEGRAM_OWNER_CHAT_ID`。
- [ ] VERIFY: 全部 Python 测试通过，记录命令与结果，列出未实现项（若有）。不修改 frontend，不删除旧目录，不提交；主代理负责集成和脱敏。

### Task 2: 前端去云化与本地入口

**Files:** Modify `frontend/src/services/dataStore.ts`, dependent service imports, `frontend/src/App.tsx`, `frontend/src/components/Header.tsx`, `frontend/src/pages/Settings.tsx`, `frontend/src/pages/Exports.tsx`, APS-related pages; Create `frontend/src/services/localClient.ts`, local account component, frontend local integration tests; modify root package scripts and Vite config.

**Interfaces:** 消费 Task 1 的 HTTP 接口，保留现有 db 方法及表结构；所有请求为同源 `/api/`，从本地演示账户传 `X-Demo-User`。

- [ ] RED: 测试本地客户端 URL、角色头、错误传播、下载文件名；旧云客户端不能被加载。
- [ ] GREEN: 去掉远程登录、APS 同步按钮/历史抽屉/自动运行，排产日期改为手工字段；保留数据刷新和既有编辑。
- [ ] GREEN: 设置页展示数据统计、角色切换、本地备份/确认重置、Telegram 配置状态/汇报预览/确认发送；不接受任意 Token 查询或 URL 参数泄露。
- [ ] GREEN: 导出从 `/api/export/{command}` 获取 Blob，自动下载；移除云任务轮询及私有对象存储。
- [ ] VERIFY: 运行前端单测、lint、build，修复实际回归；保留与本地业务相关的既有测试，移除专门验证已删除云架构的测试。

### Task 3: 脱敏、启动和独立 Git

**Files:** root metadata, README, AGENTS, .gitignore, .github/workflows/ci.yml, new worklog; remove obsolete cloudflare/supabase/worker/ops/automations and sensitive legacy docs/templates/assets.

- [ ] 将源库 .git 仅作为克隆历史删除，初始化新的 main；源 GitHub 仓库保持不变。
- [ ] 清点并移除原模板、原始 JSON、旧文档和截图；代码和测试中真实公司/人名/服务器/业务编号改为统一虚构示例。
- [ ] 提供 `npm run setup`、`npm run dev`、`npm run build`、`npm start`、`npm test`，开发双进程有清理与错误传播。
- [ ] README 写明依赖、数据落盘位置、重置备份、演示角色非生产鉴权、Telegram 配置及本地运行限制。
- [ ] 敏感扫描含文件名、文本、二进制资产、Git 历史，确认不含原始业务材料和凭据。

### Task 4: 集成验收与发布

**Files:** local tests, docs verification report, worklog.

- [ ] 在真实本地服务验收读取、新增、修改、重启持久化、跨表写入回滚、十类导出、Telegram 未配置和未确认禁止发送。
- [ ] Edge 打开所有导航页面，验证仪表盘和列表不空，编辑与刷新可用，导出可下载，无外部业务请求和前端报错。
- [ ] 独立代码审查，处理阻断项，再运行完整测试/lint/build。
- [ ] 写中文工作总结，提交脱敏后的首个 commit，创建私有目标仓库并推送，核对远端和提交状态。
