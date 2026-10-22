// -----------------------------------------------------------------------------
// The frames of the CCM (pure): what a read answer means, and the write
// frames. Ported from pydanfossair (danfossclient.py, commands.py,
// operation_mode.py). Every decoder returns undefined when the frame is too
// short or the value is not plausible: an unknown value is never a value.
// -----------------------------------------------------------------------------

import { READ_MODES } from '../constants.js';

const int8 = (frame) => (frame.length >= 1 ? frame.readInt8(0) : undefined);
const int16 = (frame) => (frame.length >= 2 ? frame.readInt16BE(0) : undefined);
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Temperatures out of this range are read errors (no sensor, a register not filled). */
const TEMPERATURE_RANGE = [-60, 90];

export const DECODERS = {
  /** Signed short in hundredths of a degree. */
  temperature(frame) {
    const raw = int16(frame);
    if (raw === undefined) return undefined;
    const value = raw / 100;
    return value >= TEMPERATURE_RANGE[0] && value <= TEMPERATURE_RANGE[1]
      ? round(value, 2)
      : undefined;
  },
  /** One byte 0-255 rescaled to a percentage (humidity, filter). */
  percent255(frame) {
    if (frame.length < 1) return undefined;
    return round((frame[0] * 100) / 255, 1);
  },
  /** One signed byte, already a percentage 0-100 (battery, airflow). */
  percent(frame) {
    const value = int8(frame);
    return value !== undefined && value >= 0 && value <= 100 ? value : undefined;
  },
  /** The manual fan step, 0-10 (0: a stopped unit; only 1-10 is ever offered or written). */
  step(frame) {
    const value = int8(frame);
    return value !== undefined && value >= 0 && value <= 10 ? value : undefined;
  },
  /** A fan speed in revolutions per minute (signed short). */
  rpm(frame) {
    const value = int16(frame);
    return value !== undefined && value >= 0 && value <= 10_000 ? value : undefined;
  },
  /** "On" is any non-zero byte (some firmwares answer 0xff). */
  bit(frame) {
    return frame.length >= 1 ? frame[0] !== 0 : undefined;
  },
  /** The automatic bypass reads inverted. */
  notBit(frame) {
    return frame.length >= 1 ? frame[0] === 0 : undefined;
  },
  /** The operation mode: demand, program, manual, or off (3, read only); any other byte is unknown. */
  mode(frame) {
    const value = int8(frame);
    return value !== undefined && value >= 0 ? READ_MODES[value] : undefined;
  },
};

/** The value a read answer holds, or undefined. */
export function decode(kind, frame) {
  if (!Buffer.isBuffer(frame) || !Object.hasOwn(DECODERS, kind)) return undefined;
  return DECODERS[kind](frame);
}

/** The write frame of a register (endpoint 0x01, function 0x06, one byte). */
export function writeFrame([high, low], value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError('A register value is one byte');
  }
  return Buffer.from([0x01, 0x06, high, low, value]);
}
