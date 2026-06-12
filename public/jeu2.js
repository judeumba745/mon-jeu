let board = Array(9).fill('');
let currentPlayer = 'X'; // X=toi, O=IA/adversaire
let gameOver = false;
let mode = null;
let socket = null;
let mySymbol = 'X';

const boardDiv = document.getElementById('board');
const statusDiv = document.getElementById('status');
const menuDiv = document.getElementById('menu');
const resetBtn = document.getElementById('resetBtn');

// Créer plateau 3x3
for(let i = 0; i < 9; i++) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.dataset.index = i;
  cell.onclick = () => play(i);
  boardDiv.appendChild(cell);
}

// MENU
function startGame(selectedMode) {
  mode = selectedMode;
  menuDiv.style.display = 'none';
  resetBtn.style.display = 'block';

  if(mode === 'online') {
    socket = io();
    statusDiv.textContent = 'Recherche adversaire...';

    socket.on('startMorpion', (data) => {
      mySymbol = data.symbol;
      currentPlayer = 'X';
      statusDiv.textContent = `Tu es ${mySymbol}. Tour: ${currentPlayer === mySymbol? 'Toi' : 'Adversaire'}`;
    });

    socket.on('moveMorpion', (data) => {
      board[data.index] = data.symbol;
      updateBoard();
      currentPlayer = currentPlayer === 'X'? 'O' : 'X';
      if(!checkWinner() &&!gameOver) {
        statusDiv.textContent = `Tour: ${currentPlayer === mySymbol? 'Toi' : 'Adversaire'}`;
      }
    });

    socket.on('winMorpion', (data) => {
      statusDiv.textContent = data.symbol === mySymbol? 'Tu as gagné!' : 'Tu as perdu!';
      gameOver = true;
    });
  } else {
    statusDiv.textContent = 'Tour: X. Tu commences!';
  }
  reset();
}

function play(index) {
  if(gameOver || board[index]!== '') return;
  if(mode === 'online' && currentPlayer!== mySymbol) return;

  board[index] = currentPlayer;
  updateBoard();

  if(checkWinner()) {
    statusDiv.textContent = mode === 'ia'? (currentPlayer === 'X'? 'Tu as gagné!' : 'IA a gagné!') : `Victoire ${currentPlayer}!`;
    gameOver = true;
    if(mode === 'online') socket.emit('winMorpion', {symbol: currentPlayer});
    return;
  }

  if(board.every(cell => cell!== '')) {
    statusDiv.textContent = 'Match nul!';
    gameOver = true;
    return;
  }

  if(mode === 'online') {
    socket.emit('moveMorpion', {index, symbol: currentPlayer});
  }

  currentPlayer = currentPlayer === 'X'? 'O' : 'X';

  if(mode === 'ia' && currentPlayer === 'O') {
    statusDiv.textContent = 'IA réfléchit...';
    setTimeout(iaPlay, 400);
    return;
  }

  statusDiv.textContent = `Tour: ${currentPlayer}`;
}

function updateBoard() {
  document.querySelectorAll('.cell').forEach((cell, i) => {
    cell.textContent = board[i];
    cell.className = 'cell';
    if(board[i] === 'X') cell.classList.add('x');
    if(board[i] === 'O') cell.classList.add('o');
  });
}

// IA MINIMAX - Imbattable
function iaPlay() {
  if(gameOver) return;

  let bestScore = -Infinity;
  let bestMove = null;

  for(let i = 0; i < 9; i++) {
    if(board[i] === '') {
      board[i] = 'O';
      let score = minimax(board, 0, false);
      board[i] = '';
      if(score > bestScore) {
        bestScore = score;
        bestMove = i;
      }
    }
  }

  board[bestMove] = 'O';
  updateBoard();

  if(checkWinner()) {
    gameOver = true;
    statusDiv.textContent = 'IA a gagné!';
    return;
  }

  if(board.every(cell => cell!== '')) {
    gameOver = true;
    statusDiv.textContent = 'Match nul!';
    return;
  }

  currentPlayer = 'X';
  statusDiv.textContent = 'Tour: X';
}

function minimax(newBoard, depth, isMaximizing) {
  let winner = checkWinner();
  if(winner === 'O') return 10 - depth;
  if(winner === 'X') return depth - 10;
  if(newBoard.every(cell => cell!== '')) return 0;

  if(isMaximizing) {
    let bestScore = -Infinity;
    for(let i = 0; i < 9; i++) {
      if(newBoard[i] === '') {
        newBoard[i] = 'O';
        let score = minimax(newBoard, depth + 1, false);
        newBoard[i] = '';
        bestScore = Math.max(score, bestScore);
      }
    }
    return bestScore;
  } else {
    let bestScore = Infinity;
    for(let i = 0; i < 9; i++) {
      if(newBoard[i] === '') {
        newBoard[i] = 'X';
        let score = minimax(newBoard, depth + 1, true);
        newBoard[i] = '';
        bestScore = Math.min(score, bestScore);
      }
    }
    return bestScore;
  }
}

function checkWinner() {
  const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for(let [a,b,c] of wins) {
    if(board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function reset() {
  board = Array(9).fill('');
  currentPlayer = 'X';
  gameOver = false;
  if(mode!== 'online') statusDiv.textContent = 'Tour: X';
  updateBoard();
}
