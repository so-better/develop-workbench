import { Modal } from 'antd'
import FeedbackSettings from './FeedbackSettings'

interface FeedbackModalProps {
  /** 是否打开反馈弹窗。 */
  open: boolean

  /** 关闭弹窗。 */
  onClose: () => void
}

/** 独立反馈弹窗，不依赖设置面板。 */
export default function FeedbackModal({
  open,
  onClose
}: FeedbackModalProps): JSX.Element {
  return (
    <Modal
      title="提交反馈"
      open={open}
      footer={null}
      width={620}
      destroyOnHidden
      onCancel={onClose}
    >
      <FeedbackSettings />
    </Modal>
  )
}
