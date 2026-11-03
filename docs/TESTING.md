# RealmForge — tester, étape par étape

À lire quand tu veux tester. Pour comprendre les règles et l'architecture : [GUIDE.md](GUIDE.md).

## Quel test pour quel besoin ?

| Je veux… | Je fais… | Durée |
|---|---|---|
| Vérifier que rien n'est cassé après un changement | section **A** (suites de tests) | 2 min |
| Rejouer le parcours sans navigateur | section **B** (scripts) | 3 min |
| Faire la démo complète avec MetaMask | sections **C** puis **D** | 30-40 min |
| Tester en public sur Sepolia | section **E** | 20 min |
| Tout remettre à zéro | section **F** | 1 min |

## A. Suites de tests (aucune chaîne à lancer)

À la racine du dépôt :
```bash
npm test                      # game-core + contracts + server + web
```
ou un dossier à la fois : `cd contracts && npx hardhat test`, `cd server && npm test`, `cd web && npm test && npx tsc --noEmit`.
Valeurs attendues à ce jour : contrats **91 réussis** (2 `todo` du contrat de LevelNFT), serveur 56, web 63, game-core 87.

## B. Scripts de bout en bout (chaîne locale, sans navigateur)

Démarre la chaîne et le serveur comme en **C.1**, puis dans l'ordre :
```bash
npm run e2e:chain    # faucet → publication → partie validée → règlement (approve et permit)
npm run e2e:race     # course : séquestre, classement signé, 60/25/10/5, résultat expiré refusé, remboursement
npm run e2e:season   # classement de saison signé par le serveur, accepté par closeSeason
```
Chaque script doit finir sans erreur. **Ne mélange pas ces scripts et un test manuel sur la même chaîne** : ils publient le niveau 1
et avancent l'horloge. Après les scripts, refais **F** avant un test manuel.

## C. Test manuel complet (chaîne locale)

### C.1 Démarrage à froid (toujours dans cet ordre)
Trois terminaux à la racine du dépôt. Si quelque chose tourne déjà, arrête-le avec Ctrl+C.

| Terminal | Commande | Attendu |
|---|---|---|
| 1 | `npm run dev:chain` | nœud sur :8545, liste de comptes et clés (publiques, de test) |
| 2 | `npm run deploy:local` | adresses affichées, `web/.env.local` et `server/.env` réécrits |
| 2 | `rm -rf server/data/local-*` | supprime l'ancienne base de l'indexeur |
| 2 | `npm run dev:server` | API :8787, salles :2567 |
| 3 | `npm run dev:web` | site sur http://localhost:8080 (ou 8081 si 8080 est pris : lis l'URL affichée) |

Pourquoi la suppression : le dossier de données porte le même nom après un redéploiement, donc l'ancienne base (niveaux fantômes,
indexeur trop avancé) serait réutilisée.

### C.2 Préparer MetaMask
1. Ajoute le réseau : RPC `http://127.0.0.1:8545`, chaîne `31337`, symbole `ETH`.
2. Importe trois comptes avec les clés affichées par `dev:chain` et **renomme-les** :

| Nom | Compte Hardhat | Adresse | Rôle |
|---|---|---|---|
| Admin | #0 | `0xf39F…2266` | déploie, clôture la saison |
| Creator | #2 | `0x3C44…93BC` | publie le niveau |
| Player | #3 | `0x90F7…b906` | joue |

   (#1 est la clé du serveur : ne pas l'importer.)
3. Pour **chaque** compte : MetaMask → Paramètres → Avancé → **Effacer les données d'activité et de nonce**. Sinon : erreur « nonce too high » après un redémarrage de la chaîne.
4. Vérifie l'adresse réellement affichée avant chaque étape : un compte mal nommé fausse les résultats.

### C.3 Contrôles avant de commencer
| Contrôle | Attendu |
|---|---|
| `http://localhost:8787/health` | chaîne 31337, les adresses de `deploy:local` |
| `http://localhost:8787/levels` | liste vide |
| Site, recharge dure (Cmd+Maj+R) | badge « Hardhat », « Levels published » à 0 |

## D. Scénario de démo

Suivi des soldes (tout le monde commence à 100 après le faucet). Frais du niveau : **10 FORGE**, parties sans pièce ramassée.

| # | Qui | Action | Attendu |
|---|---|---|---|
| 1 | Admin, Creator, Player | Connecte-toi, **Get 100 FORGE** ; reclique | 100 FORGE chacun ; le 2ᵉ clic est refusé (« already claimed ») |
| 2 | Creator | Éditeur : niveau court avec départ et arrivée, **Test**, atteins l'arrivée (touche tous les checkpoints) | clear check validé, miniature générée |
| 3 | Creator | **Publish**, frais 10 | « Published », le niveau apparaît dans Browse → New en quelques secondes |
| 4 | Player | Joue et termine le niveau, puis **Validate run** → **Authorise the play fee** → settle (une signature, une transaction) | « Run settled on-chain ». Player **125**, Creator **107**, pot de saison 2 |
| 5 | Player | Rejoue une vraie nouvelle partie et règle | Player **120** (−10 de frais, +5), Creator **114**, pot 4. (Valider deux fois la *même* partie : « run already submitted ») |
| 6 | Creator | Joue son propre niveau et règle | Creator **111** (−10 +7, aucune récompense), pot 6 |
| 7 | Admin | Joue et règle | Admin **95** (frais −10, récompense +5), ou **105** s'il bat le record de temps ; Creator **118**, pot 8 |
| 8 | Creator | Lister le NFT (marché) puis un autre compte l'achète | NFT transféré ; le nouveau propriétaire touche désormais les 7 FORGE par partie *(dépend du contrat de LevelNFT)* |

Pour chaque règlement, la trésorerie garde 0,5 et 0,5 est brûlé. Ces deux montants et le pot de saison ne sont **pas** sur la page Profil : lis-les dans le contrat (chaîne locale en marche) :
```bash
cd web && node --input-type=module -e "
import { createPublicClient, http, formatEther, parseAbi } from 'viem';
const F = '0x5FbDB2315678afecb367f032d93F642f64180aa3';  // ForgeCoin, voir /health
const c = createPublicClient({ transport: http('http://127.0.0.1:8545') });
const abi = parseAbi(['function treasuryBalance() view returns (uint256)','function seasonPool() view returns (uint256)','function totalSupply() view returns (uint256)','event FeeBurned(uint256 indexed levelId, uint256 amount)']);
const r = (fn) => c.readContract({ address: F, abi, functionName: fn }).then(formatEther);
console.log('treasury', await r('treasuryBalance'), '| pot de saison', await r('seasonPool'), '| offre totale', await r('totalSupply'));
const logs = await c.getLogs({ address: F, event: abi[3], fromBlock: 0n });
console.log('brûlé', formatEther(logs.reduce((s, l) => s + l.args.amount, 0n)), 'sur', logs.length, 'règlements');
"
```
Attendu après 4 règlements : trésorerie 2, brûlé 2, pot de saison 8.

### D.1 Course (deux navigateurs en parallèle)
Avant de jouer, vérifie que la page affiche le badge vert **LIVE** (et « Ping 32ms ») : un badge « Demo lobby » veut dire que tu es dans une salle de démonstration (faux joueurs, niveau d'exemple, pas de **Give up**), pas dans une vraie course. Les boutons **Respawn (R)** et **Give up** sont en haut de la zone de jeu, à côté du nom du niveau, pendant la course.
Utilise deux profils Chrome (ou une fenêtre privée) avec MetaMask, un compte par fenêtre : Player et Admin. Mise 5 FORGE chacun, cagnotte **10**.

| # | Scénario | Attendu |
|---|---|---|
| R1 | Player : Race → nouvelle course, niveau 1, mise 5, **Create room** ; Admin rejoint avec le code et mise 5 ; les deux « Ready » | départ après le décompte |
| R2 | Les deux atteignent l'arrivée | **Settle on-chain** : 1er **+6**, 2ᵉ **+2,5**, propriétaire **+1**, pot de saison **+0,5** |
| R3 | Un finit, l'autre clique **Give up** | la course s'arrête tout de suite, règlement possible |
| R4 | Un joueur tombe, clique **Respawn (R)** | réapparition au départ ou au dernier checkpoint, arrivée acceptée |
| R5 | Personne ne finit, tout le monde **Give up** | le plus avancé gagne ; règlement possible |
| R6 | Joueur sans mise | bouton « Join and escrow », il ne peut pas être Ready |
| R7 | Rejoindre après le départ | refusé (« match already started ») |
| R8 | Régler deux fois | refusé (`RaceNotOpen`) |
| R9 | Course jamais réglée | **Refund all stakes** après 1 h (voir le saut de temps ci-dessous) : chaque mise rendue |

### D.2 Saison
1. Après les parties, la page **Season** doit lister les joueurs et créateurs avec leurs points et le prix prévu.
2. La clôture est impossible avant 30 jours. Saute le temps (voir ci-dessous), puis **Admin** clique **Close season**.
3. Vérifie : `SeasonClosed`, chaque gagnant reçoit `pot × part / 10 000` (arrondi vers le bas), la saison passe à 2, un compte non admin est refusé.

### D.3 Sauter le temps (chaîne locale uniquement)
```bash
curl -s -X POST localhost:8545 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"evm_increaseTime","params":[3601]}'
curl -s -X POST localhost:8545 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":2,"method":"evm_mine","params":[]}'
```
`3601` pour le remboursement d'une course, `2592005` pour la saison (30 jours). **À faire en dernier** : les signatures du serveur et les
permits expirent selon l'horloge réelle, donc après un saut toute nouvelle partie ou course échoue (« signature expired »). Pour rejouer
après un saut, redémarre la chaîne (**F**).

### D.4 Contrôles de sécurité (bonus pour l'oral)
- Régler deux fois le même résultat signé : `NonceAlreadyUsed` (couvert par les tests du contrat).
- Attendre plus d'une heure entre la validation et le règlement : `SignatureExpired`.
- Un autre compte tente de régler le résultat d'un joueur : `NotRunPlayer`.
- L'admin appelle `pause()` : les parties et courses s'arrêtent, un remboursement reste possible.

## E. Sur Sepolia

Prérequis : deux ou trois comptes MetaMask avec ~0,02 ETH de test chacun ; la clé du signataire dans `server/.env.sepolia`.
```bash
cd server && set -a && . ./.env.sepolia && set +a && npm run dev     # terminal 1
cd web && npm run dev -- --mode sepolia                               # terminal 2
```
Contrôles : le badge du site affiche « Sepolia », `http://localhost:8787/health` renvoie la chaîne 11155111, MetaMask est sur Sepolia.
Le scénario D est identique, mais **sans saut de temps** : le remboursement d'une course demande 1 h réelle, la clôture de saison 30 jours.
Les données du serveur sont dans `server/data/sepolia`, séparées du local.

## F. Remise à zéro (fin de session ou avant de recommencer)

1. Ctrl+C dans les trois terminaux ; vérifie qu'il ne reste rien :
   ```bash
   lsof -nP -iTCP:8545,8787,2567,8080,8081 -sTCP:LISTEN
   ```
   (tue les processus restants avec `kill <pid>`).
2. Relance depuis **C.1** : chaîne, `deploy:local`, `rm -rf server/data/local-*`, serveur, site.
3. Efface l'activité de chaque compte dans MetaMask (**C.2**, point 3).

## G. Si ça échoue

| Symptôme | Cause probable |
|---|---|
| Faucet ou transaction : « The contract rejected the transaction (RPC) » | nonce MetaMask périmé après un redémarrage (efface l'activité), ou mauvaise chaîne |
| Le niveau publié n'apparaît pas dans Browse | indexeur resté sur l'ancienne chaîne : `rm -rf server/data/local-*`, relance le serveur |
| « Levels published 1 » alors que tu viens de redéployer | idem : base de données périmée |
| Publish : « The editor did not return a snapshot » | rare ; recharge l'éditeur et refais le test |
| Clear check : « not all checkpoints reached before goal » | touche tous les checkpoints avant l'arrivée, ou construis un niveau sans checkpoint |
| Clic sur **Test** : écran noir | problème connu, jamais reproduit : note la première erreur rouge de la console (F12) et la version du navigateur |
| Settle : `InvalidSignature` | site et serveur ne pointent pas vers les mêmes contrats : compare `/health` et `web/.env.local` |
| Settle : « run already submitted » | tu as validé deux fois la même partie ; rejoue le niveau |
| « Contracts are not deployed on this network » | mauvais réseau dans MetaMask ou `web/.env.local` absent |
| `FaucetBudgetExhausted` | le faucet ne mint que 10 000 FORGE par jour UTC pour tout le monde |
| Course : la création échoue | recharge la page (Cmd+Maj+R), vérifie que le niveau choisi existe |
| Toute nouvelle partie « signature expired » | tu as sauté le temps : redémarre la chaîne (**F**) |

### Quoi me renvoyer en cas de blocage
1. Le numéro de l'étape et le message exact affiché.
2. La console du navigateur (F12), la ligne qui commence par `[tx:…]`.
3. Les dernières lignes des terminaux `dev:chain` et `dev:server`.
4. L'adresse affichée dans MetaMask (début et fin) et ce que renvoie `/health`.
