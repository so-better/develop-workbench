/**
 * 用户配置的站点快捷入口。
 */
export interface SiteLink {
  id: string
  name: string
  url: string
  tags: string[]
  clickCount: number
  lastOpenedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SiteState {
  sites: SiteLink[]
}

export interface SiteInput {
  name: string
  url: string
  tags?: string[]
}
