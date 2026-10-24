import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeSchema } from 'rehype-sanitize'
import type { Element, Root } from 'hast'
import remarkGfm from 'remark-gfm'
import LinkPreview from './LinkPreview'
import MarkdownImage from './MarkdownImage'

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
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style']
  }
}

interface MarkdownContentProps {
  /** Markdown 原文。 */
  content: string

  /** 额外样式类。 */
  className?: string
}

/**
 * 统一的 Markdown 渲染组件。
 * 关闭原始 HTML，链接统一交给应用内浏览器打开。
 */
export default function MarkdownContent({
  content,
  className
}: MarkdownContentProps): JSX.Element {
  return (
    <div className={`markdown-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSafeStyles,
          [rehypeSanitize, markdownSanitizeSchema]
        ]}
        components={{
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
        }}
      >
        {normalizeMarkdownImages(content)}
      </ReactMarkdown>
    </div>
  )
}
