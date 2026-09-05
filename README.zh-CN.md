# Crawlmark

输入公开网址，检查它的抓取、索引和内容提取信号。每个结论都有实际观察、修改建议和参考资料。

[English](README.md) · [在线示例](https://yougan001.github.io/crawlmark/)

当前版本提供检测引擎、Node 服务和报告界面。在线页面暂时只运行明确标注的示例；真正的网址检测需要启动本地服务或自行部署后端。GitHub Pages 只托管静态页面，不能抓取任意网站。

## 能检查什么

13 项检查包括响应状态、跳转、Googlebot robots.txt 规则、noindex、摘要限制、canonical、标题、描述、源代码中的正文与标题层级、JSON-LD 解析和图片 alt 属性。报告可以筛选，并导出完整 JSON。

分数只是这个项目的检查清单。未知项降低覆盖率，不会被算成通过；noindex 等阻断项始终单独提示。不会拿静态检查结果冒充排名预测、收录查询或 GEO 引用概率。

![带证据和修改建议的检测报告](docs/images/workspace.png)

## 本地运行

需要 Node 22.13 或以上版本：

```sh
npm ci
npm test
npm run api
```

另开终端运行 `npm run dev -- --port 5184`，打开 `http://localhost:5184`。服务默认只监听本机。部署前请读[安全说明](docs/security.md)，不要提交密码、内网地址、私密链接或带签名的网址。

## 边界

只检查初始 HTML，不执行页面脚本，不模拟 Googlebot 登录态，也不扫描整个网站。没有源代码正文不等于浏览器渲染后没有正文。JSON-LD 能解析不等于符合搜索引擎的结构化数据要求。

HTML、DNS、跳转、响应大小、超时和并发都有明确限制。缺少 llms.txt 或 JSON-LD 不会自动扣分。[评分方法](docs/method.md)和[测试记录](docs/testing.md)说明了每项检查的依据和限制。

欢迎带着可复现的小样本提 issue；请先去掉真实隐私数据。MIT 许可证。
