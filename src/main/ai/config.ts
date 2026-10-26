import { app, ipcMain } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiConfigDocument } from '../../types/ai-config'
import type { AiConfig, AiConfigStatus } from '../../types/ai'
import { isRecord, normalizeText } from '../../utils'

/**
 * 默认 AI 配置。
 * API Key 和模型名留空，避免用户未修改就使用无效凭据。
 */
const DEFAULT_CONFIG: AiConfig = {
  name: '默认模型',
  model: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  headers: {},
  options: {}
}

/** 配置字段长度上限，避免异常配置把设置页或请求体撑得过大。 */
const MAX_NAME_LENGTH = 80
const MAX_MODEL_LENGTH = 200
const MAX_URL_LENGTH = 2000

/** 配置固定放在 userData，避免写入项目目录或随代码提交。 */
const getAiConfigPath = (): string =>
  join(app.getPath('userData'), 'ai-config.json')

/** 请求头只接受可转成字符串的值，并去掉空键。 */
const normalizeHeaders = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, headerValue]) => Boolean(key.trim()) && headerValue != null)
      .map(([key, headerValue]) => [key.trim(), String(headerValue)])
  )
}

/**
 * 模型 options 会原样合并到请求体。
 * 这里先做一次 JSON 深拷贝，既能去掉 undefined，也能提前发现不可序列化内容。
 */
const normalizeOptions = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) return {}

  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  } catch {
    throw new Error('模型 options 必须是可序列化的 JSON 对象')
  }
}

/** 允许暂时留空，非空时只接受 http/https。 */
const normalizeBaseUrl = (value: unknown): string => {
  const baseUrl = normalizeText(value, MAX_URL_LENGTH)

  if (!baseUrl) return ''

  let parsed: URL

  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('模型 baseUrl 格式不正确')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('模型 baseUrl 只支持 http/https')
  }

  return baseUrl
}

/**
 * 将任意 JSON 规范成单模型配置结构。
 * 未知字段不会写回配置文件，非法结构直接抛错。
 */
const normalizeConfig = (value: unknown): AiConfig => {
  if (!isRecord(value)) throw new Error('模型配置必须是 JSON 对象')

  return {
    name: normalizeText(value.name, MAX_NAME_LENGTH) || '默认模型',
    model: normalizeText(value.model, MAX_MODEL_LENGTH),
    baseUrl:
      value.baseUrl === undefined ? '' : normalizeBaseUrl(value.baseUrl),
    apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : '',
    headers:
      value.headers === undefined ? {} : normalizeHeaders(value.headers),
    options:
      value.options === undefined ? {} : normalizeOptions(value.options)
  }
}

/** 配置文件统一使用两空格缩进，并保留末尾换行。 */
const serializeConfig = (config: AiConfig): string =>
  `${JSON.stringify(config, null, 2)}\n`

/** 原子写入配置，并把权限收窄到当前用户，避免 API Key 被同机其他用户读取。 */
const writeConfig = async (config: AiConfig): Promise<void> => {
  const filePath = getAiConfigPath()
  const temporaryPath = `${filePath}.${Date.now()}.tmp`

  await writeFile(temporaryPath, serializeConfig(config), {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(temporaryPath, filePath)
}

/**
 * 读取并规范化配置文件。
 * 字段不完整时写回规范化结果；非法 JSON 或非法结构原样返回，方便设置页修正。
 */
export const readAiConfig = async (): Promise<AiConfigDocument> => {
  const path = getAiConfigPath()
  let raw: string

  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error

    // 首次启动不预埋无效配置，但需要给设置页一个可编辑的初始模板。
    await writeConfig(DEFAULT_CONFIG)
    return { path, content: serializeConfig(DEFAULT_CONFIG) }
  }

  if (!raw.trim()) {
    await writeConfig(DEFAULT_CONFIG)
    return { path, content: serializeConfig(DEFAULT_CONFIG) }
  }

  try {
    const parsed: unknown = JSON.parse(raw)

    // 空对象等同首次使用，直接展示默认配置。
    if (isRecord(parsed) && Object.keys(parsed).length === 0) {
      await writeConfig(DEFAULT_CONFIG)
      return { path, content: serializeConfig(DEFAULT_CONFIG) }
    }

    const config = normalizeConfig(parsed)
    const content = serializeConfig(config)

    // 字段不完整或格式不一致时写回规范化结果，后续读取逻辑更简单。
    if (content !== raw) await writeConfig(config)

    return { path, content }
  } catch {
    // 设置页需要看到原始内容，才能定位 JSON 或字段错误。
    return { path, content: raw }
  }
}

/**
 * 返回配置是否可调用，不暴露 API Key。
 * 空模板、缺少模型名或 baseUrl 都视为未配置。
 */
export const getAiConfigStatus = async (): Promise<AiConfigStatus> => {
  try {
    const config = await loadAiConfig()

    if (!config.baseUrl.trim()) {
      return { configured: false, message: '尚未配置 AI 接口地址' }
    }
    if (!config.model.trim()) {
      return { configured: false, message: '尚未配置 AI 模型' }
    }
    if (!config.apiKey.trim()) {
      return { configured: false, message: '尚未配置 AI API Key' }
    }

    return { configured: true, message: null }
  } catch (error) {
    return {
      configured: false,
      message: error instanceof Error ? error.message : '读取 AI 配置失败'
    }
  }
}

/**
 * 读取必须合法的配置，供模型调用使用。
 * 与 readAiConfig 不同：这里不返回原文，配置不合法会直接抛错。
 */
export const loadAiConfig = async (): Promise<AiConfig> => {
  const path = getAiConfigPath()
  let raw: string

  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error

    await writeConfig(DEFAULT_CONFIG)
    return DEFAULT_CONFIG
  }

  if (!raw.trim()) {
    await writeConfig(DEFAULT_CONFIG)
    return DEFAULT_CONFIG
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('模型配置不是有效的 JSON')
  }

  return normalizeConfig(parsed)
}

/**
 * 校验并写入 AI 配置。
 * 设置页提交的是原始 JSON 文本，这里统一解析和规范化后再落盘。
 */
export const writeAiConfig = async (content: string): Promise<AiConfigDocument> => {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('模型配置不是有效的 JSON')
  }

  const config = normalizeConfig(parsed)

  await writeConfig(config)

  return {
    path: getAiConfigPath(),
    content: serializeConfig(config)
  }
}

/**
 * 注册 AI 配置相关 IPC。
 * 渲染进程只接触原始 JSON，模型调用在其它模块完成。
 */
export const initializeAiConfig = (): void => {
  ipcMain.handle('ai-config:read', () => readAiConfig())
  ipcMain.handle('ai:config:get-status', () => getAiConfigStatus())
  ipcMain.handle('ai-config:write', (_event, content: unknown) => {
    if (typeof content !== 'string') throw new Error('模型配置内容不合法')
    return writeAiConfig(content)
  })
}
