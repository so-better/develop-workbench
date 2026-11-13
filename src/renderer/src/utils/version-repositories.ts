import type { RequirementBindingsMap } from '../../../types/bindings'
import type { VersionSummaryRequirement } from '../../../types/requirements'
import type { Repository } from '../../../types/repository'
import { parseReleaseDate } from '../../../utils'

/** 版本汇总里的分支类型。 */
export type RepositoryBranchKind = 'development' | 'requirement' | 'iteration'

/** 某个仓库在版本中涉及的分支。 */
export interface RepositoryBranchSummary {
  /** 分支名。 */
  name: string

  /** 该分支在需求绑定中的类型，可能同时属于多种类型。 */
  kinds: RepositoryBranchKind[]

  /** 关联的需求 ID。 */
  requirementIds: string[]
}

/** 某个仓库在版本中的汇总信息。 */
export interface VersionRepositorySummary {
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
  branches: RepositoryBranchSummary[]
}

/** 一次版本的仓库汇总结果。 */
export interface VersionRepositoryCollection {
  /** 按仓库聚合后的列表。 */
  repositories: VersionRepositorySummary[]

  /** 至少绑定了一个仓库的需求数。 */
  boundRequirementCount: number

  /** 没有绑定任何仓库的需求。 */
  unboundRequirements: VersionSummaryRequirement[]

  /** 去重后的分支数。 */
  branchCount: number

  /** 配置已经不存在或本地路径不可用的仓库数。 */
  unavailableRepositoryCount: number
}

const BRANCH_KIND_ORDER: RepositoryBranchKind[] = [
  'development',
  'requirement',
  'iteration'
]

const getKindOrder = (kind: RepositoryBranchKind): number =>
  BRANCH_KIND_ORDER.indexOf(kind)

interface BranchAccumulator {
  name: string
  kinds: Set<RepositoryBranchKind>
  requirementIds: Set<string>
}

interface RepositoryAccumulator {
  repository: Repository | null
  repositoryId: string
  branches: Map<string, BranchAccumulator>
}

/** 按规划版本分组后的轻量需求。 */
export interface VersionSummaryGroup {
  /** 分组稳定键。 */
  key: string

  /** 版本名称；未规划时为「未规划版本」。 */
  versionName: string

  /** 版本日期。 */
  releaseDate: string | null

  /** 该版本下的需求。 */
  requirements: VersionSummaryRequirement[]
}

/** 获取轻量需求所属产线，本地临时需求可能包含多个产线。 */
export const getVersionSummaryProductLines = (
  requirement: VersionSummaryRequirement
): string[] => {
  const lines = Array.from(
    new Set(
      requirement.productLines
        .map((line) => line.trim())
        .filter(Boolean)
    )
  )

  return lines.length > 0 ? lines : ['未设置产线']
}

/**
 * 按需求关联的规划版本分组；缺少规划版本时回退到规划迭代。
 * 同一版本的不同产线迭代会按日期合并；同一需求关联多个版本时会出现在多个分组中。
 */
export const groupVersionSummaryRequirements = (
  requirements: VersionSummaryRequirement[]
): VersionSummaryGroup[] => {
  const groups = new Map<string, VersionSummaryGroup>()

  const addRequirement = (
    requirement: VersionSummaryRequirement,
    version: {
      id: string | null
      name: string
      date: string | null
      displayName?: string
    }
  ): void => {
    const key = version.date
      ? `date:${version.date}`
      : version.id ??
        (version.name === '未规划版本'
          ? 'unplanned'
          : `version:${version.name}`)
    const displayName =
      version.displayName ??
      (version.date ? version.date.replace(/-/g, '') : version.name)
    const existing = groups.get(key)

    if (existing) {
      if (!existing.requirements.some((item) => item.id === requirement.id)) {
        existing.requirements.push(requirement)
      }
      return
    }

    groups.set(key, {
      key,
      versionName: displayName,
      releaseDate: version.date,
      requirements: [requirement]
    })
  }

  for (const requirement of requirements) {
    const versions = Array.from(
      new Set(
        requirement.planningVersions
          .map((version) => version.trim())
          .filter(Boolean)
      )
    )

    if (versions.length > 0) {
      for (const versionName of versions) {
        const releaseDate = parseReleaseDate(versionName)
        const matchedIteration =
          requirement.iterations.find(
            (iteration) => releaseDate && iteration.date === releaseDate
          ) ?? requirement.iterations[0]

        addRequirement(requirement, {
          id: matchedIteration?.id ?? null,
          name: versionName,
          date: releaseDate,
          displayName: versionName
        })
      }
      continue
    }

    if (requirement.iterations.length === 0) {
      addRequirement(requirement, {
        id: null,
        name: '未规划版本',
        date: null
      })
      continue
    }

    for (const iteration of requirement.iterations) {
      addRequirement(requirement, {
        id: iteration.id,
        name: iteration.name,
        date: iteration.date
      })
    }
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (!left.releaseDate && !right.releaseDate) {
      return right.versionName.localeCompare(left.versionName, 'zh-CN')
    }

    if (!left.releaseDate) return 1
    if (!right.releaseDate) return -1

    const dateCompare = right.releaseDate.localeCompare(left.releaseDate)

    return dateCompare !== 0
      ? dateCompare
      : right.versionName.localeCompare(left.versionName, 'zh-CN')
  })
}

/**
 * 汇总一个版本内所有需求的仓库和分支。
 * 普通绑定使用开发分支，轻舟绑定同时收集需求分支和迭代分支。
 */
export const buildVersionRepositorySummary = (
  requirements: VersionSummaryRequirement[],
  bindingsByRequirement: RequirementBindingsMap,
  repositories: Repository[]
): VersionRepositoryCollection => {
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
    kind: RepositoryBranchKind,
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

  const summaries: VersionRepositorySummary[] = Array.from(
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
