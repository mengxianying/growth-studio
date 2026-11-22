# 生长计划 Growth Studio

参考 OPC-Grow 的项目与文章展示模式制作的独立中文响应式网站。包含首页、项目分类、文章、搜索、详情弹窗和移动端导航。示例品牌和内容可以自由替换。

## 本地运行

无需安装依赖。在此目录运行：

```bash
python3 -m http.server 8000
```

然后打开 <http://localhost:8000>。也可直接打开 `index.html`。

## 修改内容

- `app.js`：编辑 `projects` 和 `articles` 数组，维护项目及文章内容。
- `index.html`：修改品牌、首页文案和导航。
- `style.css`：修改颜色、排版及响应式布局。

## GitHub Pages 部署

将这三个网站文件推送至 GitHub 仓库的默认分支，然后在仓库 **Settings → Pages → Build and deployment** 选择 **Deploy from a branch**，选择默认分支及 `/ (root)` 并保存。等待 GitHub 提供的网站地址即可访问。

本项目为静态演示站。搜索、筛选和详情在浏览器内运行；不包含账号、支付、内容管理后台或数据库。字体通过 Google Fonts 加载，无法访问时自动使用系统字体。
