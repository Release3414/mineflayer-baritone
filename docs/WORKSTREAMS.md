# 分组实施、代码所有权和联调验收

调查基线提交为 `62ba4d9`；**先应用包含本文件的文档提交，再从文档提交后的 HEAD** 创建 `port/g0` 至 `port/g6` 各自分支，按 [PORT_INTERFACES.md](PORT_INTERFACES.md) v1 实施。每组交付**可独立 cherry-pick 的本地 commit**、测试命令与结果、未覆盖的情况。不同分组可以同时开发，但同一文件只由一组修改；合并冲突交 G6，接口变更先同步各组。命名空间和文件在下表写明；测试文件使用组名后缀以免并行冲突。

## 交付节奏

| 阶段 | 可并行实施 | 合并门槛 |
| --- | --- | --- |
| 0：锁定契约和基线 | G0 单独做现有控制流修复；G1～G4 可读契约和编写各自新文件/测试 | G0 的 `stop`/失败语义验收通过；契约讨论归档 |
| 1：规划闭环 | G1 世界视图、G2 movement/cost、G3 搜索、G4 分段/执行可并行写模块，G6 在末尾接线 | G1 的 `WorldSnapshot`、G2 的候选和 cost 签名、G3 的结果形状在阶段内冻结；G6 按 G0→G1→G2→G3→G4 顺序集成 |
| 2：性能与远距离 | G5 在 G1～G3 的纯计算 fixture 稳定后做 worker 和缓存；G6 做服务器联调 | worker 候选生成等价、跨维度缓存隔离、取消和延迟结果测试通过；失败则保留默认合作式搜索并记录差异 |
| 3：扩展 | 另立后续任务：更多 movement、mine/explore/build/farm process、更多版本 | 不与此次寻路闭环的成功标准混淆 |

## 代码责任和任务卡

### G0：基线可靠性（先合并）

**独占文件**：`src/AshFinder.js`（直到 G6 开始）、`test/g0-baseline.test.js`。本组不重构 `pathfinder.js` 或 `executor.js`；与 G4 合作通过重现用例确认执行器缺口。

1. 用离线替身和必要的真实 Mineflayer 验证 `goto()` 的 `no path`、空路径、连续 partial、`stop()`、死亡、spawn 后重新开始；仅在最终 `goal.isReached` 才成功。对 `src/AshFinder.js` 内存 `PathCache` 与 `src/pathCache.js` 的不同语义给出清晰命名/用途；未接入的 warm nodes 不要宣称路径缓存已有效。
2. 修复 `goto()` 无法取消进行中的计算、旧异步结果可能被采纳、结束后未清理 promise/输入等问题；制定和 G3/G4 可接的 id/取消测试桩。保持现有入口兼容。
3. 将 `blockUpdate` 中可能空的 `newBlock`、事件与缓存失效处理纳入回归。完成后只允许 G6 修改 `src/AshFinder.js`。

**验收**：`npm test`；`node --test test/g0-baseline.test.js`；重复 goto/stop 时无悬挂 Promise、无残留控制状态；无路不报告 success。**交付提交**：`fix(port): establish navigation lifecycle baseline`。

### G1：世界适配与方块语义

**独占文件**：新增 `src/world/**`、`test/g1-world.test.js`；不修改 `src/movement/index.js`、`src/AshFinder.js`。由 G6 接线。

1. 从 Mineflayer 同步世界和 `minecraft-data` 构造 `WorldSnapshot`；读取 `bot.blockAt()` 时保留 `LIVE/CACHED/UNKNOWN`、min/maxY、世界/维度 id 与 epoch；对未加载区块、负坐标 chunk、维度切换保守处理。
2. 实现可测试的方块规范化：空气、全方块、半砖/楼梯、栅栏/墙、门、活板门、地毯/积雪、藤蔓/梯子、流体、落沙、危险方块；为不能从 2-bit 分类恢复精确碰撞与放置面的方块标 `partial` 并限制动作。
3. 世界变更事件驱动 invalidation；历史缓存只存可保守复用的字段，内存容量受限；落盘和跨线程构造由 G5 完成。

**验收**：未知不产生可通过或可挖邻居；缓存区不规划挖/放；加载后实时方块覆盖缓存；维度与负坐标正确；`node --test test/g1-world.test.js`。**提交**：`feat(world): add versioned pathing snapshot`。

### G2：movement 一致性和 tick 成本

**独占文件**：`src/movement/**`、新增 `src/cost/**`、`test/g2-cost.test.js`、`src/testing/TestScenarios.js`（若要增加 movement fixture）；不修改 `src/pathfinder.js` 或 `src/executor.js`。

1. `getNeighbors2()` 继续通过 registry 调用真实的 `Move.generate()`；上下文从 G1 `WorldSnapshot` 读取，同一候选带完整 break/place、virtual edit、动作前置条件和 `costTicks`。同目标但不同编辑/动作能力的候选不可无依据压成一个。
2. 计算走、跳、落、挖、放的 tick cost；`digTime` 用 Minecraft 50 ms/tick 换算，带工具/效果、等待和资源约束。明确 `Infinity` 不可行与无副作用；原有 `COST_*` 迁移期间以可比较 tick 语义解释或隔离为 legacy 模式。
3. 先覆盖 walk/diagonal/ascend/descend/break/bridge；再扩展水、攀爬、parkour。补虚拟支撑、先挖后放、脚手架计数、单个 bot 不同装备导致不同 cost 的 fixture；只用已有仓库的 movement 测试框架，不重建邻居逻辑。

**验收**：`npm test`、`node --test test/g2-cost.test.js`；同一动作成本为有限非负 tick、不可行动作为 Infinity，工具改变路径偏好；执行器可按原 `attributes` 消费。**提交**：`feat(movement): use shared tick cost candidates`。

### G3：Baritone 风格搜索与可用 partial

**独占文件**：`src/pathfinder.js`、`src/heap.js`、新增 `src/search/**`、`test/g3-search.test.js`；不修改 `src/movement/**`、`src/AshFinder.js`。

1. 以 G2 候选作为**唯一**邻居，修正节点 state key：不能只用 `posHash()` 合并相同位置但不同 virtual overlay、脚手架余额、方向/动作可行性；给出上界/支配规则并监控内存和展开次数。
2. 参考 Baritone `AStarPathFinder`/`AbstractNodeCostSearch` 加多系数 best-so-far、最小改进阈值、增量 cost backoff、无进展停机和 chunk 边缘截断；单位与 G2 tick cost 一致。加重规划已有路线的 favoring 时做成请求参数，不把旧 `closedNodes` 的绝对成本直接当新路 cost。
3. 实现 `SearchRunner`，提供结果状态、预算、取消、过期判定和确定性的 fixture；对无点坐标 Goal 的终止和 heuristic 做显式适配。保持旧 `Astar` 调用方直到 G6 接线。

**验收**：`node --test test/g3-search.test.js`；绕障、挖/放修改后同站位复访、超时有/无安全进展、未知区块边界、取消、慢而安全与快而危险路线；不因无路返回可执行路径。**提交**：`feat(search): add stateful segmented search primitives`。

### G4：分段管理与执行恢复

**独占文件**：`src/executor.js`、`src/waypoints.js`、新增 `src/segments/**`、`test/g4-journey.test.js`；不修改 `src/AshFinder.js` 或 `src/pathfinder.js`。所有公共入口接线由 G6 完成。

1. 新 `SegmentManager` 持有 current/next 两段、进展计数和目标 id，在 current 还可执行时预计算 next；只在安全边界拼接，路径覆盖、所需方块和真实位置不吻合立即作废并重新规划。保留顺序 waypoints 作为兼容回退。
2. `PathExecutor` 对不可靠部分补状态转移：挖/放 Promise、超时、失足、方块更新、重规划；`stop()` 清输入、拒绝或解析全部未决旅程、使过期回调无效。修正 `_onPathEnd` 没达到目标就 resolve 与 stuck 失败判断等基线缺陷。
3. 以 stub `SearchRunner` 做两段衔接、blockUpdate、死循环 partial、换目标/死亡/中途 stop 测试；G6 合并后再用真实 search 跑。

**验收**：`node --test test/g4-journey.test.js`、`npm test`；正常分段不在交界处停等完整搜索；危险动作期间不切路；停止后零控制、零旧段继续动作；真正到达才报告成功。**提交**：`feat(execution): precompute and splice safe segments`。

### G5：独立线程与历史世界缓存（第二阶段）

**独占文件**：新增 `src/worker/**`、`src/world/cache/**`（先与 G1 约定导入点）、`test/g5-worker-cache.test.js`。不改 G1～G4 文件；由 G6 接线。G1 的 `src/world/**` 所有权在 G1 合并后移交本组 `src/world/cache/**` 子目录。

1. 搜索 Worker 用可序列化 snapshot、world/goal/config/inventory 描述和代次；主线程不传 Bot/Block 或运动方法。须让同一 fixture 在 Worker 与同步模式生成等价候选、cost 与结果；如果 movement 仍依赖 bot，则先拆数据投影/评估问题，不能偷偷另写一套搜索规则。
2. 支持 worker 错误、超时、`stop()`、重启和丢弃旧代次。定量比较搜索期间 `physicsTick` 卡顿、耗时、内存与快照复制开销；与合作式 5 ms yield 的现状同条件比较。
3. 历史缓存可选磁盘持久化，按服务器/维度/版本隔离、写入原子、文件校验、容量/过期清理；空洞仍 `UNKNOWN`。

**验收**：`node --test test/g5-worker-cache.test.js`、事件循环对照测试；等价性不成立则默认关闭并交可复现阻塞报告，不能宣称实现了后台完整搜索。**提交**：`feat(perf): isolate search snapshots and cache`。

### G6：唯一联调与发布责任人（最后合并）

**独占文件**：G0 合并后的 `src/AshFinder.js`、`src/loader.js`、`index.js`、`index.d.ts`、`README.md`、`docs/**`、`test/g6-integration.test.js`、必要的 server fixture；仅 G6 可为消除真实集成冲突触及 G1～G5 文件，并在提交中逐项说明。

1. 依次 cherry-pick G0～G4，G5 仅在阶段 2 达标时接入；将内部 `SearchResult`/`Journey` 接到旧 `generatePath/goto/gotoSmart/stop`，保持外部 API、运行模式可回退。校正 README 宣称与 `index.d.ts` 类型，更新差距分析表和版本支持范围。
2. 跑 `npm test` 和所有组的单测，用固定版本本地 Minecraft 服务器至少做：普通步行、围障挖掘、脚手架、门/水、75 格以上分段、区块卸载/重新加载、执行中方块变化、stop/死亡/换目标、两机器人/多世界隔离；记录服务器版本、场景种子、耗时、失败原因。禁止仅凭离线测试判定服务器可靠。
3. 设置交付门槛：旅程只在 Goal 实际满足时成功；每种失败有稳定错误；无不可控路径反复重算；对 worker/磁盘功能只根据真实对照数据决定默认开关。写实际实现/未实现清单，提交一个最终联调 commit；不替其他组制造“已通过”记录。

**验收**：全部已合并组测试、真实服 smoke、从空目录安装和示例运行；把未执行的 server 测试清楚标作待验。**提交**：`integration(port): wire search, world and journey`。

## 跨组文件与一次性交接

| 共享界面 | 产出者 → 接收者 | 固定形状 |
| --- | --- | --- |
| `WorldSnapshot`/方块分类 | G1 → G2/G3/G5 | `PORT_INTERFACES.md` §1；`UNKNOWN` 安全默认 |
| `MoveCandidate`/tick cost | G2 → G3/G4/G5 | §3；复用 registry，`attributes` 兼容 executor |
| `SearchRunner`/result | G3 → G4/G5/G6 | §2；id、epoch、状态、起点/endpoint |
| `SegmentManager`/safe splice | G4 → G6 | §4；只有 executor 控制动作 |
| Worker snapshot codec | G5 → G6 | §5；未等价时默认关闭 |

每组 commit message 写明所参考基线 SHA，提交说明按「完成内容、契约变更、命令与结果、已知限制、需联调的事件」五项书写。不要提交 `node_modules`、测试生成的 `test-results-*.json`、凭据、上游整段源码；上游代码如需移入，先明确原项目许可证、引用与所选项目的许可要求。研究依据见 [UPSTREAM_RESEARCH.md](UPSTREAM_RESEARCH.md)。
