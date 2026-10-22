// -----------------------------------------------------------------------------
// The unit -> one Gladys device and its states (pure).
//
// `ext:<selector>:danfoss-air:ccm`: one device per integration. FROZEN RULE:
// the protocol, as pydanfossair reads it, gives no serial number, so the
// device is keyed by the CCM of the configuration, never by its IP address
// (a new address keeps the device and its history). The feature roles (the
// last part of their external ids) are published forever: never rename them.
// Every role is always built, so a republished device never loses a feature.
//
// No switch, no writable binary, no writable fan: a "turn everything off"
// (Google Home, Alexa, HomeKit, MCP, `switch.*` scenes) never reaches the
// ventilation. The commands are two `text/select` (operation mode, manual fan
// step) and `button/push` features (boost, bypass, automatic bypass); all are
// refused unless the configuration allows the commands, except "Stop the
// boost", which is never held back (src/app.js).
//
// Categories and units are those the core lists
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): °C on temperature-sensor, % on
// humidity-sensor, fan, maintenance and battery. The fan speeds in rpm have no
// unit in the core: `unknown` sensors whose name says "rpm".
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { COMMANDS, FAN_STEPS, FEATURES, MODES } from './constants.js';
import { DEVICE_NAME, FEATURE_NAMES, MODE_NAMES, STEP_NAME, word } from './i18n.js';

export const PLATFORM_ID = 'ccm';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const binary = sensor({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });
const temperature = sensor({
  category: C.TEMPERATURE_SENSOR,
  type: T.SENSOR.DECIMAL,
  unit: U.CELSIUS,
  min: -60,
  max: 90,
});
const rpm = sensor({ category: C.UNKNOWN, type: T.SENSOR.INTEGER, min: 0, max: 10_000 });
const select = {
  category: C.TEXT,
  type: T.TEXT.SELECT,
  min: 0,
  max: 0,
  read_only: false,
  has_feedback: true,
  keep_history: false,
};
const button = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};

/** The features, by role, in display order. */
export const DEFINITIONS = {
  [FEATURES.MODE]: select,
  [FEATURES.FAN_STEP]: select,
  [FEATURES.FAN]: sensor({
    category: C.FAN,
    type: T.FAN.PERCENT,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.BOOST]: binary,
  [FEATURES.BYPASS]: binary,
  [FEATURES.AUTO_BYPASS]: binary,
  [FEATURES.AWAY]: binary,
  [FEATURES.TEMP_OUTDOOR]: temperature,
  [FEATURES.TEMP_SUPPLY]: temperature,
  [FEATURES.TEMP_EXTRACT]: temperature,
  [FEATURES.TEMP_EXHAUST]: temperature,
  [FEATURES.TEMP_ROOM]: temperature,
  [FEATURES.TEMP_ROOM_CALCULATED]: temperature,
  [FEATURES.HUMIDITY]: sensor({
    category: C.HUMIDITY_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.FILTER]: sensor({
    category: C.MAINTENANCE,
    type: T.MAINTENANCE.LIFE_REMAINING,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.SUPPLY_RPM]: rpm,
  [FEATURES.EXHAUST_RPM]: rpm,
  [FEATURES.BATTERY]: sensor({
    category: C.BATTERY,
    type: T.BATTERY.INTEGER,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.BOOST_START]: button,
  [FEATURES.BOOST_STOP]: button,
  [FEATURES.BYPASS_ON]: button,
  [FEATURES.BYPASS_OFF]: button,
  [FEATURES.AUTO_BYPASS_ON]: button,
  [FEATURES.AUTO_BYPASS_OFF]: button,
};

export const ROLES = Object.keys(DEFINITIONS);

/** The value read for each sensor role. */
const VALUE_OF = {
  [FEATURES.FAN]: 'fanPercent',
  [FEATURES.BOOST]: 'boost',
  [FEATURES.BYPASS]: 'bypass',
  [FEATURES.AUTO_BYPASS]: 'autoBypass',
  [FEATURES.AWAY]: 'away',
  [FEATURES.TEMP_OUTDOOR]: 'outdoor',
  [FEATURES.TEMP_SUPPLY]: 'supply',
  [FEATURES.TEMP_EXTRACT]: 'extract',
  [FEATURES.TEMP_EXHAUST]: 'exhaust',
  [FEATURES.TEMP_ROOM]: 'room',
  [FEATURES.TEMP_ROOM_CALCULATED]: 'roomCalculated',
  [FEATURES.HUMIDITY]: 'humidity',
  [FEATURES.FILTER]: 'filter',
  [FEATURES.SUPPLY_RPM]: 'supplyRpm',
  [FEATURES.EXHAUST_RPM]: 'exhaustRpm',
  [FEATURES.BATTERY]: 'battery',
};

export const unitIds = (gladys) => gladys.externalIds('danfoss-air', PLATFORM_ID);

/** The role of one of our feature external ids, else undefined. */
export function parseFeatureId(externalId) {
  if (typeof externalId !== 'string') {
    return undefined;
  }
  const match = new RegExp(`:danfoss-air:${PLATFORM_ID}:([a-z-]+)$`).exec(externalId);
  return match && ROLES.includes(match[1]) ? match[1] : undefined;
}

const options = (values, label, language) =>
  values.map((value, index) => ({
    value,
    label: word(label(value), language),
    sort_order: index,
  }));

/** The Gladys device of the unit. */
export function buildDevice(gladys, { language }) {
  const ids = unitIds(gladys);
  return {
    name: word(DEVICE_NAME, language),
    external_id: ids.device,
    model: 'Danfoss Air (CCM)',
    should_poll: false,
    features: ROLES.map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      ...DEFINITIONS[role],
      ...(role === FEATURES.MODE
        ? { supported_options: options(MODES, (m) => MODE_NAMES[m], language) }
        : {}),
      ...(role === FEATURES.FAN_STEP
        ? { supported_options: options(FAN_STEPS, STEP_NAME, language) }
        : {}),
    })),
    params: [{ name: 'protocol', value: 'CCM TCP 30046' }],
  };
}

/** Whether a role is a command, and which. */
export const commandOf = (role) => (Object.hasOwn(COMMANDS, role) ? COMMANDS[role] : undefined);

/**
 * The states of the values read this time (a value not read is left out:
 * Gladys keeps its last one, never republished as new). A value outside the
 * bounds of its feature is dropped.
 */
export function deviceStates(ids, values) {
  const states = [];
  if (values.mode !== undefined) {
    states.push({ device_feature_external_id: ids.feature(FEATURES.MODE), text: values.mode });
  }
  if (values.fanStep !== undefined) {
    states.push({
      device_feature_external_id: ids.feature(FEATURES.FAN_STEP),
      text: String(values.fanStep),
    });
  }
  for (const [role, key] of Object.entries(VALUE_OF)) {
    let value = values[key];
    if (typeof value === 'boolean') value = value ? 1 : 0;
    // The core stores life-remaining as an integer.
    if (role === FEATURES.FILTER && Number.isFinite(value)) value = Math.round(value);
    const { min, max } = DEFINITIONS[role];
    if (Number.isFinite(value) && value >= min && value <= max) {
      states.push({ device_feature_external_id: ids.feature(role), state: value });
    }
  }
  return states;
}
