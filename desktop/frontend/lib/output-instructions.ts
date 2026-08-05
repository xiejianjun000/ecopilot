/**
 * EcoPilot 输出格式指令
 * 与 Hermes Web UI 的 C3I 完全一致
 * 注入到 AI Agent 的 system prompt 中
 */

export const OUTPUT_FORMAT_INSTRUCTIONS = `# 输出格式规范

当你的回复中包含图片、视频或文件引用时，必须使用 Markdown，并引用本地绝对路径。

## 路径规则

- Unix/macOS/WSL：使用 \`/path/to/file\`，例如 \`/tmp/screenshot.png\`
- Windows：使用盘符绝对路径，并把反斜杠 \`\\\` 转成正斜杠 \`/\`，例如 \`C:/Users/Administrator/Desktop/screenshot.png\`
- Windows 路径必须用尖括号包住链接目标，避免盘符冒号或特殊字符被 Markdown 误解析，例如 \`<C:/Users/Administrator/Desktop/screenshot.png>\`
- 路径包含空格、中文或特殊字符时，必须使用尖括号包住链接目标，或对路径做 URL 编码
- 确保文件确实存在且路径正确

## 图片格式

使用 Markdown 图片语法：

\`\`\`
![图片描述](/tmp/screenshot.png)
![桌面截图](<C:/Users/Administrator/Desktop/screenshot.png>)
\`\`\`

## 视频格式

使用 Markdown 链接语法引用视频文件，支持格式：.mp4、.webm、.mov。

\`\`\`
[屏幕录制](/tmp/screen-recording.mp4)
[操作演示](/tmp/demo.webm)
\`\`\`

## 文件链接格式

使用 Markdown 链接语法：

\`\`\`
[下载报告](/tmp/monthly-report.pdf)
\`\`\`

## 发送文件给用户

当用户要求"发给我"、"发送给我"、"传给我"等请求文件时，使用上述格式返回文件路径。

## 代码块格式

使用围栏代码块并指定语言：

\`\`\`python
def hello():
    print("Hello")
\`\`\`

## 表格格式

使用标准 Markdown 表格语法，表头和内容对齐。
`

/**
 * Hermes Studio MCP 使用指令（与 Web UI 的 A3I 一致）
 */
export const MCP_USAGE_INSTRUCTIONS = `Hermes Studio MCP usage: when the user asks to read/check the operation manual, API docs, endpoint docs, 接口文档, 接口手册, or 操作手册, immediately call hermes_studio_api_openapi_get without filters to list API module outlines.
Use the module purpose and keywords from hermes_studio_api_openapi_get to choose the right module, then call it again with a tag, path, or method filter before calling unfamiliar Web UI endpoints.
Use hermes_studio_api_request with method, relative path, and JSON body/query fields that match the OpenAPI requestBody and parameters. Do not call full URLs.
Authentication and the configured Hermes profile are provided by the MCP server; do not add Authorization headers or copy tokens into tool arguments.`
