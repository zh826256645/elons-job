# Elon的工作

一个本地优先的 Chrome Manifest V3 扩展：默认处理 X (`x.com/{user}/status/{id}`) 详情页的回复，可在设置中开启首页 For you 帖子过滤，使用用户自己的 TypeSafe Jev API Key，对高置信度的色情、性暗示和色情引流内容显示可恢复的隐藏占位符。

[隐私政策](privacy.html)

[Chrome Web Store 在线安装](https://chromewebstore.google.com/detail/elon%E7%9A%84%E5%B7%A5%E4%BD%9C/aillmgiicpcpnnggaahlkifchigmfome)

[English](README.en.md)

[MIT License](LICENSE)

## 本地手动编译与安装

环境要求：Node.js 20 或更高版本。

在项目根目录执行以下命令，完成测试、检查并生成 Chrome 扩展产物：

```bash
npm test
npm run check
npm run package
npm run benchmark
```

编译完成后，打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择项目下生成的 `dist/` 目录。第一次安装会自动打开 onboarding。

## 过滤范围

设置中心提供两个独立开关，由全局保护开关统一控制：

- **过滤详情页评论**：默认开启，跳过详情页根帖。
- **过滤 For you 帖子**：默认关闭，开启后按同一套规则处理首页当前选中的 For you 信息流，包括转发、广告及引用文字。Following、搜索、用户主页和列表不处理。

关闭范围开关或切出过滤范围后，已隐藏内容会恢复；旧检测回包不会再次隐藏内容。命中内容可以原位手动恢复。

For you 帖子会结合正文、作者显示名称、@用户名、外链和链接卡片文字识别；后台会为 For you 帖子及带媒体的评论尝试无凭据读取作者公开简介，仅采纳能核对作者身份的结构化资料或公开页面元数据。成功资料缓存 24 小时，失败缓存 10 分钟（最多 200 位作者，浏览器会话内保存）。X 可能返回登录页、403 或没有简介的页面，此时继续使用已有文字识别；无正文也无作者信息时跳过。图片和视频画面不会读取或发送。

For you 中正文仅含外链的帖子，spam 分数达到所设阈值即可隐藏，不再要求额外出现 emoji；带正常讨论文字的帖子及详情页评论仍保留原有防误伤条件。外链本身不会触发隐藏，也不会为识别而访问外链站点。不同页面范围和新版判定分别缓存，升级后会重新检测。

## 效果预览

<p align="center">
  <img src="docs/screenshots/comment-filtering.png" alt="X 评论区过滤效果" width="720">
</p>

命中的评论会被替换为可恢复的隐藏占位符；设置中心默认将每日 TypeSafe 请求上限设为 100,000，并提供缓存、并发和成本保护。

过滤规则支持自定义：可以编辑规则名称、隐藏条件、排除条件和敏感度，用于适配不同社区的内容治理需求。

<p align="center">
  <img src="docs/screenshots/custom-rule-editor.png" alt="自定义评论过滤规则编辑器" width="720">
</p>

## 安全边界

- API Key 只由 service worker 读取，存于 `chrome.storage.local`；popup、设置页只通过消息协议保存/测试。
- content script 向 service worker 发送帖子 ID、过滤范围、用户名及合并后的正文（含引用文字）；纯媒体帖附作者 handle，由后台补充可获取的公开简介。不读取 cookie、history、X 登录信息或详情页根帖内容。
- TypeSafe 请求使用 `https://api.typesafe.ai/v1/systemone`；API 返回不符合预期、超时、401、429 或 5xx 时 Fail Open。
- 分类缓存使用最终分析文字（含简介）、规则 fingerprint 和 model 的 hash 作为 key，不保存帖子原文；作者资料缓存独立保存公开简介，可通过设置页清空缓存一并清除。
- `manifest.json` 未申请 `tabs`、`history`、`cookies`、`webRequest` 或 `<all_urls>`。

## 测试覆盖

`tests/` 覆盖默认规则、规则编译、文本 normalize、Root Tweet/详情页和 For you 范围、配置迁移、纯媒体/引用帖提取、公开简介身份校验/缓存/失败降级、SHA-256 cache key、阈值决策、API 响应解析、存储脱敏和 Fail-Open 错误分类。实际 TypeSafe 调用需要用户自己的 API Key，因此自动化测试使用确定性 mock，不会产生 API 成本。

本地语料库位于 `tests/fixtures/comment-corpus.json`，包含正常评论、医学/教育、普通恋爱、外貌评价、隐晦性暗示、私密内容、联系方式、emoji、长数字 ID、用户名色情/招揽信号，以及“搞hs / 小马开大车”和截图标注的 `emoji spam` 样本。`emoji spam` 样本额外记录 `spam: true`，由启用的 `spam_behavior` 规则单独评估；该规则同时使用 TypeSafe 分数和页面内去 emoji 后的重复模板信号，命中后会进入最终隐藏决策。当前 `npm run benchmark` 会将这些样本从色情规则指标中排除，但会单独输出 `spam-samples` 的 Precision/Recall/F1，不会把它们当作成功样本。配置 `.env` 中的 `TYPESAFE_API_KEY` 后运行 benchmark，脚本只输出 Precision、Recall、F1、误报/漏报 ID 和延迟，不输出 API Key；可用 `--limit=10` 做小样本检查，或 `--json` 输出不含原文的机器可读结果。

也可以按语料 ID 精确回归：`bun run benchmark -- --id=hide-040`。单条 ID 会输出详细评估，包括用户名、正文、emoji 结构信号、默认规则概率/阈值/命中状态、最终判定和实际发送内容；多个 ID 使用逗号分隔：`bun run benchmark -- --ids=hide-040,hide-041`。
