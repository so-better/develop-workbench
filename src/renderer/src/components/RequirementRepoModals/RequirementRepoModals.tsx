import {
  Alert,
  Checkbox,
  Input,
  Modal,
  Radio,
  Select
} from 'antd'
import type { RequirementRepoBinding } from '../../../../types/bindings'
import './RequirementRepoModals.css'

interface FilterOption {
  value: string
  label: string
}

interface RequirementRepoModalsProps {
  mergeRequestBinding: RequirementRepoBinding | null
  mergeRequestUrl: string | null
  mergeRequestSource: string | null
  mergeRequestTarget: string | null
  mergeRequestBranchOptions: FilterOption[]
  mergeRequestBranchesLoading: boolean
  mergeRequestWarning: string | null
  onMergeRequestSourceChange: (value: string) => void
  onMergeRequestTargetChange: (value: string) => void
  onMergeRequestCancel: () => void
  onMergeRequestSubmit: () => void

  branchChoiceOpen: boolean
  branchChoiceBinding: RequirementRepoBinding | null
  branchChoiceType: 'requirement' | 'iteration'
  canPrefillSession: boolean
  ideSessionPrompt: boolean
  onBranchChoiceTypeChange: (type: 'requirement' | 'iteration') => void
  onIdeSessionPromptChange: (checked: boolean) => void
  onBranchChoiceCancel: () => void
  onBranchChoiceConfirm: () => void

  openIdeConfirmBinding: RequirementRepoBinding | null
  openIdeConfirmBranch: string | null
  openIdeRepositoryName: string
  onOpenIdeCancel: () => void
  onOpenIdeConfirm: () => void

  createBranchOpen: boolean
  createBranchRepositoryName: string
  createBranchBase: string | null
  createBranchName: string
  createBranchOptions: FilterOption[]
  createBranchSaving: boolean
  onCreateBranchBaseChange: (value: string) => void
  onCreateBranchNameChange: (value: string) => void
  onCreateBranchCancel: () => void
  onCreateBranchSubmit: () => void

  branchEditBinding: RequirementRepoBinding | null
  branchEditRepositoryName: string
  branchEditName: string | null
  branchEditOptions: FilterOption[]
  branchEditLoading: boolean
  branchEditSaving: boolean
  onBranchEditNameChange: (value: string) => void
  onBranchEditCancel: () => void
  onBranchEditSubmit: () => void
}

/**
 * 需求关联仓库相关的弹窗：合并请求、IDE 分支选择、分支创建和修改。
 */
export default function RequirementRepoModals({
  mergeRequestBinding,
  mergeRequestUrl,
  mergeRequestSource,
  mergeRequestTarget,
  mergeRequestBranchOptions,
  mergeRequestBranchesLoading,
  mergeRequestWarning,
  onMergeRequestSourceChange,
  onMergeRequestTargetChange,
  onMergeRequestCancel,
  onMergeRequestSubmit,
  branchChoiceOpen,
  branchChoiceBinding,
  branchChoiceType,
  canPrefillSession,
  ideSessionPrompt,
  onBranchChoiceTypeChange,
  onIdeSessionPromptChange,
  onBranchChoiceCancel,
  onBranchChoiceConfirm,
  openIdeConfirmBinding,
  openIdeConfirmBranch,
  openIdeRepositoryName,
  onOpenIdeCancel,
  onOpenIdeConfirm,
  createBranchOpen,
  createBranchRepositoryName,
  createBranchBase,
  createBranchName,
  createBranchOptions,
  createBranchSaving,
  onCreateBranchBaseChange,
  onCreateBranchNameChange,
  onCreateBranchCancel,
  onCreateBranchSubmit,
  branchEditBinding,
  branchEditRepositoryName,
  branchEditName,
  branchEditOptions,
  branchEditLoading,
  branchEditSaving,
  onBranchEditNameChange,
  onBranchEditCancel,
  onBranchEditSubmit
}: RequirementRepoModalsProps): JSX.Element {
  /** 复用在分支选择和打开 IDE 弹窗中的会话预置选项。 */
  const renderSessionOption = (): JSX.Element | null =>
    canPrefillSession ? (
      <div className="requirement-ide-session-option">
        <Checkbox
          className="requirement-ide-session-checkbox"
          checked={ideSessionPrompt}
          onChange={(event) => onIdeSessionPromptChange(event.target.checked)}
        >
          预置需求分析会话
        </Checkbox>
        <p className="settings-help">
          勾选后会创建 AI 会话并预填当前需求的飞书链接；取消勾选则只打开 IDE。
        </p>
      </div>
    ) : null

  return (
    <>
      <Modal
        title="创建合并请求"
        open={Boolean(mergeRequestBinding)}
        okText="打开创建页"
        cancelText="取消"
        destroyOnHidden
        okButtonProps={{
          disabled:
            !mergeRequestUrl ||
            !mergeRequestSource ||
            !mergeRequestTarget ||
            mergeRequestSource === mergeRequestTarget
        }}
        onOk={onMergeRequestSubmit}
        onCancel={onMergeRequestCancel}
      >
        <div className="requirement-mr-form">
          <p>
            选择合并请求的来源和目标分支，将在应用内浏览器打开 Codeup 创建页面。
            冲突由 Codeup 显示和处理。
          </p>
          {mergeRequestWarning ? (
            <Alert type="warning" showIcon message={mergeRequestWarning} />
          ) : null}
          <label>来源分支</label>
          <Select
            showSearch
            className="requirement-mr-branch"
            value={mergeRequestSource ?? undefined}
            options={mergeRequestBranchOptions}
            loading={mergeRequestBranchesLoading}
            placeholder="选择来源分支"
            optionFilterProp="label"
            onChange={(value: string) => onMergeRequestSourceChange(value)}
          />
          <label>目标分支</label>
          <Select
            showSearch
            className="requirement-mr-branch"
            value={mergeRequestTarget ?? undefined}
            options={mergeRequestBranchOptions}
            loading={mergeRequestBranchesLoading}
            placeholder="选择目标分支"
            optionFilterProp="label"
            onChange={(value: string) => onMergeRequestTargetChange(value)}
          />
          {mergeRequestSource === mergeRequestTarget && mergeRequestSource ? (
            <Alert type="warning" showIcon message="来源分支和目标分支不能相同" />
          ) : null}
          {!mergeRequestUrl && mergeRequestSource && mergeRequestTarget ? (
            <Alert
              type="warning"
              showIcon
              message="无法生成合并请求地址，请检查远程仓库地址"
            />
          ) : null}
        </div>
      </Modal>

      <Modal
        title="选择打开 IDE 的分支"
        open={branchChoiceOpen}
        okText="打开 IDE"
        cancelText="取消"
        destroyOnHidden
        onOk={onBranchChoiceConfirm}
        onCancel={onBranchChoiceCancel}
      >
        <div className="requirement-branch-choice">
          <p>该轻舟仓库同时存在需求分支和迭代分支，请选择要打开的分支。</p>
          <Radio.Group
            value={branchChoiceType}
            onChange={(event) =>
              onBranchChoiceTypeChange(
                event.target.value as 'requirement' | 'iteration'
              )
            }
          >
            <Radio value="requirement">
              <span className="requirement-branch-choice-label">需求分支</span>
              <span className="requirement-branch-choice-name">
                {branchChoiceBinding?.requirementBranch}
              </span>
            </Radio>
            <Radio value="iteration">
              <span className="requirement-branch-choice-label">迭代分支</span>
              <span className="requirement-branch-choice-name">
                {branchChoiceBinding?.iterationBranch}
              </span>
            </Radio>
          </Radio.Group>
          {renderSessionOption()}
        </div>
      </Modal>

      <Modal
        title="打开 IDE"
        open={Boolean(openIdeConfirmBinding)}
        okText="打开 IDE"
        cancelText="取消"
        destroyOnHidden
        onOk={onOpenIdeConfirm}
        onCancel={onOpenIdeCancel}
      >
        <div className="requirement-ide-open-confirm">
          <p>即将在 IDE 中打开仓库「{openIdeRepositoryName}」。</p>
          {openIdeConfirmBranch ? (
            <p className="requirement-ide-open-branch">
              分支：{openIdeConfirmBranch}
            </p>
          ) : null}
          {renderSessionOption()}
        </div>
      </Modal>

      <Modal
        title="新建开发分支"
        open={createBranchOpen}
        okText="创建并绑定"
        cancelText="取消"
        okButtonProps={{
          disabled: !createBranchBase || !createBranchName.trim()
        }}
        confirmLoading={createBranchSaving}
        destroyOnHidden
        onOk={onCreateBranchSubmit}
        onCancel={onCreateBranchCancel}
      >
        <div className="requirement-branch-create-form">
          <label>仓库</label>
          <div className="requirement-branch-create-repo">
            {createBranchRepositoryName}
          </div>
          <label>基线分支</label>
          <Select
            showSearch
            value={createBranchBase ?? undefined}
            options={createBranchOptions}
            placeholder="选择基线分支"
            onChange={(value: string) => onCreateBranchBaseChange(value)}
          />
          <label>新分支名</label>
          <Input
            value={createBranchName}
            placeholder="feat/首字母/需求ID"
            spellCheck={false}
            onChange={(event) => onCreateBranchNameChange(event.target.value)}
          />
          <p>会从基线分支创建本地分支，并自动绑定到当前需求。</p>
        </div>
      </Modal>

      <Modal
        title="修改开发分支"
        open={Boolean(branchEditBinding)}
        okText="保存"
        cancelText="取消"
        okButtonProps={{
          disabled:
            !branchEditName || branchEditName === branchEditBinding?.branchName
        }}
        confirmLoading={branchEditSaving}
        destroyOnHidden
        onOk={onBranchEditSubmit}
        onCancel={onBranchEditCancel}
      >
        <div className="requirement-branch-create-form">
          <label>仓库</label>
          <div className="requirement-branch-create-repo">
            {branchEditRepositoryName}
          </div>
          <label>开发分支</label>
          <Select
            showSearch
            value={branchEditName ?? undefined}
            options={branchEditOptions}
            loading={branchEditLoading}
            placeholder="选择开发分支"
            optionFilterProp="label"
            onChange={(value: string) => onBranchEditNameChange(value)}
          />
          <p>只更新需求与分支的绑定，不会切换本地工作区的当前分支。</p>
        </div>
      </Modal>
    </>
  )
}
