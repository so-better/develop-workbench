import { isRecord } from '../../../utils'

/**
 * 读取 MCP 工具展示名。
 * 优先使用 annotations.title，缺失时把原始工具名格式化为可读文本。
 */
export const getToolLabel = (definition: {
  name: string
  annotations?: unknown
}): string => {
  if (isRecord(definition.annotations)) {
    const title = definition.annotations.title

    if (typeof title === 'string' && title.trim()) return title.trim()
  }

  return definition.name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase())
}
