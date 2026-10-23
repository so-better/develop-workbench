import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThemeMode } from '../types/theme'

/**
 * 应用级偏好。
 * 主题和外部工具路径统一保存在同一个文件中，避免多个模块互相覆盖。
 */
export interface AppPreferences {
  theme: ThemeMode
  larkCliPath?: string
  meegleCliPath?: string
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

  try {
    const raw = readFileSync(getPreferencesPath(), 'utf8')
    const parsed = JSON.parse(raw) as {
      theme?: unknown
      larkCliPath?: unknown
      meegleCliPath?: unknown
    }

    cachedPreferences = {
      theme: isThemeMode(parsed.theme) ? parsed.theme : DEFAULT_PREFERENCES.theme,
      larkCliPath: normalizePath(parsed.larkCliPath),
      meegleCliPath: normalizePath(parsed.meegleCliPath)
    }
  } catch {
    cachedPreferences = { ...DEFAULT_PREFERENCES }
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
  cachedPreferences = next

  try {
    writeFileSync(getPreferencesPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    // 偏好持久化失败不阻断当前操作。
  }

  return { ...next }
}
