# Domain Docs

## 布局

采用 single-context：

- 根目录 `CONTEXT.md`：领域术语和业务上下文。
- `docs/adr/`：架构决策记录。

## 消费规则

探索业务代码前，读取 `CONTEXT.md` 和与本次任务相关的 ADR。
文件尚不存在时静默继续；由 domain-modeling 在术语或决策明确后按需创建。

描述领域概念时使用 `CONTEXT.md` 中的术语。
遇到术语缺口，记录供后续领域建模处理。
方案与既有 ADR 冲突时，明确指出对应 ADR 和重新评估的理由。
