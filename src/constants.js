// -----------------------------------------------------------------------------
// Danfoss Air constants: the protocol of the CCM module, manifest keys,
// feature roles, limits and timings.
//
// The Danfoss Air CCM (Connection and Control Module) answers on TCP port
// 30046, without authentication, as pydanfossair (Apache-2.0, 1.0.0, the
// library of Home Assistant's Danfoss Air integration) speaks to it:
//   - a read is 4 bytes: [endpoint, 0x04, register high, register low];
//   - a write is 5 bytes: [endpoint, 0x06, register high, register low, value];
//   - each request gets one answer frame of 63 bytes, the value in the first
//     byte(s): a signed byte, a signed big-endian short (temperatures in
//     hundredths of a degree), a 0-255 byte for a percentage, a non-zero byte
//     for "on".
// The protocol is not documented by Danfoss; only the registers below (those
// of pydanfossair) are ever read or written.
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 30046;

/** The size of one answer frame (pydanfossair reads `recv(63)`). */
export const FRAME_SIZE = 63;

const read = (endpoint, high, low) => Buffer.from([endpoint, 0x04, high, low]);

/**
 * The registers read at each poll, in this order (the ventilation state
 * first). `decode` names the way the first byte(s) are read
 * (src/danfoss/protocol.js).
 */
export const READS = [
  { key: 'mode', frame: read(0x01, 0x14, 0x12), decode: 'mode' },
  { key: 'fanStep', frame: read(0x01, 0x15, 0x61), decode: 'step' },
  { key: 'boost', frame: read(0x01, 0x15, 0x30), decode: 'bit' },
  { key: 'bypass', frame: read(0x01, 0x14, 0x60), decode: 'bit' },
  { key: 'autoBypass', frame: read(0x01, 0x17, 0x06), decode: 'notBit' },
  { key: 'away', frame: read(0x01, 0x15, 0x22), decode: 'bit' },
  { key: 'outdoor', frame: read(0x04, 0x14, 0x72), decode: 'temperature' },
  { key: 'supply', frame: read(0x04, 0x14, 0x73), decode: 'temperature' },
  { key: 'extract', frame: read(0x04, 0x14, 0x74), decode: 'temperature' },
  { key: 'exhaust', frame: read(0x04, 0x14, 0x75), decode: 'temperature' },
  { key: 'room', frame: read(0x01, 0x03, 0x00), decode: 'temperature' },
  { key: 'roomCalculated', frame: read(0x00, 0x14, 0x96), decode: 'temperature' },
  { key: 'humidity', frame: read(0x01, 0x14, 0x70), decode: 'percent255' },
  { key: 'filter', frame: read(0x01, 0x14, 0x6a), decode: 'percent255' },
  { key: 'fanPercent', frame: read(0x00, 0x17, 0x81), decode: 'percent' },
  { key: 'supplyRpm', frame: read(0x00, 0x14, 0x50), decode: 'rpm' },
  { key: 'exhaustRpm', frame: read(0x00, 0x14, 0x51), decode: 'rpm' },
  { key: 'battery', frame: read(0x01, 0x03, 0x0f), decode: 'percent' },
];

export const READ_OF = Object.fromEntries(READS.map((r) => [r.key, r]));

/** The operation modes, by the byte of register 0x1412 (pydanfossair's OperationMode). */
export const MODES = ['demand', 'program', 'manual'];

/**
 * The modes as read: byte 3 is a unit stopped (from the Air Dial). Not in
 * pydanfossair; the value is the one openHAB's Danfoss Air binding names OFF
 * (information only, nothing copied). Read only: never offered nor written.
 */
export const READ_MODES = [...MODES, 'off'];

/** The registers of the unit's state: never skipped, a timeout only ends the read. */
export const STATE_KEYS = new Set(['mode', 'fanStep', 'boost', 'bypass', 'autoBypass', 'away']);

/** The manual fan steps (register 0x1561), as the select sends them. */
export const FAN_STEPS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

/** Feature roles (the last part of the feature external ids): frozen. */
export const FEATURES = {
  MODE: 'mode',
  FAN_STEP: 'fan-step',
  FAN: 'fan',
  BOOST: 'boost',
  BYPASS: 'bypass',
  AUTO_BYPASS: 'automatic-bypass',
  AWAY: 'away',
  TEMP_OUTDOOR: 'temperature-outdoor',
  TEMP_SUPPLY: 'temperature-supply',
  TEMP_EXTRACT: 'temperature-extract',
  TEMP_EXHAUST: 'temperature-exhaust',
  TEMP_ROOM: 'temperature-room',
  TEMP_ROOM_CALCULATED: 'temperature-room-calculated',
  HUMIDITY: 'humidity',
  FILTER: 'filter',
  SUPPLY_RPM: 'fan-supply-rpm',
  EXHAUST_RPM: 'fan-exhaust-rpm',
  BATTERY: 'battery',
  BOOST_START: 'boost-start',
  BOOST_STOP: 'boost-stop',
  BYPASS_ON: 'bypass-on',
  BYPASS_OFF: 'bypass-off',
  AUTO_BYPASS_ON: 'automatic-bypass-on',
  AUTO_BYPASS_OFF: 'automatic-bypass-off',
};

/**
 * The commands, by feature role: the register written (endpoint 0x01), the
 * byte for each value, the value read back that confirms it. `protective`:
 * never held back by the option nor by another command (stopping the boost).
 */
export const COMMANDS = {
  [FEATURES.MODE]: {
    register: [0x14, 0x12],
    read: 'mode',
    values: { demand: 0, program: 1, manual: 2 },
    needsRunning: true,
  },
  [FEATURES.FAN_STEP]: {
    register: [0x15, 0x61],
    read: 'fanStep',
    values: Object.fromEntries(FAN_STEPS.map((s) => [s, Number(s)])),
    needsManual: true,
    needsRunning: true,
  },
  // `needsRunning`: these may start the fans again, so the mode and the step
  // are read first, and a stopped unit (mode 3 or step 0) refuses them.
  [FEATURES.BOOST_START]: {
    register: [0x15, 0x30],
    read: 'boost',
    button: [1, true],
    needsRunning: true,
  },
  [FEATURES.BOOST_STOP]: {
    register: [0x15, 0x30],
    read: 'boost',
    button: [0, false],
    protective: true,
  },
  [FEATURES.BYPASS_ON]: { register: [0x14, 0x60], read: 'bypass', button: [1, true] },
  [FEATURES.BYPASS_OFF]: { register: [0x14, 0x60], read: 'bypass', button: [0, false] },
  // The automatic bypass register is inverted: 0 turns it on (pydanfossair).
  [FEATURES.AUTO_BYPASS_ON]: { register: [0x17, 0x06], read: 'autoBypass', button: [0, true] },
  [FEATURES.AUTO_BYPASS_OFF]: { register: [0x17, 0x06], read: 'autoBypass', button: [1, false] },
};

/** The value of a button press (Gladys sends 1). */
export const PRESSED = 1;

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = {
  min: 30,
  max: 3600,
  default: 60,
};

export const LIMITS = {
  /** Gladys: 300 states per minute for the whole integration. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /** A register that times out this many reads in a row (the unit answering others) is skipped. */
  registerTimeouts: 3,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** Opening the TCP connection of a poll. */
  connectTimeout: 3 * SECOND,
  /** One answer frame. */
  requestTimeout: 2 * SECOND,
  /** A refused connection of a boost stop is tried again this often, until its deadline. */
  connectRetry: 250,
  /** A measure register skipped after repeated timeouts is tried again this often. */
  registerRetry: HOUR,
  /** A boost stop reaffirmed by a read leaves at least this long after the read closed the line. */
  reassertDelay: SECOND,
  /** Failed reads: 30 s, 1, 2, then 5 minutes, never shorter than the interval. */
  backoff: [30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  /** The time of the last read goes to /data at most once a minute. */
  attemptWriteEvery: MINUTE,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /**
   * Commands (Gladys waits 5 s for the ack): the connection, the fresh read
   * and the write must be done by 3.5 s after the click, or the command is
   * refused unsent; the read back that confirms it is awaited until 4.3 s,
   * after which the command is "sent, without confirmation".
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** Connecting for a command: 2 s at most. */
  commandConnectMax: 2_000,
  /** The fresh read of a command: 1.5 s at most; 0.3 s at least left to send after it. */
  commandReadMax: 1_500,
  commandMinRead: 300,
  commandMinSend: 300,
  /** Reads after a command, spaced: its effect, then a check. */
  followUps: [5 * SECOND, 20 * SECOND],
  /** A sent command keeps its guard until a read shows what it asked, or 90 s. */
  guard: 90 * SECOND,
  /** A boost stop not confirmed is reaffirmed by the reads of the next 2 minutes, twice at most. */
  stopGuard: 2 * MINUTE,
  stopReasserts: 2,
};
