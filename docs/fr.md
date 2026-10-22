# Danfoss Air pour Gladys

Affiche une ventilation double flux **Danfoss Air** (Air a2, a3, w2…
équipée du **CCM**, Connection and Control Module) dans Gladys, par votre
réseau local, sans cloud ni compte. Intégration non officielle, **sans lien
avec Danfoss**. **Jamais testé avec un vrai appareil** : elle suit le
protocole tel que le parle la bibliothèque libre pydanfossair (utilisée par
Home Assistant) ; merci de signaler ce que vous constatez.

## Avant de commencer

- Le CCM doit être sur votre réseau (Ethernet) et joignable depuis Gladys sur
  le **port TCP 30046**. Donnez-lui une adresse IP fixe dans votre routeur.
- Le CCM n’a **pas de mot de passe** et n’accepte **qu’une connexion à la
  fois** : gardez-le sur un réseau de confiance, et fermez l’application
  Danfoss Air (ou une autre domotique qui le lit) si Gladys ne peut pas s’y
  connecter.

## Installation

1. Installez l’intégration depuis le store de Gladys.
2. Saisissez l’**adresse IP du CCM** (port 30046 sauf si vous en ajoutez un),
   enregistrez.
3. Ouvrez l’onglet **Découverte** et ajoutez la centrale.

## Ce que vous obtenez

Un appareil, **Ventilation Danfoss Air**, avec :

| Fonctionnalité                                                                                     | Remarques                                                                                              |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Températures de l’air extérieur, soufflé, extrait et rejeté                                        | °C                                                                                                     |
| Température de la pièce (Air Dial) et température calculée                                         | °C                                                                                                     |
| Humidité                                                                                           | %                                                                                                      |
| Débit d’air                                                                                        | %, en lecture seule (il peut apparaître comme un ventilateur dans HomeKit, mais refuse toute commande) |
| Vitesses des ventilateurs de soufflage et d’extraction                                             | tr/min                                                                                                 |
| Durée de vie restante du filtre                                                                    | %                                                                                                      |
| Pile de l’Air Dial                                                                                 | %                                                                                                      |
| Boost actif, bypass ouvert, bypass automatique, mode absence                                       | lecture seule, 1 = actif                                                                               |
| Mode de fonctionnement                                                                             | liste : à la demande, programme, manuel                                                                |
| Palier de ventilation (mode manuel)                                                                | liste : 1 à 10                                                                                         |
| Démarrer / arrêter le boost, ouvrir / fermer le bypass, activer / désactiver le bypass automatique | boutons                                                                                                |

La centrale est lue toutes les 60 s (réglable de 30 s à 1 h). Le bouton de
test, une recherche dans Découverte, une reconnexion de Gladys ou un
redémarrage de l’intégration ne la relisent jamais avant l’intervalle.

## Commandes

Toutes les commandes sauf **Arrêter le boost** sont refusées tant que
**Autoriser les commandes** n’est pas activé (désactivé par défaut). Aucun
interrupteur : un « éteins tout » d’un assistant vocal n’atteint jamais la
ventilation.

- Chaque commande relit le registre juste avant de l’écrire, n’écrit rien
  quand la valeur est déjà la bonne, et n’est confirmée que si la valeur
  relue est celle demandée. Une commande qui a pu atteindre la centrale sans
  être confirmée répond « envoyée, sans confirmation » : vérifiez la
  centrale quelques secondes plus tard. Une commande qui ne peut pas être
  écrite dans les 3,5 s est refusée et rien n’est envoyé.
- Le palier ne se règle qu’en mode **manuel** (choisissez d’abord le mode).
- **Arrêter le boost** est toujours possible : jamais bloqué par l’option,
  par une autre commande ni par une lecture en cours, il annule une commande
  pas encore envoyée. S’il n’est pas confirmé, les lectures des deux minutes
  suivantes le renvoient (deux fois au plus) tant que le boost reste actif.
- Ouvrir le bypass arrête la récupération de chaleur (air neuf non
  réchauffé) : à réserver à l’été.

## Limites

- Le protocole n’est pas documenté par Danfoss ; seuls les registres lus et
  écrits par pydanfossair sont utilisés.
- Le protocole ne donne pas de numéro de série : l’intégration affiche une
  centrale, celle de l’adresse saisie. Changer l’adresse garde l’appareil et
  son historique ; une autre centrale mise à la même adresse apparaîtrait
  sur le même appareil.
- Gladys occupe la connexion pendant sa lecture (environ une seconde à
  chaque intervalle) : l’application Danfoss Air peut devoir attendre, et
  inversement.
- La température de la pièce et la pile viennent de la télécommande Air
  Dial ; sans elle, elles peuvent rester vides.

## Confidentialité

Rien ne sort de votre réseau. L’intégration ne garde que l’heure de sa
dernière lecture dans son volume `/data`.
