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

首页草地晨光摄影由 Radosław Krupa 拍摄，本站调整了暗部亮度与草木色调。[Pexels 原图](https://www.pexels.com/photo/sunbeams-on-green-grass-field-with-trees-11257958/) · [照片许可](https://www.pexels.com/license/) 。其余摄影素材来自 Unsplash，项目中保留了所用尺寸的副本：[森林](https://images.unsplash.com/photo-1448375240586-882707db888b)、[工作桌](https://images.unsplash.com/photo-1497215728101-856f4ea42174)、[写作](https://images.unsplash.com/photo-1455390582262-044cdead277a)、[工作室](https://images.unsplash.com/photo-1497366811353-6870744d04b2)。

## 中英文版本

[中文](https://growth-studio-atlas.pages.dev/?lang=zh) · [English](https://growth-studio-atlas.pages.dev/en)

页首和阅读窗口均可切换语言。浏览器记住上次选择，分享的语言链接优先。后台的英文内容栏可维护译文；留空的字段在英文站显示中文原文。分类和工作室介绍也可维护英文。首次部署时，已有内容的译文从 `english.json` 导入 D1，以后在后台编辑。构建脚本根据 `interface-en.json` 生成英文页面与交互文案。

## 用户账户、课程和支付（待配置与真实联调）

前台提供用户名、密码、邮箱验证码注册，并区分一人公司（OPC）和公司账户。课程在后台设置价格、公开介绍、交付内容和附件，用户登录后可在“我的课程”中查看已开通内容。密码采用带随机盐的 PBKDF2-SHA-256，验证码有效期 10 分钟。D1 会自动创建账户及课程订单所需的表，无需安装数据库服务。未配置邮件时不能注册，未配置相应支付渠道时不会创建该渠道的付费订单。

邮箱发送使用 Resend。其免费计划当前为每天 100 封、每月 3,000 封，实际额度以 [Resend 定价](https://resend.com/pricing)为准。正式向任意地址发送需要自有域名，并在 Resend 添加及验证 DNS 记录。域名本身可能产生费用。确认发件域名后，在 Cloudflare Pages 生产环境设置以下密钥与变量，之后重新部署：
- `RESEND_API_KEY`：Resend API 密钥。
- `MAIL_FROM`：已验证域名下的发件地址，如 `Growth Studio <hello@example.com>`。
- `EMAIL_CODE_SECRET`：独立随机生成的长密钥，建议不少于 32 字节。不要与其他密钥共用。

已实现的支付接口需要商户开通相应产品并完成平台联调。密钥应通过 Cloudflare 的加密 Secret 保存，不能放入仓库或聊天中。请在真实启用前使用各平台测试环境及小额订单核对下单、到账、回调、重复通知和交付，确认网站域名满足商户平台要求。支付处理仅在验签、核对商户及金额后开放课程。
- 微信支付 Native 扫码需要开通 Native 产品并配置 `WX_APP_ID`、`WX_MCH_ID`、`WX_CERT_SERIAL`、`WX_PRIVATE_KEY`（PKCS#8 PEM）、`WX_PUBLIC_KEY_ID`、`WX_PUBLIC_KEY`（微信支付公钥 PEM）及 32 字节的 `WX_API_V3_KEY`。通知地址为 `https://你的域名/api/payments/wechat/notify`。
- 支付宝电脑网站支付需要开通相应产品并配置 `ALIPAY_APP_ID`、`ALIPAY_SELLER_ID`、`ALIPAY_PRIVATE_KEY`（PKCS#8 PEM）、`ALIPAY_PUBLIC_KEY`（支付宝公钥 PEM）。异步通知地址为 `https://你的域名/api/payments/alipay/notify`。
- Stripe Checkout 需要完成商户开户并配置 `STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`。在 Stripe 控制台将 `checkout.session.completed` 和 `checkout.session.async_payment_succeeded` 通知发送至 `https://你的域名/api/payments/stripe/notify`，并启用账户和结算币种支持的支付方式。

当前微信实现为桌面扫码，支付宝实现为电脑网站支付。手机内支付及订单过期、关闭、退款和对账流程仍需按商户实际产品配置完善。用户已有未支付订单时须继续使用原渠道，避免重复付款。课程收费内容应填写在“交付内容”或上传的私有附件中，课程介绍和正文会公开显示。当前交付支持文字和 PDF/ZIP 附件，视频托管与流媒体播放尚未实现。
