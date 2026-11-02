import { Button, Modal } from 'antd'
import MarkdownContent from '../MarkdownContent/MarkdownContent'

interface ChangelogModalProps {
  open: boolean
  content: string
  onClose: () => void
}

/**
 * 更新日志弹窗。
 * 内容直接读取根目录 CHANGELOG.md，随应用构建一起更新。
 */
export default function ChangelogModal({
  open,
  content,
  onClose
}: ChangelogModalProps): JSX.Element {
  return (
    <Modal
      open={open}
      width={760}
      centered
      title="更新日志"
      footer={
        <Button type="primary" onClick={onClose}>
          关闭
        </Button>
      }
      onCancel={onClose}
    >
      <div className="changelog-modal-content">
        {content.trim() ? (
          <MarkdownContent content={content} />
        ) : (
          <div className="changelog-empty">暂无更新日志</div>
        )}
      </div>
    </Modal>
  )
}
