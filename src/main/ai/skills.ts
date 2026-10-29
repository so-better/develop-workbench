/**
 * 应用技能目录扫描、缓存与读取。
 * 技能位于应用技能目录 skills/<name>/SKILL.md，资源和脚本放在同目录下。
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import matter from 'gray-matter'
import { normalizeText } from '../../utils'
import { getCliEnvironment } from '../cli-env'
import { getPreferences } from '../preferences'

// 技能声明文件名固定，扫描时只识别该文件。
const SKILL_FILE = 'SKILL.md'
// 限制扫描深度，避免误入依赖目录或过深的业务目录。
const MAX_SCAN_DEPTH = 3
// 限制技能数量，避免异常目录拖慢检索和占用过多内存。
const MAX_SKILLS = 50
// 单个技能声明或参考文件的大小上限，避免超大文件进入上下文。
const MAX_SKILL_FILE_BYTES = 200 * 1024
// 单个技能最多展示和读取的文件数量。
const MAX_SKILL_FILES = 100
// 技能资源目录的最大递归深度。
const MAX_SKILL_FILES_DEPTH = 4
// 技能列表缓存时间；过期后重新扫描，兼顾编辑生效和扫描开销。
const CACHE_TTL_MS = 5_000
// 脚本执行超时和输出上限，避免技能脚本失控或返回超大内容。
const SCRIPT_TIMEOUT_MS = 120_000
const MAX_SCRIPT_OUTPUT = 20_000

/** 扫描到的应用技能。 */
export interface ProjectSkill {
  /** frontmatter 中的技能名；缺失时使用目录名。 */
  name: string
  /** 技能用途，供检索展示。 */
  description: string
  /** 额外检索关键词。 */
  keywords: string[]
  /** SKILL.md 正文，不包含 frontmatter。 */
  content: string
  /** 技能目录绝对路径，用于读取参考文件和执行脚本。 */
  directory: string
  /** SKILL.md 绝对路径。 */
  file: string
}

/** 技能检索结果。 */
export interface SkillSummary {
  name: string
  description: string
  keywords: string[]
}

/** 技能正文读取结果。 */
export interface SkillReadResult extends SkillSummary {
  content: string
  directory: string
  files: string[]
}

/** 技能目录内单个文件的读取结果。 */
export interface SkillFileContent {
  name: string
  path: string
  content: string
}

/** 技能扫描结果缓存。 */
interface SkillCache {
  expiresAt: number
  skills: ProjectSkill[]
}

// 模块级缓存，避免每轮对话都遍历 skills 目录。
let cache: SkillCache | null = null

/** 设置变更后清空缓存，让下一次检索立即使用新目录。 */
export const invalidateSkillCache = (): void => {
  cache = null
}

/**
 * 返回技能根目录候选列表。
 * 开发环境同时尝试 app 路径和启动目录，打包后读取 extraResources。
 * 设置页配置的额外目录一并加入扫描范围。
 */
const getProjectSkillsRoots = (): string[] => [
  ...new Set([
    ...(app.isPackaged
      ? [join(process.resourcesPath, 'skills')]
      : [join(app.getAppPath(), 'skills'), join(process.cwd(), 'skills')]),
    ...(getPreferences().skillDirectories ?? [])
  ])
]

/** 判断目标路径是否位于技能目录内，避免路径穿越。 */
const isWithin = (parent: string, child: string): boolean =>
  child === parent || child.startsWith(`${parent}${sep}`)

/** 将 frontmatter 中的关键词统一成字符串数组。 */
const toKeywords = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

/** 递归查找技能声明文件。 */
const findSkillFiles = async (
  directory: string,
  depth: number,
  files: string[]
): Promise<void> => {
  if (depth > MAX_SCAN_DEPTH || files.length >= MAX_SKILLS) return

  let entries

  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    if (files.length >= MAX_SKILLS) break
    // 隐藏目录和符号链接不参与扫描，避免越界和无关文件干扰。
    if (
      entry.name.startsWith('.') ||
      entry.name === 'node_modules' ||
      entry.isSymbolicLink()
    ) {
      continue
    }

    const fullPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      await findSkillFiles(fullPath, depth + 1, files)
    } else if (depth > 0 && entry.isFile() && entry.name === SKILL_FILE) {
      // 根目录的 SKILL.md 不属于某个技能，避免把整个 skills 目录当成技能。
      files.push(fullPath)
    }
  }
}

/**
 * 解析单个 SKILL.md。
 * frontmatter 缺失 name 时用目录名兜底；解析失败或正文为空时跳过。
 */
const parseSkill = async (file: string): Promise<ProjectSkill | null> => {
  try {
    const stats = await stat(file)

    if (!stats.isFile() || stats.size > MAX_SKILL_FILE_BYTES) return null

    const raw = await readFile(file, 'utf8')

    if (raw.includes('\u0000')) return null

    const parsed = matter(raw)
    const directory = dirname(file)
    // 目录名是技能名的兜底来源，保证技能移动到新目录后仍可识别。
    const name = normalizeText(parsed.data.name, 80) || basename(directory)
    const description = normalizeText(parsed.data.description, 500)
    const content = parsed.content.trim()

    if (!name || !content) return null

    return {
      name,
      description,
      keywords: toKeywords(parsed.data.keywords),
      content,
      directory,
      file
    }
  } catch {
    return null
  }
}

/** 扫描并缓存项目技能；缓存过期后会重新读取磁盘。 */
export const listProjectSkills = async (): Promise<ProjectSkill[]> => {
  if (cache && cache.expiresAt > Date.now()) return cache.skills

  const files: string[] = []

  for (const root of getProjectSkillsRoots()) {
    await findSkillFiles(root, 0, files)
  }

  const parsed = await Promise.all(files.map((file) => parseSkill(file)))
  const seen = new Set<string>()
  const skills: ProjectSkill[] = []

  for (const skill of parsed) {
    if (!skill) continue

    // 同名技能只保留扫描顺序中的第一个，避免检索结果重复。
    const key = skill.name.toLowerCase()

    if (seen.has(key)) continue

    seen.add(key)
    skills.push(skill)
  }

  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    skills
  }

  return skills
}

/** 按名称精确查找项目技能。 */
export const getProjectSkill = async (name: string): Promise<ProjectSkill | null> => {
  const query = name.trim().toLowerCase()

  if (!query) return null

  return (
    (await listProjectSkills()).find((skill) => skill.name.toLowerCase() === query) ??
    null
  )
}

/** 列出技能目录下的参考文件、脚本和模板，不包含 SKILL.md。 */
export const listSkillFiles = async (directory: string): Promise<string[]> => {
  const files: string[] = []

  const visit = async (current: string, depth: number): Promise<void> => {
    if (depth > MAX_SKILL_FILES_DEPTH || files.length >= MAX_SKILL_FILES) return

    let entries

    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (files.length >= MAX_SKILL_FILES) break
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.isSymbolicLink()
      ) {
        continue
      }

      const fullPath = join(current, entry.name)

      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1)
      } else if (entry.isFile() && entry.name !== SKILL_FILE) {
        files.push(relative(directory, fullPath).split(sep).join('/'))
      }
    }
  }

  await visit(directory, 0)
  return files
}

interface ResolvedSkillFile {
  skill: ProjectSkill
  root: string
  realTarget: string
}

/** 解析并校验技能内文件路径，返回真实路径；防止路径穿越和符号链接越界。 */
const resolveProjectSkillFile = async (
  name: string,
  filePath: string
): Promise<ResolvedSkillFile> => {
  const skill = await getProjectSkill(name)

  if (!skill) throw new Error(`技能「${name}」不存在`)

  const normalized = filePath.trim()
  const segments = normalized.split(/[\\/]+/)

  if (
    !normalized ||
    normalized.includes('\u0000') ||
    isAbsolute(normalized) ||
    segments.some((segment) => segment.startsWith('.') || segment === 'node_modules')
  ) {
    throw new Error('技能文件路径不合法')
  }

  let target: string
  let root: string
  let realTarget: string

  try {
    // 先解析真实路径，再和真实技能目录比较，防止符号链接越界。
    root = await realpath(skill.directory)
    target = resolve(skill.directory, normalized)
    realTarget = await realpath(target)
  } catch {
    throw new Error('技能文件不存在')
  }

  if (!isWithin(root, realTarget)) {
    throw new Error('技能文件路径不合法')
  }

  return { skill, root, realTarget }
}

/** 读取技能目录内的单个文本文件，并阻止路径穿越和越界符号链接。 */
export const readProjectSkillFile = async (
  name: string,
  filePath: string
): Promise<SkillFileContent> => {
  const { skill, root, realTarget } = await resolveProjectSkillFile(name, filePath)
  const stats = await stat(realTarget)

  if (!stats.isFile()) throw new Error('技能文件不存在')
  if (stats.size > MAX_SKILL_FILE_BYTES) throw new Error('技能文件过大')

  const content = await readFile(realTarget, 'utf8')

  // 文本文件不应包含 NUL，出现时按二进制文件拒绝，避免污染上下文。
  if (content.includes('\u0000')) {
    throw new Error('不支持读取二进制文件')
  }

  return {
    name: skill.name,
    path: relative(root, realTarget).split(sep).join('/'),
    content
  }
}

interface ScriptCommand {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

/** 按扩展名选择脚本解释器；不支持的扩展名直接拒绝。 */
const getScriptCommand = (scriptPath: string, args: string[]): ScriptCommand => {
  const extension = extname(scriptPath).toLowerCase()
  const isWindows = process.platform === 'win32'

  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    // 打包后没有独立的 node 命令，使用 Electron 自带的 Node 运行时。
    return {
      command: process.execPath,
      args: [scriptPath, ...args],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    }
  }

  if (extension === '.py') {
    return {
      command: isWindows ? 'py' : 'python3',
      args: [...(isWindows ? ['-3'] : []), scriptPath, ...args]
    }
  }

  if (extension === '.sh' || extension === '.bash') {
    return { command: 'bash', args: [scriptPath, ...args] }
  }

  if (extension === '.ps1' && isWindows) {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]
    }
  }

  throw new Error(`不支持的技能脚本类型：${extension || '无扩展名'}`)
}

export interface SkillScriptResult {
  name: string
  path: string
  code: number
  stdout: string
  stderr: string
}

/** 在技能目录内执行脚本，限制解释器、超时和输出长度。 */
export const runProjectSkillScript = async (
  name: string,
  scriptPath: string,
  args: string[] = []
): Promise<SkillScriptResult> => {
  if (args.length > 20 || args.some((arg) => arg.length > 500)) {
    throw new Error('技能脚本参数过多或过长')
  }

  const { skill, root, realTarget } = await resolveProjectSkillFile(name, scriptPath)
  const stats = await stat(realTarget)

  if (!stats.isFile()) throw new Error('技能脚本不存在')

  const relativePath = relative(root, realTarget).split(sep).join('/')
  const { command, args: commandArgs, env } = getScriptCommand(realTarget, args)
  const runtimeEnv = {
    ...getCliEnvironment(command),
    ...(env ?? {})
  }

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: skill.directory,
      env: runtimeEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: SkillScriptResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(result)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error('技能脚本执行超时'))
    }, SCRIPT_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(0, MAX_SCRIPT_OUTPUT)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(0, MAX_SCRIPT_OUTPUT)
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      finish({
        name: skill.name,
        path: relativePath,
        code: code ?? -1,
        stdout,
        stderr
      })
    })
  })
}

/** 按关键词检索项目技能，最多返回 8 条。 */
export const searchSkills = async (query: string): Promise<SkillSummary[]> => {
  const keyword = query.trim().toLowerCase()
  const skills = await listProjectSkills()

  if (!keyword) {
    return skills.slice(0, 8).map(({ content: _content, ...skill }) => ({
      name: skill.name,
      description: skill.description,
      keywords: skill.keywords
    }))
  }

  // 名称精确匹配优先，其次是名称包含、关键词和描述匹配。
  return skills
    .map((skill) => {
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
    .slice(0, 8)
    .map(({ skill }) => ({
      name: skill.name,
      description: skill.description,
      keywords: skill.keywords
    }))
}

/** 按技能名或主题词读取 SKILL.md 正文，并返回技能目录和可读取文件。 */
export const readSkill = async (
  nameOrTopic: string
): Promise<SkillReadResult | null> => {
  const query = nameOrTopic.trim().toLowerCase()

  if (!query) return null

  const skills = await listProjectSkills()
  // 先精确匹配技能名；未命中时再按名称、描述关键词做模糊匹配。
  const skill =
    skills.find((item) => item.name.toLowerCase() === query) ??
    skills.find(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        query.includes(item.name.toLowerCase()) ||
        item.keywords.some(
          (keyword) =>
            keyword.toLowerCase() === query ||
            keyword.toLowerCase().includes(query)
        )
    )

  if (!skill) return null

  return {
    name: skill.name,
    description: skill.description,
    keywords: skill.keywords,
    content: skill.content,
    directory: skill.directory,
    files: await listSkillFiles(skill.directory)
  }
}

/** 对外暴露技能文件读取入口，便于工具层和其他模块复用。 */
export const readSkillFile = readProjectSkillFile

/** 对外暴露技能脚本执行入口。 */
export const runSkillScript = runProjectSkillScript
