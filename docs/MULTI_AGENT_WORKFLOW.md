# 多 Agent 工作流

## 当前状态

DFC 当前采用多 Agent 分工架构，但不是多个 AI 进程自动并行改代码。

当前模式：

```text
一个 Codex 执行者
按多个 Agent 的职责边界推进
Project Manager Agent 统一验收
```

新增的 `agent_pipeline/` 提供轻量审计机制，用来检查每个 Agent 负责范围是否有对应文件、实现证据和测试记录。

## 为什么先做审计型多 Agent

自动多 Agent 直接改代码有三个风险：

1. 多个 Agent 同时改同一模块，容易冲突。
2. 钱包、订单、提现属于资金敏感逻辑，不能让多个 Agent 无门禁改动。
3. 当前第一目标是跑通最小商业闭环，不是追求复杂自动化。

所以第一阶段采用：

```text
Agent 分工清晰
自动生成审计报告
人工确认后再实施改动
```

## Agent 列表

- Project Manager Agent
- Database Agent
- Customer Agent
- Companion Agent
- Admin Agent
- Order Agent
- Wallet Agent
- Discord Agent
- KOOK Agent
- UI/UX Design Agent
- DevOps Agent
- QA Agent

## 运行方式

```bash
python agent_pipeline/run_agents.py
```

输出：

```text
agent_pipeline/reports/latest.md
```

## 验收原则

- Project Manager Agent 负责最终合并判断。
- QA Agent 必须覆盖业务闭环测试。
- Database/Order/Wallet Agent 的资金相关改动必须经过事务和并发风险审核。
- UI/UX Design Agent 不能改变业务逻辑。
- DevOps Agent 不能执行删除、付款、账号、安全设置变更，除非用户明确确认。
