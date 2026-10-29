/**
 * Git 可执行文件配置与探测。
 * 设置页和所有 Git 命令共用同一套路径解析结果。
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { getCliEnvironment } from './cli-env'
import { getPreferences, updatePreferences } from './preferences'
import type { GitInfo, GitPathSource } from '../types/git'

const execFileAsync = promisify(execFile)

interface ResolvedGit {
  path: string
  source: GitPathSource
  available: boolean
}

/** 缓存本次进程内解析到的 Git，设置变化时主动失效。 */
let cachedResolution: ResolvedGit | null | undefined

/**
 * 判断路径是否为可执行文件。
 */
const isExecutable = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 在 PATH 中查找 Git 命令，返回真实绝对路径。
 * 支持用户配置的是命令名而不是完整路径。
 */
const findCommandPath = async (command: string): Promise<string | null> => {
  if (isAbsolute(command)) {
    return (await isExecutable(command)) ? command : null
  }

  try {
    const locator = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(locator, [command], {
      timeout: 5_000,
      encoding: 'utf8',
      env: getCliEnvironment(locator)
    })
    const found = stdout.trim().split(/\r?\n/)[0]

    return found && (await isExecutable(found)) ? found : null
  } catch {
    return null
  }
}

/**
 * 常见 Git 安装位置，用于 PATH 不完整时兜底。
 */
const getAutoCandidates = (): string[] => {
  if (process.platform === 'win32') {
    const candidates: string[] = []
    const programFiles = process.env.ProgramFiles
    const programFilesX86 = process.env['ProgramFiles(x86)']
    const localAppData = process.env.LOCALAPPDATA

    if (programFiles) candidates.push(`${programFiles}\\Git\\cmd\\git.exe`)
    if (programFilesX86) candidates.push(`${programFilesX86}\\Git\\cmd\\git.exe`)
    if (localAppData) candidates.push(`${localAppData}\\Programs\\Git\\cmd\\git.exe`)

    return candidates
  }

  return ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git']
}

/**
 * 按“手动设置 → 环境变量 → 常见安装路径 → PATH”定位 Git。
 * 手动设置视为强约束，路径错误时不静默回退。
 */
const resolveGit = async (
  force = false,
  ignoreSettings = false
): Promise<ResolvedGit | null> => {
  if (!force && cachedResolution !== undefined) return cachedResolution

  const configuredPath = getPreferences().gitPath

  if (configuredPath && !ignoreSettings) {
    cachedResolution = {
      path: configuredPath,
      source: 'settings',
      available: await isExecutable(configuredPath)
    }
    return cachedResolution
  }

  const environmentPath = process.env.GIT_PATH?.trim()

  if (environmentPath) {
    const resolved = await findCommandPath(environmentPath)

    cachedResolution = {
      path: resolved ?? environmentPath,
      source: 'environment',
      available: Boolean(resolved)
    }
    return cachedResolution
  }

  for (const candidate of getAutoCandidates()) {
    if (await isExecutable(candidate)) {
      cachedResolution = {
        path: candidate,
        source: 'auto',
        available: true
      }
      return cachedResolution
    }
  }

  const pathCommand = await findCommandPath('git')

  if (pathCommand) {
    cachedResolution = {
      path: pathCommand,
      source: 'auto',
      available: true
    }
    return cachedResolution
  }

  cachedResolution = null
  return null
}

/**
 * 执行 git --version，确保配置路径真的是可用的 Git。
 */
const readVersion = async (executablePath: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync(executablePath, ['--version'], {
      timeout: 5_000,
      encoding: 'utf8',
      env: {
        ...getCliEnvironment(executablePath),
        GIT_TERMINAL_PROMPT: '0'
      }
    })
    const match = stdout.match(/git version\s+(\S+)/i)

    return match?.[1] ?? stdout.trim() ?? null
  } catch {
    return null
  }
}

/**
 * 获取当前生效的 Git 路径。
 * 所有 Git 命令通过这个函数动态解析，避免启动时固定旧路径。
 */
export const resolveGitPath = async (): Promise<string> => {
  const resolved = await resolveGit()

  if (!resolved?.available) {
    throw new Error('未找到可用的 Git，请先在设置中配置 Git 路径')
  }

  return resolved.path
}

/**
 * 读取 Git 路径、来源、版本和可用状态。
 */
export const getGitInfo = async (
  force = false,
  ignoreSettings = false
): Promise<GitInfo> => {
  const resolved = await resolveGit(force, ignoreSettings)

  if (!resolved) {
    return {
      path: null,
      source: null,
      version: null,
      available: false
    }
  }

  if (!resolved.available) {
    return {
      path: resolved.path,
      source: resolved.source,
      version: null,
      available: false
    }
  }

  const version = await readVersion(resolved.path)

  return {
    path: resolved.path,
    source: resolved.source,
    version,
    available: Boolean(version)
  }
}

/**
 * 只执行自动探测，不修改已保存的路径。
 */
export const detectGitInfo = async (): Promise<GitInfo> => {
  const info = await getGitInfo(true, true)
  cachedResolution = undefined

  return info
}

/**
 * 保存 Git 路径；传 null 恢复自动探测。
 */
export const setGitPath = async (gitPath: string | null): Promise<GitInfo> => {
  const normalizedPath = typeof gitPath === 'string' ? gitPath.trim() : ''

  if (normalizedPath) {
    if (!(await isExecutable(normalizedPath))) {
      throw new Error('选择的 Git 文件不可执行')
    }

    const version = await readVersion(normalizedPath)

    if (!version) {
      throw new Error('无法执行该 Git 文件')
    }
  }

  updatePreferences({
    gitPath: normalizedPath || undefined
  })
  cachedResolution = undefined

  return getGitInfo(true)
}

/**
 * 打开系统文件选择器选择 Git 可执行文件。
 */
export const selectGitPath = async (currentPath?: string | null): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title: '选择 Git 可执行文件',
    properties: ['openFile', 'showHiddenFiles']
  }
  const normalizedPath = typeof currentPath === 'string' ? currentPath.trim() : ''

  options.defaultPath = normalizedPath ? dirname(normalizedPath) : homedir()

  const focusedWindow = BrowserWindow.getFocusedWindow()
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || !result.filePaths[0]) return null

  return result.filePaths[0]
}

/**
 * 注册 Git 配置相关 IPC。
 */
export const initializeGit = (): void => {
  ipcMain.handle('git:get-info', () => getGitInfo(true))
  ipcMain.handle('git:detect-info', () => detectGitInfo())
  ipcMain.handle('git:set-path', (_event, gitPath: unknown) => {
    if (gitPath !== null && typeof gitPath !== 'string') {
      throw new Error('Invalid Git path')
    }

    return setGitPath(gitPath)
  })
  ipcMain.handle('git:select-path', (_event, currentPath: unknown) => {
    if (currentPath !== null && currentPath !== undefined && typeof currentPath !== 'string') {
      throw new Error('Invalid Git path')
    }

    return selectGitPath(currentPath)
  })
}
