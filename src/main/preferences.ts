import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
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
  repositoryRoot?: string
  gitPath?: string
  ide?: IdeConfig
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
    repositoryRoot?: unknown
    gitPath?: unknown
    ide?: unknown
  }

  cachedPreferences = {
    theme: isThemeMode(value.theme) ? value.theme : DEFAULT_PREFERENCES.theme,
    larkCliPath: normalizePath(value.larkCliPath),
    meegleCliPath: normalizePath(value.meegleCliPath),
    repositoryRoot: normalizePath(value.repositoryRoot),
    gitPath: normalizePath(value.gitPath),
    ide: isIdeConfig(value.ide) ? value.ide : undefined
  }

  return cachedPreferences
}

/**
 * 读取应用偏好副本。
 */
export const getPreferences = (): AppPreferences => ({ ...readPreferences() })

/**
 * 合并并保存应用偏好。
 * 写入磁盘失败时仍保留本次会话中的内存值。
 */
export const updatePreferences = (patch: Partial<AppPreferences>): AppPreferences => {
  const next: AppPreferences = {
    ...readPreferences(),
    ...patch
  }

  next.larkCliPath = normalizePath(next.larkCliPath)
  next.meegleCliPath = normalizePath(next.meegleCliPath)
  next.repositoryRoot = normalizePath(next.repositoryRoot)
  next.gitPath = normalizePath(next.gitPath)
  next.ide = isIdeConfig(next.ide) ? next.ide : undefined
  cachedPreferences = next

  try {
    writeFileSync(getPreferencesPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    // 偏好持久化失败不阻断当前操作。
  }

  return { ...next }
}
