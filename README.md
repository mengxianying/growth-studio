# 生长计划 · Growth Studio

[网站](https://growth-studio-atlas.pages.dev/) · [编辑室](https://growth-studio-atlas.pages.dev/admin.html)

中文内容工作室，使用 Cloudflare Pages Functions 运行后台，使用 Cloudflare D1（SQLite）持久化内容、分类、订单、附件和登录会话。保留了第一版的六个项目和六篇笔记。网站和管理后台使用相同的数据库，发布内容后刷新前台即可看到更新。

## 管理

登录编辑室后，选择项目、文章、课程或商品，填写内容并保存为草稿或已发布。将已发布内容改为草稿即可下架。工作概览和订单数据直接来自数据库。

商品支持售价、封面、八张相册图片、交付文字和 PDF/ZIP 附件。单个上传文件最大 900 KB。免费商品立即交付，付费商品需要工作室在线下核实收款后在订单页确认交付。读者凭自己的订单链接查看交付内容。后台显示最近 250 笔订单，概览统计全部订单。

## 本地开发

需要 Node.js 22.12+ 或更新版本。Wrangler 提供本地 D1 模拟器，无需安装数据库服务器。在仓库目录运行：

```bash
node build.mjs
npx wrangler@4 pages dev dist --d1 DB --binding ADMIN_KEY_SHA256=你的开发密钥的SHA256十六进制摘要
```

用本地开发密钥登录。可用 Node 生成随机密钥和对应摘要，请妥善保存输出。

```bash
node --input-type=module -e "import {randomBytes,createHash} from 'node:crypto'; const key=randomBytes(36).toString('base64url'); console.log(key,createHash('sha256').update(key).digest('hex'))"
```

## 部署及备份

运行 `node build.mjs`，将 `dist` 的内容打包后上传到 Cloudflare Pages。生产环境绑定 D1，变量名为 `DB`。在 Pages 生产环境设置 `ADMIN_KEY_SHA256`，再部署一次使绑定和变量生效。也可以在构建时通过同名环境变量写入随机管理密钥的摘要。后台仅校验摘要，仓库不包含部署用的管理密钥。首次访问 API 将以事务创建表并导入示例，后续部署保留数据库内容。使用 Pages 默认域名时，本站的 GitHub Pages 旧入口跳转配置在两个 HTML 文件的页首。

内容和订单保存在 Cloudflare 账户内。使用 D1 导出功能或 Wrangler 的 `d1 export` 备份。管理会话有效期八小时。更换密钥后如需同时注销所有现有会话，在 D1 控制台执行 `DELETE FROM sessions`。

主要文件为 `backend.mjs`（数据库与 API）、`admin.js`（后台）、`app.js`（前台）及 `seed.json`（首次导入的数据）。生产代码通过 Pages 直接上传部署，GitHub 用于保存源码。

首页林间晨光摄影来自 [Unsplash](https://images.unsplash.com/photo-1441974231531-c6227db76b6e)。其余摄影素材来自 Unsplash，项目中保留了所用尺寸的副本：[森林](https://images.unsplash.com/photo-1448375240586-882707db888b)、[工作桌](https://images.unsplash.com/photo-1497215728101-856f4ea42174)、[写作](https://images.unsplash.com/photo-1455390582262-044cdead277a)、[工作室](https://images.unsplash.com/photo-1497366811353-6870744d04b2)。

## 中英文版本

[中文](https://growth-studio-atlas.pages.dev/?lang=zh) · [English](https://growth-studio-atlas.pages.dev/en)

页首和阅读窗口均可切换语言。浏览器记住上次选择，分享的语言链接优先。后台的英文内容栏可维护译文；留空的字段在英文站显示中文原文。分类和工作室介绍也可维护英文。首次部署时，已有内容的译文从 `english.json` 导入 D1，以后在后台编辑。构建脚本根据 `interface-en.json` 生成英文页面与交互文案。
