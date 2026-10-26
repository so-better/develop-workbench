/**
 * 应用自绘 AI 机器人标识。
 * 使用实心轮廓和负空间五官，小尺寸下比线性图标更清晰。
 */
export default function RobotMark(): JSX.Element {
  return (
    <svg
      className="ai-robot-mark"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 4.2V2.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="1.7" r="1.05" fill="currentColor" />
      <rect x="2.1" y="10" width="1.9" height="4.2" rx="0.95" fill="currentColor" />
      <rect x="20" y="10" width="1.9" height="4.2" rx="0.95" fill="currentColor" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.2 5.1h7.6A4.2 4.2 0 0 1 20 9.3v6.4a4.2 4.2 0 0 1-4.2 4.2H8.2A4.2 4.2 0 0 1 4 15.7V9.3a4.2 4.2 0 0 1 4.2-4.2Zm1.35 5.1a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7Zm4.9 0a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7ZM9.15 14a.9.9 0 0 0-.5 1.65c.9.68 2.03 1.02 3.35 1.02s2.45-.34 3.35-1.02a.9.9 0 0 0-1.06-1.45c-.64.47-1.4.72-2.29.72s-1.65-.25-2.29-.72a.9.9 0 0 0-.56-.2Z"
      />
    </svg>
  )
}
