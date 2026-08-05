"use client"
/**
 * EcoPilot 文档导出工具
 *
 * 三键导出方案（基于 GitHub Top 10 研究）：
 *  - .md   → Blob + file-saver（2.6KB，10 行）
 *  - .docx → html-docx-js asBlob（88.6KB，Windows Word 完美兼容）
 *  - .pdf  → 双模式：
 *           ├─ 默认: window.print() 浏览器原生（矢量+中文+零体积）
 *           └─ 备选: html-to-image + jsPDF 截图法（一键自动下载）
 *
 * 中文处理：浏览器原生打印和截图法天然支持中文，
 *  避免了 jsPDF 嵌入 5-16MB CJK 字体文件的开销。
 */

import { saveAs } from "file-saver"

/** 1. 导出 Markdown 源文件 */
export function exportMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  saveAs(blob, `${filename}.md`)
}

/** 2. 导出 Word .doc —— 纯 HTML+Blob MIME hack（零依赖，所有浏览器支持，Word 可编辑） */
export function exportDocx(htmlContent: string, filename: string): void {
  const fullHtml = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<title>${filename}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: "PingFang SC", "Microsoft YaHei", "Source Han Sans CN", sans-serif; font-size: 11pt; line-height: 1.6; color: #1f2937; }
  h1 { font-size: 22pt; font-weight: 700; margin: 20pt 0 10pt; }
  h2 { font-size: 16pt; font-weight: 700; margin: 16pt 0 8pt; }
  h3 { font-size: 13pt; font-weight: 600; margin: 12pt 0 6pt; }
  p { margin: 6pt 0; }
  code { font-family: "JetBrains Mono", "Courier New", monospace; background: #f3f4f6; padding: 1pt 3pt; font-size: 10pt; }
  pre { background: #f3f4f6; padding: 8pt; border: 1pt solid #e5e7eb; }
  pre code { background: transparent; padding: 0; }
  blockquote { border-left: 3pt solid #10b981; padding-left: 8pt; margin: 8pt 0; color: #6b7280; font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  th, td { border: 1pt solid #d1d5db; padding: 4pt 6pt; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; }
  ul, ol { margin: 6pt 0; padding-left: 20pt; }
  li { margin: 2pt 0; }
  a { color: #047857; }
</style>
</head><body>${htmlContent}</body></html>`
  const blob = new Blob(["\ufeff" + fullHtml], { type: "application/msword;charset=utf-8" })
  saveAs(blob, `${filename}.doc`)
}

/** 3. 导出 PDF —— 方案A: 浏览器原生打印（推荐默认，矢量+中文） */
export function exportPdfPrint(): void {
  window.print()
}

/** 4. 导出 PDF —— 方案B: 截图法（高保真，一键自动下载） */
export async function exportPdfImage(
  element: HTMLElement,
  filename: string,
  onProgress?: (step: "snapshot" | "render" | "done") => void
): Promise<void> {
  onProgress?.("snapshot")
  const { toPng } = await import("html-to-image")
  const { jsPDF } = await import("jspdf")

  // 截图（scale=2 提升清晰度，background 确保白底）
  const dataUrl = await toPng(element, {
    quality: 0.95,
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    filter: (node) => {
      // 过滤掉打印辅助元素
      return !(node instanceof HTMLElement && node.dataset?.printHide === "true")
    },
  })

  onProgress?.("render")
  const pdf = new jsPDF("p", "mm", "a4")
  const imgWidth = 190 // A4 宽 210mm，左右各留 10mm
  const imgHeight = (element.offsetHeight * imgWidth) / element.offsetWidth

  let heightLeft = imgHeight
  let position = 10

  pdf.addImage(dataUrl, "PNG", 10, position, imgWidth, imgHeight)
  heightLeft -= 277 // A4 高 297mm 减去上下边距

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + 10
    pdf.addPage()
    pdf.addImage(dataUrl, "PNG", 10, position, imgWidth, imgHeight)
    heightLeft -= 277
  }

  pdf.save(`${filename}.pdf`)
  onProgress?.("done")
}

/** 工具：从文件名提取干净的 basename（去除扩展名和非法字符） */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/\.(md|markdown|txt)$/i, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim() || "未命名文档"
}
