import type { ToolSet } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'
import { getRequirementBindingState } from '../../requirement-bindings'
import { getRequirementDetail } from '../../requirement-detail'
import { getRepositoryState } from '../../repositories'

/**
 * 需求相关工具。
 * 一次读取完整 Story，避免模型反复用 CLI 查询字段和角色。
 */
export const requirementTools: ToolSet = {
  /** 读取关联需求的绑定仓库，供缺陷/需求 AI 分析继续读取分支代码。 */
  getRequirementRepositoryBindings: tool({
    description:
      '读取指定需求已绑定的代码仓库和分支，返回仓库名称、本地路径、普通开发分支、轻舟需求分支和迭代分支。需要结合需求分析代码时先调用此工具，再把仓库 path 和 branch 传给 getRepositoryContext。',
    metadata: { label: '读取需求绑定仓库' },
    inputSchema: z.object({
      storyId: z.string().describe('飞书需求 Story ID')
    }),
    execute: async ({ storyId }) => {
      if (!/^\d+$/.test(storyId)) {
        return { ok: false, error: '需求 ID 不合法' }
      }

      try {
        const [bindingState, repositoryState] = await Promise.all([
          getRequirementBindingState(storyId),
          getRepositoryState()
        ])
        const repositoryMap = new Map(
          repositoryState.repositories.map((repository) => [
            repository.id,
            repository
          ])
        )

        return {
          ok: true,
          projectKey: bindingState.projectKey,
          bindings: bindingState.bindings.map((binding) => {
            const repository = repositoryMap.get(binding.repositoryId)
            const branch =
              binding.mode === 'qingzhou'
                ? binding.requirementBranch
                : binding.branchName

            return {
              repositoryId: binding.repositoryId,
              repositoryName: repository?.name ?? '仓库已移除',
              repositoryPath: repository?.localPath ?? null,
              repositoryAvailable: repository?.available ?? false,
              mode: binding.mode,
              branch,
              requirementBranch: binding.requirementBranch,
              iterationBranch: binding.iterationBranch
            }
          })
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '读取需求绑定仓库失败'
        }
      }
    }
  }),
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
