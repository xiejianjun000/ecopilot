import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 去除 Markdown 格式标记，保留纯文本（用于右侧栏等小空间展示场景）
 * - 标题 `# ## ###` → 移除标记，保留文字
 * - 加粗 `**text**` / 斜体 `*text*` → 移除标记
 * - 链接 `[text](url)` → 保留 text
 * - 分割线 `--- *** ___` → 移除整行
 * - 表格 `|` 线 / 代码块 → 移除标记
 * - 多余空白行 → 压缩为单空行
 */
export function stripMarkdown(md: string): string {
  return md
    // 去掉水平分割线/表格分隔行（整行只含 - * _ | : 和空格）
    .replace(/^[\s]*[-*_|\s:]{3,}[\s]*$/gm, '')
    // 去掉 Markdown 标题标记（保留标题文字）
    .replace(/^#{1,6}\s+/gm, '')
    // 去掉加粗标记（支持跨行，如 **text\nmore**）
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // 去掉斜体标记
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // 去掉链接 [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 去掉图片 ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // 去掉行内代码
    .replace(/`([^`]+)`/g, '$1')
    // 去掉表格管道符
    .replace(/\|/g, ' ')
    // 去掉引用标记（行首 >）
    .replace(/^>\s?/gm, '')
    // 去掉 HTML 标签
    .replace(/<[^>]+>/g, '')
    // 扫尾：去除残留的加粗/斜体/标题标记（不成对的 ** * _ #）
    .replace(/[*_]{1,3}/g, '')
    .replace(/#{1,6}\s?/g, '')
    // 压缩多余的空白行
    .replace(/\n{3,}/g, '\n\n')
    // 去掉行首行尾空白
    .trim()
}
