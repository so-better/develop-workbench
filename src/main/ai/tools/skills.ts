import type { ToolSet } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'
import { readSkill, searchSkills } from '../skills'

/**
 * 技能工具。
 * 模型先检索技能，再按名称读取正文；metadata 用于界面分类和展示。
 */
export const skillTools: ToolSet = {
  searchSkills: tool({
    description:
      '检索内置技能。需要编码规范、写作、图表、文件生成、翻译或 SQL 规范时先检索。',
    metadata: { label: '检索技能' },
    inputSchema: z.object({
      query: z.string().describe('检索关键词，例如 coding、写作、图表、文件')
    }),
    execute: async ({ query }) => ({
      results: searchSkills(query)
    })
  }),
  readSkill: tool({
    description: '读取指定技能的完整正文。先使用 searchSkills 确认技能名。',
    metadata: { label: '读取技能' },
    inputSchema: z.object({
      name: z.string().describe('技能名，例如 coding、writing、data-viz')
    }),
    execute: async ({ name }) => {
      const content = readSkill(name)

      if (!content) {
        return {
          ok: false,
          error: `技能「${name}」不存在`
        }
      }

      return {
        ok: true,
        name,
        content
      }
    }
  })
}
