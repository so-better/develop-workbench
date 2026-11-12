/**
 * 粘贴选择。
 * 读取系统剪贴板并保留最近内容供快速选择；不接管系统剪贴板。
 */
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  Notification,
  screen
} from 'electron'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { backupCorruptStore } from './store-backup'
import { getPreferences } from './preferences'
import type {
  ClipboardHistoryFile,
  ClipboardHistoryItem,
  ClipboardHistorySettings,
  ClipboardHistoryState,
  ClipboardPasteResult
} from '../types/clipboard-history'

const execFileAsync = promisify(execFile)

// 历史文件、图片缓存目录和默认快捷键。
const STORE_FILE = 'clipboard-history.json'
const IMAGE_DIRECTORY = 'clipboard-history-images'
const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+V'

// 容量限制：文本、图片、文件共用条数额度；图片额外限制总缓存和单张大小。
const MAX_ITEMS = 100
const MAX_IMAGE_BYTES = 200 * 1024 * 1024
const MAX_SINGLE_IMAGE_BYTES = 20 * 1024 * 1024
// 单条文本上限 200 KB，避免历史文件过大、每次写盘和 IPC 过慢。
const MAX_TEXT_LENGTH = 200_000
const MAX_FILES = 50

// Electron 没有剪贴板变更事件，使用低频轮询；浮层按内容控制在底部。
const POLL_INTERVAL_MS = 900
const OVERLAY_WIDTH = 980
const OVERLAY_HEIGHT = 200
const SCRIPT_TIMEOUT_MS = 8_000

interface Store {
  items: ClipboardHistoryItem[]
  shortcut: string
}

/** 首次使用或文件缺失时的空状态。 */
const emptyStore = (): Store => ({
  items: [],
  shortcut: DEFAULT_SHORTCUT
})

let cachedStore: Store | null = null
let pollTimer: NodeJS.Timeout | null = null
let lastSignature: string | null = null
let lastFileSignature: string | null = null
let lastFileFallbackAt = 0
let previousTargetPid: number | null = null
let previousWindowHandle: string | null = null
let lastImageType: string | null = null
let lastImageSize = 0
let overlayWindow: BrowserWindow | null = null
let pasteInProgress = false
let registeredShortcut: string | null = null
let mutationQueue: Promise<unknown> = Promise.resolve()
// 缩略图按“记录 ID + 宽度”缓存，避免浮层滚动时重复读原图。
const thumbnailCache = new Map<string, string>()

const userDataPath = (name: string): string => join(app.getPath('userData'), name)
const imageDirectory = (): string => userDataPath(IMAGE_DIRECTORY)
const storePath = (): string => userDataPath(STORE_FILE)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')

/** 执行平台脚本，统一限制超时和输出大小，避免剪贴板操作阻塞主进程。 */
const runScript = async (command: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(command, args, {
    timeout: SCRIPT_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true
  })

  return stdout
}

/** 不同平台暴露文件列表的格式名不一致，这里集中列出常见特征。 */
const FILE_TYPE_HINTS = [
  'public.file-url',
  'nsfilenamespboardtype',
  'filenamew',
  'filename',
  'cf_hdrop',
  '0x6c697374',
  'furl'
]

/** Electron 会把文件列表暴露为系统私有格式，按格式名特征识别。 */
const isFileClipboardType = (type: string): boolean => {
  const lower = type.toLowerCase()
  if (lower.includes('filename')) return true
  if (!lower.startsWith('electron application/osclipboard;format=')) return false
  return FILE_TYPE_HINTS.some((hint) => lower.includes(hint))
}

/** 图片统一按 image/* MIME 类型处理。 */
const isImageClipboardType = (type: string): boolean => type.startsWith('image/')

/** 校验磁盘中的记录，丢弃缺少关键字段的损坏数据。 */
const normalizeStoreItem = (value: unknown): ClipboardHistoryItem | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') {
    return null
  }

  if (value.type !== 'text' && value.type !== 'image' && value.type !== 'files') {
    return null
  }

  return {
    id: value.id,
    type: value.type,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    text: typeof value.text === 'string' ? value.text : null,
    imageFile: typeof value.imageFile === 'string' ? value.imageFile : null,
    imageWidth: typeof value.imageWidth === 'number' ? value.imageWidth : null,
    imageHeight: typeof value.imageHeight === 'number' ? value.imageHeight : null,
    files: Array.isArray(value.files)
      ? value.files.filter(
          (file): file is ClipboardHistoryFile =>
            isRecord(file) &&
            typeof file.path === 'string' &&
            typeof file.name === 'string' &&
            typeof file.isDirectory === 'boolean'
        )
      : null,
    size: typeof value.size === 'number' ? value.size : 0,
    contentHash: typeof value.contentHash === 'string' ? value.contentHash : null
  }
}

/** 读取时限制条数并补齐默认快捷键，兼容旧版本字段。 */
const normalizeStore = (value: unknown): Store => {
  if (!isRecord(value)) return emptyStore()

  const items = Array.isArray(value.items)
    ? value.items
        .map(normalizeStoreItem)
        .filter((item): item is ClipboardHistoryItem => Boolean(item))
        .slice(0, MAX_ITEMS)
    : []

  return {
    items,
    shortcut: typeof value.shortcut === 'string' && value.shortcut.trim()
      ? value.shortcut.trim()
      : DEFAULT_SHORTCUT
  }
}

/** 文件不存在视为首次使用；内容损坏时先备份再重置。 */
const readStore = async (): Promise<Store> => {
  if (cachedStore) return cachedStore

  let raw: string

  try {
    raw = await readFile(storePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      cachedStore = emptyStore()
      return cachedStore
    }

    throw error
  }

  try {
    cachedStore = normalizeStore(JSON.parse(raw))
  } catch {
    await backupCorruptStore(storePath())
    cachedStore = emptyStore()
  }

  return cachedStore
}

/** 先写临时文件再替换，避免写入中断截断历史。 */
const writeStore = async (store: Store): Promise<void> => {
  const target = storePath()
  const temporary = `${target}.${randomUUID()}.tmp`

  try {
    await writeFile(temporary, JSON.stringify(store, null, 2), 'utf8')
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

/** 所有写操作串行执行，避免快速复制和删除互相覆盖。 */
const mutateStore = <T>(operation: (store: Store) => Promise<T> | T): Promise<T> => {
  const result = mutationQueue.then(async () => {
    const store = await readStore()
    const value = await operation(store)
    await writeStore(store)
    return value
  })

  mutationQueue = result.then(
    () => undefined,
    () => undefined
  )

  return result
}

/** 把历史、快捷键、浮层状态和主题合并给渲染进程。 */
const getState = async (): Promise<ClipboardHistoryState> => {
  const store = await readStore()
  const preferenceTheme = getPreferences().theme
  const dark =
    preferenceTheme === 'dark' ||
    (preferenceTheme === 'system' && nativeTheme.shouldUseDarkColors)

  return {
    items: store.items,
    shortcut: store.shortcut,
    theme: dark ? 'dark' : 'light'
  }
}

/** 设置页只需要快捷键和注册状态，不返回完整历史。 */
const getSettings = async (): Promise<ClipboardHistorySettings> => {
  const store = await readStore()
  return {
    shortcut: store.shortcut,
    shortcutRegistered: globalShortcut.isRegistered(store.shortcut)
  }
}

/** 浮层接收完整状态；其他窗口只收到变更通知，避免传输大量文本。 */
const broadcastState = (): void => {
  getState().then((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue

      if (window === overlayWindow) {
        window.webContents.send('clipboard-history:state', state)
      } else {
        window.webContents.send('clipboard-history:changed')
      }
    }
  })
}

/** 删除记录时同步清理图片缓存。 */
const removeImageFile = async (item: ClipboardHistoryItem): Promise<void> => {
  if (!item.imageFile) return
  await rm(join(imageDirectory(), item.imageFile), { force: true }).catch(() => undefined)

  for (const key of thumbnailCache.keys()) {
    if (key.startsWith(`${item.id}:`)) thumbnailCache.delete(key)
  }
}

/** 清理历史中不再引用的图片，兼容异常退出和手动删除。 */
const cleanupOrphanImages = async (store: Store): Promise<void> => {
  const referenced = new Set(
    store.items
      .map((item) => item.imageFile)
      .filter((value): value is string => Boolean(value))
  )
  const entries = await readdir(imageDirectory(), { withFileTypes: true }).catch(
    () => []
  )

  for (const entry of entries) {
    if (!entry.isFile() || referenced.has(entry.name)) continue
    await rm(join(imageDirectory(), entry.name), { force: true }).catch(
      () => undefined
    )
  }
}

/** 超出条数或图片缓存上限时，从最旧记录开始淘汰。 */
const pruneStore = async (store: Store): Promise<void> => {
  while (store.items.length > MAX_ITEMS) {
    const removed = store.items.pop()
    if (removed) await removeImageFile(removed)
  }

  let total = store.items.reduce(
    (sum, item) => (item.type === 'image' ? sum + item.size : sum),
    0
  )

  // 从最旧的图片开始淘汰，直到缓存回到上限内。
  for (let index = store.items.length - 1; index >= 0 && total > MAX_IMAGE_BYTES; index -= 1) {
    const item = store.items[index]
    if (item.type !== 'image' || !item.imageFile) continue

    total -= item.size
    await removeImageFile(item)
    store.items.splice(index, 1)
  }
}

/** 只保留当前电脑真实存在的路径，并区分文件和目录。 */
const toFileReferences = async (paths: string[]): Promise<ClipboardHistoryFile[]> => {
  const files: ClipboardHistoryFile[] = []

  for (const rawPath of paths.slice(0, MAX_FILES)) {
    const path = rawPath.trim()
    if (!path) continue

    const info = await stat(path).catch(() => null)
    if (!info) continue

    files.push({
      path,
      name: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
      isDirectory: info.isDirectory()
    })
  }

  return files
}

/** 平台脚本兜底：macOS 读取剪贴板列表或 FURL，Windows 读取 FileDropList。 */
const readClipboardFiles = async (): Promise<string[]> => {
  try {
    if (process.platform === 'darwin') {
      const script = [
        'on run',
        '  try',
        '    set theItems to the clipboard as list',
        '    set output to ""',
        '    repeat with anItem in theItems',
        '      try',
        '        set output to output & (POSIX path of anItem) & linefeed',
        '      end try',
        '    end repeat',
        '    if output is not "" then return output',
        '  end try',
        '  try',
        '    return POSIX path of (the clipboard as «class furl»)',
        '  on error',
        '    return ""',
        '  end try',
        'end run'
      ].join('\n')
      const output = await runScript('osascript', ['-e', script])
      return output.split(/\r?\n/).filter(Boolean)
    }

    if (process.platform === 'win32') {
      const script =
        'Add-Type -AssemblyName System.Windows.Forms; ' +
        '[System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { $_ }'
      const output = await runScript('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        script
      ])
      return output.split(/\r?\n/).filter(Boolean)
    }
  } catch {
    // 文件剪贴板读取失败时退回文本或图片。
  }

  return []
}

/** Windows 写入文件拖放列表；macOS 用 NSFilenamesPboardType，否则 Finder 无法粘贴。 */
const writeClipboardFiles = async (paths: string[]): Promise<void> => {
  if (process.platform === 'darwin') {
    const fileList = paths
      .map((path) => `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(', ')
    // 用 NSFilenamesPboardType 写入真正的文件列表，Finder 和附件输入框才能识别。
    const scriptLines = [
      'use framework "AppKit"',
      'use scripting additions',
      `set fileList to {${fileList}}`,
      "set pb to current application's NSPasteboard's generalPasteboard()",
      "pb's clearContents()",
      "pb's setPropertyList:fileList forType:\"NSFilenamesPboardType\""
    ]
    const args = scriptLines.flatMap((line) => ['-e', line])
    await runScript('osascript', args)
    return
  }

  if (process.platform === 'win32') {
    const quoted = paths.map((path) => `'${path.replace(/'/g, "''")}'`).join(',')
    const script = `Set-Clipboard -Path ${quoted}`
    await runScript('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-Command',
      script
    ])
    return
  }

  throw new Error('当前系统不支持文件剪贴板')
}

/** 记录呼出浮层前的目标应用，粘贴前恢复到该应用。 */
const capturePreviousTarget = async (): Promise<void> => {
  if (process.platform === 'darwin') {
    try {
      const output = await runScript('osascript', [
        '-e',
        'tell application "System Events" to get unix id of first application process whose frontmost is true'
      ])
      const pid = Number(output.trim())
      previousTargetPid = Number.isInteger(pid) ? pid : null
    } catch {
      previousTargetPid = null
    }
    return
  }

  if (process.platform === 'win32') {
    try {
      const script = [
        'Add-Type @"',
        'using System;',
        'using System.Runtime.InteropServices;',
        'public class ClipboardWin32 {',
        '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
        '}',
        '"@',
        '[ClipboardWin32]::GetForegroundWindow().ToInt64()'
      ].join('\n')
      const output = await runScript('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script
      ])
      previousWindowHandle = output.trim() || null
    } catch {
      previousWindowHandle = null
    }
  }
}

/** 粘贴前把焦点还给原应用；失败时不发送按键，避免粘贴到错误位置。 */
const activatePreviousTarget = async (): Promise<boolean> => {
  if (process.platform === 'darwin') {
    if (!previousTargetPid) return false

    await runScript('osascript', [
      '-e',
      `tell application "System Events" to set frontmost of (first application process whose unix id is ${previousTargetPid}) to true`
    ])
    return true
  }

  if (process.platform === 'win32') {
    if (!previousWindowHandle) return false

    const script = [
      'Add-Type @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class ClipboardWin32 {',
      '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
      '}',
      '"@',
      `[ClipboardWin32]::SetForegroundWindow([IntPtr]${previousWindowHandle}) | Out-Null`
    ].join('\n')

    await runScript('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script
    ])
    return true
  }

  return false
}

/** 只负责发送平台粘贴快捷键，焦点恢复由 activatePreviousTarget 完成。 */
const sendPasteShortcut = async (): Promise<void> => {
  if (process.platform === 'darwin') {
    await runScript('osascript', [
      '-e',
      'tell application "System Events" to keystroke "v" using command down'
    ])
    return
  }

  if (process.platform === 'win32') {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '[System.Windows.Forms.SendKeys]::SendWait("^v")'
    await runScript('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
    return
  }

  throw new Error('当前系统不支持自动粘贴')
}

/** 文本按内容去重，重复复制时移动到最前。 */
const captureText = async (text: string): Promise<void> => {
  const normalized = text.slice(0, MAX_TEXT_LENGTH)
  const signature = `text:${sha256(normalized)}`

  if (signature === lastSignature) return
  lastSignature = signature

  await mutateStore((store) => {
    const existing = store.items.find(
      (item) => item.type === 'text' && item.text === normalized
    )
    const now = new Date().toISOString()

    if (existing) {
      existing.createdAt = now
      store.items = [existing, ...store.items.filter((item) => item.id !== existing.id)]
      return
    }

    store.items.unshift({
      id: randomUUID(),
      type: 'text',
      createdAt: now,
      text: normalized,
      imageFile: null,
      imageWidth: null,
      imageHeight: null,
      files: null,
      size: Buffer.byteLength(normalized, 'utf8'),
      contentHash: null
    })
  })

  await mutateStore((store) => pruneStore(store))
  broadcastState()
}

/** 图片按 PNG 内容哈希去重，避免同一张图反复写入缓存。 */
const captureImage = async (image: Electron.NativeImage): Promise<void> => {
  const buffer = image.toPNG()

  if (buffer.length === 0 || buffer.length > MAX_SINGLE_IMAGE_BYTES) return

  const hash = sha256(buffer)
  const signature = `image:${hash}`

  if (signature === lastSignature) return
  lastSignature = signature

  const store = await readStore()
  const existing = store.items.find(
    (item) => item.type === 'image' && item.contentHash === hash
  )

  if (existing) {
    await mutateStore((current) => {
      existing.createdAt = new Date().toISOString()
      current.items = [existing, ...current.items.filter((item) => item.id !== existing.id)]
    })
    broadcastState()
    return
  }

  const id = randomUUID()
  const imageFile = `${id}.png`
  const size = image.getSize()

  await mkdir(imageDirectory(), { recursive: true })
  await writeFile(join(imageDirectory(), imageFile), buffer)
  thumbnailCache.delete(id)

  await mutateStore((current) => {
    current.items.unshift({
      id,
      type: 'image',
      createdAt: new Date().toISOString(),
      text: null,
      imageFile,
      imageWidth: size.width,
      imageHeight: size.height,
      files: null,
      size: buffer.length,
      contentHash: hash
    })
  })

  await mutateStore((current) => pruneStore(current))
  broadcastState()
}

/** 文件按路径集合去重，保留多选文件和文件夹。 */
const captureFiles = async (paths: string[]): Promise<void> => {
  const files = await toFileReferences(paths)

  if (files.length === 0) return

  const key = files.map((file) => file.path).sort().join('\n')
  const hash = sha256(key)
  const signature = `files:${hash}`

  if (signature === lastSignature) return
  lastSignature = signature

  const now = new Date().toISOString()

  await mutateStore((store) => {
    const existing = store.items.find(
      (item) =>
        item.type === 'files' &&
        (item.contentHash === hash ||
          (item.files ?? []).map((file) => file.path).sort().join('\n') === key)
    )

    if (existing) {
      existing.createdAt = now
      existing.contentHash = hash
      store.items = [existing, ...store.items.filter((item) => item.id !== existing.id)]
      return
    }

    store.items.unshift({
      id: randomUUID(),
      type: 'files',
      createdAt: now,
      text: null,
      imageFile: null,
      imageWidth: null,
      imageHeight: null,
      files,
      size: files.length,
      contentHash: hash
    })
  })

  await mutateStore((store) => pruneStore(store))
  broadcastState()
}

/** 优先识别文件，其次图片，最后文本；文件路径同时兼容 text/uri-list 和系统私有格式。 */
const readClipboardContent = async (): Promise<{
  paths: string[]
  imageBlob: Blob | null
  imageType: string | null
  imageSize: number
  text: string
  hasFileType: boolean
  fileSignature: string | null
}> => {
  const items = await clipboard.read()
  let hasFileType = false
  const fileHashes: string[] = []
  const paths = new Set<string>()

  const collectFileUrls = (content: string): void => {
    for (const line of content.split(/\r?\n/)) {
      const value = line.trim()
      if (!value.startsWith('file://')) continue

      try {
        paths.add(fileURLToPath(value))
      } catch {
        // 忽略不完整的文件地址。
      }
    }
  }

  for (const item of items) {
    const fileTypes = item.types.filter(isFileClipboardType)
    if (fileTypes.length > 0) hasFileType = true

    for (const type of fileTypes) {
      try {
        const value = await item.getType(type)
        if (!(value instanceof Blob)) continue
        fileHashes.push(sha256(await value.text()))
      } catch {
        // 某个格式读取失败时继续尝试其他格式。
      }
    }

    // Windows 和部分 macOS 场景会把文件列表暴露为 text/uri-list。
    if (item.types.includes('text/uri-list')) {
      try {
        const value = await item.getType('text/uri-list')
        if (value instanceof Blob) {
          const content = await value.text()
          fileHashes.push(sha256(content))
          const before = paths.size
          collectFileUrls(content)
          if (paths.size > before) hasFileType = true
        }
      } catch {
        // 读取失败时退回平台脚本。
      }
    }
  }

  let imageBlob: Blob | null = null
  let imageType: string | null = null
  let imageSize = 0

  if (!hasFileType) {
    for (const item of items) {
      const type = item.types.find(isImageClipboardType)
      if (!type) continue

      try {
        const value = await item.getType(type)
        if (!(value instanceof Blob)) continue

        imageBlob = value
        imageType = type
        imageSize = value.size
        break
      } catch {
        // 图片读取失败时继续尝试。
      }
    }
  }

  const text =
    !hasFileType && !imageBlob ? await clipboard.readText() : ''

  return {
    paths: [...paths],
    imageBlob,
    imageType,
    imageSize,
    text,
    hasFileType,
    fileSignature: fileHashes.length > 0 ? sha256(fileHashes.join(':')) : null
  }
}

/** Electron 没有剪贴板变更事件，用低频轮询；内容切换时清空对应指纹。 */
const pollClipboard = async (): Promise<void> => {
  if (pasteInProgress) return
  try {
    const content = await readClipboardContent()

    // 当前内容不是文件/图片时清空对应指纹，让相同内容再次复制时能移到最前。
    if (!content.hasFileType) lastFileSignature = null
    if (!content.imageBlob) {
      lastImageType = null
      lastImageSize = 0
    }

    if (content.hasFileType) {
      if (content.fileSignature && content.fileSignature === lastFileSignature) return
      if (content.fileSignature) {
        lastFileSignature = content.fileSignature
      } else if (Date.now() - lastFileFallbackAt < 3_000) {
        return
      }

      lastFileFallbackAt = Date.now()
      const paths =
        content.paths.length > 0 ? content.paths : await readClipboardFiles()

      if (paths.length > 0) {
        await captureFiles(paths)
        return
      }
    }

    if (content.imageBlob && content.imageType) {
      if (
        content.imageType !== lastImageType ||
        content.imageSize !== lastImageSize
      ) {
        lastImageType = content.imageType
        lastImageSize = content.imageSize
        const buffer = Buffer.from(await content.imageBlob.arrayBuffer())
        const image = nativeImage.createFromBuffer(buffer)

        if (!image.isEmpty()) await captureImage(image)
      }

      return
    }

    if (content.text.trim()) await captureText(content.text)
  } catch {
    // 单次读取失败不终止监听。
  }
}

/** 启动后立即读取一次当前剪贴板，再进入轮询。 */
const startWatcher = (): void => {
  if (pollTimer) return

  pollClipboard()
  pollTimer = setInterval(() => pollClipboard(), POLL_INTERVAL_MS)
}

/** 退出前停止轮询。 */
const stopWatcher = (): void => {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

/** 开发环境加载 Vite 页面，生产环境加载打包后的 index.html。 */
const getOverlayUrl = (): { url?: string; file?: string } =>
  process.env['ELECTRON_RENDERER_URL']
    ? { url: `${process.env['ELECTRON_RENDERER_URL']}#clipboard-overlay` }
    : { file: join(__dirname, '../renderer/index.html') }

/** 底部浮层使用无边框透明窗口，失去焦点时自动隐藏。 */
const createOverlayWindow = (): BrowserWindow => {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(OVERLAY_WIDTH, display.workArea.width - 24)
  const height = OVERLAY_HEIGHT
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = Math.round(display.workArea.y + display.workArea.height - height - 20)

  const window = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.setAlwaysOnTop(true, 'screen-saver')
  window.on('blur', () => {
    if (!pasteInProgress) window.hide()
  })
  window.on('closed', () => {
    overlayWindow = null
  })

  const target = getOverlayUrl()
  if (target.url) {
    window.loadURL(target.url)
  } else if (target.file) {
    window.loadFile(target.file, { hash: 'clipboard-overlay' })
  }

  return window
}

/** 按需创建浮层，避免启动时额外占用一个渲染进程。 */
const ensureOverlayWindow = (): BrowserWindow => {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow

  overlayWindow = createOverlayWindow()
  return overlayWindow
}

/** 先记录目标应用，再定位到光标所在屏幕底部并聚焦。 */
const showOverlay = async (): Promise<void> => {
  // 先记录前台应用，再创建/显示浮层，避免窗口创建影响目标判断。
  await capturePreviousTarget()
  const window = ensureOverlayWindow()

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = window.getBounds()
  // 窗口只在首次创建时按当时屏幕计算尺寸；切换显示器时需要重新收进可用区域。
  const width = Math.min(bounds.width, display.workArea.width - 24)
  const height = Math.min(bounds.height, display.workArea.height - 40)
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = Math.round(display.workArea.y + display.workArea.height - height - 20)

  window.setBounds({ x, y, width, height })
  window.show()
  window.focus()
  window.webContents.send('clipboard-history:shown')
  broadcastState()
}

/** 只隐藏窗口，不销毁页面，保留已加载的缩略图和滚动位置。 */
const hideOverlay = (): void => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.hide()
  broadcastState()
}

/** 全局快捷键在打开和收起之间切换。 */
const toggleOverlay = (): void => {
  if (overlayWindow?.isVisible()) {
    hideOverlay()
    return
  }

  showOverlay()
}

/** 把历史记录按类型写回系统剪贴板。 */
const writeItemToClipboard = async (item: ClipboardHistoryItem): Promise<void> => {
  if (item.type === 'text' && item.text !== null) {
    await clipboard.writeText(item.text)
    return
  }

  if (item.type === 'image' && item.imageFile) {
    const image = nativeImage.createFromPath(join(imageDirectory(), item.imageFile))
    if (image.isEmpty()) throw new Error('图片缓存已失效')

    const png = image.toPNG()
    const blob = new Blob([new Uint8Array(png)], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return
  }

  if (item.type === 'files' && item.files?.length) {
    const existing = await Promise.all(
      item.files.map(async (file) => ((await stat(file.path).catch(() => null)) ? file : null))
    )

    if (existing.some((file) => !file)) {
      throw new Error('部分文件已移动或删除，无法粘贴')
    }

    await writeClipboardFiles(item.files.map((file) => file.path))
    return
  }

  throw new Error('记录内容不可用')
}

/** 自动粘贴失败时用系统通知提示手动粘贴。 */
const notify = (body: string): void => {
  if (!Notification.isSupported()) return
  new Notification({ title: '剪贴板', body }).show()
}

/**
 * 根据 osascript 错误区分缺失的是自动化权限还是辅助功能权限。
 * 应用更新后 ad-hoc 签名变化会重置授权，需要重新添加。
 */
const describePastePermissionFailure = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)

  if (/-1743|not authorized to send apple events/i.test(text)) {
    return '内容已复制到剪贴板。请在“系统设置 → 隐私与安全性 → 自动化”中允许本应用控制 System Events，或手动按 Cmd+V。'
  }

  if (/-1719|assistive access/i.test(text)) {
    return '内容已复制到剪贴板。请在“系统设置 → 隐私与安全性 → 辅助功能”中重新添加本应用（应用更新后可能需要重新授权），或手动按 Cmd+V。'
  }

  return '内容已复制到剪贴板。请在系统设置中授予辅助功能或自动化权限后自动粘贴，或手动按 Cmd+V。'
}

/** 使用记录后置顶，并按“恢复焦点 → 隐藏浮层 → 粘贴”的顺序执行。 */
const pasteItem = async (id: string): Promise<ClipboardPasteResult> => {
  const store = await readStore()
  const item = store.items.find((entry) => entry.id === id)

  if (!item) return { success: false, message: '记录已不存在' }

  try {
    await writeItemToClipboard(item)
  } catch (error) {
    const message = error instanceof Error ? error.message : '写入剪贴板失败'
    notify(message)
    return { success: false, message }
  }

  // 使用历史记录后将它移到最前，符合“最近使用”排序。
  await mutateStore((store) => {
    const current = store.items.find((entry) => entry.id === item.id)
    if (!current) return
    current.createdAt = new Date().toISOString()
    store.items = [current, ...store.items.filter((entry) => entry.id !== item.id)]
  })

  pasteInProgress = true

  let targetReady = false

  try {
    // 先把焦点还给原应用，并留出时间让它真正切到前台，再隐藏浮层。
    // 否则浮层隐藏后，本应用主窗口会短暂显示在最前，形成闪烁。
    targetReady = await activatePreviousTarget().catch(() => false)

    if (targetReady) {
      await new Promise((resolve) => setTimeout(resolve, 120))
    }

    hideOverlay()

    if (!targetReady) {
      const message = '内容已复制到剪贴板，请手动粘贴。'
      notify(message)
      return { success: true, message }
    }

    await new Promise((resolve) => setTimeout(resolve, 60))
    await sendPasteShortcut()
    return { success: true, message: null }
  } catch (error) {
    const message =
      process.platform === 'darwin'
        ? describePastePermissionFailure(error)
        : '内容已复制到剪贴板，请手动粘贴。'
    notify(message)
    return { success: true, message }
  } finally {
    pasteInProgress = false
  }
}

/** 注册全局快捷键；冲突时返回 false，由调用方决定回退。 */
const registerShortcut = (shortcut: string): boolean => {
  if (registeredShortcut === shortcut) return true

  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut)
    registeredShortcut = null
  }

  let registered = false

  try {
    registered = globalShortcut.register(shortcut, toggleOverlay)
  } catch {
    registered = false
  }

  if (registered) registeredShortcut = shortcut
  return registered
}

/** 按需生成并缓存缩略图，避免浮层一次加载全部原图。 */
const getImageDataUrl = async (
  id: string,
  maxWidth: number
): Promise<string | null> => {
  const cacheKey = `${id}:${maxWidth}`
  const cached = thumbnailCache.get(cacheKey)
  if (cached) return cached

  const store = await readStore()
  const item = store.items.find((entry) => entry.id === id)
  if (!item?.imageFile) return null

  const image = nativeImage.createFromPath(join(imageDirectory(), item.imageFile))
  if (image.isEmpty()) return null

  const size = image.getSize()
  const resized = size.width > maxWidth
    ? image.resize({ width: maxWidth, quality: 'good' })
    : image
  const dataUrl = resized.toDataURL()
  thumbnailCache.set(cacheKey, dataUrl)
  return dataUrl
}

/** 启动监听、注册快捷键并暴露渲染进程接口。 */
export const initializeClipboardHistory = (): void => {
  readStore()
    .then(async (store) => {
      await cleanupOrphanImages(store)

      if (!registerShortcut(store.shortcut)) {
        notify('全局快捷键注册失败，请在设置中修改')
      }
      broadcastState()
    })
    .catch(() => undefined)

  startWatcher()

  app.on('before-quit', () => {
    stopWatcher()
    if (registeredShortcut) globalShortcut.unregister(registeredShortcut)
    registeredShortcut = null
    overlayWindow?.destroy()
    overlayWindow = null
  })

  ipcMain.handle('clipboard-history:get-state', () => getState())
  ipcMain.handle('clipboard-history:get-settings', () => getSettings())
  ipcMain.handle('clipboard-history:show', () => showOverlay())
  ipcMain.handle('clipboard-history:hide', () => hideOverlay())
  ipcMain.handle('clipboard-history:paste', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('记录 ID 不合法')
    return pasteItem(id)
  })
  ipcMain.handle('clipboard-history:clear', async () => {
    const store = await readStore()
    for (const item of store.items) await removeImageFile(item)
    thumbnailCache.clear()
    await mutateStore((current) => {
      current.items = []
    })
    broadcastState()
    return getSettings()
  })
  ipcMain.handle('clipboard-history:set-shortcut', async (_event, shortcut: unknown) => {
    if (typeof shortcut !== 'string' || !shortcut.trim()) {
      throw new Error('快捷键不能为空')
    }

    const value = shortcut.trim()
    const store = await readStore()
    const previous = store.shortcut

    if (!registerShortcut(value)) {
      registerShortcut(previous)
      throw new Error('快捷键已被其他应用占用，请换一个')
    }

    await mutateStore((current) => {
      current.shortcut = value
    })
    broadcastState()
    return getSettings()
  })
  // 录制快捷键时临时注销全局快捷键，避免按下当前组合时同时弹出浮层。
  ipcMain.handle('clipboard-history:set-recording', async (_event, recording: unknown) => {
    if (typeof recording !== 'boolean') throw new Error('录制状态不合法')

    if (recording) {
      if (registeredShortcut) {
        globalShortcut.unregister(registeredShortcut)
        registeredShortcut = null
      }
      return
    }

    const store = await readStore()
    registerShortcut(store.shortcut)
  })
  ipcMain.handle('clipboard-history:get-image', (_event, id: unknown, maxWidth: unknown) => {
    if (typeof id !== 'string') return null
    const width = typeof maxWidth === 'number' && maxWidth > 0 ? Math.min(maxWidth, 800) : 320
    return getImageDataUrl(id, width)
  })
}
