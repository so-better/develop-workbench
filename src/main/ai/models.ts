import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { AiConfig } from '../../types/ai'
import { loadAiConfig } from './config'

/** 这些字段由聊天服务控制，不允许被模型 options 覆盖。 */
const PROTECTED_REQUEST_KEYS = new Set([
  'model',
  'messages',
  'stream',
  'tools',
  'tool_choice',
  'input'
])

/** 模型 options 只能补充请求参数，不能改写聊天核心字段。 */
const getSafeOptions = (
  options: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(options).filter(([key]) => !PROTECTED_REQUEST_KEYS.has(key))
  )

/** 解析后的模型及其配置。 */
export interface ResolvedAiModel {
  config: AiConfig
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>
}

/** 在调用前完成必要配置校验。 */
const validateConfig = (config: AiConfig): void => {
  if (!config.baseUrl.trim()) throw new Error('模型配置缺少 baseUrl')
  if (!config.model.trim()) throw new Error('模型配置缺少模型名')
  if (!config.apiKey.trim()) throw new Error('模型配置缺少 API Key')
}

/**
 * 按单模型配置创建 OpenAI Chat Completions 模型。
 *
 * 模型 options 通过 transformRequestBody 合并到请求体，
 * 因此 DeepSeek 的 thinking / reasoning_effort 等厂商参数不需要进入核心调用层。
 */
export const resolveAiModel = async (): Promise<ResolvedAiModel> => {
  const config = await loadAiConfig()

  validateConfig(config)

  const provider = createOpenAICompatible({
    name: config.name || config.model,
    baseURL: config.baseUrl,
    headers: config.headers,
    includeUsage: true,
    // 在 SDK 组装好标准请求后追加厂商参数，例如 DeepSeek thinking。
    transformRequestBody: (args: Record<string, unknown>) => ({
      ...args,
      ...getSafeOptions(config.options)
    }),
    ...(config.apiKey ? { apiKey: config.apiKey } : {})
  })

  return {
    config,
    model: provider(config.model)
  }
}
