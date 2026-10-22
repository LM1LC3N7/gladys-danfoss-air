// -----------------------------------------------------------------------------
// The only network access: one TCP connection to the CCM at a time (the
// module accepts one client), one request and one answer frame at a time.
//
// - An answer is one frame of 63 bytes at most, kept in a fixed buffer: a
//   frame shorter than 63 bytes is complete after a short silence (as
//   pydanfossair's single recv); more than 63 bytes, or bytes that arrive
//   with no request waiting, break the session (never a frame misread as
//   the answer of the next request).
// - Every wait is bounded: the connection and each answer.
// - Errors say whether the request may have left: `sent` is set as soon as
//   the bytes are handed to the socket, so a command that may have reached
//   the module is never reported "not sent".
// - `beforeSend` and `startBy` are checked right before the bytes go.
// - Nothing received is ever logged.
// -----------------------------------------------------------------------------

import { createConnection } from 'node:net';
import { FRAME_SIZE, TIMINGS } from '../constants.js';

export const ERROR_KINDS = {
  /** The connection was not opened: nothing sent. */
  UNREACHABLE: 'unreachable',
  /** No (complete) answer in time. */
  TIMEOUT: 'timeout',
  /** The module closed the connection, or a socket error. */
  CLOSED: 'closed',
  /** An answer that is not a frame (too long, unexpected bytes). */
  PROTOCOL: 'protocol',
  /** Ended by the integration (a command took the line, a new configuration). */
  ABORTED: 'aborted',
  /** The deadline of a command passed before its bytes left: nothing sent. */
  LATE: 'late',
};

export class CcmError extends Error {
  constructor(kind, message, { sent = false } = {}) {
    super(message);
    this.kind = kind;
    this.sent = sent;
  }
}

/** A short reason for the logs and the status (never the bytes received). */
export function errorReason(err) {
  if (err instanceof CcmError) {
    return err.kind;
  }
  return 'error';
}

/** The default connector: a plain TCP socket, no delay. */
export function tcpConnect(host, port) {
  const socket = createConnection({ host, port });
  socket.setNoDelay?.(true);
  return socket;
}

export class CcmSession {
  constructor(socket, { timers = globalThis, now = Date.now, quietMs = TIMINGS.frameQuiet } = {}) {
    this.socket = socket;
    this.timers = timers;
    this.now = now;
    this.quietMs = quietMs;
    this.frame = Buffer.alloc(FRAME_SIZE);
    this.length = 0;
    this.pending = undefined;
    this.dead = undefined;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => this.fail(new CcmError(ERROR_KINDS.CLOSED, 'socket error')));
    socket.on('close', () => this.fail(new CcmError(ERROR_KINDS.CLOSED, 'connection closed')));
  }

  onData(chunk) {
    if (this.dead) return;
    const pending = this.pending;
    if (!pending) {
      this.fail(new CcmError(ERROR_KINDS.PROTOCOL, 'bytes without a request'));
      return;
    }
    if (this.length + chunk.length > FRAME_SIZE) {
      this.fail(new CcmError(ERROR_KINDS.PROTOCOL, 'answer longer than a frame'));
      return;
    }
    chunk.copy(this.frame, this.length);
    this.length += chunk.length;
    this.timers.clearTimeout(pending.quiet);
    if (this.length === FRAME_SIZE) {
      this.settle();
    } else {
      pending.quiet = this.timers.setTimeout(() => this.settle(), this.quietMs);
    }
  }

  /** The frame received so far answers the request. */
  settle() {
    const pending = this.pending;
    if (!pending || this.length === 0) return;
    this.pending = undefined;
    this.timers.clearTimeout(pending.timer);
    this.timers.clearTimeout(pending.quiet);
    const answer = Buffer.from(this.frame.subarray(0, this.length));
    this.length = 0;
    pending.resolve(answer);
  }

  /** Ends the session: the request waiting fails with `err` (sent if its bytes left). */
  fail(err) {
    if (this.dead) return;
    this.dead = err;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      this.timers.clearTimeout(pending.timer);
      this.timers.clearTimeout(pending.quiet);
      pending.reject(new CcmError(err.kind, err.message, { sent: true }));
    }
    try {
      this.socket.destroy();
    } catch {
      // Already closed.
    }
  }

  /** Ended by the integration. */
  abort(message = 'aborted') {
    this.fail(new CcmError(ERROR_KINDS.ABORTED, message));
  }

  close() {
    this.fail(new CcmError(ERROR_KINDS.ABORTED, 'session closed'));
  }

  /**
   * Sends one request and resolves with its answer frame (1 to 63 bytes).
   * `beforeSend()` may throw to stop the request before any byte leaves;
   * `startBy`: the bytes leave by then or not at all.
   */
  request(bytes, { timeoutMs = TIMINGS.requestTimeout, beforeSend, startBy = Infinity } = {}) {
    return new Promise((resolve, reject) => {
      if (this.dead) {
        reject(new CcmError(this.dead.kind, this.dead.message));
        return;
      }
      if (this.pending) {
        reject(new CcmError(ERROR_KINDS.PROTOCOL, 'a request is already waiting'));
        return;
      }
      if (this.now() > startBy) {
        reject(new CcmError(ERROR_KINDS.LATE, 'deadline passed before sending'));
        return;
      }
      // The last check: nothing else runs between it and the write.
      if (beforeSend) {
        try {
          beforeSend();
        } catch (err) {
          err.beforeSend = true;
          reject(err);
          return;
        }
      }
      this.length = 0;
      this.pending = { resolve, reject, timer: undefined, quiet: undefined };
      this.pending.timer = this.timers.setTimeout(() => {
        this.fail(new CcmError(ERROR_KINDS.TIMEOUT, 'no answer'));
      }, timeoutMs);
      try {
        this.socket.write(bytes);
      } catch {
        this.fail(new CcmError(ERROR_KINDS.CLOSED, 'write failed'));
      }
    });
  }
}

/**
 * Opens a connection: `promise` resolves with a session once connected;
 * `abort()` cancels it (nothing was sent).
 */
export function openSession({
  host,
  port,
  connect = tcpConnect,
  timeoutMs = TIMINGS.connectTimeout,
  timers = globalThis,
  now = Date.now,
}) {
  let socket;
  let settled = false;
  let reject;
  let timer;
  const promise = new Promise((resolve, rejectPromise) => {
    reject = rejectPromise;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      fn(value);
    };
    try {
      socket = connect(host, port);
    } catch {
      done(rejectPromise, new CcmError(ERROR_KINDS.UNREACHABLE, 'connection failed'));
      return;
    }
    timer = timers.setTimeout(() => {
      socket.destroy();
      done(rejectPromise, new CcmError(ERROR_KINDS.UNREACHABLE, 'connection timeout'));
    }, timeoutMs);
    socket.once('connect', () => {
      done(resolve, new CcmSession(socket, { timers, now }));
    });
    socket.once('error', (err) => {
      socket.destroy();
      done(rejectPromise, new CcmError(ERROR_KINDS.UNREACHABLE, err?.code ?? 'connection failed'));
    });
    socket.once('close', () => {
      done(rejectPromise, new CcmError(ERROR_KINDS.UNREACHABLE, 'connection closed'));
    });
  });
  // A failed connection has no listener yet when it fails: never unhandled.
  promise.catch(() => {});
  return {
    promise,
    abort() {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      socket?.destroy();
      reject(new CcmError(ERROR_KINDS.ABORTED, 'connection aborted'));
    },
  };
}
