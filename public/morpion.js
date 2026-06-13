
const plateau = document.getElementById("plateau");
const status = document.getElementById("status");
let board = Array(9).fill(null);
let tour = "X";
let gameOver = false;
let modeJeu = 'ia'; // 'ia' ou 'player'

for(let i = 0; i < 9; i++) {
    const cell = document.createElement("div");
    cell.classList.add("case");
    cell.dataset.index = i;
    cell.onclick = () => play(i, cell);
    plateau.appendChild(cell);
}

function play(index, cell) {
    if(board[index] || gameOver || tour!== "X") return;
    makeMove(index, "X");

    if(checkWinner()) return;

    tour = "O";
    status.innerText = "IA réfléchit...";
    setTimeout(aiPlay, 500);
}

function makeMove(index, player) {
    board[index] = player;
    const cell = document.querySelector(`.case[data-index='${index}']`);
    cell.innerText = player;
    cell.style.color = player === "X"? "#ef4444" : "#3b82f6";

    const winner = checkWinner();
    if(winner) {
        gameOver = true;
        const msg = winner === "draw"? "🤝 Match nul!" : `🎉 ${winner === "X"? "Tu as gagné!" : "IA a gagné!"}`;
        document.getElementById("gameOver").innerText = msg;
        document.getElementById("gameOver").style.display = "flex";
        status.innerText = "Partie terminée";
        return true;
    }
    return false;
}

function aiPlay() {
    let bestScore = -Infinity;
    let move;
    for(let i = 0; i < 9; i++) {
        if(board[i] === null) {
            board[i] = "O";
            let score = minimax(board, 0, false);
            board[i] = null;
            if(score > bestScore) {
                bestScore = score;
                move = i;
            }
        }
    }
    makeMove(move, "O");
    tour = "X";
    status.innerText = "Ton tour";
}

function minimax(newBoard, depth, isMaximizing) {
    const winner = checkWinnerBoard(newBoard);
    if(winner === "O") return 10 - depth;
    if(winner === "X") return depth - 10;
    if(winner === "draw") return 0;

    if(isMaximizing) {
        let bestScore = -Infinity;
        for(let i = 0; i < 9; i++) {
            if(newBoard[i] === null) {
                newBoard[i] = "O";
                let score = minimax(newBoard, depth + 1, false);
                newBoard[i] = null;
                bestScore = Math.max(score, bestScore);
            }
        }
        return bestScore;
    } else {
        let bestScore = Infinity;
        for(let i = 0; i < 9; i++) {
            if(newBoard[i] === null) {
                newBoard[i] = "X";
                let score = minimax(newBoard, depth + 1, true);
                newBoard[i] = null;
                bestScore = Math.min(score, bestScore);
            }
        }
        return bestScore;
    }
}

function checkWinner() {
    const winner = checkWinnerBoard(board);
    if(winner) {
        gameOver = true;
        const msg = winner === "draw"? "🤝 Match nul!" : `🎉 ${winner === "X"? "Tu as gagné!" : "IA a gagné!"}`;
        document.getElementById("gameOver").innerText = msg;
        document.getElementById("gameOver").style.display = "flex";
        status.innerText = "Partie terminée";
        return winner;
    }
    return null;
}

function checkWinnerBoard(b) {
    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for(let [a,c,d] of wins) {
        if(b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
    }
    if(b.every(c => c)) return "draw";
    return null;
}
