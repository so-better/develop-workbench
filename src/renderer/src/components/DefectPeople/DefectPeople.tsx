import { Avatar } from 'antd'
import '../RequirementInfoSection/RequirementInfoSection.css'
import type { MeegleDefectOwner } from '../../../../types/defects'

interface DefectPeopleProps {
  people: MeegleDefectOwner[]
}

/**
 * 缺陷人员列表：头像 + 名称，空列表显示“未填写”。
 */
export default function DefectPeople({ people }: DefectPeopleProps): JSX.Element {
  if (people.length === 0) return <>{'未填写'}</>

  return (
    <div className="requirement-info-people">
      {people.map((person) => (
        <span
          className="requirement-info-person"
          key={person.userKey ?? person.email ?? person.name}
        >
          <Avatar size={20} src={person.avatarUrl ?? undefined}>
            {person.name.slice(0, 1)}
          </Avatar>
          <span>{person.name}</span>
        </span>
      ))}
    </div>
  )
}
