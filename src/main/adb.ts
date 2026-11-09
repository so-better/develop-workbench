/**
 * ADB 工具主进程模块。
 * 负责 ADB 路径探测、设备/应用查询、常用操作、截图和录屏。
 */
import {
  app,
  BrowserWindow,
  ClipboardItem,
  clipboard,
  dialog,
  ipcMain,
  nativeImage
} from 'electron'
import type { OpenDialogOptions, WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { getCliEnvironment } from './cli-env'
import { getPreferences, updatePreferences } from './preferences'
import type {
  AdbAppInfo,
  AdbCommandResult,
  AdbDevice,
  AdbInfo,
  AdbPathSource,
  AdbPermissionInfo,
  AdbReverseEntry,
  PageSpyRoomInfo,
  AdbScreenRecordFinishedEvent,
  AdbScreenRecordResult,
  AdbScreenRecordStartResult,
  AdbScreenshotResult
} from '../types/adb'

const execFileAsync = promisify(execFile)
const ADB_TIMEOUT_MS = 30_000
const ADB_SCREENSHOT_TIMEOUT_MS = 30_000
const ADB_MAX_BUFFER = 20 * 1024 * 1024

interface ResolvedAdb {
  path: string
  source: AdbPathSource
  available: boolean
}

interface ScreenRecordSession {
  id: string
  owner: WebContents
  serial: string
  remotePath: string
  localPath: string
  directory: string
  remotePid: number
  timer: NodeJS.Timeout
  finalized: boolean
  onOwnerDestroyed: () => void
}

let cachedAdbResolution: ResolvedAdb | null | undefined
const screenRecordSessions = new Map<string, ScreenRecordSession>()

const getAdbExecutableName = (): string =>
  process.platform === 'win32' ? 'adb.exe' : 'adb'

const getAdbOutputDirectory = (): string =>
  join(app.getPath('downloads'), 'Develop Workbench')

const isExecutable = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

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

const getEnvironmentCandidates = (): string[] => {
  const adbName = getAdbExecutableName()
  const candidates: string[] = []
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_SDK
  ]

  for (const root of sdkRoots) {
    if (root?.trim()) candidates.push(join(root.trim(), 'platform-tools', adbName))
  }

  return Array.from(new Set(candidates))
}

const getAutoCandidates = (): string[] => {
  const adbName = getAdbExecutableName()
  const candidates: string[] = []

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    const programFiles = process.env.ProgramFiles

    if (localAppData) {
      candidates.push(join(localAppData, 'Android', 'Sdk', 'platform-tools', adbName))
    }
    if (programFiles) {
      candidates.push(join(programFiles, 'Android', 'platform-tools', adbName))
    }
  } else {
    candidates.push(
      join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', adbName),
      join(homedir(), 'Android', 'Sdk', 'platform-tools', adbName),
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb'
    )
  }

  return Array.from(new Set(candidates))
}

const readVersion = async (adbPath: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync(adbPath, ['version'], {
      timeout: 5_000,
      encoding: 'utf8',
      env: getCliEnvironment(adbPath)
    })
    const match = stdout.match(/Version\s+([^\s]+)/i)
    const fallback = stdout.trim().split(/\r?\n/)[0]

    return match?.[1] ?? fallback ?? null
  } catch {
    return null
  }
}

const resolveAdb = async (
  force = false,
  ignoreSettings = false
): Promise<ResolvedAdb | null> => {
  if (!force && cachedAdbResolution !== undefined) return cachedAdbResolution

  const configuredPath = getPreferences().adbPath

  if (configuredPath && !ignoreSettings) {
    cachedAdbResolution = {
      path: configuredPath,
      source: 'settings',
      available: await isExecutable(configuredPath)
    }
    return cachedAdbResolution
  }

  for (const candidate of getEnvironmentCandidates()) {
    if (await isExecutable(candidate)) {
      cachedAdbResolution = {
        path: candidate,
        source: 'environment',
        available: true
      }
      return cachedAdbResolution
    }
  }

  for (const candidate of getAutoCandidates()) {
    if (await isExecutable(candidate)) {
      cachedAdbResolution = {
        path: candidate,
        source: 'auto',
        available: true
      }
      return cachedAdbResolution
    }
  }

  const pathCommand = await findCommandPath('adb')

  if (pathCommand) {
    cachedAdbResolution = {
      path: pathCommand,
      source: 'auto',
      available: true
    }
    return cachedAdbResolution
  }

  cachedAdbResolution = null
  return null
}

const resolveAdbPath = async (): Promise<string> => {
  const resolved = await resolveAdb()

  if (!resolved?.available) {
    throw new Error('未找到可用的 ADB，请先在设置中配置 ADB 路径')
  }

  return resolved.path
}

export const getAdbInfo = async (
  force = false,
  ignoreSettings = false
): Promise<AdbInfo> => {
  const resolved = await resolveAdb(force, ignoreSettings)

  if (!resolved) {
    return { path: null, source: null, version: null, available: false }
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

export const detectAdbInfo = async (): Promise<AdbInfo> => {
  const info = await getAdbInfo(true, true)
  cachedAdbResolution = undefined
  return info
}

export const setAdbPath = async (adbPath: string | null): Promise<AdbInfo> => {
  const normalized = typeof adbPath === 'string' ? adbPath.trim() : ''

  if (normalized) {
    if (!(await isExecutable(normalized))) {
      throw new Error('选择的 ADB 文件不可执行')
    }

    if (!(await readVersion(normalized))) {
      throw new Error('无法执行该 ADB 文件')
    }
  }

  updatePreferences({ adbPath: normalized || undefined })
  cachedAdbResolution = undefined

  return getAdbInfo(true)
}

export const selectAdbPath = async (
  window: BrowserWindow | null
): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title: '选择 ADB 可执行文件',
    properties: ['openFile', 'showHiddenFiles']
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  return result.canceled ? null : result.filePaths[0] ?? null
}

const getAdbErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const record = error as { stdout?: string; stderr?: string }
    const detail = record.stderr?.trim() || record.stdout?.trim() || error.message

    return detail.replace(/\s+/g, ' ').trim().slice(0, 500)
  }

  return 'ADB 操作失败'
}

const runAdb = async (
  args: string[],
  timeout = ADB_TIMEOUT_MS
): Promise<AdbCommandResult> => {
  const adbPath = await resolveAdbPath()

  try {
    const result = await execFileAsync(adbPath, args, {
      timeout,
      maxBuffer: ADB_MAX_BUFFER,
      encoding: 'utf8',
      env: getCliEnvironment(adbPath)
    })

    return {
      command: ['adb', ...args].join(' '),
      stdout: result.stdout,
      stderr: result.stderr
    }
  } catch (error) {
    throw new Error(getAdbErrorMessage(error))
  }
}

const runDeviceAdb = (
  serial: string,
  args: string[],
  timeout = ADB_TIMEOUT_MS
): Promise<AdbCommandResult> => {
  assertSerial(serial)
  return runAdb(['-s', serial, ...args], timeout)
}

const assertSerial = (serial: string): void => {
  if (!/^[A-Za-z0-9._:-]+$/.test(serial)) {
    throw new Error('设备序列号不合法')
  }
}

const assertPackageName = (packageName: string): void => {
  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(packageName)) {
    throw new Error('包名不合法')
  }
}

const assertPort = (port: number): void => {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('端口必须在 1-65535 之间')
  }
}

const parseDeviceState = (value: string): AdbDevice['state'] => {
  switch (value) {
    case 'device':
    case 'offline':
    case 'unauthorized':
    case 'no permissions':
      return value
    default:
      return 'unknown'
  }
}

const parseDeviceLine = (line: string): AdbDevice | null => {
  const parts = line.trim().split(/\s+/)
  const serial = parts.shift()

  if (!serial || serial === 'List' || serial.startsWith('*')) return null

  let stateLabel = parts.shift() ?? 'unknown'

  if (stateLabel === 'no' && parts[0] === 'permissions') {
    parts.shift()
    stateLabel = 'no permissions'
  }

  const details = new Map<string, string>()

  for (const part of parts) {
    const separator = part.indexOf(':')

    if (separator > 0) {
      details.set(part.slice(0, separator), part.slice(separator + 1))
    }
  }

  const model = details.get('model') ?? null
  const product = details.get('product') ?? null
  const device = details.get('device') ?? null

  return {
    serial,
    state: parseDeviceState(stateLabel),
    stateLabel,
    model,
    product,
    device,
    transportId: details.get('transport_id') ?? null,
    emulator: serial.startsWith('emulator-'),
    label: model ?? product ?? serial
  }
}

export const listAdbDevices = async (): Promise<AdbDevice[]> => {
  const result = await runAdb(['devices', '-l'])
  const lines = result.stdout.split(/\r?\n/)

  return lines
    .map(parseDeviceLine)
    .filter((device): device is AdbDevice => device !== null)
}

/** 读取当前前台应用包名，供 RN 调试自动选中应用。 */
export const getAdbForegroundPackage = async (
  serial: string
): Promise<string | null> => {
  assertSerial(serial)
  const result = await runDeviceAdb(serial, ['shell', 'dumpsys', 'activity', 'activities'])
  const patterns = [
    /(?:topResumedActivity|mResumedActivity)=.*?\s([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\//,
    /mFocusedApp=.*?\s([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\//
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(result.stdout)

    if (match?.[1]) return match[1]
  }

  return null
}

export const reloadReactNativeApp = async (
  port: number
): Promise<AdbCommandResult> => {
  assertPort(port)
  const url = `http://127.0.0.1:${port}/reload`

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000)
    })

    if (!response.ok) {
      throw new Error(`开发服务器返回 HTTP ${response.status}`)
    }
  } catch (error) {
    throw new Error(
      `无法触发 Reload，请确认 React Native 开发服务器正在 ${port} 端口运行：${getAdbErrorMessage(error)}`
    )
  }

  return {
    command: `POST ${url}`,
    stdout: 'Reload signal sent',
    stderr: ''
  }
}

export const openAdbDevMenu = (serial: string): Promise<AdbCommandResult> => {
  assertSerial(serial)
  return runDeviceAdb(serial, ['shell', 'input', 'keyevent', '82'])
}

export const openAdbAppSettings = async (
  serial: string,
  packageName: string
): Promise<AdbCommandResult> => {
  assertSerial(serial)
  assertPackageName(packageName)

  return runDeviceAdb(serial, [
    'shell',
    'am',
    'start',
    '-a',
    'android.settings.APPLICATION_DETAILS_SETTINGS',
    '-d',
    `package:${packageName}`
  ])
}

export const openAdbDeepLink = async (
  serial: string,
  url: string,
  packageName = ''
): Promise<AdbCommandResult> => {
  assertSerial(serial)
  const normalized = url.trim()

  if (!normalized || /\s/.test(normalized) || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) {
    throw new Error('请输入有效的深链地址')
  }

  const args = [
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW'
  ]

  if (packageName.trim()) {
    assertPackageName(packageName.trim())
    args.push('-p', packageName.trim())
  }

  args.push('-d', normalized)

  return runDeviceAdb(serial, args)
}

export const getAdbAppInfo = async (
  serial: string,
  packageName: string
): Promise<AdbAppInfo> => {
  assertSerial(serial)
  assertPackageName(packageName)
  const result = await runDeviceAdb(serial, [
    'shell',
    'dumpsys',
    'package',
    packageName
  ])
  const output = result.stdout
  const read = (pattern: RegExp): string | null => pattern.exec(output)?.[1]?.trim() || null
  const pidResult = await runDeviceAdb(serial, ['shell', 'pidof', packageName]).catch(
    () => null
  )
  const pid = pidResult?.stdout.trim() || null
  const flags = /(?:pkgFlags|flags)=\[([^\]]*)\]/.exec(output)?.[1] ?? ''

  return {
    packageName,
    versionName: read(/versionName=(\S+)/),
    versionCode: read(/versionCode=(\d+)/),
    targetSdk: read(/targetSdk=(\d+)/),
    minSdk: read(/minSdk=(\d+)/),
    debuggable: /\bDEBUGGABLE\b/.test(flags),
    running: Boolean(pid),
    pid
  }
}

export const listAdbPermissions = async (
  serial: string,
  packageName: string
): Promise<AdbPermissionInfo[]> => {
  assertSerial(serial)
  assertPackageName(packageName)
  const result = await runDeviceAdb(serial, [
    'shell',
    'dumpsys',
    'package',
    packageName
  ])
  const permissions = new Map<string, boolean>()
  const runtimeSection = result.stdout
    .split('runtime permissions:')[1]
    ?.split(/\n\s*\n/)[0] ?? ''

  for (const line of runtimeSection.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_.]+):\s+granted=(true|false)/.exec(line)

    if (!match) continue

    const name = match[1]
    const granted = match[2] === 'true'

    permissions.set(name, (permissions.get(name) ?? false) || granted)
  }

  return Array.from(permissions, ([name, granted]) => ({ name, granted })).sort(
    (left, right) => left.name.localeCompare(right.name)
  )
}

export const setAdbPermission = async (
  serial: string,
  packageName: string,
  permission: string,
  granted: boolean
): Promise<AdbCommandResult> => {
  assertSerial(serial)
  assertPackageName(packageName)

  if (!/^[A-Za-z0-9_.]+$/.test(permission)) {
    throw new Error('权限名称不合法')
  }

  return runDeviceAdb(serial, [
    'shell',
    'pm',
    granted ? 'grant' : 'revoke',
    packageName,
    permission
  ])
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolveWait) => setTimeout(resolveWait, ms))

const finalizeScreenRecord = async (
  sessionId: string,
  notifyOwner: boolean
): Promise<AdbScreenRecordResult | null> => {
  const session = screenRecordSessions.get(sessionId)

  if (!session || session.finalized) return null

  session.finalized = true
  clearTimeout(session.timer)
  screenRecordSessions.delete(sessionId)
  session.owner.removeListener('destroyed', session.onOwnerDestroyed)

  try {
    await runDeviceAdb(
      session.serial,
      ['shell', 'kill', '-INT', String(session.remotePid)],
      10_000
    ).catch(() => undefined)

    await wait(700)

    let pullError: unknown = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await runAdb(
          ['-s', session.serial, 'pull', session.remotePath, session.localPath],
          120_000
        )
        pullError = null
        break
      } catch (error) {
        pullError = error
        await wait(500)
      }
    }

    if (pullError) throw pullError

    const result: AdbScreenRecordResult = {
      filePath: session.localPath,
      directory: session.directory
    }

    if (notifyOwner && !session.owner.isDestroyed()) {
      session.owner.send('adb:screen-record-finished', {
        sessionId,
        result,
        error: null
      } satisfies AdbScreenRecordFinishedEvent)
    }

    return result
  } catch (error) {
    const detail = getAdbErrorMessage(error)

    if (notifyOwner && !session.owner.isDestroyed()) {
      session.owner.send('adb:screen-record-finished', {
        sessionId,
        result: null,
        error: detail
      } satisfies AdbScreenRecordFinishedEvent)
    }

    return null
  } finally {
    await runDeviceAdb(session.serial, [
      'shell',
      'rm',
      '-f',
      session.remotePath
    ]).catch(() => undefined)
  }
}

export const startAdbScreenRecord = async (
  owner: WebContents,
  serial: string
): Promise<AdbScreenRecordStartResult> => {
  assertSerial(serial)

  if (
    Array.from(screenRecordSessions.values()).some(
      (session) => session.owner.id === owner.id
    )
  ) {
    throw new Error('当前已有正在进行的录屏任务')
  }

  const outputDirectory = getAdbOutputDirectory()
  const timestamp = Date.now()
  const remotePath = `/sdcard/adb-record-${timestamp}.mp4`
  const localPath = join(outputDirectory, `adb-record-${timestamp}.mp4`)

  await mkdir(outputDirectory, { recursive: true })

  // Android screenrecord 单次最长 180 秒；用户也可以随时主动停止。
  const command = `screenrecord --time-limit 180 --bit-rate 4000000 ${remotePath} >/dev/null 2>&1 & echo $!`

  try {
    const result = await runDeviceAdb(serial, ['shell', command], 15_000)
    const remotePid = Number(result.stdout.trim().split(/\s+/).pop())

    if (!Number.isInteger(remotePid) || remotePid <= 0) {
      throw new Error('无法获取录屏进程 ID')
    }

    const sessionId = randomUUID()
    const onOwnerDestroyed = (): void => {
      void finalizeScreenRecord(sessionId, false)
    }
    const session: ScreenRecordSession = {
      id: sessionId,
      owner,
      serial,
      remotePath,
      localPath,
      directory: outputDirectory,
      remotePid,
      timer: setTimeout(() => {
        void finalizeScreenRecord(sessionId, true)
      }, 180_000 + 800),
      finalized: false,
      onOwnerDestroyed
    }

    owner.once('destroyed', onOwnerDestroyed)
    screenRecordSessions.set(sessionId, session)

    return { sessionId }
  } catch (error) {
    await runDeviceAdb(serial, ['shell', 'rm', '-f', remotePath]).catch(
      () => undefined
    )
    throw new Error(getAdbErrorMessage(error))
  }
}

export const stopAdbScreenRecord = async (
  owner: WebContents,
  sessionId: string
): Promise<boolean> => {
  const session = screenRecordSessions.get(sessionId)

  if (!session || session.owner.id !== owner.id) return false

  await finalizeScreenRecord(sessionId, true)
  return true
}

export const listAdbReverse = async (
  serial: string
): Promise<AdbReverseEntry[]> => {
  assertSerial(serial)
  const result = await runDeviceAdb(serial, ['reverse', '--list'])

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      const portMatch = /tcp:(\d+)/.exec(raw)
      const port = portMatch ? Number(portMatch[1]) : null

      return { raw, port }
    })
}

export const detectAdbDevServerPort = async (
  serial: string,
  packageName = ''
): Promise<number | null> => {
  assertSerial(serial)
  const entries = await listAdbReverse(serial).catch(() => [] as AdbReverseEntry[])
  const fallbackPort = entries.find((entry) => entry.port !== null)?.port ?? 8081
  const ports = Array.from(
    new Set([
      ...entries
        .map((entry) => entry.port)
        .filter((port): port is number => port !== null),
      8081,
      8082,
      8083
    ])
  )
  let firstAvailablePort: number | null = null

  for (const port of ports) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(800)
      })

      if (!response.ok) continue

      const targets = (await response.json()) as Array<{
        appId?: unknown
        title?: unknown
      }>

      if (!Array.isArray(targets) || targets.length === 0) continue

      if (!packageName) {
        return port
      }

      firstAvailablePort ??= port
      const matched = targets.some(
        (target) =>
          target.appId === packageName ||
          (typeof target.title === 'string' &&
            target.title.includes(packageName))
      )

      if (matched) return port
    } catch {
      // 端口没有开发服务器时继续尝试下一个。
    }
  }

  return packageName ? null : (firstAvailablePort ?? fallbackPort)
}

export const addAdbReverse = (
  serial: string,
  port: number
): Promise<AdbCommandResult> => {
  assertSerial(serial)
  assertPort(port)
  return runDeviceAdb(serial, ['reverse', `tcp:${port}`, `tcp:${port}`])
}

export const removeAdbReverse = (
  serial: string,
  port: number
): Promise<AdbCommandResult> => {
  assertSerial(serial)
  assertPort(port)
  return runDeviceAdb(serial, ['reverse', '--remove', `tcp:${port}`])
}

export const getAdbDevToolsUrl = async (
  port: number,
  packageName = ''
): Promise<string> => {
  assertPort(port)

  const devServerUrl = `http://127.0.0.1:${port}`
  const response = await fetch(`${devServerUrl}/json/list`, {
    signal: AbortSignal.timeout(3_000)
  }).catch(() => null)

  if (!response?.ok) {
    throw new Error(`无法连接 React Native 开发服务器，请确认 ${port} 端口正在运行`)
  }

  const targets = (await response.json()) as Array<{
    appId?: unknown
    title?: unknown
    webSocketDebuggerUrl?: unknown
    reactNative?: {
      capabilities?: {
        prefersFuseboxFrontend?: unknown
      }
    }
  }>
  const candidates = Array.isArray(targets)
    ? targets.filter(
        (target): target is typeof target & { webSocketDebuggerUrl: string } =>
          typeof target.webSocketDebuggerUrl === 'string' &&
          Boolean(target.webSocketDebuggerUrl)
      )
    : []
  const matchedTarget = packageName
    ? candidates.find(
        (item) =>
          item.appId === packageName ||
          (typeof item.title === 'string' &&
            item.title.includes(packageName))
      )
    : null
  const target = matchedTarget ?? (packageName ? null : candidates[0])

  if (!target) {
    throw new Error(
      packageName
        ? '没有找到当前 App 的 React Native 调试目标，请先启动 App 或刷新页面'
        : '没有找到 React Native 调试目标，请先启动 App 或刷新页面'
    )
  }

  const wsUrl = new URL(target.webSocketDebuggerUrl)
  const serverUrl = new URL(devServerUrl)
  const wsValue =
    wsUrl.host === serverUrl.host
      ? `${wsUrl.pathname}${wsUrl.search}${wsUrl.hash}`
      : `${wsUrl.host}${wsUrl.pathname}${wsUrl.search}${wsUrl.hash}`
  const wsKey = wsUrl.protocol.slice(0, -1)
  const frontend =
    target.reactNative?.capabilities?.prefersFuseboxFrontend === true
      ? 'rn_fusebox.html'
      : 'rn_inspector.html'
  const query = new URLSearchParams({
    [wsKey]: wsValue,
    'sources.hide_add_folder': 'true'
  })

  return `${serverUrl.origin}/debugger-frontend/${frontend}?${query.toString()}`
}

const PAGE_SPY_HOSTS = [
  'https://page-spy-web.milkyway.ali-test.xlbsoft.com',
  'https://page-spy-web.milkyway.ali-prod.xlbsoft.com'
]
const PAGE_SPY_GROUP = 'xlbApp'
const PAGE_SPY_CLOCK_TOLERANCE_MS = 2 * 60 * 1000

const getAppProcessStartAt = async (
  serial: string,
  packageName: string
): Promise<number | null> => {
  let pidResult: AdbCommandResult

  try {
    pidResult = await runDeviceAdb(serial, ['shell', 'pidof', packageName])
  } catch {
    throw new Error('当前 App 未运行，请先启动 App 并开启 PageSpy')
  }

  const pid = pidResult.stdout.trim().split(/\s+/)[0]

  if (!pid || !/^\d+$/.test(pid)) {
    throw new Error('当前 App 未运行，请先启动 App 并开启 PageSpy')
  }

  try {
    const statResult = await runDeviceAdb(serial, [
      'shell',
      'stat',
      '-c',
      '%Y',
      `/proc/${pid}`
    ])
    const seconds = Number(statResult.stdout.trim())

    if (Number.isSafeInteger(seconds) && seconds > 0) {
      return seconds * 1000
    }
  } catch {
    // 旧版 Android 不支持 stat -c 时，下面用 /proc 数据回退。
  }

  try {
    const [procStat, uptimeResult, dateResult] = await Promise.all([
      runDeviceAdb(serial, ['shell', 'cat', `/proc/${pid}/stat`]),
      runDeviceAdb(serial, ['shell', 'cat', '/proc/uptime']),
      runDeviceAdb(serial, ['shell', 'date', '+%s'])
    ])
    const fields = procStat.stdout.slice(procStat.stdout.lastIndexOf(')') + 1).trim().split(/\s+/)
    const startTicks = Number(fields[19])
    const uptime = Number(uptimeResult.stdout.trim().split(/\s+/)[0])
    const nowSeconds = Number(dateResult.stdout.trim())

    if (
      Number.isFinite(startTicks) &&
      Number.isFinite(uptime) &&
      Number.isFinite(nowSeconds)
    ) {
      return (nowSeconds - uptime + startTicks / 100) * 1000
    }
  } catch {
    // 无法获取进程启动时间时，退回仅按设备型号匹配。
  }

  return null
}

export const getPageSpyRoomUrl = async (
  serial: string,
  packageName?: string
): Promise<PageSpyRoomInfo> => {
  assertSerial(serial)
  const targetPackage =
    packageName?.trim() || (await getAdbForegroundPackage(serial))

  if (!targetPackage) {
    throw new Error('没有找到正在运行的前台 App')
  }

  assertPackageName(targetPackage)

  const [brandResult, modelResult, processStartAt] = await Promise.all([
    runDeviceAdb(serial, ['shell', 'getprop', 'ro.product.brand']),
    runDeviceAdb(serial, ['shell', 'getprop', 'ro.product.model']),
    getAppProcessStartAt(serial, targetPackage)
  ])
  const brand = brandResult.stdout.trim()
  const model = modelResult.stdout.trim()
  const fullModel = [brand, model].filter(Boolean).join(' ')

  if (!model) throw new Error('无法读取当前设备型号')

  const rooms: Array<{
    api: string
    group: string | null
    address: string
    name: string | null
    title: string | null
    activeAtMs: number
    createdAtMs: number
    serverNowMs: number
  }> = []

  for (const api of PAGE_SPY_HOSTS) {
    try {
      const response = await fetch(`${api}/api/v1/room/list`, {
        signal: AbortSignal.timeout(5_000)
      })

      if (!response.ok) continue

      const serverNowMs = Date.parse(response.headers.get('date') ?? '')
      const payload = (await response.json()) as {
        data?: Array<{
          group?: unknown
          address?: unknown
          name?: unknown
          tags?: { title?: unknown } | null
          activeAt?: unknown
          createdAt?: unknown
        }> | null
      }

      for (const room of payload.data ?? []) {
        if (typeof room.address !== 'string' || !room.address) continue

        const activeAt =
          typeof room.activeAt === 'string'
            ? room.activeAt
            : typeof room.createdAt === 'string'
              ? room.createdAt
              : ''

        rooms.push({
          api,
          group: typeof room.group === 'string' ? room.group : null,
          address: room.address,
          name: typeof room.name === 'string' ? room.name : null,
          title:
            typeof room.tags?.title === 'string' ? room.tags.title : null,
          activeAtMs: Date.parse(activeAt),
          createdAtMs:
            typeof room.createdAt === 'string'
              ? Date.parse(room.createdAt)
              : Number.NaN,
          serverNowMs: Number.isFinite(serverNowMs) ? serverNowMs : Number.NaN
        })
      }
    } catch {
      // 继续尝试下一个环境。
    }
  }

  const deviceNowMs = Date.now()
  const processAgeMs = processStartAt ? deviceNowMs - processStartAt : null

  const normalizedModel = model.toLowerCase()
  const normalizedFullModel = fullModel.toLowerCase()
  const findMatch = (api: string): (typeof rooms)[number] | undefined =>
    rooms
      .filter((room) => {
        if (room.api !== api) return false
        if (room.group && room.group !== PAGE_SPY_GROUP) return false

        const title = room.title?.toLowerCase() ?? ''
        const titleMatched =
          title.includes(normalizedModel) ||
          (normalizedFullModel && title.includes(normalizedFullModel))

        if (!titleMatched) return false
        if (!processStartAt || processAgeMs === null) return true
        if (!Number.isFinite(room.createdAtMs)) return false

        if (Number.isFinite(room.serverNowMs)) {
          const roomAgeMs = room.serverNowMs - room.createdAtMs

          return roomAgeMs <= processAgeMs + PAGE_SPY_CLOCK_TOLERANCE_MS
        }

        return (
          room.createdAtMs >=
          processStartAt - PAGE_SPY_CLOCK_TOLERANCE_MS
        )
      })
      .sort((left, right) => right.activeAtMs - left.activeAtMs)[0]

  const matched = PAGE_SPY_HOSTS.map(findMatch).find(Boolean)

  if (!matched) {
    throw new Error(
      `没有找到当前 App 进程（${fullModel || model}）创建的 PageSpy 房间，请确认 App 已启动并已开启 PageSpy，然后重试`
    )
  }

  return {
    url: `${matched.api}/#/devtools?address=${encodeURIComponent(matched.address)}`,
    address: matched.address,
    name: matched.name,
    title: matched.title
  }
}

const execFileBuffer = (
  command: string,
  args: string[],
  timeout: number
): Promise<Buffer> =>
  new Promise((resolveBuffer, rejectBuffer) => {
    execFile(
      command,
      args,
      {
        timeout,
        maxBuffer: ADB_MAX_BUFFER,
        encoding: 'buffer',
        env: getCliEnvironment(command)
      },
      (error, stdout) => {
        if (error) {
          rejectBuffer(new Error(getAdbErrorMessage(error)))
          return
        }

        resolveBuffer(stdout)
      }
    )
  })

export const copyAdbScreenshot = async (dataUrl: string): Promise<void> => {
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('截图数据不合法')
  }

  const image = nativeImage.createFromDataURL(dataUrl)

  if (image.isEmpty()) throw new Error('截图数据为空')

  const png = image.toPNG()
  const item = new ClipboardItem({
    'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' })
  })

  await clipboard.write([item])
}

export const takeAdbScreenshot = async (
  serial: string
): Promise<AdbScreenshotResult> => {
  assertSerial(serial)
  const adbPath = await resolveAdbPath()
  const data = await execFileBuffer(
    adbPath,
    ['-s', serial, 'exec-out', 'screencap', '-p'],
    ADB_SCREENSHOT_TIMEOUT_MS
  )

  if (data.length === 0) throw new Error('截图结果为空')

  const directory = getAdbOutputDirectory()
  const filePath = join(directory, `adb-screenshot-${Date.now()}.png`)

  await mkdir(directory, { recursive: true })
  await writeFile(filePath, data)

  return {
    dataUrl: `data:image/png;base64,${data.toString('base64')}`,
    filePath,
    directory
  }
}

export const initializeAdb = (): void => {
  app.on('before-quit', () => {
    for (const sessionId of [...screenRecordSessions.keys()]) {
      void finalizeScreenRecord(sessionId, false)
    }
  })

  ipcMain.handle('adb:get-info', () => getAdbInfo())
  ipcMain.handle('adb:detect', () => detectAdbInfo())
  ipcMain.handle('adb:set-path', (_event, adbPath: unknown) => {
    if (adbPath !== null && typeof adbPath !== 'string') {
      throw new Error('ADB 路径不合法')
    }

    return setAdbPath(adbPath)
  })
  ipcMain.handle('adb:select-path', (event) => {
    return selectAdbPath(BrowserWindow.fromWebContents(event.sender))
  })
  ipcMain.handle('adb:list-devices', () => listAdbDevices())
  ipcMain.handle('adb:foreground-package', (_event, serial: unknown) => {
    if (typeof serial !== 'string') throw new Error('设备序列号不合法')
    return getAdbForegroundPackage(serial)
  })
  ipcMain.handle('adb:reload-app', (_event, port: unknown) => {
    if (typeof port !== 'number') throw new Error('开发服务器端口不合法')
    return reloadReactNativeApp(port)
  })
  ipcMain.handle('adb:open-dev-menu', (_event, serial: unknown) => {
    if (typeof serial !== 'string') throw new Error('设备序列号不合法')
    return openAdbDevMenu(serial)
  })
  ipcMain.handle(
    'adb:open-app-settings',
    (_event, serial: unknown, packageName: unknown) => {
      if (typeof serial !== 'string' || typeof packageName !== 'string') {
        throw new Error('应用设置参数不合法')
      }

      return openAdbAppSettings(serial, packageName)
    }
  )
  ipcMain.handle(
    'adb:open-deep-link',
    (_event, serial: unknown, url: unknown, packageName: unknown) => {
      if (
        typeof serial !== 'string' ||
        typeof url !== 'string' ||
        (packageName !== undefined && typeof packageName !== 'string')
      ) {
        throw new Error('深链参数不合法')
      }

      return openAdbDeepLink(
        serial,
        url,
        typeof packageName === 'string' ? packageName : ''
      )
    }
  )
  ipcMain.handle(
    'adb:app-info',
    (_event, serial: unknown, packageName: unknown) => {
      if (typeof serial !== 'string' || typeof packageName !== 'string') {
        throw new Error('应用信息参数不合法')
      }

      return getAdbAppInfo(serial, packageName)
    }
  )
  ipcMain.handle(
    'adb:list-permissions',
    (_event, serial: unknown, packageName: unknown) => {
      if (typeof serial !== 'string' || typeof packageName !== 'string') {
        throw new Error('权限参数不合法')
      }

      return listAdbPermissions(serial, packageName)
    }
  )
  ipcMain.handle(
    'adb:set-permission',
    (
      _event,
      serial: unknown,
      packageName: unknown,
      permission: unknown,
      granted: unknown
    ) => {
      if (
        typeof serial !== 'string' ||
        typeof packageName !== 'string' ||
        typeof permission !== 'string' ||
        typeof granted !== 'boolean'
      ) {
        throw new Error('权限参数不合法')
      }

      return setAdbPermission(serial, packageName, permission, granted)
    }
  )
  ipcMain.handle('adb:record-screen-start', (event, serial: unknown) => {
    if (typeof serial !== 'string') throw new Error('设备序列号不合法')
    return startAdbScreenRecord(event.sender, serial)
  })
  ipcMain.handle('adb:record-screen-stop', (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('录屏会话不合法')
    return stopAdbScreenRecord(event.sender, sessionId)
  })
  ipcMain.handle('adb:reverse-list', (_event, serial: unknown) => {
    if (typeof serial !== 'string') throw new Error('设备序列号不合法')
    return listAdbReverse(serial)
  })
  ipcMain.handle(
    'adb:detect-dev-server-port',
    (_event, serial: unknown, packageName: unknown) => {
      if (typeof serial !== 'string') throw new Error('设备序列号不合法')

      return detectAdbDevServerPort(
        serial,
        typeof packageName === 'string' ? packageName : ''
      )
    }
  )
  ipcMain.handle(
    'adb:reverse-add',
    (_event, serial: unknown, port: unknown) => {
      if (typeof serial !== 'string' || typeof port !== 'number') {
        throw new Error('Reverse 参数不合法')
      }

      return addAdbReverse(serial, port)
    }
  )
  ipcMain.handle(
    'adb:reverse-remove',
    (_event, serial: unknown, port: unknown) => {
      if (typeof serial !== 'string' || typeof port !== 'number') {
        throw new Error('Reverse 参数不合法')
      }

      return removeAdbReverse(serial, port)
    }
  )
  ipcMain.handle(
    'adb:devtools-url',
    (_event, port: unknown, packageName: unknown) => {
      if (typeof port !== 'number') throw new Error('开发服务器端口不合法')

      return getAdbDevToolsUrl(
        port,
        typeof packageName === 'string' ? packageName : ''
      )
    }
  )
  ipcMain.handle(
    'adb:pagespy-room',
    (_event, serial: unknown, packageName: unknown) => {
      if (typeof serial !== 'string') throw new Error('设备序列号不合法')

      return getPageSpyRoomUrl(
        serial,
        typeof packageName === 'string' ? packageName : undefined
      )
    }
  )
  ipcMain.handle('adb:screenshot', (_event, serial: unknown) => {
    if (typeof serial !== 'string') throw new Error('设备序列号不合法')
    return takeAdbScreenshot(serial)
  })
  ipcMain.handle('adb:copy-screenshot', (_event, dataUrl: unknown) => {
    if (typeof dataUrl !== 'string') throw new Error('截图数据不合法')
    return copyAdbScreenshot(dataUrl)
  })
}
