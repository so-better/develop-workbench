import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import systemPrompt from './system-prompt.md?raw'

interface SystemPromptOptions {
  searchAvailable?: boolean
  larkCliPath?: string | null
  meegleCliPath?: string | null
}

/**
 * 内置系统提示词。
 * 通过 Vite 的 raw 导入内联到主进程，避免打包后运行时路径问题。
 * 当前时间和联网状态由主进程在每次请求时动态注入。
 */
export const getSystemPrompt = ({
  searchAvailable = true,
  larkCliPath = null,
  meegleCliPath = null
}: SystemPromptOptions = {}): string => {
  const now = new Date()
  const platform = process.platform
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const current = dayjs(now).locale('zh-cn')
  const date = current.format('YYYY-MM-DD')
  const time = current.format('YYYY-MM-DD HH:mm:ss dddd')

  const platformName =
    platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform
  const cliStatus = [
    `- 操作系统：${platformName}`,
    `- lark-cli：${larkCliPath ? `\`${larkCliPath}\`` : '未检测到'}`,
    `- meegle：${meegleCliPath ? `\`${meegleCliPath}\`` : '未检测到'}`
  ].join('\n')
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
- 涉及日期、时区或相对时间时以此为准；无法确定用户时区时先确认。

## 本地环境

${cliStatus}
- 执行 lark-cli / meegle 时优先使用上面的绝对路径；路径为空时先自行探测。${searchStatus}`
}
