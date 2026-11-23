import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeSchema } from 'rehype-sanitize'
import type { Element, Root } from 'hast'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import LinkPreview from '../LinkPreview/LinkPreview'
import MarkdownImage from '../MarkdownImage/MarkdownImage'
import CodeBlock from './CodeBlock'
import EChartBlock from './EChartBlock'
import MermaidDiagram from './MermaidDiagram'
import { trimUrlTrailingText } from '../../../../utils'
import './MarkdownContent.css'

interface MarkdownNode {
  type: string
  url?: string
  value?: string
  children?: MarkdownNode[]
}

/**
 * GFM 自动链接会把紧邻地址的中文和破折号并入 URL，例如“...KGnmb——说明”。
 * 在 mdast 阶段截断地址，并把尾部正文拆回普通文本，代码块中的内容不受影响。
 */
const remarkTrimAutolinkTrailingText = () => (tree: MarkdownNode): void => {
  const walk = (node: MarkdownNode): void => {
    if (!node.children) return

    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index]

      if (child.type === 'link' && typeof child.url === 'string') {
        child.url = trimUrlTrailingText(child.url)

        // 自动链接的文字通常就是完整的污染地址，需要把尾部正文拆到链接外。
        const onlyText =
          child.children?.length === 1 && child.children[0].type === 'text'

        if (onlyText && child.children) {
          const text = child.children[0].value ?? ''
          const visible = trimUrlTrailingText(text)

          if (visible !== text) {
            child.children[0].value = visible
            node.children.splice(index + 1, 0, {
              type: 'text',
              value: text.slice(visible.length)
            })
            index += 1
          }
        }
      }

      walk(child)
    }
  }

  walk(tree)
}

/**
 * 把文本节点中的换行转换为 <br>。
 * 用于待办简记等需要保留用户输入换行的场景，避免 Markdown 把软换行折叠成空格。
 */
const remarkPreserveLineBreaks = () => (tree: MarkdownNode): void => {
  const walk = (node: MarkdownNode): void => {
    if (!node.children?.length) return

    const next: MarkdownNode[] = []

    for (const child of node.children) {
      if (child.type === 'text' && typeof child.value === 'string') {
        const parts = child.value.split('\n')

        parts.forEach((part, index) => {
          if (index > 0) next.push({ type: 'break' })
          if (part) next.push({ type: 'text', value: part })
        })
        continue
      }

      walk(child)
      next.push(child)
    }

    node.children = next
  }

  walk(tree)
}

/**
 * 飞书导出的图片地址可能包含换行，导致 Markdown 图片语法失效。
 * 只处理确实跨行的图片地址，避免影响代码块中的示例。
 */
const normalizeMarkdownImages = (content: string): string =>
  content.replace(
    /(!\[[^\]]*\]\()([\s\S]*?)\)/g,
    (match, prefix: string, destination: string) => {
      if (!/[\r\n]/.test(destination)) return match

      return `${prefix}${destination.replace(/\s*[\r\n]+\s*/g, '')})`
    }
  )

const SAFE_STYLE_PROPERTIES: Record<string, RegExp> = {
  color: /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]+)$/i,
  'background-color': /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]+)$/i,
  'font-size': /^\d+(?:\.\d+)?(?:px|em|rem|%|pt)$/i,
  'font-weight': /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
  'font-style': /^(?:normal|italic|oblique)$/i,
  'text-decoration': /^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*$/i,
  'text-align': /^(?:left|right|center|justify)$/i,
  'white-space': /^(?:normal|pre|pre-wrap|pre-line|nowrap)$/i,
  'line-height': /^(?:normal|\d+(?:\.\d+)?(?:px|em|rem|%)?)$/i
}

/**
 * 只保留飞书常用的安全行内样式，避免原始 HTML 带入脚本或外部资源。
 */
const filterSafeStyles = (style: string): string => {
  const declarations = style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const separator = declaration.indexOf(':')

      if (separator < 0) return null

      const property = declaration.slice(0, separator).trim().toLowerCase()
      const value = declaration.slice(separator + 1).trim()
      const validator = SAFE_STYLE_PROPERTIES[property]

      return validator?.test(value) ? `${property}: ${value}` : null
    })
    .filter((declaration): declaration is string => Boolean(declaration))

  return declarations.join('; ')
}

const rehypeSafeStyles = () => (tree: Root): void => {
  const walk = (node: Root | Element): void => {
    if (node.type === 'element' && node.properties) {
      const style = node.properties.style

      if (typeof style === 'string') {
        const safeStyle = filterSafeStyles(style)

        if (safeStyle) {
          node.properties.style = safeStyle
        } else {
          delete node.properties.style
        }
      }
    }

    for (const child of node.children) {
      if (child.type === 'element') walk(child)
    }
  }

  walk(tree)
}

const markdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style'],
    // remark-math 先产出 math-inline / math-display，rehype-katex 再转换。
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^(?:language-|math-)/]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^(?:language-|math-)/]]
  }
}

interface MarkdownContentProps {
  /** Markdown 原文。 */
  content: string

  /** 额外样式类。 */
  className?: string

  /** 流式输出期间先展示图表源码，避免不完整配置反复报错。 */
  streaming?: boolean

  /** 保留用户输入中的单换行，例如待办简记。 */
  breaks?: boolean
}

/**
 * 统一的 Markdown 渲染组件。
 * 关闭原始 HTML，链接统一交给应用内浏览器打开。
 */
const MarkdownContent = memo(function MarkdownContent({
  content,
  className,
  streaming = false,
  breaks = false
}: MarkdownContentProps): JSX.Element {
  // components 必须保持稳定，否则 ReactMarkdown 会把图表/代码块当成新组件并重新挂载。
  const components = useMemo<Components>(
    () => ({
      pre: ({ children }) => <>{children}</>,
      code: ({ className, children }) => {
        const language = /^language-([\w-]+)/.exec(className ?? '')?.[1]
        const normalizedLanguage = language?.toLowerCase()
        const text = String(children).replace(/\n$/, '')

        if (normalizedLanguage === 'mermaid' && !streaming) {
          return <MermaidDiagram chart={text} />
        }
        const looksLikeECharts =
          normalizedLanguage === 'json' && /"series"\s*:/.test(text)

        if (
          (normalizedLanguage === 'echarts' ||
            normalizedLanguage === 'echart' ||
            normalizedLanguage === 'chart' ||
            looksLikeECharts) &&
          !streaming
        ) {
          return <EChartBlock optionText={text} />
        }
        if (language || text.includes('\n')) {
          return <CodeBlock code={text} language={language ?? 'text'} />
        }

        return <code className={className}>{children}</code>
      },
      a: ({ href, children }) => {
        if (href && /^https?:\/\//i.test(href)) {
          return <LinkPreview href={href} fallback={children} />
        }

        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        )
      },
      img: ({ src, alt, title }) => (
        <MarkdownImage src={src} alt={alt} title={title} />
      )
    }),
    [streaming]
  )

  return (
    <div className={`markdown-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkTrimAutolinkTrailingText,
          remarkMath,
          ...(breaks ? [remarkPreserveLineBreaks] : [])
        ]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, markdownSanitizeSchema],
          rehypeSafeStyles,
          rehypeKatex
        ]}
        components={components}
      >
        {normalizeMarkdownImages(content)}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownContent
