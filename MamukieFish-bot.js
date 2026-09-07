// Board Representation
const position = [
  ["br","bn","bb","bq","bk","bb","bn","br"],
  ["bp","bp","bp","bp","bp","bp","bp","bp"],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["wp","wp","wp","wp","wp","wp","wp","wp"],
  ["wr","wn","wb","wq","wk","wb","wn","wr"]
];

const pieces = {
  wp:"♙", wr:"♖", wn:"♘", wb:"♗", wq:"♕", wk:"♔",
  bp:"♟", br:"♜", bn:"♞", bb:"♝", bq:"♛", bk:"♚"
};

// Web Audio API Sound Generator
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playMoveSound(isCapture = false) {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  if (isCapture) {
    // Capture sound: Deeper, wooden "thud" with a sharp drop
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  } else {
    // Regular move: Crisp, lighter click
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
  }
}

// Game & Bot State Controls
let selected = null;
let turn = 'w';
let isFlipped = false; 
let botColor = 'b';
let isBotThinking = false;

const board = document.getElementById("board");
const turnDisplay = document.getElementById("turnDisplay");

let pendingPromotion = null;
const promotionPicker = document.getElementById("promotionPicker");
const promoButtons = document.querySelectorAll(".promo-btn");

let movedPieces = {
  whiteKing: false, whiteRookLeft: false, whiteRookRight: false,
  blackKing: false, blackRookLeft: false, blackRookRight: false
};

let enPassantTarget = null;
let stockfish = null;

// Opening Book (Jobava London for White, Petrov/QGD for Black)
const userBook = [
  // --- BOT PLAYS WHITE (Jobava London) ---
  {
    fenPattern: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w",
    move: "d2d4"
  },
  {
    fenPattern: "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w",
    move: "b1c3"
  },
  {
    fenPattern: "rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w",
    move: "b1c3"
  },
  {
    fenPattern: "rnbqkb1r/ppp1pppp/5n2/3p4/3P4/2N5/PPP1PPPP/R1BQKBNR w",
    move: "c1f4"
  },
  {
    fenPattern: "r1bqkbnr/ppp1pppp/2n5/3p4/3P4/2N5/PPP1PPPP/R1BQKBNR w",
    move: "c1f4"
  },

  // --- BOT PLAYS BLACK ---
  {
    fenPattern: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b",
    move: "e7e5"
  },
  {
    fenPattern: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b",
    move: "g8f6"
  },
  {
    fenPattern: "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b",
    move: "d7d5"
  },
  {
    fenPattern: "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b",
    move: "e7e6"
  },
  {
    fenPattern: "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR b",
    move: "g8f6"
  }
];

// CORS-safe Stockfish WebWorker Initialization
fetch("https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js")
  .then(response => response.text())
  .then(code => {
    const blob = new Blob([code], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    stockfish = new Worker(workerUrl);

    stockfish.postMessage("uci");
    stockfish.postMessage("setoption name UCI_LimitStrength value true");
    stockfish.postMessage("setoption name UCI_Elo value 2350");
    stockfish.postMessage("isready");

    stockfish.onmessage = function(event) {
      const line = event.data;
      if (line.startsWith("bestmove")) {
        const moveStr = line.split(" ")[1];
        if (moveStr && isBotThinking) {
          isBotThinking = false;
          makeBotMove(moveStr);
        }
      }
    };
  })
  .catch(err => console.error("Failed to load Stockfish worker:", err));

function positionToFEN() {
  let fen = "";
  for (let r = 0; r < 8; r++) {
    let emptyCount = 0;
    for (let c = 0; c < 8; c++) {
      const p = position[r][c];
      if (!p) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          fen += emptyCount;
          emptyCount = 0;
        }
        const color = p[0];
        const type = p[1];
        let char = type;
        if (color === 'w') char = char.toUpperCase();
        fen += char;
      }
    }
    if (emptyCount > 0) fen += emptyCount;
    if (r < 7) fen += "/";
  }

  fen += ` ${turn} `;

  let castling = "";
  if (!movedPieces.whiteKing) {
    if (!movedPieces.whiteRookRight && position[7][7] === 'wr') castling += "K";
    if (!movedPieces.whiteRookLeft && position[7][0] === 'wr') castling += "Q";
  }
  if (!movedPieces.blackKing) {
    if (!movedPieces.blackRookRight && position[0][7] === 'br') castling += "k";
    if (!movedPieces.blackRookLeft && position[0][0] === 'br') castling += "q";
  }
  fen += (castling || "-") + " ";

  if (enPassantTarget) {
    const colFile = String.fromCharCode('a'.charCodeAt(0) + enPassantTarget.c);
    const rowRank = 8 - enPassantTarget.r;
    fen += `${colFile}${rowRank} `;
  } else {
    fen += "- ";
  }

  fen += "0 1";
  return fen;
}

function triggerBotMove() {
  if (turn !== botColor || isBotThinking) return;

  const currentFEN = positionToFEN();
  const positionAndTurn = currentFEN.split(" ").slice(0, 2).join(" ");
  const matchedBookEntry = userBook.find(entry => entry.fenPattern === positionAndTurn);

  if (matchedBookEntry) {
    makeBotMove(matchedBookEntry.move);
    return;
  }

  if (!stockfish) return;

  isBotThinking = true;
  turnDisplay.textContent = "MamukieFish is thinking...";

  stockfish.postMessage(`position fen ${currentFEN}`);
  stockfish.postMessage("go movetime 800");
}

function parseSquare(sq) {
  const col = sq.charCodeAt(0) - 'a'.charCodeAt(0);
  const row = 8 - parseInt(sq[1], 10);
  return { r: row, c: col };
}

function makeBotMove(moveStr) {
  const from = parseSquare(moveStr.substring(0, 2));
  const to = parseSquare(moveStr.substring(2, 4));
  const promo = moveStr.length === 5 ? moveStr[4] : null;

  executeMove(from.r, from.c, to.r, to.c, promo);
}

function executeMove(fromR, fromC, tor, toc, promoChoice = null) {
  const movingPiece = position[fromR][fromC];
  let isEnPassantCapture = (movingPiece[1] === 'p' && enPassantTarget && tor === enPassantTarget.r && toc === enPassantTarget.c);
  
  const isCapture = position[tor][toc] !== "" || isEnPassantCapture;

  if (isEnPassantCapture) {
    position[fromR][toc] = "";
  }

  if (movingPiece[1] === 'k' && Math.abs(toc - fromC) === 2) {
    const row = fromR;
    if (toc === 6) { 
      position[row][5] = position[row][7];
      position[row][7] = "";
    } else if (toc === 2) { 
      position[row][3] = position[row][0];
      position[row][0] = "";
    }
  }

  position[tor][toc] = movingPiece;
  position[fromR][fromC] = "";

  playMoveSound(isCapture);

  if (promoChoice) {
    position[tor][toc] = turn + promoChoice;
  } else if ((movingPiece === 'wp' && tor === 0) || (movingPiece === 'bp' && tor === 7)) {
    if (turn !== botColor) {
      pendingPromotion = { targetRow: tor, targetCol: toc, color: turn };
      promoButtons.forEach(btn => {
        const pieceType = btn.dataset.piece;
        btn.textContent = pieces[turn + pieceType];
      });
      promotionPicker.classList.remove("hidden");
      selected = null;
      renderBoard();
      return;
    }
  }

  if (fromR === 7 && fromC === 4) movedPieces.whiteKing = true;
  if (fromR === 7 && fromC === 0) movedPieces.whiteRookLeft = true;
  if (fromR === 7 && fromC === 7) movedPieces.whiteRookRight = true;
  if (fromR === 0 && fromC === 4) movedPieces.blackKing = true;
  if (fromR === 0 && fromC === 0) movedPieces.blackRookLeft = true;
  if (fromR === 0 && fromC === 7) movedPieces.blackRookRight = true;

  if (movingPiece[1] === 'p' && Math.abs(tor - fromR) === 2) {
    enPassantTarget = { r: (fromR + tor) / 2, c: fromC };
  } else {
    enPassantTarget = null;
  }

  finishTurn();
}

promoButtons.forEach(button => {
  button.addEventListener("click", function() {
    if (!pendingPromotion) return;
    const chosenType = this.dataset.piece;
    const { targetRow, targetCol, color } = pendingPromotion;
    position[targetRow][targetCol] = color + chosenType;
    promotionPicker.classList.add("hidden");
    pendingPromotion = null;
    finishTurn();
  });
});

function updateTurnUI() {
  if (turn === botColor && isBotThinking) {
    turnDisplay.textContent = "MamukieFish is thinking...";
  } else {
    turnDisplay.textContent = turn === "w" ? "White to move" : "Black to move";
  }
}

function finishTurn() {
  turn = turn === "w" ? "b" : "w";

  selected = null;
  renderBoard();
  updateTurnUI();

  if (!hasLegalMoves(turn)) {
    if (isKingInCheck(turn)) {
      const winner = turn === 'w' ? 'Black' : 'White';
      alert("Checkmate! " + winner + " wins!");
    } else {
      alert("Stalemate! The game is a draw.");
    }
    return;
  }

  if (turn === botColor) {
    setTimeout(triggerBotMove, 250);
  }
}

function renderBoard() {
  board.innerHTML = "";

  for (let displayRow = 0; displayRow < 8; displayRow++) {
    for (let displayCol = 0; displayCol < 8; displayCol++) {
      const row = isFlipped ? 7 - displayRow : displayRow;
      const col = isFlipped ? 7 - displayCol : displayCol;

      const square = document.createElement("div");
      square.classList.add("square");
      if ((row + col) % 2 === 0) square.classList.add("light");
      else square.classList.add("dark");

      if (selected && selected.r === row && selected.c === col) square.classList.add("selected");

      const piece = position[row][col];
      if (piece) square.textContent = pieces[piece];

      square.dataset.row = row;
      square.dataset.col = col;

      square.addEventListener("click", function() {
        if (turn === botColor || isBotThinking) return;

        const tor = Number(this.dataset.row);
        const toc = Number(this.dataset.col);
        const clickedPiece = position[tor][toc];

        if (selected === null) {
          if (clickedPiece && clickedPiece.startsWith(turn)) {
            selected = { r: tor, c: toc };
          }
        } else {
          const fromR = selected.r;
          const fromC = selected.c;
          const movingPiece = position[fromR][fromC];

          if (tor === fromR && toc === fromC) {
            selected = null;
            renderBoard();
            return;
          }

          if (clickedPiece && clickedPiece.startsWith(turn)) {
            selected = { r: tor, c: toc };
            renderBoard();
            return;
          }

          if (isValidMove(movingPiece, fromR, fromC, tor, toc)) {
            const originalTargetPiece = position[tor][toc];
            let isEnPassantCapture = (movingPiece[1] === 'p' && enPassantTarget && tor === enPassantTarget.r && toc === enPassantTarget.c);
            let backupCapturedPawn = "";

            if (isEnPassantCapture) {
              backupCapturedPawn = position[fromR][toc];
              position[fromR][toc] = "";
            }

            position[tor][toc] = movingPiece;
            position[fromR][fromC] = "";

            const putsKingInCheck = isKingInCheck(turn);

            position[fromR][fromC] = movingPiece;
            position[tor][toc] = originalTargetPiece;
            if (isEnPassantCapture) position[fromR][toc] = backupCapturedPawn;

            if (putsKingInCheck) {
              alert("Illegal move: Cannot leave King in check!");
              selected = null;
              renderBoard();
              return;
            }

            executeMove(fromR, fromC, tor, toc);
            return;
          }
          selected = null;
        } 
        renderBoard();
        updateTurnUI();
      });

      board.appendChild(square);
    }
  }
}

function isValidMove(piece, fromR, fromC, toR, toC) {
  const type = piece[1]; 
  const color = piece[0]; 
  const dr = toR - fromR; 
  const dc = toC - fromC; 
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  function isPathClear(rStep, cStep) {
    let currR = fromR + rStep;
    let currC = fromC + cStep;
    while (currR !== toR || currC !== toC) {
      if (position[currR][currC] !== "") return false;
      currR += rStep;
      currC += cStep;
    }
    return true;
  }

  switch (type) {
    case 'p':
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      const targetPiece = position[toR][toC];

      if (dc === 0 && dr === dir && targetPiece === "") return true;
      if (dc === 0 && fromR === startRow && dr === 2 * dir && targetPiece === "" && position[fromR + dir][fromC] === "") return true;
      if (absDc === 1 && dr === dir && targetPiece !== "" && !targetPiece.startsWith(color)) return true;
      if (absDc === 1 && dr === dir && enPassantTarget && toR === enPassantTarget.r && toC === enPassantTarget.c) return true;
      return false;

    case 'r':
      if (fromR !== toR && fromC !== toC) return false; 
      return isPathClear(Math.sign(dr), Math.sign(dc));

    case 'b':
      if (absDr !== absDc) return false; 
      return isPathClear(Math.sign(dr), Math.sign(dc));

    case 'q':
      if (fromR !== toR && fromC !== toC && absDr !== absDc) return false; 
      return isPathClear(Math.sign(dr), Math.sign(dc));

    case 'k':
      if (absDr <= 1 && absDc <= 1) return true; 
      if (dr === 0 && absDc === 2) {
        const isWhite = color === 'w';
        const homeRow = isWhite ? 7 : 0;
        if (fromR !== homeRow || fromC !== 4) return false;
        if (isWhite && movedPieces.whiteKing) return false;
        if (!isWhite && movedPieces.blackKing) return false;
        if (isKingInCheck(color)) return false;

        if (toC === 6) {
          const rookMoved = isWhite ? movedPieces.whiteRookRight : movedPieces.blackRookRight;
          if (rookMoved || position[homeRow][7] !== (color + 'r')) return false;
          if (position[homeRow][5] !== "" || position[homeRow][6] !== "") return false; 
          if (isSquareAttacked(homeRow, 5, color) || isSquareAttacked(homeRow, 6, color)) return false;
          return true;
        }
        if (toC === 2) {
          const rookMoved = isWhite ? movedPieces.whiteRookLeft : movedPieces.blackRookLeft;
          if (rookMoved || position[homeRow][0] !== (color + 'r')) return false;
          if (position[homeRow][1] !== "" || position[homeRow][2] !== "" || position[homeRow][3] !== "") return false; 
          if (isSquareAttacked(homeRow, 3, color) || isSquareAttacked(homeRow, 2, color)) return false;
          return true;
        }
      }
      return false;

    case 'n':
      return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2); 
    default:
      return false;
  }
}

function isSquareAttacked(row, col, friendlyColor) {
  const enemyColor = friendlyColor === 'w' ? 'b' : 'w';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = position[r][c];
      if (piece && piece.startsWith(enemyColor)) {
        if (isValidMove(piece, r, c, row, col)) return true;
      }
    }
  }
  return false;
}

function isKingInCheck(kingColor) {
  let kingR = null, kingC = null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (position[r][c] === kingColor + 'k') {
        kingR = r; kingC = c; break;
      }
    }
    if (kingR !== null) break;
  }
  if (kingR === null) return false;
  return isSquareAttacked(kingR, kingC, kingColor);
}

function hasLegalMoves(color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = position[r][c];
      if (piece && piece.startsWith(color)) {
        for (let tor = 0; tor < 8; tor++) {
          for (let toc = 0; toc < 8; toc++) {
            const target = position[tor][toc];
            if (!target || !target.startsWith(color)) {
              if (isValidMove(piece, r, c, tor, toc)) {
                const originalTarget = position[tor][toc];
                const movingPiece = position[r][c];
                let isEp = (movingPiece[1] === 'p' && enPassantTarget && tor === enPassantTarget.r && toc === enPassantTarget.c);
                let epBackup = "";

                if (isEp) {
                  epBackup = position[r][toc];
                  position[r][toc] = "";
                }

                position[tor][toc] = movingPiece;
                position[r][c] = "";

                const kingIsSafe = !isKingInCheck(color);

                position[r][c] = movingPiece;
                position[tor][toc] = originalTarget;
                if (isEp) position[r][toc] = epBackup;

                if (kingIsSafe) return true;
              }
            }
          }
        }
      }
    }
  }
  return false; 
}

renderBoard();
updateTurnUI();

// Event Listeners for UI Controls
const flipButton = document.getElementById("flipButton");
if (flipButton) {
  flipButton.addEventListener("click", function() {
    isFlipped = !isFlipped;
    renderBoard();        
  });
}

const colorToggleBtn = document.getElementById("colorToggleBtn");
if (colorToggleBtn) {
  colorToggleBtn.addEventListener("click", function() {
    botColor = botColor === 'b' ? 'w' : 'b';
    this.textContent = botColor === 'b' ? "Bot Plays: Black" : "Bot Plays: White";

    isFlipped = botColor === 'w';
    renderBoard();
    updateTurnUI();

    if (turn === botColor) {
      setTimeout(triggerBotMove, 250);
    }
  });
}