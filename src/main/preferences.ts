import { app } from 'electron'
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { backupCorruptStoreSync } from './store-backup'
import type { ThemeMode } from '../types/theme'
import { isIdePresetId } from '../types/ide'
import type { IdeConfig } from '../types/ide'

/**
 * 应用级偏好。
 * 主题和外部工具路径统一保存在同一个文件中，避免多个模块互相覆盖。
 */
export interface AppPreferences {
  theme: ThemeMode
  larkCliPath?: string
  meegleCliPath?: string
  meegleProjectKey?: string
  repositoryRoot?: string
  gitPath?: string
  ide?: IdeConfig
  skillDirectories?: string[]
  productGuideSeenVersion?: number
}

const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'system'
}

// 内存缓存，避免频繁访问磁盘。
let cachedPreferences: AppPreferences | null = null

/**
 * 校验主题值是否合法。
 */
const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'system' || value === 'light' || value === 'dark'

/**
 * 校验持久化的 IDE 配置。
 */
const isIdeConfig = (value: unknown): value is IdeConfig => {
  if (!value || typeof value !== 'object') return false

  const config = value as Record<string, unknown>

  return (
    isIdePresetId(config.preset) &&
    typeof config.name === 'string' &&
    typeof config.command === 'string' &&
    Array.isArray(config.args) &&
    config.args.every((arg) => typeof arg === 'string')
  )
}

/**
 * 标准化可选路径。
 * 空字符串按未配置处理。
 */
const normalizePath = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined

  const normalized = value.trim()
  return normalized || undefined
}

/**
 * 偏好文件路径。
 * 位于 Electron userData 目录，跟随用户环境隔离。
 */
const getPreferencesPath = (): string => join(app.getPath('userData'), 'preferences.json')

/**
 * 从磁盘读取偏好。
 * 文件不存在或字段非法时使用安全默认值。
 */
const readPreferences = (): AppPreferences => {
  if (cachedPreferences) return cachedPreferences

  let raw: string

  try {
    raw = readFileSync(getPreferencesPath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      cachedPreferences = { ...DEFAULT_PREFERENCES }
      return cachedPreferences
    }

    throw error
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    backupCorruptStoreSync(getPreferencesPath())
    cachedPreferences = { ...DEFAULT_PREFERENCES }
    return cachedPreferences
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    backupCorruptStoreSync(getPreferencesPath())
    cachedPreferences = { ...DEFAULT_PREFERENCES }
    return cachedPreferences
  }

  const value = parsed as {
    theme?: unknown
    larkCliPath?: unknown
    meegleCliPath?: unknown
    meegleProjectKey?: unknown
    repositoryRoot?: unknown
    gitPath?: unknown
    ide?: unknown
    skillDirectories?: unknown
    productGuideSeenVersion?: unknown
  }

  cachedPreferences = {
    theme: isThemeMode(value.theme) ? value.theme : DEFAULT_PREFERENCES.theme,
    larkCliPath: normalizePath(value.larkCliPath),
    meegleCliPath: normalizePath(value.meegleCliPath),
    meegleProjectKey: normalizePath(value.meegleProjectKey),
    repositoryRoot: normalizePath(value.repositoryRoot),
    gitPath: normalizePath(value.gitPath),
    ide: isIdeConfig(value.ide) ? value.ide : undefined,
    skillDirectories: Array.isArray(value.skillDirectories)
      ? value.skillDirectories
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined,
    productGuideSeenVersion:
      typeof value.productGuideSeenVersion === 'number' &&
      Number.isInteger(value.productGuideSeenVersion) &&
      value.productGuideSeenVersion >= 0
        ? value.productGuideSeenVersion
        : undefined
  }

  return cachedPreferences
}

/**
 * 读取应用偏好副本。
 */
export const getPreferences = (): AppPreferences => ({ ...readPreferences() })

/**
 * 合并并保存应用偏好。
 * 同目录临时文件落盘后原子替换，成功后才更新缓存；失败由调用方处理。
 */
export const updatePreferences = (patch: Partial<AppPreferences>): AppPreferences => {
  const next: AppPreferences = {
    ...readPreferences(),
    ...patch
  }

  next.larkCliPath = normalizePath(next.larkCliPath)
  next.meegleCliPath = normalizePath(next.meegleCliPath)
  next.meegleProjectKey = normalizePath(next.meegleProjectKey)
  next.repositoryRoot = normalizePath(next.repositoryRoot)
  next.gitPath = normalizePath(next.gitPath)
  next.ide = isIdeConfig(next.ide) ? next.ide : undefined
  next.skillDirectories = next.skillDirectories
    ?.map((item) => item.trim())
    .filter(Boolean)
  next.productGuideSeenVersion =
    typeof next.productGuideSeenVersion === 'number' &&
    Number.isInteger(next.productGuideSeenVersion) &&
    next.productGuideSeenVersion >= 0
      ? next.productGuideSeenVersion
      : undefined
  const targetPath = getPreferencesPath()
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  let temporaryCreated = false
  try {
    // 独占创建，避免覆盖其他文件；Windows 上也需先关闭句柄再执行重命名。
    const descriptor = openSync(temporaryPath, 'wx', 0o600)
    temporaryCreated = true
    try {
      writeFileSync(descriptor, JSON.stringify(next, null, 2), 'utf8')
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    renameSync(temporaryPath, targetPath)
  } catch (error) {
    if (temporaryCreated) {
      try {
        rmSync(temporaryPath, { force: true })
      } catch {
        // 清理失败不掩盖原始保存错误，也不能删除原配置文件。
      }
    }
    throw error
  }

  cachedPreferences = next
  return { ...next }
}
