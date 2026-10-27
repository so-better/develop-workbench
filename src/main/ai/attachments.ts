import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { AiChatAttachment } from '../../types/ai'
import { isRecord } from '../../utils'

/** 单次最多附件数。 */
const MAX_ATTACHMENTS = 6
/** 单个文件大小上限。 */
const MAX_FILE_BYTES = 25 * 1024 * 1024
/** 图片大小上限，避免 base64 请求体过大。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** 文档抽取文本上限。 */
const MAX_DOCUMENT_TEXT = 80_000

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

const DOCUMENT_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.html': 'text/html'
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/csv': '.csv',
  'text/markdown': '.md',
  'text/html': '.html',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
}

const SUPPORTED_EXTENSIONS = new Set([
  ...Object.keys(IMAGE_MIME_TYPES),
  ...Object.keys(DOCUMENT_MIME_TYPES)
])

const FILE_FILTERS = [
  {
    name: '图片和文档',
    extensions: [...SUPPORTED_EXTENSIONS].map((extension) => extension.slice(1))
  }
]

type OfficeFileType = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'csv' | 'md' | 'html'

/** officeparser 在 Buffer 输入时需要显式 fileType。 */
const toOfficeFileType = (extension: string): OfficeFileType | null => {
  const mapping: Record<string, OfficeFileType> = {
    '.pdf': 'pdf',
    '.docx': 'docx',
    '.xlsx': 'xlsx',
    '.pptx': 'pptx',
    '.csv': 'csv',
    '.md': 'md',
    '.html': 'html'
  }

  return mapping[extension] ?? null
}

const extractDocumentText = async (
  buffer: Buffer,
  extension: string
): Promise<string> => {
  const fileType = toOfficeFileType(extension)

  if (!fileType) throw new Error(`暂不支持解析 ${extension} 文件`)

  const { parseOffice } = await import('officeparser')
  const ast = await parseOffice(buffer, {
    fileType,
    extractAttachments: false,
    includeRawContent: false,
    ocr: false,
    allowRemoteAssets: false
  })
  const result = await ast.to('text')
  const text = typeof result.value === 'string'
    ? result.value
    : new TextDecoder().decode(result.value)

  return text.trim().slice(0, MAX_DOCUMENT_TEXT)
}

/**
 * 打开系统文件选择器并解析附件。
 * 图片返回 data URL，文档返回抽取后的文本，供当前轮请求使用。
 */
export const pickAiAttachments = async (
  window: BrowserWindow | null
): Promise<AiChatAttachment[]> => {
  const options: OpenDialogOptions = {
    title: '选择 AI 附件',
    properties: ['openFile', 'multiSelections', 'showHiddenFiles'],
    filters: FILE_FILTERS
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled) return []

  const paths = result.filePaths.slice(0, MAX_ATTACHMENTS)
  const attachments: AiChatAttachment[] = []

  for (const path of paths) {
    const extension = extname(path).toLowerCase()
    const mimeType =
      IMAGE_MIME_TYPES[extension] ?? DOCUMENT_MIME_TYPES[extension]

    if (!mimeType) throw new Error(`不支持的文件类型：${extension || '无扩展名'}`)

    const fileStat = await stat(path)

    if (fileStat.size > MAX_FILE_BYTES) {
      throw new Error(`附件「${basename(path)}」超过 25MB 限制`)
    }

    const id = randomUUID()
    const name = basename(path)
    const size = fileStat.size
    const buffer = await readFile(path)

    if (extension in IMAGE_MIME_TYPES) {
      if (size > MAX_IMAGE_BYTES) {
        throw new Error(`图片「${name}」超过 10MB 限制`)
      }

      attachments.push({
        id,
        name,
        mimeType,
        kind: 'image',
        size,
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`
      })
    } else {
      attachments.push({
        id,
        name,
        mimeType,
        kind: 'file',
        size,
        text: await extractDocumentText(buffer, extension)
      })
    }
  }

  return attachments
}

const toFileBuffer = (value: unknown): Buffer | null => {
  if (value instanceof ArrayBuffer) return Buffer.from(value)

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }

  return null
}

/**
 * 解析渲染进程粘贴的文件内容。
 * 图片转为 data URL，文档抽取文本后作为当前轮附件。
 */
export const parseAiAttachmentFiles = async (
  rawFiles: unknown
): Promise<AiChatAttachment[]> => {
  if (!Array.isArray(rawFiles)) throw new Error('粘贴文件参数不合法')

  const attachments: AiChatAttachment[] = []

  for (const value of rawFiles.slice(0, MAX_ATTACHMENTS)) {
    if (!isRecord(value)) throw new Error('粘贴文件参数不合法')

    const providedName = typeof value.name === 'string' ? value.name : ''
    const providedMime = typeof value.mimeType === 'string' ? value.mimeType : ''
    const extension =
      extname(providedName).toLowerCase() ||
      EXTENSION_BY_MIME[providedMime] ||
      ''
    const mimeType =
      IMAGE_MIME_TYPES[extension] ??
      DOCUMENT_MIME_TYPES[extension] ??
      providedMime
    const name = providedName || `粘贴附件-${Date.now()}${extension}`
    const buffer = toFileBuffer(value.data)

    if (!name || !mimeType || !buffer) {
      throw new Error('粘贴文件缺少必要信息')
    }
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error(`不支持的文件类型：${extension || '无扩展名'}`)
    }
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new Error(`附件「${name}」超过 25MB 限制`)
    }

    const id = randomUUID()
    const size = buffer.byteLength

    if (extension in IMAGE_MIME_TYPES) {
      if (size > MAX_IMAGE_BYTES) {
        throw new Error(`图片「${name}」超过 10MB 限制`)
      }

      attachments.push({
        id,
        name,
        mimeType,
        kind: 'image',
        size,
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`
      })
    } else {
      attachments.push({
        id,
        name,
        mimeType,
        kind: 'file',
        size,
        text: await extractDocumentText(buffer, extension)
      })
    }
  }

  return attachments
}

/**
 * 注册附件选择 IPC。
 */
export const initializeAiAttachments = (): void => {
  ipcMain.handle('ai:attachments:pick', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return pickAiAttachments(window)
  })

  ipcMain.handle('ai:attachments:parse', (_event, files: unknown) =>
    parseAiAttachmentFiles(files)
  )
}
