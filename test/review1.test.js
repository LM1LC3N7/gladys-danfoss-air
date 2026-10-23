// -----------------------------------------------------------------------------
// The points of review 1 (B1, I1-I3, M1-M5), one test or more each, against
// the SDK's fake Gladys and the fake CCM with a mocked clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DanfossAirApp } from '../src/app.js';
import { HOUR, MINUTE, SECOND } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { HOST, NOW, fakeCcm, settle } from './fixtures/fakeCcm.js';

const CFG = { host: HOST };
const ALLOW = { host: HOST, allow_commands: true };
const DEVICE = 'ext:test-integration:danfoss-air:ccm';
const feature = (role) => `${DEVICE}:${role}`;
const quiet = () => ({ debug() {}, info() {}, warn() {}, error() {} });

async function setup(t, { config = CFG, unit = fakeCcm(), store = memoryStore() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((l) => [l, (...a) => logs.push(`${l}: ${a.join(' ')}`)]),
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
  const connecting = gladys.connect();
  await settle();
  await advance(500);
  await connecting;
  t.after(() => app.stop());
  if (gladys.fake.discoveredDevices.length > 0) {
    await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
    await settle();
    await advance(1100);
  }
  const fire = (role, value = 1) =>
    gladys.fake.setValue(
      gladys.fake.devices.find((d) => d.external_id === DEVICE) ?? { external_id: DEVICE },
      { external_id: feature(role) },
      value,
    );
  const press = async (role, value = 1, wait = 5 * SECOND) => {
    const ack = fire(role, value);
    await advance(wait, 50);
    return ack;
  };
  const state = (role) =>
    gladys.fake.states.findLast((s) => s.device_feature_external_id === feature(role));
  return { gladys, app, unit, advance, logs, fire, press, state };
}

const stopsWritten = (unit) => unit.writes().filter((w) => w.reg === '1530' && w.value === 0);

// --- B1 ----------------------------------------------------------------------------

test('B1 (S1b): a frame split 300 ms apart never shifts the later registers', async (t) => {
  const ctx = await setup(t);
  ctx.unit.split = true;
  ctx.unit.splitGap = 300;
  ctx.unit.registers['1473'] = [0x07, 0xd0]; // supply 20 °C
  await ctx.advance(MINUTE + 10 * SECOND, 50);
  assert.equal(ctx.state('temperature-supply').state, 20);
  assert.equal(ctx.state('temperature-extract').state, 21.4);
  assert.equal(ctx.state('temperature-exhaust').state, 8.2);
});

test('B1 (S1f): a split write answer never confirms a boost stop the unit did not apply', async (t) => {
  const ctx = await setup(t);
  ctx.unit.registers['1530'] = [1];
  ctx.unit.ignoreWrites = true;
  ctx.unit.split = true;
  ctx.unit.splitGap = 300;
  const ack = await ctx.press('boost-stop');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /sans confirmation/);
  assert.ok(ctx.app.stopGuard, 'kept to reaffirm');
});

// --- I1 ----------------------------------------------------------------------------

for (const freeDelay of [200, 1000]) {
  test(`I1 (S3d): a CCM freeing its place ${freeDelay} ms after a close: the stop lands`, async (t) => {
    const ctx = await setup(t);
    ctx.unit.freeDelay = freeDelay;
    ctx.unit.registers['1530'] = [1];
    ctx.unit.delay = 200;
    await ctx.advance(MINUTE + 300, 50);
    assert.equal(ctx.app.active?.kind, 'read');
    const ack = await ctx.press('boost-stop');
    assert.equal(ack.success, true, String(ack.error));
    assert.equal(stopsWritten(ctx.unit).length, 1);
    assert.equal(ctx.unit.registers['1530'][0], 0);
  });
}

test('I1: a reaffirmation leaves a second after the read that saw the boost, and lands', async (t) => {
  const ctx = await setup(t);
  ctx.unit.freeDelay = 200;
  ctx.unit.registers['1530'] = [1];
  ctx.unit.ignoreWrites = true;
  const ack = await ctx.press('boost-stop', 1, 1000);
  assert.equal(ack.success, false);
  ctx.unit.ignoreWrites = false;
  await ctx.advance(25 * SECOND, 50);
  assert.ok(stopsWritten(ctx.unit).length >= 2, 'reaffirmed');
  assert.equal(ctx.unit.registers['1530'][0], 0);
});

// --- I2 ----------------------------------------------------------------------------

test('I2 (S2b): a boost start after an unconfirmed stop is never undone by the stop guard', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  ctx.unit.registers['1530'] = [1];
  ctx.unit.ignoreWrites = true;
  assert.equal((await ctx.press('boost-stop', 1, 1000)).success, false);
  ctx.unit.ignoreWrites = false;
  const start = await ctx.press('boost-start', 1, 1000);
  assert.equal(start.success, true, String(start.error));
  assert.equal(ctx.app.stopGuard, undefined);
  await ctx.advance(2 * MINUTE, 100);
  assert.equal(ctx.unit.registers['1530'][0], 1);
  assert.equal(stopsWritten(ctx.unit).length, 1, 'only the stop pressed');
});

test('I2: the fresh read of another command never reaffirms a stop', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  ctx.unit.registers['1530'] = [1];
  ctx.unit.ignoreWrites = true;
  await ctx.press('boost-stop', 1, 1000);
  ctx.unit.ignoreWrites = false;
  const before = stopsWritten(ctx.unit).length;
  // The fresh read of the start reads the boost on; nothing reaffirmed from it.
  ctx.unit.delays['1530'] = 10;
  await ctx.press('boost-start', 1, 1500);
  assert.equal(stopsWritten(ctx.unit).length, before);
});

// --- I3 ----------------------------------------------------------------------------

async function bare(t, store) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const unit = fakeCcm();
  const gladys = createFakeGladys({ config: CFG });
  const app = new DanfossAirApp({
    gladys,
    logger: quiet(),
    connect: unit.connectFn,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app, quiet());
  t.after(() => app.stop());
  const advance = async (ms) => {
    for (let e = 0; e < ms; e += 10) {
      t.mock.timers.tick(10);
      await settle(3);
    }
  };
  return { unit, app, advance };
}

test('I3 (S3b): two "connected" in a row after a restart never read before the interval', async (t) => {
  const { unit, app, advance } = await bare(t, memoryStore({ lastAttemptAt: NOW - 10 * SECOND }));
  const a = app.connected(CFG);
  const b = app.connected(CFG);
  await advance(1000);
  await Promise.all([a, b]);
  assert.equal(unit.reads(), 0);
});

test('I3: "connected" then the same configuration saved: no read before the interval', async (t) => {
  const { unit, app, advance } = await bare(t, memoryStore({ lastAttemptAt: NOW - 10 * SECOND }));
  const a = app.connected(CFG);
  const b = app.configUpdated(CFG);
  await advance(1000);
  await Promise.all([a, b]);
  assert.equal(unit.reads(), 0);
  await advance(MINUTE + 10 * SECOND);
  assert.ok(unit.reads() > 0, 'read once due');
});

// --- M1 ----------------------------------------------------------------------------

test('M1 (S3c): a state register that timed out is read again at the next poll', async (t) => {
  const ctx = await setup(t);
  ctx.unit.silent.add('1530');
  for (let i = 0; i < 4; i += 1) await ctx.advance(MINUTE, 200);
  ctx.unit.silent.delete('1530');
  ctx.unit.registers['1530'] = [1];
  await ctx.advance(MINUTE, 200);
  assert.equal(ctx.state('boost').state, 1);
});

test('M1: a measure skipped after three timeouts is tried again after an hour, logged once', async (t) => {
  const ctx = await setup(t);
  ctx.unit.silent.add('1781');
  for (let i = 0; i < 6; i += 1) await ctx.advance(MINUTE, 500);
  const reads = () => ctx.unit.log.filter((r) => r.reg === '1781').length;
  const skippedAt = reads();
  await ctx.advance(10 * MINUTE, 1000);
  assert.equal(reads(), skippedAt, 'skipped');
  ctx.unit.silent.delete('1781');
  ctx.unit.registers['1781'] = [61];
  await ctx.advance(HOUR, 2000);
  assert.ok(reads() > skippedAt, 'tried again');
  assert.equal(ctx.state('fan').state, 61);
  assert.equal(ctx.logs.filter((l) => /tried again every hour/.test(l)).length, 1);
});

// --- M2 ----------------------------------------------------------------------------

test('M2 (S2g): a unit stopped from the Air Dial (mode 3) is shown so; commands refused in French', async (t) => {
  const unit = fakeCcm();
  unit.registers['1412'] = [3];
  unit.registers['1561'] = [0];
  const ctx = await setup(t, { unit, config: ALLOW });
  assert.equal(ctx.state('mode'), undefined, 'the list keeps its options only');
  assert.equal(ctx.state('fan-step'), undefined);
  assert.match(ctx.gladys.fake.connectionStatus.message.fr, /centrale arrêtée/);
  const ack = await ctx.press('mode', 'demand');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /arrêtée.*Commande non envoyée/);
  assert.doesNotMatch(String(ack.error), /unreadable/);
  ctx.unit.registers['1412'] = [7];
  const unknown = await ctx.press('mode', 'demand');
  assert.match(String(unknown.error), /Mode 7 inconnu/);
  assert.deepEqual(ctx.unit.writes(), [], 'never restarted');
});

// --- M4 ----------------------------------------------------------------------------

test('M4: a stop still connecting at the ack says it was not sent yet', async (t) => {
  const ctx = await setup(t);
  ctx.unit.connectDelay = 80;
  ctx.unit.registers['1530'] = [1];
  // Received 4.25 s ago (a slow Gladys): the ack is due in 50 ms, the connection takes 80 ms.
  const plan = {
    role: 'boost-stop',
    command: (await import('../src/constants.js')).COMMANDS['boost-stop'],
    byte: 0,
    expected: false,
  };
  const ack = ctx.app.protect(plan, Date.now() - 4250).then(
    () => 'ok',
    (err) => err.message,
  );
  await ctx.advance(60, 10);
  assert.match(await ack, /pas encore envoyé/);
  await ctx.advance(2000, 10);
  assert.equal(stopsWritten(ctx.unit).length, 1, 'it went on after the ack');
});

// --- M5 ----------------------------------------------------------------------------

test('M5: stopping the integration clears the guards and the pending reaffirmation', async (t) => {
  const ctx = await setup(t);
  ctx.unit.registers['1530'] = [1];
  ctx.unit.ignoreWrites = true;
  await ctx.press('boost-stop', 1, 1000);
  ctx.app.guards.set('bypass', { from: false, expected: true, moved: false, until: Infinity });
  assert.ok(ctx.app.stopGuard);
  ctx.app.stop();
  assert.equal(ctx.app.stopGuard, undefined);
  assert.equal(ctx.app.guards.size, 0);
  const writes = ctx.unit.writes().length;
  await ctx.advance(3 * MINUTE, 500);
  assert.equal(ctx.unit.writes().length, writes, 'nothing written after the stop');
});

test('M5: a new address clears the stop guard of the old one', async (t) => {
  const ctx = await setup(t);
  ctx.unit.registers['1530'] = [1];
  ctx.unit.ignoreWrites = true;
  await ctx.press('boost-stop', 1, 1000);
  assert.ok(ctx.app.stopGuard);
  const saved = ctx.gladys.fake.configUpdated({ host: '192.168.1.71' });
  await ctx.advance(1000, 50);
  await saved;
  assert.equal(ctx.app.stopGuard, undefined);
});

// --- Approval 1 --------------------------------------------------------------------

test('R1 (S5e): manual mode with the step read 0: a fan step is refused, nothing written', async (t) => {
  const unit = fakeCcm();
  unit.registers['1412'] = [2];
  unit.registers['1561'] = [0];
  const ctx = await setup(t, { unit, config: ALLOW });
  const ack = await ctx.press('fan-step', '5');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /arrêtée/);
  assert.deepEqual(ctx.unit.writes(), []);
});

test('R2 (S5f): a boost start on a unit read stopped (mode 3) is refused; the stop still goes', async (t) => {
  const unit = fakeCcm();
  unit.registers['1412'] = [3];
  const ctx = await setup(t, { unit, config: ALLOW });
  const ack = await ctx.press('boost-start');
  assert.equal(ack.success, false);
  assert.match(String(ack.error), /arrêtée/);
  assert.deepEqual(ctx.unit.writes(), []);
  ctx.unit.registers['1530'] = [1];
  assert.equal((await ctx.press('boost-stop')).success, true);
  assert.deepEqual(ctx.unit.writes(), [{ op: 'write', reg: '1530', value: 0 }]);
});

test('R2: a boost start on a running unit still reads the mode first, then writes', async (t) => {
  const ctx = await setup(t, { config: ALLOW });
  const before = ctx.unit.log.length;
  assert.equal((await ctx.press('boost-start')).success, true);
  const regs = ctx.unit.log.slice(before).map((r) => r.reg);
  assert.deepEqual(regs.slice(0, 4), ['1412', '1561', '1530', '1530']);
});

test('S5g: a state register that never answers is read last: the measures still come', async (t) => {
  const ctx = await setup(t);
  ctx.unit.silent.add('1522'); // away
  ctx.unit.registers['1472'] = [0x03, 0x84]; // outdoor 9 °C
  for (let i = 0; i < 3; i += 1) await ctx.advance(MINUTE, 200);
  assert.equal(ctx.state('temperature-outdoor').state, 9);
  assert.equal(ctx.state('battery').state, 80);
});

// --- Approval 2 --------------------------------------------------------------------

test('N1 (S6b): manual mode with the step read 0: the mode and the boost start are refused too', async (t) => {
  const unit = fakeCcm();
  unit.registers['1412'] = [2];
  unit.registers['1561'] = [0];
  const ctx = await setup(t, { unit, config: ALLOW });
  for (const [role, value] of [
    ['mode', 'demand'],
    ['boost-start', 1],
    ['fan-step', '5'],
  ]) {
    const ack = await ctx.press(role, value);
    assert.equal(ack.success, false, role);
    assert.match(String(ack.error), /palier lu à 0/, role);
  }
  assert.deepEqual(ctx.unit.writes(), []);
  // The bypass (a damper) and the boost stop still go.
  assert.equal((await ctx.press('bypass-on')).success, true);
});

test('N2: the refusal names its cause: mode 3 from the Air Dial, or the step at 0', async (t) => {
  const unit = fakeCcm();
  unit.registers['1412'] = [3];
  unit.registers['1561'] = [0];
  const ctx = await setup(t, { unit, config: ALLOW });
  const ack = await ctx.press('mode', 'demand');
  assert.match(String(ack.error), /mode 3, depuis l’Air Dial/);
  assert.doesNotMatch(String(ack.error), /palier/);
  ctx.unit.registers['1412'] = [0];
  const step = await ctx.press('boost-start');
  assert.match(String(step.error), /palier lu à 0/);
  assert.doesNotMatch(String(step.error), /mode 3/);
  assert.deepEqual(ctx.unit.writes(), []);
});
