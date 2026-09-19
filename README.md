# Remote BrowserOS

一个纯前端的 BrowserOS MCP 遥控界面。它把 BrowserOS 的标签页、导航和输入操作映射成 MCP 工具调用，并以约 1 FPS 的截图轮询展示远端网页。

在线地址：<https://4x25.github.io/RemoteBrowserOS/>

## 功能

- 镜像 BrowserOS 当前全部标签页，新建、选择和关闭标签页
- 前进、后退、刷新和地址栏跳转
- WebP 截图视口，失败时自动回退 JPEG
- 左键、右键、双击、滚轮、悬停、拖拽、文本输入、组合输入、粘贴和快捷键
- 自适应截图尺寸、坐标反算、单飞截图请求和迟到帧丢弃
- 自动向每个远端标签透传本地 UA、UA Client Hints、平台、语言和深浅色主题
- MCP 地址只保存在页面内存中，不写入浏览器存储

远端网页 HTML 不会被注入本应用。视口只显示图片，因此不会继承远端页面的脚本、Cookie 或 DOM 权限。

环境透传只读取浏览器直接公开的信息，不会复制 Cookie、站点存储、登录态、剪贴板或设备权限。Safari/Firefox 的 UA 被原样交给基于 Chromium 的 BrowserOS，少数网站可能因此返回不兼容当前渲染引擎的内容。

## 运行条件

- Node.js 20.19+ 或 22.12+
- 支持 Streamable HTTP 的 BrowserOS MCP；兼容旧版结构化返回和新版带安全标记的数据包装，并在连接期间传递 BrowserOS 会话标识
- 前端必须通过 HTTP(S) 提供，不能直接打开 `index.html`

BrowserOS 默认只信任自身扩展来源。启动 BrowserOS 前，需要把本应用的精确 Origin 加入环境变量：

```bash
export BROWSEROS_TRUSTED_ORIGINS=http://localhost:5173
# 从同一个环境启动 BrowserOS
```

多个来源用英文逗号分隔。修改后必须重启 BrowserOS。这里填写的是前端页面的 Origin，而不是 MCP 地址。

如果前端使用 HTTPS，MCP 也必须使用 HTTPS，否则浏览器会按混合内容阻止请求。首版没有鉴权，MCP 端口只能用于本机或可信私网，不能直接暴露到公网。

## 本地开发

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`，在启动弹窗中输入完整 MCP 地址，例如：

```text
http://127.0.0.1:9000/mcp
```

远程部署时，该地址必须能从运行前端的最终用户浏览器访问；它不是由 Vite 开发服务器代为访问的。

已使用 BrowserOS MCP `0.0.165` 验证连接、标签页读取和截图。新版 `run` 返回的数据包装只按 JSON 解析，不会执行其中的内容；会话标识只保存在内存中，断开或重新连接时清除。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

端到端测试会启动一个独立跨域的模拟 MCP 服务。首次运行 Playwright 时需要安装浏览器：

```bash
npx playwright install chromium
```

可选的真实 BrowserOS 只读联调会初始化 MCP、读取标签页并抓取一张低分辨率截图：

```bash
BROWSEROS_MCP_URL=http://127.0.0.1:9000/mcp \
  npm test -- src/lib/browseros/real.integration.test.ts
```

## GitHub Pages

推送到 `main` 后，`.github/workflows/deploy-pages.yml` 会执行类型检查、单元测试，并使用 `/RemoteBrowserOS/` 作为 Vite base 构建和部署 Pages。该应用仍会从最终用户的浏览器直接访问其在弹窗中填写的 MCP 地址。

## 实现边界

当前截图协议是请求/响应式，不是视频流。动态网页、动画和视频通常只能以约 1 FPS 观察；需要更高帧率时应另行增加 WebRTC、VNC 或 CDP Screencast 中继。多用户会话隔离、文件传输、音频和公网鉴权不在首版范围内。
