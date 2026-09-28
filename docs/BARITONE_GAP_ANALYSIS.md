# Architecture and Baritone gap analysis

This document describes the implementation in this repository at version 4.6.x. It is intended to set expectations for users and contributors. The package is a Mineflayer pathfinder inspired by Baritone; it is not a direct port of Baritone's Java pathing stack.

For implementation, use [the group assignments](WORKSTREAMS.md), [the proposed interface contract](PORT_INTERFACES.md), and [source-level comparisons of four repositories](UPSTREAM_RESEARCH.md). These documents describe planned work, not features that have already shipped. The comparison was checked against fork commit `62ba4d9`.

## What the repository provides today

The main path is:

```text
AshFinder
  -> A* search (src/pathfinder.js)
  -> Move registry and virtual block overlay (src/movement/)
  -> PathExecutor (src/executor.js)
  -> Mineflayer controls, digging, placing, and physics
```

The search and executor share the registered movement implementations. A search node carries a `virtualBlocks` overlay, so planned breaks and placements can be considered by later neighbors in the same path. The movement test runner exercises this connection directly through `getNeighbors2()`.

The current implementation also includes:

- partial paths when the search reaches its timeout;
- replanning while executing a partial path;
- an in-memory closed-node `PathCache` inside `src/AshFinder.js` that stores visited search nodes and invalidates affected chunks on block updates (its warm-node reuse is currently commented out); the separate `src/pathCache.js` stores complete path results but is not wired into the primary flow;
- waypoint navigation for longer distances (the default direct/waypoint threshold is 75 blocks);
- movement types for ordinary traversal, steps, falls, parkour, water, ladders, breaking, placing, and optional flight;
- optional custom physics through `loader(bot, { useCustomPhysics: true })`.

## What this is not yet

The following Baritone capabilities are not equivalent to the current waypoint and cache implementations:

| Baritone capability | Current repository | Consequence |
| --- | --- | --- |
| Segmented pathing with a concurrently calculated next segment | Waypoints are generated and navigated sequentially | Long paths can pause between segments and may recalculate more work |
| Incremental cost backoff and Baritone endpoint selection | A* returns the best partial node at timeout | A timeout produces a useful partial path, but not Baritone's backoff strategy |
| Path splicing and backtrack favoring | The executor replans after partial paths or failures | The current path is replaced rather than spliced with a ready next segment |
| Persistent compact chunk cache | Both `PathCache` implementations cache paths or visited search nodes, not reliable unloaded terrain; see above | Unloaded terrain is not retained as a Baritone world cache |
| Dedicated path calculation thread | Search runs as asynchronous JavaScript work | Large searches can still compete with the Node.js event loop |
| Tick-accurate movement cost model | Movement costs are weighted heuristics, with dig-time/tool helpers in selected moves | Cost ordering is useful but should not be read as a full Minecraft-tick simulation |

These limits are intentional scope boundaries, not promises of Baritone parity. They are the main areas to address if this project is extended toward Baritone-quality long-distance navigation.

Additional verified integration risks: `getNeighbors2()` propagates a `virtualBlocks` overlay, but its same-destination selection and `Astar()` open/closed keys are primarily position-based; different planned terrain edits can therefore be conflated. The current search can return `status: 'no path'` with a best-node path, while the executor can resolve a partial journey after it fails to find a continuation. The handoff explicitly requires real-goal success checks, correct cancellation, and overlay-aware search states before claiming reliable long-distance behavior. These are implementation tasks, not claims that the existing offline tests fail.

## Recommended contribution order

1. First lock down `goto`/executor completion, cancellation, and cache naming so "partial" or "no path" cannot falsely complete a goal.
2. Build a versioned, conservative `LIVE/CACHED/UNKNOWN` world view and shared candidate/cost contract. Keep the existing movement registry and virtual block chain as the source of neighbors.
3. Add tick-based movement costs and state-safe A* with useful partial endpoints, incremental backoff, and clear timeout/cancellation results.
4. Precompute the next segment and splice only at verified safe action boundaries; keep waypoint navigation as a fallback.
5. Only after those interfaces are exercised, benchmark a serializable worker snapshot and persistent compact cache; do not enable either by default without equivalence and invalidation tests.

Groups can develop their owned files in parallel against the frozen contract, but integration follows the dependencies and acceptance gates in [WORKSTREAMS.md](WORKSTREAMS.md). In particular, worker search cannot run the current `Move.generate()` in a separate thread by passing it a Mineflayer bot.

## Testing expectations

Run the movement regression suite before changing movement generation:

```bash
node test_moves.js --list
node test_moves.js basicForward
node test_moves.js moveForwardUpBreakingChain
node test_moves.js virtualBlocksTest
```

The virtual block scenarios are regression tests. A failure means the generated neighbors disagree with the scenario's declared support or placement state; it should be investigated rather than treated as an expected result.

At the documented baseline, `npm test` passes 3 `node:test` cases and 13 movement scenarios using production dependencies. These tests do not establish real-server reliability; the integration group owns server validation.
