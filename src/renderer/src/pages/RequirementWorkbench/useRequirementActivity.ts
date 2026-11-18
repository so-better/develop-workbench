import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { App } from 'antd'
import type {
  MeegleRequirementActivity,
  MeegleRequirementOwner
} from '../../../../types/requirements'
import { getErrorMessage } from '../../../../utils'
import {
  findScheduleConflicts
} from '../../../../utils/schedule-conflicts'
import { isLocalRequirementId } from './workbench-utils'

interface UseRequirementActivityOptions {
  selectedRequirementId: string | null
  loadRequirements: () => Promise<void>
}

/**
 * 需求流程节点、节点编辑、完成和回滚状态。
 */
export const useRequirementActivity = ({
  selectedRequirementId,
  loadRequirements
}: UseRequirementActivityOptions) => {
  const { message } = App.useApp()

  // 流程节点单独加载，避免拖慢左侧需求列表。
  const [activity, setActivity] = useState<MeegleRequirementActivity | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [activityVersion, setActivityVersion] = useState(0)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const activityRequirementIdRef = useRef<string | null>(null)
  const nodeDetailRef = useRef<HTMLDivElement>(null)

  /** 当前选中的流程节点。 */
  const selectedNode =
    activity?.nodes.find((node) => node.key === selectedNodeKey) ?? null

  /** 流程图中排期顺序异常的边。 */
  const scheduleConflicts = useMemo(
    () => findScheduleConflicts(activity?.nodes ?? []),
    [activity?.nodes]
  )

  /** 当前节点相关的排期顺序异常。 */
  const selectedNodeScheduleConflicts = useMemo(
    () =>
      selectedNodeKey
        ? scheduleConflicts.filter(
            (conflict) =>
              conflict.fromKey === selectedNodeKey || conflict.toKey === selectedNodeKey
          )
        : [],
    [scheduleConflicts, selectedNodeKey]
  )

  /** 当前节点剩余工时 = 估分 - 实际工时。 */
  const nodeRemainingWorkTime =
    selectedNode?.points !== null &&
      selectedNode?.points !== undefined &&
      selectedNode.actualWorkTime !== null
      ? Math.max(0, selectedNode.points - selectedNode.actualWorkTime)
      : null

  // 节点估分和排期编辑弹窗。
  const [nodeEditing, setNodeEditing] = useState(false)
  const [nodeEditRange, setNodeEditRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [nodeEditPoints, setNodeEditPoints] = useState<number | null>(null)
  const [nodeEditActualWorkTime, setNodeEditActualWorkTime] = useState<number | null>(
    null
  )
  const [nodeEditOwnerKeys, setNodeEditOwnerKeys] = useState<string[]>([])
  const [nodeOwnerOptions, setNodeOwnerOptions] = useState<MeegleRequirementOwner[]>([])
  const [nodeOwnerSearching, setNodeOwnerSearching] = useState(false)
  const [nodeEditSubmitting, setNodeEditSubmitting] = useState(false)
  const nodeOwnerSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodeOwnerSearchRequestRef = useRef(0)

  // 回滚弹窗。
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [rollbackReason, setRollbackReason] = useState('')
  const [rollbackSubmitting, setRollbackSubmitting] = useState(false)

  // 完成节点弹窗。
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeSubmitting, setCompleteSubmitting] = useState(false)
  const [completeActualWorkTime, setCompleteActualWorkTime] = useState<number | null>(
    null
  )

  /** 刷新节点数据。 */
  const refreshActivity = (): void => {
    setActivityVersion((value) => value + 1)
  }

  /** 刷新需求和流程节点。 */
  const refreshWorkbench = async (): Promise<void> => {
    refreshActivity()
    await loadRequirements()
  }

  /** 选中流程图节点后，将节点详情滚动到可视区域。 */
  const handleSelectNode = (nodeKey: string): void => {
    setSelectedNodeKey(nodeKey)

    window.requestAnimationFrame(() => {
      nodeDetailRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    })
  }

  /**
   * 切换需求时清空节点选择；同一需求刷新时保留当前选中的节点。
   */
  useEffect(() => {
    setSelectedNodeKey(null)
  }, [selectedRequirementId])

  /**
   * 选中需求后读取流程节点。
   */
  useEffect(() => {
    if (!selectedRequirementId || isLocalRequirementId(selectedRequirementId)) {
      activityRequirementIdRef.current = null
      setActivity(null)
      setActivityLoading(false)
      setSelectedNodeKey(null)
      setActivityError(null)
      return
    }

    let cancelled = false

    if (activityRequirementIdRef.current !== selectedRequirementId) {
      setActivity(null)
    }

    setActivityLoading(true)
    setActivityError(null)

    window.electron
      .getRequirementActivity(selectedRequirementId)
      .then((result) => {
        if (cancelled) return

        activityRequirementIdRef.current = selectedRequirementId
        setActivity(result)
        setSelectedNodeKey((currentKey) => {
          if (currentKey && result.nodes.some((node) => node.key === currentKey)) {
            return currentKey
          }

          return (
            result.nodes.find((node) => node.status === 'doing')?.key ??
            result.nodes[0]?.key ??
            null
          )
        })
      })
      .catch((loadError) => {
        if (!cancelled) setActivityError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activityVersion, selectedRequirementId])

  /**
   * 切换需求或节点时退出内联编辑和弹窗，避免把上一个节点的值带到新节点。
   */
  useEffect(() => {
    setNodeEditing(false)
    setRollbackOpen(false)
    setCompleteOpen(false)
    setCompleteActualWorkTime(null)
  }, [selectedNodeKey, selectedRequirementId])

  /** 打开节点编辑。 */
  const openNodeEditor = (): void => {
    if (!selectedNode) return

    const start =
      selectedNode.supportsSchedule && selectedNode.scheduleStart
        ? dayjs(selectedNode.scheduleStart)
        : null
    const end =
      selectedNode.supportsSchedule && selectedNode.scheduleEnd
        ? dayjs(selectedNode.scheduleEnd)
        : null

    setNodeEditRange(start?.isValid() && end?.isValid() ? [start, end] : null)
    setNodeEditPoints(selectedNode.supportsPoints ? selectedNode.points : null)
    setNodeEditActualWorkTime(
      selectedNode.supportsActualWorkTime ? selectedNode.actualWorkTime : null
    )
    setNodeEditOwnerKeys(
      selectedNode.owners.flatMap((owner) => (owner.userKey ? [owner.userKey] : []))
    )
    setNodeOwnerOptions(
      selectedNode.owners.filter((owner): owner is MeegleRequirementOwner =>
        Boolean(owner.userKey)
      )
    )
    setNodeOwnerSearching(false)
    nodeOwnerSearchRequestRef.current += 1

    if (nodeOwnerSearchTimerRef.current) {
      clearTimeout(nodeOwnerSearchTimerRef.current)
      nodeOwnerSearchTimerRef.current = null
    }

    setNodeEditing(true)
  }

  useEffect(() => {
    if (nodeEditing) return

    if (nodeOwnerSearchTimerRef.current) {
      clearTimeout(nodeOwnerSearchTimerRef.current)
      nodeOwnerSearchTimerRef.current = null
    }

    nodeOwnerSearchRequestRef.current += 1
    setNodeOwnerSearching(false)
  }, [nodeEditing])

  useEffect(
    () => () => {
      if (nodeOwnerSearchTimerRef.current) {
        clearTimeout(nodeOwnerSearchTimerRef.current)
      }

      nodeOwnerSearchRequestRef.current += 1
    },
    []
  )

  /** 防抖搜索节点负责人。 */
  const handleNodeOwnerSearch = (keyword: string): void => {
    const query = keyword.trim()
    const requestId = nodeOwnerSearchRequestRef.current + 1

    nodeOwnerSearchRequestRef.current = requestId

    if (nodeOwnerSearchTimerRef.current) {
      clearTimeout(nodeOwnerSearchTimerRef.current)
      nodeOwnerSearchTimerRef.current = null
    }

    if (!query) {
      setNodeOwnerSearching(false)
      return
    }

    nodeOwnerSearchTimerRef.current = setTimeout(() => {
      nodeOwnerSearchTimerRef.current = null
      setNodeOwnerSearching(true)

      window.electron
        .searchRequirementUsers(query)
        .then((owners) => {
          if (nodeOwnerSearchRequestRef.current !== requestId) return

          setNodeOwnerOptions((current) => {
            const merged = new Map(
              current.flatMap((owner) =>
                owner.userKey ? [[owner.userKey, owner] as const] : []
              )
            )

            for (const owner of owners) {
              if (owner.userKey) merged.set(owner.userKey, owner)
            }

            return Array.from(merged.values())
          })
        })
        .catch((searchError) => {
          if (nodeOwnerSearchRequestRef.current !== requestId) return
          message.error(getErrorMessage(searchError))
        })
        .finally(() => {
          if (nodeOwnerSearchRequestRef.current === requestId) {
            setNodeOwnerSearching(false)
          }
        })
    }, 300)
  }

  /** 保存节点排期、估分、实际工时和负责人。 */
  const handleSaveNodeInfo = async (): Promise<void> => {
    if (!selectedRequirementId || !selectedNode) return

    const pointsChanged =
      selectedNode.supportsPoints && nodeEditPoints !== selectedNode.points

    if (
      pointsChanged &&
      nodeEditPoints !== null &&
      (!Number.isFinite(nodeEditPoints) || nodeEditPoints < 0)
    ) {
      message.warning('估分必须为非负数值；留空表示不设置')
      return
    }

    const actualWorkTimeChanged =
      selectedNode.supportsActualWorkTime &&
      nodeEditActualWorkTime !== selectedNode.actualWorkTime

    if (
      actualWorkTimeChanged &&
      nodeEditActualWorkTime !== null &&
      (!Number.isFinite(nodeEditActualWorkTime) || nodeEditActualWorkTime < 0)
    ) {
      message.warning('实际工时必须为非负数值；留空表示不设置')
      return
    }

    const currentOwnerKeys = selectedNode.owners
      .flatMap((owner) => (owner.userKey ? [owner.userKey] : []))
      .sort()
    const nextOwnerKeys = [...nodeEditOwnerKeys].sort()
    const ownersChanged =
      nextOwnerKeys.length !== currentOwnerKeys.length ||
      nextOwnerKeys.some((key, index) => key !== currentOwnerKeys[index])

    setNodeEditSubmitting(true)

    try {
      const originalStart = selectedNode.scheduleStart
        ? dayjs(selectedNode.scheduleStart)
        : null
      const originalEnd = selectedNode.scheduleEnd
        ? dayjs(selectedNode.scheduleEnd)
        : null
      const startAt =
        selectedNode.supportsSchedule && nodeEditRange
          ? originalStart?.isSame(nodeEditRange[0], 'day')
            ? originalStart.valueOf()
            : nodeEditRange[0].startOf('day').valueOf()
          : undefined
      const endAt =
        selectedNode.supportsSchedule && nodeEditRange
          ? originalEnd?.isSame(nodeEditRange[1], 'day')
            ? originalEnd.valueOf()
            : nodeEditRange[1].endOf('day').valueOf()
          : undefined
      // null 表示用户清空排期；估分独立比较，不依赖节点是否支持排期。
      const clearSchedule =
        selectedNode.supportsSchedule &&
        nodeEditRange === null &&
        Boolean(selectedNode.scheduleStart || selectedNode.scheduleEnd)
      const scheduleChanged =
        clearSchedule ||
        (selectedNode.supportsSchedule &&
          nodeEditRange !== null &&
          ((startAt !== undefined && startAt !== originalStart?.valueOf()) ||
            (endAt !== undefined && endAt !== originalEnd?.valueOf())))

      if (!scheduleChanged && !pointsChanged && !actualWorkTimeChanged && !ownersChanged) {
        setNodeEditing(false)
        return
      }

      const schedulePayloadChanged =
        scheduleChanged || pointsChanged || actualWorkTimeChanged

      await window.electron.updateRequirementNode(selectedRequirementId, selectedNode.key, {
        ...(schedulePayloadChanged
          ? {
              ...(clearSchedule
                ? { clearSchedule: true }
                : startAt !== undefined && endAt !== undefined
                  ? { startAt, endAt }
                  : {}),
              ...(selectedNode.supportsPoints
                ? { points: pointsChanged ? nodeEditPoints : selectedNode.points }
                : {}),
              ...(selectedNode.supportsActualWorkTime
                ? {
                    actualWorkTime: actualWorkTimeChanged
                      ? nodeEditActualWorkTime
                      : selectedNode.actualWorkTime
                  }
                : {})
            }
          : {}),
        ...(ownersChanged ? { ownerUserKeys: nextOwnerKeys } : {})
      })

      setActivity((current) =>
        current
          ? {
              ...current,
              nodes: current.nodes.map((node) =>
                node.key === selectedNode.key
                  ? {
                      ...node,
                      scheduleStart:
                        clearSchedule ? null : startAt === undefined
                          ? node.scheduleStart
                          : new Date(startAt).toISOString(),
                      scheduleEnd:
                        clearSchedule ? null : endAt === undefined
                          ? node.scheduleEnd
                          : new Date(endAt).toISOString(),
                      points: pointsChanged ? nodeEditPoints : node.points,
                      actualWorkTime: actualWorkTimeChanged
                        ? nodeEditActualWorkTime
                        : node.actualWorkTime
                    }
                  : node
              )
            }
          : current
      )
      message.success('节点信息已更新')
      setNodeEditing(false)
      await refreshWorkbench()
    } catch (saveError) {
      message.error(getErrorMessage(saveError))
    } finally {
      setNodeEditSubmitting(false)
    }
  }

  /** 回滚当前节点，必须填写回滚原因。 */
  const handleRollbackNode = async (): Promise<void> => {
    if (!selectedRequirementId || !selectedNode || !rollbackReason.trim()) return

    setRollbackSubmitting(true)

    try {
      await window.electron.transitionRequirementNode(
        selectedRequirementId,
        selectedNode.key,
        'rollback',
        rollbackReason.trim()
      )
      message.success(`节点「${selectedNode.name}」已回滚`)
      setRollbackOpen(false)
      setRollbackReason('')
      setNodeEditing(false)
      await refreshWorkbench()
    } catch (rollbackError) {
      message.error(getErrorMessage(rollbackError))
    } finally {
      setRollbackSubmitting(false)
    }
  }

  /** 完成节点前校验总估分和排期，缺少时提示用户先编辑节点。 */
  const validateNodeComplete = (): boolean => {
    if (!selectedNode) return false

    if (selectedNode.supportsPoints && selectedNode.points == null) {
      message.warning('请先在节点编辑中设置总估分')
      return false
    }

    if (
      selectedNode.supportsSchedule &&
      (!selectedNode.scheduleStart || !selectedNode.scheduleEnd)
    ) {
      message.warning('请先在节点编辑中设置排期')
      return false
    }

    return true
  }

  /** 完成当前节点，会推进需求流程。 */
  const handleCompleteNode = async (actualWorkTimeOverride?: number): Promise<void> => {
    if (!selectedRequirementId || !selectedNode) return
    if (!validateNodeComplete()) return

    const actualWorkTime = actualWorkTimeOverride ?? completeActualWorkTime

    if (
      selectedNode.supportsActualWorkTime &&
      (actualWorkTime === null ||
        !Number.isFinite(actualWorkTime) ||
        actualWorkTime <= 0)
    ) {
      message.warning('请填写实际工时')
      return
    }

    setCompleteSubmitting(true)

    try {
      if (
        selectedNode.supportsActualWorkTime &&
        actualWorkTime !== selectedNode.actualWorkTime
      ) {
        const scheduleStart = selectedNode.scheduleStart
          ? dayjs(selectedNode.scheduleStart)
          : null
        const scheduleEnd = selectedNode.scheduleEnd
          ? dayjs(selectedNode.scheduleEnd)
          : null
        const hasCompleteSchedule =
          selectedNode.supportsSchedule &&
          scheduleStart?.isValid() &&
          scheduleEnd?.isValid()

        await window.electron.updateRequirementNode(
          selectedRequirementId,
          selectedNode.key,
          {
            ...(hasCompleteSchedule
              ? {
                  startAt: (scheduleStart as Dayjs).valueOf(),
                  endAt: (scheduleEnd as Dayjs).valueOf()
                }
              : {}),
            ...(selectedNode.supportsPoints
              ? { points: selectedNode.points }
              : {}),
            actualWorkTime: actualWorkTime as number
          }
        )
      }

      await window.electron.transitionRequirementNode(
        selectedRequirementId,
        selectedNode.key,
        'confirm'
      )
      message.success(`节点「${selectedNode.name}」已完成`)
      setCompleteOpen(false)
      setNodeEditing(false)
      await refreshWorkbench()
    } catch (completeError) {
      message.error(getErrorMessage(completeError))
    } finally {
      setCompleteSubmitting(false)
    }
  }

  return {
    activity,
    activityLoading,
    activityError,
    selectedNodeKey,
    selectedNode,
    selectedNodeScheduleConflicts,
    nodeRemainingWorkTime,
    nodeDetailRef,
    nodeEditing,
    nodeEditRange,
    nodeEditPoints,
    nodeEditActualWorkTime,
    nodeEditOwnerKeys,
    nodeOwnerOptions,
    nodeOwnerSearching,
    nodeEditSubmitting,
    setNodeEditRange,
    setNodeEditPoints,
    setNodeEditActualWorkTime,
    setNodeEditOwnerKeys,
    rollbackOpen,
    rollbackReason,
    rollbackSubmitting,
    setRollbackReason,
    completeOpen,
    completeActualWorkTime,
    completeSubmitting,
    setCompleteActualWorkTime,
    refreshActivity,
    refreshWorkbench,
    handleSelectNode,
    openNodeEditor,
    handleNodeOwnerSearch,
    handleSaveNodeInfo,
    handleCompleteNode,
    cancelNodeEditing: () => setNodeEditing(false),
    openComplete: (defaultActualWorkTime: number | null) => {
      if (!validateNodeComplete()) return

      setCompleteActualWorkTime(defaultActualWorkTime)
      setCompleteOpen(true)
    },
    closeComplete: () => {
      setCompleteOpen(false)
      setCompleteActualWorkTime(null)
    },
    submitComplete: () => void handleCompleteNode(),
    openRollback: () => {
      setRollbackReason('')
      setRollbackOpen(true)
    },
    closeRollback: () => {
      setRollbackOpen(false)
      setRollbackReason('')
    },
    submitRollback: () => handleRollbackNode()
  }
}
