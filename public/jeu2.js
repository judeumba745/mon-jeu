const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const playAIButton = document.getElementById('playAI');
const playOnlineButton = document.getElementById('playOnline');

let board = Array(9).fill('');
let currentPlayer = 'X';
let gameMode = null; // 'AI' ou 'ONLINE'
let socket = null;
let roomId = null;

// --- Création du plateau ---
function renderBoard() {
  boardEl.innerHTML = '';
  board.forEach((cell, idx) => {
    const cellEl = document.createElement('div');
    cellEl.classList.add('cell');
    cellEl.textContent = cell;
    cellEl.addEventListener('click', () => handleClick(idx));
    boardEl.appendChild(cellEl);
  });
}

// --- Vérifier victoire ---
function checkWin(bd, player) {
  const winCombos = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  return winCombos.some(combo => combo.every(i => bd[i] === player));
}

function checkDraw(bd) {
  return bd.every(cell => cell !== '');
}

// --- IA simple aléatoire ---
function aiMove() {
  const empty = board.map((v,i) => v === '' ? i : null).filter(v => v !== null);
  const move = empty[Math.floor(Math.random() * empty.length)];
  board[move] = 'O';
  currentPlayer = 'X';
  renderBoard();
  checkGameOver();
}

// --- Gérer le clic sur une case ---
function handleClick(idx) {
  if (board[idx] !== '' || (gameMode === 'AI' && currentPlayer === 'O')) return;

  if (gameMode === 'AI') {
    board[idx] = 'X';
    currentPlayer = 'O';
    renderBoard();
    if (!checkGameOver()) setTimeout(aiMove, 300);
  }

  if (gameMode === 'ONLINE') {
    if (currentPlayer === playerSymbol) {
      board[idx] = playerSymbol;
      renderBoard();
      socket.emit('move', { index: idx, roomId });
      checkGameOver();
      currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
    }
  }
}

// --- Vérifier fin de partie ---
function checkGameOver() {
  if (checkWin(board, 'X')) {
    statusEl.textContent = "X gagne !";
    return true;
  } else if (checkWin(board, 'O')) {
    statusEl.textContent = "O gagne !";
    return true;
  } else if (checkDraw(board)) {
    statusEl.textContent = "Match nul !";
    return true;
  }
  statusEl.textContent = currentPlayer + " à jouer";
  return false;
}

// --- Mode IA ---
playAIButton.addEventListener('click', () => {
  board = Array(9).fill('');
  currentPlayer = 'X';
  gameMode = 'AI';
  statusEl.textContent = "X à jouer";
  renderBoard();
});

// --- Mode Multijoueur ---
let playerSymbol = null;
playOnlineButton.addEventListener('click', () => {
  board = Array(9).fill('');
  gameMode = 'ONLINE';
  socket = io(); // connexion au serveur
  statusEl.textContent = "Connexion au serveur...";
  
  socket.emit('joinRoom'); // demander une room

  socket.on('roomJoined', (data) => {
    roomId = data.roomId;
    playerSymbol = data.symbol;
    statusEl.textContent = `Vous êtes ${playerSymbol}. ${currentPlayer} commence.`;
    renderBoard();
  });

  socket.on('opponentMove', (data) => {
    board[data.index] = data.symbol;
    currentPlayer = playerSymbol;
    renderBoard();
    checkGameOver();
  });

  socket.on('opponentLeft', () => {
    statusEl.textContent = "L'adversaire a quitté le jeu.";
  });
});

renderBoard();
