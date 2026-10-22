# Danfoss Air for Gladys

Shows a **Danfoss Air** heat recovery ventilation unit (Air a2, a3, w2…
fitted with the **CCM**, Connection and Control Module) in Gladys, over your
local network, without any cloud or account. Unofficial integration, **not
affiliated with Danfoss**. **Never tested with a real device**: it follows
the protocol as the open-source library pydanfossair (used by Home
Assistant) speaks it; please report what you see.

## Before you start

- The CCM must be on your network (Ethernet) and reachable from Gladys on
  **TCP port 30046**. Give it a fixed IP address in your router.
- The CCM has **no password** and accepts **one connection at a time**: keep
  it on a trusted network, and close the Danfoss Air app (or another home
  automation that reads it) if Gladys cannot connect.

## Setup

1. Install the integration from the Gladys store.
2. Enter the **IP address of the CCM** (port 30046 unless you add one), save.
3. Open the **Discovery** tab and add the unit.

## What you get

One device, **Danfoss Air ventilation**, with:

| Feature                                                                    | Notes                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Outdoor, supply, extract and exhaust air temperatures                      | °C                                                                        |
| Room temperature (Air Dial) and calculated room temperature                | °C                                                                        |
| Humidity                                                                   | %                                                                         |
| Airflow                                                                    | %, read only (it may show as a fan in HomeKit, but refuses every command) |
| Supply and extract fan speeds                                              | rpm                                                                       |
| Filter life remaining                                                      | %                                                                         |
| Air Dial battery                                                           | %                                                                         |
| Boost active, bypass open, automatic bypass, away mode                     | read only, 1 = on                                                         |
| Operation mode                                                             | list: demand, program, manual                                             |
| Fan step (manual mode)                                                     | list: 1 to 10                                                             |
| Start / stop the boost, open / close the bypass, automatic bypass on / off | buttons                                                                   |

The unit is read every 60 s (configurable from 30 s to 1 h). The test
button, a Discovery scan, a reconnection of Gladys or a restart of the
integration never read it sooner than the interval. The one exception:
after a command that was not confirmed, the unit is read again 5 s and 20 s
later to check its effect.

## Commands

All commands except **Stop the boost** are refused unless **Allow the
commands** is on (off by default). There is no switch: a "turn everything
off" of a voice assistant never reaches the ventilation.

- Each command reads the register again just before writing it, writes
  nothing when it is already so, and is confirmed only when the value read
  back is the one asked. A command that may have reached the unit without
  being confirmed answers "sent, without confirmation": check the unit a few
  seconds later. A command that cannot be written within 3.5 s is refused
  and nothing is sent.
- The fan step can only be set in **manual** mode (choose the mode first).
- **Stop the boost** is always allowed: it is never held back by the option,
  by another command or by a read in progress, and cancels a command not
  sent yet. If the CCM refuses the connection for a moment, it tries again
  every 250 ms until 3.5 s after the press. If it is not confirmed, the
  reads of the following two minutes send it again (twice at most) while
  the boost shows on; a "Start the boost" pressed afterwards wins and is
  never undone.
- **Unit stopped** from the Air Dial (mode 3, or step read 0): the status
  says so, the lists do not change, and the mode, fan step and "Start the
  boost" commands are refused. The bypass commands are sent as they are
  (they move a damper, they do not start the fans); "Stop the boost" is
  always allowed. Gladys neither stops
  nor restarts the ventilation in this version (stopping a heat recovery
  unit stops the air renewal).
- Opening the bypass stops the heat recovery (fresh air not warmed): use it
  in summer.

## Limits

- The protocol is not documented by Danfoss; only the registers read and
  written by pydanfossair are used.
- The protocol gives no serial number: the integration shows one unit, the
  one at the configured address. Changing the address keeps the device and
  its history; another unit put at the same address would show on the same
  device and receive its commands too. Reserve the address of the CCM in
  your router (fixed DHCP lease).
- An answer of the unit must be exactly 63 bytes; an incomplete answer ends
  the read (nothing is published shifted).
- Gladys holds the connection while it reads (about a second every
  interval): the Danfoss Air app may have to wait, and conversely.
- The room temperature and battery come from the Air Dial remote; without
  one they may stay empty.

## Privacy

Nothing leaves your network. The integration keeps only the time of its last
read in its `/data` volume.
