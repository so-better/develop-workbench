/**
 * 代码仓库业务模块。
 * 负责根目录扫描、仓库元数据维护和 Git 克隆。
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { constants } from 'node:fs'
import { access, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { getPreferences, updatePreferences } from './preferences'
import type {
  CloneRepositoryInput,
  Repository,
  RepositoryCloneProgress,
  RepositoryScanResult,
  RepositoryState,
  UpdateRepositoryInput
} from '../types/repository'

// 从 Git 仓库现场读取、尚未写入应用数据的仓库信息。
interface InspectedRepository {
  name: string
  localPath: string
  remoteUrl: string | null
  defaultBranch: string | null
  currentBranch: string | null
}

// 持久化数据不需要保存 available，展示时根据本地路径实时计算。
type StoredRepository = Omit<Repository, 'available'>

interface RepositoryStore {
  repositories: StoredRepository[]
}

const execFileAsync = promisify(execFile)

// 优先使用显式配置的 Git 路径，否则依赖系统 PATH。
const GIT_PATH = process.env.GIT_PATH?.trim() || 'git'
const GIT_TIMEOUT_MS = 15_000
const CLONE_TIMEOUT_MS = 300_000
const MAX_BUFFER_BYTES = 2 * 1024 * 1024
const MAX_SCAN_DEPTH = 4
const SCAN_CONCURRENCY = 6

// 扫描时跳过的目录，避免进入依赖、构建产物和版本控制内部。
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  '.cache',
  '.next',
  '.turbo',
  '.git'
])

// 根目录文件监听器和防抖定时器。
let repositoryWatcher: FSWatcher | null = null
let watcherTimer: NodeJS.Timeout | null = null
let watcherScanRunning = false

// 当前正在执行的克隆任务，用于支持取消。
let activeClone: { child: ChildProcess; cancelled: boolean } | null = null
let cloneInProgress = false
let watcherReloadAfterClone = false

/**
 * 校验磁盘中的仓库记录结构，过滤损坏或旧格式数据。
 */
const isStoredRepository = (value: unknown): value is StoredRepository => {
  if (!value || typeof value !== 'object') return false

  const item = value as Record<string, unknown>

  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.localPath === 'string' &&
    (item.remoteUrl === null || typeof item.remoteUrl === 'string') &&
    (item.defaultBranch === null || typeof item.defaultBranch === 'string') &&
    (item.currentBranch === null || typeof item.currentBranch === 'string') &&
    typeof item.qingzhouEnabled === 'boolean' &&
    typeof item.updatedAt === 'string'
  )
}

/**
 * 仓库数据文件路径。
 * 本地绝对路径属于当前机器，不放到项目仓库里。
 */
const getStorePath = (): string => join(app.getPath('userData'), 'repositories.json')

/**
 * 读取仓库数据。
 * 文件不存在或内容损坏时返回空数组。
 */
const readStore = async (): Promise<StoredRepository[]> => {
  try {
    const raw = await readFile(getStorePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<RepositoryStore>

    if (!Array.isArray(parsed.repositories)) return []

    return parsed.repositories.filter(isStoredRepository)
  } catch {
    return []
  }
}

/**
 * 原子写入仓库数据。
 * 先写同目录临时文件并落盘，再用 rename 替换目标文件，
 * 避免进程中断时留下不完整的 repositories.json。
 */
const writeStore = async (repositories: StoredRepository[]): Promise<void> => {
  const store: RepositoryStore = { repositories }
  const targetPath = getStorePath()
  const tempPath = `${targetPath}.${randomUUID()}.tmp`
  const content = JSON.stringify(store, null, 2)

  try {
    const handle = await open(tempPath, 'w')

    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }

    await rename(tempPath, targetPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * 判断路径是否存在。
 */
const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 判断路径是否为目录。
 */
const isDirectory = async (targetPath: string): Promise<boolean> => {
  try {
    return (await stat(targetPath)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 生成用于比较的路径键。
 * macOS 和 Windows 默认不区分大小写。
 */
const getPathKey = (targetPath: string): string => {
  const normalized = resolve(targetPath)

  return process.platform === 'darwin' || process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized
}

/**
 * 执行 Git 命令。
 * 不经过 shell，避免路径和参数被解释成命令。
 */
const runGit = async (
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<string> => {
  const { stdout } = await execFileAsync(GIT_PATH, args, {
    cwd: options.cwd,
    timeout: options.timeout ?? GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0'
    }
  })

  return stdout
}

/**
 * 读取仓库基础信息。
 * 返回 null 表示目标路径不是 Git 工作区。
 */
const inspectRepository = async (targetPath: string): Promise<InspectedRepository | null> => {
  try {
    const topLevel = (await runGit(['rev-parse', '--show-toplevel'], { cwd: targetPath })).trim()

    if (!topLevel) return null

    const localPath = await realpath(topLevel)
    let remoteUrl: string | null = null
    let defaultBranch: string | null = null
    let currentBranch: string | null = null

    try {
      remoteUrl = (await runGit(['remote', 'get-url', 'origin'], { cwd: localPath })).trim() || null
    } catch {
      remoteUrl = null
    }

    try {
      const symbolic = (
        await runGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
          cwd: localPath
        })
      ).trim()

      defaultBranch = symbolic.replace(/^origin\//, '') || null
    } catch {
      defaultBranch = null
    }

    try {
      currentBranch =
        (await runGit(['branch', '--show-current'], { cwd: localPath })).trim() || null
    } catch {
      currentBranch = null
    }

    return {
      name: basename(localPath),
      localPath,
      remoteUrl,
      defaultBranch,
      currentBranch
    }
  } catch {
    return null
  }
}

/**
 * 在单个根目录下查找 Git 仓库。
 * 找到仓库后不再向该仓库内部递归。
 */
const findRepositoriesUnderRoot = async (rootPath: string): Promise<string[]> => {
  const repositories: string[] = []
  const resolvedRoot = resolve(rootPath)

  const visit = async (directory: string, depth: number): Promise<void> => {
    let entries

    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    if (entries.some((entry) => entry.name === '.git')) {
      repositories.push(directory)
      return
    }

    if (depth >= MAX_SCAN_DEPTH) return

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue

      await visit(join(directory, entry.name), depth + 1)
    }
  }

  await visit(resolvedRoot, 0)
  return repositories
}

/**
 * 限制并发执行异步任务。
 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let cursor = 0

  const runWorker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  )

  return results
}

/**
 * 向所有窗口广播仓库数据变化。
 */
const broadcastRepositoryChanged = (state: RepositoryState): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('repositories:changed', state)
  }
}

/**
 * 停止监听配置的代码根目录。
 */
const stopRepositoryWatcher = (): void => {
  if (watcherTimer) {
    clearTimeout(watcherTimer)
    watcherTimer = null
  }

  if (repositoryWatcher) {
    repositoryWatcher.close()
    repositoryWatcher = null
  }
}

/**
 * 执行一次由文件变化触发的扫描。
 */
const runWatcherScan = async (): Promise<void> => {
  if (watcherScanRunning || cloneInProgress) return

  watcherScanRunning = true

  try {
    await refreshRootRepositories()
  } catch {
    // 后台监听失败时不打断用户操作，界面仍可手动扫描。
  } finally {
    watcherScanRunning = false

    if (watcherReloadAfterClone) {
      watcherReloadAfterClone = false
      scheduleWatcherScan()
    }
  }
}

/**
 * 防抖调度后台扫描。
 */
const scheduleWatcherScan = (): void => {
  if (cloneInProgress) {
    watcherReloadAfterClone = true
    return
  }

  if (watcherTimer) clearTimeout(watcherTimer)

  watcherTimer = setTimeout(() => {
    watcherTimer = null
    runWatcherScan()
  }, 1500)
}

/**
 * 监听根目录中的 Git 元数据变化。
 * 只关注 .git 相关路径，避免代码文件保存时频繁扫描。
 */
const startRepositoryWatcher = (root: string | null): void => {
  stopRepositoryWatcher()

  if (!root) return

  try {
    const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      if (!filename) return

      const normalized = filename.toString().replaceAll('\\', '/')
      const segments = normalized.split('/')

      if (!segments.includes('.git') && !normalized.endsWith('.git')) return

      scheduleWatcherScan()
    })

    watcher.on('error', () => {
      stopRepositoryWatcher()
    })
    repositoryWatcher = watcher
  } catch {
    // 当前平台不支持 recursive watch 时保持手动扫描。
  }
}

/**
 * 刷新单个仓库的 Git 信息。
 * 供任意页面或后台任务调用。
 */
export const refreshRepository = async (repositoryId: string): Promise<RepositoryState> => {
  const repositories = await readStore()
  const target = repositories.find((repository) => repository.id === repositoryId)

  if (!target) {
    throw new Error('仓库不存在')
  }

  if (await pathExists(target.localPath)) {
    const inspected = await inspectRepository(target.localPath)

    if (inspected) {
      const next = repositories.map((repository) =>
        repository.id === repositoryId
          ? {
              ...repository,
              name: inspected.name,
              remoteUrl: inspected.remoteUrl,
              defaultBranch: inspected.defaultBranch ?? repository.defaultBranch,
              currentBranch: inspected.currentBranch,
              updatedAt: new Date().toISOString()
            }
          : repository
      )

      await writeStore(next)
    }
  }

  const state = await getRepositoryState()
  broadcastRepositoryChanged(state)
  return state
}

/**
 * 将仓库数据转换为设置页状态。
 * available 根据当前本地路径实时计算。
 */
export const getRepositoryState = async (): Promise<RepositoryState> => {
  const root = getPreferences().repositoryRoot ?? null
  const repositories = await readStore()
  const withAvailability = await Promise.all(
    repositories.map(async (repository) => ({
      ...repository,
      available: await pathExists(repository.localPath)
    }))
  )

  withAvailability.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))

  return {
    root,
    repositories: withAvailability
  }
}

/**
 * 扫描代码根目录。
 * 以当前根目录为唯一数据范围，新仓库自动加入，已有仓库更新 Git 信息，
 * 不在根目录或已不存在的历史仓库会从配置中移除。
 */
export const refreshRootRepositories = async (): Promise<RepositoryScanResult> => {
  const root = getPreferences().repositoryRoot
  const errors: string[] = []

  if (!root) {
    return {
      ...(await getRepositoryState()),
      added: 0,
      updated: 0,
      removed: 0,
      unavailable: 0,
      errors: ['请先选择代码根目录']
    }
  }

  if (!(await isDirectory(root))) {
    const state = await getRepositoryState()

    return {
      ...state,
      added: 0,
      updated: 0,
      removed: 0,
      unavailable: state.repositories.filter((repository) => !repository.available).length,
      errors: [`根目录不存在或不可访问：${root}`]
    }
  }

  const discoveredPaths = new Set<string>()
  const repositories = await findRepositoriesUnderRoot(root)

  for (const repositoryPath of repositories) {
    discoveredPaths.add(repositoryPath)
  }

  const inspectedItems = await mapWithConcurrency(
    [...discoveredPaths],
    SCAN_CONCURRENCY,
    async (repositoryPath) => {
      const inspected = await inspectRepository(repositoryPath)

      if (!inspected) {
        errors.push(`无法读取 Git 信息：${repositoryPath}`)
      }

      return inspected
    }
  )
  const inspectedRepositories = inspectedItems.filter(
    (inspected): inspected is InspectedRepository => inspected !== null
  )

  const existing = await readStore()
  const existingByPath = new Map(existing.map((repository) => [getPathKey(repository.localPath), repository]))
  const now = new Date().toISOString()
  const nextById = new Map<string, StoredRepository>()
  let added = 0
  let updated = 0

  for (const inspected of inspectedRepositories) {
    const previous = existingByPath.get(getPathKey(inspected.localPath))
    const repository: StoredRepository = {
      id: previous?.id ?? randomUUID(),
      name: inspected.name,
      localPath: inspected.localPath,
      remoteUrl: inspected.remoteUrl,
      defaultBranch: inspected.defaultBranch ?? previous?.defaultBranch ?? null,
      currentBranch: inspected.currentBranch,
      qingzhouEnabled: previous?.qingzhouEnabled ?? false,
      updatedAt: now
    }

    if (previous) {
      updated += 1
    } else {
      added += 1
    }

    nextById.set(repository.id, repository)
  }

  const removed = existing.filter((repository) => !nextById.has(repository.id)).length
  const merged = [...nextById.values()]
  await writeStore(merged)

  const state = await getRepositoryState()
  const result: RepositoryScanResult = {
    ...state,
    added,
    updated,
    removed,
    unavailable: state.repositories.filter((repository) => !repository.available).length,
    errors
  }
  broadcastRepositoryChanged(state)

  return result
}

/**
 * 设置代码根目录。
 * 只允许存在一个根目录；更换根目录时清空原有仓库配置。
 */
export const setRepositoryRoot = async (rootPath: string): Promise<RepositoryState> => {
  const normalized = resolve(rootPath.trim())

  if (!(await isDirectory(normalized))) {
    throw new Error('选择的目录不存在')
  }

  const previousRoot = getPreferences().repositoryRoot
  const rootChanged = previousRoot ? getPathKey(previousRoot) !== getPathKey(normalized) : false

  updatePreferences({
    repositoryRoot: normalized
  })

  if (rootChanged) {
    await writeStore([])
  }

  startRepositoryWatcher(normalized)
  await refreshRootRepositories()

  return getRepositoryState()
}

/**
 * 清除代码根目录和所有仓库配置。
 * 只删除应用内元数据，不删除本地代码。
 */
export const clearRepositoryRoot = async (): Promise<RepositoryState> => {
  updatePreferences({
    repositoryRoot: undefined
  })
  await writeStore([])
  stopRepositoryWatcher()

  return getRepositoryState()
}

/**
 * 将指定路径的 Git 仓库写入仓库数据。
 * 克隆完成后复用这段逻辑。
 */
const saveRepositoryFromPath = async (targetPath: string): Promise<RepositoryState> => {
  const inspected = await inspectRepository(targetPath)

  if (!inspected) {
    throw new Error('选择的目录不是 Git 仓库')
  }

  const repositories = await readStore()
  const existing = repositories.find(
    (repository) => getPathKey(repository.localPath) === getPathKey(inspected.localPath)
  )
  const now = new Date().toISOString()
  const repository: StoredRepository = {
    id: existing?.id ?? randomUUID(),
    name: inspected.name,
    localPath: inspected.localPath,
    remoteUrl: inspected.remoteUrl,
    defaultBranch: inspected.defaultBranch ?? existing?.defaultBranch ?? null,
    currentBranch: inspected.currentBranch,
    qingzhouEnabled: existing?.qingzhouEnabled ?? false,
    updatedAt: now
  }

  const next = existing
    ? repositories.map((item) => (item.id === existing.id ? repository : item))
    : [...repositories, repository]

  await writeStore(next)
  return getRepositoryState()
}

/**
 * 广播 Git 克隆进度。
 */
const broadcastCloneProgress = (progress: RepositoryCloneProgress): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('repositories:clone-progress', progress)
  }
}

/**
 * 隐藏 URL 中可能包含的账号或 token。
 */
const sanitizeCloneOutput = (value: string): string =>
  value.replace(/(https?:\/\/)[^@\s/]+@/gi, '$1***@')

/**
 * 执行 Git 克隆并持续广播进程输出。
 * Git 在非 TTY 环境下默认不输出进度，因此显式加上 --progress。
 */
const runGitClone = async (url: string, targetPath: string): Promise<void> => {
  const child = spawn(GIT_PATH, ['clone', '--progress', '--', url, targetPath], {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let buffer = ''
  let stderr = ''
  let settled = false

  const pushOutput = (chunk: Buffer, isStderr = false): void => {
    const text = chunk.toString('utf8')

    if (isStderr) stderr += text

    buffer += text
    const lines = buffer.split(/[\r\n]+/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const message = sanitizeCloneOutput(line.trim())

      if (!message) continue

      const match = message.match(/(\d+)%/)
      broadcastCloneProgress({
        message,
        percent: match ? Number(match[1]) : null
      })
    }
  }

  const active = { child, cancelled: false }
  activeClone = active
  broadcastCloneProgress({ message: '开始克隆仓库...', percent: 0 })

  child.stdout?.on('data', (chunk: Buffer) => pushOutput(chunk))
  child.stderr?.on('data', (chunk: Buffer) => pushOutput(chunk, true))

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      if (activeClone === active) activeClone = null
      child.kill()
      broadcastCloneProgress({ message: 'Git 克隆超时', percent: null })
      reject(new Error('Git 克隆超时'))
    }, CLONE_TIMEOUT_MS)

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (activeClone === active) activeClone = null
      broadcastCloneProgress({ message: error.message, percent: null })
      reject(error)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (activeClone === active) activeClone = null

      if (active.cancelled) {
        broadcastCloneProgress({ message: '克隆已取消', percent: null })
        reject(new Error('Git 克隆已取消'))
        return
      }

      if (code === 0) {
        broadcastCloneProgress({ message: '克隆完成', percent: 100 })
        resolve()
        return
      }

      const message = sanitizeCloneOutput(stderr.trim().split(/\r?\n/).slice(-3).join(' ') || 'Git 克隆失败')
      broadcastCloneProgress({ message, percent: null })
      reject(new Error(message))
    })
  })
}

/**
 * 取消当前正在执行的 Git 克隆。
 */
export const cancelRepositoryClone = (): void => {
  if (!activeClone) return

  activeClone.cancelled = true
  activeClone.child.kill('SIGTERM')
  broadcastCloneProgress({ message: '正在取消克隆...', percent: null })
}

/**
 * 从 Git 克隆仓库到指定根目录。
 */
export const cloneRepository = async (input: CloneRepositoryInput): Promise<RepositoryState> => {
  const url = input.url.trim()
  const configuredRoot = getPreferences().repositoryRoot

  if (!configuredRoot) {
    throw new Error('请先选择代码根目录')
  }

  const rootPath = resolve(configuredRoot)

  if (!(await isDirectory(rootPath))) {
    throw new Error('代码根目录不存在')
  }

  // 支持 https/ssh/git 协议，以及 git@host:path 形式的 SCP 地址。
  if (
    !/^(https?|ssh|git):\/\/[^\s]+$/i.test(url) &&
    !/^[^@\s]+@[^:\s]+:[^\s]+$/.test(url)
  ) {
    throw new Error('请输入有效的 Git 仓库地址')
  }

  const defaultName = basename(url.replace(/\.git$/i, '').replace(/\/+$/, ''))
  const directoryName = (input.directoryName?.trim() || defaultName).trim()

  if (
    !directoryName ||
    directoryName === '.' ||
    directoryName === '..' ||
    basename(directoryName) !== directoryName
  ) {
    throw new Error('请输入有效的仓库目录名')
  }

  const targetPath = resolve(rootPath, directoryName)
  const relativePath = relative(rootPath, targetPath)

  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('仓库目录必须位于代码根目录内')
  }

  if (await pathExists(targetPath)) {
    throw new Error('目标目录已存在')
  }

  cloneInProgress = true

  try {
    await runGitClone(url, targetPath)
  } catch (error) {
    // 目标目录是我们刚刚创建的，失败或取消时清理残留文件。
    await rm(targetPath, { recursive: true, force: true }).catch(() => undefined)
    throw new Error(error instanceof Error ? error.message : 'Git 克隆失败')
  } finally {
    cloneInProgress = false
    watcherReloadAfterClone = false
  }

  broadcastCloneProgress({ message: '正在读取仓库信息...', percent: 100 })

  const state = await saveRepositoryFromPath(targetPath)
  broadcastRepositoryChanged(state)

  return state
}

/**
 * 更新仓库的可维护字段。
 */
export const updateRepository = async (
  repositoryId: string,
  patch: UpdateRepositoryInput
): Promise<RepositoryState> => {
  const repositories = await readStore()
  const target = repositories.find((repository) => repository.id === repositoryId)

  if (!target) {
    throw new Error('仓库不存在')
  }

  const next = repositories.map((repository) =>
    repository.id === repositoryId
      ? {
          ...repository,
          qingzhouEnabled:
            typeof patch.qingzhouEnabled === 'boolean'
              ? patch.qingzhouEnabled
              : repository.qingzhouEnabled,
          updatedAt: new Date().toISOString()
        }
      : repository
  )

  await writeStore(next)
  return getRepositoryState()
}

/**
 * 移除仓库元数据。
 * 只删除应用内记录，不删除本地代码。
 */
export const removeRepository = async (repositoryId: string): Promise<RepositoryState> => {
  const repositories = await readStore()
  await writeStore(repositories.filter((repository) => repository.id !== repositoryId))

  return getRepositoryState()
}

/**
 * 打开系统目录选择器。
 */
export const selectDirectory = async (
  title = '选择目录',
  defaultPath?: string
): Promise<string | null> => {
  const options: OpenDialogOptions = {
    title,
    properties: ['openDirectory', 'createDirectory'],
    defaultPath
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
 * 注册代码仓库相关 IPC。
 */
export const initializeRepositories = (): void => {
  // 读取根目录、仓库列表和实时可用状态。
  ipcMain.handle('repositories:get-state', () => getRepositoryState())

  // 刷新单个仓库的 Git 信息。
  ipcMain.handle('repositories:refresh-repository', (_event, repositoryId: unknown) => {
    if (typeof repositoryId !== 'string') throw new Error('Invalid repository id')
    return refreshRepository(repositoryId)
  })

  // 重新扫描代码根目录，新增、更新或移除仓库。
  ipcMain.handle('repositories:refresh-root', () => refreshRootRepositories())

  // 保存或替换唯一代码根目录。
  ipcMain.handle('repositories:set-root', (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string') throw new Error('Invalid repository root')
    return setRepositoryRoot(rootPath)
  })

  // 清除代码根目录，不删除仓库数据。
  ipcMain.handle('repositories:clear-root', () => clearRepositoryRoot())

  // 打开系统目录选择器。
  ipcMain.handle('repositories:select-directory', (_event, title: unknown, defaultPath: unknown) => {
    const safeTitle = typeof title === 'string' ? title : '选择目录'
    const safeDefaultPath = typeof defaultPath === 'string' ? defaultPath : undefined
    return selectDirectory(safeTitle, safeDefaultPath)
  })

  // 取消当前正在执行的 Git 克隆。
  ipcMain.handle('repositories:cancel-clone', () => cancelRepositoryClone())

  // 将 Git 地址克隆到唯一根目录，并写入仓库数据。
  ipcMain.handle('repositories:clone', (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid clone input')

    const value = input as Partial<CloneRepositoryInput>

    if (typeof value.url !== 'string') {
      throw new Error('Invalid clone input')
    }

    return cloneRepository({
      url: value.url,
      directoryName: typeof value.directoryName === 'string' ? value.directoryName : undefined
    })
  })

  // 更新仓库轻舟接入状态。
  ipcMain.handle('repositories:update', (_event, repositoryId: unknown, patch: unknown) => {
    if (typeof repositoryId !== 'string' || !patch || typeof patch !== 'object') {
      throw new Error('Invalid repository update')
    }

    const value = patch as UpdateRepositoryInput

    return updateRepository(repositoryId, {
      qingzhouEnabled:
        typeof value.qingzhouEnabled === 'boolean' ? value.qingzhouEnabled : undefined
    })
  })

  // 移除仓库元数据，不删除本地代码。
  ipcMain.handle('repositories:remove', (_event, repositoryId: unknown) => {
    if (typeof repositoryId !== 'string') throw new Error('Invalid repository id')
    return removeRepository(repositoryId)
  })

  // 应用启动时恢复根目录监听，外部增删仓库或切换分支后自动同步。
  startRepositoryWatcher(getPreferences().repositoryRoot ?? null)
}
