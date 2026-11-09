/**
 * 内嵌终端会话管理。
 * 每个标签对应一个独立 PTY，由主进程持有，渲染层只负责展示和转发输入。
 */
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell
} from 'electron'
import type { OpenDialogOptions, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { getCliEnvironment } from './cli-env'
import { getPreferences, updateTerminalSettings } from './preferences'
import type {
  TerminalCreateInput,
  TerminalSessionInfo,
  TerminalSettings,
  TerminalShellInfo,
  TerminalShellSource
} from '../types/terminal'

const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30
const MIN_COLS = 20
const MAX_COLS = 500
const MIN_ROWS = 5
const MAX_ROWS = 300
const DEFAULT_TITLE = '终端'

interface TerminalSession {
  id: string
  pty: IPty
  ownerId: number
  shell: string
  cwd: string
  cols: number
  rows: number
  title: string
  customTitle: boolean
  exited: boolean
}

const sessions = new Map<string, TerminalSession>()
const ownerSessions = new Map<number, Set<string>>()
const trackedOwners = new Set<number>()

const clampDimension = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback

  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** 校验路径指向一个存在的文件，避免把目录当成 shell。 */
const isShellFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

interface ResolvedShell {
  file: string
  args: string[]
  source: TerminalShellSource
}

const resolveShell = (useConfigured: boolean): ResolvedShell => {
  const configured = useConfigured ? getPreferences().terminal.shell : null

  if (configured && isShellFile(configured)) {
    return {
      file: configured,
      args:
        process.platform === 'win32' && /powershell|pwsh/i.test(configured)
          ? ['-NoLogo']
          : [],
      source: 'settings'
    }
  }

  if (process.platform === 'win32') {
    const file = process.env.COMSPEC || 'powershell.exe'

    return {
      file,
      args: /powershell|pwsh/i.test(file) ? ['-NoLogo'] : [],
      source: process.env.COMSPEC ? 'environment' : 'auto'
    }
  }

  if (process.env.SHELL && isShellFile(process.env.SHELL)) {
    return { file: process.env.SHELL, args: ['-l'], source: 'environment' }
  }

  const candidates =
    process.platform === 'darwin'
      ? ['/bin/zsh', '/bin/bash', '/bin/sh']
      : ['/bin/bash', '/bin/sh']
  const file = candidates.find(isShellFile) ?? '/bin/sh'

  return { file, args: ['-l'], source: 'auto' }
}

const getDefaultShell = (): { file: string; args: string[] } => {
  const resolved = resolveShell(true)

  return { file: resolved.file, args: resolved.args }
}

const getShellInfo = (useConfigured = true): TerminalShellInfo => {
  const resolved = resolveShell(useConfigured)

  return {
    path: resolved.file,
    available: isShellFile(resolved.file),
    source: resolved.source,
    name: basename(resolved.file).replace(/\.exe$/i, '') || resolved.file
  }
}

const toSessionInfo = (session: TerminalSession): TerminalSessionInfo => ({
  id: session.id,
  title: session.title,
  customTitle: session.customTitle,
  shell: session.shell,
  cwd: session.cwd,
  cols: session.cols,
  rows: session.rows
})

const getOwnerSessionInfos = (ownerId: number): TerminalSessionInfo[] => {
  const ids = ownerSessions.get(ownerId)

  if (!ids) return []

  return Array.from(ids)
    .map((id) => sessions.get(id))
    .filter((session): session is TerminalSession => session !== undefined)
    .map(toSessionInfo)
}

const removeSession = (id: string): void => {
  const session = sessions.get(id)

  if (!session) return

  sessions.delete(id)
  const owned = ownerSessions.get(session.ownerId)

  if (owned) {
    owned.delete(id)
    if (owned.size === 0) ownerSessions.delete(session.ownerId)
  }

  if (!session.exited) {
    try {
      session.pty.kill()
    } catch {
      // 进程可能已经自行退出。
    }
  }
}

const stopOwnerSessions = (ownerId: number): void => {
  for (const id of [...(ownerSessions.get(ownerId) ?? [])]) {
    removeSession(id)
  }
}

/** 窗口销毁时清理其名下的全部会话，避免 PTY 僵尸进程。 */
const trackOwner = (owner: WebContents): void => {
  if (trackedOwners.has(owner.id)) return

  trackedOwners.add(owner.id)
  owner.once('destroyed', () => {
    trackedOwners.delete(owner.id)
    stopOwnerSessions(owner.id)
  })
}

const createSession = (
  owner: WebContents,
  input: TerminalCreateInput
): TerminalSession => {
  const cols = clampDimension(input.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS)
  const rows = clampDimension(input.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS)
  const explicitCwd =
    typeof input.cwd === 'string' && input.cwd && existsSync(input.cwd)
      ? input.cwd
      : null
  const cwd = explicitCwd ?? homedir()
  const { file, args } = getDefaultShell()
  const child = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...getCliEnvironment(),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    }
  })
  const session: TerminalSession = {
    id: randomUUID(),
    pty: child,
    ownerId: owner.id,
    shell: file,
    cwd,
    cols,
    rows,
    title: explicitCwd ? basename(explicitCwd) || DEFAULT_TITLE : DEFAULT_TITLE,
    customTitle: false,
    exited: false
  }

  sessions.set(session.id, session)

  const owned = ownerSessions.get(owner.id) ?? new Set<string>()
  owned.add(session.id)
  ownerSessions.set(owner.id, owned)

  trackOwner(owner)

  child.onData((data) => {
    const current = sessions.get(session.id)

    if (!current) return

    if (!owner.isDestroyed()) {
      owner.send('terminal:data', { id: current.id, data })
    }
  })

  child.onExit(({ exitCode, signal }) => {
    const current = sessions.get(session.id)

    if (!current) return

    current.exited = true

    if (!owner.isDestroyed()) {
      owner.send('terminal:exit', {
        id: current.id,
        exitCode,
        signal
      })
    }
  })

  return session
}

const getOwnedSession = (
  ownerId: number,
  id: unknown
): TerminalSession | null => {
  if (typeof id !== 'string') return null

  const session = sessions.get(id)

  if (!session || session.ownerId !== ownerId) return null

  return session
}

/**
 * 注册终端 IPC。
 * 读写分离：输入和尺寸调整走 send，避免每个按键都等待一次 invoke。
 */
export const initializeTerminal = (): void => {
  ipcMain.handle('terminal:restore', (event, cwd: unknown) => {
    const existing = getOwnerSessionInfos(event.sender.id)

    if (existing.length > 0) return existing

    createSession(event.sender, {
      cwd: typeof cwd === 'string' && cwd ? cwd : undefined
    })

    return getOwnerSessionInfos(event.sender.id)
  })

  ipcMain.handle('terminal:create', (event, input: unknown) => {
    const value =
      input && typeof input === 'object' ? (input as TerminalCreateInput) : {}

    return toSessionInfo(createSession(event.sender, value))
  })

  ipcMain.on('terminal:write', (event, id: unknown, data: unknown) => {
    if (typeof data !== 'string') return

    const session = getOwnedSession(event.sender.id, id)

    if (!session || session.exited) return

    session.pty.write(data)
  })

  ipcMain.on(
    'terminal:resize',
    (event, id: unknown, cols: unknown, rows: unknown) => {
      const session = getOwnedSession(event.sender.id, id)

      if (!session || session.exited) return

      const nextCols = clampDimension(cols, session.cols, MIN_COLS, MAX_COLS)
      const nextRows = clampDimension(rows, session.rows, MIN_ROWS, MAX_ROWS)

      if (nextCols === session.cols && nextRows === session.rows) return

      session.cols = nextCols
      session.rows = nextRows

      try {
        session.pty.resize(nextCols, nextRows)
      } catch {
        // 进程退出瞬间调整尺寸可能失败。
      }
    }
  )

  ipcMain.on('terminal:close', (event, id: unknown) => {
    const session = getOwnedSession(event.sender.id, id)

    if (session) removeSession(session.id)
  })

  ipcMain.handle('terminal:read-clipboard', () => clipboard.readText())

  ipcMain.on(
    'terminal:update-title',
    (event, id: unknown, title: unknown, custom: unknown) => {
      if (typeof title !== 'string') return

      const session = getOwnedSession(event.sender.id, id)

      if (!session) return

      session.title = title.trim() || DEFAULT_TITLE
      session.customTitle = custom === true
    }
  )

  ipcMain.on('terminal:reorder', (event, ids: unknown) => {
    if (!Array.isArray(ids)) return

    const ownerId = event.sender.id
    const owned = ownerSessions.get(ownerId)

    if (!owned) return

    const ordered: string[] = []
    const seen = new Set<string>()

    for (const id of ids) {
      if (typeof id !== 'string' || seen.has(id) || !owned.has(id)) continue

      seen.add(id)
      ordered.push(id)
    }

    for (const id of owned) {
      if (seen.has(id)) continue

      seen.add(id)
      ordered.push(id)
    }

    const orderedSessions = ordered
      .map((id) => sessions.get(id))
      .filter((session): session is TerminalSession => session !== undefined)
    const otherSessions = Array.from(sessions.entries()).filter(
      ([, session]) => session.ownerId !== ownerId
    )

    sessions.clear()

    for (const [id, session] of otherSessions) sessions.set(id, session)
    for (const session of orderedSessions) sessions.set(session.id, session)

    ownerSessions.set(ownerId, new Set(orderedSessions.map((session) => session.id)))
  })

  ipcMain.handle('terminal:get-settings', () => getPreferences().terminal)

  ipcMain.handle('terminal:get-shell-info', () => getShellInfo())

  ipcMain.handle('terminal:detect-shell', () => getShellInfo(false))

  ipcMain.handle('terminal:update-settings', (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') {
      throw new Error('终端设置不合法')
    }

    const value = patch as Partial<TerminalSettings>

    if (
      typeof value.shell === 'string' &&
      value.shell.trim() &&
      !isShellFile(value.shell.trim())
    ) {
      throw new Error('Shell 路径不存在或不是文件')
    }

    const next = updateTerminalSettings(value)

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('terminal:settings-changed', next)
      }
    }

    return next
  })

  ipcMain.handle('terminal:select-shell', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: '选择终端 Shell',
      properties: ['openFile', 'showHiddenFiles']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null

    return result.filePaths[0]
  })

  ipcMain.handle('terminal:open-path', async (_event, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      throw new Error('路径不合法')
    }

    let target = rawPath.trim()

    if (target === '~' || target.startsWith('~/')) {
      target = join(homedir(), target.slice(1))
    }

    if (!isAbsolute(target)) throw new Error('只支持绝对路径')

    try {
      statSync(target)
    } catch {
      throw new Error('路径不存在')
    }

    const error = await shell.openPath(target)

    if (error) throw new Error(error)
  })

  ipcMain.handle('terminal:select-directory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: '选择终端工作目录',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null

    return result.filePaths[0]
  })

  app.on('before-quit', () => {
    for (const id of [...sessions.keys()]) removeSession(id)
  })
}
