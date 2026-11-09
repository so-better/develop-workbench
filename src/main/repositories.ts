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
  RepositoryBranchSwitchResult,
  RepositoryCloneProgress,
  RepositoryMergeResult,
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

// 原子替换文件只能避免写坏文件；整个读—改—写过程还必须串行，才能避免旧快照覆盖新配置。
let repositoryMutationQueue: Promise<void> = Promise.resolve()
let repositoryRootRevision = 0
let repositoryRemovalRevision = 0
const removedRepositoryPaths = new Map<string, number>()

const mutateRepositories = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = repositoryMutationQueue.then(operation, operation)
  repositoryMutationQueue = result.then(() => undefined, () => undefined)
  return result
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
 * 返回 null 表示不是 Git 工作区或读取失败，不能据此判断仓库已删除。
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
const findRepositoriesUnderRoot = async (
  rootPath: string,
  errors: string[]
): Promise<string[]> => {
  const repositories: string[] = []
  const resolvedRoot = resolve(rootPath)

  const visit = async (directory: string, depth: number): Promise<void> => {
    let entries

    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      errors.push(
        `无法扫描目录：${directory}（${error instanceof Error ? error.message : '读取失败'}）`
      )
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
  const rootRevision = repositoryRootRevision
  const repositories = await readStore()
  const target = repositories.find((repository) => repository.id === repositoryId)

  if (!target) {
    throw new Error('仓库不存在')
  }

  if (await pathExists(target.localPath)) {
    const inspected = await inspectRepository(target.localPath)

    if (inspected) {
      await mutateRepositories(async () => {
      if (rootRevision !== repositoryRootRevision) return
      const latest = await readStore()
      const next = latest.map((repository) =>
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
      })
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

/** 周报使用的代码提交摘要。 */
export interface RepositoryCommitSummary {
  repositoryId: string
  repositoryName: string
  hash: string
  shortHash: string
  subject: string
  author: string
  authorEmail: string
  date: string
}

/** 本周代码提交读取结果。 */
export interface WeeklyRepositoryCommitsResult {
  /** 匹配到当前 Git 用户的提交。 */
  commits: RepositoryCommitSummary[]

  /** 读取失败或跳过仓库的原因。 */
  warnings: string[]
}

/**
 * 读取本周各仓库中当前 Git 用户自己的提交。
 * 仓库未配置 user.name / user.email 时跳过该仓库，避免混入其他作者提交。
 */
export const getWeeklyRepositoryCommits = async (
  since: string,
  until: string
): Promise<WeeklyRepositoryCommitsResult> => {
  const state = await getRepositoryState()
  const commits: RepositoryCommitSummary[] = []
  const warnings: string[] = []

  for (const repository of state.repositories) {
    if (!repository.available) continue

    const cwd = repository.localPath
    const [configuredName, configuredEmail] = await Promise.all([
      runGit(['config', '--get', 'user.name'], { cwd })
        .then((value) => value.trim())
        .catch(() => ''),
      runGit(['config', '--get', 'user.email'], { cwd })
        .then((value) => value.trim().toLowerCase())
        .catch(() => '')
    ])

    if (!configuredName && !configuredEmail) {
      warnings.push(
        `仓库 ${repository.name} 未配置 Git user.name/user.email，已跳过本周提交`
      )
      continue
    }

    let output: string

    try {
      output = await runGit(
        [
          'log',
          '--all',
          '--no-merges',
          `--since=${since}`,
          `--until=${until}`,
          '--max-count=200',
          '--format=%H%x00%h%x00%an%x00%ae%x00%cI%x00%s'
        ],
        { cwd, timeout: GIT_NETWORK_TIMEOUT_MS }
      )
    } catch (error) {
      warnings.push(
        `仓库 ${repository.name} 读取提交失败：${getGitErrorMessage(error)}`
      )
      continue
    }

    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue

      const [hash, shortHash, author, authorEmail, date, subject] =
        line.split('\0')

      if (!hash || !shortHash || !date) continue

      const nameMatches = Boolean(configuredName) && author === configuredName
      const emailMatches =
        Boolean(configuredEmail) &&
        (authorEmail ?? '').toLowerCase() === configuredEmail

      if (!nameMatches && !emailMatches) continue

      commits.push({
        repositoryId: repository.id,
        repositoryName: repository.name,
        hash,
        shortHash,
        subject: subject || '无提交说明',
        author: author || '未知作者',
        authorEmail: authorEmail || '',
        date
      })
    }
  }

  return {
    commits: commits.sort((left, right) => right.date.localeCompare(left.date)),
    warnings
  }
}

/** 需求分析仓库请求。 */
export interface RepositoryContextRequest {
  /** 仓库绝对路径。 */
  path: string

  /** 要分析的分支；不传时使用当前分支。 */
  branch?: string | null
}

/** 需求分析使用的仓库上下文。 */
export interface RepositoryContextFile {
  /** 文件绝对路径。 */
  path: string

  /** 相对仓库根目录的路径。 */
  relativePath: string
}

/** 代码内容命中的文件位置和所在行。 */
export interface RepositoryContextContentMatch extends RepositoryContextFile {
  /** 命中行号，从 1 开始。 */
  line: number

  /** 命中行文本，已压缩并限制长度。 */
  text: string
}

/** 仓库近期提交摘要。 */
export interface RepositoryContextCommit {
  /** 提交短哈希。 */
  shortHash: string

  /** 提交标题。 */
  subject: string

  /** 提交作者。 */
  author: string

  /** 提交时间，ISO 字符串。 */
  date: string
}

/** 单个仓库的需求分析上下文。 */
export interface RepositoryContext {
  /** 仓库 ID。 */
  repositoryId: string

  /** 仓库名称。 */
  repositoryName: string

  /** 仓库绝对路径。 */
  repositoryPath: string

  /** 实际读取的分支。 */
  branch: string | null

  /** 指定分支不可用时的回退提示；正常时为 null。 */
  branchWarning: string | null

  /** 仓库顶层目录和文件。 */
  topLevel: string[]

  /** package.json 内容；不存在时为 null。 */
  manifest: { path: string; content: string } | null

  /** 文件名命中关键词的文件列表。 */
  files: RepositoryContextFile[]

  /** 文件内容命中关键词的位置。 */
  contentMatches: RepositoryContextContentMatch[]

  /** 最近提交。 */
  recentCommits: RepositoryContextCommit[]
}

/** 批量读取的文件内容。 */
export interface RepositoryFileContent {
  /** 文件绝对路径。 */
  path: string

  /** 相对仓库根目录的路径。 */
  relativePath: string

  /** 内容所属分支；读取工作区时为 null。 */
  branch: string | null

  /** 本次读取到的 UTF-8 文本。 */
  content: string

  /** 本次读取起始字节。 */
  offset: number

  /** 下一次续读的起始字节。 */
  nextOffset: number

  /** 文件总字节数。 */
  size: number

  /** 是否还有未读取内容。 */
  truncated: boolean
}

/** 批量读取文件的请求。 */
export interface RepositoryFileReadRequest {
  /** 文件绝对路径。 */
  path: string

  /** 从第几个字节开始读取；默认 0。 */
  offset?: number

  /** 要读取的分支；不传时读取当前工作区。 */
  branch?: string | null
}

/** 未读取的文件及原因。 */
export interface RepositoryFileReadSkip {
  /** 请求的文件路径。 */
  path: string

  /** 未读取原因。 */
  reason: string
}

/** 批量读取结果。 */
export interface RepositoryFileReadResult {
  /** 成功读取的文件。 */
  files: RepositoryFileContent[]

  /** 被跳过的文件。 */
  skipped: RepositoryFileReadSkip[]
}

// 限制仓库上下文的输出规模，避免一次工具结果过大。
const CONTEXT_MAX_KEYWORDS = 8
const CONTEXT_MAX_FILES = 40
const CONTEXT_MAX_MATCHES = 60
const CONTEXT_MAX_COMMITS = 8
const CONTEXT_MANIFEST_BYTES = 5_000
const CONTEXT_FILE_BYTES = 64_000
const CONTEXT_MAX_READ_FILES = 8

/** 去重、裁剪并限制需求分析关键词数量。 */
const normalizeContextKeywords = (values: string[]): string[] => {
  const seen = new Set<string>()

  for (const value of values) {
    const keyword = value.trim().slice(0, 80)

    if (keyword) seen.add(keyword)
    if (seen.size >= CONTEXT_MAX_KEYWORDS) break
  }

  return Array.from(seen)
}

/** 避免按字节截断时把 UTF-8 多字节字符切成半个。 */
const trimIncompleteUtf8Tail = (buffer: Buffer, length: number): number => {
  if (length <= 0) return 0

  let index = length - 1

  while (
    index >= 0 &&
    length - index <= 4 &&
    (buffer[index] & 0xc0) === 0x80
  ) {
    index -= 1
  }

  if (index < 0) return length

  const first = buffer[index]
  const expected =
    (first & 0x80) === 0
      ? 1
      : (first & 0xe0) === 0xc0
        ? 2
        : (first & 0xf0) === 0xe0
          ? 3
          : (first & 0xf8) === 0xf0
            ? 4
            : 1

  return index + expected > length ? index : length
}

/** 从指定字节偏移读取文件片段，并返回下一次续读位置。 */
const readFilePrefix = async (
  filePath: string,
  maxBytes: number,
  offset = 0
): Promise<{
  content: string
  offset: number
  nextOffset: number
  size: number
  truncated: boolean
}> => {
  const info = await stat(filePath)
  const start = Math.max(0, Math.min(offset, info.size))
  const length = Math.max(0, Math.min(maxBytes, info.size - start))
  const handle = await open(filePath, 'r')
  const buffer = Buffer.alloc(length)

  try {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    const completeBytes =
      start + bytesRead < info.size
        ? trimIncompleteUtf8Tail(buffer, bytesRead)
        : bytesRead

    return {
      content: buffer.subarray(0, completeBytes).toString('utf8'),
      offset: start,
      nextOffset: start + completeBytes,
      size: info.size,
      truncated: start + completeBytes < info.size
    }
  } finally {
    await handle.close()
  }
}

/** 从 Git 分支引用读取文件片段。 */
const readGitFilePrefix = async (
  cwd: string,
  ref: string,
  relativePath: string,
  maxBytes: number,
  offset = 0
): Promise<{
  content: string
  offset: number
  nextOffset: number
  size: number
  truncated: boolean
} | null> => {
  const output = await runGit(['show', `${ref}:${relativePath}`], { cwd })
  const buffer = Buffer.from(output, 'utf8')
  const start = Math.max(0, Math.min(offset, buffer.length))
  const length = Math.max(0, Math.min(maxBytes, buffer.length - start))
  const slice = buffer.subarray(start, start + length)
  const completeBytes =
    start + length < buffer.length
      ? trimIncompleteUtf8Tail(slice, slice.length)
      : slice.length

  return {
    content: slice.subarray(0, completeBytes).toString('utf8'),
    offset: start,
    nextOffset: start + completeBytes,
    size: buffer.length,
    truncated: start + completeBytes < buffer.length
  }
}

/** 读取 Git blob 字节数，用于给出更准确的跳过原因。 */
const readGitBlobSize = async (
  cwd: string,
  ref: string,
  relativePath: string
): Promise<number | null> => {
  try {
    const output = await runGit(['cat-file', '-s', `${ref}:${relativePath}`], {
      cwd
    })
    const size = Number.parseInt(output.trim(), 10)

    return Number.isFinite(size) ? size : null
  } catch {
    return null
  }
}

/** 按路径字符串查找所属仓库，不要求文件当前存在。 */
const findRepositoryByPath = (
  repositories: RepositoryState['repositories'],
  filePath: string
): { repository: Repository; root: string; resolvedPath: string; relativePath: string } | null => {
  const resolvedPath = resolve(filePath)

  for (const repository of repositories) {
    if (!repository.available) continue

    const root = resolve(repository.localPath)
    const relativePath = relative(root, resolvedPath)

    if (
      relativePath &&
      !relativePath.startsWith('..') &&
      !isAbsolute(relativePath)
    ) {
      return { repository, root, resolvedPath, relativePath }
    }
  }

  return null
}

/** 已解析真实路径的文件位置。 */
interface RepositoryFileLocation {
  repository: Repository
  resolvedPath: string
  root: string
}

/**
 * 查找文件所属的已配置仓库。
 * 使用 realpath 校验，避免仓库内符号链接指向仓库外文件。
 */
const findRepositoryFile = async (
  repositories: RepositoryState['repositories'],
  filePath: string
): Promise<RepositoryFileLocation | null> => {
  let resolvedPath: string

  try {
    resolvedPath = await realpath(filePath)
  } catch {
    return null
  }

  for (const repository of repositories) {
    if (!repository.available) continue

    let root: string

    try {
      root = await realpath(repository.localPath)
    } catch {
      root = resolve(repository.localPath)
    }

    const relativePath = relative(root, resolvedPath)

    if (
      relativePath &&
      !relativePath.startsWith('..') &&
      !isAbsolute(relativePath)
    ) {
      return { repository, resolvedPath, root }
    }
  }

  return null
}

/** 解析 git log 的 NUL 分隔输出。 */
const parseContextLog = (output: string): RepositoryContextCommit[] =>
  output
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const [shortHash, subject, author, date] = line.split('\0')

      return shortHash && date
        ? [
            {
              shortHash,
              subject: subject || '无提交说明',
              author: author || '未知作者',
              date
            }
          ]
        : []
    })

/** 解析本地或 origin 分支引用。 */
const resolveBranchRef = async (
  cwd: string,
  branch: string
): Promise<string | null> => {
  const normalized = branch.trim()

  if (!normalized) return null

  for (const ref of [
    `refs/heads/${normalized}`,
    `refs/remotes/origin/${normalized}`
  ]) {
    try {
      await runGit(['rev-parse', '--verify', '--quiet', ref], { cwd })
      return ref
    } catch {
      // 继续尝试下一个引用。
    }
  }

  return null
}

/** 获取实际分析的分支引用；未指定时使用当前 HEAD。 */
const resolveAnalysisRef = async (
  cwd: string,
  requestedBranch?: string | null
): Promise<{
  branch: string | null
  ref: string
  branchWarning: string | null
}> => {
  const currentBranch = await runGit(['branch', '--show-current'], { cwd })
    .then((value) => value.trim() || null)
    .catch(() => null)

  if (requestedBranch?.trim()) {
    const ref = await resolveBranchRef(cwd, requestedBranch)

    if (ref) {
      return { branch: requestedBranch.trim(), ref, branchWarning: null }
    }

    return {
      branch: currentBranch,
      ref: currentBranch ? `refs/heads/${currentBranch}` : 'HEAD',
      branchWarning: `分支不存在：${requestedBranch}，已回退当前分支 ${
        currentBranch ?? 'HEAD'
      }`
    }
  }

  return {
    branch: currentBranch,
    ref: currentBranch ? `refs/heads/${currentBranch}` : 'HEAD',
    branchWarning: null
  }
}

/** 按 UTF-8 字符边界截取字符串前缀。 */
const truncateUtf8 = (value: string, maxBytes: number): string => {
  const buffer = Buffer.from(value, 'utf8')

  if (buffer.length <= maxBytes) return value

  const length = trimIncompleteUtf8Tail(buffer, maxBytes)

  return buffer.subarray(0, length).toString('utf8')
}

/**
 * 一次读取仓库结构、关键词命中文件、代码匹配和近期提交。
 * 支持按请求指定分支，用于分析需求绑定的开发分支。
 * 用于减少需求分析时逐文件调用 executeShell。
 */
export const getRepositoryContext = async (
  requests: RepositoryContextRequest[],
  keywordValues: string[]
): Promise<RepositoryContext[]> => {
  const state = await getRepositoryState()
  const availableRepositories = state.repositories.filter(
    (repository) => repository.available
  )
  const repositoryByPath = new Map(
    availableRepositories.map((repository) => [
      resolve(repository.localPath),
      repository
    ])
  )
  const keywords = normalizeContextKeywords(keywordValues)
  const results: RepositoryContext[] = []

  for (const request of requests) {
    const repository = repositoryByPath.get(resolve(request.path))

    if (!repository) continue

    const cwd = repository.localPath
    const { branch, ref, branchWarning } = await resolveAnalysisRef(
      cwd,
      request.branch
    )
    const [logOutput, fileOutput, grepOutput, manifestOutput] =
      await Promise.all([
        runGit(
          [
            'log',
            ref,
            '--no-merges',
            `--max-count=${CONTEXT_MAX_COMMITS}`,
            '--format=%h%x00%s%x00%an%x00%cI'
          ],
          { cwd }
        ).catch(() => ''),
        runGit(['ls-tree', '-r', '--name-only', ref], { cwd }).catch(() => ''),
        keywords.length
          ? runGit(
              [
                'grep',
                '-n',
                '-I',
                '--no-color',
                '-m',
                '2',
                '-F',
                ...keywords.flatMap((keyword) => ['-e', keyword]),
                ref
              ],
              { cwd }
            ).catch(() => '')
          : Promise.resolve(''),
        runGit(['show', `${ref}:package.json`], { cwd }).catch(() => '')
      ])
    const trackedFiles = fileOutput.split(/\r?\n/).filter(Boolean)
    const topLevel = new Map<string, boolean>()

    for (const file of trackedFiles) {
      const segments = file.split('/')
      const name = segments[0]

      if (!name || SKIP_DIRECTORIES.has(name)) continue

      topLevel.set(name, topLevel.get(name) === true || segments.length > 1)
    }

    const files = trackedFiles
      .filter((file) => {
        if (!keywords.length) return false

        const normalized = file.toLocaleLowerCase()

        return keywords.some((keyword) =>
          normalized.includes(keyword.toLocaleLowerCase())
        )
      })
      .slice(0, CONTEXT_MAX_FILES)
      .map((relativePath) => ({
        path: join(cwd, relativePath),
        relativePath
      }))
    const contentMatches: RepositoryContextContentMatch[] = []
    const refPrefix = `${ref}:`

    for (const line of grepOutput.split(/\r?\n/).filter(Boolean)) {
      if (contentMatches.length >= CONTEXT_MAX_MATCHES) break

      const normalizedLine = line.startsWith(refPrefix)
        ? line.slice(refPrefix.length)
        : line
      const match = /^(.+?):(\d+):(.*)$/.exec(normalizedLine)

      if (!match) continue

      const relativePath = match[1]
      const lineNumber = Number.parseInt(match[2], 10)

      if (!Number.isFinite(lineNumber)) continue

      contentMatches.push({
        path: join(cwd, relativePath),
        relativePath,
        line: lineNumber,
        text: match[3].trim().slice(0, 240)
      })
    }

    const manifest = manifestOutput
      ? {
          path: join(cwd, 'package.json'),
          content: truncateUtf8(manifestOutput, CONTEXT_MANIFEST_BYTES)
        }
      : null

    results.push({
      repositoryId: repository.id,
      repositoryName: repository.name,
      repositoryPath: cwd,
      branch,
      branchWarning,
      topLevel: Array.from(topLevel.entries())
        .map(([name, isDirectory]) => `${name}${isDirectory ? '/' : ''}`)
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
        .slice(0, 80),
      manifest,
      files,
      contentMatches,
      recentCommits: parseContextLog(logOutput)
    })
  }

  return results
}

/**
 * 批量读取仓库文件，单文件默认返回 64KB。
 * 指定 branch 时从 Git 分支读取，否则读取当前工作区。
 * 截断时可通过 nextOffset 继续读取；只允许读取已配置仓库目录。
 */
export const readRepositoryFiles = async (
  requests: RepositoryFileReadRequest[]
): Promise<RepositoryFileReadResult> => {
  const state = await getRepositoryState()
  const files: RepositoryFileContent[] = []
  const skipped: RepositoryFileReadSkip[] = []

  for (const [index, request] of requests.entries()) {
    const pathValue = request.path

    if (index >= CONTEXT_MAX_READ_FILES) {
      skipped.push({
        path: pathValue,
        reason: `单次最多读取 ${CONTEXT_MAX_READ_FILES} 个文件`
      })
      continue
    }

    if (!pathValue?.trim()) {
      skipped.push({ path: pathValue, reason: '文件路径为空' })
      continue
    }

    const requestedBranch = request.branch?.trim() || null
    let resolvedPath: string
    let root: string
    let relativePath: string
    let content: Awaited<ReturnType<typeof readFilePrefix>> | null = null

    if (requestedBranch) {
      const repositoryLocation = findRepositoryByPath(state.repositories, pathValue)

      if (!repositoryLocation) {
        skipped.push({
          path: pathValue,
          reason: '文件路径不在已配置的代码仓库内'
        })
        continue
      }

      resolvedPath = repositoryLocation.resolvedPath
      root = repositoryLocation.root
      relativePath = repositoryLocation.relativePath

      const ref = await resolveBranchRef(root, requestedBranch)

      if (!ref) {
        skipped.push({
          path: pathValue,
          reason: `分支不存在：${requestedBranch}`
        })
        continue
      }

      content = await readGitFilePrefix(
        root,
        ref,
        relativePath,
        CONTEXT_FILE_BYTES,
        request.offset ?? 0
      ).catch(() => null)

      if (!content) {
        const size = await readGitBlobSize(root, ref, relativePath)

        skipped.push({
          path: pathValue,
          reason:
            size !== null && size > MAX_BUFFER_BYTES
              ? `文件过大（${size} 字节），超出 Git 读取上限`
              : '文件不存在、不是普通文件或无法读取'
        })
        continue
      }
    } else {
      const location = await findRepositoryFile(state.repositories, pathValue)

      if (!location) {
        skipped.push({
          path: pathValue,
          reason: '文件不存在、无法访问或不在已配置的代码仓库内'
        })
        continue
      }

      resolvedPath = location.resolvedPath
      root = location.root
      relativePath = relative(root, resolvedPath)
      content = await readFilePrefix(
        resolvedPath,
        CONTEXT_FILE_BYTES,
        request.offset ?? 0
      ).catch(() => null)
    }

    if (!content) {
      skipped.push({
        path: pathValue,
        reason: '文件不存在、不是普通文件或无法读取'
      })
      continue
    }

    files.push({
      path: resolvedPath,
      relativePath,
      branch: requestedBranch,
      ...content
    })
  }

  return { files, skipped }
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

/** 列出当前仓库的未合并文件。 */
const listUnmergedFiles = async (cwd: string): Promise<string[]> =>
  (await runGit(['diff', '--name-only', '--diff-filter=U'], { cwd }).catch(
    () => ''
  ))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

/**
 * 为在 IDE 中打开仓库准备分支。
 * 已在目标分支时直接打开；存在未解决冲突时跳过 pull，允许在 IDE 中继续解决。
 * 需要切换时要求工作区干净，并尝试快进拉取。
 */
export const prepareRepositoryForIde = async (
  repositoryId: string,
  branchName: string
): Promise<{
  localPath: string
  switched: boolean
  pulled: boolean
  hasUpstream: boolean
  conflicted: boolean
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
    const conflicts = await listUnmergedFiles(cwd)

    // 冲突状态下 pull 会失败，但此时正是最需要打开 IDE 解决冲突的时候。
    if (conflicts.length > 0) {
      return {
        localPath: cwd,
        switched: false,
        pulled: false,
        hasUpstream,
        conflicted: true
      }
    }

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
      hasUpstream,
      conflicted: false
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
    hasUpstream,
    conflicted: false
  }
}

/**
 * 切换仓库分支。
 * 切换前要求工作区干净且当前分支没有未推送提交；切换成功后尝试快进 pull。
 * 已经在目标分支时直接返回 switched=false。
 */
export const switchRepositoryBranch = async (
  repositoryId: string,
  branchName: string
): Promise<RepositoryBranchSwitchResult> => {
  const normalized = branchName.trim()

  if (!normalized) throw new Error('请选择目标分支')

  const repositories = await readStore()
  const repository = repositories.find((item) => item.id === repositoryId)

  if (!repository) throw new Error('仓库不存在')
  if (!(await pathExists(repository.localPath))) throw new Error('仓库路径不存在')

  const { branches } = await listRepositoryBranches(repositoryId, true)

  if (!branches.includes(normalized)) throw new Error(`分支不存在：${normalized}`)

  const cwd = repository.localPath
  const currentBranch = (
    await runGit(['branch', '--show-current'], { cwd })
  ).trim()

  if (currentBranch === normalized) {
    return { switched: false, pulled: false, branchName: normalized }
  }

  const status = (await runGit(['status', '--porcelain'], { cwd })).trim()

  if (status) {
    throw new Error('当前仓库有未提交改动，请先提交后再切换分支')
  }

  if (currentBranch && repository.remoteUrl) {
    if (!(await hasUpstreamBranch(cwd))) {
      throw new Error('当前分支没有远程上游分支，请先推送后再切换')
    }

    const ahead = Number(
      (await runGit(['rev-list', '--count', '@{u}..HEAD'], { cwd })).trim()
    )

    if (Number.isFinite(ahead) && ahead > 0) {
      throw new Error(`当前分支有 ${ahead} 个未推送的提交，请先推送后再切换`)
    }
  }

  const previousHead = (await runGit(['rev-parse', 'HEAD'], { cwd })).trim()
  const previousLabel = currentBranch || previousHead

  await runGit(['switch', normalized], { cwd })

  const hasUpstream = await hasUpstreamBranch(cwd)
  let pullArgs: string[] | null = null

  if (hasUpstream) {
    pullArgs = ['pull', '--ff-only']
  } else if (repository.remoteUrl) {
    // 本地分支没有 tracking 配置时，显式从 origin 拉取同名分支。
    const hasRemoteBranch = await runGit(
      ['rev-parse', '--verify', `refs/remotes/origin/${normalized}`],
      { cwd }
    )
      .then(() => true)
      .catch(() => false)

    if (hasRemoteBranch) {
      pullArgs = ['pull', '--ff-only', 'origin', normalized]
    }
  }

  if (pullArgs) {
    try {
      await runGit(pullArgs, {
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
        throw new Error(
          `拉取失败，且无法恢复到原分支 ${previousLabel || '未知'}：${getGitErrorMessage(rollbackError)}`
        )
      }

      throw new Error(
        `拉取失败，已恢复到原分支 ${previousLabel || '未知'}。${detail}`
      )
    }
  }

  return {
    switched: true,
    pulled: pullArgs !== null,
    branchName: normalized
  }
}

/**
 * 把指定分支合并到当前分支。
 * 合并前要求工作区干净；合并冲突时保留冲突状态，交由用户在 IDE 中解决。
 */
export const mergeRepositoryBranch = async (
  repositoryId: string,
  sourceBranch: string
): Promise<RepositoryMergeResult> => {
  const normalized = sourceBranch.trim()

  if (!normalized) throw new Error('请选择要合并的分支')

  const repositories = await readStore()
  const repository = repositories.find((item) => item.id === repositoryId)

  if (!repository) throw new Error('仓库不存在')
  if (!(await pathExists(repository.localPath))) throw new Error('仓库路径不存在')

  const cwd = repository.localPath

  // 合并前强制刷新远程引用，确保使用最新远程分支而不是旧引用。
  if (repository.remoteUrl) {
    try {
      await runGit(['fetch', '--prune', 'origin'], {
        cwd,
        timeout: GIT_NETWORK_TIMEOUT_MS
      })
    } catch (error) {
      throw new Error(
        `拉取远程分支失败，无法合并最新远程代码：${getGitErrorMessage(error)}`
      )
    }
  }

  const { branches } = await listRepositoryBranches(repositoryId)

  if (!branches.includes(normalized)) throw new Error(`分支不存在：${normalized}`)

  const currentBranch = (
    await runGit(['branch', '--show-current'], { cwd })
  ).trim()

  if (!currentBranch) throw new Error('当前处于分离 HEAD 状态，无法合并')
  if (currentBranch === normalized) throw new Error('当前分支就是要合并的分支')

  const status = (await runGit(['status', '--porcelain'], { cwd })).trim()

  if (status) {
    throw new Error('当前仓库有未提交改动，请先提交后再合并')
  }

  const hasRemoteSource = await runGit(
    ['rev-parse', '--verify', `refs/remotes/origin/${normalized}`],
    { cwd }
  )
    .then(() => true)
    .catch(() => false)
  const hasLocalSource = await runGit(
    ['rev-parse', '--verify', `refs/heads/${normalized}`],
    { cwd }
  )
    .then(() => true)
    .catch(() => false)

  if (!hasRemoteSource && !hasLocalSource) {
    throw new Error('源分支没有可用的本地或远程引用')
  }

  const sourceRef = hasRemoteSource ? `origin/${normalized}` : normalized

  try {
    await runGit(['merge', '--no-edit', sourceRef], { cwd })
    return { conflicted: false, conflicts: [] }
  } catch (error) {
    // 有未合并文件说明是冲突，保留合并状态，交给用户在 IDE 中解决。
    const conflicts = await listUnmergedFiles(cwd)

    if (conflicts.length > 0) {
      return { conflicted: true, conflicts }
    }

    await runGit(['merge', '--abort'], { cwd }).catch(() => undefined)
    throw new Error(`合并失败：${getGitErrorMessage(error)}`)
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
  if (!(await pathExists(repository.localPath))) throw new Error('仓库路径不存在')

  // 新建分支必须基于最新远程基线：先 fetch，再优先使用 origin/<base>。
  if (repository.remoteUrl) {
    try {
      await runGit(['fetch', '--prune', 'origin'], {
        cwd: repository.localPath,
        timeout: GIT_NETWORK_TIMEOUT_MS
      })
    } catch (error) {
      throw new Error(
        `拉取远程分支失败，无法基于最新远程分支创建：${getGitErrorMessage(error)}`
      )
    }
  }

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

  const hasRemoteBase = await runGit(
    ['rev-parse', '--verify', `refs/remotes/origin/${normalizedBase}`],
    { cwd: repository.localPath }
  )
    .then(() => true)
    .catch(() => false)

  if (hasRemoteBase) {
    await runGit(
      ['branch', '--track', normalizedBranch, `origin/${normalizedBase}`],
      { cwd: repository.localPath }
    )
  } else {
    const hasLocalBase = await runGit(
      ['rev-parse', '--verify', `refs/heads/${normalizedBase}`],
      { cwd: repository.localPath }
    )
      .then(() => true)
      .catch(() => false)

    if (!hasLocalBase) throw new Error('基线分支没有可用的本地或远程引用')

    await runGit(['branch', normalizedBranch, normalizedBase], {
      cwd: repository.localPath
    })
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
 * 只有确认移出根目录或路径不存在的历史仓库才移除；读取失败保留原记录和 ID。
 */
export const refreshRootRepositories = async (): Promise<RepositoryScanResult> => {
  const root = getPreferences().repositoryRoot
  const rootRevision = repositoryRootRevision
  const removalRevision = repositoryRemovalRevision
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
  const repositories = await findRepositoriesUnderRoot(root, errors)

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

  const counts = await mutateRepositories(async () => {
  // 根目录切换/清空后，旧扫描的结果作废，不能写回新根目录的配置。
  if (rootRevision !== repositoryRootRevision) {
    errors.push('扫描期间代码根目录已变更，已忽略本次扫描结果')
    return { added: 0, updated: 0, removed: 0 }
  }
  const existing = await readStore()
  const existingByPath = new Map(existing.map((repository) => [getPathKey(repository.localPath), repository]))
  const now = new Date().toISOString()
  const nextById = new Map<string, StoredRepository>()
  let added = 0
  let updated = 0

  for (const inspected of inspectedRepositories) {
    // 删除发生在扫描开始之后时，当前扫描不得把该仓库作为“新仓库”重新加入。
    if ((removedRepositoryPaths.get(getPathKey(inspected.localPath)) ?? 0) > removalRevision) continue
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

  const inspectedPathKeys = new Set(
    inspectedRepositories.map((repository) => getPathKey(repository.localPath))
  )

  // 扫描遗漏不等于删除：权限、扫描深度和 Git 临时错误都可能让现有仓库未被返回。
  // 对遗漏的记录只依据明确的文件系统结果移除，避免重新发现时更换 ID、断开需求绑定。
  for (const repository of existing) {
    if (nextById.has(repository.id)) continue
    if (inspectedPathKeys.has(getPathKey(repository.localPath))) continue

    const relativePath = relative(getPathKey(root), getPathKey(repository.localPath))
    if (
      relativePath === '..' ||
      relativePath.startsWith('../') ||
      relativePath.startsWith('..\\') ||
      isAbsolute(relativePath)
    ) {
      continue
    }

    try {
      if (!(await stat(repository.localPath)).isDirectory()) continue
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      if (code === 'ENOENT' || code === 'ENOTDIR') continue

      errors.push(
        `无法确认仓库路径状态，已保留配置：${repository.localPath}（${
          error instanceof Error ? error.message : '读取失败'
        }）`
      )
    }

    nextById.set(repository.id, repository)
  }

  const removed = existing.filter((repository) => !nextById.has(repository.id)).length
  const merged = [...nextById.values()]
  await writeStore(merged)
  return { added, updated, removed }
  })

  const state = await getRepositoryState()
  const result: RepositoryScanResult = {
    ...state,
    ...counts,
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

  await mutateRepositories(async () => {
  const previousRoot = getPreferences().repositoryRoot
  const rootChanged = previousRoot ? getPathKey(previousRoot) !== getPathKey(normalized) : false

  updatePreferences({
    repositoryRoot: normalized
  })

  if (rootChanged) {
    await writeStore([])
  }

  repositoryRootRevision += 1
  startRepositoryWatcher(normalized)
  })
  await refreshRootRepositories()

  return getRepositoryState()
}

/**
 * 清除代码根目录和所有仓库配置。
 * 只删除应用内元数据，不删除本地代码。
 */
export const clearRepositoryRoot = async (): Promise<RepositoryState> => {
  await mutateRepositories(async () => {
  updatePreferences({
    repositoryRoot: undefined
  })
  await writeStore([])
  repositoryRootRevision += 1
  stopRepositoryWatcher()
  })

  const state = await getRepositoryState()
  broadcastRepositoryChanged(state)
  return state
}

/**
 * 将指定路径的 Git 仓库写入仓库数据。
 * 克隆完成后复用这段逻辑。
 */
const saveRepositoryFromPath = async (
  targetPath: string,
  rootRevision = repositoryRootRevision
): Promise<RepositoryState> => {
  const removalRevision = repositoryRemovalRevision
  const inspected = await inspectRepository(targetPath)

  if (!inspected) {
    throw new Error('选择的目录不是 Git 仓库')
  }

  await mutateRepositories(async () => {
  if (rootRevision !== repositoryRootRevision) {
    throw new Error('代码根目录已变更，请重新扫描仓库')
  }
  if ((removedRepositoryPaths.get(getPathKey(inspected.localPath)) ?? 0) > removalRevision) {
    throw new Error('仓库记录已被移除，请重新扫描仓库')
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
  })
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
  const rootRevision = repositoryRootRevision
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

  const state = await saveRepositoryFromPath(targetPath, rootRevision)
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
  await mutateRepositories(async () => {
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
  })

  const state = await getRepositoryState()
  broadcastRepositoryChanged(state)
  return state
}

/**
 * 移除仓库元数据。
 * 只删除应用内记录，不删除本地代码。
 */
export const removeRepository = async (repositoryId: string): Promise<RepositoryState> => {
  await mutateRepositories(async () => {
  const repositories = await readStore()
  const target = repositories.find((repository) => repository.id === repositoryId)
  await writeStore(repositories.filter((repository) => repository.id !== repositoryId))
  if (target) {
    removedRepositoryPaths.set(getPathKey(target.localPath), ++repositoryRemovalRevision)
  }
  })

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

  // 把指定分支合并到当前分支。
  ipcMain.handle(
    'repositories:merge-branch',
    (_event, repositoryId: unknown, sourceBranch: unknown) => {
      if (
        typeof repositoryId !== 'string' ||
        typeof sourceBranch !== 'string'
      ) {
        throw new Error('Invalid merge input')
      }

      return mergeRepositoryBranch(repositoryId, sourceBranch)
    }
  )

  // 切换当前仓库分支。
  ipcMain.handle(
    'repositories:switch-branch',
    (_event, repositoryId: unknown, branchName: unknown) => {
      if (
        typeof repositoryId !== 'string' ||
        typeof branchName !== 'string'
      ) {
        throw new Error('Invalid switch input')
      }

      return switchRepositoryBranch(repositoryId, branchName)
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

  // 清除根目录及应用内仓库记录，不删除磁盘上的代码。
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
