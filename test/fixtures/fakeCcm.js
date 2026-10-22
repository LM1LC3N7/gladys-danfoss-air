// -----------------------------------------------------------------------------
// A fake Danfoss Air CCM behind the injected `connect` (no network): one
// connection at a time (a second one is refused, as the real module), the
// registers of pydanfossair as raw bytes, writes applied, answers of 63
// bytes after a delay (mocked timers). Values made up, never from a real unit.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const HOST = '192.168.1.70';
export const NOW = Date.UTC(2026, 9, 22, 10, 0, 0);

const short = (value) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(value);
  return [...b];
};

/** The registers of a unit in demand mode, step 3, no boost (raw bytes by "hhll"). */
export function defaultRegisters() {
  return {
    1412: [0], // mode: demand
    1561: [3], // fan step
    1530: [0], // boost off
    1460: [0], // bypass closed
    1706: [0], // automatic bypass on (inverted)
    1522: [0], // away off
    1472: short(512), // outdoor 5.12 °C
    1473: short(1850), // supply 18.5 °C
    1474: short(2140), // extract 21.4 °C
    1475: short(820), // exhaust 8.2 °C
    '0300': short(2135), // room 21.35 °C
    1496: short(2100), // room calculated 21 °C
    1470: [115], // humidity 45.1 %
    '146a': [230], // filter 90.2 %
    1781: [42], // airflow 42 %
    1450: short(1250), // supply fan rpm
    1451: short(1300), // extract fan rpm
    '030f': [80], // Air Dial battery 80 %
  };
}

class FakeSocket extends EventEmitter {
  constructor(unit) {
    super();
    this.unit = unit;
    this.destroyed = false;
  }

  write(bytes) {
    if (this.destroyed) throw new Error('write after destroy');
    this.unit.handle(this, Buffer.from(bytes));
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.unit.open === this) this.unit.open = undefined;
    setImmediate(() => this.emit('close'));
  }

  setNoDelay() {}
}

export function fakeCcm({ registers = defaultRegisters() } = {}) {
  const unit = {
    registers,
    open: undefined,
    /** Every request received: { op: 'read' | 'write', reg, value? }. */
    log: [],
    connections: 0,
    refused: 0,
    /** Options a test may change. */
    down: false,
    connectDelay: 5,
    delay: 10,
    /** Registers that never answer, and per-register delays. */
    silent: new Set(),
    delays: {},
    /** Writes received but not applied (an unconfirmed command). */
    ignoreWrites: false,
    /** Answers split in two chunks, or 2 bytes only (a short frame). */
    split: false,
    short: false,
    handle(socket, bytes) {
      const reg = bytes.subarray(2, 4).toString('hex');
      const write = bytes[1] === 0x06;
      unit.log.push(write ? { op: 'write', reg, value: bytes[4] } : { op: 'read', reg });
      if (unit.silent.has(reg)) return;
      setTimeout(() => {
        if (socket.destroyed) return;
        if (write && !unit.ignoreWrites) {
          unit.registers[reg] = [bytes[4]];
        }
        const value = unit.registers[reg] ?? [0];
        const frame = Buffer.alloc(unit.short ? Math.max(2, value.length) : 63);
        Buffer.from(value).copy(frame);
        if (unit.split) {
          socket.emit('data', frame.subarray(0, 1));
          socket.emit('data', frame.subarray(1));
        } else {
          socket.emit('data', frame);
        }
      }, unit.delays[reg] ?? unit.delay);
    },
    connect() {
      const socket = new FakeSocket(unit);
      unit.connections += 1;
      setTimeout(() => {
        if (socket.destroyed) return;
        if (unit.down || unit.open) {
          unit.refused += 1;
          socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
          return;
        }
        unit.open = socket;
        socket.emit('connect');
      }, unit.connectDelay);
      return socket;
    },
    writes: () => unit.log.filter((r) => r.op === 'write'),
    reads: () => unit.log.filter((r) => r.op === 'read').length,
  };
  unit.connectFn = () => unit.connect();
  return unit;
}

export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
