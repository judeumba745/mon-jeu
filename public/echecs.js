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

let turn = 'w'; // w=blanc=toi, b=noir=IA/adversaire
let selected = null;
let mode = null;
let myColor = 'w';
let socket = null;
let possibleMoves = [];

const pieces = {r:'♜',n:'♞',b:'♝',q:'♛',k:'♚',p:'♟',R:'♖',N:'♘',B:'♗',Q:'♕',K:'♔',P:'♙'};
const boardDiv = document.getElementById('board');
const statusDiv = document.getElementById('status');
const menuDiv = document.getElementById('menu');
const resetBtn = document.getElementById('resetBtn');

// FONCTION MENU
function startGame(selectedMode) {
  mode = selectedMode;
  menuDiv.style.display = 'none';
  resetBtn.style.display = 'block';

  if(mode === 'online') {
    socket = io();
    statusDiv.textContent = 'Recherche adversaire...';

    socket.on('startChess', (data) => {
      myColor = data.color;
      turn = 'w';
      statusDiv.textContent = `Tu es ${myColor === 'w'? 'Blancs' : 'Noirs'}. Tour: ${turn === myColor? 'Toi' : 'Adversaire'}`;
    });

    socket.on('moveChess', (data) => {
      board[data.to.r][data.to.c] = board[data.from.r][data.from.c];
      board[data.from.r][data.from.c] = 0;
      turn = turn === 'w'? 'b' : 'w';
      selected = null;
      possibleMoves = [];
      draw();
    });
  } else {
    statusDiv.textContent = 'Tour: Blancs. Tu commences!';
  }
  reset();
}

draw();

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
      if(possibleMoves.some(m => m.r == r && m.c == c)) sq.classList.add('possible');

      sq.onclick = () => click(r, c);
      boardDiv.appendChild(sq);
    }
  }
  if(mode!== 'online') statusDiv.textContent = `Tour: ${turn === 'w'? 'Blancs' : 'Noirs'}`;
}

function click(r, c) {
  if(mode === 'online' && turn!== myColor) return;

  const piece = board[r][c];
  const isWhite = piece && piece === piece.toUpperCase();

  if(selected) {
    // Déplacer si coup légal
    if(possibleMoves.some(m => m.r == r && m.c == c)) {
      const from = selected;
      board[r][c] = board[from.r][from.c];
      board[from.r][from.c] = 0;
      turn = turn === 'w'? 'b' : 'w';

      if(mode === 'online') socket.emit('moveChess', {from, to: {r,c}});
      else if(mode === 'ia' && turn === 'b') setTimeout(iaPlay, 500);

      selected = null;
      possibleMoves = [];
    } else {
      selected = null;
      possibleMoves = [];
    }
  } else if(piece && ((turn === 'w' && isWhite) || (turn === 'b' &&!isWhite))) {
    selected = {r, c};
    possibleMoves = getMoves(r, c, piece);
  }
  draw();
}

// Mouvements simplifiés
function getMoves(r, c, piece) {
  const moves = [];
  const isWhite = piece === piece.toUpperCase();
  const type = piece.toLowerCase();
  const dir = isWhite? -1 : 1;

  if(type === 'p') {
    if(r+dir >= 0 && r+dir < 8 &&!board[r+dir][c]) moves.push({r:r+dir, c});
    if(r+dir >= 0 && r+dir < 8 && c-1 >= 0 && board[r+dir][c-1] && isWhite?!board[r+dir][c-1].toUpperCase() === board[r+dir][c-1] : board[r+dir][c+1] &&!board[r+dir][c+1].toUpperCase() === board[r+dir][c+1]) {
      if(c-1 >= 0 && board[r+dir][c-1]) moves.push({r:r+dir, c:c-1});
      if(c+1 < 8 && board[r+dir][c+1]) moves.push({r:r+dir, c:c+1});
    }
  }
  if(type === 'r' || type === 'q') for(let d of [[1,0],[-1,0],[0,1],[0,-1]]) slide(r,c,d[0],d[1],moves,isWhite);
  if(type === 'b' || type === 'q') for(let d of [[1,1],[-1,1],[1,-1],[-1,-1]]) slide(r,c,d[0],d[1],moves,isWhite);
  if(type === 'n') for(let d of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) {
    let nr=r+d[0], nc=c+d[1];
    if(nr>=0 && nr<8 && nc>=0 && nc<8 && (!board[nr][nc] || isWhite?!board[nr][nc].toUpperCase() === board[nr][nc] : board[nr][nc].toUpperCase() === board[nr][nc])) moves.push({r:nr,c:nc});
  }
  if(type === 'k') for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++) {
    let nr=r+dr, nc=c+dc;
    if(nr>=0 && nr<8 && nc>=0 && nc<8 && (!board[nr][nc] || isWhite?!board[nr][nc].toUpperCase() === board[nr][nc] : board[nr][nc].toUpperCase() === board[nr][nc])) moves.push({r:nr,c:nc});
  }
  return moves;
}

function slide(r,c,dr,dc,moves,isWhite) {
  let nr=r+dr, nc=c+dc;
  while(nr>=0 && nr<8 && nc>=0 && nc<8) {
    if(!board[nr][nc]) moves.push({r:nr,c:nc});
    else {
      if(isWhite?!board[nr][nc].toUpperCase() === board[nr][nc] : board[nr][nc].toUpperCase() === board[nr][nc]) moves.push({r:nr,c:nc});
      break;
    }
    nr+=dr; nc+=dc;
  }
}

// IA ÉCHECS - joue coup random mais légal
function iaPlay() {
  if(turn!== 'b' || mode!== 'ia') return;

  let allMoves = [];
  for(let r=0; r<8; r++) for(let c=0; c<8; c++) {
    if(board[r][c] && board[r][c] === board[r][c].toLowerCase()) {
      let moves = getMoves(r,c,board[r][c]);
      moves.forEach(m => allMoves.push({from:{r,c}, to:m}));
    }
  }

  if(allMoves.length > 0) {
    let move = allMoves[Math.floor(Math.random()*allMoves.length)];
    board[move.to.r][move.to.c] = board[move.from.r][move.from.c];
    board[move.from.r][move.from.c] = 0;
    turn = 'w';
    statusDiv.textContent = 'Tour: Blancs';
  }
  selected = null;
  possibleMoves = [];
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
  possibleMoves = [];
  if(mode!== 'online') statusDiv.textContent = 'Tour: Blancs';
  draw();
}
