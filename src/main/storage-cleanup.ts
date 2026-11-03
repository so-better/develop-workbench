/**
 * 存储清理。
 * 只处理可再生成的缓存、临时产物和损坏备份，不清理业务配置与本机文件。
 */
import { app, BrowserWindow, ipcMain, session } from 'electron'
import type { Session } from 'electron'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { clearAiArtifacts, getAiArtifactStats } from './ai/artifacts'
import {
  BROWSER_PARTITION,
  clearEmbeddedBrowserDownloadHistory,
  closeEmbeddedBrowserForCleanup,
  getEmbeddedBrowserDownloadHistoryStats
} from './embedded-browser'
import type {
  StorageCleanupItem,
  StorageCleanupKind,
  StorageCleanupStats
} from '../types/storage-cleanup'

const CACHE_DIRECTORY_NAMES = ['Cache', 'Code Cache', 'Shared Dictionary']

const STORAGE_CLEANUP_KINDS: StorageCleanupKind[] = [
  'ai-artifacts',
  'browser-cache',
  'app-cache',
  'download-records',
  'corrupt-backups'
]

const isStorageCleanupKind = (value: unknown): value is StorageCleanupKind =>
  typeof value === 'string' &&
  STORAGE_CLEANUP_KINDS.includes(value as StorageCleanupKind)

const emptyItem = (): StorageCleanupItem => ({ count: 0, bytes: 0 })

/** 递归统计目录中的文件数量和大小。 */
const getDirectoryStats = async (directory: string): Promise<StorageCleanupItem> => {
  let entries

  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyItem()
    throw error
  }

  const stats = emptyItem()

  for (const entry of entries) {
    const target = join(directory, entry.name)

    if (entry.isDirectory()) {
      const child = await getDirectoryStats(target)

      stats.count += child.count
      stats.bytes += child.bytes
      continue
    }

    if (!entry.isFile()) continue

    const fileStat = await stat(target).catch(() => null)

    if (!fileStat) continue

    stats.count += 1
    stats.bytes += fileStat.size
  }

  return stats
}

const getDirectoryListStats = async (
  root: string | null,
  names: string[]
): Promise<StorageCleanupItem> => {
  if (!root) return emptyItem()

  const results = await Promise.all(
    names.map((name) => getDirectoryStats(join(root, name)))
  )

  return results.reduce(
    (total, item) => ({
      count: total.count + item.count,
      bytes: total.bytes + item.bytes
    }),
    emptyItem()
  )
}

const getBrowserCacheStats = async (): Promise<StorageCleanupItem> =>
  getDirectoryListStats(
    session.fromPartition(BROWSER_PARTITION).getStoragePath(),
    CACHE_DIRECTORY_NAMES
  )

const getAppCacheStats = async (): Promise<StorageCleanupItem> =>
  getDirectoryListStats(
    session.defaultSession.getStoragePath() ?? app.getPath('userData'),
    CACHE_DIRECTORY_NAMES
  )

const getCorruptBackups = async (): Promise<{
  files: string[]
  stats: StorageCleanupItem
}> => {
  let entries

  try {
    entries = await readdir(app.getPath('userData'), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { files: [], stats: emptyItem() }
    }

    throw error
  }

  const files: string[] = []
  const stats = emptyItem()

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.includes('.corrupt-')) continue

    const filePath = join(app.getPath('userData'), entry.name)
    const fileStat = await stat(filePath).catch(() => null)

    if (!fileStat) continue

    files.push(filePath)
    stats.count += 1
    stats.bytes += fileStat.size
  }

  return { files, stats }
}

const clearSessionCaches = async (target: Session): Promise<void> => {
  await target.clearCache()
  await target.clearCodeCaches({ urls: [] })
  await target.clearSharedDictionaryCache()
  await target.clearHostResolverCache()
}

const closeOpenBrowsers = async (): Promise<void> => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    await closeEmbeddedBrowserForCleanup(window)
  }
}

export const getStorageCleanupStats = async (): Promise<StorageCleanupStats> => {
  const [aiArtifacts, browserCache, appCache, downloads, corrupt] =
    await Promise.all([
      getAiArtifactStats(),
      getBrowserCacheStats(),
      getAppCacheStats(),
      Promise.resolve(getEmbeddedBrowserDownloadHistoryStats()),
      getCorruptBackups()
    ])

  return {
    items: {
      'ai-artifacts': aiArtifacts,
      'browser-cache': browserCache,
      'app-cache': appCache,
      'download-records': downloads,
      'corrupt-backups': corrupt.stats
    }
  }
}

export const clearStorageItem = async (
  kindValue: unknown
): Promise<StorageCleanupStats> => {
  if (!isStorageCleanupKind(kindValue)) {
    throw new Error('存储清理类型不合法')
  }

  switch (kindValue) {
    case 'ai-artifacts':
      await clearAiArtifacts()
      break
    case 'browser-cache':
      await closeOpenBrowsers()
      await clearSessionCaches(session.fromPartition(BROWSER_PARTITION))
      break
    case 'app-cache':
      await clearSessionCaches(session.defaultSession)
      break
    case 'download-records':
      clearEmbeddedBrowserDownloadHistory()
      break
    case 'corrupt-backups': {
      const { files } = await getCorruptBackups()
      const failures: string[] = []

      await Promise.all(
        files.map(async (file) => {
          try {
            await rm(file, { force: true })
          } catch {
            failures.push(file)
          }
        })
      )

      if (failures.length > 0) {
        throw new Error(`有 ${failures.length} 个损坏备份文件删除失败`)
      }
      break
    }
  }

  return getStorageCleanupStats()
}

/**
 * 注册存储清理 IPC。
 */
export const initializeStorageCleanup = (): void => {
  ipcMain.handle('storage:get-stats', () => getStorageCleanupStats())
  ipcMain.handle('storage:clear', (_event, kind: unknown) =>
    clearStorageItem(kind)
  )
}
