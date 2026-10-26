import coding from './skills/coding.md?raw'
import dataViz from './skills/data-viz.md?raw'
import fileGeneration from './skills/file-generation.md?raw'
import sql from './skills/sql.md?raw'
import translation from './skills/translation.md?raw'
import writing from './skills/writing.md?raw'

interface SkillDefinition {
  name: string
  description: string
  keywords: string[]
  content: string
}

/** 内置技能只包含通用规范，内容随应用一起打包。 */
const SKILLS: SkillDefinition[] = [
  {
    name: 'coding',
    description: '编码、重构、调试和代码审查的通用规范',
    keywords: ['code', 'coding', '代码', '编程', '调试', '重构', '审查'],
    content: coding
  },
  {
    name: 'writing',
    description: '中文写作、报告、邮件和文案结构',
    keywords: ['writing', '写作', '文案', '报告', '邮件', '润色'],
    content: writing
  },
  {
    name: 'data-viz',
    description: '图表选型、ECharts 和 Mermaid 使用规范',
    keywords: ['chart', 'echarts', 'mermaid', '图表', '可视化', '流程图'],
    content: dataViz
  },
  {
    name: 'file-generation',
    description: '本地文件生成、命名和保存规范',
    keywords: ['file', '文件', '生成', '导出', 'csv', 'markdown', 'html'],
    content: fileGeneration
  },
  {
    name: 'translation',
    description: '翻译准确性、术语一致和格式保留',
    keywords: ['translation', '翻译', '本地化', 'i18n'],
    content: translation
  },
  {
    name: 'sql',
    description: 'SQL 查询、数据库设计和性能优化',
    keywords: ['sql', 'database', '数据库', '查询', '索引', '优化'],
    content: sql
  }
]

/** 按关键词检索技能，最多返回 5 条。 */
export const searchSkills = (query: string): Array<{
  name: string
  description: string
  keywords: string[]
}> => {
  const keyword = query.trim().toLowerCase()

  if (!keyword) {
    return SKILLS.slice(0, 5).map(({ content: _content, ...skill }) => skill)
  }

  return SKILLS.map((skill) => {
    let score = 0

    if (skill.name.toLowerCase() === keyword) score += 100
    if (skill.name.toLowerCase().includes(keyword)) score += 50
    for (const tag of skill.keywords) {
      if (tag.toLowerCase().includes(keyword) || keyword.includes(tag.toLowerCase())) {
        score += 30
      }
    }
    if (skill.description.toLowerCase().includes(keyword)) score += 20

    return { skill, score }
  })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ skill }) => ({
      name: skill.name,
      description: skill.description,
      keywords: skill.keywords
    }))
}

/** 按技能名或主题词读取完整技能正文。 */
export const readSkill = (nameOrTopic: string): string => {
  const query = nameOrTopic.trim().toLowerCase()

  if (!query) return ''

  const skill =
    SKILLS.find((item) => item.name === query) ??
    SKILLS.find(
      (item) =>
        item.name.includes(query) ||
        query.includes(item.name) ||
        item.keywords.some(
          (keyword) =>
            keyword.toLowerCase() === query ||
            keyword.toLowerCase().includes(query)
        )
    )

  return skill?.content.trim() ?? ''
}
