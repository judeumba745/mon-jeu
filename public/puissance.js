const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode'); // 'ia' ou 'online'

const rows = 6, cols = 7;
let board = Array(rows).fill().map(() => Array(cols).fill(0));
let currentPlayer = 1; // 1=Rouge=toi, 2=Jaune=IA ou adversaire
let gameOver = false;
let myColor = 1;
let socket = null;

const boardDiv = document.getElementById('board');
const statusDiv = document.getElementById('status');

// Créer plateau
for(let r = 0; r < rows; r++) {
  for(let c = 0; c < cols; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.col = c;
    cell.onclick = () => play(c);
    boardDiv.appendChild(cell);
  }
}

// MODE ONLINE avec Socket.io
if(mode === 'online') {
  socket = io();
  statusDiv.textContent = 'Recherche adversaire...';

  socket.on('start', (data) => {
    myColor = data.color;
    currentPlayer = 1;
    statusDiv.textContent = `Tour: ${currentPlayer === myColor? 'Toi' : 'Adversaire'}`;
  });

  socket.on('move', (data) => {
    board[data.row][data.col] = data.player;
    updateBoard();
    currentPlayer = currentPlayer === 1? 2 : 1;
    if(!checkWin(data.row, data.col)) {
      statusDiv.textContent = `Tour: ${currentPlayer === myColor? 'Toi' : 'Adversaire'}`;
    }
  });

  socket.on('win', (data) => {
    statusDiv.textContent = data.player === myColor? 'Tu as gagné!' : 'Tu as perdu!';
    gameOver = true;
  });
}

function play(col) {
  if(gameOver) return;
  if(mode === 'online' && currentPlayer!== myColor) return;

  for(let r = rows-1; r >= 0; r--) {
    if(board[r][col] === 0) {
      board[r][col] = currentPlayer;
      updateBoard();

      if(checkWin(r, col)) {
        statusDiv.textContent = `Victoire ${currentPlayer === 1? 'Rouge' : 'Jaune'}!`;
        gameOver = true;
        if(mode === 'online') socket.emit('win', {player: currentPlayer});
        return;
      }

      if(board.flat().every(cell => cell!== 0)) {
        statusDiv.textContent = 'Match nul!';
        gameOver = true;
        return;
      }

      if(mode === 'online') {
        socket.emit('move', {row: r, col: col, player: currentPlayer});
      } else if(mode === 'ia' && currentPlayer === 1) {
        // Tour de l'IA
        currentPlayer = 2;
        statusDiv.textContent = 'IA réfléchit...';
        setTimeout(iaPlay, 500);
        return;
      }

      currentPlayer = currentPlayer === 1? 2 : 1;
      statusDiv.textContent = `Tour: ${currentPlayer === 1? 'Rouge' : 'Jaune'}`;
      return;
    }
  }
}

// IA simple mais forte
function iaPlay() {
  if(gameOver) return;

  // 1. Gagner si possible
  for(let c = 0; c < cols; c++) {
    let r = getLowestRow(c);
    if(r!== -1) {
      board[r][c] = 2;
      if(checkWin(r, c)) {updateBoard(); gameOver = true; statusDiv.textContent = 'IA gagne!'; return;}
      board[r][c] = 0;
    }
  }

  // 2. Bloquer joueur
  for(let c = 0; c < cols; c++) {
    let r = getLowestRow(c);
    if(r!== -1) {
      board[r][c] = 1;
      if(checkWin(r, c)) {board[r][c] = 2; updateBoard(); currentPlayer = 1; statusDiv.textContent = 'Tour: Rouge'; return;}
      board[r][c] = 0;
    }
  }

  // 3. Jouer centre sinon random
  let col = [3,2,4,1,5,0,6].find(c => getLowestRow(c)!== -1) || Math.floor(Math.random()*7);
  let r = getLowestRow(col);
  board[r][col] = 2;
  updateBoard();
  currentPlayer = 1;
  statusDiv.textContent = 'Tour: Rouge';
}

function getLowestRow(col) {
  for(let r = rows-1; r >= 0; r--) if(board[r][col] === 0) return r;
  return -1;
}

function updateBoard() {
  document.querySelectorAll('.cell').forEach(cell => {
    const r = Array.from(boardDiv.children).indexOf(cell) / cols | 0;
    const c = cell.dataset.col;
    cell.className = 'cell';
    if(board[r][c] === 1) cell.classList.add('rouge');
    if(board[r][c] === 2) cell.classList.add('jaune');
  });
}

function checkWin(r, c) {
  const player = board[r][c];
  const dirs = [[0,1], [1,0], [1,1], [1,-1]];
  for(let [dr, dc] of dirs) {
    let count = 1;
    for(let i = 1; i < 4; i++) if(r+dr*i >= 0 && r+dr*i < rows && c+dc*i >= 0 && c+dc*i < cols && board[r+dr*i][c+dc*i] === player) count++; else break;
    for(let i = 1; i < 4; i++) if(r-dr*i >= 0 && r-dr*i < rows && c-dc*i >= 0 && c-dc*i < cols && board[r-dr*i][c-dc*i] === player) count++; else break;
    if(count >= 4) return true;
  }
  return false;
}
