import {
  ExportOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SwapOutlined
} from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import '../RequirementHeader/RequirementHeader.css'
import type { MeegleDefect } from '../../../../types/defects'
import {
  formatDate,
  getDefectVersionLabel,
  getPriorityTone,
  getSeverityTone,
  getStatusTone
} from '../../pages/DefectWorkbench/defect-utils'
import RobotMark from '../RobotMark/RobotMark'
import DefectStatusTag from '../DefectStatusTag/DefectStatusTag'

interface DefectHeaderProps {
  projectName: string
  defect: MeegleDefect
  defectUrl: string | null
  loading: boolean
  onRefresh: () => void
  onAnalyze: () => void
  onOpenTransition: () => void
}

/**
 * 缺陷详情头部：标题、状态、版本和常用操作。
 */
export default function DefectHeader({
  projectName,
  defect,
  defectUrl,
  loading,
  onRefresh,
  onAnalyze,
  onOpenTransition
}: DefectHeaderProps): JSX.Element {
  return (
    <header className="workbench-header">
      <div className="workbench-heading">
        <span className="workbench-eyebrow">
          {projectName} / {getDefectVersionLabel(defect)}
        </span>
        <div className="workbench-title-row">
          <Tooltip title="刷新数据">
            <Button
              type="text"
              size="small"
              className="workbench-refresh-icon"
              icon={<ReloadOutlined />}
              loading={loading}
              aria-label="刷新数据"
              onClick={() => onRefresh()}
            />
          </Tooltip>
          <h1>{defect.name}</h1>
        </div>
        <div className="workbench-heading-meta">
          <DefectStatusTag
            value={defect.status}
            tone={getStatusTone(defect.status)}
          />
          {defect.priority ? (
            <DefectStatusTag
              value={defect.priority}
              tone={getPriorityTone(defect.priority)}
            />
          ) : null}
          {defect.severity ? (
            <DefectStatusTag
              value={defect.severity}
              tone={getSeverityTone(defect.severity)}
            />
          ) : null}
          <span className="workbench-updated-at">
            更新于 {formatDate(defect.updatedAt)}
          </span>
        </div>
        <div className="workbench-header-actions">
          <div className="workbench-scope-note">
            <span className="workbench-scope-note-icon">
              <InfoCircleOutlined />
            </span>
            <div className="workbench-scope-note-copy">
              <strong>研发执行视图</strong>
              <span>
                {defectUrl
                  ? '完整字段、附件、评论和复杂流程请前往飞书处理。'
                  : '这里展示研发处理所需的缺陷字段和流程操作。'}
              </span>
            </div>
            <div className="workbench-scope-note-actions">
              {defectUrl ? (
                <Button
                  type="primary"
                  icon={<ExportOutlined />}
                  onClick={() => window.electron.openEmbeddedBrowser(defectUrl)}
                >
                  在飞书中处理
                </Button>
              ) : null}
              <Button
                type="primary"
                ghost
                icon={<RobotMark />}
                onClick={onAnalyze}
              >
                AI 分析
              </Button>
              <Button
                type="primary"
                danger
                icon={<SwapOutlined />}
                onClick={onOpenTransition}
              >
                处理缺陷
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
