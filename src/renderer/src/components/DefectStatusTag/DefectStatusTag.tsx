import '../RequirementHeader/RequirementHeader.css'

interface DefectStatusTagProps {
  value: string | null
  tone: string
}

/**
 * 缺陷状态/优先级/严重程度标签。
 * 复用需求头部的标签样式。
 */
export default function DefectStatusTag({
  value,
  tone
}: DefectStatusTagProps): JSX.Element {
  return (
    <span className={`requirement-header-tag is-${tone}`}>{value ?? '未知'}</span>
  )
}
