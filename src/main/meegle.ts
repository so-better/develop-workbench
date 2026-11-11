/**
 * Meegle（飞书项目）业务模块。
 * 通过 Meegle CLI 读取配置、管理登录态，并注册相关 IPC。
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import QRCode from 'qrcode'
import { getCliEnvironment, getCliInvocation } from './cli-env'
import { getPreferences, updatePreferences } from './preferences'
import { broadcastAuthExpired, isAuthExpiredError } from './auth-events'
import type {
  MeegleCliInfo,
  MeegleCliPathSource,
  MeegleLoginEvent,
  MeegleLoginSession,
  MeegleState
} from '../types/meegle'

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface MeegleStatusResponse {
  authenticated?: boolean
  expires_in_minutes?: number
  host?: string
  reason?: string
}

interface DeviceFlowResponse {
  client_id?: string
  device_code?: string
  expires_in?: number
  interval?: number
  user_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  status?: string
  authenticated?: boolean
  error?: {
    message?: string
  }
}

/**
 * 路径解析结果。
 */
interface ResolvedMeegleCli {
  path: string
  source: MeegleCliPathSource
}

interface PendingMeegleLogin {
  clientId: string
  deviceCode: string
  host: string
  interval: number
  expiresAt: number
  timer: NodeJS.Timeout | null
}

const MEEGLE_COMMAND_TIMEOUT_MS = 15_000
const MEEGLE_PROBE_TIMEOUT_MS = 5_000
const DEFAULT_MEEGLE_HOST = 'project.feishu.cn'
const MEEGLE_MAX_BUFFER_BYTES = 2 * 1024 * 1024

let cachedResolution: ResolvedMeegleCli | null | undefined
let pendingLogin: PendingMeegleLogin | null = null

/**
 * 判断文件是否可执行。
 */
const isExecutable = async (filePath: string): Promise<boolean> => {
  try {
    const info = await stat(filePath)

    if (!info.isFile()) return false

    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 收集常见的 Meegle CLI 安装路径。
 * GUI 启动时 PATH 可能不完整，因此和 lark-cli 一样主动检查版本管理器目录。
 */
const getAutoCandidates = async (): Promise<string[]> => {
  const candidates = [
    join(homedir(), '.local/bin/meegle'),
    join(homedir(), '.local/node/bin/meegle'),
    '/opt/homebrew/bin/meegle',
    '/usr/local/bin/meegle'
  ]

  try {
    const versions = await readdir(join(homedir(), '.nvm/versions/node'))
    versions
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .forEach((version) => {
        candidates.push(join(homedir(), '.nvm/versions/node', version, 'bin/meegle'))
      })
  } catch {
    // 没有 nvm 时忽略。
  }

  return candidates
}

/**
 * 定位 Meegle CLI。
 * 优先使用 MEEGLE_CLI_PATH，其次检查常见安装位置和系统 PATH。
 */
const resolveMeegleCli = async (
  force = false,
  ignoreSettings = false
): Promise<ResolvedMeegleCli | null> => {
  if (!force && cachedResolution !== undefined) return cachedResolution

  const configuredPath = getPreferences().meegleCliPath

  if (configuredPath && !ignoreSettings) {
    cachedResolution = {
      path: configuredPath,
      source: 'settings'
    }
    return cachedResolution
  }

  const environmentPath = process.env.MEEGLE_CLI_PATH?.trim()

  if (environmentPath && (await isExecutable(environmentPath))) {
    cachedResolution = {
      path: environmentPath,
      source: 'environment'
    }
    return cachedResolution
  }

  for (const candidate of await getAutoCandidates()) {
    if (await isExecutable(candidate)) {
      cachedResolution = {
        path: candidate,
        source: 'auto'
      }
      return cachedResolution
    }
  }

  try {
    const locator = process.platform === 'win32' ? 'where' : 'which'
    const result = await runExecutable(locator, ['meegle'])

    if (result.code === 0) {
      const foundPath = result.stdout.trim().split(/\r?\n/)[0]

      if (foundPath && (await isExecutable(foundPath))) {
        cachedResolution = {
          path: foundPath,
          source: 'auto'
        }
        return cachedResolution
      }
    }
  } catch {
    // PATH 中也没有时返回 null。
  }

  cachedResolution = null
  return null
}

/**
 * 执行可执行文件并保留退出码。
 * auth status 在未登录时会返回非 0 退出码，但 stdout 仍可能是有效 JSON。
 * timeoutMs 允许耗时业务查询使用比登录状态检查更长的超时时间。
 */
const runExecutable = (
  executablePath: string,
  args: string[],
  timeoutMs = MEEGLE_COMMAND_TIMEOUT_MS
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const invocation = getCliInvocation(executablePath, args)
    const child = spawn(invocation.command, invocation.args, {
      env: getCliEnvironment(executablePath),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(invocation.windowsVerbatimArguments
        ? { windowsVerbatimArguments: true }
        : {})
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      // 先结算并释放已收集内容，再终止进程；kill 后仍可能收到 data/error/close。
      stdoutChunks.length = 0
      stderrChunks.length = 0
      child.kill()
      reject(error)
    }
    const timeout = setTimeout(() => {
      fail(new Error('Meegle CLI command timed out'))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      if (stdoutBytes + chunk.byteLength > MEEGLE_MAX_BUFFER_BYTES) {
        fail(new Error('Meegle CLI stdout exceeded the 2 MB output limit'))
        return
      }
      stdoutBytes += chunk.byteLength
      stdoutChunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return
      if (stderrBytes + chunk.byteLength > MEEGLE_MAX_BUFFER_BYTES) {
        fail(new Error('Meegle CLI stderr exceeded the 2 MB output limit'))
        return
      }
      stderrBytes += chunk.byteLength
      stderrChunks.push(chunk)
    })
    child.on('error', fail)
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        code: code ?? 1,
        // 最后统一解码，避免 UTF-8 字符被拆在两个 data 块中时出现乱码。
        stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
        stderr: Buffer.concat(stderrChunks, stderrBytes).toString('utf8')
      })
      stdoutChunks.length = 0
      stderrChunks.length = 0
    })
  })

/**
 * 提取可能表示授权失效的错误文本。
 * 退出码为 0 时只检查 JSON 中的 error.message，避免把业务数据误判为认证错误。
 */
const getAuthErrorText = (result: CommandResult): string => {
  if (result.code !== 0) return `${result.stdout}\n${result.stderr}`

  if (!result.stdout.includes('"error"')) return ''

  try {
    const parsed = JSON.parse(result.stdout) as {
      error?: { message?: unknown }
    }

    return typeof parsed?.error?.message === 'string' ? parsed.error.message : ''
  } catch {
    return ''
  }
}

/**
 * 执行 Meegle CLI 命令。
 * 导出给需求等业务模块复用，统一处理 CLI 路径解析和进程超时。
 */
export const runMeegle = async (
  args: string[],
  timeoutMs = MEEGLE_COMMAND_TIMEOUT_MS
): Promise<CommandResult> => {
  const resolved = await resolveMeegleCli()

  if (!resolved) {
    throw new Error('Meegle CLI not found')
  }

  const result = await runExecutable(resolved.path, args, timeoutMs)

  // auth/config 命令用于查询或修复环境，失败时不在业务层重复广播。
  if (
    args[0] !== 'auth' &&
    args[0] !== 'config' &&
    isAuthExpiredError(getAuthErrorText(result))
  ) {
    broadcastAuthExpired('meegle')
  }

  return result
}

/**
 * 解析 JSON 输出。
 */
const parseJson = <T>(value: string): T => JSON.parse(value) as T

/**
 * 读取 CLI 版本。
 * 兼容只支持 `meegle version` 的版本，并允许版本信息出现在 stderr。
 */
const readMeegleVersion = async (executablePath: string): Promise<string | null> => {
  for (const args of [['--version'], ['version']]) {
    try {
      const result = await runExecutable(executablePath, args, MEEGLE_PROBE_TIMEOUT_MS)
      const output = `${result.stdout}\n${result.stderr}`.trim()
      const version = /\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/.exec(output)?.[0] ?? null

      if (version) return version

      if (result.code === 0 && output) {
        return output.split(/\r?\n/)[0] ?? null
      }
    } catch {
      // 尝试下一个版本命令。
    }
  }

  return null
}

/** 校验目标文件确实是一个 Meegle CLI。 */
const isMeegleCli = async (executablePath: string): Promise<boolean> => {
  try {
    const result = await runExecutable(
      executablePath,
      ['--help'],
      MEEGLE_PROBE_TIMEOUT_MS
    )
    const output = `${result.stdout}\n${result.stderr}`

    return result.code === 0 && /meegle|lark project/i.test(output)
  } catch {
    return false
  }
}

/**
 * 获取 Meegle CLI 路径和版本。
 * available 以文件可执行为准，版本探测失败不回退成“未检测到”。
 */
export const getMeegleCliInfo = async (
  force = false,
  ignoreSettings = false
): Promise<MeegleCliInfo> => {
  const resolved = await resolveMeegleCli(force, ignoreSettings)

  if (!resolved) {
    return {
      path: null,
      source: null,
      version: null,
      available: false
    }
  }

  const executable = await isExecutable(resolved.path)
  const version = executable ? await readMeegleVersion(resolved.path) : null

  return {
    path: resolved.path,
    source: resolved.source,
    version,
    available: executable
  }
}

/**
 * 保存 Meegle CLI 可执行文件路径。
 * 传空值时清除手动设置，恢复自动探测。
 */
export const setMeegleCliPath = async (cliPath: string | null): Promise<MeegleCliInfo> => {
  const normalizedPath = typeof cliPath === 'string' ? cliPath.trim() : ''

  if (normalizedPath) {
    if (!(await isExecutable(normalizedPath))) {
      throw new Error('选择的文件不可执行')
    }
    if (!(await isMeegleCli(normalizedPath))) {
      throw new Error('无法识别该 Meegle CLI 文件')
    }
  }

  updatePreferences({
    meegleCliPath: normalizedPath || undefined
  })
  cachedResolution = undefined

  return getMeegleCliInfo(true)
}

/**
 * 只执行自动探测，不读取也不修改手动路径设置。
 * 检测结果在弹窗底部统一保存时再生效。
 */
export const detectMeegleCliInfo = async (): Promise<MeegleCliInfo> => {
  const info = await getMeegleCliInfo(true, true)
  cachedResolution = undefined

  return info
}

/**
 * 打开系统文件选择器，让用户选择 Meegle CLI 可执行文件。
 * 传入当前路径时优先打开它所在的目录。
 */
export const selectMeegleCliPath = async (
  currentPath?: string | null
): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title: '选择 Meegle CLI 可执行文件',
    properties: ['openFile', 'showHiddenFiles']
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
 * 读取 Meegle 当前配置和登录状态。
 * 未登录时仍返回 host 和 CLI 信息，便于设置页展示和重新登录。
 */
export const getMeegleState = async (): Promise<MeegleState> => {
  const cli = await getMeegleCliInfo()

  if (!cli.available) {
    return {
      cli,
      host: null,
      authenticated: false
    }
  }

  let host: string | null = null

  try {
    const hostResult = await runMeegle(['config', 'get', 'host'])

    if (hostResult.code === 0) {
      host = hostResult.stdout.trim() || null
    }
  } catch {
    // 配置读取失败时继续尝试读取登录状态。
  }

  try {
    const statusResult = await runMeegle(['auth', 'status', '--format', 'json'])
    const status = parseJson<MeegleStatusResponse>(statusResult.stdout)
    const authenticated = status.authenticated === true
    const resolvedHost = status.host ?? host

    return {
      cli,
      host: resolvedHost || null,
      authenticated,
      expiresInMinutes: status.expires_in_minutes
    }
  } catch {
    return {
      cli,
      host,
      authenticated: false
    }
  }
}

/**
 * 向所有窗口广播 Meegle 登录结果。
 */
const broadcastLoginEvent = (event: MeegleLoginEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('meegle:login-event', event)
  }
}

/**
 * 停止当前扫码登录轮询。
 */
export const cancelMeegleLogin = (): void => {
  if (!pendingLogin) return

  if (pendingLogin.timer) clearTimeout(pendingLogin.timer)
  pendingLogin = null
}

/**
 * 判断轮询结果是否表示授权成功。
 */
const isLoginSuccess = (response: DeviceFlowResponse, code: number): boolean => {
  const status = response.status?.toLowerCase()

  if (response.authenticated === true) return true
  if (status === 'ok' || status === 'success' || status === 'authorized' || status === 'login_success') {
    return true
  }

  // 兼容旧 CLI 成功时只返回退出码、不返回 status 的响应。
  return code === 0 && !status
}

/**
 * 解析轮询失败原因。
 */
const getLoginErrorMessage = (response: DeviceFlowResponse, result: CommandResult): string => {
  const status = response.status?.toLowerCase()

  if (status === 'expired_token') return '二维码已过期，请重新生成'
  if (status === 'access_denied' || status === 'authorization_denied') {
    return '飞书项目授权被拒绝'
  }
  if (status === 'slow_down') return '授权请求过于频繁，正在重试'

  return response.error?.message || result.stderr.trim() || 'Meegle 登录失败'
}

/**
 * 轮询一次设备授权状态。
 */
const pollLogin = async (session: PendingMeegleLogin): Promise<void> => {
  if (pendingLogin !== session) return

  if (Date.now() >= session.expiresAt) {
    pendingLogin = null
    broadcastLoginEvent({
      status: 'error',
      message: '二维码已过期，请重新生成'
    })
    return
  }

  try {
    const result = await runMeegle([
      'auth',
      'login',
      '--device-code',
      '--phase',
      'poll',
      '--once',
      '--client-id',
      session.clientId,
      '--device-code-value',
      session.deviceCode,
      '--host',
      session.host,
      '--format',
      'json'
    ])
    const response = parseJson<DeviceFlowResponse>(result.stdout)
    const status = response.status?.toLowerCase()

    if (status === 'authorization_pending') {
      // 用户尚未完成授权，继续等待。
    } else if (status === 'slow_down') {
      session.interval += 2
    } else if (isLoginSuccess(response, result.code)) {
      pendingLogin = null
      broadcastLoginEvent({ status: 'success' })
      return
    } else {
      pendingLogin = null
      broadcastLoginEvent({
        status: 'error',
        message: getLoginErrorMessage(response, result)
      })
      return
    }
  } catch (error) {
    pendingLogin = null
    broadcastLoginEvent({
      status: 'error',
      message: error instanceof Error ? error.message : 'Meegle 登录失败'
    })
    return
  }

  if (pendingLogin !== session) return

  session.timer = setTimeout(() => {
    pollLogin(session)
  }, session.interval * 1000)
}

/**
 * 发起 Meegle 扫码登录。
 * 二维码由 verification_uri_complete 生成，device code 只保留在主进程。
 */
export const startMeegleLogin = async (): Promise<MeegleLoginSession> => {
  const state = await getMeegleState()

  if (!state.cli.available) {
    throw new Error('Meegle CLI not found')
  }

  // 应用固定面向飞书项目；旧配置缺失时使用默认站点。
  const host = state.host ?? DEFAULT_MEEGLE_HOST

  if (!state.host) {
    const setHostResult = await runMeegle(['config', 'set', 'host', host])

    if (setHostResult.code !== 0) {
      throw new Error(setHostResult.stderr.trim() || '无法配置 Meegle 站点')
    }
  }

  cancelMeegleLogin()

  const result = await runMeegle([
    'auth',
    'login',
    '--device-code',
    '--phase',
    'init',
    '--format',
    'json',
    '--host',
    host
  ])
  const response = parseJson<DeviceFlowResponse>(result.stdout)
  const verificationUrl = response.verification_uri_complete ?? response.verification_uri

  if (!response.client_id || !response.device_code || !verificationUrl) {
    throw new Error(response.error?.message ?? '无法发起 Meegle 授权')
  }

  const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
    width: 320,
    margin: 1,
    errorCorrectionLevel: 'M'
  })
  const expiresInMs = (response.expires_in ?? 1800) * 1000
  const session: PendingMeegleLogin = {
    clientId: response.client_id,
    deviceCode: response.device_code,
    host,
    interval: response.interval ?? 5,
    expiresAt: Date.now() + expiresInMs,
    timer: null
  }

  pendingLogin = session
  session.timer = setTimeout(() => {
    pollLogin(session)
  }, session.interval * 1000)

  return {
    qrCodeDataUrl,
    expiresAt: session.expiresAt,
    userCode: response.user_code ?? ''
  }
}

/**
 * 退出 Meegle 当前登录态。
 */
export const logoutMeegle = async (): Promise<MeegleState> => {
  const result = await runMeegle(['auth', 'logout'])

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || '退出 Meegle 失败')
  }

  return getMeegleState()
}

/**
 * 注册 Meegle 配置、授权和状态相关 IPC。
 */
export const initializeMeegle = (): void => {
  ipcMain.handle('meegle:get-state', () => getMeegleState())

  ipcMain.handle('meegle:set-cli-path', (_event, cliPath: unknown) => {
    if (cliPath !== null && typeof cliPath !== 'string') {
      throw new Error('Invalid Meegle CLI path')
    }

    return setMeegleCliPath(cliPath)
  })

  ipcMain.handle('meegle:select-cli-path', (_event, currentPath: unknown) => {
    if (currentPath !== null && currentPath !== undefined && typeof currentPath !== 'string') {
      throw new Error('Invalid Meegle CLI path')
    }

    return selectMeegleCliPath(currentPath)
  })

  ipcMain.handle('meegle:detect-cli-info', () => detectMeegleCliInfo())
  ipcMain.handle('meegle:start-login', () => startMeegleLogin())
  ipcMain.handle('meegle:cancel-login', () => cancelMeegleLogin())
  ipcMain.handle('meegle:logout', () => logoutMeegle())
}
