import type { ReactNode } from 'react'
import { Avatar, Tag, Typography } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import type {
  MeegleRequirement,
  MeegleRequirementCollaborator,
  MeegleRequirementOwner
} from '../../../../types/requirements'
import {
  formatRequirementType,
  formatWorkTime
} from '../../pages/RequirementWorkbench/workbench-utils'
import type { BasicInfoGroup } from './RequirementInfoSection'
import './RequirementInfoSection.css'

/** 展示人员头像和昵称。 */
const renderPersonChip = (
  person: MeegleRequirementOwner,
  key: string
): JSX.Element => (
  <span className="requirement-info-person" key={key}>
    <Avatar size={20} src={person.avatarUrl ?? undefined}>
      {person.name.slice(0, 1)}
    </Avatar>
    <span>{person.name}</span>
  </span>
)

/** 展示一组人员。 */
const renderPeople = (people: MeegleRequirementOwner[]): ReactNode => {
  if (people.length === 0) return '未填写'

  return (
    <span className="requirement-info-people">
      {people.map((person, index) =>
        renderPersonChip(person, `${person.email ?? person.name}-${index}`)
      )}
    </span>
  )
}

/** 按角色展示参与人员。 */
const renderCollaborators = (
  collaborators: MeegleRequirementCollaborator[]
): ReactNode => {
  if (collaborators.length === 0) return '未填写'

  return (
    <div className="requirement-info-collaborators">
      {collaborators.map((collaborator) => (
        <div className="requirement-info-collaborator" key={collaborator.role}>
          <span className="requirement-info-collaborator-role">{collaborator.role}</span>
          <span className="requirement-info-collaborator-members">
            {renderPeople(collaborator.members)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** 展示一组标签。 */
const renderInfoTags = (values: string[], tone = 'gray'): ReactNode => {
  if (values.length === 0) return '未填写'

  return (
    <span className="requirement-info-value-tags">
      {values.map((value) => (
        <Tag
          key={value}
          bordered={false}
          className={`requirement-info-tag is-${tone}`}
        >
          {value}
        </Tag>
      ))}
    </span>
  )
}

/** 根据“是/否”选择标签颜色。 */
const getBooleanTagTone = (value: string): string => {
  if (value === '是') return 'orange'
  if (value === '否') return 'green'

  return 'gray'
}

/**
 * 构建需求详情的基本信息和更多飞书字段。
 */
export const buildRequirementInfoGroups = (
  requirement: MeegleRequirement,
  isLocal: boolean
): { primary: BasicInfoGroup[]; more: BasicInfoGroup[] } => {
  const primaryInfoGroups: BasicInfoGroup[] = [
        // 按端难度估分只来自 Meegle；本地临时需求没有这些字段。
        ...(!isLocal
          ? [
              {
                title: '难度估分',
                fields: [
                  {
                    label: '前端app',
                    value: formatWorkTime(
                      requirement.difficultyEstimation?.frontendApp ??
                        null
                    )
                  },
                  {
                    label: '前端PC',
                    value: formatWorkTime(
                      requirement.difficultyEstimation?.frontendPc ??
                        null
                    )
                  },
                  {
                    label: '后端',
                    value: formatWorkTime(
                      requirement.difficultyEstimation?.backend ?? null
                    )
                  }
                ]
              }
            ]
          : []),
        {
          title: '需求信息',
          fields: [
            {
              label: '需求类型',
              value: renderInfoTags(
                [
                  formatRequirementType(
                    requirement.requirementType
                  ) ?? ''
                ].filter(Boolean),
                'blue'
              )
            },
            {
              label: '产品线',
              value: renderInfoTags(
                requirement.productLines.length > 0
                  ? [requirement.productLines.join(' / ')]
                  : [],
                'teal'
              )
            },
            {
              label: '需求文档',
              value: requirement.documentUrl ? (
                <Typography.Link
                  className="requirement-info-doc-link"
                  href={requirement.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <LinkOutlined />
                  查看文档
                </Typography.Link>
              ) : (
                '未填写'
              )
            }
          ]
        },
        {
          title: '参与人员',
          fields: [
            {
              label: '参与人员',
              wide: true,
              hideLabel: true,
              value: renderCollaborators(requirement.collaborators)
            }
          ]
        },
        {
          title: '研发与版本',
          fields: [
            {
              label: '技术方案',
              wide: true,
              value: requirement.technicalSolution ?? '未填写'
            },
            {
              label: '应用',
              value: renderInfoTags(
                requirement.application
                  ? [requirement.application]
                  : [],
                'teal'
              )
            },
            {
              label: '标签',
              value: renderInfoTags(requirement.tags, 'green')
            },
            {
              label: '预计上线时间',
              value: requirement.expectedReleaseAt ?? '未填写'
            },
            {
              label: '规划版本',
              value: renderInfoTags(
                requirement.planningVersions,
                'purple'
              )
            }
          ]
        }
      ]

  /** 默认折叠的低频飞书字段。 */
  const moreInfoGroups: BasicInfoGroup[] = [
        {
          title: '其他信息',
          fields: [
            {
              label: '创建人',
              value: renderPeople(
                requirement.createdBy
                  ? [requirement.createdBy]
                  : []
              )
            },
            {
              label: '提出时间',
              value: requirement.proposedAt ?? '未填写'
            },
            {
              label: '完成日期',
              value: requirement.completedAt ?? '未填写'
            },
            {
              label: '实际上车版本',
              value: renderInfoTags(
                requirement.actualReleaseVersions,
                'cyan'
              )
            }
          ]
        },
        {
          title: '研发属性',
          fields: [
            {
              label: '需求等级',
              value: renderInfoTags(
                requirement.requirementLevel
                  ? [requirement.requirementLevel]
                  : [],
                'orange'
              )
            },
            {
              label: '需求性质',
              value: renderInfoTags(
                requirement.requirementNature
                  ? [requirement.requirementNature]
                  : [],
                'pink'
              )
            },
            {
              label: '需求复杂度',
              value: renderInfoTags(
                requirement.complexity !== null
                  ? [String(requirement.complexity)]
                  : [],
                'gray'
              )
            },
            {
              label: '研发难度估分',
              value: renderInfoTags(
                requirement.developmentDifficulty !== null
                  ? [String(requirement.developmentDifficulty)]
                  : [],
                'gray'
              )
            },
            {
              label: '预估开发量',
              value: renderInfoTags(
                requirement.estimatedWorkload
                  ? [requirement.estimatedWorkload]
                  : [],
                'gray'
              )
            }
          ]
        },
        {
          title: '质量属性',
          fields: [
            {
              label: '是否涉及权限',
              value: requirement.permissionsInvolved
                ? renderInfoTags(
                    [requirement.permissionsInvolved],
                    getBooleanTagTone(
                      requirement.permissionsInvolved
                    )
                  )
                : '未填写'
            },
            {
              label: '是否涉及历史数据',
              value: requirement.historicalDataInvolved
                ? renderInfoTags(
                    [requirement.historicalDataInvolved],
                    getBooleanTagTone(
                      requirement.historicalDataInvolved
                    )
                  )
                : '未填写'
            },
            {
              label: '是否涉及性能测试',
              value: requirement.performanceTestInvolved
                ? renderInfoTags(
                    [requirement.performanceTestInvolved],
                    getBooleanTagTone(
                      requirement.performanceTestInvolved
                    )
                  )
                : '未填写'
            }
          ]
        }
      ]

  return { primary: primaryInfoGroups, more: moreInfoGroups }
}
