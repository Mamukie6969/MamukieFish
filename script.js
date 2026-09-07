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

let selected = null;
let turn = 'w';
let isFlipped = false; 
const board = document.getElementById("board");
const turnDisplay = document.getElementById("turnDisplay");

// Web Audio API Context
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Promotion Picker UI Elements & State
let pendingPromotion = null;
const promotionPicker = document.getElementById("promotionPicker");
const promoButtons = document.querySelectorAll(".promo-btn");

// Tracks piece movement history
let movedPieces = {
  whiteKing: false,
  whiteRookLeft: false,
  whiteRookRight: false,
  blackKing: false,
  blackRookLeft: false,
  blackRookRight: false
};

// Tracks the specific square eligible for En Passant capture
let enPassantTarget = null;

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

// promotion selection handler
promoButtons.forEach(button => {
  button.addEventListener("click", function() {
    if (!pendingPromotion) return;

    const chosenType = this.dataset.piece;
    const { targetRow, targetCol, color } = pendingPromotion;

    // Set promoted piece directly into matrix
    position[targetRow][targetCol] = color + chosenType;
    
    // Hide overlay & reset state
    promotionPicker.classList.add("hidden");
    pendingPromotion = null;

    // Complete turn mechanics cleanly
    finishTurn();
  });
});

function updateTurnUI() {
  turnDisplay.textContent = turn === "w" ? "White to move" : "Black to move";
}

function finishTurn() {
  // Toggle turn sequence
  turn = turn === "w" ? "b" : "w";

  // Evaluate if opponent has legal responses
  if (!hasLegalMoves(turn)) {
    if (isKingInCheck(turn)) {
      const winner = turn === 'w' ? 'Black' : 'White';
      alert("Checkmate! " + winner + " wins!");
    } else {
      alert("Stalemate! The game is a draw.");
    }
  }

  selected = null;
  renderBoard();
  updateTurnUI();
}

function renderBoard() {
  board.innerHTML = "";

  if (isFlipped) {
    board.classList.add("board-flipped");
  } else {
    board.classList.remove("board-flipped");
  }

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {

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

        const tor = Number(this.dataset.row);
        const toc = Number(this.dataset.col);
        const clickedPiece = position[tor][toc];

        if (selected === null && clickedPiece.startsWith(turn)) {
          selected = { r: tor, c: toc };

        } else if (selected !== null) {
          const fromR = selected.r;
          const fromC = selected.c;
          const movingPiece = position[fromR][fromC];

          if (!clickedPiece.startsWith(turn)) {
            
            if (isValidMove(movingPiece, fromR, fromC, tor, toc)) {
              
              // --- START UNDER-THE-HOOD CHECK SIMULATION ---
              const originalTargetPiece = position[tor][toc];
              let isEnPassantCapture = (movingPiece[1] === 'p' && enPassantTarget && tor === enPassantTarget.r && toc === enPassantTarget.c);
              let backupCapturedPawn = "";

              if (isEnPassantCapture) {
                const capturedPawnRow = fromR;
                backupCapturedPawn = position[capturedPawnRow][toc];
                position[capturedPawnRow][toc] = "";
              }

              position[tor][toc] = movingPiece;
              position[fromR][fromC] = "";

              const putsKingInCheck = isKingInCheck(turn);

              // Revert simulation state
              position[fromR][fromC] = movingPiece;
              position[tor][toc] = originalTargetPiece;
              if (isEnPassantCapture) {
                position[fromR][toc] = backupCapturedPawn;
              }

              if (putsKingInCheck) {
                alert("Illegal move: Cannot leave King in check!");
                selected = null;
                renderBoard();
                return;
              }
              // --- END UNDER-THE-HOOD CHECK SIMULATION ---

              // Determine capture state and play corresponding audio
              const isStandardCapture = clickedPiece !== "" && !clickedPiece.startsWith(turn);
              const isCapture = isStandardCapture || isEnPassantCapture;
              playMoveSound(isCapture);

              // Execute En Passant capture removal
              if (isEnPassantCapture) {
                position[fromR][toc] = "";
              }

              // Move rook if castling
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

              // Finalize main piece movement
              position[tor][toc] = movingPiece;
              position[fromR][fromC] = "";

              // Track history state changes for castling
              if (fromR === 7 && fromC === 4) movedPieces.whiteKing = true;
              if (fromR === 7 && fromC === 0) movedPieces.whiteRookLeft = true;
              if (fromR === 7 && fromC === 7) movedPieces.whiteRookRight = true;
              if (fromR === 0 && fromC === 4) movedPieces.blackKing = true;
              if (fromR === 0 && fromC === 0) movedPieces.blackRookLeft = true;
              if (fromR === 0 && fromC === 7) movedPieces.blackRookRight = true;

              // Setup En Passant vulnerability target for next turn
              if (movingPiece[1] === 'p' && Math.abs(tor - fromR) === 2) {
                enPassantTarget = { r: (fromR + tor) / 2, c: fromC };
              } else {
                enPassantTarget = null;
              }

              // --- PROMOTION TRIGGER ---
              if ((movingPiece === 'wp' && tor === 0) || (movingPiece === 'bp' && tor === 7)) {
                pendingPromotion = { targetRow: tor, targetCol: toc, color: turn };

                // Populate picker buttons with current player's piece symbols
                promoButtons.forEach(btn => {
                  const pieceType = btn.dataset.piece;
                  btn.textContent = pieces[turn + pieceType];
                });

                promotionPicker.classList.remove("hidden");
                selected = null;
                renderBoard();
                return; // Pause execution until user picks a piece
              }

              // Standard turn completion
              finishTurn();
              return;
            }
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

        if (toC === 6) { // Kingside
          const rookMoved = isWhite ? movedPieces.whiteRookRight : movedPieces.blackRookRight;
          if (rookMoved || position[homeRow][7] !== (color + 'r')) return false;
          if (position[homeRow][5] !== "" || position[homeRow][6] !== "") return false; 
          if (isSquareAttacked(homeRow, 5, color) || isSquareAttacked(homeRow, 6, color)) return false;
          return true;
        }

        if (toC === 2) { // Queenside
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
      if (piece.startsWith(enemyColor)) {
        if (isValidMove(piece, r, c, row, col)) return true;
      }
    }
  }
  return false;
}

function isKingInCheck(kingColor) {
  let kingR = null;
  let kingC = null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (position[r][c] === kingColor + 'k') {
        kingR = r;
        kingC = c;
        break;
      }
    }
    if (kingR !== null) break;
  }
  return isSquareAttacked(kingR, kingC, kingColor);
}

function hasLegalMoves(color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (position[r][c].startsWith(color)) {
        for (let tor = 0; tor < 8; tor++) {
          for (let toc = 0; toc < 8; toc++) {
            if (!position[tor][toc].startsWith(color)) {
              if (isValidMove(position[r][c], r, c, tor, toc)) {
                
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

                // Revert simulation
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

document.getElementById("flipButton").addEventListener("click", function() {
  isFlipped = !isFlipped;
  renderBoard();        
});