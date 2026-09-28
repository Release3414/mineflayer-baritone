# Architecture and Baritone gap analysis

This document describes the implementation in this repository at version 4.6.x. It is intended to set expectations for users and contributors. The package is a Mineflayer pathfinder inspired by Baritone; it is not a direct port of Baritone's Java pathing stack.

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
- an in-memory path cache that is invalidated by block updates;
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
| Persistent compact chunk cache | `PathCache` is in-memory and stores recent search results | Unloaded terrain is not retained as a Baritone world cache |
| Dedicated path calculation thread | Search runs as asynchronous JavaScript work | Large searches can still compete with the Node.js event loop |
| Tick-accurate movement cost model | Movement costs are weighted heuristics, with dig-time/tool helpers in selected moves | Cost ordering is useful but should not be read as a full Minecraft-tick simulation |

These limits are intentional scope boundaries, not promises of Baritone parity. They are the main areas to address if this project is extended toward Baritone-quality long-distance navigation.

## Recommended contribution order

1. Keep the movement registry, virtual block overlay, executor, and movement regression tests as the correctness baseline.
2. Make movement cost evaluation the single source of truth for both neighbor generation and execution.
3. Add a tick-based cost profile for walking, jumping, breaking, placing, water, and falling while retaining safe configuration fallbacks.
4. Replace sequential waypoint navigation with a segment manager that can calculate and splice the next segment.
5. Add incremental cost backoff and explicit backtrack handling for timeout and recovery cases.
6. Introduce an immutable world snapshot and move expensive searches to a worker thread.
7. Add a compact, persistent chunk cache only after the live-world invalidation rules are covered by tests.

Each step can be developed independently. In particular, the movement overlay and executor do not need to be rewritten to improve the search layer.

## Testing expectations

Run the movement regression suite before changing movement generation:

```bash
node test_moves.js --list
node test_moves.js basicForward
node test_moves.js moveForwardUpBreakingChain
node test_moves.js virtualBlocksTest
```

The virtual block scenarios are regression tests. A failure means the generated neighbors disagree with the scenario's declared support or placement state; it should be investigated rather than treated as an expected result.

