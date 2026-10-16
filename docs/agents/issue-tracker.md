# Issue tracker: GitHub

本仓库的需求、问题和规格使用 GitHub Issues，通过 gh CLI 操作。
从 git remote 确定仓库；当前为 zh826256645/elons-job。

- 创建：`gh issue create --title "..." --body-file <file>`
- 读取：`gh issue view <number> --comments`
- 列表：`gh issue list --state open`
- 评论：`gh issue comment <number> --body-file <file>`
- 标签：`gh issue edit <number> --add-label "..."` 或 `--remove-label "..."`
- 关闭：`gh issue close <number>`

多行正文写入临时文件后通过 `--body-file` 传入。
技能要求“发布到 issue tracker”时，创建 GitHub issue；
要求“读取相关 ticket”时，读取对应 issue 及其评论。

## Pull requests as a triage surface

**PRs as a request surface: no.**
