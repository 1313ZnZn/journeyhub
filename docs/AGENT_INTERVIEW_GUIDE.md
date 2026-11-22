# JourneyHub：Python Agent 迁移与面试讲解

本文对应仓库中的实现，可结合代码逐项练习。新增 Python 服务的代码测试与
线上发布是两个阶段；在真实部署、模型调用和浏览器验收完成前，介绍时使用
“实现并完成本地联调”，不要写“已在线上全面替换”。

## 项目介绍

JourneyHub 是一个旅游规划应用，支持景点推荐、行程规划、已保存行程对话和
预订记录管理。原有系统使用 JavaScript 编写 Agent 循环，运行在 Supabase
Edge Functions。此次通过独立 Python/FastAPI 服务，将核心行程规划和 Trip
Agent 的决策层接入 LangChain 和 LangGraph，复用原有工具、权限和任务持久化。

## 简历表述

**JourneyHub 旅游规划智能体｜Python、FastAPI、LangChain、LangGraph、Supabase、JavaScript**

- 实现 Python/FastAPI Agent 决策服务，通过 LangChain 工具绑定接入兼容 OpenAI
  协议的模型，将景点发现、行程规划和 Trip Agent 对话接入统一决策接口。
- 使用 LangGraph 构建“模型决策—参数校验—纠错重试”流程，结合 Pydantic、JSON
  Schema 和工具白名单限制输出，设置请求超时、调用次数及并发上限。
- 与现有 Supabase 后端集成，复用任务检查点、请求幂等和账号归属校验；通过
  Python 自动化测试及 JavaScript/Python HTTP 联调验证工具执行、任务恢复和上下文隔离。

精简版：

> 为旅游规划应用实现 Python/FastAPI + LangChain/LangGraph 决策服务，完成工具调用、
> 结构化参数校验和受限纠错，与 Supabase 持久化任务及 JavaScript 业务工具集成，
> 并编写自动化测试验证跨语言调用、任务恢复和账号上下文隔离。

这里没有加入未经测量的准确率、性能提升、用户规模，也没有声称实现 RAG、向量
数据库或 LangGraph 持久化 Checkpointer。代码中的数据库持久化由既有 Supabase
工作流完成。介绍贡献时，按自己实际参与和能够解释的内容调整措辞。

## 从一次请求讲清架构

1. 用户发送 Trip Agent 消息，Edge gateway 先校验登录身份和行程归属。
2. 原有数据库 RPC 创建/领取请求，通过 lease 和 request ID 控制重复执行。
3. JavaScript 整理当前行程、历史消息、工具结果和本轮可用工具。
4. 服务间认证请求把这些上下文发送给 Python `/v1/decide`。
5. LangChain `bind_tools` 把工具说明和参数 Schema 发给模型，返回标准 `AIMessage`。
6. LangGraph 的 `validate` 节点检查工具名、调用数量、参数类型与完整性。
   不合格时走 `repair`，最多再调用模型一次；仍失败则返回无可执行调用。
7. 原 JavaScript worker 执行合法工具，并继续做景点 ID、路线和预订等业务校验。
8. 工具结果进入下一轮观察；规划进度由 Supabase 保存。需要修改行程或支付时，
   原有用户确认流程负责真正执行，模型本身不能越过确认。

## 重点问题与回答思路

**LangChain 和 LangGraph 各负责什么？**

LangChain 负责统一模型接口、消息和工具绑定。LangGraph 负责显式描述状态、节点
和条件跳转。这里用了 StateGraph 定制“决策/校验/纠错”流程，没有调用高层
`create_agent` 来重建整套业务执行循环。

**为什么还保留 JavaScript？这算全部迁移吗？**

这是决策层的渐进迁移。路线计算、行程合法性、预订保护、支付确认已经有代码和
测试，所以通过清晰的 HTTP 边界复用。Python 侧的完整 Agent 执行器并未替换这些
模块，外层动作/观察循环仍在 Edge worker 中。代价是增加一次网络调用和一个
服务部署单元；其延迟影响需要实际测量。

**Function Calling 和 JSON 输出有什么区别？**

JSON 是输出格式。Function Calling 会给出工具名称和对应参数，由程序决定是否
执行。模型返回合法 JSON 也不代表它调用了允许的工具，更不代表参数符合业务
条件，因此要依次检查 JSON Schema、工具范围和具体业务规则。

**如何理解 ReAct 和思维链？**

ReAct 常见流程是结合当前上下文选择动作、执行工具、观察结果，再决定下一步。
本项目实现的是可观察的工具调用与结果反馈。不能把日志中的工具轨迹称为模型
完整的内部思维链；代码也不要求输出或保存私有推理过程。

**为什么需要重试次数和总超时？**

格式错误可以再给模型一次纠正机会，但无限重试会放大费用和等待时间。服务最多
进行两次模型调用，整个图有总期限，SDK 自动重试被关闭；外层 worker 还保留
原有任务时限。超时或模型失败时不会绕过验证执行未知动作。

**如何保持会话和账号隔离？**

Python 不维护全局会话，也没有所有用户共享的消息列表。每次请求携带由已认证
Edge gateway 整理的账号/行程上下文。真实身份和数据归属由 Supabase RPC 校验，
而不是相信模型返回的用户 ID。Python 服务 token 只认证可信后端，不替代最终
用户鉴权。

**LangGraph 的状态是否持久化了？**

此处图状态只存在于一次决策请求中。跨步骤恢复使用原有 PostgreSQL 检查点，
没有启用 LangGraph Checkpointer。这样避免同时维护两套任务状态；如果以后将
完整工具执行循环迁入 Python，再评估 Checkpointer 和故障恢复策略。

**项目用了 RAG 吗？**

当前通过地图 API、官方信息查询和已保存行程提供上下文，没有实现向量检索，
因此不要把现有查询称为 FAISS/Chroma RAG。之后可用独立的小项目学习文档切块、
embedding、召回、引用与检索评估，避免为简历标签混入未经验证的模块。

## 代码阅读顺序

1. `services/agent-api/journeyhub_agent/contracts.py`：请求模型、工具范围、Schema。
2. `services/agent-api/journeyhub_agent/graph.py`：模型绑定、图状态、节点与条件边。
3. `services/agent-api/journeyhub_agent/app.py`：鉴权、异步请求、并发、超时、结构化日志。
4. `work/journeyhub/supabase/functions/journeyhub-agent/decision-runtime.mjs`：跨语言接口。
5. `care-chat.mjs` / `traveler-planner.mjs`：工具执行、观察反馈和业务验证。
6. `services/agent-api/tests/` 与 `work/journeyhub/test-python-agent-integration.mjs`：测试证据。

## 面试演示

在仓库根目录运行 `npm run test:agent`。它不需要真实密钥，会启动本地 Python 服务，
通过真实 LangChain/LangGraph 代码走通模拟模型响应、非法调用修复、已有行程信息
工具、景点搜索、排程、路线检查和保存结果。外部模型/地图/数据库被模拟，所以
演示时明确介绍这是可复现的集成测试，而非实时联网规划演示。

讲解时打开 `graph.py`，解释三个节点及条件边，再打开一条非法工具调用测试。
然后展示 JavaScript 如何只执行验证通过的工具，最后说明数据库检查点在哪里。
这条线比只展示框架名称更容易体现你对代码的理解。
