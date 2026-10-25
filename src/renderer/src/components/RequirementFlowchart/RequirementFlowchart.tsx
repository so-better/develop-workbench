import { useMemo } from 'react'
import dagre from '@dagrejs/dagre'
import type { Point } from '@dagrejs/dagre'
import type { MeegleWorkflowNode } from '../../../../types/requirements'

interface RequirementFlowchartProps {
  /** 流程节点。 */
  nodes: MeegleWorkflowNode[]

  /** 当前选中的节点 key。 */
  selectedNodeKey: string | null

  /** 点击节点回调。 */
  onSelectNode: (nodeKey: string) => void
}

interface PositionedNode {
  node: MeegleWorkflowNode
  x: number
  y: number
  width: number
}

interface FlowEdge {
  key: string
  path: string
}

interface FlowLayout {
  width: number
  height: number
  nodes: PositionedNode[]
  edges: FlowEdge[]
}

const NODE_MIN_WIDTH = 126
const NODE_MAX_WIDTH = 280
const NODE_HEIGHT = 40
const HORIZONTAL_GAP = 56
const VERTICAL_GAP = 34
const CANVAS_MARGIN = 20
const NODE_CONTENT_PADDING = 45

/**
 * 根据节点名称估算宽度。
 * 中文字符按 13px、其他字符按 8px 估算，并限制在合理范围内。
 */
const measureNodeWidth = (name: string): number => {
  const textWidth = Array.from(name).reduce((width, character) => {
    const isCjk = /[\u2e80-\u9fff\uff00-\uffef]/.test(character)

    return width + (isCjk ? 13 : 8)
  }, 0)

  return Math.min(
    NODE_MAX_WIDTH,
    Math.max(NODE_MIN_WIDTH, Math.ceil(textWidth) + NODE_CONTENT_PADDING)
  )
}

/**
 * 使用 Catmull-Rom 转贝塞尔，让 Dagre 生成的控制点连成平滑曲线。
 */
const createSmoothPath = (points: Point[]): string => {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  let path = `M ${points[0].x} ${points[0].y}`

  // Catmull-Rom 转三次贝塞尔，曲线会依次穿过 Dagre 给出的每个控制点。
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[index - 1] ?? points[index]
    const current = points[index]
    const next = points[index + 1]
    const after = points[index + 2] ?? next
    const control1 = {
      x: current.x + (next.x - before.x) / 6,
      y: current.y + (next.y - before.y) / 6
    }
    const control2 = {
      x: next.x - (after.x - current.x) / 6,
      y: next.y - (after.y - current.y) / 6
    }

    path += ` C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${next.x} ${next.y}`
  }

  return path
}

/**
 * 使用 Dagre 做分层布局。
 * 跨层边会通过虚拟控制点绕开中间节点。
 */
const buildLayout = (nodes: MeegleWorkflowNode[]): FlowLayout => {
  const graph = new dagre.graphlib.Graph()

  graph.setGraph({
    rankdir: 'LR',
    nodesep: VERTICAL_GAP,
    ranksep: HORIZONTAL_GAP,
    marginx: CANVAS_MARGIN,
    marginy: CANVAS_MARGIN
  })
  graph.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    graph.setNode(node.key, {
      width: measureNodeWidth(node.name),
      height: NODE_HEIGHT
    })
  }

  for (const node of nodes) {
    for (const nextKey of node.nextNodeKeys) {
      if (nodes.some((candidate) => candidate.key === nextKey)) {
        graph.setEdge(node.key, nextKey)
      }
    }
  }

  dagre.layout(graph)

  const graphInfo = graph.graph()
  const positionedNodes: PositionedNode[] = nodes.map((node) => {
    const position = graph.node(node.key)
    const width = position?.width ?? measureNodeWidth(node.name)

    return {
      node,
      x: (position?.x ?? 0) - width / 2,
      y: (position?.y ?? 0) - NODE_HEIGHT / 2,
      width
    }
  })
  const edges: FlowEdge[] = []

  for (const edge of graph.edges()) {
    const edgeInfo = graph.edge(edge)
    const points = edgeInfo?.points ?? []

    if (points.length === 0) continue

    edges.push({
      key: `${edge.v}-${edge.w}`,
      path: createSmoothPath(points)
    })
  }

  return {
    width: Math.max(graphInfo.width ?? 0, NODE_MIN_WIDTH + CANVAS_MARGIN * 2),
    height: Math.max(graphInfo.height ?? 0, NODE_HEIGHT + CANVAS_MARGIN * 2),
    nodes: positionedNodes,
    edges
  }
}

/**
 * 判断流程节点的视觉状态。
 */
const getNodeTone = (status: string): string => {
  if (status === 'doing') return 'doing'
  if (status === 'finished' || status === 'done') return 'done'

  return 'idle'
}

/**
 * 需求流程图。
 * 支持分支、汇合和横向滚动。
 */
export default function RequirementFlowchart({
  nodes,
  selectedNodeKey,
  onSelectNode
}: RequirementFlowchartProps): JSX.Element {
  const layout = useMemo(() => buildLayout(nodes), [nodes])

  return (
    <div className="requirement-flowchart-scroll">
      <div
        className="requirement-flowchart-canvas"
        style={{ width: layout.width, height: layout.height }}
      >
        <svg
          className="requirement-flowchart-edges"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          {layout.edges.map((edge) => (
            <path key={edge.key} d={edge.path} />
          ))}
        </svg>

        {layout.nodes.map(({ node, x, y, width }) => (
          <button
            key={node.key}
            type="button"
            className={`requirement-flow-node is-${getNodeTone(node.status)}${
              node.key === selectedNodeKey ? ' is-selected' : ''
            }`}
            style={{ left: x, top: y, width, height: NODE_HEIGHT }}
            title={node.name}
            onClick={() => onSelectNode(node.key)}
          >
            <span className="requirement-flow-node-dot" />
            <span className="requirement-flow-node-name">{node.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
