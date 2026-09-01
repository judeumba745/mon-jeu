
const express = require('express');
const path = require('path');
const http = require('http');
const {
    Server
} = require('socket.io');
const schedule = require('node-schedule');
const crypto = require('crypto');
const {
    Pool
} = require('pg');
const FORCE_OPEN = false;
/*========================================================CONFIGURATION DES POINTS========================================================Modifie seulement ces nombres si nécessaire.*/
const GAME_COSTS = {
    dame: 100, morpion: 100, echecs: 100, puissance4: 100
};
const TOURNAMENT_COST = 3000;
function calculerCommissionTournoi(nombreJoueurs) {
    let joueursCommission;
    if (nombreJoueurs > 500) {
        joueursCommission = 15;
    } else if (nombreJoueurs > 100) {
        joueursCommission = 8;
    } else if (nombreJoueurs > 30) {
        joueursCommission = 5;
    } else {
        joueursCommission = 3;
    } return joueursCommission * TOURNAMENT_COST;
}
/*Nombre maximum de points qu'un joueur peut recevoircomme gain automatiquement pour une partie.À adapter ensuite selon tes règles.*/
const GAME_WIN_REWARDS = {
    dame: 200, morpion: 200, echecs: 200, puissance4: 200
};
/*Clé administrateur.Sur Render par exemple :ADMIN_KEY=ton_mot_de_passe_adminEn local tu peux mettre une valeur temporaire.*/
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE-MOI-ADMIN';
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? {
        rejectUnauthorized: false
    } : false
});
/*========================================================SECURITE DES PARTIES========================================================*/
const GAME_SECURITY = {
    dame: {
        cost: GAME_COSTS.dame, reward: GAME_WIN_REWARDS.dame
    }, morpion: {
        cost: GAME_COSTS.morpion, reward: GAME_WIN_REWARDS.morpion
    }, echecs: {
        cost: GAME_COSTS.echecs, reward: GAME_WIN_REWARDS.echecs
    }, puissance4: {
        cost: GAME_COSTS.puissance4, reward: GAME_WIN_REWARDS.puissance4
    }, voiture: {
        cost: 100, reward: 500
    }, cheval: {
        cost: 100, reward: 500
    }
};
/*--------------------------------------------------------ID UNIQUE--------------------------------------------------------*/
function generateGameId() {
    return crypto.randomUUID();
}function generateActionId() {
    return crypto.randomUUID();
}
/*--------------------------------------------------------VERIFIER LE JEU--------------------------------------------------------*/
function getSecureGameConfig(gameType) {
    const game = String(gameType || '') .toLowerCase() .trim();
    const config = GAME_SECURITY[game];
    if (!config) {
        throw new Error('Jeu non autorisé');
    } return {
        game, cost: Number(config.cost), reward: Number(config.reward)
    };
}
/*--------------------------------------------------------TROUVER JOUEUR--------------------------------------------------------*/
function findPlayerByToken(token) {
    if (!token) return null;
    return fullGamePlayers.find( p => String(p.id) === String(token) ) || null;
}
/*--------------------------------------------------------VERIFICATION JOUEUR--------------------------------------------------------*/
async function getAuthenticatedPlayer(token) {
    const player = findPlayerByToken(token);
    if (!player) {
        throw new Error('Utilisateur non reconnu');
    } if (!player.phone) {
        throw new Error( 'Numéro de téléphone manquant' );
    } const phone = normalizePhone(player.phone);
    if (!validatePhone(phone)) {
        throw new Error( 'Numéro de téléphone invalide' );
    } await ensureWallet(player);
    return {
        player, phone
    };
}
/*--------------------------------------------------------CREER UNE PARTIE UNIQUE--------------------------------------------------------*/
async function createSecureGame({
    token, gameType, mode = 'player'
}) {
    const {
        player, phone
    } = await getAuthenticatedPlayer(token);
    const config = getSecureGameConfig(gameType);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        /* Verrouille le portefeuille pendant la création de la partie. */
        const walletResult = await client.query( ` SELECT * FROM player_wallets WHERE phone = $1 FOR UPDATE `, [phone] );
        if (!walletResult.rowCount) {
            throw new Error( 'Portefeuille introuvable' );
        } const wallet = walletResult.rows[0];
        /* EMPÊCHE LE JOUEUR DE CREER UNE DEUXIEME PARTIE ACTIVE */
        const activeResult = await client.query( ` SELECT id FROM game_sessions WHERE player_id = $1 AND game_type = $2 AND status = 'active' LIMIT 1 `, [ String(player.id), config.game ] );
        if (activeResult.rowCount > 0) {
            throw new Error( 'Tu as déjà une partie active pour ce jeu' );
        }
        /* Vérification du solde */
        if ( Number(wallet.points) < config.cost ) {
            throw new Error( 'Points insuffisants' );
        }
        /* ID UNIQUE DE PARTIE */
        const gameId = generateGameId();
        /* RETRAIT DE LA MISE */
        const updateWallet = await client.query( ` UPDATE player_wallets SET points = points - $1, total_spent = total_spent + $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2 AND points >= $1 RETURNING * `, [ config.cost, phone ] );
        if ( updateWallet.rowCount !== 1 ) {
            throw new Error( 'Impossible de retirer la mise' );
        }
        /* HISTORIQUE */
        await client.query( ` INSERT INTO point_transactions ( phone, type, points, reason ) VALUES ( $1, 'debit', $2, $3 ) `, [ phone, config.cost, `Mise ${config.game}` ] );
        /* CREATION PARTIE */
        await client.query( ` INSERT INTO game_sessions ( id, player_id, phone, game_type, mode, stake, reward, status ) VALUES ( $1, $2, $3, $4, $5, $6, $7, 'active' ) `, [ gameId, String(player.id), phone, config.game, mode, config.cost, config.reward ] );
        await client.query('COMMIT');
        await emitWalletUpdate(phone);
        return {
            gameId, gameType: config.game, stake: config.cost, reward: config.reward, playerId: String(player.id), remainingPoints: Number( updateWallet.rows[0].points )
        };
    } catch (err) {
        await client.query( 'ROLLBACK' );
        throw err;
    } finally {
        client.release();
    }
}
/*--------------------------------------------------------RECUPERER UNE PARTIE--------------------------------------------------------*/
async function getSecureGame(gameId) {
    const result = await pool.query( ` SELECT * FROM game_sessions WHERE id = $1 `, [gameId] );
    return result.rows[0] || null;
}
/*--------------------------------------------------------VERIFIER QUE LA PARTIE APPARTIENT AU JOUEUR--------------------------------------------------------*/
async function authorizeGamePlayer( gameId, token) {
    const player = findPlayerByToken(token);
    if (!player) {
        throw new Error( 'Utilisateur non reconnu' );
    } const game = await getSecureGame(gameId);
    if (!game) {
        throw new Error( 'Partie introuvable' );
    } if ( String(game.player_id) !== String(player.id) ) {
        /* Le joueur ne peut jamais utiliser la partie d'un autre. */
        throw new Error( 'Accès à cette partie refusé' );
    } if ( game.status !== 'active' ) {
        throw new Error( 'Cette partie est déjà terminée' );
    } return {
        game, player
    };
}
/*--------------------------------------------------------FERMER UNE PARTIE SANS GAIN--------------------------------------------------------*/
async function cancelSecureGame( gameId, token) {
    const {
        game
    } = await authorizeGamePlayer( gameId, token );
    const result = await pool.query( ` UPDATE game_sessions SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'active' RETURNING * `, [game.id] );
    return result.rows[0] || null;
}
/*--------------------------------------------------------PAYER UN GAGNANT UNE SEULE FOIS--------------------------------------------------------*/
async function finishSecureGame({
    gameId, winnerPlayerId, result = 'win'
}) {
    const client = await pool.connect();
    try {
        await client.query( 'BEGIN' );
        /* VERROUILLAGE DE LA PARTIE Cela empêche deux requêtes simultanées de payer deux fois. */
        const gameResult = await client.query( ` SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE `, [gameId] );
        if ( gameResult.rowCount === 0 ) {
            throw new Error( 'Partie introuvable' );
        } const game = gameResult.rows[0];
        /* Partie déjà terminée */
        if ( game.status !== 'active' ) {
            await client.query( 'ROLLBACK' );
            return {
                alreadyFinished: true, game
            };
        }
        /* Vérification gagnant */
        if ( result === 'win' && String( winnerPlayerId ) !== String( game.player_id ) ) {
            /* Le serveur ne paie jamais un joueur qui n'est pas autorisé à recevoir ce gain. */
            throw new Error( 'Gagnant non autorisé' );
        }
        /* MATCH NUL */
        if (result === 'draw') {
            await client.query( ` UPDATE game_sessions SET status = 'finished', result = 'draw', finished_at = CURRENT_TIMESTAMP WHERE id = $1 `, [gameId] );
            await client.query( 'COMMIT' );
            return {
                alreadyFinished: false, result: 'draw', reward: 0
            };
        }
        /* GAIN */
        const reward = Number(game.reward);
        if ( !Number.isInteger(reward) || reward <= 0 ) {
            await client.query( ` UPDATE game_sessions SET status = 'finished', result = 'win', winner_player_id = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1 `, [ gameId, String(winnerPlayerId) ] );
            await client.query( 'COMMIT' );
            return {
                alreadyFinished: false, result: 'win', reward: 0
            };
        }
        /* PAIEMENT ATOMIQUE */
        const walletResult = await client.query( ` UPDATE player_wallets SET points = points + $1, total_won = total_won + $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2 RETURNING * `, [ reward, game.phone ] );
        if ( walletResult.rowCount !== 1 ) {
            throw new Error( 'Portefeuille introuvable' );
        }
        /* HISTORIQUE DU GAIN */
        await client.query( ` INSERT INTO point_transactions ( phone, type, points, reason ) VALUES ( $1, 'win', $2, $3 ) `, [ game.phone, reward, `Gain ${game.game_type}` ] );
        /* MARQUER LA PARTIE COMME TERMINEE ET PAYEE */
        await client.query( ` UPDATE game_sessions SET status = 'finished', result = 'win', winner_player_id = $2, payout_done = TRUE, finished_at = CURRENT_TIMESTAMP WHERE id = $1 `, [ gameId, String(winnerPlayerId) ] );
        await client.query( 'COMMIT' );
        await emitWalletUpdate( game.phone );
        return {
            alreadyFinished: false, result: 'win', reward, wallet: walletResult.rows[0]
        };
    } catch (err) {
        await client.query( 'ROLLBACK' );
        throw err;
    } finally {
        client.release();
    }
} pool.connect() .then(() => console.log('✅ Connecté à Postgres')) .catch(err => console.error('❌ Erreur Postgres:', err));
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*'
    }
});
let liveMatches = {
};
let fullGamePlayers = [];
const accounts = new Map();
const onlineUsers = new Map();
/*========================================================INITIALISATION DATABASE========================================================*/
async function initializeDatabase() {
    try {
        await pool.query(` CREATE TABLE IF NOT EXISTS player_wallets ( phone VARCHAR(30) PRIMARY KEY, player_id TEXT, firstname VARCHAR(100), name VARCHAR(100), points BIGINT NOT NULL DEFAULT 0, total_added BIGINT NOT NULL DEFAULT 0, total_spent BIGINT NOT NULL DEFAULT 0, total_won BIGINT NOT NULL DEFAULT 0, total_paid BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ) `);
        await pool.query(` CREATE TABLE IF NOT EXISTS point_transactions ( id BIGSERIAL PRIMARY KEY, phone VARCHAR(30) NOT NULL, type VARCHAR(30) NOT NULL, points BIGINT NOT NULL, reason TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ) `);
        /*==================================================== SECURITE DES PARTIES ====================================================*/
        await pool.query(` CREATE TABLE IF NOT EXISTS game_sessions ( id UUID PRIMARY KEY, player_id TEXT NOT NULL, phone VARCHAR(30) NOT NULL, game_type VARCHAR(30) NOT NULL, mode VARCHAR(30) NOT NULL DEFAULT 'player', stake BIGINT NOT NULL, reward BIGINT NOT NULL DEFAULT 0, status VARCHAR(30) NOT NULL DEFAULT 'active', winner_player_id TEXT, result VARCHAR(30), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, finished_at TIMESTAMP, payout_done BOOLEAN NOT NULL DEFAULT FALSE, last_action_id UUID, action_count INTEGER NOT NULL DEFAULT 0 ) `);
        await pool.query(` CREATE UNIQUE INDEX IF NOT EXISTS unique_active_game_per_player ON game_sessions(player_id, game_type) WHERE status = 'active' `);
        console.log('✅ Tables de points prêtes');
        console.log('✅ Tables de sécurité des parties prêtes');
    } catch (err) {
        console.error( '❌ Erreur création tables:', err );
    }
}initializeDatabase();
/*========================================================EXPRESS========================================================*/
app.use(express.json());
app.use(express.static('public', {
    maxAge: '1'
}));
app.use(express.static(__dirname, {
    maxAge: '1'
}));
/*========================================================UTILITAIRES POINTS========================================================*/
function normalizePhone(phone) {
    if (!phone) return '';
    return String(phone) .replace(/\s+/g, '') .replace(/-/g, '');
}function validatePhone(phone) {
    const cleaned = normalizePhone(phone);
    return /^\+?[0-9]{8,15}$/.test(cleaned);
}function getGameCost(gameType) {
    return GAME_COSTS[String(gameType || '').toLowerCase()] || 0;
}function getGameReward(gameType) {
    return GAME_WIN_REWARDS[String(gameType || '').toLowerCase()] || 0;
}function requireAdmin(req, res, next) {
    const key = req.headers['x-admin-key'] || req.body.adminKey || req.query.adminKey;
    if (!key || key !== ADMIN_KEY) {
        return res.status(403).json({
            success: false, error: 'Accès administrateur refusé'
        });
    } next();
}
/*========================================================WALLET========================================================*/
async function ensureWallet(player) {
    const phone = normalizePhone(player.phone);
    if (!phone) {
        throw new Error('Numéro de téléphone manquant');
    } await pool.query(` INSERT INTO player_wallets ( phone, player_id, firstname, name ) VALUES ($1,$2,$3,$4) ON CONFLICT (phone) DO UPDATE SET player_id = COALESCE(EXCLUDED.player_id, player_wallets.player_id), firstname = COALESCE(EXCLUDED.firstname, player_wallets.firstname), name = COALESCE(EXCLUDED.name, player_wallets.name), updated_at = CURRENT_TIMESTAMP `, [ phone, String(player.id || ''), player.firstname || '', player.name || '' ]);
    return phone;
}async function getWallet(phone) {
    const cleaned = normalizePhone(phone);
    if (!cleaned) {
        return null;
    } const result = await pool.query(` SELECT phone, player_id, firstname, name, points, total_added, total_spent, total_won, total_paid, created_at, updated_at FROM player_wallets WHERE phone = $1 `, [cleaned]);
    return result.rows[0] || null;
}async function addPoints(phone, amount, reason = 'Crédit de points') {
    const cleaned = normalizePhone(phone);
    const points = Number(amount);
    if (!cleaned) {
        throw new Error('Numéro de téléphone invalide');
    } if (!Number.isInteger(points) || points <= 0) {
        throw new Error('Nombre de points invalide');
    } const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(` UPDATE player_wallets SET points = points + $1, total_added = total_added + $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2 RETURNING * `, [points, cleaned]);
        if (result.rowCount === 0) {
            throw new Error('Joueur introuvable');
        } await client.query(` INSERT INTO point_transactions ( phone, type, points, reason ) VALUES ($1,$2,$3,$4) `, [ cleaned, 'credit', points, reason ]);
        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}async function spendPoints(phone, amount, reason = 'Partie') {
    const cleaned = normalizePhone(phone);
    const points = Number(amount);
    if (!cleaned) {
        throw new Error('Numéro de téléphone invalide');
    } if (!Number.isInteger(points) || points <= 0) {
        throw new Error('Nombre de points invalide');
    } const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(` UPDATE player_wallets SET points = points - $1, total_spent = total_spent + $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2 AND points >= $1 RETURNING * `, [ points, cleaned ]);
        if (result.rowCount === 0) {
            throw new Error('Solde de points insuffisant');
        } await client.query(` INSERT INTO point_transactions ( phone, type, points, reason ) VALUES ($1,$2,$3,$4) `, [ cleaned, 'debit', points, reason ]);
        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}async function giveWinningPoints( phone, amount, reason = 'Gain de partie') {
    const cleaned = normalizePhone(phone);
    const points = Number(amount);
    if (!cleaned) {
        throw new Error('Numéro invalide');
    } if (!Number.isInteger(points) || points <= 0) {
        return null;
    } const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(` UPDATE player_wallets SET points = points + $1, total_won = total_won + $1, updated_at = CURRENT_TIMESTAMP WHERE phone = $2 RETURNING * `, [ points, cleaned ]);
        if (result.rowCount === 0) {
            throw new Error('Joueur introuvable');
        } await client.query(` INSERT INTO point_transactions ( phone, type, points, reason ) VALUES ($1,$2,$3,$4) `, [ cleaned, 'win', points, reason ]);
        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}async function markPointsPaid( phone, amount, reason = 'Gain payé') {
    const cleaned = normalizePhone(phone);
    const points = Number(amount);
    if (!cleaned) {
        throw new Error('Numéro invalide');
    } if (!Number.isInteger(points) || points <= 0) {
        throw new Error('Nombre de points invalide');
    } const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(` UPDATE player_wallets SET total_paid = total_paid + $1, total_won = GREATEST(total_won - $1, 0), updated_at = CURRENT_TIMESTAMP WHERE phone = $2 AND total_won >= $1 RETURNING * `, [ points, cleaned ]);
        if (result.rowCount === 0) {
            throw new Error( 'Le joueur ne possède pas assez de gains à payer' );
        } await client.query(` INSERT INTO point_transactions ( phone, type, points, reason ) VALUES ($1,$2,$3,$4) `, [ cleaned, 'paid', points, reason ]);
        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}async function emitWalletUpdate(phone) {
    const wallet = await getWallet(phone);
    if (!wallet) return;
    io.emit('walletUpdate', {
        phone: wallet.phone, points: Number(wallet.points), totalAdded: Number(wallet.total_added), totalSpent: Number(wallet.total_spent), totalWon: Number(wallet.total_won), totalPaid: Number(wallet.total_paid)
    });
    io.emit('dashboardUpdate');
}
/*========================================================REGISTER CLASSIQUE========================================================*/
app.post('/register', async (req, res) => {
    const {
        username, password
    } = req.body;
    try {
        await pool.query( 'INSERT INTO users (username, password) VALUES ($1, $2)', [username, password] );
        res.json({
            success: 'Compte créé'
        });
    } catch (err) {
        console.error(err);
        res.json({
            error: 'Erreur'
        });
    }
});
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});
/*========================================================PAGES========================================================*/
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/mode.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mode.html')));
app.get('/jeu.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jeu.html')));
app.get('/programme.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'programme.html')));
app.get('/inscription.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inscription.html')));
app.get('/tournoi.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tournoi.html')));
app.get('/Dametournoi.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'Dametournoi.html')));
app.get('/Morpiontournoi.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'Morpiontournoi.html')));
app.get('/Échectournoi.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'Échectournoi.html')));
app.get('/Echectournoi.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'Échectournoi.html')));
app.get('/Puissance4tournoi.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'Puissance4tournoi.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
/*========================================================TOURNOI========================================================*/
let tournament = {
    players: [],
    matches: [],
    status: 'closed',
    currentRound: 0,
    winner: null,
    startedAt: null,
    finalScheduledAt: null
};

const TOURNAMENT_TIMEZONE = 'Africa/Kinshasa';
const TOURNAMENT_FIRST_ROUND_HOUR = 9;
const TOURNAMENT_FIRST_ROUND_MINUTE = 0;
const TOURNAMENT_FINAL_HOUR = 21;
const TOURNAMENT_FINAL_MINUTE = 0;
const MANY_PLAYERS_THRESHOLD = 16;
const MANY_PLAYERS_INTERVAL_MS = 5 * 60 * 60 * 1000;
const FEW_PLAYERS_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MATCH_START_GRACE_MS = 30 * 1000;

function generateAccessCode(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.slice(-4) + Math.floor(Math.random() * 10);
}
function melanger(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
function isPlayerInMatch(match, playerId) {
    return String(match.originalP1?.id || match.p1?.id) === String(playerId) ||
           String(match.originalP2?.id || match.p2?.id) === String(playerId);
}
function timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const min = Math.floor(diff / 60000);
    if (min < 1) return "À l'instant";
    if (min < 60) return `Il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `Il y a ${h}h`;
    return `Il y a ${Math.floor(h / 24)}j`;
}
function inscriptionOuverte() {
    if (FORCE_OPEN) return true;
    const day = new Intl.DateTimeFormat('fr-FR', {
        timeZone: TOURNAMENT_TIMEZONE,
        weekday: 'long'
    }).format(new Date()).toLowerCase();
    return day === 'samedi' || day === 'dimanche';
}
function kinshasaParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TOURNAMENT_TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(date).reduce((a,p) => (a[p.type] = p.value, a), {});
    return parts;
}
function zonedDateTime(year, month, day, hour, minute = 0, second = 0) {
    // Africa/Kinshasa is UTC+1. This project is configured for Kinshasa.
    return new Date(Date.UTC(year, month - 1, day, hour - 1, minute, second));
}
function nextMondayAtFirstRound() {
    const now = new Date();
    const p = kinshasaParts(now);
    const current = new Date(Date.UTC(Number(p.year), Number(p.month)-1, Number(p.day), 0, 0, 0));
    const weekday = new Date(current).getUTCDay();
    let days = (1 - weekday + 7) % 7;
    if (days === 0) {
        const todayRound = zonedDateTime(Number(p.year), Number(p.month), Number(p.day), TOURNAMENT_FIRST_ROUND_HOUR, TOURNAMENT_FIRST_ROUND_MINUTE);
        if (todayRound.getTime() <= Date.now()) days = 7;
    }
    current.setUTCDate(current.getUTCDate() + days);
    const y = current.getUTCFullYear(), m = current.getUTCMonth()+1, d = current.getUTCDate();
    return zonedDateTime(y,m,d,TOURNAMENT_FIRST_ROUND_HOUR,TOURNAMENT_FIRST_ROUND_MINUTE);
}
function fridayFinalOfWeek(fromDate) {
    const p = kinshasaParts(fromDate);
    const current = new Date(Date.UTC(Number(p.year), Number(p.month)-1, Number(p.day), 0, 0, 0));
    const weekday = current.getUTCDay();
    const daysToFriday = (5 - weekday + 7) % 7;
    current.setUTCDate(current.getUTCDate() + daysToFriday);
    return zonedDateTime(current.getUTCFullYear(), current.getUTCMonth()+1, current.getUTCDate(), TOURNAMENT_FINAL_HOUR, TOURNAMENT_FINAL_MINUTE);
}
function countRoundsForPlayers(n) {
    return Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
}
function chooseRoundInterval(playerCount) {
    return playerCount > MANY_PLAYERS_THRESHOLD ? MANY_PLAYERS_INTERVAL_MS : FEW_PLAYERS_INTERVAL_MS;
}
function calculateNextRoundStart(previousStart, remainingPlayers, roundNumber, totalRounds, finalAt) {
    if (roundNumber >= totalRounds) return finalAt;
    const candidate = new Date(previousStart.getTime() + chooseRoundInterval(remainingPlayers));
    const latestAllowed = new Date(finalAt.getTime() - Math.max(1, totalRounds - roundNumber) * 60 * 60 * 1000);
    return candidate.getTime() > latestAllowed.getTime() ? latestAllowed : candidate;
}
function gamePageFor(gameType) {
    return {
        dame: '/Dametournoi.html',
        morpion: '/Morpiontournoi.html',
        echecs: '/Échectournoi.html',
        puissance4: '/Puissance4tournoi.html'
    }[gameType] || '/Dametournoi.html';
}
function chooseGameForPlayers(a, b) {
    const ag = Array.isArray(a.games) && a.games.length ? a.games : ['dame'];
    const bg = Array.isArray(b.games) && b.games.length ? b.games : ['dame'];
    const common = ag.filter(g => bg.includes(g));
    const list = common.length ? common : ag;
    return list[Math.floor(Math.random() * list.length)] || 'dame';
}
function createTournamentAI(label = 'IA') {
    return {
        id: 'AI_' + crypto.randomUUID(),
        firstname: label,
        name: 'Tournoi',
        isAI: true,
        accessCode: 'AI',
        games: ['dame','echecs','morpion','puissance4'],
        gameType: 'dame',
        phone: null,
        eliminated: false,
        status: 'ai'
    };
}

/*============================== ÉTATS DES 4 JEUX ==============================*/
function createInitialDameBoard() {
    const board = Array(100).fill(0);
    for (let i=0;i<100;i++) {
        if (i < 40 && Math.floor(i/10)%2 !== i%2) board[i] = 2;
        else if (i >= 60 && Math.floor(i/10)%2 !== i%2) board[i] = 1;
    }
    return board;
}
function initializeMatchState(match) {
    if (match.gameType === 'dame') {
        match.state = { board: createInitialDameBoard(), currentPlayer: 'red' };
    } else if (match.gameType === 'morpion') {
        match.state = { board: Array(9).fill(null), currentPlayer: 'X' };
    } else if (match.gameType === 'puissance4') {
        match.state = { board: Array.from({length:6}, () => Array(7).fill(null)), currentPlayer: 'red' };
    } else if (match.gameType === 'echecs') {
        match.state = {
            board: ['R','N','B','Q','K','B','N','R','P','P','P','P','P','P','P','P',
                '','','','','','','','', '','','','','','','','', '','','','','','','','',
                '','','','','','','','', 'p','p','p','p','p','p','p','p','r','n','b','q','k','b','n','r'],
            currentPlayer: 'white'
        };
    }
}
function checkMorpionWinner(board) {
    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const [a,b,c] of wins) if (board[a] && board[a]===board[b] && board[a]===board[c]) return board[a];
    return board.every(Boolean) ? 'draw' : null;
}
function morpionAIMove(board, aiSymbol) {
    const human = aiSymbol === 'X' ? 'O' : 'X';
    function minimax(b, player, depth) {
        const w = checkMorpionWinner(b);
        if (w === aiSymbol) return {score: 10-depth};
        if (w === human) return {score: depth-10};
        if (w === 'draw') return {score: 0};
        const moves=[];
        for(let i=0;i<9;i++) if(!b[i]) {
            b[i]=player;
            const r=minimax(b, player===aiSymbol?human:aiSymbol, depth+1);
            moves.push({index:i,score:r.score});
            b[i]=null;
        }
        return moves.reduce((best,m)=> player===aiSymbol ? (m.score>best.score?m:best) : (m.score<best.score?m:best), {index:moves[0]?.index,score:player===aiSymbol?-Infinity:Infinity});
    }
    return minimax(board, aiSymbol, 0).index;
}
function p4Winner(board, r, c, player) {
    const dirs=[[0,1],[1,0],[1,1],[1,-1]];
    for(const [dr,dc] of dirs){
        let count=1;
        for(let k=1;k<4;k++) if(board[r+dr*k]?.[c+dc*k]===player) count++; else break;
        for(let k=1;k<4;k++) if(board[r-dr*k]?.[c-dc*k]===player) count++; else break;
        if(count>=4) return true;
    }
    return false;
}
function p4FreeRow(board,c){ for(let r=5;r>=0;r--) if(!board[r][c]) return r; return -1; }
function p4AIMove(board, ai) {
    for(let c=0;c<7;c++){ const r=p4FreeRow(board,c); if(r<0)continue; board[r][c]=ai; const w=p4Winner(board,r,c,ai); board[r][c]=null; if(w)return c; }
    const human=ai==='red'?'yellow':'red';
    for(let c=0;c<7;c++){ const r=p4FreeRow(board,c); if(r<0)continue; board[r][c]=human; const w=p4Winner(board,r,c,human); board[r][c]=null; if(w)return c; }
    for(const c of [3,2,4,1,5,0,6]) if(p4FreeRow(board,c)>=0) return c;
    return -1;
}
function dameCoords(index){ return {r:Math.floor(index/10), c:index%10}; }
function dameIndex(r,c){ return r*10+c; }
function damePieceColor(v){ return (v===1||v===3)?'red':(v===2||v===4)?'blue':null; }
function dameIsKing(v){ return v===3||v===4; }
function dameMoves(board, color) {
    const moves=[];
    for(let i=0;i<100;i++){
        const piece=board[i]; if(damePieceColor(piece)!==color) continue;
        const {r,c}=dameCoords(i);
        const dirs=[[1,1],[1,-1],[-1,1],[-1,-1]];
        for(const [dr,dc] of dirs){
            if(!dameIsKing(piece) && ((color==='red'&&dr>0)||(color==='blue'&&dr<0))) continue;
            const r1=r+dr,c1=c+dc,r2=r+2*dr,c2=c+2*dc;
            if(r1>=0&&r1<10&&c1>=0&&c1<10&&r1%2!==c1%2&&board[dameIndex(r1,c1)]===0){
                moves.push({from:i,to:dameIndex(r1,c1)});
            }
            if(r2>=0&&r2<10&&c2>=0&&c2<10&&r2%2!==c2%2&&board[dameIndex(r2,c2)]===0){
                const mid=board[dameIndex(r1,c1)];
                if(mid && damePieceColor(mid)!==color) moves.push({from:i,to:dameIndex(r2,c2),capture:dameIndex(r1,c1)});
            }
            if(dameIsKing(piece)){
                // Kings can slide until blocked; add quiet squares and first capture.
                let rr=r+dr,cc=c+dc;
                while(rr>=0&&rr<10&&cc>=0&&cc<10&&rr%2!==cc%2){
                    const idx=dameIndex(rr,cc);
                    if(board[idx]===0) moves.push({from:i,to:idx});
                    else { if(damePieceColor(board[idx])!==color) moves.push({from:i,to:idx,capture:idx}); break; }
                    rr+=dr; cc+=dc;
                }
            }
        }
    }
    const captures=moves.filter(m=>m.capture!==undefined);
    return captures.length?captures:moves;
}
function applyDameMove(match, move, color){
    const b=match.state.board;
    const piece=b[move.from];
    if(!piece || damePieceColor(piece)!==color || b[move.to]!==0) return false;
    const valid=dameMoves(b,color).find(m=>m.from===move.from&&m.to===move.to);
    if(!valid) return false;
    b[move.to]=piece; b[move.from]=0; if(valid.capture!==undefined)b[valid.capture]=0;
    if(piece===1 && Math.floor(move.to/10)===0)b[move.to]=3;
    if(piece===2 && Math.floor(move.to/10)===9)b[move.to]=4;
    match.state.currentPlayer=color==='red'?'blue':'red';
    return true;
}
function chessColor(piece){ if(!piece)return null; return piece===piece.toUpperCase()?'white':'black'; }
function chessPathClear(board,from,to,dx,dy){
    const stepX=Math.sign(dx), stepY=Math.sign(dy); let x=from%8+stepX,y=Math.floor(from/8)+stepY;
    const tx=to%8,ty=Math.floor(to/8);
    while(x!==tx||y!==ty){ if(board[y*8+x])return false; x+=stepX;y+=stepY; } return true;
}
function chessValidMove(board,from,to,color){
    if(from===to||!board[from])return false;
    const p=board[from], pc=chessColor(p); if(pc!==color)return false;
    if(board[to]&&chessColor(board[to])===color)return false;
    const type=p.toLowerCase(), fx=from%8,fy=Math.floor(from/8),tx=to%8,ty=Math.floor(to/8),dx=tx-fx,dy=ty-fy;
    if(type==='p'){
        const dir=color==='white'?-1:1;
        if(dx===0&&dy===dir&&!board[to])return true;
        if(dx===0&&dy===2*dir&&!board[to]&&!board[from+dir*8]) return (color==='white'?fy===6:fy===1);
        return Math.abs(dx)===1&&dy===dir&&!!board[to]&&chessColor(board[to])!==color;
    }
    if(type==='n')return (Math.abs(dx)===2&&Math.abs(dy)===1)||(Math.abs(dx)===1&&Math.abs(dy)===2);
    if(type==='k')return Math.max(Math.abs(dx),Math.abs(dy))===1;
    if(type==='b')return Math.abs(dx)===Math.abs(dy)&&chessPathClear(board,from,to,dx,dy);
    if(type==='r')return (dx===0||dy===0)&&chessPathClear(board,from,to,dx,dy);
    if(type==='q')return (dx===0||dy===0||Math.abs(dx)===Math.abs(dy))&&chessPathClear(board,from,to,dx,dy);
    return false;
}
function chessAllMoves(board,color){
    const out=[]; for(let i=0;i<64;i++)if(board[i]&&chessColor(board[i])===color)for(let j=0;j<64;j++)if(chessValidMove(board,i,j,color))out.push({from:i,to:j}); return out;
}
function chessAIMove(board,color){
    const moves=chessAllMoves(board,color); if(!moves.length)return null;
    const captures=moves.filter(m=>board[m.to]); return (captures.length?captures:moves)[Math.floor(Math.random()*(captures.length?captures.length:moves.length))];
}
function applyChessMove(match,move,color){
    const b=match.state.board; if(!chessValidMove(b,move.from,move.to,color))return false;
    b[move.to]=b[move.from]; b[move.from]='';
    const p=b[move.to]; if(p==='P'&&Math.floor(move.to/8)===0)b[move.to]='Q'; if(p==='p'&&Math.floor(move.to/8)===7)b[move.to]='q';
    match.state.currentPlayer=color==='white'?'black':'white'; return true;
}
function gameWinner(match){
    if(match.gameType==='morpion') return checkMorpionWinner(match.state.board);
    if(match.gameType==='puissance4') return null;
    if(match.gameType==='echecs'){
        if(!match.state.board.includes('K'))return 'black'; if(!match.state.board.includes('k'))return 'white';
        return null;
    }
    if(match.gameType==='dame'){
        const red=match.state.board.some(v=>damePieceColor(v)==='red'); const blue=match.state.board.some(v=>damePieceColor(v)==='blue');
        if(!red)return 'blue'; if(!blue)return 'red';
        if(!dameMoves(match.state.board,match.state.currentPlayer).length)return match.state.currentPlayer==='red'?'blue':'red';
    }
    return null;
}
function colorForSide(match, playerId){
    if(match.gameType==='dame') return String(match.p1.id)===String(playerId)?'red':'blue';
    if(match.gameType==='morpion') return String(match.p1.id)===String(playerId)?'X':'O';
    if(match.gameType==='puissance4') return String(match.p1.id)===String(playerId)?'red':'yellow';
    return String(match.p1.id)===String(playerId)?'white':'black';
}
function aiSide(match){
    if(match.p1?.isAI)return colorForSide(match,match.p1.id);
    if(match.p2?.isAI)return colorForSide(match,match.p2.id);
    return null;
}
function aiMoveOnce(match){
    const side=aiSide(match); if(!side||match.played)return false;
    if(match.state.currentPlayer!==side)return false;
    let move=null;
    if(match.gameType==='morpion'){
        const i=morpionAIMove(match.state.board,side); if(i!==undefined)move={index:i};
        if(move){match.state.board[move.index]=side; match.state.currentPlayer=side==='X'?'O':'X';}
    } else if(match.gameType==='puissance4'){
        const c=p4AIMove(match.state.board,side); const r=p4FreeRow(match.state.board,c); if(c>=0&&r>=0){match.state.board[r][c]=side; match.state.currentPlayer=side==='red'?'yellow':'red';}
    } else if(match.gameType==='dame'){
        const moves=dameMoves(match.state.board,side); if(moves.length){move=moves[Math.floor(Math.random()*moves.length)];applyDameMove(match,move,side);}
    } else if(match.gameType==='echecs'){
        move=chessAIMove(match.state.board,side); if(move)applyChessMove(match,move,side);
    }
    const winner=gameWinner(match);
    if(winner){ finishTournamentMatch(match,winner==='draw'?'draw':winner); return true; }
    if(match.gameType==='puissance4' && match.state.board.every(row=>row.every(Boolean))){ finishTournamentMatch(match,'draw'); return true; }
    io.to(`match-${match.id}`).emit('state', {state:match.state, gameType:match.gameType});
    return true;
}
function scheduleAIMove(match){ setTimeout(()=>{ if(!match.played && match.started) { if(aiMoveOnce(match) && aiSide(match)===match.state.currentPlayer) scheduleAIMove(match); } },700); }

/*============================== PROGRAMMATION DES ROUNDS ==============================*/
function createRoundMatches(players, round, datetime) {
    let list=melanger(players.filter(p=>!p.eliminated));
    const originalCount=list.length;
    if(list.length%2===1) list.push(createTournamentAI());
    const matches=[];
    for(let i=0;i<list.length;i+=2){
        const p1=list[i],p2=list[i+1];
        const gameType=chooseGameForPlayers(p1,p2);
        const match={
            id: crypto.randomUUID(), round, gameType,
            p1, p2, originalP1:p1, originalP2:p2,
            winner:null, winnerSide:null, played:false, started:false,
            datetime:new Date(datetime).toISOString(),
            createdAt:Date.now(),
            connectedPlayers:new Set(),
            aiReplaced:[]
        };
        initializeMatchState(match); matches.push(match);
    }
    tournament.matches.push(...matches);
    return {matches, originalCount};
}
function launchRound(players, round, startAt, totalRounds, finalAt) {
    const active=players.filter(p=>!p.eliminated);
    if(active.length===0){ tournament.status='finished'; return; }
    tournament.currentRound=round;
    tournament.roundScheduledAt=new Date(startAt).toISOString();
    const result=createRoundMatches(active,round,startAt);
    tournament.status='running';
    tournament.finalScheduledAt=new Date(finalAt).toISOString();
    io.emit('dashboardUpdate');
    console.log(`🏆 Round ${round} programmé le ${new Date(startAt).toISOString()} (${result.matches.length} matchs, ${active.length} joueurs)`);
}
function allCurrentRoundPlayed(){
    const current=tournament.matches.filter(m=>m.round===tournament.currentRound);
    return current.length>0 && current.every(m=>m.played);
}
function getHumanWinner(match){
    if(!match.winner || match.winner==='draw' || match.winner==='none')return null;
    const winner=String(match.winner)===String(match.p1.id)?match.p1:String(match.winner)===String(match.p2.id)?match.p2:null;
    return winner && !winner.isAI ? winner : null;
}
function finishTournamentMatch(match,winner){
    if(match.played)return;
    match.played=true;
    match.winner=winner;
    match.finishedAt=new Date().toISOString();
    if(winner==='draw'){
        // A draw never eliminates either player: the same two humans/AI are rematched.
        setTimeout(()=>rematchDraw(match),2000);
        io.to(`match-${match.id}`).emit('gameOver',{winner:'draw',message:'Match nul : rematch automatique.'});
        io.emit('dashboardUpdate');
        return;
    }
    const winnerPlayer=String(winner)===String(match.p1.id)?match.p1:String(winner)===String(match.p2.id)?match.p2:null;
    if(winnerPlayer && !winnerPlayer.isAI){
        winnerPlayer.wins=(winnerPlayer.wins||0)+1;
        const loser=String(winnerPlayer.id)===String(match.p1.id)?match.originalP2:match.originalP1;
        if(loser && !loser.isAI){loser.losses=(loser.losses||0)+1;loser.eliminated=true;loser.status='eliminated';}
        winnerPlayer.status='active';
    }
    io.to(`match-${match.id}`).emit('gameOver',{winner, winnerPlayerId:winnerPlayer?.id||null});
    io.emit('dashboardUpdate');
    maybeAdvanceTournament();
}
function rematchDraw(oldMatch){
    // Keep the same original human competitors. AI replacements remain allowed again at the rematch time.
    const p1=oldMatch.originalP1, p2=oldMatch.originalP2;
    const match={
        id:crypto.randomUUID(), round:oldMatch.round, gameType:oldMatch.gameType,
        p1, p2, originalP1:p1, originalP2:p2, winner:null, winnerSide:null, played:false, started:false,
        datetime:new Date(Date.now()+2000).toISOString(), createdAt:Date.now(), connectedPlayers:new Set(), aiReplaced:[]
    };
    initializeMatchState(match); tournament.matches.push(match); io.emit('dashboardUpdate');
}
function maybeAdvanceTournament(){
    if(!allCurrentRoundPlayed())return;
    const current=tournament.matches.filter(m=>m.round===tournament.currentRound);
    const winners=current.map(getHumanWinner).filter(Boolean);
    if(winners.length===1){
        tournament.status='finished'; tournament.winner=winners[0]; tournament.winner.finishedAt=Date.now();
        const nombreJoueurs=tournament.players.length;
        const commission=calculerCommissionTournoi(nombreJoueurs);
        const prime=Math.max(0,(TOURNAMENT_COST*nombreJoueurs)-commission);
        if(tournament.winner.phone&&prime>0){
            giveWinningPoints(tournament.winner.phone,prime,`Prix du tournoi (${nombreJoueurs} joueurs, commission ${commission} pts)`)
                .then(()=>emitWalletUpdate(tournament.winner.phone)).catch(console.error);
        }
        io.emit('tournamentFinished',{winner:{id:tournament.winner.id,firstname:tournament.winner.firstname,name:tournament.winner.name},prime,commission,totalPlayers:nombreJoueurs});
        io.emit('dashboardUpdate'); return;
    }
    if(winners.length===0){ tournament.status='finished'; tournament.winner=null; io.emit('dashboardUpdate'); return; }
    const nextRound=tournament.currentRound+1;
    const totalRounds=countRoundsForPlayers(tournament.players.length);
    const finalAt=new Date(tournament.finalScheduledAt || fridayFinalOfWeek(new Date()));
    const previousStart=new Date(tournament.roundScheduledAt || Date.now());
    const nextStart=calculateNextRoundStart(previousStart,winners.length,nextRound,totalRounds,finalAt);
    setTimeout(()=>launchRound(winners,nextRound,nextStart,totalRounds,finalAt),Math.max(1000,nextStart.getTime()-Date.now()));
    io.emit('dashboardUpdate');
}
function startDueTournamentMatch(match){
    if(match.played||match.started)return;
    if(Date.now()+MATCH_START_GRACE_MS<new Date(match.datetime).getTime())return;
    const room=liveMatches[match.id];
    const connectedHumanIds=new Set();
    if(room?.playerIds) for(const id of room.playerIds) connectedHumanIds.add(String(id));
    if(!connectedHumanIds.has(String(match.originalP1.id)) && !match.originalP1.isAI){
        match.p1=createTournamentAI('IA'); match.aiReplaced.push(String(match.originalP1.id));
    }
    if(!connectedHumanIds.has(String(match.originalP2.id)) && !match.originalP2.isAI){
        match.p2=createTournamentAI('IA'); match.aiReplaced.push(String(match.originalP2.id));
    }
    match.started=true; match.startedAt=new Date().toISOString();
    io.to(`match-${match.id}`).emit('matchStarted',{matchId:match.id,state:match.state,gameType:match.gameType,p1:match.p1,p2:match.p2,datetime:match.datetime});
    io.emit('dashboardUpdate');
    if(match.p1.isAI||match.p2.isAI) scheduleAIMove(match);
}
function tournamentTick(){
    if(tournament.status!=='running')return;
    tournament.matches.filter(m=>!m.played).forEach(startDueTournamentMatch);
}
function genererProgramme(){
    const start=new Date(tournament.roundScheduledAt || nextMondayAtFirstRound());
    const finalAt=fridayFinalOfWeek(start);
    const totalRounds=countRoundsForPlayers(tournament.players.length);
    tournament.finalScheduledAt=finalAt.toISOString();
    launchRound(tournament.players,1,start,totalRounds,finalAt);
}
function startTournamentNow(){
    if(tournament.players.length<2){tournament.status='closed';io.emit('dashboardUpdate');return;}
    tournament.startedAt=new Date().toISOString(); tournament.currentRound=0; tournament.matches=[];
    genererProgramme(); tournament.status='running'; io.emit('dashboardUpdate');
}
setInterval(tournamentTick,15000);

/*========================================================SOCKET.IO========================================================*/
io.on('connection', socket => {
    socket.on( 'userOnline', ({
        playerId, firstname, name, currentGame, phone
    }) => {
        onlineUsers.set( socket.id, {
            id: playerId, firstname, name, phone: normalizePhone(phone), currentGame: currentGame || null, lastActivity: Date.now()
        } );
        io.emit( 'dashboardUpdate' );
    } );
    socket.on( 'updateGame', ({
        currentGame
    }) => {
        if ( onlineUsers.has(socket.id) ) {
            const user = onlineUsers.get( socket.id );
            user.currentGame = currentGame;
            user.lastActivity = Date.now();
        }
    } );
    /* ====================================================== SOLDE JOUEUR EN TEMPS RÉEL ====================================================== */
    socket.on( 'requestWallet', async ({
        phone
    }) => {
        try {
            const wallet = await getWallet(phone);
            socket.emit( 'walletUpdate', wallet ? {
                phone: wallet.phone, points: Number(wallet.points), totalAdded: Number( wallet.total_added ), totalSpent: Number( wallet.total_spent ), totalWon: Number( wallet.total_won ), totalPaid: Number( wallet.total_paid )
            } : {
                phone: normalizePhone(phone), points: 0, totalAdded: 0, totalSpent: 0, totalWon: 0, totalPaid: 0
            } );
        } catch (err) {
            socket.emit( 'walletError', err.message );
        }
    } );
    /* ====================================================== MATCH ====================================================== */
    /* ====================================================== TOURNOI — CONNEXION AU MATCH ====================================================== */
    socket.on('joinTournamentMatch', ({matchId, token}) => {
        const match = tournament.matches.find(m => String(m.id) === String(matchId));
        if(!match || match.played) return socket.emit('tournamentError','Match introuvable ou terminé.');
        const player=tournament.players.find(p=>String(p.id)===String(token));
        if(!player) return socket.emit('tournamentError','Joueur non reconnu.');
        if(!isPlayerInMatch(match,player.id)) return socket.emit('tournamentError','Tu ne participes pas à ce match.');
        const startAt=new Date(match.datetime).getTime();
        if(Date.now()<startAt) return socket.emit('tournamentError',`Accès refusé : le match commence à ${new Date(match.datetime).toLocaleString('fr-FR',{timeZone:TOURNAMENT_TIMEZONE})}.`);
        if(match.started && (String(match.p1.id)!==String(player.id) && String(match.p2.id)!==String(player.id)))
            return socket.emit('tournamentError','Tu as été remplacé par l’IA car tu étais absent au lancement.');
        socket.join(`match-${match.id}`);
        socket.matchId=String(match.id); socket.playerId=player.id; socket.tournamentMatch=true;
        if(!liveMatches[match.id]) liveMatches[match.id]={players:new Set(),playerIds:new Set()};
        liveMatches[match.id].players.add(socket.id); liveMatches[match.id].playerIds.add(String(player.id));
        socket.emit('tournamentState',{matchId:match.id,gameType:match.gameType,state:match.state,p1:match.p1,p2:match.p2,datetime:match.datetime,started:match.started});
        // Starting here is deliberate: before the scheduled time nobody can enter.
        startDueTournamentMatch(match);
    });

    socket.on('tournamentMove', ({matchId, token, move}) => {
        const match=tournament.matches.find(m=>String(m.id)===String(matchId));
        if(!match||match.played||!match.started)return socket.emit('tournamentError','Match non disponible.');
        const player=tournament.players.find(p=>String(p.id)===String(token));
        if(!player||!isPlayerInMatch(match,player.id))return socket.emit('tournamentError','Joueur non autorisé.');
        if((match.p1.isAI&&String(player.id)===String(match.originalP1.id)&&String(match.p1.id)!==String(player.id)) ||
           (match.p2.isAI&&String(player.id)===String(match.originalP2.id)&&String(match.p2.id)!==String(player.id)))
            return socket.emit('tournamentError','Tu étais absent : l’IA joue à ta place.');
        const side=colorForSide(match,player.id);
        if(match.state.currentPlayer!==side)return socket.emit('tournamentError','Ce n’est pas ton tour.');
        let ok=false;
        if(match.gameType==='morpion'){
            const i=Number(move?.index); if(Number.isInteger(i)&&i>=0&&i<9&&!match.state.board[i]){match.state.board[i]=side;match.state.currentPlayer=side==='X'?'O':'X';ok=true;}
        }else if(match.gameType==='puissance4'){
            const c=Number(move?.col); const r=Number.isInteger(c)&&c>=0&&c<7?p4FreeRow(match.state.board,c):-1;
            if(r>=0){match.state.board[r][c]=side;match.state.currentPlayer=side==='red'?'yellow':'red';ok=true;if(p4Winner(match.state.board,r,c,side))return finishTournamentMatch(match,side);}
        }else if(match.gameType==='dame'){
            ok=applyDameMove(match,{from:Number(move?.from),to:Number(move?.to)},side);
        }else if(match.gameType==='echecs'){
            ok=applyChessMove(match,{from:Number(move?.from),to:Number(move?.to)},side);
        }
        if(!ok)return socket.emit('tournamentError','Coup illégal.');
        const winner=gameWinner(match);
        if(winner){finishTournamentMatch(match,winner);return;}
        if((match.gameType==='morpion'&&match.state.board.every(Boolean))||(match.gameType==='puissance4'&&match.state.board.every(r=>r.every(Boolean)))){finishTournamentMatch(match,'draw');return;}
        io.to(`match-${match.id}`).emit('state',{state:match.state,gameType:match.gameType});
        if(aiSide(match)===match.state.currentPlayer)scheduleAIMove(match);
    });

    socket.on('disconnect',()=>{
        onlineUsers.delete(socket.id);
        if(socket.matchId&&liveMatches[socket.matchId]){
            liveMatches[socket.matchId].players.delete(socket.id);
            io.to(`match-${socket.matchId}`).emit('opponentLeft',{msg:'Adversaire déconnecté. Le serveur maintient la partie.'});
        }
        io.emit('dashboardUpdate');
    });
});
/*========================================================INSCRIPTION JOUEUR========================================================*/
app.post( '/api/player/register', async (req, res) => {
    const {
        firstname, name, phone
    } = req.body;
    if ( !firstname || !name || !phone ) {
        return res.status(400).json({
            error: 'Remplis tout'
        });
    } const cleaned = normalizePhone(phone);
    if ( !validatePhone(cleaned) ) {
        return res.status(400).json({
            error: 'Numéro de téléphone invalide'
        });
    } if ( fullGamePlayers.find( p => normalizePhone( p.phone ) === cleaned ) ) {
        return res.status(400).json({
            error: 'Déjà inscrit'
        });
    } const player = {
        id: Date.now() + Math.random(), firstname, name, phone: cleaned, joinedAt: Date.now(), points: 0
    };
    fullGamePlayers.push( player );
    try {
        await ensureWallet( player );
    } catch (err) {
        console.error( 'Wallet:', err );
    } io.emit( 'dashboardUpdate' );
    res.json({
        success: true, player
    });
});
/*========================================================AUTH REGISTER========================================================*/
app.post( '/api/auth/register', async (req, res) => {
    const {
        email, password, firstname, name, phone
    } = req.body;
    if ( !email || !password || !firstname || !name ) {
        return res.status(400).json({
            error: 'Remplis tout'
        });
    } if ( accounts.has(email) ) {
        return res.status(400).json({
            error: 'Email déjà utilisé'
        });
    } const cleanedPhone = phone ? normalizePhone(phone) : '';
    if ( cleanedPhone && !validatePhone(cleanedPhone) ) {
        return res.status(400).json({
            error: 'Numéro de téléphone invalide'
        });
    } const playerId = Date.now() + Math.random();
    const passwordHash = crypto .createHash('sha256') .update(password) .digest('hex');
    const player = {
        id: playerId, email, firstname, name, phone: cleanedPhone, games: [ 'dame', 'morpion', 'puissance4', 'echecs' ], gameType: 'dame', wins: 0, losses: 0, eliminated: false, joinedAt: Date.now(), status: 'active', points: 0
    };
    fullGamePlayers.push( player );
    accounts.set( email, {
        passwordHash, playerId
    } );
    if (cleanedPhone) {
        try {
            await ensureWallet( player );
        } catch (err) {
            console.error( err );
        }
    } io.emit( 'dashboardUpdate' );
    res.json({
        success: true, player, token: playerId
    });
});
/*========================================================AUTH LOGIN========================================================*/
app.post( '/api/auth/login', async (req, res) => {
    const {
        email, password
    } = req.body;
    if ( !accounts.has(email) ) {
        return res.status(404).json({
            error: "Vous n'avez pas de compte GameOnline"
        });
    } const account = accounts.get(email);
    const passwordHash = crypto .createHash('sha256') .update(password) .digest('hex');
    if ( account.passwordHash !== passwordHash ) {
        return res.status(403).json({
            error: 'Mot de passe incorrect'
        });
    } const player = fullGamePlayers.find( p => p.id === account.playerId );
    if (!player) {
        return res.status(404).json({
            error: 'Profil introuvable'
        });
    } let wallet = null;
    if (player.phone) {
        try {
            wallet = await getWallet( player.phone );
        } catch (err) {
            console.error(err);
        }
    } res.json({
        success: true, player: {
            ...player, points: wallet ? Number(wallet.points) : 0
        }, token: player.id
    });
});
/*========================================================API SOLDE JOUEUR========================================================*/
app.get( '/api/player/balance', async (req, res) => {
    const {
        token, phone
    } = req.query;
    let player = null;
    if (token) {
        player = fullGamePlayers.find( p => String(p.id) === String(token) );
    } const playerPhone = phone || player?.phone;
    if (!playerPhone) {
        return res.status(400).json({
            success: false, error: 'Numéro de téléphone manquant'
        });
    } const wallet = await getWallet( playerPhone );
    if (!wallet) {
        return res.json({
            success: true, phone: normalizePhone( playerPhone ), points: 0, totalWon: 0, totalPaid: 0
        });
    } res.json({
        success: true, phone: wallet.phone, points: Number(wallet.points), totalAdded: Number(wallet.total_added), totalSpent: Number(wallet.total_spent), totalWon: Number(wallet.total_won), totalPaid: Number(wallet.total_paid)
    });
});
/*========================================================DONNER DES POINTS À UN JOUEURADMIN========================================================*/
app.post( '/api/admin/points/add', requireAdmin, async (req, res) => {
    try {
        const {
            phone, points, reason
        } = req.body;
        const cleaned = normalizePhone(phone);
        if ( !validatePhone(cleaned) ) {
            return res.status(400).json({
                success: false, error: 'Numéro invalide'
            });
        } const player = fullGamePlayers.find( p => normalizePhone( p.phone ) === cleaned );
        if (!player) {
            return res.status(404).json({
                success: false, error: 'Joueur introuvable. Le joueur doit d’abord être enregistré.'
            });
        } await ensureWallet( player );
        const wallet = await addPoints( cleaned, points, reason || 'Paiement reçu - Orange Money' );
        await emitWalletUpdate( cleaned );
        res.json({
            success: true, message: 'Points ajoutés', player: {
                id: player.id, firstname: player.firstname, name: player.name, phone: cleaned
            }, wallet: {
                points: Number(wallet.points), totalAdded: Number(wallet.total_added), totalSpent: Number(wallet.total_spent), totalWon: Number(wallet.total_won), totalPaid: Number(wallet.total_paid)
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false, error: err.message
        });
    }
});
/*========================================================RECHERCHER JOUEUR PAR NUMEROADMIN========================================================*/
app.get( '/api/admin/player', requireAdmin, async (req, res) => {
    try {
        const phone = normalizePhone( req.query.phone );
        if (!phone) {
            return res.status(400).json({
                success: false, error: 'Numéro manquant'
            });
        } const wallet = await getWallet( phone );
        const player = fullGamePlayers.find( p => normalizePhone( p.phone ) === phone );
        if (!wallet && !player) {
            return res.status(404).json({
                success: false, error: 'Joueur introuvable'
            });
        } res.json({
            success: true, player: {
                id: player?.id || wallet?.player_id || null, firstname: player?.firstname || wallet?.firstname || '', name: player?.name || wallet?.name || '', phone
            }, wallet: {
                points: Number( wallet?.points || 0 ), totalAdded: Number( wallet?.total_added || 0 ), totalSpent: Number( wallet?.total_spent || 0 ), totalWon: Number( wallet?.total_won || 0 ), totalPaid: Number( wallet?.total_paid || 0 )
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false, error: 'Erreur serveur'
        });
    }
});
/*========================================================MARQUER LES GAINS COMME PAYÉSADMIN========================================================*/
app.post( '/api/admin/player/pay', requireAdmin, async (req, res) => {
    try {
        const {
            phone, points, reason
        } = req.body;
        const cleaned = normalizePhone(phone);
        const wallet = await markPointsPaid( cleaned, points, reason || 'Paiement du gain au joueur' );
        await emitWalletUpdate( cleaned );
        res.json({
            success: true, message: 'Gain marqué comme payé', wallet: {
                points: Number( wallet.points ), totalAdded: Number( wallet.total_added ), totalSpent: Number( wallet.total_spent ), totalWon: Number( wallet.total_won ), totalPaid: Number( wallet.total_paid )
            }
        });
    } catch (err) {
        console.error(err);
        res.status(400).json({
            success: false, error: err.message
        });
    }
});
/*========================================================LISTE FINANCIÈRE DASHBOARD ADMIN========================================================*/
app.get( '/api/admin/points', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(` SELECT phone, player_id, firstname, name, points, total_added, total_spent, total_won, total_paid, created_at, updated_at FROM player_wallets ORDER BY updated_at DESC `);
        const total = result.rows.reduce( (acc, row) => {
            acc.points += Number(row.points);
            acc.totalAdded += Number( row.total_added );
            acc.totalSpent += Number( row.total_spent );
            acc.totalWon += Number( row.total_won );
            acc.totalPaid += Number( row.total_paid );
            return acc;
        }, {
            points: 0, totalAdded: 0, totalSpent: 0, totalWon: 0, totalPaid: 0
        } );
        res.json({
            success: true, total, players: result.rows.map( row => ({
                id: row.player_id, firstname: row.firstname, name: row.name, phone: row.phone, points: Number( row.points ), totalAdded: Number( row.total_added ), totalSpent: Number( row.total_spent ), totalWon: Number( row.total_won ), totalPaid: Number( row.total_paid )
            }) )
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false, error: 'Erreur dashboard points'
        });
    }
});
/*========================================================TRANSACTIONSADMIN========================================================*/
app.get( '/api/admin/points/history', requireAdmin, async (req, res) => {
    try {
        const phone = normalizePhone( req.query.phone || '' );
        let result;
        if (phone) {
            result = await pool.query(` SELECT * FROM point_transactions WHERE phone = $1 ORDER BY created_at DESC LIMIT 100 `, [phone]);
        } else {
            result = await pool.query(` SELECT * FROM point_transactions ORDER BY created_at DESC LIMIT 100 `);
        } res.json({
            success: true, transactions: result.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false, error: 'Erreur historique'
        });
    }
});
/*========================================================ACCÈS À UN JEU========================================================Le frontend doit appeler cette route avant de lancerune partie payante.Exemple :POST /api/game/access{ "token": "...", "gameType": "dame"}========================================================*/
app.post( '/api/game/access', async (req, res) => {
    try {
        const {
            token, phone, gameType, againstAI
        } = req.body;
        let player = null;
        if (token) {
            player = fullGamePlayers.find( p => String(p.id) === String(token) );
        } const playerPhone = phone || player?.phone;
        if (!playerPhone) {
            return res.status(400).json({
                success: false, error: 'Numéro de téléphone requis'
            });
        } const game = String( gameType || '' ).toLowerCase();
        const cost = getGameCost(game);
        if (!cost) {
            return res.status(400).json({
                success: false, error: 'Jeu non reconnu'
            });
        } const wallet = await getWallet( playerPhone );
        if (!wallet) {
            return res.status(404).json({
                success: false, error: 'Portefeuille joueur introuvable'
            });
        } if ( Number(wallet.points) < cost ) {
            return res.status(402).json({
                success: false, error: 'Points insuffisants', required: cost, points: Number( wallet.points )
            });
        } const updated = await spendPoints( playerPhone, cost, againstAI ? `Partie ${game} contre IA` : `Partie ${game}` );
        await emitWalletUpdate( playerPhone );
        res.json({
            success: true, authorized: true, gameType: game, againstAI: !!againstAI, cost, remainingPoints: Number( updated.points )
        });
    } catch (err) {
        console.error(err);
        res.status(400).json({
            success: false, error: err.message
        });
    }
});
/*========================================================TOURNOI INSCRIPTION========================================================*/
app.post('/api/tournament/join', async (req,res)=>{
    try{
        if(!inscriptionOuverte()) return res.status(403).json({error:'Les inscriptions sont ouvertes uniquement du samedi au dimanche.'});
        const {token,games}=req.body;
        const player=fullGamePlayers.find(p=>String(p.id)===String(token));
        if(!player)return res.status(401).json({error:'Utilisateur non reconnu'});
        if(!player.phone)return res.status(400).json({error:'Ton compte doit avoir un numéro de téléphone.'});
        if(tournament.players.find(p=>String(p.id)===String(player.id)))return res.status(400).json({error:'Déjà inscrit'});
        const wallet=await getWallet(player.phone);
        if(!wallet||Number(wallet.points)<TOURNAMENT_COST)return res.status(402).json({error:'Points insuffisants pour participer au tournoi.',required:TOURNAMENT_COST,points:Number(wallet?.points||0)});
        const selected=Array.isArray(games)?games.filter(g=>['dame','echecs','morpion','puissance4'].includes(g)):['dame'];
        if(!selected.length)return res.status(400).json({error:'Sélectionne au moins un jeu.'});
        await spendPoints(player.phone,TOURNAMENT_COST,'Inscription au tournoi');
        const newPlayer={id:player.id,name:player.name,firstname:player.firstname,phone:player.phone,accessCode:generateAccessCode(player.phone),games:selected,gameType:selected[0],wins:0,losses:0,eliminated:false,joinedAt:Date.now(),status:'active'};
        tournament.players.push(newPlayer); await emitWalletUpdate(player.phone); io.emit('dashboardUpdate');
        res.json({success:true,message:'Inscription réussie. Les matchs seront programmés automatiquement lundi.',remainingPoints:Number((await getWallet(player.phone)).points)});
    }catch(err){console.error('Tournoi inscription:',err);res.status(400).json({success:false,error:err.message});}
});
app.get('/api/programme',(req,res)=>{
    const token=String(req.query.token||'');
    const matches=tournament.matches.map(m=>({
        ...m,
        connectedPlayers:undefined,
        canEnter: token ? isPlayerInMatch(m,token) && !m.played && Date.now()>=new Date(m.datetime).getTime() : false,
        page:gamePageFor(m.gameType),
        datetime:m.datetime
    }));
    res.json({round:tournament.currentRound,status:tournament.status,roundScheduledAt:tournament.roundScheduledAt||null,finalScheduledAt:tournament.finalScheduledAt||null,matches});
});
app.get('/api/tournament/ranking',(req,res)=>{
    const ranking=[...tournament.players].sort((a,b)=>(b.wins||0)-(a.wins||0)||(a.losses||0)-(b.losses||0)).map((p,index)=>({rank:index+1,firstname:p.firstname,name:p.name,wins:p.wins||0,losses:p.losses||0,eliminated:!!p.eliminated,status:p.eliminated?'Éliminé':(p.status||'En lice')}));
    res.json({success:true,ranking});
});
app.post('/api/tournament/enter-match',(req,res)=>{
    const {token}=req.body; const player=fullGamePlayers.find(p=>String(p.id)===String(token));
    if(!player)return res.status(401).json({success:false,error:'Joueur non reconnu'});
    const match=tournament.matches.find(m=>isPlayerInMatch(m,player.id)&&!m.played);
    if(!match)return res.json({success:false,error:'Aucun match pour toi'});
    const startAt=new Date(match.datetime).getTime();
    if(Date.now()<startAt)return res.json({success:false,error:`Ton match commence le ${new Date(match.datetime).toLocaleString('fr-FR',{timeZone:TOURNAMENT_TIMEZONE})}.` ,datetime:match.datetime});
    if(match.started && ((match.p1.isAI&&String(match.originalP1.id)===String(player.id))||(match.p2.isAI&&String(match.originalP2.id)===String(player.id)))) return res.json({success:false,error:'Tu étais absent au lancement : l’IA te remplace pour ce match.'});
    res.json({success:true,matchId:match.id,gameType:match.gameType,page:gamePageFor(match.gameType),datetime:match.datetime});
});
app.post('/api/tournament/match/access', (req,res)=>{
    const {token,matchId}=req.body; const match=tournament.matches.find(m=>String(m.id)===String(matchId));
    if(!match)return res.status(404).json({success:false,error:'Match introuvable'});
    const player=tournament.players.find(p=>String(p.id)===String(token));
    if(!player||!isPlayerInMatch(match,player.id))return res.status(403).json({success:false,error:'Accès refusé'});
    if(Date.now()<new Date(match.datetime).getTime())return res.status(403).json({success:false,error:'Le match n’est pas encore ouvert.',datetime:match.datetime});
    if(match.started&&((match.p1.isAI&&String(match.originalP1.id)===String(player.id))||(match.p2.isAI&&String(match.originalP2.id)===String(player.id))))return res.status(403).json({success:false,error:'IA active : joueur absent au lancement.'});
    res.json({success:true,matchId:match.id,gameType:match.gameType,page:gamePageFor(match.gameType),state:match.state,p1:match.p1,p2:match.p2,datetime:match.datetime});
});
/*========================================================DASHBOARD GÉNÉRAL========================================================*/
app.get( '/api/dashboard', async (req, res) => {
    try {
        const actifs = tournament.players .filter( p => !p.eliminated ) .length;
        const nouveaux = tournament.players .filter( p => p.joinedAt > Date.now() - 86400000 ) .length;
        const byGame = {
            dame: 0, echecs: 0, morpion: 0, puissance4: 0
        };
        tournament.players .forEach(p => {
            if ( p.games ) {
                p.games .forEach(g => {
                    if ( byGame[g] !== undefined ) {
                        byGame[g]++;
                    }
                });
            } else if ( p.gameType && byGame[ p.gameType ] !== undefined ) {
                byGame[ p.gameType ]++;
            }
        });
        const online = Array.from( onlineUsers.values() ).map(u => ({
            firstname: u.firstname, name: u.name, phone: u.phone, online: true, currentGame: u.currentGame || '-', lastActivity: timeAgo( u.lastActivity )
        }));
        const activity = [ ...fullGamePlayers, ...tournament.players ] .sort( (a,b) => b.joinedAt - a.joinedAt ) .slice(0,5) .map(p => ({
            player: `${p.firstname} ${p.name}`, action: 'Inscription', time: timeAgo( p.joinedAt )
        }));
        let financial = {
            players: [], total: {
                points: 0, totalAdded: 0, totalSpent: 0, totalWon: 0, totalPaid: 0
            }
        };
        try {
            const result = await pool.query(` SELECT phone, player_id, firstname, name, points, total_added, total_spent, total_won, total_paid FROM player_wallets ORDER BY updated_at DESC `);
            financial.players = result.rows.map( row => ({
                id: row.player_id, firstname: row.firstname, name: row.name, phone: row.phone, points: Number( row.points ), totalAdded: Number( row.total_added ), totalSpent: Number( row.total_spent ), totalWon: Number( row.total_won ), totalPaid: Number( row.total_paid )
            }) );
            financial.total = financial.players .reduce( (acc, p) => {
                acc.points += p.points;
                acc.totalAdded += p.totalAdded;
                acc.totalSpent += p.totalSpent;
                acc.totalWon += p.totalWon;
                acc.totalPaid += p.totalPaid;
                return acc;
            }, {
                points: 0, totalAdded: 0, totalSpent: 0, totalWon: 0, totalPaid: 0
            } );
        } catch (err) {
            console.error( 'Dashboard financier:', err );
        } res.json({
            site: {
                inscrits: fullGamePlayers.length + tournament.players.length, actifs: fullGamePlayers.length + actifs, nouveaux: fullGamePlayers .filter( p => p.joinedAt > Date.now() - 86400000 ) .length + nouveaux, activity
            },
            /* NOUVELLE PARTIE POINTS */
            points: {
                totalEnCirculation: financial.total.points, totalAjoute: financial.total.totalAdded, totalDepense: financial.total.totalSpent, totalGagne: financial.total.totalWon, totalPaye: financial.total.totalPaid, joueurs: financial.players
            }, tournament: {
                inscrits: tournament.players.length, actifs, nouveaux, status: tournament.status, currentRound: tournament.currentRound, matches: tournament.matches, players: tournament.players, byGame
            }, online, gameComplete: {
                inscrits: fullGamePlayers.length, actifs: fullGamePlayers.length, nouveaux: fullGamePlayers .filter( p => p.joinedAt > Date.now() - 86400000 ) .length, retention: '0%'
            }
        });
    } catch (err) {
        console.error( 'Dashboard:', err );
        res.status(500).json({
            error: 'Erreur dashboard'
        });
    }
});
/*========================================================RESET========================================================*/
app.post( '/api/tournament/reset', requireAdmin, (req, res) => {
    tournament = {
        players: [], matches: [], status: 'closed', currentRound: 0, winner: null
    };
    fullGamePlayers = [];
    accounts.clear();
    onlineUsers.clear();
    io.emit( 'dashboardUpdate' );
    res.json({
        success: true
    });
});
/*========================================================INSCRIPTIONS SAMEDI========================================================*/
schedule.scheduleJob({hour:0,minute:0,dayOfWeek:6,tz:TOURNAMENT_TIMEZONE},()=>{
    tournament={players:[],matches:[],status:'registration',currentRound:0,winner:null,startedAt:null,finalScheduledAt:null};
    io.emit('dashboardUpdate'); console.log('🏆 Inscriptions tournoi ouvertes.');
});
/*========================================================LANCEMENT TOURNOI LUNDI========================================================*/
schedule.scheduleJob({hour:0,minute:0,dayOfWeek:1,tz:TOURNAMENT_TIMEZONE},()=>{
    if(tournament.players.length<2){tournament.status='closed';io.emit('dashboardUpdate');console.log('Tournoi annulé : moins de 2 joueurs');return;}
    startTournamentNow(); console.log('🏆 Tournoi lancé automatiquement le lundi.');
});
/*========================================================PARIS========================================================*/
app.post( '/api/player/paris', (req, res) => {
    const {
        token
    } = req.body;
    if (!token) {
        return res.status(400).json({
            success: false, error: 'Token joueur manquant'
        });
    } const player = fullGamePlayers.find( p => String(p.id) === String(token) );
    if (!player) {
        return res.status(404).json({
            success: false, error: 'Joueur introuvable'
        });
    } res.json({
        success: true, player: {
            id: player.id, firstname: player.firstname, name: player.name, phone: player.phone
        }
    });
});
/*========================================================CONNEXION DEPUIS L'ANCIEN JEU (PARIS)========================================================*/
app.post( '/api/player/from-old-game', (req, res) => {
    const {
        token
    } = req.body;
    if (!token) {
        return res.status(400).json({
            success: false, error: 'Token joueur manquant'
        });
    } const player = fullGamePlayers.find( p => String(p.id) === String(token) );
    if (!player) {
        return res.status(404).json({
            success: false, error: 'Joueur introuvable'
        });
    } res.json({
        success: true, player: {
            id: player.id, firstname: player.firstname, name: player.name, phone: player.phone
        }
    });
});
app.get('/api/paris/player/search', async (req, res) => {
    try {
        const phone = normalizePhone(req.query.phone);
        if (!phone) {
            return res.status(400).json({
                success: false, error: 'Numéro manquant'
            });
        } const wallet = await getWallet(phone);
        const player = fullGamePlayers.find( p => normalizePhone(p.phone) === phone );
        if (!wallet && !player) {
            return res.status(404).json({
                success: false, error: 'Joueur introuvable'
            });
        } res.json({
            success: true, player: {
                id: player?.id || wallet?.player_id || null, firstname: player?.firstname || wallet?.firstname || '', name: player?.name || wallet?.name || '', phone, points: Number(wallet?.points || 0), totalWins: Number(wallet?.total_won || 0), totalPaid: Number(wallet?.total_paid || 0), games: player?.games?.length || 0
            }
        });
    } catch (err) {
        console.error('Recherche PARIS:', err);
        res.status(500).json({
            success: false, error: 'Erreur serveur'
        });
    }
});
app.get('/api/paris/dashboard', async (req, res) => {
    try {
        const result = await pool.query(` SELECT phone, player_id, firstname, name, points, total_added, total_spent, total_won, total_paid FROM player_wallets ORDER BY updated_at DESC `);
        const players = result.rows.map(row => {
            const player = fullGamePlayers.find( p => String(p.id) === String(row.player_id) );
            return {
                id: row.player_id, firstname: row.firstname, name: row.name, phone: row.phone, points: Number(row.points), totalCredits: Number(row.total_added), totalWins: Number(row.total_won), totalPaid: Number(row.total_paid), unpaidWins: Number(row.total_won), games: player?.games?.length || 0
            };
        });
        const stats = players.reduce( (acc, player) => {
            acc.players++;
            acc.totalCredits += player.totalCredits;
            acc.playersBalance += player.points;
            acc.totalWins += player.totalWins;
            acc.totalPaid += player.totalPaid;
            return acc;
        }, {
            players: 0, totalCredits: 0, playersBalance: 0, totalWins: 0, totalPaid: 0
        } );
        const historyResult = await pool.query(` SELECT pt.phone, pt.type, pt.points, pt.reason, pt.created_at, pw.firstname, pw.name FROM point_transactions pt LEFT JOIN player_wallets pw ON pw.phone = pt.phone ORDER BY pt.created_at DESC LIMIT 20 `);
        const history = historyResult.rows.map(row => ({
            player: `${row.firstname || ''} ${row.name || ''}`.trim(), action: row.reason || row.type, amount: Number(row.points), time: timeAgo(new Date(row.created_at).getTime())
        }));
        res.json({
            success: true, stats, players, history
        });
    } catch (err) {
        console.error('Dashboard PARIS:', err);
        res.status(500).json({
            success: false, error: 'Erreur dashboard'
        });
    }
});
app.post('/api/paris/points/add', async (req, res) => {
    try {
        const {
            playerId, phone, points
        } = req.body;
        const cleaned = normalizePhone(phone);
        if (!cleaned) {
            return res.status(400).json({
                success: false, error: 'Numéro invalide'
            });
        } const player = fullGamePlayers.find( p => String(p.id) === String(playerId) || normalizePhone(p.phone) === cleaned );
        if (!player) {
            return res.status(404).json({
                success: false, error: 'Joueur introuvable'
            });
        } await ensureWallet(player);
        const wallet = await addPoints( cleaned, points, 'Paiement reçu - Orange Money' );
        await emitWalletUpdate(cleaned);
        res.json({
            success: true, player: {
                id: player.id, firstname: player.firstname, name: player.name, phone: cleaned, points: Number(wallet.points), totalWins: Number(wallet.total_won), totalPaid: Number(wallet.total_paid)
            }
        });
    } catch (err) {
        console.error('Ajout points PARIS:', err);
        res.status(400).json({
            success: false, error: err.message
        });
    }
});
app.post('/api/paris/pay', async (req, res) => {
    try {
        const {
            playerId
        } = req.body;
        const player = fullGamePlayers.find( p => String(p.id) === String(playerId) );
        if (!player || !player.phone) {
            return res.status(404).json({
                success: false, error: 'Joueur introuvable'
            });
        } const wallet = await getWallet(player.phone);
        if (!wallet) {
            return res.status(404).json({
                success: false, error: 'Portefeuille introuvable'
            });
        } const unpaid = Number(wallet.total_won);
        if (unpaid <= 0) {
            return res.status(400).json({
                success: false, error: 'Aucun gain à payer'
            });
        } const updated = await markPointsPaid( player.phone, unpaid, 'Paiement du gain au joueur' );
        await emitWalletUpdate(player.phone);
        res.json({
            success: true, message: 'Gain marqué comme payé', player: {
                id: player.id, firstname: player.firstname, name: player.name, phone: player.phone
            }, wallet: {
                points: Number(updated.points), totalWon: Number(updated.total_won), totalPaid: Number(updated.total_paid)
            }
        });
    } catch (err) {
        console.error('Paiement PARIS:', err);
        res.status(400).json({
            success: false, error: err.message
        });
    }
});
/*========================================================MISES DES JEUX PARIS (course, dames, echecs, morpion, puissance4, aviator, loterie)========================================================*/
const activeBets = new Map();
function genererBetId() {
    return 'bet_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}
app.post('/api/paris/mise', async (req, res) => {
    try {
        const {
            token, jeu, mise
        } = req.body;
        const player = fullGamePlayers.find( p => String(p.id) === String(token) );
        if (!player) {
            return res.status(404).json({
                success: false, error: 'Joueur introuvable'
            });
        } const montant = Math.floor(Number(mise));
        if (!Number.isFinite(montant) || montant <= 0) {
            return res.status(400).json({
                success: false, error: 'Mise invalide'
            });
        } await ensureWallet(player);
        const wallet = await spendPoints( player.phone, montant, `Mise ${jeu || 'paris'}` );
        const betId = genererBetId();
        activeBets.set(betId, {
            phone: player.phone, jeu: jeu || 'paris', mise: montant, resolved: false, createdAt: Date.now()
        });
        await emitWalletUpdate(player.phone);
        res.json({
            success: true, betId, wallet: {
                points: Number(wallet.points)
            }
        });
    } catch (err) {
        res.status(400).json({
            success: false, error: err.message
        });
    }
});
app.post('/api/paris/resoudre', async (req, res) => {
    try {
        const {
            token, betId, gagne, multiplicateur
        } = req.body;
        const player = fullGamePlayers.find( p => String(p.id) === String(token) );
        if (!player) {
            return res.status(404).json({
                success: false, error: 'Joueur introuvable'
            });
        } const bet = activeBets.get(betId);
        if (!bet || bet.phone !== player.phone) {
            return res.status(404).json({
                success: false, error: 'Mise introuvable'
            });
        } if (bet.resolved) {
            return res.status(409).json({
                success: false, error: 'Cette mise a déjà été réglée'
            });
        } bet.resolved = true;
        let wallet = await getWallet(player.phone);
        let gain = 0;
        if (gagne) {
            const mult = Number(multiplicateur) > 0 ? Number(multiplicateur) : 2;
            gain = Math.floor(bet.mise * mult);
            if (gain > 0) {
                wallet = await giveWinningPoints( player.phone, gain, `Gain ${bet.jeu}` );
            }
        } await emitWalletUpdate(player.phone);
        activeBets.delete(betId);
        res.json({
            success: true, gain, wallet: {
                points: Number(wallet.points)
            }
        });
    } catch (err) {
        res.status(400).json({
            success: false, error: err.message
        });
    }
});
/*========================================================COURSES PARIS========================================================*/
const races = new Map();
const RACE_CONFIG = {
    voiture: {
        cost: 100, reward: 500, duration: 15000
    }, cheval: {
        cost: 100, reward: 500, duration: 15000
    }
};
function generateRaceId(type) {
    return `${type}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}function createRace(type) {
    const config = RACE_CONFIG[type];
    if (!config) {
        throw new Error('Type de course invalide');
    } const race = {
        id: generateRaceId(type), type, status: 'waiting', players: [], winner: null, createdAt: Date.now(), startedAt: null, finishedAt: null
    };
    races.set(race.id, race);
    return race;
}function getRace(raceId) {
    return races.get(String(raceId)) || null;
}function addRacePlayer(race, player) {
    if (!race) {
        throw new Error('Course introuvable');
    } if (race.status !== 'waiting') {
        throw new Error('La course a déjà commencé');
    } const alreadyJoined = race.players.find( p => String(p.id) === String(player.id) );
    if (alreadyJoined) {
        return alreadyJoined;
    } const racePlayer = {
        id: player.id, firstname: player.firstname, name: player.name, phone: player.phone, position: 0, joinedAt: Date.now()
    };
    race.players.push(racePlayer);
    return racePlayer;
}function startRace(race) {
    if (!race) {
        throw new Error('Course introuvable');
    } if (race.status !== 'waiting') {
        return;
    } if (race.players.length < 2) {
        throw new Error( 'Il faut au moins 2 joueurs pour commencer la course' );
    } race.status = 'running';
    race.startedAt = Date.now();
    io.emit('raceStarted', {
        raceId: race.id, type: race.type, players: race.players
    });
    setTimeout(() => {
        finishRace(race.id);
    }, RACE_CONFIG[race.type].duration);
}async function finishRace(raceId) {
    const race = getRace(raceId);
    if (!race || race.status !== 'running') {
        return;
    } if (!race.players.length) {
        return;
    } const randomIndex = Math.floor( Math.random() * race.players.length );
    const winner = race.players[randomIndex];
    race.winner = winner.id;
    race.status = 'finished';
    race.finishedAt = Date.now();
    const reward = RACE_CONFIG[race.type].reward;
    try {
        if (winner.phone && !String(winner.id).startsWith('AI_')) {
            await giveWinningPoints( winner.phone, reward, `Gain course ${race.type}` );
            await emitWalletUpdate(winner.phone);
        } io.emit('raceFinished', {
            raceId: race.id, type: race.type, winner: {
                id: winner.id, firstname: winner.firstname, name: winner.name
            }, reward
        });
        io.emit('dashboardUpdate');
    } catch (err) {
        console.error( 'Erreur paiement course:', err );
    }
}
/*========================================================API COURSES========================================================*/
app.post('/api/paris/race/create', async (req, res) => {
    try {
        const {
            type
        } = req.body;
        if (!RACE_CONFIG[type]) {
            return res.status(400).json({
                success: false, error: 'Type de course invalide'
            });
        } const race = createRace(type);
        res.json({
            success: true, race
        });
    } catch (err) {
        console.error('Création course:', err);
        res.status(500).json({
            success: false, error: err.message
        });
    }
});
app.post('/api/paris/race/join', async (req, res) => {
    try {
        const {
            raceId, token
        } = req.body;
        const race = getRace(raceId);
        if (!race) {
            return res.status(404).json({
                success: false, error: 'Course introuvable'
            });
        } const player = fullGamePlayers.find( p => String(p.id) === String(token) );
        if (!player) {
            return res.status(401).json({
                success: false, error: 'Joueur non reconnu'
            });
        } if (!player.phone) {
            return res.status(400).json({
                success: false, error: 'Numéro de téléphone manquant'
            });
        } const existingPlayer = race.players.find( p => String(p.id) === String(player.id) );
        if (existingPlayer) {
            return res.json({
                success: true, message: 'Déjà inscrit à cette course', race
            });
        } const cost = RACE_CONFIG[race.type].cost;
        const wallet = await getWallet(player.phone);
        if ( !wallet || Number(wallet.points) < cost ) {
            return res.status(402).json({
                success: false, error: 'Points insuffisants', required: cost, points: Number( wallet?.points || 0 )
            });
        } await spendPoints( player.phone, cost, `Participation course ${race.type}` );
        const racePlayer = addRacePlayer( race, player );
        await emitWalletUpdate( player.phone );
        io.emit('racePlayerJoined', {
            raceId: race.id, player: racePlayer, players: race.players
        });
        res.json({
            success: true, race, remainingPoints: Number( (await getWallet( player.phone )).points )
        });
    } catch (err) {
        console.error( 'Inscription course:', err );
        res.status(400).json({
            success: false, error: err.message
        });
    }
});
app.get('/api/paris/race/:raceId', (req, res) => {
    const race = getRace(req.params.raceId);
    if (!race) {
        return res.status(404).json({
            success: false, error: 'Course introuvable'
        });
    } res.json({
        success: true, race
    });
});
app.post( '/api/paris/race/:raceId/start', requireAdmin, (req, res) => {
    try {
        const race = getRace(req.params.raceId);
        if (!race) {
            return res.status(404).json({
                success: false, error: 'Course introuvable'
            });
        } startRace(race);
        res.json({
            success: true, race
        });
    } catch (err) {
        console.error( 'Démarrage course:', err );
        res.status(400).json({
            success: false, error: err.message
        });
    }
});
/*========================================================PORT========================================================*/
const PORT = process.env.PORT || 3001;
server.listen( PORT, () => {
    console.log( `Serveur sur http://localhost:${PORT}` );
    console.log( 'Heure serveur Kinshasa:', new Date().toLocaleString( 'fr-FR', {
        timeZone: 'Africa/Kinshasa'
    } ) );
});


