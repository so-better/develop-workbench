import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { tool } from 'ai'
import sanitizeHtml from 'sanitize-html'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import type { AiChatArtifact } from '../../../types/ai'
import { createArtifactTarget, registerArtifact } from '../artifacts'

/** 允许通过 saveLocalFile 生成的文本类文件扩展名。 */
const ALLOWED_FILE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.html',
  '.xml',
  '.yaml',
  '.yml',
  '.svg',
  '.log',
  '.docx',
  '.pdf'
])

const ALLOWED_FILE_LABEL = [...ALLOWED_FILE_EXTENSIONS].join(', ')

const SVG_TAGS = [
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'marker',
  'pattern',
  'title',
  'desc',
  'use'
]

const SVG_ATTRIBUTES = [
  'xmlns',
  'xmlns:xlink',
  'href',
  'xlink:href',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'transform',
  'text-anchor',
  'dominant-baseline',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'paint-order',
  'marker-start',
  'marker-mid',
  'marker-end',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'preserveAspectRatio',
  'id',
  'class',
  'role',
  'aria-label',
  'aria-hidden',
  'focusable'
]

/** 对生成的 HTML/SVG 做标签、属性和 URL 白名单清理。 */
const sanitizeGeneratedMarkup = (content: string, extension: string): string => {
  if (extension === '.html') {
    return sanitizeHtml(content, {
      allowedTags: sanitizeHtml.defaults.allowedTags,
      allowedAttributes: sanitizeHtml.defaults.allowedAttributes,
      allowedSchemes: ['http', 'https', 'mailto', 'tel'],
      allowProtocolRelative: false,
      disallowedTagsMode: 'discard'
    })
  }

  if (extension === '.svg') {
    return sanitizeHtml(content, {
      allowedTags: SVG_TAGS,
      allowedAttributes: { '*': SVG_ATTRIBUTES },
      allowedSchemes: ['http', 'https'],
      allowProtocolRelative: false,
      disallowedTagsMode: 'discard',
      parser: {
        lowerCaseTags: false,
        lowerCaseAttributeNames: false
      }
    })
  }

  return content
}

/** 清理文件名并校验扩展名，防止路径穿越和写入不支持的格式。 */
const sanitizeFilename = (
  filename: string,
  allowedExtensions = ALLOWED_FILE_EXTENSIONS
): string => {
  const safe = basename(filename)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()

  if (!safe) throw new Error('文件名不能为空')

  const extension = extname(safe).toLowerCase()

  if (!allowedExtensions.has(extension)) {
    throw new Error(
      `不支持的文件类型：${extension || '无扩展名'}。支持：${[...allowedExtensions].join(', ')}`
    )
  }

  return safe
}

/**
 * 把模型生成的文本内容写入应用内部产物目录。
 * Word/PDF 先以 Markdown 渲染，再转换为目标格式。
 */
const saveLocalFile = async (
  filename: string,
  content: string
): Promise<{ ok: true; artifact: AiChatArtifact }> => {
  const safeFilename = sanitizeFilename(filename)
  const target = await createArtifactTarget(safeFilename)
  const path = target.path
  const extension = extname(safeFilename).toLowerCase()

  if (extension === '.docx' || extension === '.pdf') {
    // 动态导入较重的 Office 依赖，避免影响主进程启动速度。
    const { parseOffice } = await import('officeparser')
    const ast = await parseOffice(Buffer.from(content, 'utf8'), {
      fileType: 'md'
    })

    if (extension === '.docx') {
      const result = await ast.to('docx')
      const data =
        result.value instanceof Uint8Array
          ? result.value
          : new TextEncoder().encode(String(result.value))

      await writeFile(path, data, { mode: 0o600 })
    } else {
      const html = await ast.to('html')
      const htmlText =
        typeof html.value === 'string'
          ? html.value
          : new TextDecoder().decode(html.value)
      // 使用 Electron 自带 Chromium 打印 PDF，保证中文和页面样式稳定。
      const window = new BrowserWindow({ show: false })

      try {
        await window.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(htmlText)}`
        )
        const pdf = await window.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4'
        })
        await writeFile(path, pdf, { mode: 0o600 })
      } finally {
        window.destroy()
      }
    }
  } else {
    const output = sanitizeGeneratedMarkup(content, extension)

    await writeFile(path, output, {
      encoding: 'utf8',
      mode: 0o600
    })
  }

  return {
    ok: true,
    artifact: await registerArtifact(target.id, path, safeFilename)
  }
}

/** 使用 ExcelJS 生成工作簿，每个 sheet 的 rows 保持二维数组结构。 */
const saveExcel = async (
  filename: string,
  sheets: Array<{ name: string; rows: string[][] }>
): Promise<{ ok: true; artifact: AiChatArtifact }> => {
  const safeFilename = sanitizeFilename(filename, new Set(['.xlsx']))
  const target = await createArtifactTarget(safeFilename)
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31) || 'Sheet')
    sheet.rows.forEach((row) => worksheet.addRow(row))
  }

  await workbook.xlsx.writeFile(target.path)

  return {
    ok: true,
    artifact: await registerArtifact(target.id, target.path, safeFilename)
  }
}

/** 使用 PptxGenJS 生成演示文稿，第一页作为封面。 */
const savePowerPoint = async (
  filename: string,
  title: string,
  slides: Array<{ title: string; bullets: string[] }>
): Promise<{ ok: true; artifact: AiChatArtifact }> => {
  const safeFilename = sanitizeFilename(filename, new Set(['.pptx']))
  const target = await createArtifactTarget(safeFilename)
  const { default: PptxGenJS } = await import('pptxgenjs')
  const presentation = new PptxGenJS()
  const cover = presentation.addSlide()

  cover.addText(title || '演示文稿', {
    x: 0.7,
    y: 2.2,
    w: 8.6,
    h: 1.2,
    fontSize: 30,
    bold: true
  })

  for (const slide of slides) {
    const page = presentation.addSlide()
    page.addText(slide.title || '未命名页面', {
      x: 0.7,
      y: 0.5,
      w: 8.6,
      h: 0.7,
      fontSize: 22,
      bold: true
    })
    if (slide.bullets.length) {
      page.addText(
        slide.bullets.map((bullet) => ({
          text: bullet,
          options: { bullet: true, breakLine: true }
        })),
        { x: 0.9, y: 1.4, w: 8.2, h: 4.4, fontSize: 16 }
      )
    }
  }

  await presentation.writeFile({ fileName: target.path })

  return {
    ok: true,
    artifact: await registerArtifact(target.id, target.path, safeFilename)
  }
}

/**
 * 文件生成工具。
 * 工具只负责在应用内部准备产物，最终保存到本机由前端下载按钮触发。
 */
export const fileTools: ToolSet = {
  saveExcel: tool({
    description:
      '生成 Excel 文件并提供下载入口。sheets[].rows 是二维数组，首行作为表头。',
    metadata: { label: '生成 Excel' },
    inputSchema: z.object({
      filename: z.string().describe('带 .xlsx 扩展名的文件名'),
      sheets: z
        .array(
          z.object({
            name: z.string().describe('工作表名称'),
            rows: z
              .array(
                z.array(
                  z
                    .union([z.string(), z.number(), z.boolean(), z.null()])
                    .transform((value) => (value == null ? '' : String(value)))
                )
              )
              .describe('二维数组，首行是表头')
          })
        )
        .min(1)
    }),
    execute: async ({ filename, sheets }) => saveExcel(filename, sheets)
  }),
  savePowerPoint: tool({
    description: '生成 PowerPoint 文件并提供下载入口。提供标题和每页要点。',
    metadata: { label: '生成 PPT' },
    inputSchema: z.object({
      filename: z.string().describe('带 .pptx 扩展名的文件名'),
      title: z.string().describe('演示文稿标题'),
      slides: z
        .array(
          z.object({
            title: z.string().describe('页面标题'),
            bullets: z.array(z.string()).describe('页面要点')
          })
        )
        .min(1)
    }),
    execute: async ({ filename, title, slides }) =>
      savePowerPoint(filename, title, slides)
  }),
  saveLocalFile: tool({
    description:
      '把完整内容生成文件并提供下载入口。支持 Markdown、TXT、CSV、JSON、HTML、XML、YAML、SVG、日志、Word(docx) 和 PDF。生成 Word/PDF 时内容使用 Markdown。需要生成文件时调用。',
    metadata: { label: '生成文件' },
    inputSchema: z.object({
      filename: z
        .string()
        .describe(
          `带扩展名的文件名，支持 ${ALLOWED_FILE_LABEL}，例如 report.md`
        ),
      content: z.string().describe('完整文件内容，不要使用占位符')
    }),
    execute: async ({ filename, content }) => saveLocalFile(filename, content)
  })
}

/** 从文件生成工具的结果中提取可展示、可下载的产物信息。 */
export const getToolArtifact = (
  toolName: string,
  output: unknown
): AiChatArtifact | null => {
  if (
    !['saveLocalFile', 'saveExcel', 'savePowerPoint'].includes(toolName) ||
    !output ||
    typeof output !== 'object'
  ) {
    return null
  }

  const result = output as { artifact?: unknown }
  const artifact = result.artifact

  if (!artifact || typeof artifact !== 'object') return null

  const candidate = artifact as Partial<AiChatArtifact>

  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return null
  }

  return {
    id: candidate.id,
    kind: 'file',
    name: candidate.name,
    mimeType: candidate.mimeType,
    size: candidate.size
  }
}
