import { useEffect, useState } from 'react'
import { App } from 'antd'
import type { MeegleRequirementComment } from '../../../../types/requirements'
import type { RequirementPersonalStatus } from '../../../../types/requirement-status'
import { getErrorMessage } from '../../../../utils'
import {
  buildReplyContent,
  isLocalRequirementId
} from './workbench-utils'

interface UseRequirementCommentsOptions {
  selectedRequirementId: string | null
  projectKey: string | undefined
  selectedDescription: string | null
  loadRequirements: () => Promise<void>
  refreshActivity: () => void
}

/**
 * 需求描述、个人标记和评论状态。
 */
export const useRequirementComments = ({
  selectedRequirementId,
  projectKey,
  selectedDescription,
  loadRequirements,
  refreshActivity
}: UseRequirementCommentsOptions) => {
  const { message } = App.useApp()

  const [personalStatus, setPersonalStatus] =
    useState<RequirementPersonalStatus | null>(null)
  const [personalStatusLoading, setPersonalStatusLoading] = useState(false)
  const [personalStatusEditing, setPersonalStatusEditing] = useState(false)
  const [personalStatusDraft, setPersonalStatusDraft] = useState('')
  const [personalStatusSaving, setPersonalStatusSaving] = useState(false)

  const [commentDraft, setCommentDraft] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [replyToComment, setReplyToComment] =
    useState<MeegleRequirementComment | null>(null)

  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [moreFieldsOpen, setMoreFieldsOpen] = useState(false)
  const [descriptionEditing, setDescriptionEditing] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [descriptionSaving, setDescriptionSaving] = useState(false)

  // 切换需求时重置描述和评论编辑状态。
  useEffect(() => {
    setCommentDraft('')
    setReplyToComment(null)
    setDescriptionExpanded(false)
    setDescriptionEditing(false)
    setDescriptionDraft('')
    setMoreFieldsOpen(false)
  }, [selectedRequirementId])

  /**
   * 读取当前需求的本地个人标记。
   */
  useEffect(() => {
    setPersonalStatusEditing(false)
    setPersonalStatusDraft('')

    if (
      !selectedRequirementId ||
      !projectKey ||
      isLocalRequirementId(selectedRequirementId)
    ) {
      setPersonalStatus(null)
      setPersonalStatusLoading(false)
      return
    }

    let cancelled = false

    setPersonalStatus(null)
    setPersonalStatusLoading(true)
    window.electron
      .getRequirementPersonalStatus(projectKey, selectedRequirementId)
      .then((state) => {
        if (cancelled) return

        setPersonalStatus(state.status)
        setPersonalStatusDraft(state.status?.value ?? '')
      })
      .catch((loadError) => {
        if (!cancelled) {
          message.error(getErrorMessage(loadError, '读取个人标记失败'))
        }
      })
      .finally(() => {
        if (!cancelled) setPersonalStatusLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [message, projectKey, selectedRequirementId])

  /** 开始编辑需求描述。 */
  const handleStartDescriptionEdit = (): void => {
    setDescriptionDraft(selectedDescription ?? '')
    setDescriptionEditing(true)
    setDescriptionExpanded(true)
  }

  /** 取消编辑需求描述。 */
  const handleCancelDescriptionEdit = (): void => {
    setDescriptionEditing(false)
    setDescriptionDraft('')
  }

  /** 保存需求描述到飞书。 */
  const handleSaveDescription = async (): Promise<void> => {
    if (!selectedRequirementId) return

    setDescriptionSaving(true)

    try {
      await window.electron.updateRequirementDescription(
        selectedRequirementId,
        descriptionDraft
      )
      message.success('需求描述已更新')
      setDescriptionEditing(false)
      setDescriptionDraft('')
      await loadRequirements()
    } catch (saveError) {
      message.error(getErrorMessage(saveError))
    } finally {
      setDescriptionSaving(false)
    }
  }

  /** 开始编辑本地个人标记。 */
  const handleStartPersonalStatusEdit = (): void => {
    if (personalStatusLoading || personalStatusSaving) return

    setPersonalStatusDraft(personalStatus?.value ?? '')
    setPersonalStatusEditing(true)
  }

  /** 取消编辑并恢复已保存内容。 */
  const handleCancelPersonalStatusEdit = (): void => {
    setPersonalStatusDraft(personalStatus?.value ?? '')
    setPersonalStatusEditing(false)
  }

  /** 保存本地个人标记；空字符串表示清除。 */
  const handleSavePersonalStatus = async (): Promise<void> => {
    if (!projectKey || !selectedRequirementId || personalStatusSaving) return

    const value = personalStatusDraft.trim()

    if (value === (personalStatus?.value ?? '')) {
      setPersonalStatusEditing(false)
      return
    }

    setPersonalStatusSaving(true)

    try {
      const state = await window.electron.setRequirementPersonalStatus(
        projectKey,
        selectedRequirementId,
        value
      )

      setPersonalStatus(state.status)
      setPersonalStatusDraft(state.status?.value ?? '')
      setPersonalStatusEditing(false)
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '保存个人标记失败'))
    } finally {
      setPersonalStatusSaving(false)
    }
  }

  /** 开始引用回复。 */
  const handleStartReply = (comment: MeegleRequirementComment): void => {
    setReplyToComment(comment)
  }

  /** 取消引用回复。 */
  const handleCancelReply = (): void => {
    setReplyToComment(null)
  }

  /** 发表评论并刷新评论列表。 */
  const handleAddComment = async (): Promise<void> => {
    if (!selectedRequirementId) return

    if (!commentDraft.trim()) {
      message.warning('请输入评论内容')
      return
    }

    setCommentSubmitting(true)

    try {
      const notifyUserKeys = replyToComment?.creator?.userKey
        ? [replyToComment.creator.userKey]
        : undefined

      const content = replyToComment
        ? buildReplyContent(replyToComment, commentDraft)
        : commentDraft

      await window.electron.addRequirementComment(
        selectedRequirementId,
        content,
        notifyUserKeys
      )
      setCommentDraft('')
      setReplyToComment(null)
      message.success(replyToComment ? '回复已发表' : '评论已发表')
      refreshActivity()
    } catch (commentError) {
      message.error(getErrorMessage(commentError))
    } finally {
      setCommentSubmitting(false)
    }
  }

  return {
    personalStatus,
    personalStatusLoading,
    personalStatusEditing,
    personalStatusDraft,
    setPersonalStatusDraft,
    commentDraft,
    commentSubmitting,
    replyToComment,
    setCommentDraft,
    descriptionExpanded,
    setDescriptionExpanded,
    moreFieldsOpen,
    setMoreFieldsOpen,
    descriptionEditing,
    descriptionSaving,
    descriptionDraft,
    setDescriptionDraft,
    handleStartDescriptionEdit,
    handleCancelDescriptionEdit,
    handleSaveDescription,
    handleStartPersonalStatusEdit,
    handleCancelPersonalStatusEdit,
    handleSavePersonalStatus,
    handleStartReply,
    handleCancelReply,
    handleAddComment
  }
}
