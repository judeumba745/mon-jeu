let board = [
  ['r','n','b','q','k','b','n','r'],
  ['p','p','p','p','p','p','p','p'],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  ['P','P','P','P','P','P','P','P'],
  ['R','N','B','Q','K','B','N','R']
];

let turn = 'w'; // w=blanc, b=noir
let selected = null;
const pieces = {r:'♜',n:'♞',b:'♝',q:'♛',k:'♚',p:'♟',R:'♖',N:'♘',B:'♗',Q:'♕',K:'♔',P:'♙'};
const boardDiv = document.getElementById('board');
const statusDiv = document.getElementById('status');

// Dessiner plateau
function draw() {
  boardDiv.innerHTML = '';
  for(let r = 0; r < 8; r++) {
    for(let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      sq.className = `square ${(r+c)%2 === 0? 'white' : 'black'}`;
      sq.dataset.r = r;
      sq.dataset.c = c;
      sq.textContent = pieces[board[r][c]] || '';
      if(selected && selected.r == r && selected.c == c) sq.classList.add('selected');
      sq.onclick = () => click(r, c);
      boardDiv.appendChild(sq);
    }
  }
  statusDiv.textContent = `Tour: ${turn === 'w'? 'Blancs' : 'Noirs'}`;
}

function click(r, c) {
  const piece = board[r][c];
  const isWhite = piece && piece === piece.toUpperCase();

  if(selected) {
    // Déplacer si c'est le tour
    if((turn === 'w' && isWhite) || (turn === 'b' &&!isWhite && piece)) return;
    board[r][c] = board[selected.r][selected.c];
    board[selected.r][selected.c] = 0;
    turn = turn === 'w'? 'b' : 'w';
    selected = null;
  } else if(piece && ((turn === 'w' && isWhite) || (turn === 'b' &&!isWhite))) {
    selected = {r, c};
  }
  draw();
}

function reset() {
  board = [
    ['r','n','b','q','k','b','n','r'],
    ['p','p','p','p','p','p','p','p'],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0],
    ['P','P','P','P','P','P','P','P'],
    ['R','N','B','Q','K','B','N','R']
  ];
  turn = 'w';
  selected = null;
  draw();
}

draw();
