
const cols = 7, rows = 6;
const plateau = document.getElementById("plateau");
let board = Array(rows).fill().map(() => Array(cols).fill(null));
let tour = "rouge";
let gameOver = false;

for(let r = 0; r < rows; r++) {
    for(let c = 0; c < cols; c++) {
        const cell = document.createElement("div");
        cell.classList.add("case");
        cell.dataset.col = c;
        cell.onclick = () => drop(c);
        plateau.appendChild(cell);
    }
}

function drop(col) {
    if(gameOver || tour!== "rouge") return;
    for(let r = rows-1; r >= 0; r--) {
        if(!board[r][col]) {
            board[r][col] = "rouge";
            const cell = document.querySelector(`.case[data-row='${r}'][data-col='${col}']`);
            cell.style.gridRow = r+1;
            cell.classList.add("rouge");

            if(checkWin(r, col, "rouge")) return endGame("Tu as gagné!");

            tour = "jaune";
            document.getElementById("status").innerText = "IA réfléchit...";
            setTimeout(aiPlay, 800);
            return;
        }
    }
}

function aiPlay() {
    let bestCol = -1;
    let bestScore = -Infinity;

    // IA check d'abord si elle peut gagner
    for(let c = 0; c < cols; c++) {
        let r = getFreeRow(c);
        if(r!== -1) {
            board[r][c] = "jaune";
            if(checkWin(r, c, "jaune")) {
                bestCol = c;
                board[r][c] = null;
                break;
            }
            board[r][c] = null;
        }
    }

    // Sinon check si doit bloquer joueur
    if(bestCol === -1) {
        for(let c = 0; c < cols; c++) {
            let r = getFreeRow(c);
            if(r!== -1) {
                board[r][c] = "rouge";
                if(checkWin(r, c, "rouge")) {
                    bestCol = c;
                    board[r][c] = null;
                    break;
                }
                board[r][c] = null;
            }
        }
    }

    // Sinon joue au centre
    if(bestCol === -1) {
        const prefs = [3,2,4,1,5,0,6];
        for(let c of prefs) {
            if(getFreeRow(c)!== -1) {
                bestCol = c;
                break;
            }
        }
    }

    let r = getFreeRow(bestCol);
    board[r][bestCol] = "jaune";
    const cell = document.querySelector(`.case[data-row='${r}'][data-col='${bestCol}']`);
    cell.style.gridRow = r+1;
    cell.classList.add("jaune");

    if(checkWin(r, bestCol, "jaune")) return endGame("IA a gagné!");

    tour = "rouge";
    document.getElementById("status").innerText = "Ton tour";
}

function getFreeRow(col) {
    for(let r = rows-1; r >= 0; r--) {
        if(!board[r][col]) return r;
    }
    return -1;
}

function checkWin(r, c, player) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for(let [dr, dc] of dirs) {
        let count = 1;
        for(let i = 1; i < 4; i++) {
            if(board[r+dr*i]?.[c+dc*i] === player) count++; else break;
        }
        for(let i = 1; i < 4; i++) {
            if(board[r-dr*i]?.[c-dc*i] === player) count++; else break;
        }
        if(count >= 4) return true;
    }
    return false;
}

function endGame(msg) {
    gameOver = true;
    document.getElementById("gameOver").innerText = `🎉 ${msg}`;
    document.getElementById("gameOver").style.display = "flex";
    document.getElementById("status").innerText = "Partie terminée";
}
