/**
 * 电源管理。
 * 运行时保持唤醒使用 Electron powerSaveBlocker；系统策略通过 pmset/powercfg 修改。
 */
import { app, ipcMain, powerSaveBlocker } from 'electron'
import { execFile } from 'node:child_process'
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { getPreferences, updatePreferences } from './preferences'
import type {
  PowerPlatform,
  PowerSettingKey,
  PowerSettingsState
} from '../types/power'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 120_000
const BACKUP_FILE = 'power-settings-backup.json'
const DEFAULT_MAC_SLEEP_AC = 10
const DEFAULT_MAC_SLEEP_BATTERY = 1
const DEFAULT_WIN_STANDBY_SECONDS = 30 * 60

interface PowerBackup {
  macLockSleepAc?: number
  macLockSleepBattery?: number
  winLockStandbyAc?: number
  winLockStandbyDc?: number
}

interface MacStatus {
  lidSupported: boolean
  lidSleepDisabled: boolean
  lockScreenSleepDisabled: boolean
  acSleep: number | null
  batterySleep: number | null
}

interface WindowsStatus {
  lidSupported: boolean
  lidSleepDisabled: boolean
  lockScreenSleepDisabled: boolean
  lidAc: number | null
  lidDc: number | null
  standbyAc: number | null
  standbyDc: number | null
}

let blockerId: number | null = null

const getPlatform = (): PowerPlatform => {
  if (process.platform === 'darwin') return 'darwin'
  if (process.platform === 'win32') return 'win32'

  return 'unsupported'
}

const getPlatformLabel = (platform: PowerPlatform): string => {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'

  return '当前系统'
}

const getBackupPath = (): string => join(app.getPath('userData'), BACKUP_FILE)

const readBackup = async (): Promise<PowerBackup> => {
  try {
    const parsed = JSON.parse(await readFile(getBackupPath(), 'utf8')) as PowerBackup

    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const writeBackup = async (backup: PowerBackup): Promise<void> => {
  try {
    await writeFile(getBackupPath(), JSON.stringify(backup, null, 2), 'utf8')
  } catch {
    // 备份失败不阻断当前操作；关闭开关时使用默认值回退。
  }
}

const clearBackup = async (): Promise<void> => {
  try {
    await unlink(getBackupPath())
  } catch {
    // 备份不存在时无需处理。
  }
}

/** 清理上次异常退出遗留的 Windows 提权脚本。 */
const cleanupStaleWindowsScripts = async (): Promise<void> => {
  if (process.platform !== 'win32') return

  try {
    const entries = await readdir(app.getPath('userData'))

    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.startsWith('power-settings-') && entry.endsWith('.cmd')
        )
        .map((entry) =>
          unlink(join(app.getPath('userData'), entry)).catch(() => undefined)
        )
    )
  } catch {
    // 清理失败不影响电源设置使用。
  }
}

const run = async (file: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(file, args, {
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  })

  return String(stdout)
}

const runMacPrivileged = async (command: string): Promise<void> => {
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

  await run('osascript', [
    '-e',
    `do shell script "${escaped}" with administrator privileges`
  ])
}

const quoteWindowsArg = (value: string): string =>
  /[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

const runWindowsElevated = async (commands: string[][]): Promise<void> => {
  const scriptPath = join(
    app.getPath('userData'),
    `power-settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.cmd`
  )
  const content = [
    '@echo off',
    ...commands.map(
      (args) => `${args.map(quoteWindowsArg).join(' ')} || exit /b 1`
    ),
    'exit /b %errorlevel%'
  ].join('\r\n')

  await writeFile(scriptPath, content, 'utf8')

  const scriptPathLiteral = scriptPath.replace(/'/g, "''")
  const powershell = [
    `$process = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/c', '"${scriptPathLiteral}"' -Verb RunAs -Wait -PassThru`,
    'exit $process.ExitCode'
  ].join('; ')

  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', powershell],
      { timeout: COMMAND_TIMEOUT_MS, windowsHide: true }
    )
  } catch {
    throw new Error('系统授权已取消，或电源设置执行失败')
  } finally {
    await unlink(scriptPath).catch(() => undefined)
  }
}

const parseMacPowerSources = (
  output: string
): { acSleep: number | null; batterySleep: number | null } => {
  let source: 'ac' | 'battery' | null = null
  let acSleep: number | null = null
  let batterySleep: number | null = null

  for (const line of output.split('\n')) {
    if (/^AC Power:/.test(line)) source = 'ac'
    else if (/^Battery Power:/.test(line)) source = 'battery'

    const match = /^\s*sleep\s+(\d+)/.exec(line)

    if (!match || !source) continue

    const value = Number(match[1])

    if (source === 'ac') acSleep = value
    else batterySleep = value
  }

  return { acSleep, batterySleep }
}

const getMacStatus = async (): Promise<MacStatus> => {
  const [general, custom] = await Promise.all([
    run('pmset', ['-g']),
    run('pmset', ['-g', 'custom'])
  ])
  const sleepDisabledMatch = /SleepDisabled\s+(\d+)/.exec(general)
  const sleepValues = parseMacPowerSources(custom)
  const configuredSleepValues = [sleepValues.acSleep, sleepValues.batterySleep].filter(
    (value): value is number => value !== null
  )

  return {
    lidSupported: Boolean(sleepDisabledMatch),
    lidSleepDisabled: sleepDisabledMatch?.[1] === '1',
    lockScreenSleepDisabled:
      configuredSleepValues.length > 0 &&
      configuredSleepValues.every((value) => value === 0),
    acSleep: sleepValues.acSleep,
    batterySleep: sleepValues.batterySleep
  }
}

const getWindowsSettingValues = async (
  sub: string,
  setting: string
): Promise<number[]> => {
  const output = await run('powercfg', [
    '/query',
    'SCHEME_CURRENT',
    sub,
    setting
  ])

  return [...output.matchAll(/0x([0-9a-f]+)/gi)].map((match) =>
    Number.parseInt(match[1], 16)
  )
}

const getWindowsStatus = async (): Promise<WindowsStatus> => {
  let lidAc: number | null = null
  let lidDc: number | null = null
  let standbyAc: number | null = null
  let standbyDc: number | null = null
  let lidSupported = false

  try {
    const values = await getWindowsSettingValues('SUB_BUTTONS', 'LIDACTION')
    lidAc = values[0] ?? null
    lidDc = values[1] ?? lidAc
    lidSupported = values.length > 0
  } catch {
    // 部分设备没有合盖设置。
  }

  try {
    const values = await getWindowsSettingValues('SUB_SLEEP', 'STANDBYIDLE')
    standbyAc = values[0] ?? null
    standbyDc = values[1] ?? standbyAc
  } catch {
    // 查询失败时保持关闭状态。
  }

  const lidValues = [lidAc, lidDc].filter((value): value is number => value !== null)
  const standbyValues = [standbyAc, standbyDc].filter(
    (value): value is number => value !== null
  )

  return {
    lidSupported,
    lidSleepDisabled: lidValues.length > 0 && lidValues.every((value) => value === 0),
    lockScreenSleepDisabled:
      standbyValues.length > 0 && standbyValues.every((value) => value === 0),
    lidAc,
    lidDc,
    standbyAc,
    standbyDc
  }
}

const applyRuntimeKeepAwake = (enabled: boolean): void => {
  if (enabled) {
    if (blockerId === null) {
      blockerId = powerSaveBlocker.start('prevent-app-suspension')
    }
    return
  }

  if (blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

const getState = async (): Promise<PowerSettingsState> => {
  const platform = getPlatform()
  const runtimeKeepAwake = getPreferences().powerRuntimeKeepAwake === true

  if (platform === 'darwin') {
    const status = await getMacStatus()

    return {
      platform,
      platformLabel: getPlatformLabel(platform),
      supportsSystemSettings: true,
      lidSupported: status.lidSupported,
      runtimeKeepAwake,
      lidSleepDisabled: status.lidSleepDisabled,
      lockScreenSleepDisabled: status.lockScreenSleepDisabled
    }
  }

  if (platform === 'win32') {
    const status = await getWindowsStatus()

    return {
      platform,
      platformLabel: getPlatformLabel(platform),
      supportsSystemSettings: true,
      lidSupported: status.lidSupported,
      runtimeKeepAwake,
      lidSleepDisabled: status.lidSleepDisabled,
      lockScreenSleepDisabled: status.lockScreenSleepDisabled
    }
  }

  return {
    platform,
    platformLabel: getPlatformLabel(platform),
    supportsSystemSettings: false,
    lidSupported: false,
    runtimeKeepAwake,
    lidSleepDisabled: false,
    lockScreenSleepDisabled: false
  }
}

const setMacLidSleep = async (enabled: boolean): Promise<void> => {
  await runMacPrivileged(`pmset -a disablesleep ${enabled ? 1 : 0}`)
}

const setMacLockSleep = async (enabled: boolean): Promise<void> => {
  const status = await getMacStatus()

  if (enabled) {
    const currentBackup = await readBackup()

    await writeBackup({
      ...currentBackup,
      macLockSleepAc:
        currentBackup.macLockSleepAc ??
        status.acSleep ??
        DEFAULT_MAC_SLEEP_AC,
      macLockSleepBattery:
        currentBackup.macLockSleepBattery ??
        status.batterySleep ??
        DEFAULT_MAC_SLEEP_BATTERY
    })
  }

  const backup = await readBackup()
  const acSleep = enabled
    ? 0
    : backup.macLockSleepAc && backup.macLockSleepAc > 0
      ? backup.macLockSleepAc
      : DEFAULT_MAC_SLEEP_AC
  const batterySleep = enabled
    ? 0
    : backup.macLockSleepBattery && backup.macLockSleepBattery > 0
      ? backup.macLockSleepBattery
      : DEFAULT_MAC_SLEEP_BATTERY
  const commands: string[] = []

  if (status.acSleep !== null) commands.push(`pmset -c sleep ${acSleep}`)
  if (status.batterySleep !== null) commands.push(`pmset -b sleep ${batterySleep}`)
  if (commands.length === 0) commands.push(`pmset -a sleep ${acSleep}`)

  await runMacPrivileged(commands.join('; '))

  if (!enabled) await clearBackup()
}

const setWindowsLidSleep = async (enabled: boolean): Promise<void> => {
  const value = String(enabled ? 0 : 1)

  await runWindowsElevated([
    ['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', value],
    ['/setdcvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', value],
    ['/setactive', 'SCHEME_CURRENT']
  ])
}

const setWindowsLockSleep = async (enabled: boolean): Promise<void> => {
  const status = await getWindowsStatus()

  if (enabled) {
    const currentBackup = await readBackup()

    await writeBackup({
      ...currentBackup,
      winLockStandbyAc:
        currentBackup.winLockStandbyAc ??
        status.standbyAc ??
        DEFAULT_WIN_STANDBY_SECONDS,
      winLockStandbyDc:
        currentBackup.winLockStandbyDc ??
        status.standbyDc ??
        DEFAULT_WIN_STANDBY_SECONDS
    })
  }

  const backup = await readBackup()
  const acSeconds = enabled
    ? 0
    : backup.winLockStandbyAc && backup.winLockStandbyAc > 0
      ? backup.winLockStandbyAc
      : DEFAULT_WIN_STANDBY_SECONDS
  const dcSeconds = enabled
    ? 0
    : backup.winLockStandbyDc && backup.winLockStandbyDc > 0
      ? backup.winLockStandbyDc
      : DEFAULT_WIN_STANDBY_SECONDS

  await runWindowsElevated([
    [
      '/setacvalueindex',
      'SCHEME_CURRENT',
      'SUB_SLEEP',
      'STANDBYIDLE',
      String(acSeconds)
    ],
    [
      '/setdcvalueindex',
      'SCHEME_CURRENT',
      'SUB_SLEEP',
      'STANDBYIDLE',
      String(dcSeconds)
    ],
    ['/setactive', 'SCHEME_CURRENT']
  ])

  if (!enabled) await clearBackup()
}

const setPowerSetting = async (
  key: PowerSettingKey,
  enabled: boolean
): Promise<PowerSettingsState> => {
  if (key !== 'runtime' && key !== 'lid' && key !== 'lock') {
    throw new Error('电源设置项不合法')
  }

  if (typeof enabled !== 'boolean') {
    throw new Error('电源设置值不合法')
  }

  if (key === 'runtime') {
    updatePreferences({ powerRuntimeKeepAwake: enabled })
    applyRuntimeKeepAwake(enabled)
    return getState()
  }

  const platform = getPlatform()

  if (platform === 'unsupported') {
    throw new Error('当前系统不支持修改电源策略')
  }

  if (platform === 'darwin') {
    if (key === 'lid') await setMacLidSleep(enabled)
    else await setMacLockSleep(enabled)
  } else if (key === 'lid') {
    await setWindowsLidSleep(enabled)
  } else {
    await setWindowsLockSleep(enabled)
  }

  return getState()
}

/** 注册电源设置 IPC，并恢复应用启动前保存的运行期间唤醒设置。 */
export const initializePowerSettings = (): void => {
  void cleanupStaleWindowsScripts()
  applyRuntimeKeepAwake(getPreferences().powerRuntimeKeepAwake === true)

  ipcMain.handle('power:get-settings', () => getState())
  ipcMain.handle('power:set-setting', (_event, key: unknown, enabled: unknown) =>
    setPowerSetting(key as PowerSettingKey, enabled as boolean)
  )

  app.once('before-quit', () => {
    applyRuntimeKeepAwake(false)
  })
}
