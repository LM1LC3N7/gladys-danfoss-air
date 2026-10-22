# TODO — Danfoss Air v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (lot 13) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-22): the CCM by IP address, 18
      registers read every interval over one connection (never sooner, even
      after a restart), one device, mode and fan step selects, boost, bypass
      and automatic bypass buttons behind `allow_commands` (off), "Stop the
      boost" never held back, test button, docs en/fr, cover. Tested against
      a fake CCM only. The store validator was not run by the dev session
      (it needs the real terminal).
- [ ] **Milestone 2 — real unit**: run against a real CCM (see "To check").
- [ ] **Milestone 3 — more**: away mode command, filter reset, night
      cooling, alarms, if a permissive reference documents their registers.

## To check on a real unit

- That every answer is a 63-byte frame (the 150 ms silence handles a shorter
  one) and that a write gets an answer frame, as pydanfossair reads it.
- How fast the CCM answers 18 reads; whether it drops the connection when
  the Danfoss app connects meanwhile; how long it refuses a new connection
  after one closes (a command right after a poll).
- That the write of the mode, fan step, boost and bypass shows at once in
  the register read back (else every command ends "sent, without
  confirmation").
- What the room temperature and battery registers give without an Air Dial,
  and what the fan speed percent register (0x1781) gives on older firmwares.
- Whether a serial number register exists (none in pydanfossair).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and `docker_image` (`ghcr.io/lm1lc3n7/gladys-danfoss-air:0.1.0`);
  the first patch release gives 0.1.1. The manifest test checks the semver
  shape and that the four agree, never a pinned value.
- **Reference**: pydanfossair 1.0.0 (Apache-2.0, LICENSE file read; author
  Jonas Pedersen per `setup.py`), cloned read-only in `_ref/pydanfossair`.
  Credited in `THIRD_PARTY_NOTICES.md` with the full license text. No
  register outside pydanfossair is used (the protocol is undocumented).
- **Identity (FROZEN RULE)**: the protocol as pydanfossair reads it gives no
  serial number, so the device is `danfoss-air:ccm`, one per integration,
  never the IP address. Consequence, documented: identity cannot be checked
  at each read nor before a command (another CCM put at the same address
  would show on the same device); plausibility checks only (frame size,
  value ranges, known mode).
- **Sibling modules**: gladys-duco (polling, guards, select) and
  gladys-robonect (attempt time in /data, protective command, generation);
  gladys-zehnder-comfoair read for the domain (one session).
- **One connection at a time** (`useLine`): a poll is one session of 18
  requests, closed after; a command aborts a running poll (nothing of it is
  applied) and opens its own session; "Stop the boost" aborts anything,
  including a command (not written: refused "boost stopped meanwhile";
  written: "sent, without confirmation").
- **Protective command**: only "Stop the boost" (the brief lists the boost
  stop). Not behind the option; one try, no fresh read; confirmed by the
  read back; when not confirmed or not sent, a guard of 2 minutes resends it
  (twice at most) when a read shows the boost on and no boost start left
  after it. A second press while one runs joins it.
- **Sensitive commands** (behind `allow_commands`): mode, fan step (refused
  unless the fresh read shows manual mode, as pydanfossair's CLI), boost
  start, bypass open/close, automatic bypass on/off. Selects and buttons,
  never a switch. Values strictly from the lists (the fan step is the text
  "1".."10"); buttons strictly 1.
- **Deadlines**: connection 2 s max, fresh read 1.5 s max, write by 3.5 s
  after the click (checked right before the bytes), read back until 4.3 s.
  The written flag is set in `beforeSend`, right before the bytes go: a
  write cut afterwards is always "sent, without confirmation".
- **Reads**: values not read this time are left out (never republished as
  new); a register that times out while the others answered ends the read
  (a late frame would be taken for the next answer) and is skipped after
  three such reads until a restart. Implausible values are unknown:
  temperatures outside -60..90 °C, mode other than 0-2, step outside 1-10,
  percentages over 100.
- **No 429/5xx** (raw TCP): failures back off 30 s, 1, 2, 5 min, never under
  the interval. No credentials, nothing secret: `/data` holds only the time
  of the last read (written at most once a minute, before the read).
- **Units**: °C, %; fan speeds in rpm are `unknown` integer sensors (no rpm
  unit in the core), filter life on `maintenance/life-remaining` (integer).
- **Interval**: 60 s by default, 30 s – 1 h (Home Assistant reads more
  often; the CCM is shared with the Danfoss app).
- **Not done**: Bluetooth (none), scenes, widgets, away mode command (not in
  pydanfossair).
