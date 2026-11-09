import type { RequirementBindingsMap } from '../../../types/bindings'
import type { IterationSummaryRequirement } from '../../../types/requirements'
import type { Repository } from '../../../types/repository'

/** 迭代汇总里的分支类型。 */
export type IterationBranchKind = 'development' | 'requirement' | 'iteration'

/** 某个仓库在迭代中涉及的分支。 */
export interface IterationBranchSummary {
  /** 分支名。 */
  name: string

  /** 该分支在需求绑定中的类型，可能同时属于多种类型。 */
  kinds: IterationBranchKind[]

  /** 关联的需求 ID。 */
  requirementIds: string[]
}

/** 某个仓库在迭代中的汇总信息。 */
export interface IterationRepositorySummary {
  /** 仓库 ID。 */
  repositoryId: string

  /** 仓库名称；已移除时显示固定文案。 */
  name: string

  /** 本地路径；仓库已移除时为空。 */
  localPath: string | null

  /** 本地路径是否存在。 */
  available: boolean

  /** 仓库配置是否已经不存在。 */
  missing: boolean

  /** 涉及的分支列表。 */
  branches: IterationBranchSummary[]
}

/** 一次迭代的仓库汇总结果。 */
export interface IterationRepositoryCollection {
  /** 按仓库聚合后的列表。 */
  repositories: IterationRepositorySummary[]

  /** 至少绑定了一个仓库的需求数。 */
  boundRequirementCount: number

  /** 没有绑定任何仓库的需求。 */
  unboundRequirements: IterationSummaryRequirement[]

  /** 去重后的分支数。 */
  branchCount: number

  /** 配置已经不存在或本地路径不可用的仓库数。 */
  unavailableRepositoryCount: number
}

const BRANCH_KIND_ORDER: IterationBranchKind[] = [
  'development',
  'requirement',
  'iteration'
]

const getKindOrder = (kind: IterationBranchKind): number =>
  BRANCH_KIND_ORDER.indexOf(kind)

interface BranchAccumulator {
  name: string
  kinds: Set<IterationBranchKind>
  requirementIds: Set<string>
}

interface RepositoryAccumulator {
  repository: Repository | null
  repositoryId: string
  branches: Map<string, BranchAccumulator>
}

/** 按迭代分组后的轻量需求。 */
export interface IterationSummaryGroup {
  /** 分组稳定键。 */
  key: string

  /** 迭代 ID；未规划时为空。 */
  iterationId: string | null

  /** 迭代名称；未规划时为「未规划迭代」。 */
  iterationName: string

  /** 从迭代名称解析出的日期。 */
  releaseDate: string | null

  /** 该迭代下的需求。 */
  requirements: IterationSummaryRequirement[]
}

/**
 * 按需求关联的全部迭代分组，未规划需求归入固定分组。
 * 同一需求关联多个迭代时会出现在多个分组中。
 */
export const groupIterationSummaryRequirements = (
  requirements: IterationSummaryRequirement[]
): IterationSummaryGroup[] => {
  const groups = new Map<string, IterationSummaryGroup>()

  const addRequirement = (
    requirement: IterationSummaryRequirement,
    iterationId: string | null,
    iterationName: string,
    releaseDate: string | null
  ): void => {
    const key =
      iterationId ??
      (iterationName === '未规划迭代'
        ? 'unplanned'
        : `name:${iterationName}`)
    const existing = groups.get(key)

    if (existing) {
      existing.requirements.push(requirement)
      return
    }

    groups.set(key, {
      key,
      iterationId,
      iterationName,
      releaseDate,
      requirements: [requirement]
    })
  }

  for (const requirement of requirements) {
    if (requirement.iterations.length === 0) {
      addRequirement(requirement, null, '未规划迭代', null)
      continue
    }

    const seen = new Set<string>()

    for (const iteration of requirement.iterations) {
      const key = iteration.id ?? `name:${iteration.name}`

      if (seen.has(key)) continue

      seen.add(key)
      addRequirement(
        requirement,
        iteration.id,
        iteration.name,
        iteration.date
      )
    }
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (!left.releaseDate && !right.releaseDate) {
      return right.iterationName.localeCompare(left.iterationName, 'zh-CN')
    }

    if (!left.releaseDate) return 1
    if (!right.releaseDate) return -1

    const dateCompare = right.releaseDate.localeCompare(left.releaseDate)

    return dateCompare !== 0
      ? dateCompare
      : right.iterationName.localeCompare(left.iterationName, 'zh-CN')
  })
}

/**
 * 汇总一个迭代内所有需求的仓库和分支。
 * 普通绑定使用开发分支，轻舟绑定同时收集需求分支和迭代分支。
 */
export const buildIterationRepositorySummary = (
  requirements: IterationSummaryRequirement[],
  bindingsByRequirement: RequirementBindingsMap,
  repositories: Repository[]
): IterationRepositoryCollection => {
  const repositoryMap = new Map(
    repositories.map((repository) => [repository.id, repository])
  )
  const repositoriesById = new Map<string, RepositoryAccumulator>()
  const boundRequirementIds = new Set<string>()

  const getRepositoryAccumulator = (
    repositoryId: string
  ): RepositoryAccumulator => {
    const existing = repositoriesById.get(repositoryId)

    if (existing) return existing

    const accumulator: RepositoryAccumulator = {
      repository: repositoryMap.get(repositoryId) ?? null,
      repositoryId,
      branches: new Map()
    }

    repositoriesById.set(repositoryId, accumulator)
    return accumulator
  }

  const addBranch = (
    accumulator: RepositoryAccumulator,
    branchName: string | null,
    kind: IterationBranchKind,
    requirementId: string
  ): void => {
    if (!branchName?.trim()) return

    const name = branchName.trim()
    const existing = accumulator.branches.get(name)

    if (existing) {
      existing.kinds.add(kind)
      existing.requirementIds.add(requirementId)
      return
    }

    accumulator.branches.set(name, {
      name,
      kinds: new Set([kind]),
      requirementIds: new Set([requirementId])
    })
  }

  for (const requirement of requirements) {
    const bindings = bindingsByRequirement[requirement.id] ?? []

    if (bindings.length > 0) boundRequirementIds.add(requirement.id)

    for (const binding of bindings) {
      const accumulator = getRepositoryAccumulator(binding.repositoryId)

      if (binding.mode === 'normal') {
        addBranch(accumulator, binding.branchName, 'development', requirement.id)
      } else {
        addBranch(
          accumulator,
          binding.requirementBranch,
          'requirement',
          requirement.id
        )
        addBranch(
          accumulator,
          binding.iterationBranch,
          'iteration',
          requirement.id
        )
      }
    }
  }

  const summaries: IterationRepositorySummary[] = Array.from(
    repositoriesById.values()
  ).map((accumulator) => {
    const repository = accumulator.repository
    const branches = Array.from(accumulator.branches.values())
      .map((branch) => ({
        name: branch.name,
        kinds: Array.from(branch.kinds).sort(
          (left, right) => getKindOrder(left) - getKindOrder(right)
        ),
        requirementIds: Array.from(branch.requirementIds)
      }))
      .sort((left, right) => {
        const kindCompare =
          getKindOrder(left.kinds[0]) - getKindOrder(right.kinds[0])

        return kindCompare !== 0
          ? kindCompare
          : left.name.localeCompare(right.name, 'zh-CN', { numeric: true })
      })

    return {
      repositoryId: accumulator.repositoryId,
      name: repository?.name ?? '仓库已移除',
      localPath: repository?.localPath ?? null,
      available: repository?.available ?? false,
      missing: !repository,
      branches
    }
  })

  summaries.sort((left, right) => {
    if (left.missing !== right.missing) return left.missing ? -1 : 1
    if (left.available !== right.available) return left.available ? 1 : -1

    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true })
  })

  return {
    repositories: summaries,
    boundRequirementCount: boundRequirementIds.size,
    unboundRequirements: requirements.filter(
      (requirement) => !boundRequirementIds.has(requirement.id)
    ),
    branchCount: summaries.reduce(
      (count, repository) => count + repository.branches.length,
      0
    ),
    unavailableRepositoryCount: summaries.filter(
      (repository) => repository.missing || !repository.available
    ).length
  }
}
