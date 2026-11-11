const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul'
])

const SKIP_TAGS = new Set([
  'head',
  'meta',
  'noscript',
  'script',
  'style',
  'template',
  'title'
])

const escapeText = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/([*_`[\]~])/g, '\\$1')

const normalizeText = (text: string): string =>
  text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')

const safeUrl = (value: string | null): string | null => {
  if (!value) return null

  const trimmed = value.trim()

  if (!/^(https?:\/\/|mailto:)/i.test(trimmed)) return null

  return trimmed.replace(/\s/g, '%20').replace(/\)/g, '%29')
}

const codeSpan = (value: string): string => {
  const content = value.replace(/\s+/g, ' ').trim()

  if (!content) return ''

  const longestRun = Math.max(
    0,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length)
  )

  const fence = '`'.repeat(longestRun + 1)

  return `${fence}${content}${fence}`
}

const renderInlineChildren = (element: Element): string =>
  Array.from(element.childNodes).map(renderInline).join('')

const renderInline = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText(normalizeText(node.textContent ?? ''))
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()

  if (SKIP_TAGS.has(tag)) return ''

  if (tag === 'br') return '  \n'

  if (tag === 'strong' || tag === 'b') {
    const content = renderInlineChildren(element)
    return content.trim() ? `**${content}**` : ''
  }

  if (tag === 'em' || tag === 'i') {
    const content = renderInlineChildren(element)
    return content.trim() ? `*${content}*` : ''
  }

  if (tag === 'del' || tag === 's' || tag === 'strike') {
    const content = renderInlineChildren(element)
    return content.trim() ? `~~${content}~~` : ''
  }

  if (tag === 'span' || tag === 'font') {
    const style = element.getAttribute('style') ?? ''
    let content = renderInlineChildren(element).trim()

    if (!content) return ''
    if (/text-decoration[^;]*line-through/i.test(style)) {
      content = `~~${content}~~`
    }
    if (/font-style\s*:\s*italic/i.test(style)) {
      content = `*${content}*`
    }
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) {
      content = `**${content}**`
    }

    return content
  }

  if (tag === 'code') {
    return codeSpan(element.textContent ?? '')
  }

  if (tag === 'a') {
    const content = renderInlineChildren(element).trim()
    const href = safeUrl(element.getAttribute('href'))
    const label = content || href

    return href && label ? `[${label}](${href})` : content
  }

  if (tag === 'img') {
    const src = safeUrl(element.getAttribute('src'))
    const alt = (element.getAttribute('alt') ?? '').replace(/[\[\]]/g, '')

    return src ? `![${alt}](${src})` : ''
  }

  if (tag === 'input') return ''

  if (tag === 'ul' || tag === 'ol') {
    return `\n${renderList(element, tag === 'ol')}`
  }

  if (tag === 'blockquote') {
    return `\n${renderBlockquote(element)}`
  }

  if (tag === 'pre') {
    return `\n${renderCodeBlock(element)}`
  }

  if (tag === 'table') {
    return `\n${renderTable(element)}`
  }

  if (/^h[1-6]$/.test(tag)) {
    return `\n${renderHeading(element, Number(tag[1]))}\n`
  }

  if (tag === 'p' || tag === 'div' || tag === 'section' || BLOCK_TAGS.has(tag)) {
    return `\n${renderBlocks(element)}\n`
  }

  return renderInlineChildren(element)
}

const renderListItem = (element: Element): string => {
  const content = Array.from(element.childNodes)
    .map((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return renderInline(child)

      const childElement = child as HTMLElement
      const tag = childElement.tagName.toLowerCase()

      if (tag === 'ul' || tag === 'ol') {
        return `\n${renderList(childElement, tag === 'ol')}`
      }

      if (BLOCK_TAGS.has(tag)) {
        return `\n${renderBlocks(childElement)}\n`
      }

      return renderInline(childElement)
    })
    .join('')

  return content.trim().replace(/\n/g, '\n   ')
}

const renderList = (element: Element, ordered: boolean): string => {
  const items = Array.from(element.children).filter(
    (child) => child.tagName.toLowerCase() === 'li'
  )

  if (!items.length) return ''

  const start = Number(element.getAttribute('start') ?? '1')
  const first = Number.isFinite(start) ? start : 1

  return `${items
    .map((item, index) => {
      const prefix = ordered ? `${first + index}. ` : '- '
      return `${prefix}${renderListItem(item)}\n`
    })
    .join('')}\n`
}

const renderHeading = (element: Element, level: number): string => {
  const content = renderInlineChildren(element).trim()

  return content ? `${'#'.repeat(level)} ${content}\n\n` : ''
}

const renderBlockquote = (element: Element): string => {
  const content = renderBlocks(element).trim()

  if (!content) return ''

  return `${content
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}\n\n`
}

const renderCodeBlock = (element: Element): string => {
  const codeElement = element.querySelector('code')
  const source = (codeElement ?? element).textContent ?? ''
  const language =
    /(?:^|\s)language-([\w-]+)/i.exec(codeElement?.className ?? '')?.[1] ?? ''

  return `\`\`\`${language}\n${source.replace(/\n$/, '')}\n\`\`\`\n\n`
}

const renderTable = (element: Element): string => {
  const rows = Array.from(element.querySelectorAll('tr'))
    .map((row) =>
      Array.from(row.children)
        .filter((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()))
        .map((cell) =>
          renderInlineChildren(cell)
            .replace(/\n/g, ' ')
            .replace(/\|/g, '\\|')
            .trim()
        )
    )
    .filter((row) => row.length > 0)

  if (!rows.length) return ''

  const width = Math.max(...rows.map((row) => row.length))
  const formatRow = (row: string[]): string => {
    const cells = [...row, ...Array(Math.max(0, width - row.length)).fill('')]
    return `| ${cells.join(' | ')} |`
  }

  return `${[
    formatRow(rows[0]),
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...rows.slice(1).map(formatRow)
  ].join('\n')}\n\n`
}

const renderBlocks = (element: Element): string =>
  Array.from(element.childNodes)
    .map((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        return escapeText(normalizeText(child.textContent ?? ''))
      }

      if (child.nodeType !== Node.ELEMENT_NODE) return ''

      const childElement = child as HTMLElement
      const tag = childElement.tagName.toLowerCase()

      if (SKIP_TAGS.has(tag)) return ''
      if (tag === 'br') return '\n'
      if (tag === 'hr') return '---\n\n'
      if (tag === 'ul' || tag === 'ol') {
        return renderList(childElement, tag === 'ol')
      }
      if (tag === 'blockquote') return renderBlockquote(childElement)
      if (tag === 'pre') return renderCodeBlock(childElement)
      if (tag === 'table') return renderTable(childElement)
      if (/^h[1-6]$/.test(tag)) {
        return renderHeading(childElement, Number(tag[1]))
      }
      if (BLOCK_TAGS.has(tag)) {
        return `${renderBlocks(childElement)}\n\n`
      }

      return renderInline(childElement)
    })
    .join('')

export const hasRichTextFormatting = (html: string): boolean =>
  /<(strong|b|em|i|u|s|strike|h[1-6]|ul|ol|li|a|img|picture|figure|blockquote|pre|code|table|br)\b/i.test(
    html
  ) ||
  /style\s*=\s*["'][^"']*(font-weight|font-style|text-decoration)/i.test(html)

export const htmlToMarkdown = (html: string): string => {
  const document = new DOMParser().parseFromString(html, 'text/html')

  return renderBlocks(document.body)
    .replace(/[ \t]+\n{3,}/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim()
}
