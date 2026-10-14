# Données publiques de veille — Bartali Courtage

Ce dépôt **public** ne contient que :
- le code de collecte des **sources officielles** (Banque de France, Banque centrale européenne, Service-Public.gouv.fr, economie.gouv.fr) ;
- les données collectées, publiques par nature ;
- `veille.json`, servi par GitHub Pages et lu par https://bartali-courtage.fr pour afficher des repères à jour.

Aucun secret, aucune donnée personnelle. Le code source de référence est maintenu dans le dépôt privé du projet (`outils/veille/`) et recopié ici par `node outils/donnees-publiques/preparer.mjs`.

Garde-fous : contrôles de cohérence de chaque source, dates d'expiration sur chaque élément (revérifiées par le navigateur), liens limités aux sites officiels, repli sur les données intégrées au site si ce fichier est indisponible.
