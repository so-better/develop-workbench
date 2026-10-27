import type { ToolSet } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'
import { getRequirementDetail } from '../../requirement-detail'

/**
 * 需求相关工具。
 * 一次读取完整 Story，避免模型反复用 CLI 查询字段和角色。
 */
export const requirementTools: ToolSet = {
  getRequirementDetail: tool({
    description:
      '根据飞书 Story ID 或 Story 链接一次性读取需求详情，包括标题、状态、优先级、类型、创建/更新时间、当前节点、角色成员、需求描述、需求文档链接和全部非空字段。读取需求时优先使用此工具，不要再用 executeShell 重复查询 Story。',
    metadata: { label: '读取需求详情' },
    inputSchema: z.object({
      story: z
        .string()
        .describe('Story ID 或 project.feishu.cn 的 Story 链接')
    }),
    execute: async ({ story }) => {
      try {
        return {
          ok: true,
          requirement: await getRequirementDetail(story)
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '读取需求详情失败'
        }
      }
    }
  })
}
