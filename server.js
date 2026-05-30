const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const schedule = require('node-schedule');
const crypto = require('crypto');

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
.then(() => console.log('✅ Connecté à Postgres'))
.catch(err => console.error('❌ Erreur Postgres:', err));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

let liveMatches = {};
let fullGamePlayers = [];
const accounts = new Map();

// NOUVEAU : stocker les users connectés
const onlineUsers = new Map(); // socket.id -> {id, firstname, name, currentGame, lastActivity}

app.use(express.json());
app.use(express.static('public', { maxAge: '1d' }));
app.use(express.static(__dirname, { maxAge: '1d' }));

app.post('/register', async(req, res) => {
  const { username, password } = req.body;

try{
  await pool.query(
    "INSERT INTO users (username, password) VALUES ($1, $2)",
    [username, password]
  );
   res.json({ success: "Compte créé" });
    } catch(err) {
      console.error(err);
      res.json({ error: "Erreur" });
  }
});

app.get('/health', (req, res) => { res.status(200).send('OK') })

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/mode.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mode.html')));
app.get('/jeu.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jeu.html')));
app.get('/programme.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'programme.html')));
app.get('/inscription.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inscription.html')));
app.get('/tournoi.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tournoi.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// Tournoi
let tournament = {
  players: [],
  matches: [],
  status: 'closed',
  currentRound: 0,
  winner: null
};

// Utils
function validatePhone(phone) {
  const cleaned = phone.replace(/\s+/g, '');
  return /^\+?[0-9]{8,15}$/.test(cleaned);
}

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
  return String(match.p1.id) === String(playerId) || String(match.p2.id) === String(playerId);
}

function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h}h`;
  return `Il y a ${Math.floor(h/24)}j`;
}

// Plateau Dame vide
function createInitialBoard() {
  let board = [];
  for (let i = 0; i < 100; i++) {
    if (i < 40 && Math.floor(i / 10) % 2!== i % 2) board[i] = 2;
    else if (i >= 60 && Math.floor(i / 10) % 2!== i % 2) board[i] = 1;
    else board[i] = 0;
  }
  return board;
}

// Morpion logic
function checkMorpionWinner(board) {
  const winPatterns = [
    [0,1,2], [3,4,5], [6,7,8],
    [0,3,6], [1,4,7], [2,5,8],
    [0,4,8], [2,4,6]
  ];
  for (let pattern of winPatterns) {
    const [a,b,c] = pattern;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  if (board.every(cell => cell!== null)) return 'draw';
  return null;
}

function morpionAIMove(board, aiSymbol) {
  const humanSymbol = aiSymbol === 'X'? 'O' : 'X';
  function minimax(newBoard, player) {
    let winner = checkMorpionWinner(newBoard);
    if (winner === aiSymbol) return {score: 10};
    if (winner === humanSymbol) return {score: -10};
    if (winner === 'draw') return {score: 0};
    let moves = [];
    for (let i = 0; i < 9; i++) {
      if (newBoard[i] === null) {
        newBoard[i] = player;
        let result = minimax(newBoard, player === aiSymbol? humanSymbol : aiSymbol);
        moves.push({index: i, score: result.score});
        newBoard[i] = null;
      }
    }
    return moves.reduce((best, move) =>
      player === aiSymbol?
      (move.score > best.score? move : best) :
      (move.score < best.score? move : best),
      {score: player === aiSymbol? -Infinity : Infinity}
    );
  }
  const move = minimax(board, aiSymbol);
  return move.index;
}

function initializeMatchState(match) {
  if (match.gameType === 'dame') {
    match.state = { board: createInitialBoard(), currentPlayer: 'white' };
  }
  if (match.gameType === 'morpion') {
    match.state = { board: Array(9).fill(null), currentPlayer: 'X' };
  }
}

function handleAIMove(match) {
  if (match.gameType === 'morpion') {
    const board = match.state.board;
    const currentPlayer = match.state.currentPlayer;
    const aiSymbol = match.p1.isAI? 'X' : 'O';
    if (currentPlayer!== aiSymbol) return;

    const moveIndex = morpionAIMove(board, aiSymbol);
    if (moveIndex === undefined || board[moveIndex]!== null) return;

    board[moveIndex] = aiSymbol;
    match.state.currentPlayer = aiSymbol === 'X'? 'O' : 'X';

    const winner = checkMorpionWinner(board);
    if (winner) {
      match.played = true;
      if (winner === 'draw') {
        match.winner = 'draw';
      } else {
        match.winner = winner === aiSymbol? match.p1.id : match.p2.id;
      }
      io.to(`match-${match.id}`).emit('gameOver', { winner: match.winner });
      checkAndGenerateNextRound();
      io.emit('dashboardUpdate');
    } else {
      io.to(`match-${match.id}`).emit('move', {
        board,
        currentPlayer: match.state.currentPlayer
      });
      const nextAiSymbol = match.p1.isAI? 'X' : match.p2.isAI? 'O' : null;
      if (nextAiSymbol && match.state.currentPlayer === nextAiSymbol) {
        setTimeout(() => handleAIMove(match), 1000);
      }
    }
  }
}

function genererProgramme() {
  tournament.matches = [];
  let joueurs = melanger([...tournament.players.filter(p =>!p.eliminated)]);

  if (joueurs.length % 2 === 1) {
    joueurs.push({
      id: 'AI_' + Date.now(),
      firstname: 'IA',
      name: 'Bot',
      isAI: true,
      accessCode: 'AI',
      gameType: joueurs[joueurs.length-1]?.gameType || 'dame'
    });
  }

  for (let i = 0; i < joueurs.length; i += 2) {
    let jeuMatch = joueurs[i].gameType || 'dame';
    let match = {
      id: Date.now() + i,
      round: tournament.currentRound,
      gameType: jeuMatch,
      p1: joueurs[i],
      p2: joueurs[i + 1],
      winner: null,
      played: false,
      datetime: new Date(Date.now() + Math.floor(i / 2) * 24 * 60 * 60 * 1000)
    };
    initializeMatchState(match);
    tournament.matches.push(match);
  }
  tournament.status = 'running';
}

function checkAndGenerateNextRound() {
  const currentRoundMatches = tournament.matches.filter(m => m.round === tournament.currentRound);
  const allPlayed = currentRoundMatches.every(m => m.played);
  if (!allPlayed) return;

  const winners = currentRoundMatches
   .map(m => {
      if (m.winner === 'draw') return null;
      const winnerId = typeof m.winner === 'object'? m.winner.id : m.winner;
      if (String(winnerId).startsWith('AI_')) return null;
      return tournament.players.find(p => p.id === winnerId);
    })
   .filter(p => p);

  if (winners.length === 1) {
    tournament.status = 'finished';
    tournament.winner = winners[0];
    io.emit('dashboardUpdate');
    return;
  }

  tournament.currentRound++;
  let joueurs = melanger([...winners]);

  if (joueurs.length % 2 === 1) {
    joueurs.push({
      id: 'AI_' + Date.now(),
      firstname: 'IA',
      name: 'Bot',
      isAI: true,
      accessCode: 'AI',
      gameType: joueurs[joueurs.length-1]?.gameType || 'dame'
    });
  }

  for (let i = 0; i < joueurs.length; i += 2) {
    let match = {
      id: Date.now() + i,
      round: tournament.currentRound,
      gameType: joueurs[i].gameType || 'dame',
      p1: joueurs[i],
      p2: joueurs[i + 1],
      winner: null,
      played: false,
      datetime: new Date(Date.now() + Math.floor(i / 2) * 24 * 60 * 60 * 1000)
    };
    initializeMatchState(match);
    tournament.matches.push(match);
  }
  io.emit('dashboardUpdate');
}

// Socket
io.on('connection', (socket) => {
  // Quand un user se connecte au dashboard ou au jeu
  socket.on('userOnline', ({ playerId, firstname, name, currentGame }) => {
    onlineUsers.set(socket.id, {
      id: playerId,
      firstname,
      name,
      currentGame: currentGame || null,
      lastActivity: Date.now()
    });
    io.emit('dashboardUpdate');
  });

  socket.on('updateGame', ({ currentGame }) => {
    if (onlineUsers.has(socket.id)) {
      onlineUsers.get(socket.id).currentGame = currentGame;
      onlineUsers.get(socket.id).lastActivity = Date.now();
    }
  });

  socket.on('joinMatch', ({ matchId, accessCode, token }) => {
    const match = tournament.matches.find(m => String(m.id) === String(matchId));
    if (!match || match.played) return socket.emit('error', 'Match invalide');

    const player = tournament.players.find(p => p.accessCode === accessCode || String(p.id) === String(token));
    if (!player || (player.id!== match.p1.id && player.id!== match.p2.id)) {
      return socket.emit('error', 'Code invalide');
    }

    socket.join(`match-${matchId}`);
    socket.matchId = String(matchId);
    socket.playerId = player.id;

    if (!liveMatches[matchId]) liveMatches[matchId] = { players: new Set() };
    liveMatches[matchId].players.add(socket.id);

    const symbol = player.id === match.p1.id? 'X' : 'O';
    socket.emit('gameStart', { symbol, state: match.state, gameType: match.gameType });

    if (liveMatches[matchId].players.size === 2 || match.p1.isAI || match.p2.isAI) {
      io.to(`match-${matchId}`).emit('matchReady', { msg: 'Match prêt', gameType: match.gameType });
    }

    const aiSymbol = match.p1.isAI? 'X' : match.p2.isAI? 'O' : null;
    if (aiSymbol && match.state.currentPlayer === aiSymbol) {
      setTimeout(() => handleAIMove(match), 1000);
    }
  });

  socket.on('makeMove', ({ matchId, token, move }) => {
    const match = tournament.matches.find(m => String(m.id) === String(matchId));
    if (!match || match.played) return;

    if (match.gameType === 'morpion') {
      const { index } = move;
      if (match.state.board[index]) return;

      const symbol = String(match.p1.id) === String(token)? 'X' : 'O';
      if (match.state.currentPlayer!== symbol) return;

      match.state.board[index] = symbol;
      const winner = checkMorpionWinner(match.state.board);

      if (winner) {
        match.played = true;
        if (winner === 'draw') {
          match.winner = 'draw';
        } else {
          match.winner = winner === 'X'? match.p1.id : match.p2.id;
        }
        io.to(`match-${matchId}`).emit('gameOver', { winner: match.winner });
        checkAndGenerateNextRound();
        io.emit('dashboardUpdate');
      } else {
        match.state.currentPlayer = match.state.currentPlayer === 'X'? 'O' : 'X';
        io.to(`match-${matchId}`).emit('move', {
          board: match.state.board,
          currentPlayer: match.state.currentPlayer
        });

        const aiSymbol = match.p1.isAI? 'X' : match.p2.isAI? 'O' : null;
        if (aiSymbol && match.state.currentPlayer === aiSymbol) {
          setTimeout(() => handleAIMove(match), 1000);
        }
      }
      return;
    }

    socket.to(`match-${socket.matchId}`).emit('opponentAction', move);
  });

  socket.on('playerAction', data => {
    socket.to(`match-${socket.matchId}`).emit('opponentAction', data);
  });

  socket.on('matchEnd', ({ winnerId }) => {
    const match = tournament.matches.find(m => String(m.id) === String(socket.matchId));
    if (!match || match.played) return;

    match.winner = winnerId;
    match.played = true;
    checkAndGenerateNextRound();
    io.emit('dashboardUpdate');
    io.to(`match-${socket.matchId}`).emit('matchOver', { winnerId });

    if (liveMatches[socket.matchId]) {
      delete liveMatches[socket.matchId];
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    if (socket.matchId && liveMatches[socket.matchId]) {
      io.to(`match-${socket.matchId}`).emit('opponentLeft', { msg: 'Adversaire déconnecté' });
      delete liveMatches[socket.matchId];
    }
    io.emit('dashboardUpdate');
  });
});

// API inscription simple
app.post('/api/player/register', (req, res) => {
  const { firstname, name, phone } = req.body;
  if (!firstname ||!name ||!phone) {
    return res.status(400).json({ error: 'Remplis tout' });
  }
  if (fullGamePlayers.find(p => p.phone === phone)) {
    return res.status(400).json({ error: 'Déjà inscrit' });
  }
  fullGamePlayers.push({
    id: Date.now() + Math.random(),
    firstname,
    name,
    phone,
    joinedAt: Date.now()
  });
  io.emit('dashboardUpdate');
  res.json({ success: true, player: { firstname, name, phone } });
});

// API Tournoi inscription multi-jeux
app.post('/api/tournament/join', (req, res) => {
  if (tournament.status!== 'registration') {
    return res.status(400).json({ error: 'Les inscriptions sont fermées' });
  }
  const { name, firstname, phone, games } = req.body;
  if (!name ||!firstname ||!phone) {
    return res.status(400).json({ error: 'Nom, prénom et téléphone requis' });
  }
  if (!games ||!Array.isArray(games) || games.length === 0) {
    return res.status(400).json({ error: 'Choisis au moins 1 jeu' });
  }
  if (!validatePhone(phone)) {
    return res.status(400).json({ error: 'Numéro invalide' });
  }
  if (tournament.players.find(p => p.phone === phone)) {
    return res.status(400).json({ error: 'Ce numéro est déjà inscrit' });
  }

  const accessCode = generateAccessCode(phone);
  const player = {
    id: Date.now() + Math.random(),
    name,
    firstname,
    phone,
    accessCode,
    games,
    gameType: games[0],
    wins: 0,
    losses: 0,
    eliminated: false,
    joinedAt: Date.now(),
    status: 'active'
  };
  tournament.players.push(player);
  io.emit('dashboardUpdate');
  res.json({ success: true, accessCode, message: `Inscrit! Ton code: ${accessCode}` });
});
app.get('/api/programme', (req, res) => {
  res.json({
    round: tournament.currentRound,
    matches: tournament.matches
  });
});

app.post('/api/tournament/enter-match', (req, res) => {
  const { token } = req.body;

  const player = fullGamePlayers.find(p => String(p.id) === String(token));

  if (!player) {
    return res.json({ error: "Joueur non reconnu" });
  }

  const match = tournament.matches.find(m =>
    (String(m.p1.id) === String(player.id) ||
     String(m.p2.id) === String(player.id)) &&
    !m.played
  );

  if (!match) {
    return res.json({ error: "Aucun match pour toi" });
  }

  const now = Date.now();
  const matchTime = new Date(match.datetime).getTime();

  if (now < matchTime) {
    return res.json({
      error: "Ton match n'a pas encore commencé"
    });
  }

  res.json({
    success: true,
    matchId: match.id,
    gameType: match.gameType
  });
});
// API Dashboard MODIFIÉE
app.get('/api/dashboard', (req, res) => {
  const actifs = tournament.players.filter(p =>!p.eliminated).length;
  const nouveaux = tournament.players.filter(p => p.joinedAt > Date.now() - 86400000).length;

  // Compter par jeu
  const byGame = { dame: 0, echecs: 0, morpion: 0, puissance4: 0 };
  tournament.players.forEach(p => {
    if (p.games) {
      p.games.forEach(g => {
        if (byGame[g]!== undefined) byGame[g]++;
      });
    } else if (p.gameType && byGame[p.gameType]!== undefined) {
      byGame[p.gameType]++;
    }
  });

  // Joueurs en ligne
  const online = Array.from(onlineUsers.values()).map(u => ({
    firstname: u.firstname,
    name: u.name,
    online: true,
    currentGame: u.currentGame || '-',
    lastActivity: timeAgo(u.lastActivity)
  }));

  // Activité récente site
  const activity = [...fullGamePlayers,...tournament.players]
   .sort((a, b) => b.joinedAt - a.joinedAt)
   .slice(0, 5)
   .map(p => ({
      player: `${p.firstname} ${p.name}`,
      action: 'Inscription',
      time: timeAgo(p.joinedAt)
    }));

  res.json({
    site: {
      inscrits: fullGamePlayers.length + tournament.players.length,
      actifs: fullGamePlayers.length + actifs,
      nouveaux: fullGamePlayers.filter(p => p.joinedAt > Date.now() - 86400000).length + nouveaux,
      activity: activity
    },
    tournament: {
      inscrits: tournament.players.length,
      actifs: actifs,
      nouveaux: nouveaux,
      status: tournament.status,
      currentRound: tournament.currentRound,
      matches: tournament.matches,
      players: tournament.players,
      byGame: byGame
    },
    online: online,
    gameComplete: {
      inscrits: fullGamePlayers.length,
      actifs: fullGamePlayers.length,
      nouveaux: fullGamePlayers.filter(p => p.joinedAt > Date.now() - 86400000).length,
      retention: '0%'
    }
  });
});

// Reset
app.post('/api/tournament/reset', (req, res) => {
  tournament = { players: [], matches: [], status: 'closed', currentRound: 0, winner: null };
  fullGamePlayers = [];
  accounts.clear();
  onlineUsers.clear();
  io.emit('dashboardUpdate');
  res.json({ success: true });
});

// Auth
app.post('/api/auth/register', (req, res) => {
  const { email, password, firstname, name } = req.body;
  if (!email ||!password ||!firstname ||!name) {
    return res.status(400).json({ error: 'Remplis tout' });
  }
  if (accounts.has(email)) {
    return res.status(400).json({ error: 'Email déjà utilisé' });
  }

  const playerId = Date.now() + Math.random();
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const player = {
    id: playerId,
    email,
    firstname,
    name,
    games: ['dame', 'morpion', 'puissance4', 'echecs'],
    gameType: 'dame',
    wins: 0,
    losses: 0,
    eliminated: false,
    joinedAt: Date.now(),
    status: 'active'
  };

  fullGamePlayers.push(player);
  accounts.set(email, { passwordHash, playerId });
  io.emit('dashboardUpdate');
  res.json({ success: true, player, token: playerId });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!accounts.has(email)) {
    return res.status(404).json({
      error: "Vous n'avez pas de compte GameOnline"
    });
  }

  const account = accounts.get(email);

  const passwordHash = crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');

  if (account.passwordHash !== passwordHash) {
    return res.status(403).json({
      error: 'Mot de passe incorrect'
    });
  }

  const player = fullGamePlayers.find(
    p => p.id === account.playerId
  );

  if (!player) {
    return res.status(404).json({
      error: 'Profil introuvable'
    });
  }

  res.json({
    success: true,
    player,
    token: player.id
  });
});
// Timezone Kinshasa
process.env.TZ = 'Africa/Kinshasa';

// Samedi 00:00 : Ouverture inscriptions
schedule.scheduleJob('0 0 * 6', () => {
  tournament = { players: [], matches: [], status: 'registration', currentRound: 0, winner: null };
  fullGamePlayers = [];
  accounts.clear();
  onlineUsers.clear();
  io.emit('dashboardUpdate');
  console.log('=== Inscriptions ouvertes ===');
});

// Dimanche 23:59 : Fermeture + génération programme
schedule.scheduleJob('59 23 * 0', () => {
  if (tournament.players.length < 2) {
    tournament.status = 'closed';
    console.log('Pas assez de joueurs. Tournoi annulé.');
    io.emit('dashboardUpdate');
    return;
  }
  tournament.currentRound = 1;
  genererProgramme();
  io.emit('dashboardUpdate');
  console.log('=== Inscriptions fermées. Tournoi lancé ===');
});

// Vérifier le jour au démarrage du serveur
const day = new Date().getDay();

if (day === 6 || day === 0) {
  tournament.status = 'registration';
  console.log('✅ Inscriptions ouvertes automatiquement');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur sur http://localhost:${PORT}`);
  console.log('Heure serveur Kinshasa:', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' }));
});
