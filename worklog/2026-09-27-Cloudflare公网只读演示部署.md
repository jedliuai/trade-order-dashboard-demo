# Cloudflare 公网只读演示部署

## 做了什么

把演示项目部署到了 `deskdemo.jedliuai.com`。新增了 Cloudflare Worker 登录页、24 小时签名 Cookie、静态资源与只读 API 路由，并在部署时按上海时区当天重新生成五个虚构身份的首页快照、经营指标、Telegram 汇报预览和十类 Excel/Word 样例报表。前端会明确显示“公网只读演示”，本地完整编辑版仍按原方式运行。

## 为什么做

公开视频的共享账号等同于任何人都能访问，不能把它当作真正的权限边界，更不能让它通向 NAS 或家庭网络。Cloudflare 免费 Workers 计划又不能运行现有 Python 容器，所以采用构建期生成静态快照的方案：粉丝可以完整浏览和下载演示报表，但没有任何请求能反向接触内网、生产系统或本机 SQLite。

## 值得记住的决策、坑或技术点

- 公网版不使用 NAS、D1 或远程数据库；所有数据都从 `build_seed` 重新生成，绝不读取 `data/demo.sqlite3`。
- 公网共享账号只负责挡住随意爬取，不承担生产认证；五个业务身份在公网全部强制只读。
- Telegram 只保留汇报预览，实际发送、全库备份、重置和所有写接口都由 Worker 返回 403。
- 生成的 291 个文件不进 Git，最大首页快照约 20 MB，低于 Workers Static Assets 的 25 MiB 单文件限制。
- Edge 表单提交曾出现 `Origin: null`，所以登录接口单独依赖公开凭据，其他写请求仍严格做同源检查；Cloudflare 自动统计脚本也需要加入 CSP 白名单，否则会产生控制台错误。
- `DEMO_PASSWORD` 和随机 `AUTH_SECRET` 只通过 Wrangler Secret 写入 Cloudflare，没有进入源码、配置或提交历史。

## 一句话亮点

把一套 3.7 万条虚构业务记录的外贸驾驶舱安全搬上 Cloudflare：能看、能切身份、能导出，却完全摸不到 NAS 和真实数据库。
