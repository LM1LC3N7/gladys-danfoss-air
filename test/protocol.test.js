// -----------------------------------------------------------------------------
// The frames (pure), ported from pydanfossair's own tests; the real TCP
// session against a loopback server (no network beyond 127.0.0.1); the
// configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { normalizeConfig, parseAddress } from '../src/config.js';
import { READS } from '../src/constants.js';
import { ERROR_KINDS, openSession } from '../src/danfoss/client.js';
import { decode, writeFrame } from '../src/danfoss/protocol.js';

const frame = (...bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(63 - bytes.length)]);

test('decoders: the values of pydanfossair', () => {
  assert.equal(decode('percent', frame(100)), 100, 'battery is a raw percent');
  assert.equal(decode('percent', frame(44)), 44);
  assert.equal(decode('percent', frame(54)), 54, 'airflow');
  for (const step of [1, 3, 5, 10]) assert.equal(decode('step', frame(step)), step);
  assert.equal(decode('percent255', frame(145)), 56.9, 'humidity rescaled from 0-255');
  assert.equal(decode('percent255', frame(94)), 36.9, 'filter rescaled');
  assert.equal(decode('temperature', frame(0x09, 0x51)), 23.85, 'centidegrees');
  assert.equal(decode('temperature', frame(0xfe, 0x0c)), -5, 'negative');
  assert.equal(decode('bit', frame(0xff)), true, 'on is any non-zero byte');
  assert.equal(decode('bit', frame(0x01)), true);
  assert.equal(decode('bit', frame(0x00)), false);
  assert.equal(decode('notBit', frame(0x00)), true, 'automatic bypass inverted');
  assert.equal(decode('notBit', frame(0x01)), false);
  assert.deepEqual(
    [0, 1, 2].map((b) => decode('mode', frame(b))),
    ['demand', 'program', 'manual'],
  );
});

test('decoders: an implausible or short frame is unknown, never a value', () => {
  assert.equal(decode('mode', frame(3)), undefined);
  assert.equal(decode('mode', frame(0xff)), undefined);
  assert.equal(decode('step', frame(0)), undefined);
  assert.equal(decode('step', frame(11)), undefined);
  assert.equal(decode('percent', frame(0xff)), undefined);
  assert.equal(decode('temperature', frame(0x7f, 0xff)), undefined, '327 °C');
  assert.equal(decode('temperature', Buffer.from([0x09])), undefined, 'one byte of two');
  assert.equal(decode('bit', Buffer.alloc(0)), undefined);
  assert.equal(decode('__proto__', frame(1)), undefined);
  assert.equal(decode('bit', 'not a buffer'), undefined);
});

test('the frames written: the registers of pydanfossair, one byte', () => {
  assert.deepEqual([...writeFrame([0x15, 0x30], 1)], [0x01, 0x06, 0x15, 0x30, 0x01]);
  assert.deepEqual([...writeFrame([0x15, 0x61], 10)], [0x01, 0x06, 0x15, 0x61, 0x0a]);
  assert.throws(() => writeFrame([0x14, 0x12], 256));
  assert.throws(() => writeFrame([0x14, 0x12], -1));
  assert.equal(READS.length, 18);
  assert.ok(
    READS.every((r) => r.frame.length === 4 && r.frame[1] === 0x04),
    'reads only',
  );
});

test('config: address, port, interval, strict option', () => {
  assert.deepEqual(parseAddress('192.168.1.70'), { host: '192.168.1.70', port: 30046 });
  assert.deepEqual(parseAddress(' CCM.local:4000 '), { host: 'ccm.local', port: 4000 });
  for (const bad of ['http://1.2.3.4', '1.2.3', '1.2.3.4:0', 'a b', 'user@host', '999.1.1.1']) {
    assert.equal(parseAddress(bad), undefined, bad);
  }
  const c = normalizeConfig({ host: 'x y', allow_commands: 'yes', poll_interval: 5 });
  assert.equal(c.address, undefined);
  assert.equal(c.invalid, 'x y');
  assert.equal(c.allowCommands, false, 'only true allows');
  assert.equal(c.pollInterval, 30, 'bounded');
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, 60);
  assert.equal(normalizeConfig({ allow_commands: true }).allowCommands, true);
  assert.equal(normalizeConfig({ __proto__: { allow_commands: true } }).allowCommands, false);
});

/** A loopback server answering with `answer(bytes, socket)`. */
async function server(t, answer) {
  const srv = createServer((socket) => socket.on('data', (bytes) => answer(bytes, socket)));
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => srv.close());
  return srv.address().port;
}

test('session: a frame of 63 bytes, then another request', async (t) => {
  const port = await server(t, (bytes, socket) => socket.write(frame(bytes[3], 0x10)));
  const { promise } = openSession({ host: '127.0.0.1', port });
  const session = await promise;
  t.after(() => session.close());
  const a = await session.request(Buffer.from([1, 4, 0x14, 0x12]));
  assert.equal(a.length, 63);
  assert.equal(a[0], 0x12);
  const b = await session.request(Buffer.from([1, 4, 0x15, 0x61]));
  assert.equal(b[0], 0x61);
});

test('session: a short frame is complete after a silence', async (t) => {
  const port = await server(t, (bytes, socket) => socket.write(Buffer.from([0x07, 0xd0])));
  const session = await openSession({ host: '127.0.0.1', port }).promise;
  t.after(() => session.close());
  const answer = await session.request(Buffer.from([4, 4, 0x14, 0x73]));
  assert.equal(decode('temperature', answer), 20);
});

test('session: a frame longer than 63 bytes breaks the session', async (t) => {
  const port = await server(t, (bytes, socket) => socket.write(Buffer.alloc(64)));
  const session = await openSession({ host: '127.0.0.1', port }).promise;
  await assert.rejects(session.request(Buffer.from([1, 4, 0x14, 0x12])), (err) => {
    assert.equal(err.kind, ERROR_KINDS.PROTOCOL);
    return true;
  });
  await assert.rejects(session.request(Buffer.from([1, 4, 0x14, 0x12])));
});

test('session: no answer is a timeout; a write stopped by beforeSend sends nothing', async (t) => {
  const received = [];
  const port = await server(t, (bytes) => received.push(bytes));
  const session = await openSession({ host: '127.0.0.1', port }).promise;
  t.after(() => session.close());
  await assert.rejects(
    session.request(Buffer.from([1, 6, 0x15, 0x30, 1]), {
      beforeSend: () => {
        throw new Error('option off');
      },
    }),
    /option off/,
  );
  await assert.rejects(
    session.request(Buffer.from([1, 6, 0x15, 0x30, 1]), { startBy: Date.now() - 1 }),
    (err) => err.kind === ERROR_KINDS.LATE,
  );
  await assert.rejects(
    session.request(Buffer.from([1, 4, 0x15, 0x30]), { timeoutMs: 100 }),
    (err) => err.kind === ERROR_KINDS.TIMEOUT && err.sent === true,
  );
  assert.equal(Buffer.concat(received).length, 4, 'only the read left');
});

test('session: nobody listening is unreachable (nothing sent)', async (t) => {
  const port = await server(t, () => {});
  const srv = createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const closed = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  assert.ok(port !== closed);
  await assert.rejects(
    openSession({ host: '127.0.0.1', port: closed, timeoutMs: 2000 }).promise,
    (err) => err.kind === ERROR_KINDS.UNREACHABLE && err.sent === false,
  );
});
