/**
 * Obsidian Vault 同步工具
 *
 * EcoPilot 将企业知识以 Markdown 格式写入 Obsidian vault，
 * 包含 YAML frontmatter 和 [[双向链接]]。
 */

import type { PermitInfo } from './permit-parser'

/** vault 根路径 */
function getHomeDir(): string {
  if (typeof process !== 'undefined' && process.env?.HOME) return process.env.HOME
  if (typeof window !== 'undefined') {
    // Electron 环境
    return (window as any).hermesDesktop?.homeDir || '/Users/mac'
  }
  return '/Users/mac'
}

export const VAULT_ROOT = `${getHomeDir()}/Documents/eco-knowledge`

/** EcoPilot 在 vault 中的工作目录 */
export const ECOPILOT_VAULT_DIR = `${VAULT_ROOT}/ecopilot-enterprise`

/** 文件 frontmatter 模板 */
interface VaultFrontmatter {
  name?: string
  type: string
  tags: string[]
  created: string
  updated: string
  ecoLinks: string[]
  [key: string]: unknown
}

/**
 * 从许可证信息创建企业主页
 */
export function createEnterpriseNote(permit: PermitInfo): string {
  const fm: VaultFrontmatter = {
    name: permit.enterpriseName,
    type: 'enterprise',
    tags: ['ecopilot', 'enterprise', permit.industryCategory],
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
    ecoLinks: [
      `[[排污许可证-${permit.permitNumber}]]`,
      ...permit.emissionOutlets.map(o => `[[${o.code}-${o.name}]]`),
    ],
    creditCode: permit.creditCode,
    industryCategory: permit.industryCategory,
    managementLevel: permit.managementLevel,
    address: permit.address,
  }

  const frontmatter = generateFrontmatter(fm)

  return `${frontmatter}
# ${permit.enterpriseName}

## 基本信息
- **统一社会信用代码**：${permit.creditCode || '待补充'}
- **行业类别**：${permit.industryCategory || '待确认'}
- **管理类别**：${permit.managementLevel || '待确认'}
- **地址**：${permit.address || '待补充'}
- **法定代表人**：${permit.legalRepresentative || '待补充'}

## 排污许可证
- **编号**：[[排污许可证-${permit.permitNumber}]]
- **有效期**：${permit.validFrom || '?'} → ${permit.validTo || '?'}
- **发证机关**：${permit.issuingAuthority || '待确认'}

## 排放口
${permit.emissionOutlets.map(o =>
  `- [[${o.code}-${o.name}]]（${o.type}排放口）`
).join('\n') || '待补充'}

## 管理要求
${permit.managementRequirements.map(r =>
  `- [ ] ${r.category}：${r.content}（${r.frequency}）`
).join('\n') || '待从许可证副本提取'}

## 相关档案
- [[档案库/INDEX|档案库索引]]
- [[合规事件/INDEX|合规事件索引]]
`
}

/**
 * 从许可证信息创建排污许可证笔记
 */
export function createPermitNote(permit: PermitInfo): string {
  const fm: VaultFrontmatter = {
    name: `排污许可证-${permit.permitNumber}`,
    type: 'permit',
    tags: ['ecopilot', 'permit', '排污许可证'],
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
    ecoLinks: [
      `[[${permit.enterpriseName}]]`,
      ...permit.emissionOutlets.map(o => `[[${o.code}-${o.name}]]`),
    ],
    permitNumber: permit.permitNumber,
    validFrom: permit.validFrom,
    validTo: permit.validTo,
  }

  const frontmatter = generateFrontmatter(fm)

  return `${frontmatter}
# 排污许可证

## 基本信息
- **企业**：[[${permit.enterpriseName}]]
- **编号**：${permit.permitNumber}
- **发证机关**：${permit.issuingAuthority || '待确认'}
- **有效期**：${permit.validFrom || '?'} → ${permit.validTo || '?'}

## 排放标准
${permit.emissionOutlets.map(o =>
  `### ${o.code} - ${o.name}
| 因子 | 限值 | 单位 | 标准来源 |
|------|:----:|:----:|----------|
${o.limits.map(l =>
  `| ${l.factor} | ${l.limit} | ${l.unit} | ${l.standardSource} |`
).join('\n')}`
).join('\n\n') || '待从许可证副本提取'}

## 管理要求
${permit.managementRequirements.map(r =>
  `- **${r.category}**：${r.content}（${r.frequency}）`
).join('\n') || '待从许可证副本提取'}

## 合规事件
- 已关联到 [[${permit.enterpriseName}#合规事件]]
`
}

/**
 * 创建排放口笔记
 */
export function createOutletNote(
  outlet: PermitInfo['emissionOutlets'][0],
  enterpriseName: string,
  permitNumber: string
): string {
  const fm: VaultFrontmatter = {
    name: `${outlet.code}-${outlet.name}`,
    type: 'outlet',
    tags: ['ecopilot', 'outlet', outlet.type],
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
    ecoLinks: [
      `[[${enterpriseName}]]`,
      `[[排污许可证-${permitNumber}]]`,
    ],
    outletCode: outlet.code,
    outletType: outlet.type,
  }

  const frontmatter = generateFrontmatter(fm)

  return `${frontmatter}
# ${outlet.code} - ${outlet.name}

## 基本信息
- **编号**：${outlet.code}
- **名称**：${outlet.name}
- **类型**：${outlet.type}排放口
- **所属企业**：[[${enterpriseName}]]
- **许可证**：[[排污许可证-${permitNumber}]]

## 排放标准
| 因子 | 限值 | 单位 | 标准来源 |
|------|:----:|:----:|----------|
${outlet.limits.map(l =>
  `| ${l.factor} | ${l.limit} | ${l.unit} | ${l.standardSource} |`
).join('\n')}

## 监测数据
- [[监测数据/${outlet.code}-日报|日报数据]]
- [[监测数据/${outlet.code}-趋势|趋势分析]]

## 合规事件
- 暂无记录
`
}

/** 生成 YAML frontmatter */
function generateFrontmatter(fm: VaultFrontmatter): string {
  const lines = ['---']
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`)
      } else {
        lines.push(`${key}:`)
        value.forEach(v => lines.push(`  - ${JSON.stringify(v)}`))
      }
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    }
  }
  lines.push('---')
  lines.push('')
  return lines.join('\n')
}

/**
 * 写入 vault 文件
 */
export async function writeVaultFile(
  relativePath: string,
  content: string
): Promise<void> {
  // 通过 Hermes 桌面端的 write_file 能力写入
  // 在 Hermes Desktop 环境中使用 window.hermesDesktop.api
  if (typeof window !== 'undefined' && window.hermesDesktop) {
    const fullPath = `${ECOPILOT_VAULT_DIR}/${relativePath}`
    // 确保父目录存在（通过递归创建）
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
    await window.hermesDesktop.api({
      path: '/api/tools/write_file',
      method: 'POST',
      body: {
        path: fullPath,
        content,
        create_dirs: true,
      },
    })
  }
}

/**
 * 初始化企业 vault 结构
 */
export async function initializeEnterpriseVault(permit: PermitInfo): Promise<void> {
  const dirs = [
    '企业概况',
    '排放口',
    '档案库',
    '执行报告',
    '监测数据',
    '合规事件',
    '法规库',
    'Templates',
  ]

  for (const dir of dirs) {
    await writeVaultFile(`${dir}/.gitkeep`, '')
  }

  // 创建核心笔记
  await writeVaultFile(
    `企业概况/${permit.enterpriseName}.md`,
    createEnterpriseNote(permit)
  )

  await writeVaultFile(
    `企业概况/排污许可证-${permit.permitNumber}.md`,
    createPermitNote(permit)
  )

  // 创建排放口笔记
  for (const outlet of permit.emissionOutlets) {
    await writeVaultFile(
      `排放口/${outlet.code}-${outlet.name}.md`,
      createOutletNote(outlet, permit.enterpriseName, permit.permitNumber)
    )
  }
}
