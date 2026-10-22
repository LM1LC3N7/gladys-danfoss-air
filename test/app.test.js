// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake CCM, with the
// exact wiring of the container (src/handlers.js) and a mocked clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DanfossAirApp } from '../src/app.js';
import { MINUTE, SECOND } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { HOST, NOW, fakeCcm, settle } from './fixtures/fakeCcm.js';

const CFG = { host: HOST };
const ALLOW = { host: HOST, allow_commands: true };
const DEVICE = 'ext:test-integration:danfoss-air:ccm';
const feature = (role) => `${DEVICE}:${role}`;

async function setup(
  t,
  { config = CFG, unit = fakeCcm(), store = memoryStore(), create = true } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((l) => [
      l,
      (...a) => logs.push(`${l}: ${a.map((x) => (x instanceof Error ? x.message : x)).join(' ')}`),
    ]),
  );
  const app = new DanfossAirApp({
    gladys,
    logger,
    connect: unit.connectFn,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app, logger);
  const advance = async (ms, step = 10) => {
    for (let e = 0; e < ms; e += step) {
      t.mock.timers.tick(Math.min(step, ms - e));
      await settle(3);
    }
  };
  // The first read runs on the mocked clock: the connection resolves as it goes.
  const connecting = gladys.connect();
  await settle();
  await advance(500);
  await connecting;
  t.after(() => app.stop());
  if (create && gladys.fake.discoveredDevices.length > 0) {
    await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
    await settle();
    await advance(1100);
  }
  const fire = (role, value = 1) => {
    const device = gladys.fake.devices.find((d) => d.external_id === DEVICE) ?? {
      external_id: DEVICE,
    };
    return gladys.fake.setValue(device, { external_id: feature(role) }, value);
  };
  const press = async (role, value = 1, wait = 5 * SECOND) => {
    const ack = fire(role, value);
    await advance(wait, 50);
    return ack;
  };
  const state = (role) =>
    gladys.fake.states.findLast((s) => s.device_feature_external_id === feature(role));
  return { gladys, app, unit, advance, logs, fire, press, store, state };
}

test('discovery: one device, every value read and published', async (t) => {
  const ctx = await setup(t);
  const [device] = ctx.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  const types = device.features.map((f) => `${f.category}/${f.type}`);
  assert.ok(!types.some((x) => x.startsWith('switch/')), 'never a switch');
  for (const f of device.features.filter((f) => !f.read_only)) {
    assert.ok(
      (f.category === 'button' && f.type === 'push') ||
        (f.category === 'text' && f.type === 'select'),
      `${f.external_id} is writable`,
    );
  }
  assert.equal(ctx.state('temperature-outdoor').state, 5.12);
  assert.equal(ctx.state('temperature-extract').state, 21.4);
  assert.equal(ctx.state('temperature-room').state, 21.35);
  assert.equal(ctx.state('humidity').state, 45.1);
  assert.equal(ctx.state('filter').state, 90);
  assert.equal(ctx.state('battery').state, 80);
  assert.equal(ctx.state('fan').state, 42);
  assert.equal(ctx.state('fan-supply-rpm').state, 1250);
  assert.equal(ctx.state('boost').state, 0);
  assert.equal(ctx.state('automatic-bypass').state, 1);
  assert.equal(ctx.state('mode').text, 'demand');
  assert.equal(ctx.state('fan-step').text, '3');
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  const badge = ctx.gladys.fake.transports.at(-1);
  assert.equal(badge.device_external_id ?? badge.external_id, DEVICE);
  assert.equal(badge.transport, DEVICE_TRANSPORTS.LOCAL);
  // One connection per read, closed after it.
  assert.equal(ctx.unit.open, undefined);
});

test('the commands are off by default: refused, nothing written', async (t) => {
  const ctx = await setup(t);
  const ack = await ctx.press('mode', 'manual');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /Autoriser les commandes/);
  assert.equal((await ctx.press('boost-start')).success, false);
  assert.equal((await ctx.press('bypass-on')).success, false);
  assert.deepEqual(ctx.unit.writes(), []);
});

test('a mode: decided on a fresh read, written, confirmed by the read back', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  const reads = ctx.unit.reads();
  const ack = await ctx.press('mode', 'manual');
  assert.equal(ack.success, true, String(ack.error));
  assert.deepEqual(ctx.unit.writes(), [{ op: 'write', reg: '1412', value: 2 }]);
  assert.ok(ctx.unit.reads() >= reads + 2, 'a fresh read before, a read back after');
  assert.equal(ctx.state('mode').text, 'manual');
  // Already so: nothing written, success.
  assert.equal((await ctx.press('mode', 'manual')).success, true);
  assert.equal(ctx.unit.writes().length, 1);
});

test('the fan step: only in manual mode, strictly one of the steps', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  const refused = await ctx.press('fan-step', '5');
  assert.equal(refused.success, false);
  assert.match(String(refused.error), /mode manuel/);
  ctx.unit.registers['1412'] = [2];
  for (const bad of ['0', '11', 5, '', null, ' 5']) {
    assert.equal((await ctx.press('fan-step', bad, 100)).success, false, String(bad));
  }
  assert.deepEqual(ctx.unit.writes(), []);
  const ack = await ctx.press('fan-step', '5');
  assert.equal(ack.success, true, String(ack.error));
  assert.deepEqual(ctx.unit.writes(), [{ op: 'write', reg: '1561', value: 5 }]);
  assert.equal(ctx.state('fan-step').text, '5');
});

test('buttons only take 1; read-only features refuse', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  for (const bad of [0, true, 'on', null, 2]) {
    assert.equal((await ctx.press('boost-start', bad, 100)).success, false, String(bad));
  }
  assert.equal((await ctx.press('boost', 1, 100)).success, false);
  assert.equal((await ctx.press('temperature-outdoor', 1, 100)).success, false);
  assert.deepEqual(ctx.unit.writes(), []);
});

test('bypass and automatic bypass: the right bytes (automatic bypass inverted)', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  assert.equal((await ctx.press('bypass-on')).success, true);
  assert.equal((await ctx.press('automatic-bypass-off')).success, true);
  assert.deepEqual(ctx.unit.writes(), [
    { op: 'write', reg: '1460', value: 1 },
    { op: 'write', reg: '1706', value: 1 },
  ]);
  assert.equal(ctx.state('bypass').state, 1);
  assert.equal(ctx.state('automatic-bypass').state, 0);
});

test('a write not applied: "sent, without confirmation", never "not sent"', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  ctx.unit.ignoreWrites = true;
  const ack = await ctx.press('boost-start');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /envoyée, sans confirmation/);
  assert.equal(ctx.unit.writes().length, 1);
  // The guard: pressed again, the same value is written again even if the read shows it.
  ctx.unit.ignoreWrites = false;
  assert.equal((await ctx.press('boost-start')).success, true);
  assert.equal(ctx.unit.writes().length, 2);
});

test('the option turned off during the fresh read: refused, nothing written', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  ctx.unit.delays['1530'] = 800;
  const ack = ctx.fire('boost-start');
  await ctx.advance(300);
  await ctx.gladys.fake.configUpdated({ ...ALLOW, allow_commands: false });
  await ctx.advance(3000, 50);
  const result = await ack;
  assert.equal(result.success, false);
  assert.deepEqual(ctx.unit.writes(), []);
});

test('a slow unit: refused unsent within the deadline', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  ctx.unit.delays['1530'] = 2500;
  const ack = await ctx.press('boost-start');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /non envoyée/);
  assert.deepEqual(ctx.unit.writes(), []);
});

test('the boost stop: never behind the option, confirmed by the read back', async (t) => {
  const ctx = await setup(t);
  ctx.unit.registers['1530'] = [1];
  const ack = await ctx.press('boost-stop');
  assert.equal(ack.success, true, String(ack.error));
  assert.deepEqual(ctx.unit.writes(), [{ op: 'write', reg: '1530', value: 0 }]);
  assert.equal(ctx.state('boost').state, 0);
});

test('the boost stop takes the line from a poll (dropped, nothing of it published)', async (t) => {
  const ctx = await setup(t);
  ctx.unit.registers['1530'] = [1];
  ctx.unit.delay = 200;
  ctx.unit.registers['1472'] = [0x09, 0x00];
  const before = ctx.gladys.fake.states.length;
  await ctx.advance(MINUTE + 300, 50);
  assert.ok(ctx.app.active?.kind === 'read', 'a poll is running');
  const ack = await ctx.press('boost-stop');
  assert.equal(ack.success, true, String(ack.error));
  assert.deepEqual(ctx.unit.writes(), [{ op: 'write', reg: '1530', value: 0 }]);
  const outdoor = ctx.gladys.fake.states
    .slice(before)
    .filter((s) => s.device_feature_external_id === feature('temperature-outdoor'));
  assert.deepEqual(outdoor, [], 'the dropped poll published nothing');
  assert.equal(ctx.unit.refused, 0, 'never two connections at once');
});

test('the boost stop cancels a boost start not written yet', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  ctx.unit.delays['1530'] = 600;
  const start = ctx.fire('boost-start');
  await ctx.advance(200);
  const stop = ctx.fire('boost-stop');
  await ctx.advance(5000, 50);
  const [a, b] = await Promise.all([start, stop]);
  assert.equal(a.success, false);
  assert.match(String(a.error), /arrêté entre-temps/);
  assert.equal(b.success, true, String(b.error));
  assert.deepEqual(ctx.unit.writes(), [{ op: 'write', reg: '1530', value: 0 }]);
});

test('the boost stop goes before the first read after a restart, and when the unit fails', async (t) => {
  const store = memoryStore({ lastAttemptAt: NOW - 10 * SECOND });
  const ctx = await setup(t, { store, create: false });
  assert.equal(ctx.unit.reads(), 0, 'no read before the interval');
  ctx.unit.registers['1530'] = [1];
  assert.equal((await ctx.press('boost-stop')).success, true);
  ctx.unit.down = true;
  const ack = await ctx.press('boost-stop');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /non envoyée/);
});

test('a boost stop not confirmed is reaffirmed by the next reads, twice at most', async (t) => {
  const ctx = await setup(t);
  ctx.unit.registers['1530'] = [1];
  ctx.unit.ignoreWrites = true;
  const ack = await ctx.press('boost-stop');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /sans confirmation/);
  await ctx.advance(2 * MINUTE, 100);
  const stops = ctx.unit.writes().filter((w) => w.reg === '1530' && w.value === 0);
  assert.equal(stops.length, 3, 'the stop and two reaffirmations');
});

test('never read sooner than the interval: button, scan, reconnection, same config', async (t) => {
  const ctx = await setup(t);
  const reads = ctx.unit.reads();
  const answer = await ctx.gladys.fake.action('test_connection');
  assert.match(JSON.stringify(answer), /Prochaine lecture/);
  await ctx.gladys.fake.scanRequest();
  await ctx.app.connected(CFG);
  await ctx.gladys.fake.configUpdated(CFG);
  await ctx.advance(1000);
  assert.equal(ctx.unit.reads(), reads);
  await ctx.advance(MINUTE);
  assert.ok(ctx.unit.reads() > reads, 'read again after the interval');
});

test('a restart waits for the interval after the last read kept in /data', async (t) => {
  const store = memoryStore({ lastAttemptAt: NOW - 30 * SECOND });
  const ctx = await setup(t, { store, create: false });
  assert.equal(ctx.unit.reads(), 0);
  await ctx.advance(MINUTE + 31 * SECOND, 100);
  assert.ok(ctx.unit.reads() > 0);
  assert.ok(store.data.lastAttemptAt > NOW, 'the time of the read kept before it');
});

test('an unreachable unit: status says so, retried with a backoff, device unreachable', async (t) => {
  const ctx = await setup(t);
  ctx.unit.down = true;
  await ctx.advance(MINUTE + 100, 100);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  assert.match(ctx.gladys.fake.connectionStatus.message.fr, /une connexion à la fois/);
  assert.equal(ctx.gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  const tries = ctx.unit.connections;
  await ctx.advance(30 * SECOND, 500);
  assert.equal(ctx.unit.connections, tries, 'never sooner than the interval');
});

test('a register that never answers ends the read, then is skipped', async (t) => {
  const ctx = await setup(t);
  ctx.unit.silent.add('1781');
  for (let i = 0; i < 4; i += 1) {
    await ctx.advance(MINUTE, 100);
  }
  assert.ok(ctx.logs.some((l) => /fanPercent never answers/.test(l)));
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  ctx.unit.registers['030f'] = [55];
  await ctx.advance(MINUTE, 100);
  assert.equal(ctx.state('battery').state, 55, 'the registers after it are read again');
});

test('frames in two chunks are read; a frame shorter than 63 bytes is refused (review 1, B1)', async (t) => {
  const unit = fakeCcm();
  unit.split = true;
  const ctx = await setup(t, { unit });
  assert.equal(ctx.state('temperature-supply').state, 18.5);
  unit.split = false;
  unit.short = true;
  unit.registers['1473'] = [0x07, 0xd0];
  await ctx.advance(MINUTE + 4 * SECOND, 50);
  // Never decoded: the read fails (first register incomplete), nothing new published.
  assert.equal(ctx.state('temperature-supply').state, 18.5);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
});

test('a stop of the integration during a read publishes nothing late', async (t) => {
  const ctx = await setup(t);
  ctx.unit.delay = 200;
  ctx.unit.registers['1472'] = [0x03, 0x00];
  await ctx.advance(MINUTE + 300, 50);
  const before = ctx.gladys.fake.states.length;
  ctx.app.stop();
  await ctx.advance(5000, 100);
  assert.equal(ctx.gladys.fake.states.length, before);
});

test('the status and Discovery are sent again at each reconnection', async (t) => {
  const ctx = await setup(t);
  const statuses = ctx.gladys.fake.connectionStatuses.length;
  const discovered = ctx.gladys.fake.discoveredDevices.length;
  await ctx.app.connected(CFG);
  assert.ok(ctx.gladys.fake.connectionStatuses.length > statuses);
  assert.ok(ctx.gladys.fake.discoveredDevices.length >= discovered);
});
