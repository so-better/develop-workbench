import type { RequirementRepoBinding } from '../../../../types/bindings'
import type { Repository } from '../../../../types/repository'
import type { MeegleRequirement } from '../../../../types/requirements'

/**
 * 构建 AI 需求分析提示词。
 */
export const buildRequirementAnalysisPrompt = (
  requirement: MeegleRequirement,
  isLocal: boolean,
  requirementUrl: string | null,
  bindings: RequirementRepoBinding[],
  repositoryMap: Map<string, Repository>
): string => {
  const repositoryLines = bindings.map((binding) => {
    const repository = repositoryMap.get(binding.repositoryId)

    if (!repository) return `- ${binding.repositoryId}（仓库信息不可用）`

    const requirementBranch =
      binding.mode === 'qingzhou' ? binding.requirementBranch : binding.branchName
    const details = [
      `路径：${repository.localPath}`,
      `当前分支：${repository.currentBranch ?? '未知'}`
    ]

    if (requirementBranch && requirementBranch !== repository.currentBranch) {
      details.push(`需求分支：${requirementBranch}`)
    }
    if (!repository.available) details.push('本地仓库不可用')

    return `- ${repository.name}：${details.join('；')}`
  })

  return [
    isLocal
      ? '请分析下面这个本地临时需求。'
      : '请分析下面这个飞书需求。',
    '',
    ...(isLocal
      ? [
          `需求名称：${requirement.name}`,
          `所属版本：${requirement.iterationName ?? '未规划版本'}`,
          `状态：${requirement.status ?? '未知'}`,
          `优先级：${requirement.priority ?? '未设置'}`,
          `需求描述：${requirement.description?.trim() || '暂无描述'}`,
          '',
          '该需求只保存在本机，不在 Meegle 中，不要调用 getRequirementDetail 工具。'
        ]
      : [
          `Story ID：${requirement.id}`,
          `Story 链接：${requirementUrl ?? '暂无'}`,
          '',
          '请优先使用 getRequirementDetail 工具通过 Story ID 读取需求详情，再读取相关需求文档和后端文档，结合绑定的本地仓库代码输出分析报告。'
        ]),
    '',
    '已绑定的代码仓库：',
    ...(repositoryLines.length > 0 ? repositoryLines : ['- 暂无可用仓库']),
    '',
    '分析目标：',
    '- 不要只复述需求，要告诉开发者这次需求到底要做什么、解决什么问题。',
    '- 分析结果要能直接指导开发，不要输出泛泛而谈的项目背景。',
    '- 区分事实和推断：需求、文档或代码中明确的写“已确认”，根据上下文推断的写“推断”。',
    '',
    '请按以下结构输出：',
    '1. 一句话结论：本次需求最终要交付什么。',
    '2. 要解决的问题：当前业务/用户/系统存在什么问题，为什么需要这次改动。',
    '3. 需求目标与范围：明确做什么、不做什么，以及可验证的验收标准。',
    '4. 前端需要做什么：页面、组件、交互、状态管理、接口调用、表单校验、异常处理、兼容性；没有前端改动时明确说明。',
    '5. 后端需要做什么：接口、入参出参、数据模型、业务规则、存储、权限、异步任务、兼容和数据迁移；没有后端改动时明确说明。',
    '6. 前后端协作：接口约定、字段含义、调用时序、联调点和需要双方确认的事项。',
    '7. 影响范围与风险：现有功能、数据、权限、性能、历史数据、发布顺序和回滚风险。',
    '8. 开发任务清单：按前端、后端、联调、测试分组，每项写成可执行动作。',
    '9. 测试与验收：核心用例、边界条件、异常场景和回归范围。',
    '10. 待确认问题：只列真正影响实现或验收的问题。',
    '',
    '代码分析流程：',
    '- 先调用 getRepositoryContext，把绑定仓库作为 repositories 传入，每项包含 path 和需求分支 branch；一次性传入需求关键词，获取目录、命中文件和近期提交。',
    '- 需要查看具体实现时，用 readRepositoryFiles 批量读取命中的文件，分支内容同时传 branch，一次最多 8 个，不要逐个 cat。',
    '- 如果返回 truncated=true，说明单文件超过 64KB，使用同一个 path、branch 和 nextOffset 继续读取剩余部分。',
    '- 如果返回 branchWarning，说明指定分支不存在并已回退当前分支，分析时要明确说明。',
    '- 只有这两个工具无法覆盖时（例如读取非当前分支），才使用 executeShell；调用次数尽量不超过 2 次，并合并成一条命令。',
    '- 不要为每个目录、文件或提交单独调用 executeShell。',
    '',
    '代码分析要求：',
    '- 需要读取非当前分支时使用 `git show <branch>:<path>`，不要切换分支。',
    '- 只读取和分析代码，不修改代码、不提交。',
    '- 尽量定位到具体模块、接口、文件或数据结构；无法定位时说明需要进一步确认。',
    '- 当前分支与需求分支不一致时，在报告中说明可能影响。',
    '- 没有可用仓库或无法读取代码时，明确说明缺少代码上下文，不要猜测实现。',
    '',
    '输出要求：',
    '- 使用 Markdown，简洁、具体、可执行，不写“赋能、闭环、抓手、持续推进”等空话。',
    '- 需求未明确、代码中也没有依据的内容不要编造，放入“待确认问题”。',
    '- 本次只输出需求实施分析报告。'
  ].join('\n')
}
