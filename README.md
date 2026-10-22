# gladys-danfoss-air

[Gladys Assistant](https://gladysassistant.com) external integration for
**Danfoss Air** heat recovery ventilation, through the **CCM** module on the
local network (TCP 30046, no cloud, no password): temperatures, humidity,
airflow, fan speeds, filter, Air Dial battery, boost, bypass and away mode;
the operation mode, manual fan step, boost and bypass behind an
off-by-default option, and "Stop the boost" always allowed. **Never tested
with a real device. Not affiliated with Danfoss.** The CCM has no
authentication: keep it on a trusted network.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (DanfossAirApp)
                                  ├─ src/danfoss/client.js    one TCP session at a time, bounded frames
                                  ├─ src/danfoss/protocol.js  decoders and write frames (pure)
                                  ├─ src/devices.js           the device and its states (pure)
                                  ├─ src/publisher.js         states within 300/min
                                  └─ src/store.js             /data/danfoss-air-state.json (last read)
```

- **Reads**: one TCP connection per poll (every 60 s, 30 s – 1 h), 18
  registers one after the other (4-byte requests, 63-byte answers), then
  closed: the CCM accepts one client at a time. Never sooner than the
  interval (test button, Discovery, reconnection, unchanged configuration,
  container restart: the time of the last read is kept in `/data`, written
  at most once a minute, before the read). Failures retried after 30 s to
  5 min, never under the interval. A register that times out while the
  others answer ends that read; a state register (mode, step, boost,
  bypass, away) is read again at the next poll, a measure is skipped after
  three times and tried again every hour. Exception to the interval: the
  reads 5 s and 20 s after a command that was not confirmed.
- **Stopped unit**: mode 3 (stopped from the Air Dial; not in pydanfossair,
  the value openHAB's binding names OFF) and step 0 are read and shown in
  the status; the lists keep their options; commands that need the mode are
  refused. Gladys never stops nor restarts the ventilation in v1.
- **Device**: `ext:<selector>:danfoss-air:ccm` (the protocol gives no
  serial number; the address is never part of the id). Every feature is
  always published; no switch, no writable binary or fan.
- **Commands** (`allow_commands`, off by default): two `text/select`
  (mode, fan step) and buttons (boost start, bypass, automatic bypass). A
  command takes the line from a poll, reads the register again in its own
  session, writes nothing when already so, checks the option, the
  configuration and a boost stop right before the write, writes within
  3.5 s of the click or not at all, and is confirmed only by the register
  read back equal to the value asked (by 4.3 s); otherwise "sent, without
  confirmation", a guard and reads 5 s and 20 s later. One at a time, never
  retried; the ack never waits for Gladys.
- **Stop the boost** (protective): never behind the option, takes the line
  from anything, cancels a command not written yet, one write; a refused
  connection (the CCM may free its place a moment after our own close) is
  tried again every 250 ms until 3.5 s after the click. Not confirmed, it is
  reaffirmed by the reads of the next 2 minutes (twice at most, a second
  after the read); a boost start decided later lifts that guard.
- **Hostile answers**: a frame is exactly 63 bytes in a fixed buffer, in as
  many TCP segments as it comes; a frame incomplete at its deadline, more
  bytes, or bytes without a request end the session (never the rest of a
  frame taken for the next answer); implausible values are unknown.
  Nothing received is logged.

## Credits

The protocol, its registers and commands are ported from
[pydanfossair](https://github.com/JonasPed/pydanfoss-air) (Jonas Pedersen,
Apache-2.0, 1.0.0), the library of Home Assistant's Danfoss Air
integration. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Modelled
on the sibling integrations
[gladys-duco](https://github.com/LM1LC3N7/gladys-duco) and
[gladys-zehnder-comfoair](https://github.com/LM1LC3N7/gladys-zehnder-comfoair).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npm run cover                                   # cover.png, plain Node
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the CCM is a fake behind the injected
connector, Gladys is the SDK's fake; `test/protocol.test.js` runs the real
TCP session against a loopback server.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an Apache-2.0 project,
credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in
the Docker image).
