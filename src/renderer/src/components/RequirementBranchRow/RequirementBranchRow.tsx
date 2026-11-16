import type { ReactNode } from 'react'
import { Button, Tooltip } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import './RequirementBranchRow.css'

interface RequirementBranchRowProps {
  label: string
  value: string | null
  placeholder: string
  status?: ReactNode
  tone?: 'requirement' | 'iteration'
  icon?: ReactNode
  onCopy: (value: string) => void
}

/**
 * 只读分支行：分支名 + 复制按钮 + 状态标签。
 */
export default function RequirementBranchRow({
  label,
  value,
  placeholder,
  status,
  tone,
  icon,
  onCopy
}: RequirementBranchRowProps): JSX.Element {
  return (
    <div className={`requirement-repo-branch-row${tone ? ` is-${tone}` : ''}`}>
      {icon ? <span className="requirement-repo-branch-icon">{icon}</span> : null}
      <span className="requirement-repo-branch-label">{label}</span>
      {value ? (
        <span className="requirement-repo-branch-name" title={value}>
          {value}
        </span>
      ) : (
        <span className="requirement-repo-branch-empty">{placeholder}</span>
      )}
      {value ? (
        <Tooltip title="复制分支名">
          <Button
            type="text"
            size="small"
            className="requirement-repo-copy-branch"
            icon={<CopyOutlined />}
            aria-label={`复制 ${label}`}
            onClick={() => onCopy(value)}
          />
        </Tooltip>
      ) : (
        <span className="requirement-repo-copy-slot" />
      )}
      <span className="requirement-repo-branch-status">{status}</span>
    </div>
  )
}
