const express = require('express');
const path = require('path');
const cron = require('node-cron');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

let liveMatches = {};

app.use(express.json());
app.use(express.static('public'));

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/mode.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mode.html')));
app.get('/jeu.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jeu.html')));
app.get('/programme.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'programme.html')));
app.get('/inscription.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inscription.html')));
app.get('/tournoi.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tournoi.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// Tournoi
let tournament = {
  players: [],
  matches: [],
  status: 'closed', // closed, registration, running, finished
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

// Générer programme avec IA si impair
function genererProgramme() {
  tournament.matches = [];
  let joueurs = melanger([...tournament.players.filter(p =>!p.eliminated)]);

  // Ajoute IA si impair
  if (joueurs.length % 2 === 1) {
    joueurs.push({ id: 'AI_' + Date.now(), firstname: 'IA', name: 'Bot', isAI: true, accessCode: 'AI' });
  }

  for (let i = 0; i < joueurs.length; i += 2) {
    tournament.matches.push({
      id: Date.now() + i,
      round: tournament.currentRound,
      p1: joueurs[i],
      p2: joueurs[i + 1],
      winner: null,
      played: false,
      datetime: new Date(Date.now() + Math.floor(i/2) * 24 * 60 * 60 * 1000) // 1 match/jour
    });
  }
  tournament.status = 'running';
  console.log(`Tour ${tournament.currentRound} généré: ${tournament.matches.length} matchs`);
}

function checkAndGenerateNextRound() {
  const currentRoundMatches = tournament.matches.filter(m => m.round === tournament.currentRound);
  const allPlayed = currentRoundMatches.every(m => m.played);
  if (!allPlayed) return;

  const winners = currentRoundMatches
   .map(m => {
      if (m.winner === 'AI') return null;
      return tournament.players.find(p => p.id === m.winner);
    })
   .filter(p => p);

  // Si 1 gagnant = fin du tournoi
  if (winners.length === 1) {
    tournament.status = 'finished';
    tournament.winner = winners[0];
    console.log('Tournoi terminé. Vainqueur:', winners[0].firstname);
    return;
  }

  // Tour suivant
  tournament.currentRound++;
  let joueurs = melanger([...winners]);

  // Ajoute IA si impair
  if (joueurs.length % 2 === 1) {
    joueurs.push({ id: 'AI_' + Date.now(), firstname: 'IA', name: 'Bot', isAI: true, accessCode: 'AI' });
  }

  for (let i = 0; i < joueurs.length; i += 2) {
    tournament.matches.push({
      id: Date.now() + i,
      round: tournament.currentRound,
      p1: joueurs[i],
      p2: joueurs[i + 1],
      winner: null,
      played: false,
      datetime: new Date(Date.now() + Math.floor(i/2) * 24 * 60 * 60 * 1000)
    });
  }
  console.log(`Tour ${tournament.currentRound} généré`);
}

// API Inscription simple
app.post('/api/player/register', (req, res) => {
  const { firstname, name, phone } = req.body;
  if (!firstname ||!name ||!phone) {
    return res.status(400).json({ error: 'Remplis tout' });
  }
  res.json({ success: true, player: { firstname, name, phone } });
});

// API Tournoi inscription
app.post('/api/tournament/join', (req, res) => {
  if (tournament.status!== 'registration') {
    return res.status(400).json({ error: 'Les inscriptions sont fermées' });
  }
  const { name, firstname, phone } = req.body;
  if (!name ||!firstname ||!phone) {
    return res.status(400).json({ error: 'Nom, prénom et téléphone requis' });
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
    wins: 0,
    losses: 0,
    eliminated: false
  };
  tournament.players.push(player);
  res.json({ success: true, accessCode, message: `Inscrit! Ton code: ${accessCode}` });
});

// API Entrer match
app.post('/api/tournament/enter-match', (req, res) => {
  const { firstname, name, code } = req.body;
  const player = tournament.players.find(p =>
    p.firstname.toLowerCase() === firstname.toLowerCase() &&
    p.name.toLowerCase() === name.toLowerCase()
  );

  if (!player) return res.status(404).json({ error: 'Joueur non trouvé' });
  if (player.accessCode!== code) return res.status(403).json({ error: 'Code incorrect' });
  if (player.eliminated) return res.status(403).json({ error: 'Tu es éliminé' });
  if (tournament.status!== 'running') return res.status(400).json({ error: 'Tournoi pas en cours' });

  const match = tournament.matches.find(m =>
   !m.played && (m.p1.id === player.id || m.p2.id === player.id)
  );

  if (!match) return res.status(400).json({ error: 'Aucun match pour toi' });
  res.json({ success: true, matchId: match.id });
});

// API Résultat match
app.post('/api/tournament/result', (req, res) => {
  const { matchId, winnerId } = req.body;
  const match = tournament.matches.find(m => m.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match introuvable' });
  if (match.played) return res.status(400).json({ error: 'Match déjà joué' });

  match.winner = winnerId;
  match.played = true;

  // Si vs IA, le joueur gagne auto
  if (match.p1.id === 'AI' || match.p2.id === 'AI') {
    match.winner = match.p1.id === 'AI'? match.p2.id : match.p1.id;
  }

  const loserId = match.p1.id === match.winner? match.p2.id : match.p1.id;
  const winnerPlayer = tournament.players.find(p => p.id === match.winner);
  const loserPlayer = tournament.players.find(p => p.id === loserId);

  if (winnerPlayer) winnerPlayer.wins++;
  if (loserPlayer) {
    loserPlayer.losses++;
    loserPlayer.eliminated = true;
  }

  checkAndGenerateNextRound();
  res.json({ success: true });
});

// API Programme
app.get('/api/programme', (req, res) => {
  res.json({
    matches: tournament.matches,
    status: tournament.status,
    round: tournament.currentRound,
    winner: tournament.winner
  });
});

// API Classement
app.get('/api/tournament/ranking', (req, res) => {
  const ranking = [...tournament.players]
   .sort((a, b) => {
      if (a.eliminated!== b.eliminated) return a.eliminated? 1 : -1;
      if (b.wins!== a.wins) return b.wins - a.wins;
      return a.losses - b.losses;
    })
   .map((p, i) => ({
      rank: i + 1,
     ...p,
      status: p.eliminated? 'Éliminé' : tournament.status === 'finished' && tournament.winner && p.id === tournament.winner.id? 'Vainqueur' : 'En course'
    }));

  res.json({
    status: tournament.status,
    round: tournament.currentRound,
    ranking,
    matches: tournament.matches,
    winner: tournament.winner
  });
});

// API Dashboard
app.get('/api/dashboard', (req, res) => {
  res.json({
    players: tournament.players,
    tournament: {
      length: tournament.players.length,
      matches: tournament.matches,
      status: tournament.status,
      round: tournament.currentRound
    },
    gameComplete: {
      inscrits: 1254,
      actifs: 892,
      nouveaux: 342,
      retention: '68%'
    }
  });
});

// API Reset
app.post('/api/tournament/reset', (req, res) => {
  tournament = {
    players: [],
    matches: [],
    status: 'closed',
    currentRound: 0,
    winner: null
  };
  res.json({ success: true });
});

const schedule = require('node-schedule');

// Samedi 00:00 : Ouverture inscriptions
schedule.scheduleJob('0 0 * 6', () => {
  tournament = {
    players: [],
    matches: [],
    status: 'registration',
    currentRound: 0,
    winner: null
  };
  console.log('=== Inscriptions ouvertes ===');
});

// Dimanche 23:59 : Fermeture + génération programme
schedule.scheduleJob('59 23 * 0', () => {
  if (tournament.players.length < 2) {
    console.log('Pas assez de joueurs. Tournoi annulé.');
    tournament.status = 'closed';
    return;
  }
  tournament.currentRound = 1;
  genererProgramme();
  console.log('=== Inscriptions fermées. Tournoi lancé ===');
});

// ====== SOCKET.IO POUR LES MATCHS LIVE ======
io.on('connection', (socket) => {
  console.log('Socket connecté:', socket.id);

  socket.on('joinMatch', ({ matchId, accessCode }) => {
    const match = tournament.matches.find(m => m.id == matchId);
    if (!match || match.played) return socket.emit('error', 'Match invalide');

    const player = tournament.players.find(p => p.accessCode === accessCode);
    if (!player || (player.id!== match.p1.id && player.id!== match.p2.id)) {
      return socket.emit('error', 'Code invalide');
    }

    socket.join(matchId);
    socket.playerId = player.id;
    socket.matchId = matchId;

    if (!liveMatches[matchId]) {
      liveMatches[matchId] = { players: [] };
    }
    liveMatches[matchId].players.push(socket.id);

    socket.emit('joined', { msg: `Connecté au match ${matchId}` });

    const couleur = player.id === match.p1.id? 'rouge' : 'bleu';
    socket.emit('matchStart', { monId: player.id, couleur });

    if (liveMatches[matchId].players.length === 2) {
      io.to(matchId).emit('matchStart', { msg: 'Les 2 joueurs sont connectés. Go!' });
    }
  });

  socket.on('playerAction', (data) => {
    socket.to(socket.matchId).emit('opponentAction', data);
  });

  socket.on('matchEnd', ({ winnerId }) => {
    const match = tournament.matches.find(m => m.id == socket.matchId);
    if (match &&!match.played) {
      match.winner = winnerId;
      match.played = true;
      checkAndGenerateNextRound();
      io.to(socket.matchId).emit('matchOver', { winnerId });
      delete liveMatches[socket.matchId];
    }
  });

  socket.on('disconnect', () => {
    if (socket.matchId && liveMatches[socket.matchId]) {
      io.to(socket.matchId).emit('opponentLeft', { msg: 'Adversaire déconnecté' });
      delete liveMatches[socket.matchId];
    }
  });
});

// Lancement du serveur
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Serveur sur http://localhost:${PORT}`);
});


