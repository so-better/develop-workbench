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
import { getCliEnvironment } from './cli-env'
import { getPreferences, updatePreferences } from './preferences'
import { resolveGitPath } from './git'
import { backupCorruptStore } from './store-backup'
import type {
  CloneRepositoryInput,
  Repository,
  RepositoryBindingStatus,
  RepositoryBranchList,
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

const GIT_TIMEOUT_MS = 15_000
const GIT_NETWORK_TIMEOUT_MS = 60_000
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
  let raw: string

  try {
    raw = await readFile(getStorePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []

    throw error
  }

  let parsed: Partial<RepositoryStore> | null

  try {
    parsed = JSON.parse(raw) as Partial<RepositoryStore> | null
  } catch {
    await backupCorruptStore(getStorePath())
    return []
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.repositories)) {
    await backupCorruptStore(getStorePath())
    return []
  }

  return parsed.repositories.filter(isStoredRepository)
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
  const gitPath = await resolveGitPath()
  const { stdout } = await execFileAsync(gitPath, args, {
    cwd: options.cwd,
    timeout: options.timeout ?? GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
    encoding: 'utf8',
    env: {
      ...getCliEnvironment(gitPath),
      GIT_TERMINAL_PROMPT: '0',
      // 只读命令不要刷新 .git/index，避免触发仓库监听后反复刷新状态。
      GIT_OPTIONAL_LOCKS: '0'
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
 * 只关注会影响仓库信息或分支引用的 .git 路径，避免索引刷新触发频繁扫描。
 */
const startRepositoryWatcher = (root: string | null): void => {
  stopRepositoryWatcher()

  if (!root) return

  try {
    const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      if (!filename) return

      const normalized = filename.toString().replaceAll('\\', '/')
      const segments = normalized.split('/')
      const name = segments[segments.length - 1]

      if (!segments.includes('.git') && !normalized.endsWith('.git')) return
      if (name === 'index' || name === 'index.lock') return

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

const getGitErrorMessage = (error: unknown): string => {
  const message =
    error instanceof Error ? error.message.split(/\r?\n/)[0].trim() : 'Git 操作失败'

  return message.replace(/(https?:\/\/)[^@\s/]+@/gi, '$1***@').slice(0, 200)
}

/**
 * 判断当前分支是否配置了上游分支。
 */
const hasUpstreamBranch = async (cwd: string): Promise<boolean> => {
  try {
    const upstream = (
      await runGit(
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        { cwd }
      )
    ).trim()

    return Boolean(upstream)
  } catch {
    return false
  }
}

/**
 * 读取仓库的本地与远程分支。
 * 远程分支统一去掉 origin/ 前缀并去重。
 */
export const listRepositoryBranches = async (
  repositoryId: string,
  fetchRemote = false
): Promise<RepositoryBranchList> => {
  const repositories = await readStore()
  const repository = repositories.find((item) => item.id === repositoryId)

  if (!repository) throw new Error('仓库不存在')

  let fetchWarning: string | null = null

  if (fetchRemote) {
    const hasOrigin = await runGit(
      ['remote', 'get-url', 'origin'],
      { cwd: repository.localPath }
    )
      .then((output) => Boolean(output.trim()))
      .catch(() => false)

    if (hasOrigin) {
      try {
        await runGit(['fetch', '--prune', 'origin'], {
          cwd: repository.localPath,
          timeout: GIT_NETWORK_TIMEOUT_MS
        })
      } catch (error) {
        fetchWarning = `远程分支刷新失败，已使用本地引用：${getGitErrorMessage(error)}`
      }
    }
  }

  const output = await runGit(
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'],
    { cwd: repository.localPath }
  )
  const branches = new Set<string>()

  for (const line of output.split(/\r?\n/)) {
    const name = line.trim()

    if (!name) continue
    if (name === 'origin/HEAD') continue
    if (name.startsWith('origin/')) {
      branches.add(name.slice('origin/'.length))
    } else {
      branches.add(name)
    }
  }

  return {
    branches: Array.from(branches).sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    ),
    fetchWarning
  }
}

/**
 * 读取仓库本地路径，并校验当前可访问。
 */
export const getRepositoryLocalPath = async (repositoryId: string): Promise<string> => {
  const repositories = await readStore()
  const repository = repositories.find((item) => item.id === repositoryId)

  if (!repository) throw new Error('仓库不存在')
  if (!(await pathExists(repository.localPath))) throw new Error('仓库路径不存在')

  return repository.localPath
}

/**
 * 为在 IDE 中打开仓库准备分支。
 * 已在目标分支时直接打开；需要切换时要求工作区干净，并尝试快进拉取。
 */
export const prepareRepositoryForIde = async (
  repositoryId: string,
  branchName: string
): Promise<{
  localPath: string
  switched: boolean
  pulled: boolean
  hasUpstream: boolean
}> => {
  const repositories = await readStore()
  const repository = repositories.find((item) => item.id === repositoryId)

  if (!repository) throw new Error('仓库不存在')
  if (!(await pathExists(repository.localPath))) throw new Error('仓库路径不存在')

  // 打开 IDE 前先刷新远程引用，避免新分支未 fetch 到本地而误判为不存在。
  const { branches } = await listRepositoryBranches(repositoryId, true)

  if (!branches.includes(branchName)) throw new Error(`分支不存在：${branchName}`)

  const cwd = repository.localPath
  const currentBranch = (
    await runGit(['branch', '--show-current'], { cwd })
  ).trim()

  if (currentBranch === branchName) {
    const hasUpstream = await hasUpstreamBranch(cwd)

    if (hasUpstream) {
      try {
        await runGit(['pull', '--ff-only'], {
          cwd,
          timeout: GIT_NETWORK_TIMEOUT_MS
        })
      } catch (error) {
        throw new Error(
          `当前分支拉取失败：${getGitErrorMessage(error)}`
        )
      }
    }

    return {
      localPath: cwd,
      switched: false,
      pulled: hasUpstream,
      hasUpstream
    }
  }

  const status = (await runGit(['status', '--porcelain'], { cwd })).trim()

  if (status) {
    throw new Error('当前仓库有未提交改动，请先提交后再切换分支')
  }

  const previousHead = (await runGit(['rev-parse', 'HEAD'], { cwd })).trim()
  const previousLabel = currentBranch || previousHead

  await runGit(['switch', branchName], { cwd })

  const hasUpstream = await hasUpstreamBranch(cwd)

  if (hasUpstream) {
    try {
      await runGit(['pull', '--ff-only'], {
        cwd,
        timeout: GIT_NETWORK_TIMEOUT_MS
      })
    } catch (error) {
      const detail = getGitErrorMessage(error)

      try {
        if (currentBranch) {
          await runGit(['switch', currentBranch], { cwd })
        } else if (previousHead) {
          await runGit(['switch', '--detach', previousHead], { cwd })
        } else {
          throw new Error('没有可恢复的分支')
        }
      } catch (rollbackError) {
        const rollbackDetail = getGitErrorMessage(rollbackError)

        throw new Error(
          `拉取失败，且无法恢复到原分支 ${previousLabel || '未知'}：${rollbackDetail}`
        )
      }

      throw new Error(
        `拉取失败，已恢复到原分支 ${previousLabel || '未知'}。${detail}`
      )
    }
  }

  return {
    localPath: cwd,
    switched: true,
    pulled: hasUpstream,
    hasUpstream
  }
}

/**
 * 读取需求仓库绑定的实时状态。
 */
export const getRepositoryBindingStatus = async (
  repositoryId: string,
  branchName: string,
  iterationBranch?: string | null
): Promise<RepositoryBindingStatus> => {
  const repositories = await readStore()
  const repository = repositories.find((item) => item.id === repositoryId)

  if (!repository) {
    return {
      available: false,
      branchExists: false,
      iterationBranchExists: false
    }
  }

  if (!(await pathExists(repository.localPath))) {
    return {
      available: false,
      branchExists: false,
      iterationBranchExists: false
    }
  }

  const { branches } = await listRepositoryBranches(repositoryId)

  return {
    available: true,
    branchExists: Boolean(branchName) && branches.includes(branchName),
    iterationBranchExists: Boolean(iterationBranch) && branches.includes(iterationBranch as string)
  }
}

/**
 * 从基线分支创建开发分支，并在存在 origin 时推送到远程。
 * 只创建分支，不切换当前工作区。
 */
export const createRepositoryBranch = async (
  repositoryId: string,
  branchName: string,
  baseBranch: string
): Promise<void> => {
  const normalizedBranch = branchName.trim()
  const normalizedBase = baseBranch.trim()

  if (!normalizedBranch) throw new Error('分支名不能为空')
  if (!normalizedBase) throw new Error('请选择基线分支')

  const repositories = await readStore()
  const repository = repositories.find((item) => item.id === repositoryId)

  if (!repository) throw new Error('仓库不存在')

  const { branches } = await listRepositoryBranches(repositoryId)

  if (branches.includes(normalizedBranch)) throw new Error('分支已存在')
  if (!branches.includes(normalizedBase)) throw new Error('基线分支不存在')

  try {
    await runGit(['check-ref-format', '--branch', normalizedBranch], {
      cwd: repository.localPath
    })
  } catch {
    throw new Error('分支名不合法')
  }

  const hasLocalBase = await runGit(
    ['rev-parse', '--verify', `refs/heads/${normalizedBase}`],
    { cwd: repository.localPath }
  )
    .then(() => true)
    .catch(() => false)

  if (hasLocalBase) {
    await runGit(['branch', normalizedBranch, normalizedBase], {
      cwd: repository.localPath
    })
  } else {
    const hasRemoteBase = await runGit(
      ['rev-parse', '--verify', `refs/remotes/origin/${normalizedBase}`],
      { cwd: repository.localPath }
    )
      .then(() => true)
      .catch(() => false)

    if (!hasRemoteBase) throw new Error('基线分支没有可用的本地或远程引用')

    await runGit(
      ['branch', '--track', normalizedBranch, `origin/${normalizedBase}`],
      { cwd: repository.localPath }
    )
  }

  if (!repository.remoteUrl) return

  try {
    await runGit(
      ['push', '--set-upstream', 'origin', normalizedBranch],
      { cwd: repository.localPath }
    )
  } catch (error) {
    // 推送失败时回滚本地分支，避免用户重试时被“分支已存在”阻塞。
    await runGit(['branch', '-D', normalizedBranch], {
      cwd: repository.localPath
    }).catch(() => undefined)

    const detail =
      (error as { stderr?: string }).stderr?.trim() ||
      (error instanceof Error ? error.message : '未知错误')

    throw new Error(`分支推送远程失败：${detail}`)
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

  const state = await getRepositoryState()
  broadcastRepositoryChanged(state)
  return state
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
  const gitPath = await resolveGitPath()
  const child = spawn(gitPath, ['clone', '--progress', '--', url, targetPath], {
    env: {
      ...getCliEnvironment(gitPath),
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

  const state = await getRepositoryState()
  broadcastRepositoryChanged(state)
  return state
}

/**
 * 移除仓库元数据。
 * 只删除应用内记录，不删除本地代码。
 */
export const removeRepository = async (repositoryId: string): Promise<RepositoryState> => {
  const repositories = await readStore()
  await writeStore(repositories.filter((repository) => repository.id !== repositoryId))

  const state = await getRepositoryState()
  broadcastRepositoryChanged(state)
  return state
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
    properties: ['openDirectory', 'createDirectory', 'showHiddenFiles'],
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

  // 读取指定仓库的本地和远程分支。
  ipcMain.handle(
    'repositories:list-branches',
    (_event, repositoryId: unknown, fetchRemote: unknown) => {
      if (typeof repositoryId !== 'string') throw new Error('Invalid repository id')
      return listRepositoryBranches(repositoryId, fetchRemote === true)
    }
  )

  // 读取需求仓库绑定的实时状态。
  ipcMain.handle(
    'repositories:get-binding-status',
    (
      _event,
      repositoryId: unknown,
      branchName: unknown,
      iterationBranch: unknown
    ) => {
      if (typeof repositoryId !== 'string' || typeof branchName !== 'string') {
        throw new Error('Invalid binding status input')
      }

      return getRepositoryBindingStatus(
        repositoryId,
        branchName,
        typeof iterationBranch === 'string' && iterationBranch ? iterationBranch : null
      )
    }
  )

  // 从基线分支创建需求开发分支，不切换当前工作区。
  ipcMain.handle(
    'repositories:create-branch',
    (_event, repositoryId: unknown, branchName: unknown, baseBranch: unknown) => {
      if (
        typeof repositoryId !== 'string' ||
        typeof branchName !== 'string' ||
        typeof baseBranch !== 'string'
      ) {
        throw new Error('Invalid branch input')
      }

      return createRepositoryBranch(repositoryId, branchName, baseBranch)
    }
  )

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
