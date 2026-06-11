# DFC Multi-Agent Workflow

当前项目采用“多 Agent 分工，Project Manager 统一验收”的开发模式。

这个目录提供轻量级多 Agent 审计工作流：

- `agents.json`: Agent 职责、范围、交付物定义。
- `run_agents.py`: 本地审计脚本，检查关键文件和实现证据。
- `reports/latest.md`: 最近一次审计报告。

## 运行

```bash
python agent_pipeline/run_agents.py
```

## 当前边界

第一阶段只做审计和分工检查，不自动修改代码。

原因：

- 项目还在 MVP 闭环阶段。
- 自动多 Agent 改代码容易产生冲突。
- 必须先由 Project Manager Agent 统一审核范围、风险和测试结果。

## 后续升级路径

1. 增加每个 Agent 的独立 prompt。
2. 增加任务队列。
3. 增加代码变更提案输出。
4. 增加 Project Manager 审批门禁。
5. 通过审批后再允许 Agent 自动生成 patch。
