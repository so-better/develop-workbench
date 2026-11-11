/**
 * 外部 IDE 配置模块。
 * 当前只负责保存启动配置，不直接打开仓库。
 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { getCliEnvironment } from './cli-env'
import { getPreferences, updatePreferences } from './preferences'
import { getRepositoryLocalPath, prepareRepositoryForIde } from './repositories'
import { IDE_PRESETS } from '../types/ide'
import type { IdeConfig, IdeConfigState, IdePresetId } from '../types/ide'

const execFileAsync = promisify(execFile)
const QODER_MAC_COMMAND = '/Applications/Qoder IDE.app/Contents/Resources/app/bin/qoder'

const IDE_COMMAND_CANDIDATES: Record<IdePresetId, string[]> = {
  qoder: [QODER_MAC_COMMAND, 'qoder'],
  vscode: [
    'code',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    '%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe',
    '%ProgramFiles%/Microsoft VS Code/Code.exe'
  ],
  cursor: [
    'cursor',
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    '%LOCALAPPDATA%/Programs/cursor/Cursor.exe',
    '%ProgramFiles%/Cursor/Cursor.exe'
  ],
  trae: ['trae', '/Applications/Trae.app/Contents/MacOS/Trae'],
  webstorm: [
    'webstorm',
    '/Applications/WebStorm.app/Contents/MacOS/webstorm',
    '%LOCALAPPDATA%/JetBrains/Toolbox/scripts/webstorm.cmd'
  ],
  intellij: [
    'idea',
    '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea',
    '%LOCALAPPDATA%/JetBrains/Toolbox/scripts/idea.cmd'
  ],
  pycharm: [
    'pycharm',
    '/Applications/PyCharm.app/Contents/MacOS/pycharm',
    '%LOCALAPPDATA%/JetBrains/Toolbox/scripts/pycharm.cmd'
  ],
  goland: [
    'goland',
    '/Applications/GoLand.app/Contents/MacOS/goland',
    '%LOCALAPPDATA%/JetBrains/Toolbox/scripts/goland.cmd'
  ],
  clion: [
    'clion',
    '/Applications/CLion.app/Contents/MacOS/clion',
    '%LOCALAPPDATA%/JetBrains/Toolbox/scripts/clion.cmd'
  ],
  'android-studio': [
    'studio',
    '/Applications/Android Studio.app/Contents/MacOS/studio',
    '%ProgramFiles%/Android/Android Studio/bin/studio64.exe'
  ],
  xcode: ['xed'],
  sublime: [
    'subl',
    '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl',
    '%ProgramFiles%/Sublime Text/subl.exe',
    '%LOCALAPPDATA%/Programs/Sublime Text/subl.exe'
  ],
  zed: ['zed', '/Applications/Zed.app/Contents/MacOS/zed'],
  fleet: ['fleet', '/Applications/Fleet.app/Contents/MacOS/Fleet'],
  'visual-studio': ['devenv']
}

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
 * 查找 PATH 中的命令。
 */
const expandCommandPath = (command: string): string =>
  command.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? '')

const findCommand = async (command: string): Promise<string | null> => {
  const normalizedCommand = expandCommandPath(command)

  if (isAbsolute(normalizedCommand)) {
    return (await isExecutable(normalizedCommand)) ? normalizedCommand : null
  }

  if (!normalizedCommand) return null

  try {
    const locator = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(locator, [normalizedCommand], {
      timeout: 5_000,
      encoding: 'utf8',
      env: getCliEnvironment(locator)
    })

    return stdout.trim().split(/\r?\n/)[0] || null
  } catch {
    return null
  }
}

/**
 * 读取 IDE 配置及可用状态。
 */
export const getIdeConfigState = async (): Promise<IdeConfigState> => {
  const config = getPreferences().ide ?? null

  return {
    config,
    available: config ? Boolean(await findCommand(config.command)) : false
  }
}

/**
 * 保存 IDE 配置。
 */
export const setIdeConfig = async (input: IdeConfig): Promise<IdeConfigState> => {
  const command = input.command.trim()
  const preset = IDE_PRESETS.find((item) => item.id === input.preset)

  if (!preset) throw new Error('请选择内置 IDE')
  if (!command) throw new Error('请填写 IDE 可执行文件')

  const resolvedCommand = await findCommand(command)

  if (!resolvedCommand) throw new Error('IDE 可执行文件不存在或不可执行')

  updatePreferences({
    ide: {
      preset: preset.id,
      name: preset.name,
      command: resolvedCommand,
      args: preset.args
    }
  })

  return getIdeConfigState()
}

/**
 * 通过 vswhere 查找 Visual Studio 的 devenv.exe。
 */
const findVisualStudioCommand = async (): Promise<string | null> => {
  const roots = [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles
  ].filter((value): value is string => Boolean(value))

  for (const root of roots) {
    const vswhere = join(root, 'Microsoft Visual Studio/Installer/vswhere.exe')

    if (!(await isExecutable(vswhere))) continue

    try {
      const { stdout } = await execFileAsync(
        vswhere,
        [
          '-latest',
          '-products',
          '*',
          '-requires',
          'Microsoft.Component.MSBuild',
          '-find',
          'Common7/IDE/devenv.exe'
        ],
        { timeout: 10_000, encoding: 'utf8' }
      )
      const command = stdout.trim().split(/\r?\n/)[0]

      if (command && (await isExecutable(command))) return command
    } catch {
      // 继续尝试下一个安装根目录。
    }
  }

  return null
}

/**
 * 自动检测当前 IDE。
 */
export const detectIdeConfig = async (presetId: IdePresetId): Promise<IdeConfig> => {
  const preset = IDE_PRESETS.find((item) => item.id === presetId)

  if (!preset) throw new Error('请选择内置 IDE')

  if (presetId === 'visual-studio') {
    const visualStudioCommand = await findVisualStudioCommand()

    if (visualStudioCommand) {
      return {
        preset: preset.id,
        name: preset.name,
        command: visualStudioCommand,
        args: preset.args
      }
    }
  }

  for (const candidate of IDE_COMMAND_CANDIDATES[presetId]) {
    const command = await findCommand(candidate)

    if (command) {
      return {
        preset: preset.id,
        name: preset.name,
        command,
        args: preset.args
      }
    }
  }

  throw new Error(`未检测到 ${preset.name}`)
}

/**
 * 将 macOS .app 解析为可执行文件。
 * 优先使用预设已知的 CLI 路径，其次读取 Info.plist 的 CFBundleExecutable。
 */
const resolveApplicationCommand = async (
  appPath: string,
  presetId?: IdePresetId
): Promise<string | null> => {
  const normalizedAppPath = appPath.replace(/\/$/, '')

  if (!normalizedAppPath.endsWith('.app') || process.platform !== 'darwin') {
    return (await isExecutable(normalizedAppPath)) ? normalizedAppPath : null
  }

  const candidates = presetId ? IDE_COMMAND_CANDIDATES[presetId] ?? [] : []

  for (const candidate of candidates) {
    if (
      candidate.startsWith(`${normalizedAppPath}/`) &&
      (await isExecutable(candidate))
    ) {
      return candidate
    }
  }

  try {
    const { stdout } = await execFileAsync(
      'plutil',
      [
        '-extract',
        'CFBundleExecutable',
        'raw',
        '-o',
        '-',
        join(normalizedAppPath, 'Contents/Info.plist')
      ],
      { timeout: 5_000, encoding: 'utf8' }
    )
    const executable = stdout.trim()

    if (!executable) return null

    const command = join(normalizedAppPath, 'Contents/MacOS', executable)

    return (await isExecutable(command)) ? command : null
  } catch {
    return null
  }
}

/**
 * 获取可用的 IDE 配置。
 */
const getUsableIdeConfig = async (): Promise<IdeConfig> => {
  const state = await getIdeConfigState()

  if (!state.config) throw new Error('请先在设置中配置 IDE')
  if (!state.available) throw new Error('配置的 IDE 当前不可用')

  const preset = IDE_PRESETS.find((item) => item.id === state.config?.preset)

  return preset ? { ...state.config, args: preset.args } : state.config
}

/**
 * 校验 IDE 配置并准备仓库分支。
 * 不启动 IDE，让渲染进程有时间展示切换和拉取结果。
 */
export const prepareRepositoryInIde = async (
  repositoryId: string,
  branchName: string
): Promise<{
  switched: boolean
  pulled: boolean
  hasUpstream: boolean
  conflicted: boolean
}> => {
  await getUsableIdeConfig()
  const prepared = await prepareRepositoryForIde(repositoryId, branchName)

  return {
    switched: prepared.switched,
    pulled: prepared.pulled,
    hasUpstream: prepared.hasUpstream,
    conflicted: prepared.conflicted
  }
}

const quoteWindowsArgument = (value: string): string =>
  /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/** 启动一个脱离当前进程的 IDE/CLI 子进程。 */
const spawnDetached = (
  command: string,
  args: string[],
  cwd?: string
): Promise<void> => {
  const useCommandShell =
    process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)

  return new Promise<void>((resolve, reject) => {
    const child = useCommandShell
      ? spawn(
          process.env.ComSpec || 'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            `"${[command, ...args].map(quoteWindowsArgument).join(' ')}"`
          ],
          {
            cwd,
            env: getCliEnvironment(command),
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            windowsVerbatimArguments: true
          }
        )
      : spawn(command, args, {
          cwd,
          env: getCliEnvironment(command),
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** macOS 命令所在的应用包路径。 */
const getMacAppBundle = (command: string): string | null => {
  const marker = '.app/'
  const index = command.indexOf(marker)

  if (index >= 0) return command.slice(0, index + 4)

  return command.endsWith('.app') ? command : null
}

/** Windows 上不同 IDE 的进程名，优先使用常见进程名。 */
const IDE_WINDOWS_PROCESS_NAMES: Partial<Record<IdePresetId, string[]>> = {
  qoder: ['Qoder'],
  vscode: ['Code'],
  cursor: ['Cursor'],
  trae: ['Trae'],
  webstorm: ['webstorm64', 'webstorm'],
  intellij: ['idea64', 'idea'],
  pycharm: ['pycharm64', 'pycharm'],
  goland: ['goland64', 'goland'],
  clion: ['clion64', 'clion'],
  'android-studio': ['studio64', 'studio'],
  sublime: ['sublime_text'],
  zed: ['zed'],
  fleet: ['fleet'],
  'visual-studio': ['devenv']
}

/** 读取 Qoder 窗口 Renderer 进程 PID。 */
const getQoderRendererPids = async (): Promise<Set<string>> => {
  if (process.platform !== 'darwin') return new Set()

  try {
    const { stdout } = await execFileAsync(
      'pgrep',
      ['-f', 'Qoder Helper \(Renderer\)'],
      { timeout: 3_000, encoding: 'utf8' }
    )

    return new Set(stdout.trim().split(/\s+/).filter(Boolean))
  } catch {
    return new Set()
  }
}

/** 等待 Qoder 新窗口出现，再留出渲染和扩展加载时间。 */
const waitForQoderWindowReady = async (
  previousPids: Set<string>,
  wasRunning: boolean
): Promise<void> => {
  if (process.platform !== 'darwin') {
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    return
  }

  if (wasRunning) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    return
  }

  const deadline = Date.now() + 6_000

  while (Date.now() < deadline) {
    const pids = await getQoderRendererPids()

    if ([...pids].some((pid) => !previousPids.has(pid))) break

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  await new Promise((resolve) => setTimeout(resolve, 500))
}

/** 将当前配置对应的 IDE 窗口带到最前面，优先匹配仓库目录名。 */
const focusIdeWindow = async (
  config: IdeConfig,
  repositoryPath: string
): Promise<void> => {
  try {
    if (process.platform === 'darwin') {
      const target = getMacAppBundle(config.command) ?? config.name

      await execFileAsync('open', ['-a', target, repositoryPath], {
        timeout: 5_000,
        encoding: 'utf8'
      }).catch(() => undefined)

      await new Promise((resolve) => setTimeout(resolve, 200))

      await execFileAsync(
        'osascript',
        ['-e', `tell application "${target.replace(/"/g, '\\"')}" to activate`],
        { timeout: 5_000, encoding: 'utf8' }
      )
      return
    }

    if (process.platform === 'win32') {
      const commandName = basename(config.command).replace(/\.(cmd|bat|exe)$/i, '')
      const names = [
        ...(IDE_WINDOWS_PROCESS_NAMES[config.preset] ?? []),
        commandName
      ]
        .filter(Boolean)
        .map((name) => `'${name.replace(/'/g, "''")}'`)
        .join(',')
      const repositoryName = basename(repositoryPath).replace(/'/g, "''")
      const script = `$names=@(${names}); $repo='${repositoryName}'; Add-Type -Name Win32 -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);'; foreach($name in $names){ $processes=Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }; $p=$processes | Where-Object { $_.MainWindowTitle -like "*$repo*" } | Select-Object -First 1; if(-not $p){ $p=$processes | Select-Object -First 1 }; if($p){ [Native.Win32]::SetForegroundWindow($p.MainWindowHandle); break } }`

      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
        timeout: 5_000,
        encoding: 'utf8'
      })
    }
  } catch {
    // 激活失败不影响打开仓库。
  }
}

/**
 * 使用配置的 IDE 打开已准备好的仓库。
 * Qoder 额外通过 DeepLink 新建预填 AI 会话。
 */
export const launchRepositoryInIde = async (
  repositoryId: string,
  chatPrompt?: string
): Promise<void> => {
  const config = await getUsableIdeConfig()
  const repositoryPath = await getRepositoryLocalPath(repositoryId)
  const args = config.args.map((arg) => arg.replace(/\{path\}/g, repositoryPath))
  const qoderChatDeeplink =
    config.preset === 'qoder' && chatPrompt?.trim()
      ? `qoder-ide://aicoding.aicoding-deeplink/chat?text=${encodeURIComponent(
          chatPrompt.trim()
        )}&mode=agent&isNewChat=true`
      : null

  const qoderRendererPids = qoderChatDeeplink
    ? await getQoderRendererPids()
    : new Set<string>()
  const macAppBundle =
    process.platform === 'darwin' ? getMacAppBundle(config.command) : null

  if (macAppBundle) {
    // 直接让 LaunchServices 打开目标目录，避免 CLI 与激活窗口之间的竞争。
    await execFileAsync('open', ['-a', macAppBundle, repositoryPath], {
      timeout: 30_000,
      encoding: 'utf8'
    })
  } else {
    await spawnDetached(config.command, args)
  }

  if (qoderChatDeeplink) {
    await waitForQoderWindowReady(
      qoderRendererPids,
      qoderRendererPids.size > 0
    )
    await shell.openExternal(qoderChatDeeplink)
  }

  if (!macAppBundle) {
    await focusIdeWindow(config, repositoryPath)
  }
}

/**
 * 选择 IDE 应用或可执行文件。
 */
export const selectIdeCommand = async (
  currentPath?: string,
  presetId?: IdePresetId
): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title: '选择 IDE 应用或可执行文件',
    properties: ['openFile', 'showHiddenFiles'],
    defaultPath:
      process.platform === 'darwin' ? '/Applications' : currentPath || homedir()
  }
  const focusedWindow = BrowserWindow.getFocusedWindow()
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || !result.filePaths[0]) return null

  return resolveApplicationCommand(result.filePaths[0], presetId)
}

/**
 * 注册 IDE 配置 IPC。
 */
export const initializeIde = (): void => {
  ipcMain.handle('ide:get', () => getIdeConfigState())
  ipcMain.handle('ide:set', (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('IDE 配置不合法')

    const value = input as Partial<IdeConfig>

    if (typeof value.preset !== 'string' || typeof value.command !== 'string') {
      throw new Error('IDE 配置不合法')
    }

    return setIdeConfig({
      preset: value.preset,
      name: '',
      command: value.command,
      args: []
    })
  })
  ipcMain.handle('ide:detect', (_event, presetId: unknown) => {
    if (typeof presetId !== 'string') throw new Error('IDE 预设不合法')
    return detectIdeConfig(presetId as IdePresetId)
  })
  ipcMain.handle(
    'ide:prepare-repository',
    (_event, repositoryId: unknown, branchName: unknown) => {
      if (typeof repositoryId !== 'string' || typeof branchName !== 'string') {
        throw new Error('打开仓库参数不合法')
      }

      return prepareRepositoryInIde(repositoryId, branchName)
    }
  )

  ipcMain.handle(
    'ide:launch-repository',
    (_event, repositoryId: unknown, chatPrompt: unknown) => {
      if (typeof repositoryId !== 'string') throw new Error('仓库 ID 不合法')
      if (chatPrompt !== undefined && typeof chatPrompt !== 'string') {
        throw new Error('会话内容不合法')
      }

      return launchRepositoryInIde(repositoryId, chatPrompt)
    }
  )
  ipcMain.handle(
    'ide:select-command',
    (_event, currentPath: unknown, presetId: unknown) =>
      selectIdeCommand(
        typeof currentPath === 'string' ? currentPath : undefined,
        typeof presetId === 'string' ? (presetId as IdePresetId) : undefined
      )
  )
}
