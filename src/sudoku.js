function idx(r, c) {
  return r * 9 + c;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isValid(grid, r, c, n) {
  // row
  for (let cc = 0; cc < 9; cc++) {
    if (cc !== c && grid[idx(r, cc)] === n) return false;
  }
  // col
  for (let rr = 0; rr < 9; rr++) {
    if (rr !== r && grid[idx(rr, c)] === n) return false;
  }
  // box
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let rr = br; rr < br + 3; rr++) {
    for (let cc = bc; cc < bc + 3; cc++) {
      if ((rr !== r || cc !== c) && grid[idx(rr, cc)] === n) return false;
    }
  }
  return true;
}

function findEmpty(grid) {
  for (let i = 0; i < 81; i++) {
    if (grid[i] === 0) return i;
  }
  return -1;
}

function solveBacktracking(grid) {
  const empty = findEmpty(grid);
  if (empty === -1) return true;
  const r = Math.floor(empty / 9);
  const c = empty % 9;

  for (const n of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    grid[empty] = n;
    if (isValid(grid, r, c, n) && solveBacktracking(grid)) return true;
    grid[empty] = 0;
  }
  return false;
}

export function generateSolvedGrid() {
  const grid = new Array(81).fill(0);
  // Seed diagonal boxes for speed and variety
  for (let b = 0; b < 3; b++) {
    const nums = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const br = b * 3;
    const bc = b * 3;
    let k = 0;
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) {
        grid[idx(r, c)] = nums[k++];
      }
    }
  }

  const ok = solveBacktracking(grid);
  if (!ok) throw new Error("Failed to generate solved grid");
  return grid;
}

export function makePuzzleFromSolution(solution, difficulty) {
  // difficulty -> number of givens
  const givensTarget =
    difficulty === "easy" ? 42 : difficulty === "medium" ? 34 : 26;

  const puzzle = solution.slice();
  const positions = shuffled([...Array(81)].map((_, i) => i));

  let givens = 81;
  for (const pos of positions) {
    if (givens <= givensTarget) break;
    const prev = puzzle[pos];
    puzzle[pos] = 0;
    givens--;
    // NOTE: We currently don't enforce uniqueness (keeps deps minimal).
    // If needed later, we can add a uniqueness-check solver.
    if (prev === 0) {
      puzzle[pos] = prev;
      givens++;
    }
  }

  return puzzle;
}

export function encodeGrid81(grid) {
  // 0-9 chars, length 81
  return grid.map((n) => String(n)).join("");
}

export function decodeGrid81(str) {
  if (!str || str.length !== 81) throw new Error("Invalid grid encoding");
  const out = new Array(81);
  for (let i = 0; i < 81; i++) out[i] = Number(str[i]);
  return out;
}

export function isSolved(board, solution) {
  for (let i = 0; i < 81; i++) {
    if (board[i] !== solution[i]) return false;
  }
  return true;
}

export function conflictsForCell(board, r, c) {
  const value = board[idx(r, c)];
  if (!value) return false;

  // duplicates in row/col/box
  for (let cc = 0; cc < 9; cc++) {
    if (cc !== c && board[idx(r, cc)] === value) return true;
  }
  for (let rr = 0; rr < 9; rr++) {
    if (rr !== r && board[idx(rr, c)] === value) return true;
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let rr = br; rr < br + 3; rr++) {
    for (let cc = bc; cc < bc + 3; cc++) {
      if ((rr !== r || cc !== c) && board[idx(rr, cc)] === value) return true;
    }
  }
  return false;
}

export function createInitialState(puzzle, solution) {
  const givensMask = puzzle.map((n) => n !== 0);
  const board = puzzle.slice();
  return { givensMask, board, solution };
}
