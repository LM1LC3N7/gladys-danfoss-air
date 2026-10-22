# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Danfoss Air heat recovery ventilation read through the CCM module on the
  local network (TCP 30046, no cloud, no account): one device with the
  outdoor, supply, extract, exhaust and room temperatures, humidity, airflow,
  fan speeds, filter life, Air Dial battery, boost, bypass, automatic bypass
  and away mode.
- Operation mode (demand, program, manual) and manual fan step (1-10) as
  lists, and buttons to start the boost, open or close the bypass and turn
  the automatic bypass on or off, refused unless "Allow the commands" is on
  (off by default). Each command reads the register again just before, is
  written within 3.5 s or not at all, and is confirmed only by the value
  read back.
- "Stop the boost", never held back (option, other command, read in
  progress); a connection refused for a moment is tried again every 250 ms
  until 3.5 s; reaffirmed by the next reads when not confirmed, unless a
  boost start is asked afterwards.
- One connection to the CCM at a time; reads never sooner than the
  interval, even after a restart (time of the last read kept in `/data`).
- Answers read as frames of exactly 63 bytes: a frame cut in several TCP
  segments is read whole, an incomplete one ends the read (never values
  shifted from one register to the next).
- A unit stopped from the Air Dial (mode 3) is shown in the status; mode and
  fan step commands are then refused. Gladys never stops nor restarts the
  ventilation.
- State registers are read at every poll; a measure that never answers is
  tried again every hour.
- "Test the connection" button; documentation in English and French;
  `LICENSE` and `THIRD_PARTY_NOTICES.md` shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-danfoss-air/commits/main
