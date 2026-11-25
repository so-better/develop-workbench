/**
 * 应用内反馈。
 * 通过 Lark CLI 机器人发送到团队反馈群，支持卡片排版和图片。
 */
import { app, ipcMain } from 'electron'
import os from 'node:os'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runLarkCli } from './lark'
import type {
  FeedbackDiagnostic,
  FeedbackImageInput,
  FeedbackSendResult,
  FeedbackSubmission,
  FeedbackSystemInfo
} from '../types/feedback'

const FEEDBACK_CHAT_ID = 'oc_276d5d5de90806aa97e8c3648b9a5d6b'
const MAX_DESCRIPTION_LENGTH = 3_000
const MAX_DIAGNOSTICS = 40
const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/=\s]+)$/i

interface PreparedImage {
  fileName: string
  buffer: Buffer
}

interface FeishuCard {
  config: { wide_screen_mode: boolean }
  header: {
    template: string
    title: { tag: 'plain_text'; content: string }
  }
  elements: Array<Record<string, unknown>>
}

const prepareImages = (value: unknown): PreparedImage[] => {
  if (!Array.isArray(value)) return []

  return value.slice(0, MAX_IMAGES).map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error('反馈图片格式不正确')
    }

    const image = item as Partial<FeedbackImageInput>
    const match =
      typeof image.dataUrl === 'string'
        ? IMAGE_DATA_URL_PATTERN.exec(image.dataUrl)
        : null

    if (!match) throw new Error('反馈图片格式不正确')

    const extension = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase()
    const buffer = Buffer.from(match[2], 'base64')

    if (buffer.length === 0) throw new Error('反馈图片为空')
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('单张反馈图片不能超过 5MB')

    const baseName =
      typeof image.name === 'string' && image.name.trim()
        ? image.name.replace(/[^\w.-]+/g, '-').slice(0, 40)
        : `feedback-${index + 1}`

    return {
      fileName: `${baseName}.${extension}`,
      buffer
    }
  })
}

const normalizeDiagnostics = (value: unknown): FeedbackDiagnostic[] => {
  if (!Array.isArray(value)) return []

  return value
    .slice(0, MAX_DIAGNOSTICS)
    .map((item) => {
      if (!item || typeof item !== 'object') return null

      const diagnostic = item as Partial<FeedbackDiagnostic>
      const label = typeof diagnostic.label === 'string' ? diagnostic.label.trim() : ''
      const detail = typeof diagnostic.value === 'string' ? diagnostic.value.trim() : ''

      return label && detail ? { label: label.slice(0, 40), value: detail.slice(0, 500) } : null
    })
    .filter((item): item is FeedbackDiagnostic => Boolean(item))
}

const escapeLarkMarkdown = (value: string): string =>
  value.replace(/([*_~[\]()])/g, '\\$1')

const prettifyPlatform = (value: string): string =>
  value
    .replace(/^darwin/i, 'macOS')
    .replace(/^win32/i, 'Windows')

const buildCard = (
  submitter: string,
  description: string,
  diagnostics: FeedbackDiagnostic[],
  imageCount: number
): FeishuCard => {
  const values = new Map(diagnostics.map((item) => [item.label, item.value]))
  const getValue = (label: string): string => values.get(label) ?? '未知'
  const fields = [
    ['版本', getValue('版本')],
    ['平台', prettifyPlatform(getValue('平台'))],
    ['系统', getValue('系统')],
    ['CPU', getValue('CPU')],
    ['内存', getValue('内存')],
    ['语言', getValue('语言')],
    ['时区', getValue('时区')],
    ['屏幕', getValue('屏幕')]
  ].map(([label, value]) => ({
    is_short: true,
    text: {
      tag: 'lark_md',
      content: `**${label}**：${escapeLarkMarkdown(value)}`
    }
  }))

  const toolFields = ['Lark CLI', 'Meegle CLI', 'Git', 'IDE', 'ADB'].map(
    (label) => ({
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**${label}**：${escapeLarkMarkdown(getValue(label))}`
      }
    })
  )

  const elements: Array<Record<string, unknown>> = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: '**问题描述**'
      }
    },
    {
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: description
      }
    },
    { tag: 'hr' },
    { tag: 'div', fields },
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: '**工具状态**'
      }
    },
    { tag: 'div', fields: toolFields }
  ]

  if (imageCount > 0) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: `图片：${imageCount} 张（见后续消息）`
      }
    })
  }

  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: `来自 AI 研发工作台 · ${getValue('时间')}`
      }
    ]
  })

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: `${submitter} 提交的反馈` }
    },
    elements
  }
}

const sendToFeedbackChat = async (args: string[], cwd?: string): Promise<void> => {
  try {
    await runLarkCli(
      ['im', '+messages-send', '--as', 'bot', '--chat-id', FEEDBACK_CHAT_ID, ...args],
      { cwd, timeoutMs: 30_000 }
    )
  } catch {
    throw new Error('发送反馈失败，请确认反馈机器人已加入反馈群并有发消息权限')
  }
}

const buildPlainText = (
  submitter: string,
  description: string,
  diagnostics: FeedbackDiagnostic[],
  imageCount: number
): string =>
  [
    `${submitter} 提交的反馈`,
    '',
    ...diagnostics.map((item) => `${item.label}：${item.value}`),
    '',
    '问题描述：',
    description,
    ...(imageCount > 0 ? ['', `图片：${imageCount} 张（见后续消息）`] : [])
  ].join('\n')

/**
 * 把反馈内容发送到团队飞书群。
 */
export const sendFeedback = async (
  value: unknown
): Promise<FeedbackSendResult> => {
  if (!value || typeof value !== 'object') {
    throw new Error('反馈内容不能为空')
  }

  const submission = value as Partial<FeedbackSubmission>
  const submitter =
    typeof submission.submitter === 'string' && submission.submitter.trim()
      ? submission.submitter.trim().slice(0, 40)
      : '当前用户'
  const description =
    typeof submission.description === 'string'
      ? submission.description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
      : ''

  if (!description) throw new Error('反馈内容不能为空')

  const diagnostics = normalizeDiagnostics(submission.diagnostics)
  const images = prepareImages(submission.images)
  const card = buildCard(submitter, description, diagnostics, images.length)

  try {
    await sendToFeedbackChat([
      '--msg-type',
      'interactive',
      '--content',
      JSON.stringify(card)
    ])
  } catch {
    await sendToFeedbackChat([
      '--text',
      buildPlainText(submitter, description, diagnostics, images.length)
    ])
  }

  if (images.length === 0) {
    return { sentImages: 0, failedImages: 0 }
  }

  const directory = join(app.getPath('temp'), `develop-workbench-feedback-${Date.now()}`)
  let sentImages = 0
  let failedImages = 0

  try {
    await mkdir(directory, { recursive: true })

    for (const image of images) {
      try {
        await writeFile(join(directory, image.fileName), image.buffer)
        await sendToFeedbackChat(['--image', image.fileName], directory)
        sentImages += 1
      } catch {
        failedImages += 1
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }

  return { sentImages, failedImages }
}

const getFeedbackSystemInfo = (): FeedbackSystemInfo => {
  const cpus = os.cpus()

  return {
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    cpuModel: cpus[0]?.model ?? '未知',
    cpuCount: cpus.length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem()
  }
}

/**
 * 注册反馈相关 IPC。
 */
export const initializeFeedback = (): void => {
  ipcMain.handle('feedback:send', (_event, submission: unknown) =>
    sendFeedback(submission)
  )
  ipcMain.handle('feedback:get-system-info', () => getFeedbackSystemInfo())
}
