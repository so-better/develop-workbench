import { app, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiConfigDocument } from '../types/ai-config'

/**
 * 默认 AI 配置示例。
 * 保留空密钥和空模型，避免用户未经修改就保存无效凭据。
 */
const DEFAULT_CONFIG = `${JSON.stringify(
  {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: ''
  },
  null,
  2
)}\n`

/**
 * AI 配置文件路径。
 * 存放于 Electron userData 目录，属于应用内部配置，不依赖项目目录。
 */
const getAiConfigPath = (): string => join(app.getPath('userData'), 'ai-config.json')

/**
 * 规范化 JSON 文本，统一缩进并保留末尾换行。
 * JSON 无效时抛出异常，由调用方转换为界面提示。
 */
const normalizeJson = (content: string): string => {
  const parsed: unknown = JSON.parse(content)
  return `${JSON.stringify(parsed, null, 2)}\n`
}

/**
 * 判断是否为空 JSON 对象。
 * 兼容此前默认生成的 `{}`，让用户能直接看到配置示例。
 */
const isEmptyObject = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 0

/**
 * 读取 AI 配置文件。
 * 文件不存在或为空时使用默认示例；内容不是合法 JSON 时原样返回，方便用户修正。
 */
export const readAiConfig = async (): Promise<AiConfigDocument> => {
  const path = getAiConfigPath()

  try {
    const raw = await readFile(path, 'utf8')

    if (!raw.trim()) {
      await writeFile(path, DEFAULT_CONFIG, 'utf8')

      return {
        path,
        content: DEFAULT_CONFIG
      }
    }

    try {
      const parsed: unknown = JSON.parse(raw)

      return {
        path,
        content: isEmptyObject(parsed) ? DEFAULT_CONFIG : `${JSON.stringify(parsed, null, 2)}\n`
      }
    } catch {
      return {
        path,
        content: raw
      }
    }
  } catch {
    await writeFile(path, DEFAULT_CONFIG, 'utf8')

    return {
      path,
      content: DEFAULT_CONFIG
    }
  }
}

/**
 * 校验并写入 AI 配置文件。
 * 仅接受合法 JSON，写入前统一格式化。
 */
export const writeAiConfig = async (content: string): Promise<AiConfigDocument> => {
  const path = getAiConfigPath()
  let normalized: string

  try {
    normalized = normalizeJson(content)
  } catch {
    throw new Error('模型配置不是有效的 JSON')
  }

  await writeFile(path, normalized, 'utf8')

  return {
    path,
    content: normalized
  }
}

/**
 * 注册 AI 配置相关 IPC。
 * 配置路径由主进程固定，渲染进程只能提交 JSON 内容。
 */
export const initializeAiConfig = (): void => {
  ipcMain.handle('ai-config:read', () => readAiConfig())
  ipcMain.handle('ai-config:write', (_event, content: unknown) => {
    if (typeof content !== 'string') {
      throw new Error('Invalid AI config content')
    }

    return writeAiConfig(content)
  })
}
