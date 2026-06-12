const rows = 6, cols = 7;
let board = Array(rows).fill().map(() => Array(cols).fill(0));
let currentPlayer = 1; // 1=Rouge=toi, 2=Jaune=IA/adversaire
let gameOver = false;
let mode = null;
let socket = null;
let myColor = 1;

const boardDiv = document.getElementById('board');
const statusDiv = document.getElementById('status');
const menuDiv = document.getElementById('menu');
const resetBtn = document.getElementById('resetBtn');

// Créer plateau 6x7
for(let r = 0; r < rows; r++) {
  for(let c = 0; c < cols; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.col = c;
    cell.onclick = () => play(c);
    boardDiv.appendChild(cell);
  }
}

// FONCTION MENU
function startGame(selectedMode) {
  mode = selectedMode;
  menuDiv.style.display = 'none';
  resetBtn.style.display = 'block';

  if(mode === 'online') {
    socket = io();
    statusDiv.textContent = 'Recherche adversaire...';

    socket.on('start', (data) => {
      myColor = data.color;
      currentPlayer = 1;
      statusDiv.textContent = `Tu es ${myColor === 1? 'Rouge' : 'Jaune'}. Tour: ${currentPlayer === myColor? 'Toi' : 'Adversaire'}`;
    });

    socket.on('move', (data) => {
      board[data.row][data.col] = data.player;
      updateBoard();
      currentPlayer = currentPlayer === 1? 2 : 1;
      if(!gameOver) statusDiv.textContent = `Tour: ${currentPlayer === myColor? 'Toi' : 'Adversaire'}`;
    });

    socket.on('win', (data) => {
      statusDiv.textContent = data.player === myColor? 'Tu as gagné!' : 'Tu as perdu!';
      gameOver = true;
    });
  } else {
    // MODE IA
    statusDiv.textContent = 'Tour: Rouge. Tu commences!';
  }
  reset();
}

// JOUER
function play(col) {
  if(gameOver) return;
  if(mode === 'online' && currentPlayer!== myColor) return;

  for(let r = rows-1; r >= 0; r--) {
    if(board[r][col] === 0) {
      board[r][col] = currentPlayer;
      updateBoard();

      if(checkWin(r, col)) {
        statusDiv.textContent = mode === 'ia'? (currentPlayer === 1? 'Tu as gagné!' : 'IA a gagné!') : `Victoire ${currentPlayer === 1? 'Rouge' : 'Jaune'}!`;
        gameOver = true;
        if(mode === 'online') socket.emit('win', {player: currentPlayer});
        return;
      }

      if(board.flat().every(cell => cell!== 0)) {
        statusDiv.textContent = 'Match nul!';
        gameOver = true;
        return;
      }

      // Si mode online, envoie le coup
      if(mode === 'online') {
        socket.emit('move', {row: r, col: col, player: currentPlayer});
      }

      // Change de joueur
      currentPlayer = currentPlayer === 1? 2 : 1;

      // Si mode IA et c'est le tour de l'IA
      if(mode === 'ia' && currentPlayer === 2) {
        statusDiv.textContent = 'IA réfléchit...';
        setTimeout(iaPlay, 600); // IA joue après 0.6s
        return;
      }

      statusDiv.textContent = `Tour: ${currentPlayer === 1? 'Rouge' : 'Jaune'}`;
      return;
    }
  }
}

// IA QUI JOUE POUR DE VRAI
function iaPlay() {
  if(gameOver) return;

  // 1. IA gagne si possible
  for(let c = 0; c < cols; c++) {
    let r = getLowestRow(c);
    if(r!== -1) {
      board[r][c] = 2;
      if(checkWin(r, c)) {updateBoard(); gameOver = true; statusDiv.textContent = 'IA a gagné!'; return;}
      board[r][c] = 0;
    }
  }

  // 2. Bloque toi si tu vas gagner
  for(let c = 0; c < cols; c++) {
    let r = getLowestRow(c);
    if(r!== -1) {
      board[r][c] = 1;
      if(checkWin(r, c)) {board[r][c] = 2; updateBoard(); currentPlayer = 1; statusDiv.textContent = 'Tour: Rouge'; return;}
      board[r][c] = 0;
    }
  }

  // 3. Joue au centre sinon random
  let colsOrder = [3,2,4,1,5,0,6];
  let col = colsOrder.find(c => getLowestRow(c)!== -1);
  if(col === undefined) col = Math.floor(Math.random()*7);

  let r = getLowestRow(col);
  board[r][col] = 2;
  updateBoard();

  if(checkWin(r, col)) {
    gameOver = true;
    statusDiv.textContent = 'IA a gagné!';
    return;
  }

  currentPlayer = 1;
  statusDiv.textContent = 'Tour: Rouge';
}

function getLowestRow(col) {
  for(let r = rows-1; r >= 0; r--) if(board[r][col] === 0) return r;
  return -1;
}

function updateBoard() {
  document.querySelectorAll('.cell').forEach((cell, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
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

function reset() {
  board = Array(rows).fill().map(() => Array(cols).fill(0));
  currentPlayer = 1;
  gameOver = false;
  if(mode!== 'online') statusDiv.textContent = 'Tour: Rouge';
  updateBoard();
}
