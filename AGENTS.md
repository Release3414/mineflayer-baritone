# 给并行移植代理的工作说明（agents.md）

你参与 `Release3414/mineflayer-baritone` 的 **Baritone 风格寻路能力移植**。研究/文档所用的旧代码基线是 `62ba4d9dec5ce2db3696e246d2a0abf5c37933c7`；这份说明与 `docs/PORT_INTERFACES.md`、`docs/WORKSTREAMS.md`、`docs/UPSTREAM_RESEARCH.md` 应先作为一个文档提交应用到本地，各实现组**从文档提交后的 HEAD** 创建分支，再分配具体组。请只执行明确指派给你的 G0～G6 任务；未经交接不要抢改其他组文件。以实际代码和测试为准，文档中的接口为待实现契约。

## 交付目标与不可变约束

- 最终目标：在现有 Mineflayer plugin 中实现有可用 partial、可靠分段续行、可控挖/放、真实目标成功判断和失败恢复的寻路；worker/历史缓存另设第二阶段门槛。不是完整逐行翻译 Java，也不是引入另一套 pathfinder 来替代现有项目。
- 保留 CommonJS、现有 public API `bot.ashfinder`、goal 类和 `Move.generate()` registry；保留 `Cell.attributes.break/place` 到执行器的数据链。变更外部类型、事件或默认行为由 G6 统一接线与说明。
- 每个 `Move.generate()` 是规划候选唯一来源。不同 virtual overlay、资源余额和动作前置条件不能因为站位相同就无证明地合并。`UNKNOWN` 区块绝不视为空气。`PathCache` 不是世界缓存。不得把 `no path`、取消、仅完成 partial 当到达最终 Goal。
- 不复制 Baritone LGPL 或 `baritone-ts` AGPL 源代码到本项目，除非已明确安排独立的许可与归属处理；可研究算法、写独立实现并标注所参照文件。
- 每组创建单独 `port/gN` 分支和本地 commit；不得 push、发 PR、更新 package 版本或发布。提交说明写明基线、所做改动、测试和限制。只交可合并的代码与必要回归，不把提议当完成。

## 领取任务：任选一个明确分配的组号

| 组 | 修改范围（排他） | 必做交付与验证 | 依赖 |
| --- | --- | --- | --- |
| **G0 基线可靠性** | `src/AshFinder.js`、`test/g0-baseline.test.js` | 锁定 stop/死亡/无路/旧回调/空路径语义，弄清两类 `PathCache`；`npm test` 和新增生命周期测试 | **先合并**；将 `AshFinder.js` 所有权移交 G6 |
| **G1 世界/语义** | 新 `src/world/**`（`cache/**` 留 G5）、`test/g1-world.test.js` | `LIVE/CACHED/UNKNOWN`、版本和维度隔离、保守方块语义、变更代次；未知和部分碰撞类型 fixture | 契约 §1；G6 接线 |
| **G2 movement/cost** | `src/movement/**`、新 `src/cost/**`、`src/testing/TestScenarios.js`、`test/g2-cost.test.js` | 单一候选规则、虚拟编辑与 tick 单位成本；步行/斜行/上/下/挖/搭桥测试；`npm test` | 接 G1 snapshot 形状；将候选交 G3 |
| **G3 搜索** | `src/pathfinder.js`、`src/heap.js`、新 `src/search/**`、`test/g3-search.test.js` | 状态安全去重、多系数部分路径/回退、chunk 边界、取消及明确状态；保持调用边界直到 G6 接线 | 从 G2 的 generator 获取候选，接 G1 的世界快照 |
| **G4 分段/执行** | `src/executor.js`、`src/waypoints.js`、新 `src/segments/**`、`test/g4-journey.test.js` | current/next 预计算、安全 splice、重复 partial 限制、异步动作和停止收尾；waypoints 作回退 | 用 G3 的 SearchRunner 接口和 stub；G6 接线 |
| **G5 worker/历史缓存** | 新 `src/worker/**`、`src/world/cache/**`、`test/g5-worker-cache.test.js` | 与同步 search 的候选和结果对齐、取消/代次、缓存隔离、性能对照；不等价就默认关闭并报告差异 | **第二阶段**，须有 G1～G3 的稳定快照和测试 |
| **G6 联调** | G0 交接后的 `src/AshFinder.js`、`src/loader.js`、`index.js`、`index.d.ts`、`README.md`、`docs/**`、`test/g6-integration.test.js`；必要时修集成冲突 | 顺序合并 G0→G1→G2→G3→G4，G5 达标再接；全部离线测试、固定版本真实服务器 smoke、API/类型/失败语义与发布说明 | **最后合并**；是所有跨组文件冲突的唯一协调者 |

完整任务卡、精确文件边界和验收场景在 [docs/WORKSTREAMS.md](docs/WORKSTREAMS.md)；唯一跨组接口、状态和不变量在 [docs/PORT_INTERFACES.md](docs/PORT_INTERFACES.md)；四仓库源码对照见 [docs/UPSTREAM_RESEARCH.md](docs/UPSTREAM_RESEARCH.md)。任务有争议时先报告影响的接口、使用现有契约继续无冲突工作，把决定交 G6 记录，不要在各组内部擅自改契约。离线回归和服务器 smoke 是不同证据。

## 上手与提交

```bash
git switch -c port/gN                       # 将 N 换成分配组号
npm install --omit=dev --ignore-scripts --no-package-lock
npm test
node --test test/gN-*.test.js               # 新增测试后执行
git diff --check
git status --short
git add <仅本组所有的文件>
git commit -m 'feat(port): implement G<N> ...'
```

`npm run test:server` 需要本地 Minecraft 服务，不能把未运行写成通过。`npm test` 当前基线包括 3 个单元测试和 13 个 movement 场景；它不覆盖真实服的挖/放、暂停与区块卸载。若依赖版本或环境不同，记录命令、Node 版本、错误及最小复现。提交前确保 `node_modules`、测试 JSON 和个人文件不入库。将 commit SHA、起点 SHA、改动摘要、验收命令输出、缺口和供 G6 cherry-pick 的顺序交回；完成阶段工作后停在本地提交。
