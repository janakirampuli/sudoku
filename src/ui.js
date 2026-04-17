import { clamp, formatTime, showToast } from "./utils.js";
import { conflictsForCell, isValidSolution } from "./sudoku.js";

function idx(r, c) {
  return r * 9 + c;
}

function blockId(r, c) {
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

export class SudokuUI {
  /**
   * @param {{
   *  boardEl: HTMLElement,
   *  keypadEl: HTMLElement,
   *  toastEl: HTMLElement,
   *  timerEl: HTMLElement,
   *  onSolved: (elapsedMs?: number) => void,
   *  onBoardChange?: (board: number[]) => void,
   * }} opts
   */
  constructor(opts) {
    this.boardEl = opts.boardEl;
    this.keypadEl = opts.keypadEl;
    this.toastEl = opts.toastEl;
    this.timerEl = opts.timerEl;
    this.onSolved = opts.onSolved;
    this.onBoardChange = opts.onBoardChange;

    this._cells = [];
    this._selected = { r: 0, c: 0 };
    this._timer = null;
    this._startedAtMs = null;

    this._solved = false;
    this._frozenElapsedMs = null;
    this._celebrateLayer = null;
    this._loserCelebrated = false;

    this._state = null;

    this._onKeyDown = this._onKeyDown.bind(this);
  }

  mount(state, startedAtMs) {
    this._state = state;
    this._startedAtMs = startedAtMs;
    this._solved = false;
    this._loserCelebrated = false;
    this._frozenElapsedMs = Number.isFinite(state?.solvedElapsedMs)
      ? Number(state.solvedElapsedMs)
      : null;
    this.boardEl?.classList.remove("board--solved");
    this._renderBoard();
    this._renderKeypad();
    this._select(0, 0);

    window.addEventListener("keydown", this._onKeyDown);

    // If we mount into an already-solved board (e.g., restored), freeze timer and lock input.
    // - If we have a stored `solvedElapsedMs`, use it so refreshes don't change the final time.
    // - Optionally allow callers to force-solved (e.g., multiplayer finishedAt).
    const forceSolved = Boolean(state?.forceSolved);
    const solvedNow = forceSolved || isValidSolution(this._state.board, this._state.puzzle);
    if (solvedNow) {
      this._markSolved({
        announce: false,
        celebrate: false,
        elapsedMs: this._frozenElapsedMs ?? undefined,
        fireCallback: Boolean(state?.fireSolvedCallbackOnMount),
      });
      return;
    }

    // Only start ticking when the board isn't already solved.
    this._startTimerLoop();
  }

  unmount() {
    window.removeEventListener("keydown", this._onKeyDown);
    if (this._timer) window.clearInterval(this._timer);
    this._timer = null;
    this._startedAtMs = null;
    this._solved = false;
    this._frozenElapsedMs = null;
    this._loserCelebrated = false;
    this.boardEl?.classList.remove("board--solved");

    try {
      this._celebrateLayer?.remove();
    } catch {}
    this._celebrateLayer = null;
  }

  /**
   * Trigger a small "you tried" celebration when the opponent finishes first.
   * Does not mark the puzzle as solved and does not stop the timer.
   */
  celebrateLoser() {
    if (!this._state) return;
    if (this._solved) return;
    if (this._loserCelebrated) return;
    this._loserCelebrated = true;
    this._celebrate({
      count: 90,
      emojis: ["🥲", "😭", "😅", "🙂"],
      maxDrift: 90,
      minDur: 1.4,
      maxDur: 2.4,
    });
    showToast(this.toastEl, "Nice effort - your friend finished first!");
  }

  setStartedAtMs(ms) {
    this._startedAtMs = ms;
  }

  resetToPuzzle() {
    if (!this._state) return;
    // Allow reset after solving.
    if (this._solved) {
      this._solved = false;
      this._frozenElapsedMs = null;
      this.boardEl?.classList.remove("board--solved");
      try {
        if (this._celebrateLayer) this._celebrateLayer.innerHTML = "";
      } catch {}
      // Reset timer to start fresh for the replay.
      this._startedAtMs = Date.now();
      this._startTimerLoop();
    }
    const { givensMask } = this._state;
    for (let i = 0; i < 81; i++) {
      if (!givensMask[i]) this._state.board[i] = 0;
    }
    this._syncAllCells();
    this.onBoardChange?.(this._state.board.slice());
    showToast(this.toastEl, "Reset.");
  }

  checkNow() {
    if (!this._state) return;
    if (this._solved) return;
    const anyConflicts = this._applyConflicts();
    if (anyConflicts) {
      showToast(this.toastEl, "There are conflicts.");
      return;
    }
    if (isValidSolution(this._state.board, this._state.puzzle)) {
      this._markSolved({ announce: true, celebrate: true });
    } else {
      showToast(this.toastEl, "Not solved yet.");
    }
  }

  _startTimerLoop() {
    if (this._timer) window.clearInterval(this._timer);
    this._timer = window.setInterval(() => {
      if (!this._startedAtMs) return;
      if (this._solved) return;
      const ms = Date.now() - this._startedAtMs;
      this.timerEl.textContent = formatTime(Math.max(0, ms));
    }, 250);
  }

  _stopTimerLoop(elapsedMsOverride) {
    if (this._timer) window.clearInterval(this._timer);
    this._timer = null;

    const ms = Number.isFinite(elapsedMsOverride)
      ? Number(elapsedMsOverride)
      : (this._startedAtMs ? (Date.now() - this._startedAtMs) : 0);
    this.timerEl.textContent = formatTime(Math.max(0, ms));
  }

  _ensureCelebrateLayer() {
    if (this._celebrateLayer && this._celebrateLayer.isConnected) return;
    const host = this.boardEl?.parentElement; // .board-wrap
    if (!host) return;
    const layer = document.createElement("div");
    layer.className = "sudoku-celebrate-layer";
    layer.setAttribute("aria-hidden", "true");
    host.appendChild(layer);
    this._celebrateLayer = layer;
  }

  _celebrate(config = null) {
    // Respect reduced-motion preferences.
    try {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    } catch {}

    this._ensureCelebrateLayer();
    if (!this._celebrateLayer) return;

    // Clear any previous run.
    this._celebrateLayer.innerHTML = "";

    const colors = config?.colors ?? [
      "#ff3b30", // red
      "#ffcc00", // yellow
      "#34c759", // green
      "#007aff", // blue
      "#af52de", // purple
      "#ff9f0a", // orange
    ];

    const emojis = Array.isArray(config?.emojis) && config.emojis.length
      ? config.emojis.map(String)
      : null;

    const count = Number.isFinite(config?.count) ? Number(config.count) : 140;
    const maxDrift = Number.isFinite(config?.maxDrift) ? Number(config.maxDrift) : 140;
    const minDur = Number.isFinite(config?.minDur) ? Number(config.minDur) : 1.8;
    const maxDur = Number.isFinite(config?.maxDur) ? Number(config.maxDur) : 3.4;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("i");
      piece.className = "sudoku-confetti";

      const w = emojis ? 0 : (4 + Math.floor(Math.random() * 6)); // 4..9
      const h = emojis ? 0 : (10 + Math.floor(Math.random() * 14)); // 10..23
      const left = Math.random() * 100;
      const delay = Math.random() * 0.35;
      const dur = minDur + Math.random() * Math.max(0, (maxDur - minDur));
      const drift = (Math.random() - 0.5) * maxDrift; // px
      const rot = (Math.random() - 0.5) * 720; // deg
      const color = colors[(Math.random() * colors.length) | 0];

      if (!emojis) {
        piece.style.width = `${w}px`;
        piece.style.height = `${h}px`;
      }
      piece.style.left = `${left}%`;
      piece.style.setProperty("--confetti-delay", `${delay}s`);
      piece.style.setProperty("--confetti-dur", `${dur}s`);
      piece.style.setProperty("--confetti-drift", `${drift}px`);
      piece.style.setProperty("--confetti-rot", `${rot}deg`);

      if (emojis) {
        const emoji = emojis[(Math.random() * emojis.length) | 0];
        piece.textContent = emoji;
        piece.style.background = "transparent";
        piece.style.fontSize = `${14 + Math.floor(Math.random() * 12)}px`; // 14..25
        piece.style.lineHeight = "1";
        piece.style.opacity = String(0.85 + Math.random() * 0.15);
        piece.style.filter = "drop-shadow(0 8px 10px rgba(0,0,0,0.08))";
      } else {
        piece.style.background = color;
        piece.style.opacity = String(0.85 + Math.random() * 0.15);

        // Sprinkle-like look: slightly rounded
        piece.style.borderRadius = `${2 + Math.floor(Math.random() * 4)}px`;
      }

      this._celebrateLayer.appendChild(piece);
    }

    // Cleanup after animation.
    window.setTimeout(() => {
      try {
        if (this._celebrateLayer) this._celebrateLayer.innerHTML = "";
      } catch {}
    }, 4200);
  }

  _markSolved({ announce, celebrate, elapsedMs, fireCallback } = { announce: true, celebrate: true }) {
    if (this._solved) return;
    this._solved = true;

    const frozen = Number.isFinite(elapsedMs)
      ? Number(elapsedMs)
      : (this._startedAtMs ? (Date.now() - this._startedAtMs) : 0);
    this._frozenElapsedMs = frozen;

    // Freeze timer at final time.
    this._stopTimerLoop(frozen);

    // Visual state
    this.boardEl?.classList.add("board--solved");

    if (celebrate) this._celebrate();
    if (announce) showToast(this.toastEl, "Solved!");

    if (fireCallback !== false) {
      try {
        // Extra arg is optional; existing call sites that ignore args remain compatible.
        this.onSolved?.(frozen);
      } catch {}
    }
  }

  _renderBoard() {
    this.boardEl.innerHTML = "";
    this._cells = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const i = idx(r, c);
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);

        // alternate 3x3 blocks
        const b = blockId(r, c);
        cell.classList.add(b % 2 === 0 ? "cell--block-a" : "cell--block-b");

        cell.tabIndex = 0;
        cell.addEventListener("click", () => this._select(r, c));

        this._cells[i] = cell;
        this.boardEl.appendChild(cell);
      }
    }
    this._syncAllCells();
  }

  _renderKeypad() {
    this.keypadEl.innerHTML = "";
    const addKey = (label, value) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "key";
      btn.textContent = label;
      btn.addEventListener("click", () => this._inputValue(value));
      this.keypadEl.appendChild(btn);
    };
    for (let n = 1; n <= 9; n++) addKey(String(n), n);
    addKey("Clear", 0);
  }

  _syncAllCells() {
    const { board, givensMask } = this._state;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const i = idx(r, c);
        const cell = this._cells[i];
        const val = board[i];
        cell.textContent = val ? String(val) : "";
        cell.classList.toggle("cell--given", givensMask[i]);
        cell.classList.remove("cell--conflict");
      }
    }
    this._applyConflicts();
    this._applySameNumberHighlight();
  }

  _applyConflicts() {
    let any = false;
    const { board } = this._state;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const i = idx(r, c);
        const cell = this._cells[i];
        const conflict = conflictsForCell(board, r, c);
        cell.classList.toggle("cell--conflict", conflict);
        if (conflict) any = true;
      }
    }
    return any;
  }

  _select(r, c) {
    r = clamp(r, 0, 8);
    c = clamp(c, 0, 8);
    const prev = this._selected;
    this._cells[idx(prev.r, prev.c)]?.classList.remove("cell--selected");
    this._selected = { r, c };
    this._cells[idx(r, c)]?.classList.add("cell--selected");

    this._applySameNumberHighlight();
  }

  _applySameNumberHighlight() {
    if (!this._state) return;
    const { r, c } = this._selected;
    const selectedVal = this._state.board[idx(r, c)];
    for (let i = 0; i < 81; i++) {
      const cell = this._cells[i];
      const val = this._state.board[i];
      cell.classList.toggle("cell--same", selectedVal !== 0 && val === selectedVal);
    }
  }

  _inputValue(n) {
    if (!this._state) return;
    if (this._solved) return;
    const { r, c } = this._selected;
    const i = idx(r, c);
    if (this._state.givensMask[i]) return;
    if (n < 0 || n > 9) return;

    this._state.board[i] = n;
    this._syncAllCells();
    this.onBoardChange?.(this._state.board.slice());

    if (isValidSolution(this._state.board, this._state.puzzle)) {
      this._markSolved({ announce: true, celebrate: true });
    }
  }

  _onKeyDown(e) {
    if (!this._state) return;
    const { r, c } = this._selected;

    if (e.key === "ArrowUp") return void this._select(r - 1, c);
    if (e.key === "ArrowDown") return void this._select(r + 1, c);
    if (e.key === "ArrowLeft") return void this._select(r, c - 1);
    if (e.key === "ArrowRight") return void this._select(r, c + 1);

    if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
      e.preventDefault();
      return void this._inputValue(0);
    }

    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      return void this._inputValue(Number(e.key));
    }
  }
}
