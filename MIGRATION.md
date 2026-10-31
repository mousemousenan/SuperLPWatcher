# SuperLP 迁移与开发交接

更新日期：2026-10-27。当前阶段：需求讨论，尚未实现应用代码。

## 1. 新电脑需要的技能

沿用当前工作流，迁移下面两个技能即可。技能是包含 `SKILL.md` 的目录，不是 pip/npm 软件包；应复制整个目录，包括 `scripts/`、`references/` 和随包依赖。

| 技能 | 用途 | 运行环境 | 本机来源目录 |
| --- | --- | --- | --- |
| `doc-qa` | 本地 Word 文档检索、索引、引用来源 | Python 3.9+；标准库即可，python-docx 等为可选增强 | `C:/Users/saisn/.agents/skills/doc-qa/` |
| `req-lifecycle-manager` | 维护 REQ、CR、索引、日志，后续生成 PRD | Node.js 18+，推荐 22+；js-yaml 已随包提供 | `C:/Users/saisn/.agents/skills/req-lifecycle-manager/req-lifecycle-manager/` |

新电脑可沿用本机用户级目录布局。Windows 用新用户自己的目录，macOS/Linux 对应 `~/.agents/skills/`：

```text
<用户目录>/.agents/skills/
  doc-qa/
    SKILL.md
    scripts/
    references/
  req-lifecycle-manager/
    SKILL.md
    scripts/
    references/
```

注意源目录中需求技能有两层同名目录；复制的是直接包含 `SKILL.md` 的内层。迁移后在 Codex 新建会话，确认技能列表出现这两个名称。此路径按当前机器实际布局提供；本次无法连接 OpenAI 官方文档核对客户端最新行为。

当前无需安装额外技能。后续写正式测试计划可选 `authoring-test-plan`，做实现质量复核可选 `qa-story`，代码规模增大后可选 `understand-anything` 系列；这些均不是当前需求档案的硬依赖。

## 2. 项目要复制什么

复制整个项目目录，并包含隐藏文件。核心内容：

```text
SuperLP/
  链上LP系统学习笔记_第1至11课.docx
  链上LP专题研究笔记_专业做市与期权对冲.docx
  MIGRATION.md
  docs/
    index.md
    log.md
    wiki/requirements/
    wiki/changes/
    references/
    .req-manager-scripts/       # 脚本、vendor 和许可证一起保留
    .req-id-reservations/      # 已分配的需求编号
    .cr-id-reservations/       # 已分配的变更编号
  .docqa/                     # 可复制，也可由原始文档重建
```

`docs/` 已有需求管理脚本副本，安装 Node.js 后可以直接运行。完整技能仍有用，因为其中的 `SKILL.md` 和参考文档告诉助手如何维护需求。`doc-qa` 的程序不在项目内，必须另外迁移技能目录。

`.docqa/docs.json` 含旧电脑的绝对路径 `D:/vibecoding/SuperLP/...`。旧索引中已存文本仍可能可检索，但路径改变后建议在新目录重建，避免旧元数据和后续更新混用。它不是原始资料，也不是技能本身。

截至本次检查，项目无 Git 仓库、应用代码或磁盘上的 `AGENTS.md`。之前用户提供的 AGENTS 规则在聊天中；如需在新会话继续使用，请将那段原文保存为项目根目录的 `AGENTS.md`。其中指定的旧模型名称需与新客户端实际可用模型核对。

现有 `SuperLP.rar` 创建于本说明之前；它没有自动更新，本次没有修改压缩包。若使用压缩包迁移，请重新打包或单独补带本文件和两个技能目录。

## 3. 新电脑核验步骤

在新项目根目录打开终端。以下是 PowerShell 示例；其他系统使用对应路径运行同样的 Python/Node 命令。

先核对解释器。如果使用 Conda，输出路径必须属于已激活的环境，发现不匹配应先修正环境。

```powershell
python -c "import sys; print(sys.executable)"
node --version
```

确认解释器正确后，设置技能位置并检查环境：

```powershell
$env:PYTHONUTF8 = '1'
$docqaScript = Join-Path $env:USERPROFILE '.agents/skills/doc-qa/scripts/docqa.py'
python $docqaScript doctor
```

在项目根目录重建两份源文章的索引：

```powershell
python $docqaScript index --index-dir .docqa --file '链上LP系统学习笔记_第1至11课.docx' --file '链上LP专题研究笔记_专业做市与期权对冲.docx' --rebuild --no-jieba
python $docqaScript search 'CLMM 手续费 活跃流动性' --index-dir .docqa --top-k 3
node docs/.req-manager-scripts/requirement_doc.mjs --action=validate --project-root=.
```

预期：索引包含两份源文章，检索能返回来源段落，需求校验无错误。分块数量和引用行号可能因可选提取器版本不同而变化，应使用新检索结果引用。现有需求无需重新创建 REQ-001 或 CR-001。

基础索引和检索无需 API key，也不需要向外部服务上传文档。上面的命令供新电脑执行，本次没有在新电脑验证。

## 4. 已有需求与讨论状态

用户目标：结合《链上LP系统学习笔记_第1至11课》与实现知识，设计链上池子的收入、成本、预期利润计算器，并探测各池资金总量和地址分布；从 Sui、CLMM 开始，先讨论和细化输入及实现方式。

持久化记录：

- `docs/wiki/requirements/REQ-001-Sui-CLMM池子分析与收益计算器.md`：状态 `proposed`，当前只有需求概要。
- `docs/wiki/changes/CR-001-记录Sui CLMM分析计算器初始需求.md`：初始需求来源。
- `docs/index.md` 和 `docs/log.md`：索引与操作日志。

以下是上一轮讨论的建议，尚未获得用户对范围的确认：

1. 分为池子扫描器和个人 LP 计算器。扫描器展示池画像，计算器支持新投入资金的情景分析及已有仓位复盘。
2. 新仓位最少输入：池子、投入金额或两币数量、区间上下沿、持有期限；单币投入还需估算配币兑换成本和未投入余额。池价、费率、Tick、交易量等尽量自动读取。
3. 地址分布暂按 LP Position 的链上持有人聚合。LP 地址、交易地址、全链代币持有人是三个独立口径；托管/聚合器不能自动当作最终个人身份。
4. 总 TVL、当前活跃流动性、区间深度、未领取费用与奖励分别定义，避免重复计入。Tick 的 liquidityNet 不是美元 TVL。
5. 收入包含 LP 手续费和激励；成本包括 Gas、配币/调仓交易费、价格冲击和滑点。利润还需包含本金市值变化。费用已体现在真实余额或成交结果时，不再额外重复扣减。
6. 账户完整核算应考虑期初/期末权益和期间存取款。IL 是相对初始持币组合的差额，LVR 是相对公平价再平衡基准的路径损耗，不能在完整账户 PnL 之外再重复扣除。复投的手续费不能同时计入本金和独立收入两次。
7. 历史个人手续费需要当时的 Position、Tick、协议分成和 fee growth；仅有池级交易量或小时 K 线不足以精确核算。新增模拟仓位的份额可用 L_own/(L_existing + L_own) 做近似，需说明新增资金可能改变成交路径。
8. 静态价格情景能计算期末本金，未来手续费还依赖价格路径、成交量、竞争流动性和激励规则。情景结果不能称为已经校准的概率预测；缺数据不得按零手续费冒充净利润。
9. Sui 接入需要按具体协议解析 Move 对象/事件、Pool、Position、Tick 和所有权变更，保存 checkpoint、对象版本及交易顺序。不能直接照搬 Ethereum 的事件名称、Subgraph 或定点编码。
10. 候选分阶段路线：单协议当前池画像和固定区间情景 → 完整历史索引及实仓核算 → 调仓和反事实回测 → 多协议、对冲及多链。首版不必同时覆盖所有协议。

文章依据：第 4 课讨论出区间与调仓摩擦，第 8 课区分账户盈亏与理论经济性，第 10 课强调逐笔 Swap、Tick 与活跃份额，第 11 课给出 CLMM 本金公式及验证路线。Sui 数据接口及实际协议可用性尚未进行联网核验。

未决项：

- 第一个协议和具体池子：Cetus、Turbos 或其他；主网/测试网也未确认。
- 优先目标：新资金选池前预测，还是已有仓位复盘。
- 地址分布究竟指 LP 持有人、交易地址，还是全链代币持有人。

## 5. 在新会话中接续

可以直接粘贴：

> 继续 SuperLP 项目。先读取 MIGRATION.md、docs/index.md、REQ-001 及 CR-001，并用 doc-qa 检索两份原始文章。项目目前处于需求讨论阶段，Cetus/Turbos、池子、预测或复盘优先级以及地址分布口径尚未确定。请从这些未决项继续细化用户输入、收益核算和 Sui CLMM 数据实现，不要把上一轮建议视为已批准的实现范围。维护现有需求编号和变更记录。
