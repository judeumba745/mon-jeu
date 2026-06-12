const rows = 6, cols = 7;
let board = Array(rows).fill().map(() => Array(cols).fill(0));
let currentPlayer = 1; // 1=Rouge, 2=Jaune
let gameOver = false;

const boardDiv = document.getElementById('board');
const statusDiv = document.getElementById('status');

// Créer le plateau
for(let r = 0; r < rows; r++) {
  for(let c = 0; c < cols; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.row = r;
    cell.dataset.col = c;
    cell.onclick = () => play(c);
    boardDiv.appendChild(cell);
  }
}

function play(col) {
  if(gameOver) return;

  // Trouver la ligne la plus basse libre
  for(let r = rows-1; r >= 0; r--) {
    if(board[r][col] === 0) {
      board[r][col] = currentPlayer;
      updateBoard();

      if(checkWin(r, col)) {
        statusDiv.textContent = `Victoire ${currentPlayer === 1? 'Rouge' : 'Jaune'}!`;
        gameOver = true;
        return;
      }

      if(board.flat().every(cell => cell!== 0)) {
        statusDiv.textContent = 'Match nul!';
        gameOver = true;
        return;
      }

      currentPlayer = currentPlayer === 1? 2 : 1;
      statusDiv.textContent = `Tour: ${currentPlayer === 1? 'Rouge' : 'Jaune'}`;
      return;
    }
  }
}

function updateBoard() {
  document.querySelectorAll('.cell').forEach(cell => {
    const r = cell.dataset.row, c = cell.dataset.col;
    cell.className = 'cell';
    if(board[r][c] === 1) cell.classList.add('rouge');
    if(board[r][c] === 2) cell.classList.add('jaune');
  });
}

function checkWin(r, c) {
  const player = board[r][c];
  const dirs = [[0,1], [1,0], [1,1], [1,-1]]; // horiz, vert, diag

  for(let [dr, dc] of dirs) {
    let count = 1;
    for(let i = 1; i < 4; i++) {
      if(r+dr*i >= 0 && r+dr*i < rows && c+dc*i >= 0 && c+dc*i < cols && board[r+dr*i][c+dc*i] === player) count++;
      else break;
    }
    for(let i = 1; i < 4; i++) {
      if(r-dr*i >= 0 && r-dr*i < rows && c-dc*i >= 0 && c-dc*i < cols && board[r-dr*i][c-dc*i] === player) count++;
      else break;
    }
    if(count >= 4) return true;
  }
  return false;
}

function reset() {
  board = Array(rows).fill().map(() => Array(cols).fill(0));
  currentPlayer = 1;
  gameOver = false;
  statusDiv.textContent = 'Tour: Rouge';
  updateBoard();
}
