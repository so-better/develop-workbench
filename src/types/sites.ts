/** 站点环境标记。 */
export const SITE_ENVS = ['prod', 'test', 'staging', 'dev', 'gray'] as const

export type SiteEnv = (typeof SITE_ENVS)[number]

/**
 * 用户配置的站点快捷入口。
 */
export interface SiteLink {
  id: string
  name: string
  url: string
  tags: string[]
  env: SiteEnv | null
  /** 是否标记为重要站点。 */
  important: boolean
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
  env?: SiteEnv | null
  important?: boolean
}
