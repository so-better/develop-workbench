/**
 * 链接预览信息。
 */
export interface LinkPreview {
  /** 原始链接。 */
  url: string

  /** 页面或文档标题。 */
  title: string | null

  /** 页面摘要。 */
  description: string | null

  /** 站点名称。 */
  siteName: string | null

  /** 链接类型标签，例如“飞书文档”“网页”。 */
  type: string

  /** 域名。 */
  host: string

  /** 是否来自飞书域名。 */
  isFeishu: boolean
}
