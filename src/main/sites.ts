/**
 * 站点快捷入口配置。
 * 数据保存在应用 userData 目录，与偏好和仓库配置隔离。
 */
import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupCorruptStore } from './store-backup'
import { SITE_ENVS } from '../types/sites'
import type { SiteEnv, SiteInput, SiteLink, SiteState } from '../types/sites'
import { normalizeHttpUrl, normalizeText } from '../utils'

const STORE_FILE = 'sites.json'
const MAX_NAME_LENGTH = 60
const MAX_TAGS = 10
const MAX_TAG_LENGTH = 20
const MAX_IMPORTANT_SITES = 4

const getStorePath = (): string => join(app.getPath('userData'), STORE_FILE)

const normalizeSiteEnv = (value: unknown): SiteEnv | null => {
  if (typeof value !== 'string') return null

  return (SITE_ENVS as readonly string[]).includes(value)
    ? (value as SiteEnv)
    : null
}

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(
      value
        .map((tag) => normalizeText(tag, MAX_TAG_LENGTH))
        .filter(Boolean)
    )
  ).slice(0, MAX_TAGS)
}

const normalizeStoredSite = (value: unknown): SiteLink | null => {
  if (!value || typeof value !== 'object') return null

  const site = value as Record<string, unknown>

  if (
    typeof site.id !== 'string' ||
    typeof site.name !== 'string' ||
    typeof site.url !== 'string' ||
    typeof site.createdAt !== 'string' ||
    typeof site.updatedAt !== 'string'
  ) {
    return null
  }

  try {
    return {
      id: site.id,
      name: site.name.trim(),
      url: normalizeHttpUrl(site.url, '站点 URL'),
      tags: normalizeTags(site.tags),
      env: normalizeSiteEnv(site.env),
      important: site.important === true,
      clickCount: Math.max(0, Math.floor(Number(site.clickCount) || 0)),
      lastOpenedAt:
        typeof site.lastOpenedAt === 'string' ? site.lastOpenedAt : null,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt
    }
  } catch {
    return null
  }
}

const readSites = async (): Promise<SiteLink[]> => {
  let raw: string

  try {
    raw = await readFile(getStorePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  try {
    const parsed = JSON.parse(raw) as { sites?: unknown }

    if (!Array.isArray(parsed.sites)) return []

    return parsed.sites
      .map(normalizeStoredSite)
      .filter((site): site is SiteLink => Boolean(site))
  } catch {
    await backupCorruptStore(getStorePath())
    return []
  }
}

const writeSites = async (sites: SiteLink[]): Promise<void> => {
  const filePath = getStorePath()
  const temporaryPath = `${filePath}.${Date.now()}.tmp`

  await writeFile(temporaryPath, JSON.stringify({ sites }, null, 2), 'utf8')
  await rename(temporaryPath, filePath)
}

const toInput = (
  input: SiteInput
): {
  name: string
  url: string
  tags: string[]
  env: SiteEnv | null
  important: boolean
} => {
  if (!input || typeof input !== 'object') throw new Error('站点参数不合法')

  const name = normalizeText(input.name, MAX_NAME_LENGTH)

  if (!name) throw new Error('站点名称不能为空')

  return {
    name,
    url: normalizeHttpUrl(input.url, '站点 URL'),
    tags: normalizeTags(input.tags),
    env: normalizeSiteEnv(input.env),
    important: input.important === true
  }
}

const assertImportantSiteLimit = (
  sites: SiteLink[],
  important: boolean,
  excludeId?: string
): void => {
  if (!important) return

  const count = sites.filter(
    (site) => site.id !== excludeId && site.important
  ).length

  if (count >= MAX_IMPORTANT_SITES) {
    throw new Error(`重要站点最多 ${MAX_IMPORTANT_SITES} 个`)
  }
}

export const getSiteState = async (): Promise<SiteState> => ({
  sites: await readSites()
})

const assertUniqueSiteUrl = (
  sites: SiteLink[],
  url: string,
  excludeId?: string
): void => {
  if (sites.some((site) => site.id !== excludeId && site.url === url)) {
    throw new Error('该站点 URL 已存在')
  }
}

const addSiteUnlocked = async (input: SiteInput): Promise<SiteState> => {
  const normalized = toInput(input)
  const sites = await readSites()

  assertUniqueSiteUrl(sites, normalized.url)
  assertImportantSiteLimit(sites, normalized.important)

  const now = new Date().toISOString()

  await writeSites([
    {
      id: randomUUID(),
      ...normalized,
      clickCount: 0,
      lastOpenedAt: null,
      createdAt: now,
      updatedAt: now
    },
    ...sites
  ])

  return getSiteState()
}

const updateSiteUnlocked = async (id: string, input: SiteInput): Promise<SiteState> => {
  if (!id.trim()) throw new Error('站点 ID 不合法')

  const normalized = toInput(input)
  const sites = await readSites()
  const existing = sites.find((site) => site.id === id)

  if (!existing) throw new Error('站点不存在')

  assertUniqueSiteUrl(sites, normalized.url, id)

  // AI 工具等未传 important 时保留原值，避免普通更新意外取消重要标记。
  const important =
    input.important === undefined ? existing.important : normalized.important
  assertImportantSiteLimit(sites, important, id)

  await writeSites(
    sites.map((site) =>
      site.id === id
        ? {
            ...site,
            ...normalized,
            important,
            updatedAt: new Date().toISOString()
          }
        : site
    )
  )

  return getSiteState()
}

const recordSiteOpenUnlocked = async (id: string): Promise<SiteState> => {
  if (!id.trim()) throw new Error('站点 ID 不合法')

  const sites = await readSites()
  const existing = sites.find((site) => site.id === id)

  if (!existing) throw new Error('站点不存在')

  await writeSites(
    sites.map((site) =>
      site.id === id
        ? {
            ...site,
            clickCount: site.clickCount + 1,
            lastOpenedAt: new Date().toISOString()
          }
        : site
    )
  )

  return getSiteState()
}

const reorderSitesUnlocked = async (ids: string[]): Promise<SiteState> => {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new Error('站点排序参数不合法')
  }

  const sites = await readSites()
  const siteMap = new Map(sites.map((site) => [site.id, site]))
  const uniqueIds = new Set(ids)

  if (
    ids.length !== sites.length ||
    uniqueIds.size !== ids.length ||
    !ids.every((id) => siteMap.has(id))
  ) {
    throw new Error('站点排序数据不完整')
  }

  await writeSites(ids.map((id) => siteMap.get(id) as SiteLink))

  return getSiteState()
}

const removeSiteUnlocked = async (id: string): Promise<SiteState> => {
  if (!id.trim()) throw new Error('站点 ID 不合法')

  await writeSites((await readSites()).filter((site) => site.id !== id))

  return getSiteState()
}

let siteWriteQueue: Promise<unknown> = Promise.resolve()

/** 串行化站点写操作，避免并发读改写互相覆盖。 */
const withSiteWriteLock = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = siteWriteQueue.then(operation, operation)

  siteWriteQueue = result.then(
    () => undefined,
    () => undefined
  )

  return result
}

export const addSite = (input: SiteInput): Promise<SiteState> =>
  withSiteWriteLock(() => addSiteUnlocked(input))

export const updateSite = (
  id: string,
  input: SiteInput
): Promise<SiteState> => withSiteWriteLock(() => updateSiteUnlocked(id, input))

export const recordSiteOpen = (id: string): Promise<SiteState> =>
  withSiteWriteLock(() => recordSiteOpenUnlocked(id))

export const reorderSites = (ids: string[]): Promise<SiteState> =>
  withSiteWriteLock(() => reorderSitesUnlocked(ids))

export const removeSite = (id: string): Promise<SiteState> =>
  withSiteWriteLock(() => removeSiteUnlocked(id))

export const initializeSites = (): void => {
  ipcMain.handle('sites:get-state', () => getSiteState())
  ipcMain.handle('sites:add', (_event, input: unknown) => addSite(input as SiteInput))
  ipcMain.handle('sites:update', (_event, id: unknown, input: unknown) => {
    if (typeof id !== 'string') throw new Error('站点 ID 不合法')
    return updateSite(id, input as SiteInput)
  })
  ipcMain.handle('sites:open', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('站点 ID 不合法')
    return recordSiteOpen(id)
  })
  ipcMain.handle('sites:reorder', (_event, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('站点排序参数不合法')
    return reorderSites(ids as string[])
  })
  ipcMain.handle('sites:remove', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('站点 ID 不合法')
    return removeSite(id)
  })
}
