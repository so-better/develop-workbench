import type { ToolSet } from 'ai'
import { fileTools } from './files'
import { skillTools } from './skills'

export { getToolArtifact } from './files'

/** 所有应用内置工具，按业务域拆分后在当前文件汇总。 */
export const localTools: ToolSet = {
  ...skillTools,
  ...fileTools
}

/**
 * 从工具定义的 metadata.label 构建展示名映射。
 * metadata 不发送给模型，只用于界面的工具状态展示。
 */
export const buildToolLabels = (tools: ToolSet): Map<string, string> => {
  const labels = new Map<string, string>()

  for (const [name, item] of Object.entries(tools)) {
    const label = (item as { metadata?: { label?: unknown } }).metadata?.label

    labels.set(name, typeof label === 'string' && label ? label : name)
  }

  return labels
}
