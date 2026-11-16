import dayjs from 'dayjs'
import { pinyin } from 'pinyin-pro'
import type {
  MeegleRequirement,
  MeegleRequirementComment
} from '../../../../types/requirements'

/**
 * 状态对应的视觉分组。
 */
export const getStatusTone = (status: string | null): string => {
  const value = status ?? ''

  // “待上线/待发布”仍属于未完成状态，必须在“上线/发布”之前判断。
  if (/待上线|待发布|待验收|待验证|待测试/.test(value)) return 'testing'
  if (/终止|取消|打回|拒绝/.test(value)) return 'danger'
  if (/未开始|待开始|待处理/.test(value)) return 'idle'
  if (/测试|验收/.test(value)) return 'testing'
  if (/完成|结束|上线|发布/.test(value)) return 'done'
  if (/开始|开发|进行|处理中/.test(value)) return 'active'

  return 'neutral'
}

/** 优先级对应的视觉分组。 */
export const getPriorityTone = (priority: string | null): string => {
  if (priority === 'P0') return 'p0'
  if (priority === 'P1') return 'p1'
  if (priority === 'P2') return 'p2'

  return 'default'
}

/** 格式化同步时间。 */
export const formatFetchedAt = (value: string): string => {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** 格式化需求更新时间。 */
export const formatUpdatedAt = (value: string | null): string => {
  if (!value) return '更新时间未知'

  const date = value.slice(0, 10)
  const today = new Date()
  const todayValue = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-')

  if (date === todayValue) return '今天更新'

  return `${date.slice(5, 7)}-${date.slice(8, 10)} 更新`
}

/** 去掉需求类型里的版本后缀，例如“技术需求1.0”显示为“技术需求”。 */
export const formatRequirementType = (value: string | null): string | null =>
  value ? value.replace(/1\.0$/, '').trim() || null : null

/** 去掉飞书内容里的隐藏标记。 */
const stripFeishuMarkers = (content: string): string =>
  content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

/** 去掉评论里的隐藏提及信息，保留可读正文。 */
export const formatCommentContent = (content: string): string =>
  stripFeishuMarkers(content) || '（空白评论）'

/** 清理 Markdown 内容。 */
export const cleanMarkdownContent = (content: string): string =>
  stripFeishuMarkers(content)

/** 获取需求所属产线；正式需求取级联路径最后一级，本地需求使用已保存的产线。 */
export const getRequirementProductLines = (requirement: MeegleRequirement): string[] => {
  const segments = requirement.productLines
    .map((line) => line.trim())
    .filter(Boolean)
  const productLine = segments[segments.length - 1]

  return productLine ? [productLine] : ['未设置产线']
}

/** 按产品线聚合需求，并保持稳定排序。 */
export const groupRequirementsByProductLine = (
  requirements: MeegleRequirement[]
): Array<{ key: string; label: string; requirements: MeegleRequirement[] }> => {
  const groups = new Map<string, MeegleRequirement[]>()

  for (const requirement of requirements) {
    for (const label of getRequirementProductLines(requirement)) {
      const items = groups.get(label) ?? []

      items.push(requirement)
      groups.set(label, items)
    }
  }

  return [...groups.entries()]
    .map(([label, items]) => ({ key: label, label, requirements: items }))
    .sort((left, right) => {
      if (left.label === '未设置产线') return 1
      if (right.label === '未设置产线') return -1

      return left.label.localeCompare(right.label, 'zh-CN', { numeric: true })
    })
}

/** 流程节点状态文案。 */
export const getNodeStatusLabel = (status: string): string => {
  if (status === 'doing') return '进行中'
  if (status === 'finished' || status === 'done') return '已完成'
  if (status === 'not_started') return '未开始'

  return status || '未知状态'
}

/** 将飞书节点状态映射为视觉分组。 */
export const getNodeTone = (status: string): string => {
  if (status === 'doing') return 'doing'
  if (status === 'finished' || status === 'done') return 'done'

  return 'idle'
}

/** 格式化节点总排期，例如 10-16 ~ 10-16。 */
export const formatNodeRange = (start: string | null, end: string | null): string => {
  if (!start && !end) return '未设置'

  const startText = start ? dayjs(start).format('MM-DD') : '未设置'
  const endText = end ? dayjs(end).format('MM-DD') : '未设置'

  return `${startText} ~ ${endText}`
}

/** 格式化工时，统一使用“人天”。 */
export const formatWorkTime = (value: number | null): string =>
  value !== null ? `${value} 人天` : '未设置'

/** 实际工时未登记时与飞书保持一致，显示“暂无”。 */
export const formatActualWorkTime = (value: number | null): string =>
  value !== null ? `${value} 人天` : '暂无'

/** 剩余工时缺少实际工时时显示“- 人天”，而不是未填写。 */
export const formatRemainingWorkTime = (value: number | null): string =>
  value !== null ? `${value} 人天` : '- 人天'

/** 格式化单个排期日期，用于流程图冲突提示。 */
export const formatScheduleDate = (value: string | null): string =>
  value ? dayjs(value).format('MM-DD') : '未设置'

/** 将 SSH/HTTPS 远程地址转换为仓库 HTTPS 根地址。 */
export const getRemoteRepositoryBaseUrl = (
  remoteUrl?: string | null
): string | null => {
  if (!remoteUrl?.trim()) return null

  let normalized = remoteUrl.trim()

  const scpMatch = normalized.match(/^git@([^:]+):(.+)$/)
  const sshMatch = normalized.match(/^ssh:\/\/git@([^/]+)\/(.+)$/)

  if (scpMatch) {
    normalized = `https://${scpMatch[1]}/${scpMatch[2]}`
  } else if (sshMatch) {
    normalized = `https://${sshMatch[1]}/${sshMatch[2]}`
  }

  try {
    const url = new URL(normalized)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

    const path = url.pathname.replace(/\.git\/?$/i, '').replace(/\/$/, '')

    return path ? `${url.origin}${path}` : null
  } catch {
    return null
  }
}

/** 打开远程仓库分支页面。 */
export const getRemoteBranchesUrl = (
  remoteUrl?: string | null
): string | null => {
  const baseUrl = getRemoteRepositoryBaseUrl(remoteUrl)

  return baseUrl ? `${baseUrl}/branches` : null
}

/** 提取用户姓名首字母，中文按拼音首字母转换。 */
export const getUserNameInitials = (name: string | null | undefined): string => {
  const normalized = name?.trim()

  if (!normalized) return 'dev'

  if (!/[\u3400-\u9fff]/.test(normalized)) {
    const words = normalized.match(/[a-z]+/gi) ?? []
    const initials = words.map((word) => word[0]).join('').toLowerCase()

    return initials.slice(0, 4) || 'dev'
  }

  const initials = pinyin(normalized, {
    pattern: 'first',
    toneType: 'none',
    type: 'array'
  })
    .join('')
    .replace(/[^a-z]/gi, '')
    .toLowerCase()

  return initials.slice(0, 4) || 'dev'
}

/** 判断是否为本地临时需求。 */
export const isLocalRequirementId = (id: string | null): boolean =>
  Boolean(id?.startsWith('local:'))

/** 按 Codeup 地址格式生成创建合并请求页面。 */
export const getMergeRequestUrl = (
  remoteUrl: string | null | undefined,
  sourceBranch: string,
  targetBranch: string
): string | null => {
  const baseUrl = getRemoteRepositoryBaseUrl(remoteUrl)

  if (!baseUrl) return null

  return `${baseUrl}/changes/new?target_branch=${encodeURIComponent(
    targetBranch
  )}&source_branch=${encodeURIComponent(sourceBranch)}`
}

/** 构造引用回复内容。 */
export const buildReplyContent = (
  comment: MeegleRequirementComment,
  replyText: string
): string => {
  const quoted = formatCommentContent(comment.content)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const creator = comment.creator
  const text = replyText.trim()

  if (!creator) return `${quoted}\n\n${text}`

  return `${quoted}\n> —— ${creator.name}\n\n@${creator.name} ${text}`
}
