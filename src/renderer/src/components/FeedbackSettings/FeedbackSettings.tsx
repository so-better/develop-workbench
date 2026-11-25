import { useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent } from 'react'
import { App, Button, Image, Input } from 'antd'
import { DeleteOutlined, PictureOutlined } from '@ant-design/icons'
import type { AdbInfo } from '../../../../types/adb'
import type {
  FeedbackImageInput,
  FeedbackSubmission,
  FeedbackSystemInfo
} from '../../../../types/feedback'
import type { AppInfo } from '../../../../types/app'
import type { GitInfo } from '../../../../types/git'
import type { IdeConfigState } from '../../../../types/ide'
import type { LarkUser } from '../../../../types/lark'
import type { MeegleState } from '../../../../types/meegle'
import { getErrorMessage } from '../../../../utils'
import './FeedbackSettings.css'

const MAX_DESCRIPTION_LENGTH = 2_000
const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const formatBytes = (bytes: number): string =>
  `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`

/**
 * 应用内反馈。
 * 自动附带诊断信息，提交到团队飞书反馈群。
 */
export default function FeedbackSettings(): JSX.Element {
  const { message } = App.useApp()
  const [description, setDescription] = useState('')
  const [sending, setSending] = useState(false)
  const [images, setImages] = useState<FeedbackImageInput[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const collectFeedback = async (): Promise<FeedbackSubmission> => {
    const [appInfo, systemInfo, larkUser, meegle, git, ide, adb] =
      await Promise.all([
        window.electron.getAppInfo().catch(() => null as AppInfo | null),
        window.electron
          .getFeedbackSystemInfo()
          .catch(() => null as FeedbackSystemInfo | null),
        window.electron.getLarkUser().catch(() => null as LarkUser | null),
        window.electron.getMeegleState().catch(() => null as MeegleState | null),
        window.electron.getGitInfo().catch(() => null as GitInfo | null),
        window.electron.getIdeConfig().catch(() => null as IdeConfigState | null),
        window.electron.getAdbInfo().catch(() => null as AdbInfo | null)
      ])

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const screenInfo = `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x`

    const meegleStatus = meegle?.cli.available
      ? meegle.authenticated
        ? '已授权'
        : '未授权'
      : '未检测到 CLI'

    return {
      submitter: larkUser?.name ?? '当前用户',
      description: description.trim(),
      diagnostics: [
        { label: '提交人', value: larkUser?.name ?? '当前用户' },
        { label: '时间', value: new Date().toLocaleString('zh-CN') },
        { label: '版本', value: `v${appInfo?.appVersion ?? '未知'}` },
        {
          label: '平台',
          value: `${systemInfo?.platform ?? appInfo?.platform ?? window.electron.platform} / ${systemInfo?.arch ?? '未知'}`
        },
        {
          label: '系统',
          value: systemInfo
            ? `${systemInfo.osType} ${systemInfo.osRelease}`
            : '未知'
        },
        { label: '语言', value: navigator.language },
        { label: '时区', value: timezone },
        { label: '屏幕', value: screenInfo },
        {
          label: 'CPU',
          value: systemInfo
            ? `${systemInfo.cpuModel}（${systemInfo.cpuCount} 核）`
            : '未知'
        },
        {
          label: '内存',
          value: systemInfo
            ? `总计 ${formatBytes(systemInfo.totalMemory)} / 可用 ${formatBytes(systemInfo.freeMemory)}`
            : '未知'
        },
        { label: 'Lark CLI', value: larkUser ? '已授权' : '未授权' },
        { label: 'Meegle CLI', value: meegleStatus },
        {
          label: 'Git',
          value: git?.available ? `可用${git.version ? `（${git.version}）` : ''}` : '不可用'
        },
        {
          label: 'IDE',
          value: ide?.config && ide.available ? `已配置（${ide.config.name}）` : '未配置'
        },
        {
          label: 'ADB',
          value: adb?.available ? `可用${adb.version ? `（${adb.version}）` : ''}` : '不可用'
        }
      ],
      images
    }
  }


  const addImages = async (files: File[]): Promise<void> => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))

    if (imageFiles.length === 0) return

    const next = [...images]

    for (const file of imageFiles) {
      if (next.length >= MAX_IMAGES) {
        message.warning(`最多添加 ${MAX_IMAGES} 张图片`)
        break
      }

      if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
        message.warning('只支持 PNG、JPEG、WebP 图片')
        continue
      }

      if (file.size > MAX_IMAGE_BYTES) {
        message.warning('单张图片不能超过 5MB')
        continue
      }

      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })

      if (dataUrl) {
        next.push({ name: file.name || 'feedback-image', dataUrl })
      }
    }

    setImages(next)
  }

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (files.length === 0) return

    event.preventDefault()
    void addImages(files)
  }

  const handleSubmit = async (): Promise<void> => {
    if (!description.trim()) {
      message.warning('请先填写问题描述')
      return
    }

    setSending(true)

    try {
      const result = await window.electron.sendFeedback(await collectFeedback())
      setDescription('')
      setImages([])
      message.success(
        result.failedImages > 0
          ? `反馈已提交，但 ${result.failedImages} 张图片发送失败`
          : '反馈已提交，团队会尽快处理'
      )
    } catch (submitError) {
      message.error(getErrorMessage(submitError, '发送反馈失败'))
    } finally {
      setSending(false)
    }
  }


  return (
    <div className="feedback-settings">
      <p className="feedback-intro">
        提交后会发送给团队，用于收集问题和改进建议。
      </p>

      <div className="feedback-form">
        <div className="feedback-label-row">
          <label htmlFor="feedback-description">问题描述</label>
          <span className="feedback-count">
            {description.length}/{MAX_DESCRIPTION_LENGTH}
          </span>
        </div>
        <Input.TextArea
          id="feedback-description"
          value={description}
          maxLength={MAX_DESCRIPTION_LENGTH}
          autoSize={{ minRows: 6, maxRows: 12 }}
          placeholder="描述你遇到的问题、复现步骤或希望优化的体验"
          onChange={(event) => setDescription(event.target.value)}
          onPaste={handlePaste}
        />
        <p className="feedback-note">
          支持粘贴截图或添加图片，最多 {MAX_IMAGES} 张、单张 5MB；提交时会自动附带版本、平台、提交人和 CLI 状态，不包含 API Key、Cookie 或本地文件路径。
        </p>

        {images.length > 0 ? (
          <div className="feedback-images">
            {images.map((image, index) => (
              <div className="feedback-image" key={`${image.name}-${index}`}>
                <Image
                  src={image.dataUrl}
                  alt={image.name}
                  width={86}
                  height={64}
                  style={{ objectFit: 'cover' }}
                  preview={{ mask: '预览' }}
                />
                <button
                  type="button"
                  aria-label={`移除图片 ${index + 1}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setImages((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }}
                >
                  <DeleteOutlined />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            void addImages(files)
          }}
        />

        <div className="feedback-actions">
          <Button
            type="primary"
            loading={sending}
            disabled={!description.trim()}
            onClick={() => void handleSubmit()}
          >
            提交反馈
          </Button>
          <Button
            icon={<PictureOutlined />}
            disabled={sending || images.length >= MAX_IMAGES}
            onClick={() => fileInputRef.current?.click()}
          >
            添加图片
          </Button>
        </div>
      </div>
    </div>
  )
}
