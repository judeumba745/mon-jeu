const pieces = {
    'r':'♜','n':'♞','b':'♝','q':'♛','k':'♚','p':'♟',
    'R':'♖','N':'♘','B':'♗','Q':'♕','K':'♔','P':'♙'
};
let board = [
    'r','n','b','q','k','b','n','r',
    'p','p','p','p','p','p','p','p',
    '','','','',
    '','','','',
    '','','','',
    '','','','',
    'P','P','P','P','P','P','P','P',
    'R','N','B','Q','K','B','N','R'
];
let tour = "blanc";
let selected = null;
let gameOver = false;
let modeJeu = 'ia'; // 'ia' = tu joues blancs, IA = noirs

const plateau = document.getElementById("plateau");
for(let i = 0; i < 64; i++) {
    const cell = document.createElement("div");
    cell.classList.add("case");
    cell.classList.add((Math.floor(i/8) + i%8) % 2 === 0? "blanc" : "noir");
    cell.dataset.index = i;
    if(board[i]) cell.innerText = pieces[board[i]];
    cell.onclick = () => click(i, cell);
    plateau.appendChild(cell);
}

function click(index, cell) {
    if(gameOver || tour!== "blanc") return;
    if(selected === null && board[index] && board[index] === board[index].toUpperCase()) {
        selected = index;
        cell.classList.add("selected");
        return;
    }
    if(selected!== null) {
        document.querySelector(".selected")?.classList.remove("selected");
        if(isValidMove(selected, index)) {
            board[index] = board[selected];
            board[selected] = "";
            updateBoard();

            if(checkMate("noir")) return endGame("Tu as gagné!");

            tour = "noir";
            document.getElementById("status").innerText = "IA réfléchit...";
            setTimeout(aiPlay, 800);
        }
        selected = null;
    }
}

function aiPlay() {
    let moves = getAllMoves("noir");
    if(moves.length === 0) return endGame("Tu as gagné!");

    // IA niveau débutant : prend si possible, sinon bouge au hasard
    let captureMoves = moves.filter(m => board[m.to] && board[m.to] === board[m.to].toUpperCase());
    let move = captureMoves.length > 0? captureMoves[Math.floor(Math.random()*captureMoves.length)] : moves[Math.floor(Math.random()*moves.length)];

    board[move.to] = board[move.from];
    board[move.from] = "";
    updateBoard();

    if(checkMate("blanc")) return endGame("IA a gagné!");

    tour = "blanc";
    document.getElementById("status").innerText = "Ton tour";
}

function getAllMoves(color) {
    let moves = [];
    for(let i = 0; i < 64; i++) {
        if(board[i] && ((color === "blanc" && board[i] === board[i].toUpperCase()) || (color === "noir" && board[i] === board[i].toLowerCase()))) {
            for(let j = 0; j < 64; j++) {
                if(isValidMove(i, j)) moves.push({from: i, to: j});
            }
        }
    }
    return moves;
}

function isValidMove(from, to) {
    const piece = board[from].toLowerCase();
    const fx = from % 8, fy = Math.floor(from/8);
    const tx = to % 8, ty = Math.floor(to/8);
    const dx = tx - fx, dy = ty - fy;

    if(board[to] && ((board[from] === board[from].toUpperCase()) === (board[to] === board[to].toUpperCase()))) return false;

    if(piece === 'p') {
        let dir = board[from] === 'P'? -1 : 1;
        if(dx === 0 && dy === dir && board[to] === "") return true;
        if(Math.abs(dx) === 1 && dy === dir && board[to] && board[to]!== board[to].toUpperCase()) return true;
        return false;
    }
    if(piece === 'r') return dx === 0 || dy === 0;
    if(piece === 'n') return (Math.abs(dx) === 2 && Math.abs(dy) === 1) || (Math.abs(dx) === 1 && Math.abs(dy) === 2);
    if(piece === 'b') return Math.abs(dx) === Math.abs(dy);
    if(piece === 'q') return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    if(piece === 'k') return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
    return false;
}

function checkMate(color) {
    const king = color === "blanc"? 'K' : 'k';
    return!board.includes(king);
}

function updateBoard() {
    document.querySelectorAll(".case").forEach((cell, i) => {
        cell.innerText = board[i]? pieces[board[i]] : "";
    });
}

function endGame(msg) {
    gameOver = true;
    document.getElementById("gameOver").innerText = `🎉 ${msg}`;
    document.getElementById("gameOver").style.display = "flex";
    document.getElementById("status").innerText = "Partie terminée";
}
