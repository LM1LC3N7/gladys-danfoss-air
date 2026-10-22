# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (TCP goes through `node:net`). It reads a Danfoss Air
ventilation unit through its CCM module (TCP 30046, no cloud, no
authentication) and shows it as one Gladys device; commands behind an
off-by-default option, "Stop the boost" always allowed. Never tested with a
real device, not affiliated with Danfoss.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npm run cover                             # cover.png (800x534), plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js                  SDK bootstrap only
src/handlers.js           every SDK handler -> the app (shared with the tests)
src/app.js                DanfossAirApp: the line (one session), polling, backoff,
                          device, states, badge, status, test button, commands, guards
src/danfoss/client.js     TCP session: bounded frames, error kinds, beforeSend/startBy
src/danfoss/protocol.js   decoders and write frames (pydanfossair), pure
src/devices.js            -> the Gladys device and its states (pure)
src/publisher.js          states within 300/min
src/store.js              /data/danfoss-air-state.json: time of the last read
src/config.js             config_schema normalized (host, allow_commands, interval, language)
src/constants.js          registers, commands, feature roles, limits, timings
src/i18n.js               runtime texts (en/fr)
test/fixtures/fakeCcm.js  the fake CCM behind the injected connector
scripts/cover.mjs         cover.png generator
```

## Rules

- **External ids are forever**: device `danfoss-air:ccm` (no serial in the
  protocol: frozen rule), feature roles in `FEATURES` of `src/constants.js`.
  Every role is always built: a republished device never loses a feature.
- Manifest keys (`host`, `allow_commands`, `poll_interval`, `language`, the
  action `test_connection`) are frozen.
- **One connection at a time** (the CCM accepts one): everything goes
  through `useLine`; a command takes the line from a poll, "Stop the boost"
  from anything.
- **Commands**: never a switch, a writable binary or a writable fan; refused
  unless `allow_commands` (checked on arrival and in `beforeSend`), except
  `boost-stop`; decided on a fresh read in the same session; written within
  3.5 s; confirmed only by a read back equal to the value asked; a written
  command is never "not sent"; never retried; the ack never waits for Gladys.
- Never read sooner than the interval (button, scan, reconnection, restart);
  only the follow-up reads after a command not confirmed (5 s, 20 s).
- **Answers are hostile**: a frame is complete at exactly 63 bytes (never
  on a silence); incomplete at its deadline or longer, it ends the session;
  implausible values unknown; never log the bytes received.
- Never write mode 3 (off) nor step 0: stopping the ventilation is out of v1.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network (loopback only).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
