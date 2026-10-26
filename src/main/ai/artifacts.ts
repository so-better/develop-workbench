import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, extname, join } from 'node:path'
import { createGeneratedDownload } from '../embedded-browser'
import type { AiArtifactStats, AiChatArtifact } from '../../types/ai'

interface ArtifactRecord {
  path: string
  filename: string
  mimeType: string
  size: number
}

/** 本轮应用生命周期内的 AI 产物索引。聊天不持久化，因此不需要跨重启索引。 */
const artifacts = new Map<string, ArtifactRecord>()

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'video/mp4': '.mp4'
}

const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.svg': 'image/svg+xml',
  '.log': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

const getArtifactsRoot = (): string =>
  join(app.getPath('userData'), 'ai-artifacts')

/** 清理 AI SDK 文件产物名称，避免非法路径字符。 */
const sanitizeArtifactFilename = (value: string): string =>
  basename(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()

/** 为一次文件生成创建独立的内部目录，避免文件名冲突。 */
export const createArtifactTarget = async (
  filename: string
): Promise<{ id: string; path: string }> => {
  const id = randomUUID()
  const directory = join(getArtifactsRoot(), id)

  await mkdir(directory, { recursive: true })

  return {
    id,
    path: join(directory, filename)
  }
}

/** 文件写完后登记产物元信息，供聊天展示和后续下载。 */
export const registerArtifact = async (
  id: string,
  path: string,
  filename: string,
  mimeTypeOverride?: string
): Promise<AiChatArtifact> => {
  const fileStat = await stat(path)
  const mimeType =
    mimeTypeOverride ??
    MIME_TYPES[extname(filename).toLowerCase()] ??
    'application/octet-stream'

  artifacts.set(id, {
    path,
    filename,
    mimeType,
    size: fileStat.size
  })

  return {
    id,
    kind: 'file',
    name: filename,
    size: fileStat.size,
    mimeType
  }
}

/**
 * 保存 AI SDK 直接生成的 file / reasoning-file。
 * 写入内部产物目录后返回可下载 artifact，避免前端 data URL 无法走产物下载。
 */
export const saveGeneratedArtifact = async (input: {
  base64: string
  mediaType: string
  filename?: string
}): Promise<AiChatArtifact> => {
  const mediaType =
    input.mediaType.split(';')[0]?.trim() || 'application/octet-stream'
  const fallbackName = mediaType.startsWith('image/') ? 'AI 图片' : 'AI 文件'
  const safeName =
    sanitizeArtifactFilename(input.filename || fallbackName) || fallbackName
  const extension = extname(safeName) || EXTENSION_BY_MIME[mediaType] || '.bin'
  const filename = extname(safeName) ? safeName : `${safeName}${extension}`
  const target = await createArtifactTarget(filename)

  await writeFile(target.path, Buffer.from(input.base64, 'base64'), {
    mode: 0o600
  })

  const artifact = await registerArtifact(
    target.id,
    target.path,
    filename,
    mediaType
  )

  return {
    ...artifact,
    kind: mediaType.startsWith('image/') ? 'image' : 'file'
  }
}

/** 统计内部 AI 产物目录中的文件数量和总大小。 */
export const getAiArtifactStats = async (): Promise<AiArtifactStats> => {
  const root = getArtifactsRoot()
  let entries

  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { count: 0, bytes: 0 }
    }

    throw error
  }

  let count = 0
  let bytes = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const directory = join(root, entry.name)
    const files = await readdir(directory, { withFileTypes: true }).catch(() => [])

    for (const file of files) {
      if (!file.isFile()) continue

      const fileStat = await stat(join(directory, file.name)).catch(() => null)

      if (!fileStat) continue

      count += 1
      bytes += fileStat.size
    }
  }

  return { count, bytes }
}

/**
 * 清空应用内部 AI 产物。
 * 只删除未下载的临时文件，已经保存到用户本机的文件不受影响。
 */
export const clearAiArtifacts = async (): Promise<AiArtifactStats> => {
  const stats = await getAiArtifactStats()

  await rm(getArtifactsRoot(), { recursive: true, force: true })
  artifacts.clear()

  return stats
}

/**
 * 用户点击产物后，通过保存对话框选择本机路径，再登记到统一下载管理。
 */
export const downloadArtifact = async (
  window: BrowserWindow | null,
  id: string
): Promise<{ path: string; downloadId: string } | null> => {
  const record = artifacts.get(id)

  if (!record) throw new Error('AI 产物不存在或已过期')

  const options = {
    title: '保存 AI 产物',
    defaultPath: join(app.getPath('downloads'), record.filename)
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) return null

  const download = createGeneratedDownload({
    filename: basename(result.filePath),
    path: result.filePath,
    size: record.size,
    source: `ai-artifact://${id}`
  })

  try {
    let receivedBytes = 0
    const tracker = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length
        download.update(receivedBytes)
        callback(null, chunk)
      }
    })

    await pipeline(
      createReadStream(record.path),
      tracker,
      createWriteStream(result.filePath)
    )
    download.complete(result.filePath)
  } catch (error) {
    download.fail()
    await rm(result.filePath, { force: true }).catch(() => undefined)
    throw error
  }

  return {
    path: result.filePath,
    downloadId: download.id
  }
}

/** 注册 AI 产物下载 IPC。 */
export const initializeAiArtifacts = (): void => {
  ipcMain.handle('ai:artifact:download', async (event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('AI 产物 ID 不合法')
    }

    return downloadArtifact(BrowserWindow.fromWebContents(event.sender), id)
  })
  ipcMain.handle('ai:artifacts:stats', () => getAiArtifactStats())
  ipcMain.handle('ai:artifacts:clear', () => clearAiArtifacts())
}
