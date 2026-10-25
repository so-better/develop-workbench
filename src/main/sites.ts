/**
 * 站点快捷入口配置。
 * 数据保存在应用 userData 目录，与偏好和仓库配置隔离。
 */
import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupCorruptStore } from './store-backup'
import type { SiteInput, SiteLink, SiteState } from '../types/sites'

const STORE_FILE = 'sites.json'
const MAX_NAME_LENGTH = 60
const MAX_TAGS = 10
const MAX_TAG_LENGTH = 20

const getStorePath = (): string => join(app.getPath('userData'), STORE_FILE)

const normalizeText = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''

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

const normalizeUrl = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('站点 URL 不合法')

  let normalized = value.trim()

  if (!normalized) throw new Error('站点 URL 不能为空')

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`
  }

  let url: URL

  try {
    url = new URL(normalized)
  } catch {
    throw new Error('站点 URL 格式不正确')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('站点只支持 http/https 地址')
  }

  return url.toString()
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
      url: normalizeUrl(site.url),
      tags: normalizeTags(site.tags),
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

const toInput = (input: SiteInput): { name: string; url: string; tags: string[] } => {
  if (!input || typeof input !== 'object') throw new Error('站点参数不合法')

  const name = normalizeText(input.name, MAX_NAME_LENGTH)

  if (!name) throw new Error('站点名称不能为空')

  return {
    name,
    url: normalizeUrl(input.url),
    tags: normalizeTags(input.tags)
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

export const addSite = async (input: SiteInput): Promise<SiteState> => {
  const normalized = toInput(input)
  const sites = await readSites()

  assertUniqueSiteUrl(sites, normalized.url)

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

export const updateSite = async (id: string, input: SiteInput): Promise<SiteState> => {
  if (!id.trim()) throw new Error('站点 ID 不合法')

  const normalized = toInput(input)
  const sites = await readSites()
  const existing = sites.find((site) => site.id === id)

  if (!existing) throw new Error('站点不存在')

  assertUniqueSiteUrl(sites, normalized.url, id)

  await writeSites(
    sites.map((site) =>
      site.id === id
        ? {
            ...site,
            ...normalized,
            updatedAt: new Date().toISOString()
          }
        : site
    )
  )

  return getSiteState()
}

export const recordSiteOpen = async (id: string): Promise<SiteState> => {
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

export const reorderSites = async (ids: string[]): Promise<SiteState> => {
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

export const removeSite = async (id: string): Promise<SiteState> => {
  if (!id.trim()) throw new Error('站点 ID 不合法')

  await writeSites((await readSites()).filter((site) => site.id !== id))

  return getSiteState()
}

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
