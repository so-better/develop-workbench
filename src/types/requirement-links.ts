/** 自动提取和手动录入共用的链接内容，名称不依赖目标页面的网络请求。 */
export interface RequirementLinkInput {
  name: string
  url: string
}

export interface RequirementLink extends RequirementLinkInput {
  /** 本地生成的稳定 ID，修改地址后仍用于定位同一条记录。 */
  id: string
}

/** 按空间和需求共同隔离数据，兼容 Meegle 与本地临时需求。 */
export interface RequirementLinkScope {
  projectKey: string
  requirementId: string
}

/** 保留查询参数和锚点，只规范化 URL 本身。 */
export const normalizeRequirementLinkUrl = (value: string): string => {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请输入 HTTP 或 HTTPS 链接')
  return url.href
}
