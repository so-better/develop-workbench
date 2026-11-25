import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Empty, Skeleton } from 'antd'
import type { LarkUser } from '../../../../types/lark'
import type { SettingsSection } from '../../../../types/settings'
import VersionRepositorySummary from '../../components/VersionRepositorySummary/VersionRepositorySummary'
import ErrorRecovery from '../../components/ErrorRecovery/ErrorRecovery'
import LocalRequirementModal from '../../components/LocalRequirementModal/LocalRequirementModal'
import LocalRequirementDetail from '../../components/LocalRequirementDetail/LocalRequirementDetail'
import { useAiChatDialog } from '../../hooks/useAiChatDialog'
import RequirementLinks from '../../components/RequirementLinks/RequirementLinks'
import RequirementRepositories from '../../components/RequirementRepositories/RequirementRepositories'
import RequirementRepoModals from '../../components/RequirementRepoModals/RequirementRepoModals'
import RequirementSidebar from '../../components/RequirementSidebar/RequirementSidebar'
import RequirementHeader from '../../components/RequirementHeader/RequirementHeader'
import RequirementFlowSection from '../../components/RequirementFlowSection/RequirementFlowSection'
import RequirementInfoSection from '../../components/RequirementInfoSection/RequirementInfoSection'
import { buildRequirementInfoGroups } from '../../components/RequirementInfoSection/requirement-info-groups'
import { buildRequirementAnalysisPrompt } from './requirement-ai'
import { useRequirementList } from './useRequirementList'
import { useRequirementActivity } from './useRequirementActivity'
import { useRequirementComments } from './useRequirementComments'
import { useRequirementRepositories } from './useRequirementRepositories'
import { useLocalRequirementModal } from './useLocalRequirementModal'

interface RequirementWorkbenchProps {
  /** 当前页面是否处于激活状态。 */
  active: boolean
  /** 打开设置弹窗，并定位到指定分类。 */
  onOpenSettings: (section: SettingsSection) => void
  /** 当前飞书用户，用于生成分支名首字母。 */
  larkUser: LarkUser | null
}

/**
 * 需求工作台。
 * 页面只负责编排各业务 hook 和展示组件。
 */
export default function RequirementWorkbench({
  active,
  onOpenSettings,
  larkUser
}: RequirementWorkbenchProps): JSX.Element {
  const { message } = App.useApp()
  const { openAiDialog } = useAiChatDialog()
  const [versionSummaryOpen, setVersionSummaryOpen] = useState(false)

  const {
    data,
    selectedRequirementId,
    selectedRequirement,
    selectedGroup,
    selectedRequirementIsLocal,
    projectName,
    loading,
    error,
    setError,
    requirementFilter,
    setRequirementFilter,
    showClosedRequirements,
    setShowClosedRequirements,
    statusFilters,
    setStatusFilters,
    productLineFilters,
    setProductLineFilters,
    versionFilter,
    setVersionFilter,
    filtersCollapsed,
    setFiltersCollapsed,
    activeFilterCount,
    versionOptions,
    productLineOptions,
    statusOptions,
    allRequirements,
    filteredGroups,
    collapsedGroupKeys,
    hasSearch,
    nodeCompletions,
    setSelectedRequirementId,
    setSelectedRequirementGroupKey,
    projectOptions,
    projectsLoading,
    projectSwitching,
    handleProjectChange,
    showToggleAll,
    allGroupsCollapsed,
    toggleAllRequirementGroups,
    toggleRequirementGroup,
    versionSummaryPreferredKey,
    localVersionOptions,
    allProductLineOptions,
    workbenchContentRef,
    loadRequirements,
    clearSelectedRequirement
  } = useRequirementList()

  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  useEffect(() => {
    if (data && !error) setLastSuccessAt(Date.now())
  }, [data, error])

  const [descriptionOverride, setDescriptionOverride] = useState<{
    id: string
    description: string
  } | null>(null)

  // MQL 列表会把图片替换成 [img]，选中需求后再通过详情接口补齐完整 Markdown。
  useEffect(() => {
    setDescriptionOverride(null)

    if (
      !selectedRequirement ||
      selectedRequirementIsLocal ||
      !selectedRequirement.description?.includes('[img]')
    ) {
      return
    }

    let cancelled = false

    window.electron
      .getRequirementDescription(selectedRequirement.id)
      .then((description) => {
        if (!cancelled && description) {
          setDescriptionOverride({ id: selectedRequirement.id, description })
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [selectedRequirement?.description, selectedRequirement?.id, selectedRequirementIsLocal])

  const selectedDescription =
    descriptionOverride && descriptionOverride.id === selectedRequirement?.id
      ? descriptionOverride.description
      : selectedRequirement?.description ?? null
  const displayRequirement =
    selectedRequirement && selectedDescription !== selectedRequirement.description
      ? { ...selectedRequirement, description: selectedDescription }
      : selectedRequirement

  const {
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
    cancelNodeEditing,
    openComplete,
    closeComplete,
    submitComplete,
    openRollback,
    closeRollback,
    submitRollback
  } = useRequirementActivity({ selectedRequirementId, loadRequirements })

  const {
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
  } = useRequirementComments({
    selectedRequirementId,
    projectKey: data?.project.projectKey,
    selectedDescription,
    loadRequirements,
    refreshActivity
  })

  const requirementUrl =
    selectedRequirement && data && !selectedRequirementIsLocal
      ? `https://project.feishu.cn/${encodeURIComponent(
          data.project.key
        )}/story/detail/${encodeURIComponent(selectedRequirement.id)}`
      : null

  const repositories = useRequirementRepositories({
    selectedRequirementId,
    selectedRequirement,
    selectedRequirementIsLocal,
    requirementUrl,
    larkUser,
    onOpenSettings
  })

  const {
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
  } = useLocalRequirementModal({
    projectKey: data?.project.projectKey,
    projectApiKey: data?.project.key,
    selectedRequirement,
    selectedRequirementIsLocal,
    showClosedRequirements,
    setShowClosedRequirements,
    loadRequirements,
    setSelectedRequirementId,
    clearSelectedRequirement
  })

  const createRequirementMenuRef = useRef(handleCreateRequirementMenu)
  useEffect(() => {
    createRequirementMenuRef.current = handleCreateRequirementMenu
  }, [handleCreateRequirementMenu])

  // 需求页快捷键：/ 搜索，Cmd/Ctrl+N 新建临时需求，Cmd/Ctrl+Shift+N 新建正式需求。
  useEffect(() => {
    if (!active) return

    const isMac = window.electron.platform === 'darwin'

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return

      const hasVisibleDialog = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]')
      ).some((element) => element.offsetParent !== null)

      if (hasVisibleDialog) return

      const modifier = isMac ? event.metaKey : event.ctrlKey

      if (modifier && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        event.stopPropagation()
        createRequirementMenuRef.current(event.shiftKey ? 'formal' : 'local')
        return
      }

      if (
        !modifier &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === '/'
      ) {
        const target = event.target as HTMLElement | null

        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return
        }

        const input = document.querySelector<HTMLInputElement>(
          '.workbench-requirement-search input'
        )

        if (!input) return

        event.preventDefault()
        event.stopPropagation()
        input.focus()
        input.select()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [active])

  const { primary: primaryInfoGroups, more: moreInfoGroups } = selectedRequirement
    ? buildRequirementInfoGroups(selectedRequirement, selectedRequirementIsLocal)
    : { primary: [], more: [] }

  /** 使用 AI 分析当前需求。 */
  const handleAnalyzeRequirement = (): void => {
    if (!displayRequirement) return

    openAiDialog({
      title: 'AI 需求分析',
      autoStart: true,
      prompt: buildRequirementAnalysisPrompt(
        displayRequirement,
        selectedRequirementIsLocal,
        requirementUrl,
        repositories.bindings,
        repositories.repositoryMap
      )
    })
  }

  /** 复制当前需求名称。 */
  const handleCopyRequirementName = async (): Promise<void> => {
    if (!selectedRequirement) return

    try {
      await window.electron.copyText(selectedRequirement.name)
      message.success('需求名称已复制')
    } catch {
      message.error('复制需求名称失败')
    }
  }

  /** 复制当前需求的飞书详情链接。 */
  const handleCopyRequirementUrl = async (): Promise<void> => {
    if (!requirementUrl) return

    try {
      await window.electron.copyText(requirementUrl)
      message.success('需求链接已复制')
    } catch {
      message.error('复制需求链接失败')
    }
  }

  return (
    <div className="workbench">
      {/* 左侧：当前用户负责的需求，按所属版本分组。 */}
      <RequirementSidebar
        data={data}
        loading={loading}
        activityLoading={activityLoading}
        projectOptions={projectOptions}
        projectsLoading={projectsLoading}
        projectSwitching={projectSwitching}
        onProjectChange={handleProjectChange}
        onRefresh={refreshWorkbench}
        showToggleAll={showToggleAll}
        allGroupsCollapsed={allGroupsCollapsed}
        onToggleAllGroups={toggleAllRequirementGroups}
        showClosedRequirements={showClosedRequirements}
        onShowClosedRequirementsChange={setShowClosedRequirements}
        onCreateRequirement={handleCreateRequirementMenu}
        onOpenVersionSummary={() => setVersionSummaryOpen(true)}
        filtersCollapsed={filtersCollapsed}
        onToggleFilters={() => setFiltersCollapsed((value) => !value)}
        activeFilterCount={activeFilterCount}
        requirementFilter={requirementFilter}
        onRequirementFilterChange={setRequirementFilter}
        versionOptions={versionOptions}
        versionFilter={versionFilter}
        onVersionFilterChange={setVersionFilter}
        productLineOptions={productLineOptions}
        productLineFilters={productLineFilters}
        onProductLineFiltersChange={setProductLineFilters}
        statusOptions={statusOptions}
        statusFilters={statusFilters}
        onStatusFiltersChange={setStatusFilters}
        allRequirementsCount={allRequirements.length}
        filteredGroups={filteredGroups}
        collapsedGroupKeys={collapsedGroupKeys}
        hasSearch={hasSearch}
        selectedRequirementId={selectedRequirementId}
        nodeCompletions={nodeCompletions}
        onSelectRequirement={(requirementId, groupKey) => {
          setSelectedRequirementId(requirementId)
          setSelectedRequirementGroupKey(groupKey)
        }}
        onToggleGroup={toggleRequirementGroup}
      />

      {/* 右侧：需求详情、关联仓库和流程。 */}
      <section className="workbench-main">
        {error && !data ? (
          <div className="workbench-state">
            <div className="workbench-state-card">
              <ErrorRecovery
                title="无法读取当前用户需求"
                error={error ?? ''}
                retrying={loading}
                onRetry={() => void loadRequirements()}
                settingsSection="meegle"
                onOpenSettings={onOpenSettings}
                lastSuccessAt={lastSuccessAt}
              />
            </div>
          </div>
        ) : loading && !data ? (
          <header className="workbench-header workbench-header-skeleton">
            <div className="workbench-heading">
              <Skeleton
                active
                title={{ width: '34%' }}
                paragraph={{ rows: 2, width: ['72%', '30%'] }}
              />
            </div>
          </header>
        ) : selectedRequirement ? (
          <>
            <RequirementHeader
              projectName={projectName}
              versionName={selectedGroup?.versionName ?? null}
              requirement={selectedRequirement}
              requirementUrl={requirementUrl}
              isLocal={selectedRequirementIsLocal}
              loading={loading}
              activityLoading={activityLoading}
              personalStatus={personalStatus}
              personalStatusLoading={personalStatusLoading}
              personalStatusEditing={personalStatusEditing}
              personalStatusDraft={personalStatusDraft}
              onRefresh={refreshWorkbench}
              onCopyName={handleCopyRequirementName}
              onCopyUrl={handleCopyRequirementUrl}
              onPersonalStatusDraftChange={setPersonalStatusDraft}
              onStartPersonalStatusEdit={handleStartPersonalStatusEdit}
              onCancelPersonalStatusEdit={handleCancelPersonalStatusEdit}
              onSavePersonalStatus={handleSavePersonalStatus}
              onAnalyze={handleAnalyzeRequirement}
            />

            <div className="workbench-content" ref={workbenchContentRef}>
              {error ? (
                <Alert
                  className="workbench-inline-alert"
                  type="warning"
                  showIcon
                  closable
                  message="刷新数据失败，当前展示上次同步结果"
                  description={error}
                  onClose={() => setError(null)}
                />
              ) : null}

              <RequirementRepositories
                bindings={repositories.bindings}
                bindingsLoading={repositories.bindingsLoading}
                bindingsError={repositories.bindingsError}
                refreshing={
                  repositories.repositoriesLoading ||
                  repositories.bindingsLoading ||
                  repositories.branchLoadingIds.size > 0
                }
                addBindingOpen={repositories.addBindingOpen}
                onToggleAddBinding={() =>
                  repositories.setAddBindingOpen((value) => !value)
                }
                onRefresh={() => repositories.refreshBindings()}
                repositoryMap={repositories.repositoryMap}
                bindingStatuses={repositories.bindingStatuses}
                openingIdeBindingId={repositories.openingIdeBindingId}
                syncingBindingId={repositories.syncingBindingId}
                removingBindingId={repositories.removingBindingId}
                qingzhouRequirementUrl={repositories.qingzhouRequirementUrl}
                selectedRequirementId={selectedRequirementId}
                repositories={repositories.repositories}
                repositoriesLoading={repositories.repositoriesLoading}
                availableRepositories={repositories.availableRepositories}
                newRepositoryId={repositories.newRepositoryId}
                newBranchName={repositories.newBranchName}
                newRepositoryIsQingzhou={repositories.newRepositoryIsQingzhou}
                newRepositoryBranchesLoading={
                  repositories.newRepositoryBranchesLoading
                }
                newRepositoryBranchOptions={repositories.newRepositoryBranchOptions}
                bindingSaving={repositories.bindingSaving}
                onNewRepositoryChange={repositories.handleNewRepositoryChange}
                onNewBranchChange={repositories.setNewBranchName}
                onOpenCreateBranch={() => repositories.openCreateBranch()}
                onAddBinding={() => repositories.handleAddBinding()}
                onOpenSettings={onOpenSettings}
                onOpenCreateMergeRequest={repositories.handleOpenCreateMergeRequest}
                onCopyBranchName={repositories.handleCopyBranchName}
                onOpenEditBindingBranch={repositories.handleOpenEditBindingBranch}
                onSyncQingzhouBinding={repositories.handleSyncQingzhouBinding}
                onRequestOpenInIde={repositories.handleRequestOpenInIde}
                onRemoveBinding={repositories.handleRemoveBinding}
              />

              {data?.project.projectKey ? (
                <RequirementLinks
                  key={JSON.stringify([data.project.projectKey, selectedRequirement.id])}
                  projectKey={data.project.projectKey}
                  requirementId={selectedRequirement.id}
                  description={selectedDescription}
                  documentUrl={selectedRequirement.documentUrl}
                  requirementUrl={requirementUrl}
                />
              ) : null}

              {selectedRequirement && selectedRequirementIsLocal ? (
                <LocalRequirementDetail
                  requirement={selectedRequirement}
                  deleting={localDeleting}
                  onEdit={handleOpenEditLocalRequirement}
                  onDelete={handleDeleteLocalRequirement}
                />
              ) : null}

              {selectedRequirementIsLocal ? null : (
                <>
                  <RequirementFlowSection
                    activity={activity}
                    activityLoading={activityLoading}
                    activityError={activityError}
                    requirementUrl={requirementUrl}
                    selectedNodeKey={selectedNodeKey}
                    selectedNode={selectedNode}
                    nodeDetailRef={nodeDetailRef}
                    selectedNodeScheduleConflicts={selectedNodeScheduleConflicts}
                    nodeEditing={nodeEditing}
                    nodeEditSubmitting={nodeEditSubmitting}
                    completeSubmitting={completeSubmitting}
                    nodeEditOwnerKeys={nodeEditOwnerKeys}
                    nodeOwnerOptions={nodeOwnerOptions}
                    nodeOwnerSearching={nodeOwnerSearching}
                    nodeEditPoints={nodeEditPoints}
                    nodeEditRange={nodeEditRange}
                    nodeEditActualWorkTime={nodeEditActualWorkTime}
                    nodeRemainingWorkTime={nodeRemainingWorkTime}
                    completeOpen={completeOpen}
                    completeActualWorkTime={completeActualWorkTime}
                    rollbackOpen={rollbackOpen}
                    rollbackSubmitting={rollbackSubmitting}
                    rollbackReason={rollbackReason}
                    onRetryActivity={refreshActivity}
                    onSelectNode={handleSelectNode}
                    onCancelNodeEditing={cancelNodeEditing}
                    onSaveNodeInfo={handleSaveNodeInfo}
                    onOpenNodeEditor={openNodeEditor}
                    onCompleteNode={handleCompleteNode}
                    onOpenComplete={openComplete}
                    onOpenRollback={openRollback}
                    onOwnerKeysChange={setNodeEditOwnerKeys}
                    onOwnerSearch={handleNodeOwnerSearch}
                    onPointsChange={setNodeEditPoints}
                    onRangeChange={setNodeEditRange}
                    onActualWorkTimeChange={setNodeEditActualWorkTime}
                    onCompleteActualWorkTimeChange={setCompleteActualWorkTime}
                    onCloseComplete={closeComplete}
                    onSubmitComplete={submitComplete}
                    onRollbackReasonChange={setRollbackReason}
                    onCloseRollback={closeRollback}
                    onSubmitRollback={submitRollback}
                  />

                  <RequirementInfoSection
                    requirement={displayRequirement ?? selectedRequirement}
                    requirementUrl={requirementUrl}
                    primaryInfoGroups={primaryInfoGroups}
                    moreInfoGroups={moreInfoGroups}
                    descriptionEditing={descriptionEditing}
                    descriptionSaving={descriptionSaving}
                    descriptionDraft={descriptionDraft}
                    descriptionExpanded={descriptionExpanded}
                    moreFieldsOpen={moreFieldsOpen}
                    activity={activity}
                    activityLoading={activityLoading}
                    activityError={activityError}
                    replyToComment={replyToComment}
                    commentDraft={commentDraft}
                    commentSubmitting={commentSubmitting}
                    onDescriptionDraftChange={setDescriptionDraft}
                    onStartDescriptionEdit={handleStartDescriptionEdit}
                    onCancelDescriptionEdit={handleCancelDescriptionEdit}
                    onSaveDescription={() => handleSaveDescription()}
                    onToggleDescriptionExpanded={() =>
                      setDescriptionExpanded((value) => !value)
                    }
                    onToggleMoreFields={() => setMoreFieldsOpen((value) => !value)}
                    onRetryActivity={refreshActivity}
                    onStartReply={handleStartReply}
                    onCancelReply={handleCancelReply}
                    onCommentDraftChange={setCommentDraft}
                    onAddComment={() => handleAddComment()}
                  />
                </>
              )}
            </div>
          </>
        ) : (
          <div className="workbench-state">
            <div className="workbench-state-card">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="从左侧选择一条需求"
              />
              <div className="workbench-state-actions">
                <Button type="primary" onClick={() => loadRequirements()}>
                  重新读取
                </Button>
                <Button onClick={() => onOpenSettings('meegle')}>检查 Meegle 设置</Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <RequirementRepoModals
        mergeRequestBinding={repositories.mergeRequestBinding}
        mergeRequestUrl={repositories.mergeRequestUrl}
        mergeRequestSource={repositories.mergeRequestSource}
        mergeRequestTarget={repositories.mergeRequestTarget}
        mergeRequestBranchOptions={repositories.mergeRequestBranchOptions}
        mergeRequestBranchesLoading={repositories.mergeRequestBranchesLoading}
        mergeRequestWarning={repositories.mergeRequestWarning}
        onMergeRequestSourceChange={repositories.setMergeRequestSource}
        onMergeRequestTargetChange={repositories.setMergeRequestTarget}
        onMergeRequestCancel={repositories.handleCloseMergeRequest}
        onMergeRequestSubmit={repositories.handleSubmitMergeRequest}
        branchChoiceOpen={repositories.branchChoiceOpen}
        branchChoiceBinding={repositories.branchChoiceBinding}
        branchChoiceType={repositories.branchChoiceType}
        canPrefillSession={repositories.canPrefillSession}
        ideSessionPrompt={repositories.ideSessionPrompt}
        onBranchChoiceTypeChange={repositories.setBranchChoiceType}
        onIdeSessionPromptChange={repositories.updateIdeSessionPrompt}
        onBranchChoiceCancel={() => {
          repositories.setBranchChoiceOpen(false)
          repositories.setBranchChoiceBinding(null)
        }}
        onBranchChoiceConfirm={repositories.handleConfirmBranchChoice}
        openIdeConfirmBinding={repositories.openIdeConfirmBinding}
        openIdeConfirmBranch={repositories.openIdeConfirmBranch}
        openIdeRepositoryName={
          repositories.openIdeConfirmBinding
            ? repositories.repositoryMap.get(
                repositories.openIdeConfirmBinding.repositoryId
              )?.name ?? repositories.openIdeConfirmBinding.repositoryId
            : ''
        }
        onOpenIdeCancel={() => {
          repositories.setOpenIdeConfirmBinding(null)
          repositories.setOpenIdeConfirmBranch(null)
        }}
        onOpenIdeConfirm={() => {
          const binding = repositories.openIdeConfirmBinding
          const branchName = repositories.openIdeConfirmBranch

          repositories.setOpenIdeConfirmBinding(null)
          repositories.setOpenIdeConfirmBranch(null)

          if (binding && branchName) {
            repositories.handleOpenInIde(
              binding,
              branchName,
              repositories.canPrefillSession && repositories.ideSessionPrompt
            )
          }
        }}
        createBranchOpen={repositories.createBranchOpen}
        createBranchRepositoryName={
          repositories.newRepositoryId
            ? repositories.repositoryMap.get(repositories.newRepositoryId)?.name ??
              repositories.newRepositoryId
            : '未选择仓库'
        }
        createBranchBase={repositories.createBranchBase}
        createBranchName={repositories.createBranchName}
        createBranchOptions={repositories.newRepositoryBranchOptions}
        createBranchSaving={repositories.createBranchSaving}
        onCreateBranchBaseChange={repositories.setCreateBranchBase}
        onCreateBranchNameChange={repositories.setCreateBranchName}
        onCreateBranchCancel={() => repositories.setCreateBranchOpen(false)}
        onCreateBranchSubmit={() => repositories.handleCreateBranch()}
        branchEditBinding={repositories.branchEditBinding}
        branchEditRepositoryName={
          repositories.branchEditBinding
            ? repositories.repositoryMap.get(
                repositories.branchEditBinding.repositoryId
              )?.name ?? repositories.branchEditBinding.repositoryId
            : ''
        }
        branchEditName={repositories.branchEditName}
        branchEditOptions={repositories.branchEditBranchOptions}
        branchEditLoading={repositories.branchEditBranchLoading}
        branchEditSaving={repositories.branchEditSaving}
        onBranchEditNameChange={repositories.setBranchEditName}
        onBranchEditCancel={() => {
          repositories.setBranchEditBinding(null)
          repositories.setBranchEditName(null)
        }}
        onBranchEditSubmit={() => repositories.handleSaveBindingBranch()}
      />

      <VersionRepositorySummary
        open={versionSummaryOpen}
        preferredVersionKey={versionSummaryPreferredKey}
        onClose={() => setVersionSummaryOpen(false)}
      />

      <LocalRequirementModal
        open={localModalOpen}
        initialRequirement={localModalRequirement}
        versions={localVersionOptions}
        productLines={allProductLineOptions.filter((line) => line !== '未设置产线')}
        saving={localSaving}
        onCancel={() => {
          setLocalModalOpen(false)
          setLocalModalRequirement(null)
        }}
        onSubmit={handleSubmitLocalRequirement}
      />
    </div>
  )
}
