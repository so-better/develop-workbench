import dayjs from 'dayjs'
import { parseReleaseDate } from '../../../../utils'
import type { MeegleDefect } from '../../../../types/defects'

/** 格式化日期。 */
export const formatDate = (value: string | null): string =>
  value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD') : '未填写'

/** 格式化同步时间。 */
export const formatFetchedAt = (value: string): string =>
  dayjs(value).isValid() ? dayjs(value).format('MM-DD HH:mm') : value

/** 格式化评论时间。 */
export const formatCommentTime = (value: string | null): string =>
  value && dayjs(value).isValid() ? dayjs(value).format('MM-DD HH:mm') : (value ?? '')

/** 清理飞书描述里的内部注释标记。 */
export const cleanDescription = (content: string): string =>
  content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

/** 缺陷状态对应的视觉分组。 */
export const getStatusTone = (status: string | null): string => {
  const value = status ?? ''

  // “未完成/未关闭/未解决”等不是完成态，必须先于完成态判断。
  if (/^未|未完成|未关闭|未解决/.test(value)) return 'idle'
  // 完成态优先判断，避免“测试通过”被归到测试中。
  if (/测试通过|已解决|已修复|关闭|完成|结束|done|closed|resolved/i.test(value)) {
    return 'done'
  }
  if (/终止|取消|打回|拒绝|重新打开|reopen/i.test(value)) return 'danger'
  if (/待验证|待测试|待验收|验证中|测试中|review/i.test(value)) return 'testing'
  if (/挂起|暂缓|暂停|on hold/i.test(value)) return 'idle'
  if (/新建|打开|open/i.test(value)) return 'active'
  if (/未开始|待开始|待处理|idle/i.test(value)) return 'idle'
  if (/开发|进行|处理中|修复中|doing|progress/i.test(value)) return 'active'

  return 'neutral'
}

/** 优先级对应的视觉分组。 */
export const getPriorityTone = (priority: string | null): string => {
  switch (priority) {
    case 'P0':
      return 'p0'
    case 'P1':
      return 'p1'
    case 'P2':
      return 'p2'
    default:
      return 'default'
  }
}

/** 严重程度对应的视觉分组。 */
export const getSeverityTone = (severity: string | null): string => {
  const value = severity ?? ''

  if (/致命|严重/.test(value)) return 'p0'
  if (/一般/.test(value)) return 'p1'
  if (/轻微|提示/.test(value)) return 'p2'

  return 'default'
}

/** 缺陷按规划版本归并；缺少规划版本时回退到规划迭代。 */
export const getDefectVersionEntries = (
  defect: MeegleDefect
): Array<{ key: string; label: string }> => {
  const versions = Array.from(
    new Set(
      defect.planningVersions
        .map((version) => version.trim())
        .filter(Boolean)
    )
  )

  if (versions.length > 0) {
    return versions.map((version) => {
      const date = parseReleaseDate(version)
      return {
        key: date ? `date:${date}` : `version:${version}`,
        label: version
      }
    })
  }

  if (defect.iterationDate) {
    return [
      {
        key: `date:${defect.iterationDate}`,
        label: defect.iterationDate.replace(/-/g, '')
      }
    ]
  }

  if (defect.iterationId) {
    return [
      {
        key: defect.iterationId,
        label: defect.iterationName ?? '未规划版本'
      }
    ]
  }

  if (defect.iterationName) {
    return [
      {
        key: `version:${defect.iterationName}`,
        label: defect.iterationName
      }
    ]
  }

  return [{ key: 'unplanned', label: '未规划版本' }]
}

/** 获取缺陷所属版本筛选 key。 */
export const getDefectVersionKeys = (defect: MeegleDefect): string[] =>
  getDefectVersionEntries(defect).map((entry) => entry.key)

/** 获取缺陷展示用版本名。 */
export const getDefectVersionLabel = (defect: MeegleDefect): string =>
  defect.planningVersions[0] ?? defect.iterationName ?? '未规划版本'

/** 获取缺陷所属产线；取级联路径最后一级。 */
export const getDefectProductLine = (defect: MeegleDefect): string => {
  const segments = defect.productLines
    .map((line) => line.trim())
    .filter(Boolean)

  return segments[segments.length - 1] ?? '未设置产线'
}
