import systemPrompt from './system-prompt.md?raw'

interface SystemPromptOptions {
  now?: Date
  searchAvailable?: boolean
}

/**
 * 内置系统提示词。
 * 通过 Vite 的 raw 导入内联到主进程，避免打包后运行时路径问题。
 * 当前时间和联网状态由主进程在每次请求时动态注入。
 */
export const getSystemPrompt = ({
  now = new Date(),
  searchAvailable = true
}: SystemPromptOptions = {}): string => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const date = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
  const time = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'full',
    timeStyle: 'long',
    hour12: false
  }).format(now)

  const searchStatus = searchAvailable
    ? ''
    : `

## 联网状态

- 本次对话的 AnySearch MCP 不可用。
- 不得编造外部信息、链接或来源；需要实时信息时告知用户当前无法联网。`

  return `${systemPrompt.trim()}

## 当前时间

- 当前日期：${date}
- 当前本地时间：${time}
- 时区：${timeZone}
- 涉及日期、时区或相对时间时以此为准；无法确定用户时区时先确认。${searchStatus}`
}
