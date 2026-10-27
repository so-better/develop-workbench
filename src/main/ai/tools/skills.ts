import type { ToolSet } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'
import { readSkill, readSkillFile, runSkillScript, searchSkills } from '../skills'

/**
 * 技能工具。
 * 模型先检索技能，再按名称读取正文；需要脚本或参考文件时再按路径读取。
 */
export const skillTools: ToolSet = {
  searchSkills: tool({
    description:
      '检索应用 skills 目录中的技能。需要编码规范、写作、图表、文件生成、翻译、SQL 或需求分析时先检索。',
    metadata: { label: '检索技能' },
    inputSchema: z.object({
      query: z.string().describe('检索关键词，例如 coding、写作、图表、需求分析')
    }),
    execute: async ({ query }) => ({
      results: await searchSkills(query)
    })
  }),
  readSkill: tool({
    description:
      '读取指定技能的 SKILL.md 正文。先使用 searchSkills 确认技能名。会同时返回技能目录和可读取文件列表。',
    metadata: { label: '读取技能' },
    inputSchema: z.object({
      name: z.string().describe('技能名，例如 coding、requirement-analysis')
    }),
    execute: async ({ name }) => {
      const skill = await readSkill(name)

      if (!skill) {
        return {
          ok: false,
          error: `技能「${name}」不存在`
        }
      }

      return {
        ok: true,
        ...skill
      }
    }
  }),
  readSkillFile: tool({
    description:
      '读取应用技能目录内的参考文件、脚本或模板。先使用 readSkill，从返回的 files 中选择路径。只能读取该技能目录内的文件。',
    metadata: { label: '读取技能文件' },
    inputSchema: z.object({
      name: z.string().describe('技能名'),
      path: z
        .string()
        .describe('相对于技能目录的文件路径，例如 reference.md 或 scripts/analyze.mjs')
    }),
    execute: async ({ name, path }) => {
      try {
        const skill = await readSkill(name)

        if (!skill) {
          return { ok: false, error: `技能「${name}」不存在` }
        }

        const result = await readSkillFile(skill.name, path)

        return {
          ok: true,
          ...result
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '读取技能文件失败'
        }
      }
    }
  }),
  runSkillScript: tool({
    description:
      '在技能目录内执行脚本。先使用 readSkill 获取 files，path 必须来自其中的脚本文件。仅在用户要求或技能流程明确需要时调用。',
    metadata: { label: '执行技能脚本' },
    inputSchema: z.object({
      name: z.string().describe('技能名'),
      path: z
        .string()
        .describe('相对于技能目录的脚本路径，例如 scripts/analyze.mjs'),
      args: z.array(z.string()).describe('传给脚本的参数列表，没有参数时传空数组')
    }),
    execute: async ({ name, path, args }) => {
      try {
        const skill = await readSkill(name)

        if (!skill) {
          return { ok: false, error: `技能「${name}」不存在` }
        }

        const result = await runSkillScript(skill.name, path, args)

        return {
          ok: result.code === 0,
          ...result
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '执行技能脚本失败'
        }
      }
    }
  })
}
