// -----------------------------------------------------------------------------
// Runtime texts (English and French): feature and mode names, the status of
// the integration, the answers of the button and the command errors.
// -----------------------------------------------------------------------------

import { FEATURES } from './constants.js';

const both = (en, fr) => ({ en, fr });

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

/** Two texts one after the other, in both languages. */
export const join = (a, b) => both(`${a.en} ${b.en}`, `${a.fr} ${b.fr}`);

/** "45 s", "5 min", "2 h", in both languages. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const DEVICE_NAME = both('Danfoss Air ventilation', 'Ventilation Danfoss Air');

export const FEATURE_NAMES = {
  [FEATURES.MODE]: both('Operation mode', 'Mode de fonctionnement'),
  [FEATURES.FAN_STEP]: both('Fan step (manual mode)', 'Palier de ventilation (mode manuel)'),
  [FEATURES.FAN]: both('Airflow', 'Débit d’air'),
  [FEATURES.BOOST]: both('Boost active', 'Boost actif'),
  [FEATURES.BYPASS]: both('Bypass open', 'Bypass ouvert'),
  [FEATURES.AUTO_BYPASS]: both('Automatic bypass', 'Bypass automatique'),
  [FEATURES.AWAY]: both('Away mode', 'Mode absence'),
  [FEATURES.TEMP_OUTDOOR]: both('Outdoor air temperature', 'Température de l’air extérieur'),
  [FEATURES.TEMP_SUPPLY]: both('Supply air temperature', 'Température de l’air soufflé'),
  [FEATURES.TEMP_EXTRACT]: both('Extract air temperature', 'Température de l’air extrait'),
  [FEATURES.TEMP_EXHAUST]: both('Exhaust air temperature', 'Température de l’air rejeté'),
  [FEATURES.TEMP_ROOM]: both('Room temperature (Air Dial)', 'Température de la pièce (Air Dial)'),
  [FEATURES.TEMP_ROOM_CALCULATED]: both(
    'Room temperature (calculated)',
    'Température de la pièce (calculée)',
  ),
  [FEATURES.HUMIDITY]: both('Humidity', 'Humidité'),
  [FEATURES.FILTER]: both('Filter life remaining', 'Durée de vie restante du filtre'),
  [FEATURES.SUPPLY_RPM]: both(
    'Supply fan speed (rpm)',
    'Vitesse du ventilateur de soufflage (tr/min)',
  ),
  [FEATURES.EXHAUST_RPM]: both(
    'Extract fan speed (rpm)',
    'Vitesse du ventilateur d’extraction (tr/min)',
  ),
  [FEATURES.BATTERY]: both('Air Dial battery', 'Pile de l’Air Dial'),
  [FEATURES.BOOST_START]: both('Start the boost', 'Démarrer le boost'),
  [FEATURES.BOOST_STOP]: both('Stop the boost', 'Arrêter le boost'),
  [FEATURES.BYPASS_ON]: both('Open the bypass', 'Ouvrir le bypass'),
  [FEATURES.BYPASS_OFF]: both('Close the bypass', 'Fermer le bypass'),
  [FEATURES.AUTO_BYPASS_ON]: both('Automatic bypass on', 'Activer le bypass automatique'),
  [FEATURES.AUTO_BYPASS_OFF]: both('Automatic bypass off', 'Désactiver le bypass automatique'),
};

export const MODE_NAMES = {
  demand: both('Demand', 'À la demande'),
  program: both('Program', 'Programme'),
  manual: both('Manual', 'Manuel'),
};

export const STEP_NAME = (step) => both(`Step ${step}`, `Palier ${step}`);

/** The integration status and the answers of the button. */
export const T = {
  noHost: both(
    'Enter the IP address of the CCM module of your Danfoss Air unit, then save.',
    'Saisissez l’adresse IP du module CCM de votre centrale Danfoss Air, puis enregistrez.',
  ),
  invalid: (typed) =>
    both(
      `Invalid address: ${typed} (an IPv4 address or a host name, optionally with a port).`,
      `Adresse invalide : ${typed} (une adresse IPv4 ou un nom d’hôte, avec un port si besoin).`,
    ),
  connecting: both('Reading the unit…', 'Lecture de la centrale…'),
  waiting: (wait) =>
    both(
      `Next read of the unit in ${wait.en} (never sooner than the refresh interval).`,
      `Prochaine lecture de la centrale dans ${wait.fr} (jamais avant l’intervalle de rafraîchissement).`,
    ),
  lastRead: (ago) => both(`Last read ${ago.en} ago.`, `Dernière lecture il y a ${ago.fr}.`),
  connected: (summary) => both(`Connected. ${summary.en}`, `Connecté. ${summary.fr}`),
  unreachable: (address, wait) =>
    both(
      `No answer from ${address} (next try in ${wait.en}). Check the address, that the CCM is on the network, and that no other application (Danfoss Air app, other home automation) is connected to it: the CCM accepts one connection at a time.`,
      `Pas de réponse de ${address} (nouvel essai dans ${wait.fr}). Vérifiez l’adresse, que le CCM est sur le réseau et qu’aucune autre application (application Danfoss Air, autre domotique) n’y est connectée : le CCM n’accepte qu’une connexion à la fois.`,
    ),
  failing: (reason, wait) =>
    both(
      `The unit answered badly (${reason}); next try in ${wait.en}.`,
      `La centrale a mal répondu (${reason}) ; nouvel essai dans ${wait.fr}.`,
    ),
  summary: (values) => {
    if (values.mode === 'off') {
      return both(
        'Danfoss Air: unit stopped (mode 3, from the Air Dial); Gladys does not restart it.',
        'Danfoss Air : centrale arrêtée (mode 3, depuis l’Air Dial) ; Gladys ne la relance pas.',
      );
    }
    const mode = values.mode ? MODE_NAMES[values.mode] : both('unknown mode', 'mode inconnu');
    const step =
      values.fanStep === undefined
        ? both('', '')
        : both(`, step ${values.fanStep}`, `, palier ${values.fanStep}`);
    const boost = values.boost ? both(', boost', ', boost') : both('', '');
    return both(
      `Danfoss Air: ${mode.en.toLowerCase()} mode${step.en}${boost.en}.`,
      `Danfoss Air : mode ${mode.fr.toLowerCase()}${step.fr}${boost.fr}.`,
    );
  },
};

/** The errors a command answers to Gladys. */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  badValue: both('Unknown value: not sent.', 'Valeur inconnue : non envoyée.'),
  badButton: both('A button only takes 1: not sent.', 'Un bouton ne prend que 1 : non envoyé.'),
  disabled: both(
    'Commands are disabled: turn on "Allow the commands" in the configuration of the integration.',
    'Les commandes sont désactivées : activez « Autoriser les commandes » dans la configuration de l’intégration.',
  ),
  noHost: both(
    'No address for the CCM in the configuration: not sent.',
    'Aucune adresse du CCM dans la configuration : non envoyée.',
  ),
  unitOffMode: both(
    'The unit is stopped (mode 3, from the Air Dial): Gladys neither stops nor restarts it. Command not sent.',
    'La centrale est arrêtée (mode 3, depuis l’Air Dial) : Gladys ne l’arrête ni ne la relance. Commande non envoyée.',
  ),
  unitOffStep: both(
    'The unit is stopped (fan step read 0): Gladys neither stops nor restarts it. Command not sent.',
    'La centrale est arrêtée (palier lu à 0) : Gladys ne l’arrête ni ne la relance. Commande non envoyée.',
  ),
  unknownMode: (byte) =>
    both(
      `Mode ${byte} unknown, or unit stopped: command not sent.`,
      `Mode ${byte} inconnu ou centrale arrêtée : commande non envoyée.`,
    ),
  unreadable: both('unreadable', 'illisible'),
  stopPending: both(
    'Boost stop not sent yet, still trying to reach the unit: check the boost in a few seconds.',
    'Arrêt du boost pas encore envoyé, la centrale est encore en cours de connexion : vérifiez le boost dans quelques secondes.',
  ),
  configChanged: both(
    'The configuration changed meanwhile: not sent.',
    'La configuration a changé entre-temps : non envoyée.',
  ),
  busy: both(
    'Another command to the unit is still running: not sent.',
    'Une autre commande vers la centrale est encore en cours : non envoyée.',
  ),
  protectMeanwhile: both(
    'The boost was stopped meanwhile: not sent.',
    'Le boost a été arrêté entre-temps : non envoyée.',
  ),
  tooSlow: both(
    'The unit answered too slowly to send the command in time: not sent.',
    'La centrale a répondu trop lentement pour envoyer la commande à temps : non envoyée.',
  ),
  unknownState: (reason) =>
    both(
      `The state of the unit could not be read just before (${reason}): command not sent.`,
      `L’état de la centrale n’a pas pu être relu juste avant (${reason}) : commande non envoyée.`,
    ),
  notManual: both(
    'The fan step can only be set in manual mode: choose the manual mode first. Not sent.',
    'Le palier ne se règle qu’en mode manuel : choisissez d’abord le mode manuel. Non envoyée.',
  ),
  notSent: (reason) =>
    both(
      `The unit could not be reached (${reason}): command not sent.`,
      `La centrale n’a pas pu être jointe (${reason}) : commande non envoyée.`,
    ),
  sentUnconfirmed: (reason) =>
    both(
      `Command sent, without confirmation (${reason}): check the state of the unit in a few seconds.`,
      `Commande envoyée, sans confirmation (${reason}) : vérifiez l’état de la centrale dans quelques secondes.`,
    ),
};
