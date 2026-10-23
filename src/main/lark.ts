/**
 * lark-cli 业务模块。
 * 负责定位 CLI、读取登录用户、管理可执行路径并注册相关 IPC。
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { getPreferences, updatePreferences } from './preferences'
import type { LarkCliInfo, LarkCliPathSource, LarkUser } from '../types/lark'

/**
 * 路径解析结果。
 * available 表示路径当前是否存在且可执行。
 */
interface ResolvedLarkCli {
  path: string
  source: LarkCliPathSource
  available: boolean
}

/**
 * lark-cli whoami 命令返回的必要字段。
 */
interface WhoamiResult {
  available?: boolean
  identity?: string
  onBehalfOf?: {
    userName?: string
    openId?: string
  }
}

/**
 * 飞书用户信息接口返回的头像和昵称字段。
 */
interface UserInfoResponse {
  ok?: boolean
  data?: {
    name?: string
    open_id?: string
    avatar_middle?: string
    avatar_url?: string
  }
}

const execFileAsync = promisify(execFile)

// 单次 lark-cli 调用的超时时间。
const COMMAND_TIMEOUT_MS = 15_000
// 命令输出最大缓存，避免异常输出占满内存。
const MAX_BUFFER_BYTES = 2 * 1024 * 1024
// 头像文件大小上限，超过时使用昵称首字作为 fallback。
const MAX_AVATAR_BYTES = 512 * 1024

// 路径解析缓存；undefined 表示尚未解析，null 表示未找到。
let cachedResolution: ResolvedLarkCli | null | undefined

/**
 * 清除路径解析缓存。
 * 自动检测路径可能因 nvm 切换或安装位置变化而失效，需要在关键节点重新解析。
 */
export const invalidateLarkCliResolution = (): void => {
  cachedResolution = undefined
}

/**
 * 判断文件是否可执行。
 * 用于手动路径校验以及 GUI 启动时的自动探测。
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
 * 收集常见的 lark-cli 路径。
 * 打包应用从 Finder 启动时 PATH 往往不完整，需要主动检查 nvm 和常见目录。
 */
const getAutoCandidates = async (): Promise<string[]> => {
  const candidates = [
    join(homedir(), '.local/bin/lark-cli'),
    join(homedir(), '.local/node/bin/lark-cli'),
    '/opt/homebrew/bin/lark-cli',
    '/usr/local/bin/lark-cli'
  ]

  try {
    const versions = await readdir(join(homedir(), '.nvm/versions/node'))
    versions
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .forEach((version) => {
        candidates.push(join(homedir(), '.nvm/versions/node', version, 'bin/lark-cli'))
      })
  } catch {
    // 没有 nvm 时忽略。
  }

  return candidates
}

/**
 * 按“手动设置 → 环境变量 → 自动探测 → PATH”优先级定位 lark-cli。
 * 手动设置视为强约束，路径错误时不静默回退。
 *
 * force 为 true 时绕过缓存重新探测；ignoreSettings 为 true 时跳过手动路径，
 * 仅用于设置页的“自动检测”预览。
 */
const resolveLarkCli = async (
  force = false,
  ignoreSettings = false
): Promise<ResolvedLarkCli | null> => {
  // 已有解析结果且不强制刷新时直接复用。
  if (!force && cachedResolution !== undefined) return cachedResolution

  // 1. 用户手动设置的路径优先级最高。
  const configuredPath = getPreferences().larkCliPath

  if (configuredPath && !ignoreSettings) {
    cachedResolution = {
      path: configuredPath,
      source: 'settings',
      available: await isExecutable(configuredPath)
    }
    return cachedResolution
  }

  // 2. 环境变量作为显式的第二优先级来源。
  const environmentPath = process.env.LARK_CLI_PATH?.trim()

  if (environmentPath) {
    cachedResolution = {
      path: environmentPath,
      source: 'environment',
      available: await isExecutable(environmentPath)
    }
    return cachedResolution
  }

  // 3. 检查 nvm、Homebrew 和用户本地目录等常见安装位置。
  for (const candidate of await getAutoCandidates()) {
    if (await isExecutable(candidate)) {
      cachedResolution = {
        path: candidate,
        source: 'auto',
        available: true
      }
      return cachedResolution
    }
  }

  // 4. 最后回退到系统 PATH 查询。
  try {
    const locator = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(locator, ['lark-cli'], {
      timeout: 3000,
      encoding: 'utf8'
    })
    const foundPath = stdout.trim().split(/\r?\n/)[0]

    if (foundPath && (await isExecutable(foundPath))) {
      cachedResolution = {
        path: foundPath,
        source: 'auto',
        available: true
      }
      return cachedResolution
    }
  } catch {
    // PATH 中也没有时返回 null。
  }

  cachedResolution = null
  return null
}

/**
 * 执行指定可执行文件。
 */
const runExecutable = async (executablePath: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(executablePath, args, {
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
    encoding: 'utf8',
    env: process.env
  })

  return stdout
}

/**
 * 获取 lark-cli 版本号。
 */
const readVersion = async (executablePath: string): Promise<string | null> => {
  try {
    const output = (await runExecutable(executablePath, ['--version'])).trim()
    const match = output.match(/version\s+(\S+)/i)

    return match?.[1] ?? (output || null)
  } catch {
    return null
  }
}

/**
 * 执行 lark-cli。
 * 参数全部由应用内部构造，不包含用户输入。
 */
const runLarkCli = async (args: string[]): Promise<string> => {
  const resolved = await resolveLarkCli()

  if (!resolved?.available) {
    throw new Error('lark-cli not available')
  }

  return runExecutable(resolved.path, args)
}

/**
 * 解析 lark-cli 返回的 JSON。
 */
const parseJson = (value: string): unknown => JSON.parse(value)

/**
 * 获取 lark-cli 当前路径、来源和版本。
 * force 控制是否绕过缓存，ignoreSettings 控制是否忽略手动路径设置。
 */
export const getLarkCliInfo = async (
  force = false,
  ignoreSettings = false
): Promise<LarkCliInfo> => {
  const resolved = await resolveLarkCli(force, ignoreSettings)

  // 完全找不到 lark-cli。
  if (!resolved) {
    return {
      path: null,
      source: null,
      version: null,
      available: false
    }
  }

  // 找到了配置路径，但文件不存在或不可执行。
  if (!resolved.available) {
    return {
      path: resolved.path,
      source: resolved.source,
      version: null,
      available: false
    }
  }

  // 版本命令失败时也视为不可用，避免误报为可用。
  const version = await readVersion(resolved.path)

  return {
    path: resolved.path,
    source: resolved.source,
    version,
    available: Boolean(version)
  }
}

/**
 * 只执行自动探测，不读取也不修改手动路径设置。
 * 用于设置页的“自动检测”按钮，检测结果在统一保存时再生效。
 */
export const detectLarkCliInfo = async (): Promise<LarkCliInfo> => {
  const info = await getLarkCliInfo(true, true)
  cachedResolution = undefined

  return info
}

/**
 * 保存 lark-cli 可执行文件路径。
 * 传入空值时清除手动设置，恢复自动探测。
 */
export const setLarkCliPath = async (cliPath: string | null): Promise<LarkCliInfo> => {
  const normalizedPath = typeof cliPath === 'string' ? cliPath.trim() : ''

  // 手动路径必须存在、可执行，并且能正常输出版本号。
  if (normalizedPath) {
    if (!(await isExecutable(normalizedPath))) {
      throw new Error('选择的文件不可执行')
    }

    const version = await readVersion(normalizedPath)

    if (!version) {
      throw new Error('无法执行该 lark-cli 文件')
    }
  }

  // 空路径会清除手动设置，恢复自动探测。
  updatePreferences({
    larkCliPath: normalizedPath || undefined
  })
  invalidateLarkCliResolution()

  return getLarkCliInfo(true)
}

/**
 * 打开系统文件选择器，让用户选择 lark-cli 可执行文件。
 * 传入当前路径时，优先打开它所在的目录。
 */
export const selectLarkCliPath = async (currentPath?: string | null): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title: '选择 lark-cli 可执行文件',
    properties: ['openFile']
  }
  const normalizedPath = typeof currentPath === 'string' ? currentPath.trim() : ''

  if (normalizedPath) {
    options.defaultPath = dirname(normalizedPath)
  }

  const focusedWindow = BrowserWindow.getFocusedWindow()
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  return result.filePaths[0]
}

/**
 * 下载飞书头像并转换为 data URL。
 * 避免渲染进程直接访问外部图片地址。
 */
const fetchAvatarDataUrl = async (avatarUrl?: string): Promise<string | undefined> => {
  if (!avatarUrl || !avatarUrl.startsWith('https://')) return undefined

  try {
    const response = await fetch(avatarUrl, {
      signal: AbortSignal.timeout(6000)
    })

    if (!response.ok) return undefined

    const contentType = response.headers.get('content-type')

    if (!contentType || !contentType.startsWith('image/')) return undefined

    const data = Buffer.from(await response.arrayBuffer())

    if (data.byteLength > MAX_AVATAR_BYTES) return undefined

    return `data:${contentType};base64,${data.toString('base64')}`
  } catch {
    return undefined
  }
}

/**
 * 读取当前 lark-cli 登录状态和飞书用户资料。
 * 未登录、lark-cli 不可用或调用失败时返回 null。
 */
export const getLarkUser = async (): Promise<LarkUser | null> => {
  try {
    // 先读取本地登录态和基础用户信息。
    const whoami = parseJson(await runLarkCli(['whoami', '--as', 'user'])) as WhoamiResult
    const openId = whoami.onBehalfOf?.openId

    if (!whoami.available || whoami.identity !== 'user' || !openId) {
      return null
    }

    let name = whoami.onBehalfOf?.userName?.trim() ?? ''
    let avatarUrl: string | undefined

    try {
      // 再请求完整用户资料，用于补充头像。
      const response = parseJson(
        await runLarkCli(['api', 'GET', '/open-apis/authen/v1/user_info', '--as', 'user'])
      ) as UserInfoResponse

      if (response.ok && response.data) {
        name = response.data.name?.trim() || name
        avatarUrl = await fetchAvatarDataUrl(response.data.avatar_middle ?? response.data.avatar_url)
      }
    } catch {
      // whoami 已确认登录，资料接口失败时继续使用基础昵称。
    }

    return {
      name: name || '飞书用户',
      openId,
      avatarUrl
    }
  } catch {
    // lark-cli 缺失、未登录或命令执行失败，统一按未登录处理。
    return null
  }
}

/**
 * 注册 lark-cli 相关的 IPC。
 * 登录状态、路径查询和路径设置都归属 lark 业务模块。
 */
export const initializeLark = (): void => {
  // 读取登录用户前重新解析路径，确保自动检测路径变化后能及时生效。
  ipcMain.handle('lark:get-user', () => {
    invalidateLarkCliResolution()
    return getLarkUser()
  })

  // 查询当前生效的 lark-cli 路径、来源和版本。
  ipcMain.handle('lark:get-cli-info', () => getLarkCliInfo(true))

  // 只执行自动探测，不修改已保存的路径。
  ipcMain.handle('lark:detect-cli-info', () => detectLarkCliInfo())

  // 保存手动路径；null 表示恢复自动探测。
  ipcMain.handle('lark:set-cli-path', (_event, cliPath: unknown) => {
    if (cliPath !== null && typeof cliPath !== 'string') {
      throw new Error('Invalid lark-cli path')
    }

    return setLarkCliPath(cliPath)
  })

  // 打开系统文件选择器，优先定位到当前路径所在目录。
  ipcMain.handle('lark:select-cli-path', (_event, currentPath: unknown) => {
    if (currentPath !== null && currentPath !== undefined && typeof currentPath !== 'string') {
      throw new Error('Invalid lark-cli path')
    }

    return selectLarkCliPath(currentPath)
  })
}
