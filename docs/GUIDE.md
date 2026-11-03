# RealmForge — guide complet

Ce document explique le projet de bout en bout : ce que fait le jeu, comment l'économie fonctionne, ce que font les
contrats, comment les réseaux et le stockage marchent. Pour tester, voir [TESTING.md](TESTING.md). Pour le cahier des
charges, voir [SPEC.md](SPEC.md).

## 1. Le projet en une minute

RealmForge est un jeu navigateur dans le style de Mario Maker.
- Un **créateur** construit un niveau 2D et le **publie comme NFT** (ERC-721, contrat `LevelNFT`).
- Des **joueurs** jouent ce niveau et paient des frais en **FORGE** (ERC-20, contrat `ForgeCoin`).
- Les frais vont au créateur, à un pot de saison et à la trésorerie ; le joueur gagne une récompense en FORGE.
- On peut aussi faire des **courses à 2-4 joueurs** avec mise, et revendre un niveau (NFT) avec royalties.

**Principe clé : le gameplay n'est pas sur la blockchain.** La chaîne garde trois choses : la propriété des niveaux, l'économie
(le jeton FORGE) et les paiements. La physique, les salles de course et la validation tournent hors chaîne.

## 2. Architecture

```
 Navigateur (web/)                                 serveur (server/)                  chaîne (contracts/)
 React + wagmi + Phaser/Matter ── RPC (viem) ─────────────────────────────────────► LevelNFT  (ERC-721)
   └─ game-core : mouvement Mario,   ── HTTP ──► API Fastify :8787                    ForgeCoin (ERC-20)
      éléments, 60 Hz fixes              épingle les niveaux, valide les parties,        ▲
                                          signe les résultats (EIP-712)                   │ événements
                                  ── WS ────► Colyseus :2567 (salles de course)           │
                                              indexeur (viem) → SQLite ◄──────────────────┘
```

| Dossier | Rôle |
|---|---|
| `contracts/` | Les 2 contrats Solidity, leurs tests, le déploiement (Hardhat 3 + OpenZeppelin 5 + Ignition) |
| `game-core/` | Le moteur de mouvement « Mario » et le registre d'éléments, en TypeScript pur et déterministe |
| `server/` | API, salles Colyseus, signataire EIP-712, indexeur des événements, base SQLite |
| `web/` | Le site : pages, éditeur, scènes Phaser, hooks vers les contrats |
| `assets/` | Sources des graphismes ; les packs sont servis depuis `web/public/` |

Chaque dossier est un projet npm autonome (pas de workspaces).

### Modèle de confiance (à savoir dire à l'oral)
Le serveur valide qu'une partie est plausible (vitesse, checkpoints, temps) puis **signe un résultat EIP-712**. Le contrat
vérifie cette signature : signataire autorisé, nonce non utilisé, date limite, chaîne et adresse du contrat. **Le serveur est
donc un point de centralisation** : s'il est compromis, il peut signer de faux résultats. C'est documenté et atténué
(`setSigner` pour changer la clé, `pause`, plafonds), voir [security/THREAT_MODEL.md](security/THREAT_MODEL.md).

Les messages signés (domaine `RealmForge ForgeCoin` ou `RealmForge LevelNFT`, version `1`) :

| Message | Utilisé pour |
|---|---|
| `ClearProof(creator, layoutHash, deadline)` | publier un niveau (preuve qu'il est terminable) |
| `RunResult(player, levelId, timeMs, cleared, coins, nonce, deadline)` | régler une partie solo |
| `RaceResult(roomId, ranking, deadline)` | régler une course |
| `SeasonResult(season, players, creators, shares)` | clôturer une saison |
| ERC-2612 `Permit` | autoriser les frais sans transaction `approve` (même domaine que ForgeCoin) |

Piège connu, déjà corrigé : le domaine du permit s'appelle « RealmForge ForgeCoin » alors que `name()` renvoie « ForgeCoin ».
Il faut lire `eip712Domain()`.

## 3. Les parcours

**Publier** : éditeur → test-play jusqu'à l'arrivée (clear check) → miniature → le JSON du niveau est épinglé sur IPFS et le
serveur signe une `ClearProof` → `LevelNFT.publish`. Seule l'empreinte `layoutHash = keccak256(JSON canonique)` est stockée
sur la chaîne : elle lie le NFT au contenu exact.

**Jouer et régler** : le joueur termine le niveau → `POST /runs/validate` → le serveur renvoie un `RunResult` signé (une seule
fois par enregistrement de partie, sinon HTTP 409) → le joueur signe un permit → `ForgeCoin.settleRunWithPermit` paie les frais
et mint la récompense en une transaction.

**Course** : un joueur crée la salle (mise bloquée dans `ForgeCoin`), les autres la rejoignent avec le code et misent aussi, tout
le monde fait « Ready », le serveur chronomètre. Si un joueur tombe, il réapparaît (R ou bouton **Respawn**) ; **Give up** abandonne.
Le serveur signe un classement **complet** (les finisseurs, puis les autres par progression) et n'importe qui peut appeler `settleRace`.
Sans règlement, on peut rembourser après 1 h.

**Saison** : tous les 30 jours l'admin clôture la saison avec un classement calculé et signé par le serveur
(règles dans [SEASONS.md](SEASONS.md)).

**Marché** (contrat `LevelNFT`) : lister un niveau en ETH, l'acheter, royalties au créateur (ERC-2981).

## 4. Règles de l'économie

Toutes les constantes sont en haut de [`ForgeCoin.sol`](../contracts/src/ForgeCoin.sol) (« CONSTANTS »).

| Règle | Valeur | Constante |
|---|---|---|
| Faucet | 100 FORGE, une fois par adresse ; 10 000 FORGE max par jour UTC pour tout le monde | `FAUCET_AMOUNT`, `FAUCET_DAILY_BUDGET` |
| Frais de jeu | fixés par le créateur, 100 FORGE max | `PlayFeeTooHigh` |
| Répartition d'un frais | 70 % propriétaire · 20 % pot de saison · 10 % trésorerie, dont la moitié est brûlée (5 % gardés, 5 % brûlés) | `OWNER_BPS`, `POOL_BPS`, `TREASURY_BURN_BPS` |
| Récompense d'un clear | 5 de base + difficulté (0 à 45, plus le niveau est dur mieux c'est payé), base + difficulté plafonnés à 50 | `BASE_REWARD`, `MAX_CLEAR_REWARD` |
| Bonus premier clear d'un niveau | +20 | `FIRST_CLEAR_BONUS` |
| Bonus record de temps | +10 | `RECORD_BONUS` |
| Bonus pièces | +0,1 par pièce, 5 max | `COIN_BONUS`, `MAX_COIN_BONUS` |
| Plafond de récompenses | 200 FORGE par joueur et par jour UTC | `DAILY_MINT_CAP` |
| Auto-jeu | le propriétaire ou le créateur paie les frais mais **ne gagne ni récompense ni statistiques** | — |
| Offre maximale | 100 000 000 FORGE | `MAX_SUPPLY` |
| Course | 2 à 4 joueurs, mises égales ; cagnotte = mise × joueurs : 60 % 1er · 25 % 2e · 10 % propriétaire · 5 % pot de saison | `RACE_*_BPS` |
| Remboursement de course | possible 1 h après la création si non réglée | `RACE_TIMEOUT` |
| Saison | 30 jours ; pot réparti 50 % joueurs / 50 % créateurs, top 10 par catégorie | `SEASON_DURATION`, `MAX_SEASON_WINNERS` |

**Exemples** (frais 10) : premier clear d'un niveau neuf = 5 + 0 + 20 + 10 = **35** (net +25). Clear suivant sans record = **5**
(net −5). Le créateur qui joue son niveau paie 10, récupère 7 : **−3**. Un frais de 10 donne 7 au propriétaire, 2 au pot, 0,5 à la
trésorerie et 0,5 brûlé.

### Modifier une règle
1. Change la constante dans `ForgeCoin.sol`.
2. `cd contracts && npx hardhat test` : plusieurs tests vérifient des montants exacts, ajuste-les.
3. `npx tsx scripts/export-abi.ts` pour régénérer les ABI du web et du serveur (ne jamais les éditer à la main).
4. Mets à jour les textes de l'interface qui affichent ces pourcentages (`PAYOUT` dans `web/src/pages/Room.tsx`, estimation de gain
   dans `web/src/pages/Play.tsx`) et ce tableau.
5. Redéploie (`npm run deploy:local`). Un contrat déjà déployé sur Sepolia ne change pas : il faut un nouveau déploiement.
Les règles de classement des saisons sont côté serveur (`server/src/season/scoring.ts`) et ne demandent pas de redéploiement.

## 5. Ce que fait ForgeCoin

| Fonction | Rôle |
|---|---|
| `claimFaucet` | 100 FORGE, une fois par adresse, avec budget quotidien |
| `settleRun` / `settleRunWithPermit` | vérifie la signature serveur, prélève les frais, répartit 70/20/10 avec brûlage, mint la récompense, met à jour les statistiques du niveau |
| `createRaceRoom` / `joinRace` | bloque les mises en séquestre |
| `settleRace` | paie 60/25/10/5 sur un classement signé (au moins 2 joueurs classés) |
| `refundRace` | rend les mises si la course n'est pas réglée après 1 h (marche même en pause) |
| `closeSeason` | l'admin paie le pot selon un classement signé, après la fin de la saison |
| `pause` / `unpause`, `setSigner`, `withdrawTreasury`, rôles | administration (AccessControl) |

Sécurité : OpenZeppelin 5 uniquement, `nonReentrant`, motif « pull » pour les paiements, erreurs personnalisées, un événement par
changement d'état. Preuves : 91 tests (unitaires, fuzz, invariants), rapport [GAS.md](GAS.md), rapport [Slither](security/SLITHER.md),
[modèle de menaces](security/THREAT_MODEL.md).

## 6. Réseaux : Hardhat et Sepolia

| | Hardhat local (31337) | Sepolia (11155111) |
|---|---|---|
| Usage | développement et tests | démonstration publique |
| Vitesse | instantanée | ~12 s par bloc |
| ETH | 10 000 par compte, gratuit | ETH de test à obtenir |
| Persistance | **aucune** : tout est en mémoire | permanente |
| Saut de temps | oui (`evm_increaseTime`) | non |

### Savoir sur quel réseau on pointe
Trois éléments doivent désigner **le même réseau** :

| Où | Local | Sepolia |
|---|---|---|
| Site (`web/`) | `web/.env.local` (écrit par `deploy:local`) ; `npm run dev:web` | `web/.env.sepolia.local` ; `cd web && npm run dev -- --mode sepolia` |
| Serveur (`server/`) | `server/.env` (écrit par `deploy:local`) | `server/.env.sepolia` : `cd server && set -a && . ./.env.sepolia && set +a && npm run dev` |
| MetaMask | réseau « Localhost » (RPC `http://127.0.0.1:8545`, chaîne 31337) | Sepolia |

Contrôles : le badge « Hardhat » ou « Sepolia » en haut à droite du site, `http://localhost:8787/health` (chaîne, adresses, signataire),
et le réseau affiché dans MetaMask. Chaque réseau a son **propre dossier de données** serveur (`DATA_DIR`).

### Contrats Sepolia (déployés le 2 novembre 2026, vérifiés)
| Contrat | Adresse |
|---|---|
| ForgeCoin | [`0x5d40434c1B59F4f2Be0B986373C074571133421e`](https://sepolia.etherscan.io/address/0x5d40434c1B59F4f2Be0B986373C074571133421e#code) |
| LevelNFT | [`0xC040D6E51e6e59f1764Bc30c1Cf5fB40E4736f09`](https://sepolia.etherscan.io/address/0xC040D6E51e6e59f1764Bc30c1Cf5fB40E4736f09#code) |

| Rôle | Adresse |
|---|---|
| Déployeur = `DEFAULT_ADMIN_ROLE` sur les deux contrats | `0x8dCD4c4a548605C01dff3Fb81861cF1b82d1DfcD` |
| Signataire du serveur | `0xE68E255Da112d8Bbac3C477207F28aFbb9747129` |

Bloc de déploiement : 12048731 (`INDEXER_START_BLOCK`). Vérifications possibles sur la chaîne : `ForgeCoin.levelNFT()` = l'adresse de
LevelNFT, `signer()` = le signataire, `season()` = 1, `cap()` = 100 M, `LevelNFT.hasRole(GAME_ROLE, ForgeCoin)` = vrai. Redéployer :
`cd contracts && npm run deploy:sepolia` (variables dans `contracts/.env.example`). La clé privée du signataire ne vit que dans
`server/.env.sepolia`, jamais dans git.

## 7. Où sont stockées les données, et pourquoi tout « repart » à l'arrêt

| Donnée | Où | Quand on arrête et relance |
|---|---|---|
| Chaîne Hardhat : soldes, contrats, niveaux NFT | **mémoire** du nœud | **perdue** : retour au bloc 0, il faut redéployer |
| Chaîne Sepolia | la blockchain publique | permanente |
| Code source vérifié et ABI sur Sepolia | Etherscan, Sourcify, Blockscout | permanent ; n'importe qui peut lire le contrat sans nous faire confiance |
| Adresses déployées | `contracts/ignition/deployments/chain-<id>/` | conservées (en local, `deploy:local` les remet à zéro) |
| Indexeur, empreintes de parties, miniatures, JSON IPFS locaux | disque : `server/data/<dossier>` | **conservés**, donc périmés après un nouveau déploiement local |
| ABI | `web/src/contracts/generated/`, `server/abi/` | générés, ne jamais les éditer à la main |
| Nonce et activité MetaMask | navigateur | conservés, à effacer après un redéploiement local |

La règle d'or après chaque redémarrage de la chaîne locale : redéployer, supprimer `server/data/local-*`, relancer le serveur,
effacer l'activité MetaMask (procédure exacte dans [TESTING.md](TESTING.md)).

## 8. Le jeu : comment on retrouve « Mario Maker »

Le code et le moteur de Nintendo ne sont pas utilisés. On reconstruit la sensation de jeu.
- **Moteur** : Phaser 3.90 pour l'affichage, Matter.js pour les collisions, simulation à pas fixe de **60 Hz**.
- **Mouvement façon Mario** : [`game-core/src/constants.ts`](../game-core/src/constants.ts) (vitesses, accélérations, seuils de saut, gravité
  maintenue ou lourde, coyote time, tampon de saut, rebond d'ennemi). Calculs en **virgule fixe** : le même niveau et les mêmes
  entrées donnent toujours le même résultat, donc le serveur peut valider une partie.
- **Éléments** : un registre ([`game-core/src/elements/`](../game-core/src/elements), voir [ELEMENTS.md](../game-core/docs/ELEMENTS.md)) :
  chaque élément est une donnée du niveau plus une règle de jeu.
- **Niveau** : un JSON `level.v1.json`, hashé en JSON canonique (le même hash côté web et serveur, vecteur de test partagé).
- **Éditeur** : une scène Phaser qui produit ce JSON ; le « clear check » rejoue le niveau avant la publication.
- **Parties enregistrées** : les entrées sont stockées en masques de bits par image : base de la validation et des rejeux.
- **Graphismes** : deux packs interchangeables (`VITE_ASSET_PACK`) : `mario` (sprites Nintendo, **démo de classe, dépôt privé uniquement**)
  et `kenney` (CC0, publiable). Aucun code Nintendo, aucune image générée par IA.

## 9. Commandes de référence (racine du dépôt)

| Commande | Effet |
|---|---|
| `npm run setup` | installe les dépendances des 4 projets |
| `npm run dev:chain` | nœud Hardhat sur :8545 |
| `npm run deploy:local` | compile, déploie, exporte les ABI, écrit `web/.env.local` et `server/.env` |
| `npm run dev:server` | API :8787 + salles :2567 + indexeur |
| `npm run dev:web` | site sur http://localhost:8080 (8081 si 8080 est pris) |
| `npm test` | les 4 suites de tests |
| `npm run e2e:chain` / `e2e:race` / `e2e:season` | scénarios scriptés sur la chaîne locale |
| `cd contracts && npx hardhat test --gas-stats` | rapport de gaz |

## 10. Limites connues et prochaines étapes
- Le signataire est centralisé (voir le modèle de menaces) ; un robot qui perturbe légèrement sa trace passe encore le contrôle anti-doublon.
- Le faucet pourrait exiger une réclamation signée par le serveur (déjà envisagé, non fait).
- L'éditeur « Test » avec écran noir n'a jamais pu être reproduit (voir la console du navigateur si cela arrive).
- Le détail de ce qui reste à faire est dans [CHECKLIST.md](CHECKLIST.md).

## 11. Index des documents

| Document | Contenu |
|---|---|
| [GUIDE.md](GUIDE.md) | ce document |
| [TESTING.md](TESTING.md) | comment tester, étape par étape |
| [SPEC.md](SPEC.md), [RealmForge_Spec.pdf](RealmForge_Spec.pdf) | cahier des charges |
| [CHECKLIST.md](CHECKLIST.md) | avancement (à tenir à jour) |
| [SEASONS.md](SEASONS.md) | règles de classement des saisons |
| [GAS.md](GAS.md) | coût en gaz des fonctions, L1 contre L2 |
| [security/SLITHER.md](security/SLITHER.md), [security/THREAT_MODEL.md](security/THREAT_MODEL.md) | analyse statique, menaces et mitigations |
| `mockups/` | maquettes de l'interface |
| `contracts/README.md`, `server/README.md`, `web/README.md`, `game-core/README.md` | détails de chaque dossier |
