import { clamp, formatTime, showToast } from "./utils.js";
import { conflictsForCell, isSolved } from "./sudoku.js";

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
   *  onSolved: () => void,
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

    this._state = null;

    this._onKeyDown = this._onKeyDown.bind(this);
  }

  mount(state, startedAtMs) {
    this._state = state;
    this._startedAtMs = startedAtMs;
    this._renderBoard();
    this._renderKeypad();
    this._select(0, 0);

    window.addEventListener("keydown", this._onKeyDown);
    this._startTimerLoop();
  }

  unmount() {
    window.removeEventListener("keydown", this._onKeyDown);
    if (this._timer) window.clearInterval(this._timer);
    this._timer = null;
    this._startedAtMs = null;
  }

  setStartedAtMs(ms) {
    this._startedAtMs = ms;
  }

  resetToPuzzle() {
    if (!this._state) return;
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
    const anyConflicts = this._applyConflicts();
    if (anyConflicts) {
      showToast(this.toastEl, "There are conflicts.");
      return;
    }
    if (isSolved(this._state.board, this._state.solution)) {
      showToast(this.toastEl, "Solved!");
      this.onSolved?.();
    } else {
      showToast(this.toastEl, "Not solved yet.");
    }
  }

  _startTimerLoop() {
    if (this._timer) window.clearInterval(this._timer);
    this._timer = window.setInterval(() => {
      if (!this._startedAtMs) return;
      const ms = Date.now() - this._startedAtMs;
      this.timerEl.textContent = formatTime(Math.max(0, ms));
    }, 250);
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
    const { r, c } = this._selected;
    const i = idx(r, c);
    if (this._state.givensMask[i]) return;
    if (n < 0 || n > 9) return;

    this._state.board[i] = n;
    this._syncAllCells();
    this.onBoardChange?.(this._state.board.slice());

    if (isSolved(this._state.board, this._state.solution)) {
      showToast(this.toastEl, "Solved!");
      this.onSolved?.();
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
