# Trade Order Dashboard Demo

一个以本机完整演示为主、同时提供 Cloudflare 公网只读沙箱的外贸订单驾驶舱。保留订单、联系单、批次、发货、回款、开票、利润分析、主数据、Excel/Word 导出和 Telegram 经营汇报。所有预置公司、客户、人员、合同和交易均为虚构演示数据。

不需要 NAS、远程数据库或生产同步服务。原项目的生产同步已经移除；排产日期由本地手工维护。公网沙箱只分发构建时生成的虚构快照，不连接家庭网络、NAS 或本机数据库。

## 启动

需要 Node.js 22.12+（本机验证使用 24）与 Python 3.12+。

```sh
npm run setup
npm run dev
```

使用 **Microsoft Edge** 打开 http://127.0.0.1:5180 。setup 创建项目内 .venv 并安装 Python/前端依赖；首次启动会按当天日期生成完整虚构数据并初始化 SQLite，确保首页当前月份始终有可演示的订单、回款、发货和利润。安装依赖需要联网，日常浏览与编辑不需要互联网。

构建后只运行一个本地 Python 服务：

```sh
npm run build
npm start
```

此时用 Edge 打开 http://127.0.0.1:8765 。按 Ctrl+C 停止服务。两个启动模式请勿同时运行；8765 和 5180 端口必须空闲。

## 数据放在哪里

| 内容 | 位置 | 是否进入 Git |
| --- | --- | --- |
| 当前日期虚构数据生成器 | local_api/seed.py | 是 |
| 固定日期的纯虚构样例快照 | data/demo-seed.json | 是 |
| 本机实际编辑后的 SQLite 数据 | data/demo.sqlite3 | 否 |
| 重置前的完整 JSON 快照 | data/backups/ | 否 |
| Telegram 本机配置 | .env.local | 否 |

数据不出本机，除非你主动下载导出文件或确认向 Telegram 发送汇报。设置页可以下载全库 JSON 备份；重置需再次确认，重置前自动保存快照，并按重置当天重新生成当月有经营数据的虚构数据库。当前不提供一键导入备份按钮，请在删除或重建数据库前保留备份。

顶栏提供三个业务员、经理和老板演示身份。业务员编辑各自数据；经理/老板汇总查看。身份切换仅用于演示，**不是安全登录系统**。服务仅绑定 127.0.0.1，不要将端口代理到公网或局域网，也不要录入真实客户数据。JSON 全库备份和健康检查是本机管理功能，并非按业务员隔离的生产权限接口。

## Cloudflare 公网只读沙箱

公网站点位于 [deskdemo.jedliuai.com](https://deskdemo.jedliuai.com)。共享账号只是一道演示入口，不是生产级授权；所有身份在公网均为只读。浏览、身份切换、首页指标、Telegram 汇报预览和十类样例报表下载可用，新增/修改/删除、全库备份、重置和 Telegram 实际发送全部在 Worker 端拒绝。

```sh
npm run build:cloudflare
npm run check:cloudflare
npm run deploy:cloudflare
```

`build:cloudflare` 会按上海时区当天日期重新生成公网快照和样例报表，再构建 React 前端。生成目录 `frontend/public/.cloudflare-demo/` 与 `frontend/dist/` 均不进入 Git。部署使用 `wrangler.jsonc` 中的自定义域名；`DEMO_PASSWORD` 和 `AUTH_SECRET` 必须用 Wrangler Secret 配置，绝不能写进仓库。Cloudflare 免费计划不提供 Containers，因此公网版本不运行 Python/SQLite，也不接 NAS。

## Telegram（可选）

复制 .env.local.example 为 .env.local，在本机填写测试 Bot Token、经理与老板的接收人 Chat ID。不要把密钥写进源码或提交 Git。

未配置时可以预览本月、上月、财年的汇报，不能发送；配置后，设置页仍需要明确点击并确认才发送。不会定时推送，不会自动同步，不支持浏览器指定任意接收人。发送的只是当前演示身份范围内的统计摘要。Bot 需已获接收人/群组允许发送消息。

财年沿用原业务口径：12 月 1 日至次年 11 月 30 日。开票、利润、回款等规则保留现有业务约束；缺汇率或成本时显示待计算，不填造利润。

## 导出与开发

原有十类导出在本地即时生成，包括生产协调、月度订单、合同登记、联系单辅助、回款、客户销售回款汇总、人民币开票申请、发货安排、收货确认函和发货明细。使用重新生成的通用 Excel/Word 版式，不携带旧模板中的客户名称、落款或隐藏内容。

```sh
npm test
npm run lint
npm run build
```

代码主要在 frontend/、local_api/ 与 cloudflare/；scripts/local.mjs 管理安装及本地进程，scripts/build_public_demo.py 生成公网快照；worklog/ 记录中文工作总结。Python HTTP/SQLite 使用标准库，报表生成依赖 openpyxl 和 python-docx。仓库只同步源码、文档和虚构种子，不同步本机数据库、生成快照与凭据。
