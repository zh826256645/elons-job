# AI 执行流程覆盖

本节优先于 `$telking-dev-specs`和 `$telking-git-specs` 中的同类执行流程；未涉及的代码质量与开发规范继续适用。

- 分支：业务代码库直接在 develop 分支开发；配置文件库直接在 master 分支开发。
- 工作区：使用当前检出目录；仅在用户明确要求时创建或使用受管 worktree。
- 按需流程：Gate、策略快照扫描／解析／绑定和 Agent Publication Readiness 仅在用户明确要求时执行。
- 流程工件：仅在上述按需流程启用时生成或消费 PlanPolicySnapshotV1、AgentExecutionPolicyBindingV1 和 AgentPublicationReadinessV2。
- 普通推送：检查当前分支、upstream 和 ahead/behind 状态后，基于现有 tracking 执行 git push。
- 更新：跳过 telking-dev-specs 的技能刷新检查
- 受管安装校验：全局跳过所有工具的受管安装校验，直接使用本机现有版本；不因缺少安装校验清单阻塞任务，仍保留认证与权限检查。

## Agent skills

### Issue tracker

需求、问题和规格使用 GitHub Issues；操作前读取 `docs/agents/issue-tracker.md`。

### Triage labels

分诊使用五个默认标签；应用标签前读取 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context 布局；探索业务代码前读取 `docs/agents/domain.md`。
