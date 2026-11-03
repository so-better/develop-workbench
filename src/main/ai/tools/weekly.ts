import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import { getWeeklyWorkContext } from '../../weekly-work'

/**
 * 周报数据工具。
 * 一次返回本周需求、已解决缺陷和代码提交，避免模型逐项调用 CLI。
 */
export const weeklyTools: ToolSet = {
  getWeeklyWorkItems: tool({
    description:
      '读取当前用户本周的 Meegle 需求、本地临时需求、已解决缺陷和代码提交，一次返回精简上下文。生成周报时优先使用此工具，不要逐个需求调用 executeShell。必须检查 warnings：数据源读取失败表示数据缺失，不能据此断言本周没有相关工作，应在输出中说明缺失来源。',
    metadata: { label: '读取本周需求、缺陷和提交' },
    inputSchema: z.object({}),
    execute: async () => getWeeklyWorkContext()
  })
}
