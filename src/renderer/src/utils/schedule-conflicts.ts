import type { MeegleWorkflowNode } from '../../../types/requirements'

/** 流程图中前置节点与后续节点的排期顺序冲突。 */
export interface ScheduleConflict {
  /** 前置节点 key。 */
  fromKey: string

  /** 后续节点 key。 */
  toKey: string

  /** 前置节点名称。 */
  fromName: string

  /** 后续节点名称。 */
  toName: string

  /** 前置节点用于比较的开始日期，缺失时为结束日期。 */
  fromDate: string | null

  /** 后续节点用于比较的结束日期，缺失时为开始日期。 */
  toDate: string | null
}

interface ScheduleDate {
  day: number
  value: string
}

/**
 * 将排期时间归一化到当天零点，避免结束时间 23:59 影响日期比较。
 */
const parseScheduleDate = (value: string | null): ScheduleDate | null => {
  if (!value) return null

  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) return null

  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)

  return {
    day: date.getTime(),
    value
  }
}

/**
 * 前置节点使用排期开始日，缺失时回退结束日。
 */
const getPredecessorSchedule = (
  node: MeegleWorkflowNode
): ScheduleDate | null =>
  parseScheduleDate(node.scheduleStart) ?? parseScheduleDate(node.scheduleEnd)

/**
 * 后续节点使用排期结束日，缺失时回退开始日。
 */
const getSuccessorSchedule = (node: MeegleWorkflowNode): ScheduleDate | null =>
  parseScheduleDate(node.scheduleEnd) ?? parseScheduleDate(node.scheduleStart)

/**
 * 找出后续节点排期结束日早于前置节点开始日的流程边。
 */
export const findScheduleConflicts = (
  nodes: MeegleWorkflowNode[]
): ScheduleConflict[] => {
  const nodeMap = new Map(nodes.map((node) => [node.key, node]))
  const conflicts: ScheduleConflict[] = []
  const seen = new Set<string>()

  for (const node of nodes) {
    const fromSchedule = getPredecessorSchedule(node)

    if (!fromSchedule) continue

    for (const nextKey of node.nextNodeKeys) {
      const nextNode = nodeMap.get(nextKey)
      const toSchedule = nextNode ? getSuccessorSchedule(nextNode) : null

      if (!nextNode || !toSchedule || toSchedule.day >= fromSchedule.day) {
        continue
      }

      const edgeKey = `${node.key}-${nextKey}`

      if (seen.has(edgeKey)) continue

      seen.add(edgeKey)
      conflicts.push({
        fromKey: node.key,
        toKey: nextKey,
        fromName: node.name,
        toName: nextNode.name,
        fromDate: fromSchedule.value,
        toDate: toSchedule.value
      })
    }
  }

  return conflicts
}
