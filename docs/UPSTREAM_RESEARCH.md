# 移植依据与源码映射

本次对四个仓库做源码对照；下面的 SHA 是研究时检出的版本，不代表以后仓库不会变化。建议每组对照指定文件，不直接复制异许可证源码；结论以**本 fork 的实际代码与测试**为准。外部文件路径通过各项目的原始 commit 打开。

| 项目（检出 SHA） | 可借鉴的实现 | 对本项目的判断 |
| --- | --- | --- |
| [Baritone 1.21.4 `c5a7728`](https://github.com/cabaletta/baritone/tree/c5a7728aaa592c876b44b401eaf41c66758aeeeb) | [AStarPathFinder](https://github.com/cabaletta/baritone/blob/c5a7728aaa592c876b44b401eaf41c66758aeeeb/src/main/java/baritone/pathing/calc/AStarPathFinder.java)、[AbstractNodeCostSearch](https://github.com/cabaletta/baritone/blob/c5a7728aaa592c876b44b401eaf41c66758aeeeb/src/main/java/baritone/pathing/calc/AbstractNodeCostSearch.java)、[PathingBehavior](https://github.com/cabaletta/baritone/blob/c5a7728aaa592c876b44b401eaf41c66758aeeeb/src/main/java/baritone/behavior/PathingBehavior.java)、[CachedWorld](https://github.com/cabaletta/baritone/blob/c5a7728aaa592c876b44b401eaf41c66758aeeeb/src/main/java/baritone/cache/CachedWorld.java) | 多系数候选、回退、两段路径及安全拼接是参考目标；Java 客户端世界和线程模型不能直接接到 Mineflayer。源码属于 LGPL-3.0；迁移代码须单独审查许可与来源。 |
| [PrismarineJS/mineflayer-pathfinder `6f5c26b`](https://github.com/PrismarineJS/mineflayer-pathfinder/tree/6f5c26bf79e7861d20e0fbc735059db51e4d8f77) | [`lib/astar.js`](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/6f5c26bf79e7861d20e0fbc735059db51e4d8f77/lib/astar.js) 的时间片与 partial；[`lib/movements.js`](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/6f5c26bf79e7861d20e0fbc735059db51e4d8f77/lib/movements.js) 的 `getNeighbors`、挖/放规则 | 有相对成熟的 Mineflayer API 基线；成本以可调抽象权重为主，非本项目目标的统一 tick cost；没有可直接替换的 Baritone current/next 路段。仓库许可证 MIT。 |
| [nuxdie/baritone-ts `f9dd747`](https://github.com/nuxdie/baritone-ts/tree/f9dd747becbab714f80664f09246858be6a81897) | [`src/pathing/AStar.ts`](https://github.com/nuxdie/baritone-ts/blob/f9dd747becbab714f80664f09246858be6a81897/src/pathing/AStar.ts) 的多系数追踪、[`src/cache/ChunkCache.ts`](https://github.com/nuxdie/baritone-ts/blob/f9dd747becbab714f80664f09246858be6a81897/src/cache/ChunkCache.ts) 的分组编码、[`src/pathing/AsyncPathfinder.ts`](https://github.com/nuxdie/baritone-ts/blob/f9dd747becbab714f80664f09246858be6a81897/src/pathing/AsyncPathfinder.ts) 的合作式计算 | `AStar.getNeighbors/checkTraverse` 与独立 `MovementTraverse.calculateCost` 并列，不能拿 README 中的 movement 数量推断 A* 实际可规划这些动作；异步实现使用 `setInterval`，并非 worker。缓存模块存在，是否在目标流程稳定接通需实测。仓库 LICENSE 为 AGPL-3.0，限制直接搬运代码。 |
| [本 fork `62ba4d9`](https://github.com/Release3414/mineflayer-baritone/tree/62ba4d9dec5ce2db3696e246d2a0abf5c37933c7)（上游 [`miner-org`](https://github.com/miner-org/mineflayer-baritone)） | [`src/movement/index.js`](https://github.com/Release3414/mineflayer-baritone/blob/62ba4d9dec5ce2db3696e246d2a0abf5c37933c7/src/movement/index.js)、[`src/pathfinder.js`](https://github.com/Release3414/mineflayer-baritone/blob/62ba4d9dec5ce2db3696e246d2a0abf5c37933c7/src/pathfinder.js)、[`src/executor.js`](https://github.com/Release3414/mineflayer-baritone/blob/62ba4d9dec5ce2db3696e246d2a0abf5c37933c7/src/executor.js) | 保留 movement registry、virtualBlocks、Mineflayer 执行器和测试；改进状态区分、成本、路径结果与长距离协调。package 声明 ISC；任何从参考项目直接复制的代码仍须单独核对许可。 |

## 本 fork 中可证实的差距

| 目标 | 位置和现状 | 交给 |
| --- | --- | --- |
| 有意义的 partial 与搜索回退 | `src/pathfinder.js` 的 bestNode 按最小 h 追踪；超时返回 `partial`，open 耗尽时甚至可返回 `status: 'no path'` 携带 bestNode 路径；`posHash()` 主要按坐标去重 | G3，G0/G6 校正旧 API 失败语义 |
| movement 的规划一致性 | `getNeighbors2()` 确实逐个调用 `Move.generate()` 并传播虚拟挖/放；但相同坐标的邻居只保留最低 cost，搜索 open/closed 也按坐标处理，可能合并不同世界编辑历史 | G2 候选、G3 状态 key；共同 fixture |
| tick 成本 | `Move` 常量 `COST_NORMAL=1`, `COST_UP=1.5`, `COST_PLACE=1.67` 等是权重；部分挖掘逻辑按 `digTime / 100` 额外收费，单位不统一 | G2 |
| 分段 | `AshFinder.gotoSmart()` 在距离超过 75 时调用 `SmartWaypointPlanner`，逐个 `await goto()`；`PathExecutor` 会走完 partial 再 `_generateNextPath()` | G4/G6 |
| 缓存 | `src/AshFinder.js` 中的 `PathCache` 存闭集供可能的 warm nodes（当前调用被注释）；独立的 `src/pathCache.js` 存路径结果，当前核心调用链未直接使用。都不保存卸载后的方块语义 | G0 核对与清理，G1/G5 历史世界缓存 |
| 真正后台计算 | `Astar()` 每约 5 ms `setTimeout(0)` 让出事件循环，仍在主线程调用同步 movement 与 bot API | G5，须先数据化 |
| 成功与停止 | `PathExecutor._onPathEnd()` 在续接失败时调用 `_resolveCompletion()`；`AshFinder.goto()` 在执行器 resolve 后直接返回 success；`stop()` 要检验异步请求及 completion Promise 的收尾 | G0/G4/G6 |

源码逐项定位可用：Baritone `pathing/movement/Moves.java` → 本 fork `src/movement/*.js`；`CalculationContext`/`BlockStateInterface` → 新 `src/world/**` + `src/cost/**`；`AbstractNodeCostSearch`/`AStarPathFinder` → `src/pathfinder.js`/`src/search/**`；`pathing/path/PathExecutor.java`/`behavior/PathingBehavior.java`/`SplicedPath.java` → 本 fork `src/executor.js`/`src/segments/**`；`cache/CachedWorld.java` → 新 `src/world/cache/**`。这是**概念映射**，不是逐类逐行翻译。

## 证据边界与选择

- 本 fork 在 `62ba4d9` 上以 Node 24 和仅安装生产依赖运行 `npm test`：3 个 `node:test` 用例通过，13/13 movement 场景通过；这些都是离线测试，没有证明真实服务器的挖/放、停止或超长路径可靠。安装动作未生成受版本控制的锁文件。
- 以此为基础，应优先保留已测试的 movement → planner → executor 链条。`baritone-ts` 的多系数思想值得对照，但若复制它的邻居生成，将把同一 movement 规则写出第二份。`mineflayer-pathfinder` 用作行为/回归对比，不在此阶段替换底盘。
- 上游 Baritone 的功能清单与实现可能随版本演进。本项目目标是**可靠的生存模式长距离寻路、挖/放和失败恢复**，不是承诺所有 Baritone process、全部 movement、磁盘缓存或全版本兼容。上述其余能力分阶段验收。
