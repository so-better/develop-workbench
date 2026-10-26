# 数据可视化

- 类别比较用条形图，时间趋势用折线图，占比用饼图但类别不超过 5 个。
- 柱状图纵轴从 0 开始；折线图可不从 0 开始，但要注明。
- 图表必须有清晰标题、单位和必要的数据来源说明。
- ECharts 配置必须是纯 JSON，不包含注释、函数或末尾逗号。
- 流程、架构和时序关系使用 Mermaid，不用 ECharts。
- ECharts 使用语言标记为 `echarts` 的代码块，代码块内只放纯 option JSON。
- 不要写 `const option = ...`、`option = ...`、函数、注释或末尾逗号。
- option 至少包含 `title`、`tooltip`、`xAxis`/`yAxis` 和 `series`；饼图可省略坐标轴。
