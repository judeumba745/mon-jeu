document.addEventListener("DOMContentLoaded", () => {
  const plateau = document.getElementById("plateau");
  if (!plateau) {
    console.error("Erreur : #plateau introuvable dans le HTML");
    return;
  }

  let selected = null;
  let tour = "rouge";
  let scoreRouge = 0;
  let scoreBleu = 0;

  // ========== MODE JEU ==========
  let modeJeu = 'ia'; // 'ia' ou 'player'
  let monCouleur = null;

  // ========== CREATE BOARD ==========
  for (let l = 0; l < 8; l++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.classList.add("case");
      cell.dataset.l = l;
      cell.dataset.c = c;
      if ((l + c) % 2 === 0) {
        cell.classList.add("gold");
      } else {
        cell.classList.add("noir");
        if (l < 3) {
          cell.appendChild(createPion("bleu"));
        }
        if (l > 4) {
          cell.appendChild(createPion("rouge"));
        }
      }
      cell.onclick = () => play(cell);
      plateau.appendChild(cell);
    }
  }

  // ========== INIT JEU APPELÉ DEPUIS jeu.html ==========
  window.initJeu = function(mode, couleurServeur = null) {
    modeJeu = mode;
    monCouleur = couleurServeur;
    if (mode === 'player' && monCouleur === 'bleu') {
      lockPlateau(); // si je suis bleu, j'attends que rouge joue
    }
  }

  // ========== CREATE PION ==========
  function createPion(color) {
    const p = document.createElement("div");
    p.className = "pion " + color;
    p.onclick = (e) => {
      e.stopPropagation();
      if (modeJeu === 'player' && color !== monCouleur) return;
      if (!p.classList.contains(tour)) return;
      document.querySelectorAll(".selected").forEach(x => x.classList.remove("selected"));
      p.classList.add("selected");
      selected = p;
    };
    return p;
  }

  // ========== PLAY ==========
  function play(cell) {
    if (!selected) return;
    if (cell.children.length > 0) return;
    if (cell.classList.contains("gold")) return;

    const current = selected.parentElement;
    const l1 = parseInt(current.dataset.l);
    const c1 = parseInt(current.dataset.c);
    const l2 = parseInt(cell.dataset.l);
    const c2 = parseInt(cell.dataset.c);
    const dl = l2 - l1;
    const dc = c2 - c1;
    const reine = selected.classList.contains("reine");
    let coupValide = false;
    let coupEnemy = null;

    // PION NORMAL
    if (!reine) {
      let direction = selected.classList.contains("rouge") ? -1 : 1;
      if (dl === direction && Math.abs(dc) === 1) {
        move(selected, cell);
        coupValide = true;
      }
      else if (Math.abs(dl) === 2 && Math.abs(dc) === 2) {
        const ml = l1 + dl / 2;
        const mc = c1 + dc / 2;
        const middle = getCell(ml, mc);
        const enemy = middle.querySelector(".pion");
        if (enemy && !enemy.classList.contains(tour)) {
          enemy.remove();
          coupEnemy = enemy;
          if (tour === "rouge") {
            scoreRouge++;
            document.getElementById("scoreRouge").innerText = scoreRouge;
          } else {
            scoreBleu++;
            document.getElementById("scoreBleu").innerText = scoreBleu;
          }
          move(selected, cell);
          coupValide = true;
        }
      }
    }
    // REINE
    else {
      if (Math.abs(dl) === Math.abs(dc)) {
        let stepL = dl > 0 ? 1 : -1;
        let stepC = dc > 0 ? 1 : -1;
        let l = l1 + stepL;
        let c = c1 + stepC;
        let enemyFound = null;
        while (l !== l2 && c !== c2) {
          const test = getCell(l, c);
          if (test.children.length > 0) {
            const p = test.querySelector(".pion");
            if (p.classList.contains(tour)) return;
            if (enemyFound) return;
            enemyFound = p;
          }
          l += stepL;
          c += stepC;
        }
        if (enemyFound) {
          enemyFound.remove();
          coupEnemy = enemyFound;
          if (tour === "rouge") {
            scoreRouge++;
            document.getElementById("scoreRouge").innerText = scoreRouge;
          } else {
            scoreBleu++;
            document.getElementById("scoreBleu").innerText = scoreBleu;
          }
        }
        move(selected, cell);
        coupValide = true;
      }
    }

    if (!coupValide) return;

    // PROMOTION REINE
    if (selected.classList.contains("rouge") && l2 === 0) {
      selected.classList.add("reine");
      selected.innerHTML = "👑";
    }
    if (selected.classList.contains("bleu") && l2 === 7) {
      selected.classList.add("reine");
      selected.innerHTML = "👑";
    }

    selected.classList.remove("selected");
    selected = null;

    // Si mode tournoi, on envoie le coup au serveur et on bloque
    if (modeJeu === 'player') {
      envoyerCoup({l: l1, c: c1}, {l: l2, c: c2});
      lockPlateau();
    }

    // Changement de tour
    tour = tour === "rouge" ? "bleu" : "rouge";

    // AJOUT : Vérifie si le joueur dont c'est le tour est bloqué
    if (!hasLegalMove(tour)) {
      const gagnant = tour === "rouge" ? "Bleu" : "Rouge";
      finish(`💀 ${gagnant} gagne ! ${tour} est bloqué.`);
      return;
    }

    checkWin();

    // Mode IA : l'IA joue seulement si c'est le tour du bleu
    if (modeJeu === 'ia' && tour === "bleu") {
      setTimeout(aiPlay, 500);
    }
  }

  // ========== MOVE ==========
  function move(pion, cell) {
    cell.appendChild(pion);
  }

  // ========== LOCK/UNLOCK POUR TOURNOI ==========
  function lockPlateau() {
    plateau.style.pointerEvents = 'none';
    plateau.style.opacity = '0.6';
  }

  function unlockPlateau() {
    plateau.style.pointerEvents = 'auto';
    plateau.style.opacity = '1';
  }

  // ========== JOUER COUP ADVERSAIRE EN TOURNOI ==========
  window.jouerCoupAdversaire = function(from, to) {
    const fromCell = getCell(from.l, from.c);
    const toCell = getCell(to.l, to.c);
    const pion = fromCell.querySelector('.pion');
    if (!pion) return;

    move(pion, toCell);

    // Gérer la capture si c'est un saut de 2
    const dl = to.l - from.l;
    if (Math.abs(dl) === 2) {
      const ml = from.l + dl / 2;
      const mc = from.c + (to.c - from.c) / 2;
      const middle = getCell(ml, mc);
      const enemy = middle.querySelector('.pion');
      if (enemy) {
        enemy.remove();
        if (pion.classList.contains('rouge')) {
          scoreRouge++;
          document.getElementById("scoreRouge").innerText = scoreRouge;
        } else {
          scoreBleu++;
          document.getElementById("scoreBleu").innerText = scoreBleu;
        }
      }
    }

    // Promotion
    if ((to.l === 0 && pion.classList.contains('rouge')) || (to.l === 7 && pion.classList.contains('bleu'))) {
      pion.classList.add('reine');
      pion.innerHTML = '👑';
    }

    unlockPlateau();
    tour = monCouleur;

    // AJOUT : Vérifie si l'adversaire est bloqué après son coup
    if (!hasLegalMove(tour)) {
      const gagnant = tour === "rouge" ? "Bleu" : "Rouge";
      finish(`💀 ${gagnant} gagne ! ${tour} est bloqué.`);
      return;
    }

    checkWin();
  }

  // ========== AJOUT : Vérifie si un joueur a un coup légal ==========
  function hasLegalMove(couleur) {
    const pions = document.querySelectorAll(`.pion.${couleur}`);
    for (let pion of pions) {
      const cell = pion.parentElement;
      if (!cell) continue;
      const l = parseInt(cell.dataset.l);
      const c = parseInt(cell.dataset.c);
      const reine = pion.classList.contains("reine");

      const directions = reine
        ? [[1,1], [1,-1], [-1,1], [-1,-1]]
        : couleur === "rouge"
          ? [[-1,1], [-1,-1]]
          : [[1,1], [1,-1]];

      for (let [dl, dc] of directions) {
        let l2 = l + dl, c2 = c + dc;
        let cell2 = getCell(l2, c2);
        if (!cell2) continue;
       
        // Déplacement simple
        if (cell2.children.length === 0 && !cell2.classList.contains("gold")) return true;
       
        // Capture
        let l3 = l + 2*dl, c3 = c + 2*dc;
        let cell3 = getCell(l3, c3);
        let enemy = cell2.querySelector(".pion");
        if (cell3 && cell3.children.length === 0 && enemy && !enemy.classList.contains(couleur)) return true;
      }
    }
    return false;
  }

  // ========== IA MINIMAX ULTRA FORTE ==========
  function aiPlay() {
    const moves = getAllAIMoves();
    if (moves.length === 0) return;
    let bestScore = -999;
    let bestMove = null;
    moves.forEach(move => {
      const score = minimax(move, 3, false);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    });
    if (!bestMove) return;
    if (bestMove.enemy) {
      bestMove.enemy.remove();
      scoreBleu++;
      document.getElementById("scoreBleu").innerText = scoreBleu;
    }
    move(bestMove.pion, bestMove.target);
    const l = parseInt(bestMove.target.dataset.l);
    if (l === 7 && !bestMove.pion.classList.contains("reine")) {
      bestMove.pion.classList.add("reine");
      bestMove.pion.innerHTML = "👑";
    }
    tour = "rouge";

    // Vérifie si rouge est bloqué après le coup de l'IA
    if (!hasLegalMove("rouge")) {
      finish("💀 Bleu gagne ! Rouge est bloqué.");
      return;
    }

    checkWin();
  }

  function getAllAIMoves() {
    const moves = [];
    const cases = document.querySelectorAll(".case");
    cases.forEach(cell => {
      const pion = cell.querySelector(".bleu");
      if (!pion) return;
      const reine = pion.classList.contains("reine");
      const l = parseInt(cell.dataset.l);
      const c = parseInt(cell.dataset.c);
      if (reine) {
        const dirs = [[1,1], [1,-1], [-1,1], [-1,-1]];
        dirs.forEach(d => {
          let step = 1;
          let enemyFound = null;
          while (true) {
            const nl = l + d[0] * step;
            const nc = c + d[1] * step;
            const target = getCell(nl, nc);
            if (!target) break;
            if (target.children.length > 0) {
              const p = target.querySelector(".pion");
              if (p.classList.contains("bleu")) break;
              if (!enemyFound) {
                enemyFound = p;
              } else {
                break;
              }
            } else {
              moves.push({ pion, target, enemy: enemyFound, score: enemyFound ? 500 : 30 });
            }
            step++;
          }
        });
      } else {
        const dirs = [[1,-1], [1,1], [2,-2], [2,2], [-2,-2], [-2,2]];
        dirs.forEach(d => {
          const nl = l + d[0];
          const nc = c + d[1];
          const target = getCell(nl, nc);
          if (!target || target.children.length > 0) return;
          if (Math.abs(d[0]) === 2) {
            const middle = getCell(l + d[0]/2, c + d[1]/2);
            const enemy = middle?.querySelector(".rouge");
            if (enemy) {
              moves.push({ pion, target, enemy, score: 200 });
            }
          } else {
            moves.push({ pion, target, score: 20 });
          }
        });
      }
    });
    return moves;
  }

  function minimax(move, depth, maximizing) {
    if (depth === 0) {
      return evaluateBoard();
    }
    let score = move.score || 0;
    if (move.pion.classList.contains("reine")) {
      score += 100;
    }
    const l = parseInt(move.target.dataset.l);
    if (l === 7) {
      score += 200;
    }
    const c = parseInt(move.target.dataset.c);
    if (c === 0 || c === 7) {
      score += 50;
    }
    if (c > 1 && c < 6) {
      score += 20;
    }
    if (maximizing) {
      return score + depth * 10;
    } else {
      return score - depth * 5;
    }
  }

  function evaluateBoard() {
    let score = 0;
    const bleus = document.querySelectorAll(".bleu");
    const rouges = document.querySelectorAll(".rouge");
    score += bleus.length * 100;
    score -= rouges.length * 100;
    document.querySelectorAll(".bleu.reine").forEach(() => {
      score += 300;
    });
    document.querySelectorAll(".rouge.reine").forEach(() => {
      score -= 300;
    });
    return score;
  }

  function getCell(l, c) {
    return document.querySelector(`.case[data-l='${l}'][data-c='${c}']`);
  }

  function checkWin() {
    const rouges = document.querySelectorAll(".rouge");
    const bleus = document.querySelectorAll(".bleu");
    if (rouges.length === 0) {
      finish("💀 GAME OVER");
    }
    if (bleus.length === 0) {
      finish("🏆 VICTOIRE");
    }
  }

  function finish(text) {
    const gameOver = document.getElementById("gameOver");
    if (gameOver) {
      gameOver.style.display = "flex";
      gameOver.innerText = text;
    }
    if (modeJeu === 'player' && window.finDePartie && window.monId) {
      window.finDePartie(window.monId);
    }
  }
});