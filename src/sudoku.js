function idx(r, c) {
  return r * 9 + c;
}

const ALL_MASK = (1 << 10) - 2; // bits 1..9 set (ignore bit 0)

function bit(n) {
  return 1 << n;
}

function popcount(x) {
  // Brian Kernighan
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

function boxIndex(r, c) {
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
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

function buildMasks(grid) {
  const row = new Array(9).fill(0);
  const col = new Array(9).fill(0);
  const box = new Array(9).fill(0);

  for (let i = 0; i < 81; i++) {
    const n = grid[i];
    if (!n) continue;
    const r = Math.floor(i / 9);
    const c = i % 9;
    const b = boxIndex(r, c);
    const m = bit(n);
    // invalid given grid (conflict)
    if ((row[r] & m) || (col[c] & m) || (box[b] & m)) return null;
    row[r] |= m;
    col[c] |= m;
    box[b] |= m;
  }

  return { row, col, box };
}

function chooseNextCell(grid, masks) {
  // Find the empty cell with the fewest candidates (MRV heuristic)
  let bestIdx = -1;
  let bestMask = 0;
  let bestCount = 10;

  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue;
    const r = Math.floor(i / 9);
    const c = i % 9;
    const b = boxIndex(r, c);
    const used = masks.row[r] | masks.col[c] | masks.box[b];
    const cand = ALL_MASK & ~used;
    const count = popcount(cand);
    if (count === 0) return { i, mask: 0, count: 0 }; // dead end
    if (count < bestCount) {
      bestIdx = i;
      bestMask = cand;
      bestCount = count;
      if (count === 1) break;
    }
  }

  return { i: bestIdx, mask: bestMask, count: bestCount };
}

/**
 * Count the number of valid solutions for a grid.
 * Returns 0, 1, or >=2 (capped by `limit`).
 *
 * Notes:
 * - Mutates `grid` during the search, but always backtracks (grid ends unchanged).
 * - Uses MRV heuristic + bitmasks for speed (important during puzzle carving).
 */
export function countSolutions(grid, limit = 2) {
  const masks = buildMasks(grid);
  if (!masks) return 0;

  function dfs() {
    const next = chooseNextCell(grid, masks);
    if (next.i === -1) return 1; // solved
    if (next.mask === 0) return 0; // dead

    const r = Math.floor(next.i / 9);
    const c = next.i % 9;
    const b = boxIndex(r, c);

    let total = 0;
    // iterate candidates by bits (1..9)
    for (let n = 1; n <= 9; n++) {
      const m = bit(n);
      if (!(next.mask & m)) continue;

      grid[next.i] = n;
      masks.row[r] |= m;
      masks.col[c] |= m;
      masks.box[b] |= m;

      total += dfs();

      // backtrack
      masks.row[r] &= ~m;
      masks.col[c] &= ~m;
      masks.box[b] &= ~m;
      grid[next.i] = 0;

      if (total >= limit) return total;
    }
    return total;
  }

  return dfs();
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
    if (puzzle[pos] === 0) continue;

    const prev = puzzle[pos];
    puzzle[pos] = 0;

    // Enforce uniqueness: keep the removal only if the puzzle still has exactly 1 solution.
    const solutions = countSolutions(puzzle, 2);
    if (solutions === 1) {
      givens--;
    } else {
      puzzle[pos] = prev;
    }
  }

  // If we couldn't reach the target while keeping uniqueness, we return a slightly
  // easier (more-givens) puzzle rather than a non-unique one.

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

/**
 * Returns true if `board` is a complete, valid Sudoku solution that respects the original givens.
 * This intentionally does NOT require matching a specific stored solution.
 */
export function isValidSolution(board, puzzle) {
  if (!Array.isArray(board) || board.length !== 81) return false;
  if (!Array.isArray(puzzle) || puzzle.length !== 81) return false;

  const masks = { row: new Array(9).fill(0), col: new Array(9).fill(0), box: new Array(9).fill(0) };

  for (let i = 0; i < 81; i++) {
    const n = board[i];
    if (n < 1 || n > 9) return false;

    // must match givens
    if (puzzle[i] !== 0 && puzzle[i] !== n) return false;

    const r = Math.floor(i / 9);
    const c = i % 9;
    const b = boxIndex(r, c);
    const m = bit(n);
    if ((masks.row[r] & m) || (masks.col[c] & m) || (masks.box[b] & m)) return false;
    masks.row[r] |= m;
    masks.col[c] |= m;
    masks.box[b] |= m;
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
  // keep puzzle so UI can validate "any valid solution" (not just the stored one)
  return { givensMask, board, solution, puzzle: puzzle.slice() };
}
