import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import { getWeeklyWorkItems } from '../../requirements'

/**
 * 周报数据工具。
 * 一次返回本周更新/完成的需求，避免模型逐条调用 CLI。
 */
export const weeklyTools: ToolSet = {
  getWeeklyWorkItems: tool({
    description:
      '读取当前用户本周在 Meegle 中更新或完成的需求，一次返回精简列表。生成周报时优先使用此工具，不要逐个需求调用 executeShell。',
    metadata: { label: '读取本周工作' },
    inputSchema: z.object({}),
    execute: async () => getWeeklyWorkItems()
  })
}
