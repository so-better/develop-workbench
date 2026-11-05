import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { normalizeRequirementLinkUrl } from '../../../../types/requirement-links'
import type { RequirementLinkInput } from '../../../../types/requirement-links'
import { trimUrlTrailingText } from '../../../../utils'

interface LinkNode {
  type: string
  value?: string
  url?: string
  identifier?: string
  children?: LinkNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}
/** 合并链接内的强调等嵌套节点，保留用户看到的文字作为名称。 */
const textOf = (node: LinkNode): string => node.value ?? node.children?.map(textOf).join('') ?? ''

const parser = unified().use(remarkParse).use(remarkGfm)
const parseHtml = (value: string): DocumentFragment => {
  // template 内容保持惰性，图片、iframe 等不会因提取链接而加载。
  const template = document.createElement('template')
  template.innerHTML = value
  return template.content
}

/** 从 Story 详情路径中读取需求 ID，兼容不同空间前缀写法。 */
const STORY_DETAIL_PATH = /\/story\/detail\/([^/]+)\/?$/i

const getStoryDetailId = (url: URL): string | null => {
  try {
    return STORY_DETAIL_PATH.exec(decodeURIComponent(url.pathname))?.[1] ?? null
  } catch {
    return null
  }
}

/** 当前 Story 的不同页签、查询参数、空间前缀和锚点仍视为同一需求页面。 */
export const isCurrentRequirementUrl = (url: string, requirementUrl: string | null): boolean => {
  if (!requirementUrl) return false
  try {
    const candidate = new URL(url)
    const current = new URL(requirementUrl)

    if (candidate.host !== current.host) return false

    // 同一需求可能通过 simpleName 或完整 projectKey 生成链接，按需求 ID 判断更可靠。
    const currentId = getStoryDetailId(current)
    const candidateId = getStoryDetailId(candidate)

    if (currentId && candidateId) return currentId === candidateId

    return decodeURIComponent(candidate.pathname).replace(/\/+$/, '') ===
      decodeURIComponent(current.pathname).replace(/\/+$/, '')
  } catch {
    return false
  }
}

/** 解析 Markdown 语法树及原始富文本，不请求链接目标，也不执行 HTML。 */
export const extractRequirementLinks = (description: string | null, documentUrl: string | null, requirementUrl: string | null = null): RequirementLinkInput[] => {
  // 按规范化后的完整 URL 去重并保留首次名称，查询参数和锚点不同仍是不同入口。
  const links = new Map<string, RequirementLinkInput>()
  const add = (raw: string, title = ''): void => {
    const candidate = trimUrlTrailingText(raw)
    if (!candidate) return
    try {
      const url = normalizeRequirementLinkUrl(candidate)
      if (isCurrentRequirementUrl(url, requirementUrl)) return
      const parsed = new URL(url)
      // 自动识别链接的文字通常就是带污染的 URL，改用地址本身生成名称。
      const visibleTitle = /^https?:\/\//i.test(title.trim()) ? '' : title
      const name = visibleTitle.replace(/\s+/g, ' ').trim().slice(0, 200) || `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`.slice(0, 200)
      if (!links.has(url)) links.set(url, { name, url })
    } catch { /* 非网页链接不加入列表。 */ }
  }
  // 文档字段优先，避免同一地址在描述中出现时被无意义的链接文字命名。
  if (documentUrl) add(documentUrl, '需求文档')
  const source = description ?? ''
  const tree = parser.parse(source) as LinkNode
  // 先按 Markdown 语法定位代码区域，屏蔽后再解析 HTML，避免示例锚点被误收录。
  // 保留其余完整文本，使被拆成多个行内节点的 <a> 仍能取得完整名称。
  const codeRanges: Array<[number, number]> = []
  const collectCodeRanges = (node: LinkNode): void => {
    if (node.type === 'code' || node.type === 'inlineCode') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) codeRanges.push([start, end])
      return
    }
    node.children?.forEach(collectCodeRanges)
  }
  collectCodeRanges(tree)
  let htmlSource = source
  for (const [start, end] of codeRanges.sort((a, b) => b[0] - a[0])) {
    htmlSource = htmlSource.slice(0, start) + ' '.repeat(end - start) + htmlSource.slice(end)
  }
  const html = parseHtml(htmlSource)
  html.querySelectorAll('script, style, pre, code').forEach((element) => element.remove())
  html.querySelectorAll('a[href]').forEach((anchor) => add(anchor.getAttribute('href') ?? '', anchor.textContent ?? ''))
  const definitions = new Map<string, string>()
  // 引用式链接的定义可能在正文之后，先收集定义，再解析引用节点。
  const collectDefinitions = (node: LinkNode): void => {
    if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier.toUpperCase(), node.url)
    node.children?.forEach(collectDefinitions)
  }
  collectDefinitions(tree)
  const walk = (node: LinkNode): void => {
    if (node.type === 'link' && node.url) { add(node.url, textOf(node)); return }
    if (node.type === 'linkReference' && node.identifier) {
      const url = definitions.get(node.identifier.toUpperCase())
      if (url) add(url, textOf(node))
      return
    }
    if (node.type === 'html' && node.value) {
      // Markdown 不解析 HTML 块内部的裸网址，因此对其文本单独补充提取。
      const html = parseHtml(node.value)
      html.querySelectorAll('script, style, pre, code').forEach((element) => element.remove())
      html.querySelectorAll('a[href]').forEach((anchor) => add(anchor.getAttribute('href') ?? '', anchor.textContent ?? ''))
      for (const match of (html.textContent ?? '').matchAll(/https?:\/\/[^\s<>"'，。；！？]+/gi)) {
        add(match[0].replace(/[.,;!]+$/, ''))
      }
    }
    // 图片地址和代码示例不当作需求相关链接。
    if (['image', 'imageReference', 'code', 'inlineCode', 'definition'].includes(node.type)) return
    node.children?.forEach(walk)
  }
  walk(tree)
  return [...links.values()]
}
