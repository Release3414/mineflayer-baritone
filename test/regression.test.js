const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Vec3 } = require('vec3');

const { AshFinderPlugin } = require('../src/AshFinder');
const { MoveTestRunner } = require('../src/testing/MoveTestRunner');
const scenarios = require('../src/testing/TestScenarios');

test('movement respects virtual support and hazards, and can break while scaffolding', async () => {
  const runner = new MoveTestRunner();
  for (const name of ['virtualBlocksTest', 'obstacleAvoidance', 'breakAndPlace']) {
    runner.addScenario(name, scenarios[name]);
    const result = await runner.runScenario(name, { visual: false });
    assert.equal(result.success, true, `${name}: ${result.validation.issues.join('; ')}`);
  }

  const breaking = runner.testResults.at(-1).result.neighbors.find(n => n.x === 1 && n.y === 64);
  assert.deepEqual(breaking.attributes.break.map(({ x, y, z }) => [x, y, z]), [
    [1, 64, 0], [1, 65, 0],
  ]);
  assert.deepEqual(breaking.attributes.place.map(({ x, y, z }) => [x, y, z]), [
    [1, 63, 0],
  ]);

  const directory = fs.mkdtempSync(path.join(process.cwd(), 'movement-export-'));
  try {
    const filename = path.join(directory, 'results.json');
    runner.exportResults(filename);
    const exported = JSON.parse(fs.readFileSync(filename, 'utf8'));
    assert.equal(exported.results.length, 3);
    assert.deepEqual(exported.results.at(-1).result.neighbors.find(n => n.position.x === 1).break,
      [{ x: 1, y: 64, z: 0 }, { x: 1, y: 65, z: 0 }]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scenario validation failures count as test failures', async () => {
  const runner = new MoveTestRunner();
  runner.addScenario('missing', {
    ...scenarios.basicForward,
    expectedPositions: [{ x: 99, y: 64, z: 0 }],
  });
  const [result] = await runner.runAll({ visual: false });
  assert.equal(result.success, false);
  assert.match(result.result.validation.issues.join(' '), /99,64,0/);
});

test('failed flight validation restores navigation state and timeout', async () => {
  class Bot extends EventEmitter {
    constructor() {
      super();
      this.entity = { position: new Vec3(0, 64, 0) };
      this.inventory = { slots: [], items: () => [] };
    }
    blockAt() { return null; }
    getEquipmentDestSlot() { return 6; }
  }

  const plugin = new AshFinderPlugin(new Bot());
  const goal = { getPosition: () => new Vec3(10, 64, 0) };
  plugin.config.fly = true;
  const timeout = plugin.config.thinkTimeout;
  const result = await plugin.goto(goal);
  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /no elytra/);
  assert.equal(plugin.stopped, true);
  assert.equal(plugin.isPathing, false);
  assert.equal(plugin.currentGoal, null);
  assert.equal(plugin.config.thinkTimeout, timeout);

  plugin.config.fly = false;
  plugin.generatePath = async () => { throw new Error('next search reached'); };
  const next = await plugin.goto(goal);
  assert.match(next.error.message, /next search reached/);
});
