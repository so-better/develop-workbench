/**
 * 技能目录设置模块。
 * 额外目录保存在应用偏好中，保存后立即清空技能扫描缓存。
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { getPreferences, updatePreferences } from './preferences'
import { invalidateSkillCache } from './ai/skills'
import type { SkillSettingsState } from '../types/skills'

/** 校验并去重绝对路径列表。 */
const normalizeDirectories = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new Error('技能目录参数不合法')

  const directories: string[] = []
  const seen = new Set<string>()

  for (const item of value) {
    if (typeof item !== 'string') throw new Error('技能目录参数不合法')

    const rawDirectory = item.trim()

    if (!rawDirectory) continue
    if (!isAbsolute(rawDirectory)) {
      throw new Error(`技能目录必须使用绝对路径：${rawDirectory}`)
    }

    const directory = resolve(rawDirectory)
    const key = directory.toLowerCase()

    if (seen.has(key)) continue

    seen.add(key)
    directories.push(directory)
  }

  return directories
}

/** 校验每个目录当前存在且确实是目录。 */
const validateDirectories = async (directories: string[]): Promise<void> => {
  for (const directory of directories) {
    try {
      if (!(await stat(directory)).isDirectory()) {
        throw new Error('不是目录')
      }
    } catch {
      throw new Error(`技能目录不存在或不可访问：${directory}`)
    }
  }
}

/** 读取技能目录设置。 */
const getSkillSettings = (): SkillSettingsState => ({
  directories: getPreferences().skillDirectories ?? []
})

/** 保存技能目录设置并刷新缓存。 */
const setSkillSettings = async (value: unknown): Promise<SkillSettingsState> => {
  const directories = normalizeDirectories(value)

  await validateDirectories(directories)
  updatePreferences({ skillDirectories: directories })
  invalidateSkillCache()

  return { directories }
}

/** 打开系统目录选择器。 */
const selectSkillDirectory = async (): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title: '选择技能目录',
    properties: ['openDirectory', 'createDirectory', 'showHiddenFiles']
  }
  const window = BrowserWindow.getFocusedWindow()
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** 注册技能目录设置 IPC。 */
export const initializeSkillSettings = (): void => {
  ipcMain.handle('skills:get-settings', () => getSkillSettings())
  ipcMain.handle('skills:set-directories', (_event, directories: unknown) =>
    setSkillSettings(directories)
  )
  ipcMain.handle('skills:select-directory', () => selectSkillDirectory())
}
