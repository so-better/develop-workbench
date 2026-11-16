import { useState } from 'react'
import { App } from 'antd'
import type { LocalRequirementInput } from '../../../../types/local-requirements'
import type { MeegleRequirement } from '../../../../types/requirements'
import { getErrorMessage } from '../../../../utils'

interface UseLocalRequirementModalOptions {
  projectKey: string | undefined
  projectApiKey: string | undefined
  selectedRequirement: MeegleRequirement | null
  selectedRequirementIsLocal: boolean
  showClosedRequirements: boolean
  setShowClosedRequirements: (value: boolean) => void
  loadRequirements: () => Promise<void>
  setSelectedRequirementId: (id: string | null) => void
  clearSelectedRequirement: () => void
}

/**
 * 本地临时需求的创建、编辑和删除状态。
 */
export const useLocalRequirementModal = ({
  projectKey,
  projectApiKey,
  selectedRequirement,
  selectedRequirementIsLocal,
  showClosedRequirements,
  setShowClosedRequirements,
  loadRequirements,
  setSelectedRequirementId,
  clearSelectedRequirement
}: UseLocalRequirementModalOptions) => {
  const { message } = App.useApp()

  const [localModalOpen, setLocalModalOpen] = useState(false)
  const [localModalRequirement, setLocalModalRequirement] =
    useState<MeegleRequirement | null>(null)
  const [localSaving, setLocalSaving] = useState(false)
  const [localDeleting, setLocalDeleting] = useState(false)

  /** 打开新建临时需求弹窗。 */
  const handleOpenCreateLocalRequirement = (): void => {
    setLocalModalRequirement(null)
    setLocalModalOpen(true)
  }

  /** 新建需求入口：飞书创建正式需求或创建本地临时需求。 */
  const handleCreateRequirementMenu = (key: string): void => {
    if (key === 'formal') {
      if (!projectApiKey) {
        message.warning('当前 Meegle 空间不可用')
        return
      }

      const createUrl = `https://project.feishu.cn/${encodeURIComponent(
        projectApiKey
      )}/story/create`

      window.electron
        .openEmbeddedBrowser(createUrl)
        .then((opened) => {
          if (opened) {
            message.info('已打开飞书需求创建页，创建完成后刷新左侧列表')
          } else {
            message.error('无法打开飞书创建需求页面')
          }
        })
        .catch((openError) => {
          message.error(
            getErrorMessage(openError, '打开飞书创建需求页面失败')
          )
        })
      return
    }

    handleOpenCreateLocalRequirement()
  }

  /** 打开编辑临时需求弹窗。 */
  const handleOpenEditLocalRequirement = (): void => {
    if (!selectedRequirement || !selectedRequirementIsLocal) return

    setLocalModalRequirement(selectedRequirement)
    setLocalModalOpen(true)
  }

  /** 保存临时需求。 */
  const handleSubmitLocalRequirement = async (
    input: LocalRequirementInput
  ): Promise<void> => {
    if (!projectKey) {
      message.warning('当前 Meegle 空间不可用')
      return
    }

    const editing = Boolean(localModalRequirement)

    setLocalSaving(true)

    try {
      const saved = localModalRequirement
        ? await window.electron.updateLocalRequirement(
            projectKey,
            localModalRequirement.id,
            input
          )
        : await window.electron.addLocalRequirement(projectKey, input)

      if (saved.closed && !showClosedRequirements) {
        setShowClosedRequirements(true)
      }

      setLocalModalOpen(false)
      setLocalModalRequirement(null)
      await loadRequirements()
      setSelectedRequirementId(saved.id)
      message.success(editing ? '临时需求已更新' : '临时需求已创建')
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '保存临时需求失败'))
    } finally {
      setLocalSaving(false)
    }
  }

  /** 删除当前临时需求。 */
  const handleDeleteLocalRequirement = async (): Promise<void> => {
    if (!projectKey || !selectedRequirement || !selectedRequirementIsLocal) return

    setLocalDeleting(true)

    try {
      await window.electron.removeRequirementBindingWorkspace(
        selectedRequirement.id
      )
      await window.electron.removeLocalRequirement(
        projectKey,
        selectedRequirement.id
      )
      clearSelectedRequirement()
      await loadRequirements()
      message.success('临时需求已删除')
    } catch (removeError) {
      message.error(getErrorMessage(removeError, '删除临时需求失败'))
    } finally {
      setLocalDeleting(false)
    }
  }

  return {
    localModalOpen,
    localModalRequirement,
    localSaving,
    localDeleting,
    handleCreateRequirementMenu,
    handleOpenEditLocalRequirement,
    handleSubmitLocalRequirement,
    handleDeleteLocalRequirement,
    setLocalModalOpen,
    setLocalModalRequirement
  }
}
