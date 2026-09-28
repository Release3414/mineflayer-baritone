# 寻路移植接口契约（v1 草案）

基线：`Release3414/mineflayer-baritone` 的 `62ba4d9`。本文件先固定跨组接口，随后各组在各自分支实现；**这里的类型是设计契约，不表示代码已经实现**。保持 CommonJS、`Vec3`、`Cell` 与现有 `bot.ashfinder` 公共入口；新增内部模块可用 JSDoc 描述，不要求把工程改造成 TypeScript。每次改变契约须先由联调组同步本文件和受影响组，再改实现。

## 0. 现有对象如何落位

| 现有对象 | 保留或改造 | 新边界 |
| --- | --- | --- |
| `src/movement/index.js` 的 `Move.generate()`、`getNeighbors2()`、`virtualBlocks` | 保留生成器；补入统一 world/cost 上下文 | 搜索器**只能**从 registry 获取邻居，不另写 `checkTraverse()` 一套规则 |
| `src/pathfinder.js` 的 `Cell`、`Astar()` | 适配内部 `SearchRequest`/`SearchResult`；公共 `generatePath()` 仍兼容 | `Cell.attributes.break/place` 继续给执行器；`status` 适配层负责转旧字符串 |
| `src/executor.js` 的 `PathExecutor` | 保留现有 move/action；提供安全的 segment 边界操作 | 只有 executor 控制 Mineflayer 按键、挖掘、放置 |
| `src/AshFinder.js` 的 `goto/gotoSmart/generatePath/stop` | 只由联调组接线和更新类型 | 对外行为与既有事件尽量兼容；新方法另行文档化 |
| `src/waypoints.js` | 保留回退兼容路径 | `SegmentManager` 在验收后接管长距离；禁止把路点顺序执行称为 splice |
| `src/AshFinder.js` 内部 `PathCache` 与 `src/pathCache.js` | 命名清晰化，测试后决定保留哪种路径结果缓存 | 二者**都不是**历史区块缓存；不得代替 `WorldSnapshot` |

## 1. 共享值类型、坐标和来源

以下代码是 JS/JSDoc 形状定义。`BlockPos` 为整数方块坐标；现有 `Cell.worldPos` 是**脚部站位**（常见 `x + 0.5, y, z + 0.5`），坐标转换只在边界完成。维度 ID、版本、缓存代次必须成为快照的一部分，不得跨维度复用缓存或结果。

```js
/** @typedef {{x:number, y:number, z:number}} BlockPos */
/** @typedef {'LIVE'|'CACHED'|'UNKNOWN'} BlockSource */
/** @typedef {{x:number,y:number,z:number,source:BlockSource,
 *    stateId:number|null, name:string|null, collisionBoxes:readonly number[][],
 *    passable:boolean, replaceable:boolean, liquid:boolean,
 *    climbable:boolean, hazardous:boolean, support:boolean,
 *    breakable:boolean, partial:boolean}} PathBlock */
/** @typedef {{dimension:string, epoch:number, minY:number, maxY:number,
 *    getBlock:(p:BlockPos)=>PathBlock, isChunkLoaded:(cx:number,cz:number)=>boolean}} WorldSnapshot */
/** @typedef {{position:BlockPos,state:'air'|'placed',stateId?:number}} VirtualEdit */
```

不变量：`UNKNOWN` 不能被默认为空气或可挖；`CACHED` 的 2-bit 分类不能伪造碰撞盒、方块朝向和放置参考面。只有 `LIVE` 且有足够精确信息时才可规划挖掘、放置、门、楼梯、半砖等动作；在缓存区域只允许经过保守验证的普通行走，执行前须再次查实时世界。`PathBlock` 的未知值保守取 `passable=false, support=false, breakable=false`。同维度更新令 `epoch` 递增；区块加载、卸载、方块更新的快照与结果要可判定是否过期。

查询优先级：本条路径的 `virtualBlocks`（只有有明确动作的已规划修改）→ 实时加载的方块 → 同维度的历史缓存 → `UNKNOWN`。**虚拟修改只覆盖必要坐标**；在状态去重时不能把不同虚拟世界和不同剩余脚手架数量合并成一个节点。为避免内存爆炸，可用受限的状态签名和支配剪枝；剪枝必须证明后续动作可行性相同，并提供相反覆盖物状态到同一站位的回归测试。

## 2. 规划输入与输出

```js
/** @typedef {{allowBreaking:boolean,allowPlacing:boolean,allowParkour:boolean,
 *   maxFallDistance:number,availableScaffolds:number, toolProfile:readonly object[],
 *   movementCostProfile:object, searchBudgetMs:number, maxExpanded:number}} SearchSettings */
/** @typedef {{id:number,goal:object,start:BlockPos,world:WorldSnapshot,
 *   settings:SearchSettings, excluded:readonly BlockPos[], signal:AbortSignal,
 *   sourceEpoch:number}} SearchRequest */
/** @typedef {'FOUND'|'PARTIAL'|'NO_PATH'|'TIMEOUT'|'CANCELLED'} SearchStatus */
/** @typedef {{status:SearchStatus, path:readonly import('../src/pathfinder').Cell[],
 *   endpoint:BlockPos|null, reason:'goal'|'budget'|'chunk_edge'|'exhausted'|'invalidated'|'cancelled',
 *   estimatedTicks:number, visitedChunks:readonly string[],
 *   requestId:number, sourceEpoch:number, expanded:number}} SearchResult */
/** @typedef {{search:(req:SearchRequest)=>Promise<SearchResult>,
 *   cancel:(id:number)=>void}} SearchRunner */
```

规则：`FOUND` 只在 `goal.isReached(feetPosition)` 为真时产生；`PARTIAL` 必须有**可安全驻足**、与起点有实质进展且可执行的 endpoint；未取得这样的节点返回 `TIMEOUT`（预算耗尽）或 `NO_PATH`（搜索穷尽）且 `path=[]`。`CANCELLED` 永远不能启动执行。`path[0]` 表示起点，其余每个 `Cell` 都携带 `moveName`、`attributes`（包括 `break/place`）、预计 tick cost 与此步之后的虚拟编辑。`estimatedTicks` 是各边 cost 之和，有限、非负；heuristic 同单位，起点计 0。无点坐标的 Goal（如 `GoalXZ`、`GoalYLevel`、复合、反向、动态跟随）仍以 `isReached` 为终点判定；可接纳的启发式单独设计，不能拿一个 `getPosition()` 直接当作全部 Goal 的距离语义。动态目标变动需令请求过期并重算。

搜索组的首版判定规则：为多个成本系数分别记录候选（参考值 `1.5, 2, 2.5, 3, 4, 5, 10`）；每次以 `h + g/c` 比较，并只在改善达到约 `0.01` tick 时更新。超时或 chunk 边缘按系数优先级依次挑选距离起点至少 5 格、可安全驻足且比起点更接近目标的 endpoint；找不到则不返回 `PARTIAL`。**最小位移和系数是可调策略，不是精确翻译承诺**；碰到障碍使直线距离暂时变远时，允许按进展/成本与可达性共同评估，但必须保证相同 endpoint 重复出现时有限次失败退出。记录 timeout 原因、候选 cost、expanded，供分段组判别停滞与回退。

**适配旧入口**：`AshFinder.generatePath()` 现有 `found/partial/no path` 与 `goto()` 的 `success/failed` 暂时保留。联调组把内部 `FOUND/PARTIAL/NO_PATH/TIMEOUT/CANCELLED` 映射到外部返回值和错误，严禁 `NO_PATH` 但携带 best-node 路径、空路径或取消被当作成功；仅确认达到 `goal.isReached` 后返回 `success`。原有 `pathStarted` 等事件只在合法路径被采用时触发；新增 `pathSegment`, `pathReplanned`, `pathFailed` 在实现后补进 `index.d.ts` 和 README。

## 3. 单一 movement 与 tick 代价

```js
/** @typedef {{world:WorldSnapshot, player:object, inventory:object,
 *   settings:SearchSettings, overlays:ReadonlyMap<string,VirtualEdit>}} CalculationContext */
/** @typedef {{from:BlockPos,to:BlockPos,moveName:string,attributes:object,
 *   break:readonly BlockPos[],place:readonly BlockPos[],
 *   virtualEdits:readonly VirtualEdit[],costTicks:number,
 *   safeEndpoint:boolean,requiredChunks:readonly string[]}} MoveCandidate */
/** @typedef {{estimate:(candidate:MoveCandidate,ctx:CalculationContext)=>number}} CostModel */
```

`Move.generate()` 是唯一的候选动作来源，计算过程不得改变 bot、库存、world 或发送包。`CostModel.estimate()` 是无副作用函数：以 tick 为单位组合移动、挖掘（Minecraft `block.digTime()` 毫秒转换到 tick，含工具/效果）、放置等待、水与风险；返回 `Infinity` 代表不可行。启发式不得高估启用模式下的最低可达 cost；若启用加权搜索，要显式标注非最优路径。工具与脚手架资源在整条路径中有界，库存资料生成一次快照，不在百万次邻居查询时反复 `require('minecraft-data')` 或遍历实时库存。不能把缓存的 `bestHarvestTool` 仅按 block name 键入，须包括版本、工具/效果/状态，或按请求清理。

第一轮必须覆盖 `MoveForward`、`MoveDiagonal`、`MoveForwardUp/Down`、`MoveForwardDownBreak`、放置脚手架；其他现有 movement 暂留兼容权重转换，待成本基准覆盖后迁移。额外 movement（parkour/place、水桶等）不阻塞基础闭环。执行器对破坏/放置要比较预期与实时方块；`Promise` 是非阻塞动作子状态，失败、超时或资源变化返回重算请求；不得在单次 `tick()` 内等待无限时长。

## 4. 分段与取消协议

```js
/** @typedef {{id:number,goal:object,current:SearchResult|null,next:SearchResult|null,
 *   goalEpoch:number,worldEpoch:number,mode:'IDLE'|'CALCULATING'|'EXECUTING'|'PRECALCULATING'|'REPLANNING'|'DONE'|'FAILED'}} Journey */
/** @typedef {{canSplice:(current:SearchResult,next:SearchResult,index:number)=>boolean,
 *   splice:(current:SearchResult,next:SearchResult,index:number)=>SearchResult}} SegmentPort */
```

单个 Journey 同时最多一个执行中的 segment 和一个预计算中的 next。next 起点为当前路径上可安全驻足的实际或预测节点；拼接须满足位置、移动方向/动作前置条件、库存/虚拟编辑连续性、同一维度与有效 `worldEpoch`。在下落、跳跃、挖/放 Promise 或其他不可安全取消的动作中，不切换路径；不兼容就丢弃 next 并从当前位置重算。计算提前启动但不能持有 Mineflayer 控制权。`stop()`、新目标、死亡、换维度统一递增 journey/request id、abort 计算、结束旧动作、释放控制，并且旧 Promise 的完成不可启动下一段。`goto()` 的完成条件是最终目标满足；连续 partial 但没有进展须有上限并明确失败。

## 5. Worker/历史缓存的第二阶段边界

Worker 仅收纯结构化数据（块分类与细节、库存成本资料、规则、配置、Goal 描述、id/epoch），不能跨线程传 Bot、Block、函数、Promise、`Cell.parent` 环或 `AbortSignal` 对象。先实现可与同步搜索器运行相同 fixture 的 `SearchRunner`，逐边比较候选、成本与状态；做不到等价时 worker 仅留实验开关，默认仍运行合作式搜索。历史缓存先内存、按世界/维度/版本隔离，卸载后保留但标记 `CACHED`；落盘格式须有版本、完整性校验、容量限制与原子写入。worker 与落盘缓存均为后续阶段，不可被作为第一阶段验收通过的条件。

## 6. 合同测试

每个实现组都使用相同 fixture 断言：同站位不同覆盖物、脚手架耗尽、未知区块不当空气、方块在搜索与执行间变化、工具快慢改变路径排序、远目标分段起点连续、连续 partial 停滞、stop 后延迟 Promise、世界切换后旧结果作废。联调组补 1.20/1.21 中实际支持的一个确定版本的本地服务器样例与日志；纯 mock 不能证明挖/放和区块事件正确。见 [WORKSTREAMS.md](WORKSTREAMS.md) 的每组验收和 [UPSTREAM_RESEARCH.md](UPSTREAM_RESEARCH.md) 的源码依据。
