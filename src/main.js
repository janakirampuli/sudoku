import { $ } from "./utils.js";
import {
  copyToClipboard,
  getQueryParam,
  showToast,
} from "./utils.js";
import {
  createInitialState,
  decodeGrid81,
  encodeGrid81,
  generateSolvedGrid,
  makePuzzleFromSolution,
} from "./sudoku.js";
import { SudokuUI } from "./ui.js";
import {
  createRoom,
  getCurrentUser,
  getRoomOnce,
  joinRoom,
  markFinished,
  markQuit,
  registerOnDisconnectOffline,
  clearOnDisconnectOffline,
  setOnline,
  parsePuzzle,
  startGame,
  subscribeRoom,
} from "./room.js";

const elConn = $("conn-pill");
const elToast = $("toast");

const elLobby = $("screen-lobby");
const elRoom = $("screen-room");
const elGame = $("screen-game");

const tabCreate = $("tab-create");
const tabJoin = $("tab-join");
const panelCreate = $("panel-create");
const panelJoin = $("panel-join");

const btnCreate = $("btn-create");
const btnJoin = $("btn-join");
const btnCopy = $("btn-copy");
const btnQuit = $("btn-quit");
const btnStart = $("btn-start");
const btnCheck = $("btn-check");
const btnReset = $("btn-reset");
const btnQuitGame = $("btn-quit-game");

const btnModeSingle = $("btn-mode-single");
const btnModeMulti = $("btn-mode-multi");
const panelSingle = $("panel-single");
const singleName = $("single-name");
const singleDifficulty = $("single-difficulty");
const btnSingleStart = $("btn-single-start");

const inputCreateName = $("create-name");
const inputCreateDifficulty = $("create-difficulty");
const inputJoinName = $("join-name");
const inputJoinRoom = $("join-room");

const elRoomId = $("room-id");
const elRoomSub = $("room-sub");
const elPlayers = $("players");

const elTimer = $("timer");
const elDifficulty = $("difficulty");
const elYou = $("you");
const elBoard = $("board");
const elKeypad = $("keypad");

/** @type {{roomId: string|null, role: 'p1'|'p2'|null, uid: string|null, name: string|null, unsub: null|(()=>void) }} */
const session = {
  roomId: null,
  role: null,
  uid: null,
  name: null,
  unsub: null,
};

let ui = null;

let currentScreen = "lobby";

let resumeMode = false;

let appMode = "single"; // 'single' | 'multi'

let firebaseReady = false;
let currentSingleGameId = null;

let lastOtherFinished = false;
let lastOtherQuit = false;

function sessionKey(roomId) {
  return `sudoku:session:${roomId}`;
}

function boardKey(roomId, uid) {
  return `sudoku:board:${roomId}:${uid}`;
}

function saveSession(roomId, data) {
  localStorage.setItem(sessionKey(roomId), JSON.stringify(data));
}

function loadSession(roomId) {
  try {
    const raw = localStorage.getItem(sessionKey(roomId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession(roomId) {
  localStorage.removeItem(sessionKey(roomId));
}

function saveBoard(roomId, uid, givensStr, boardArr, meta = null) {
  const payload = {
    givens: givensStr,
    board: encodeGrid81(boardArr),
    updatedAt: Date.now(),
    ...(meta && typeof meta === "object" ? meta : {}),
  };
  localStorage.setItem(boardKey(roomId, uid), JSON.stringify(payload));
}

function loadBoard(roomId, uid, givensStr) {
  try {
    const raw = localStorage.getItem(boardKey(roomId, uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.givens || parsed.givens !== givensStr) return null;
    if (!parsed?.board || typeof parsed.board !== "string") return null;

    return {
      board: decodeGrid81(parsed.board),
      solved: Boolean(parsed.solved),
      solvedElapsedMs: Number.isFinite(parsed.solvedElapsedMs) ? Number(parsed.solvedElapsedMs) : null,
    };
  } catch {
    return null;
  }
}

function showScreen(which) {
  currentScreen = which;
  elLobby.classList.toggle("hidden", which !== "lobby");
  elRoom.classList.toggle("hidden", which !== "room");
  elGame.classList.toggle("hidden", which !== "game");
}

function setMode(mode) {
  appMode = mode;
  const isSingle = mode === "single";

  elConn.textContent = isSingle ? "Single" : (firebaseReady ? "Connected" : "2-player");

  // Toggle button emphasis
  btnModeSingle.classList.toggle("btn--primary", isSingle);
  btnModeMulti.classList.toggle("btn--primary", !isSingle);

  panelSingle.classList.toggle("panel--active", isSingle);

  // Multi panels are controlled by tabs; hide them visually when in single.
  tabCreate.closest('.tabs')?.classList.toggle("hidden", isSingle);
  panelCreate.parentElement?.classList.toggle("hidden", isSingle);

  if (isSingle) {
    showScreen("lobby");
  }
}

async function ensureFirebaseReady() {
  if (firebaseReady) return;
  elConn.textContent = "Connecting…";
  const user = await getCurrentUser();
  session.uid = user.uid;
  firebaseReady = true;
  elConn.textContent = "Connected";
}

function singleGameKey(gameId) {
  return `sudoku:single:game:${gameId}`;
}

function saveSingleGame(gameId, data) {
  localStorage.setItem(singleGameKey(gameId), JSON.stringify(data));
}

function loadSingleGame(gameId) {
  try {
    const raw = localStorage.getItem(singleGameKey(gameId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSingleGame(gameId) {
  localStorage.removeItem(singleGameKey(gameId));
}

function setTabs(mode) {
  const create = mode === "create";
  tabCreate.classList.toggle("tab--active", create);
  tabJoin.classList.toggle("tab--active", !create);
  panelCreate.classList.toggle("panel--active", create);
  panelJoin.classList.toggle("panel--active", !create);
}

function renderPlayers(room) {
  const p1 = room?.players?.p1;
  const p2 = room?.players?.p2;
  const mk = (label, p) => {
    const div = document.createElement("div");
    div.className = "player";
    div.innerHTML = `
      <div class="player-name">${label}: ${p?.name ? escapeHtml(p.name) : "-"}</div>
      <div class="player-meta">${p?.uid ? "Joined" : "Waiting"}${p?.finished ? " · Finished" : ""}</div>
    `.trim();
    return div;
  };
  elPlayers.innerHTML = "";
  elPlayers.appendChild(mk("Player 1", p1));
  elPlayers.appendChild(mk("Player 2", p2));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateRoomUI(room) {
  if (!room) {
    showToast(elToast, "Room not found.");
    showScreen("lobby");
    return;
  }

  elRoomId.textContent = session.roomId || "-";
  renderPlayers(room);

  const isHost = room.createdBy === session.uid;
  const hasP2 = Boolean(room.players?.p2?.uid);

  if (room.status === "waiting") {
    elRoomSub.textContent = hasP2
      ? (isHost ? "Player 2 joined. You can start." : "Waiting for host to start…")
      : "Waiting for Player 2 to join…";
  }

  btnStart.classList.toggle("hidden", !(isHost && hasP2 && room.status === "waiting"));

  // Notify when other finished
  const otherKey = session.role === "p1" ? "p2" : "p1";
  const other = room.players?.[otherKey];
  const otherFinished = Boolean(other?.finished);
  if (otherFinished && !lastOtherFinished) {
    showToast(elToast, "Other player completed the game.");

    // If the opponent finishes first, give the current player a small consolation confetti.
    const me = room.players?.[session.role];
    const iFinished = Boolean(me?.finished);
    if (!iFinished) {
      try {
        ui?.celebrateLoser?.();
      } catch {}
    }
  }
  lastOtherFinished = otherFinished;

  // Quit notifications
  const otherQuit = Boolean(other?.quit);
  if (otherQuit && !lastOtherQuit) {
    showToast(elToast, "Other player quit.");
  }
  lastOtherQuit = otherQuit;

  // If opponent quit, do not redirect the current player.
  // - If you are already in game, stay there.
  // - If you are in room/lobby, stay on room.
  if (otherQuit) {
    if (currentScreen !== "game") showScreen("room");
    return;
  }

  if (room.status === "started") {
    // Avoid re-mounting the board on every room update (prevents "restored" behavior).
    if (!ui || currentScreen !== "game") showGame(room);
  } else {
    showScreen("room");
  }
}

function showGame(room) {
  showScreen("game");

  elDifficulty.textContent = room.difficulty || "-";
  elYou.textContent = session.name || "-";

  const { puzzle, solution } = parsePuzzle(room);
  const state = createInitialState(puzzle, solution);
  const saved = loadBoard(session.roomId, session.uid, room.puzzle.givens);
  const savedBoard = saved?.board;
  if (savedBoard) {
    // Restore only editable cells; givens stay unchanged.
    for (let i = 0; i < 81; i++) {
      if (!state.givensMask[i]) state.board[i] = savedBoard[i];
    }
    if (resumeMode) showToast(elToast, "Restored your board.");
  }
  resumeMode = false;
  const startedAtNum = Number(room?.startedAt);
  const startedAt = Number.isFinite(startedAtNum) ? startedAtNum : Date.now();

  const finishedAtNum = Number(room?.players?.[session.role]?.finishedAt);
  const serverElapsedSolved = (Number.isFinite(finishedAtNum) && Number.isFinite(startedAtNum))
    ? (finishedAtNum - startedAtNum)
    : null;
  const elapsedSolved = Number.isFinite(serverElapsedSolved)
    ? serverElapsedSolved
    : (Number.isFinite(saved?.solvedElapsedMs) ? saved.solvedElapsedMs : null);
  const alreadyFinished = Boolean(room?.players?.[session.role]?.finished) || (Boolean(saved?.solved) && elapsedSolved != null);

  if (ui) ui.unmount();
  ui = new SudokuUI({
    boardEl: elBoard,
    keypadEl: elKeypad,
    toastEl: elToast,
    timerEl: elTimer,
    onSolved: async (elapsedMs) => {
      try {
        // Persist a stable final time locally so refresh doesn't change the frozen timer,
        // even if RTDB finishedAt isn't yet readable as a number.
        saveBoard(session.roomId, session.uid, room.puzzle.givens, state.board, {
          solved: true,
          solvedElapsedMs: Number.isFinite(elapsedMs) ? Number(elapsedMs) : null,
        });
        await markFinished({ roomId: session.roomId, playerKey: session.role });
      } catch (e) {
        console.error(e);
      }
    },
    onBoardChange: (board) => {
      try {
        saveBoard(session.roomId, session.uid, room.puzzle.givens, board);
      } catch {}
    },
  });

  // If we already finished (e.g., refresh after solving), freeze the timer to the stored finish time
  // and avoid firing onSolved/markFinished again.
  if (alreadyFinished && elapsedSolved != null) {
    ui.mount({ ...state, forceSolved: true, solvedElapsedMs: elapsedSolved, fireSolvedCallbackOnMount: false }, startedAt);
  } else {
    ui.mount(state, startedAt);
  }
}

function subscribe(roomId) {
  if (session.unsub) session.unsub();
  session.unsub = subscribeRoom(roomId, (room) => {
    updateRoomUI(room);
  });
}

async function init() {
  // Only initialize Firebase when needed (2-player mode).
  elConn.textContent = "Single";

  // If opened with ?room=...
  const roomFromUrl = getQueryParam("room");
  const singleFromUrl = getQueryParam("single");
  const gameFromUrl = getQueryParam("game");

  if (singleFromUrl === "1" && gameFromUrl) {
    setMode("single");
    currentSingleGameId = gameFromUrl;
    const game = loadSingleGame(gameFromUrl);
    if (game?.givens && game?.solution) {
      const state = createInitialState(decodeGrid81(game.givens), decodeGrid81(game.solution));
      if (Array.isArray(game.board)) {
        // legacy
      }
      if (typeof game.board === "string" && game.board.length === 81) {
        const savedBoard = decodeGrid81(game.board);
        for (let i = 0; i < 81; i++) {
          if (!state.givensMask[i]) state.board[i] = savedBoard[i];
        }
      }

      // If this game was already solved, keep the same final elapsed time on refresh.
      const alreadySolved = Boolean(game.solved);
      const solvedElapsedMs = Number.isFinite(game.solvedElapsedMs) ? Number(game.solvedElapsedMs) : null;
      const derivedSolvedElapsedMs = (alreadySolved && solvedElapsedMs == null && Number.isFinite(game.solvedAt) && Number.isFinite(game.startedAt))
        ? (Number(game.solvedAt) - Number(game.startedAt))
        : null;
      const finalSolvedElapsedMs = solvedElapsedMs ?? derivedSolvedElapsedMs;

      singleName.value = game.name || "";
      elDifficulty.textContent = game.difficulty || "-";
      elYou.textContent = game.name || "-";

      if (ui) ui.unmount();
      ui = new SudokuUI({
        boardEl: elBoard,
        keypadEl: elKeypad,
        toastEl: elToast,
        timerEl: elTimer,
        onSolved: (elapsedMs) => {
          try {
            const cur = loadSingleGame(gameFromUrl);
            if (!cur) return;
            saveSingleGame(gameFromUrl, {
              ...cur,
              solved: true,
              solvedAt: Date.now(),
              solvedElapsedMs: Number.isFinite(elapsedMs) ? Number(elapsedMs) : (cur.solvedElapsedMs ?? null),
              updatedAt: Date.now(),
            });
          } catch {}
        },
        onBoardChange: (board) => {
          try {
            const cur = loadSingleGame(gameFromUrl);
            if (!cur) return;
            saveSingleGame(gameFromUrl, { ...cur, board: encodeGrid81(board), updatedAt: Date.now() });
          } catch {}
        },
      });

      if (alreadySolved && finalSolvedElapsedMs != null) {
        ui.mount({ ...state, forceSolved: true, solvedElapsedMs: finalSolvedElapsedMs, fireSolvedCallbackOnMount: false }, game.startedAt || Date.now());
      } else {
        ui.mount(state, game.startedAt || Date.now());
      }
      showScreen("game");
      showToast(elToast, "Restored single-player game.");
      return;
    }
  }

  if (roomFromUrl) {
    setMode("multi");

    try {
      await ensureFirebaseReady();
    } catch (e) {
      console.error(e);
      elConn.textContent = "Firebase error";
      showToast(elToast, "Firebase init failed.");
      return;
    }

    setTabs("join");
    inputJoinRoom.value = roomFromUrl.toUpperCase();

    // Attempt auto-resume if this browser is already a player.
    const roomId = roomFromUrl.toUpperCase();

    // If we have a saved session for this room, don't show Create by default.
    const savedSession = loadSession(roomId);
    if (savedSession?.name) {
      inputJoinName.value = savedSession.name;
    }

    try {
      const room = await getRoomOnce(roomId);
      if (room?.players?.p1?.uid === session.uid) {
        if (room?.players?.p1?.quit) {
          // user had quit; do not auto-resume
          const u = new URL(window.location.href);
          u.searchParams.delete("room");
          window.history.replaceState({}, "", u.toString());
          return;
        }
        session.roomId = roomId;
        session.role = "p1";
        session.name = room.players.p1.name;
        saveSession(roomId, { role: session.role, name: session.name });
        resumeMode = true;
        subscribe(roomId);
        await setOnline({ roomId, playerKey: session.role, online: true });
        await registerOnDisconnectOffline({ roomId, playerKey: session.role });
        showToast(elToast, "Reconnected as Player 1.");
        return;
      }
      if (room?.players?.p2?.uid === session.uid) {
        if (room?.players?.p2?.quit) {
          const u = new URL(window.location.href);
          u.searchParams.delete("room");
          window.history.replaceState({}, "", u.toString());
          return;
        }
        session.roomId = roomId;
        session.role = "p2";
        session.name = room.players.p2.name;
        saveSession(roomId, { role: session.role, name: session.name });
        resumeMode = true;
        subscribe(roomId);
        await setOnline({ roomId, playerKey: session.role, online: true });
        await registerOnDisconnectOffline({ roomId, playerKey: session.role });
        showToast(elToast, "Reconnected as Player 2.");
        return;
      }
    } catch {
      // ignore
    }
  }
}

tabCreate.addEventListener("click", () => setTabs("create"));
tabJoin.addEventListener("click", () => setTabs("join"));

btnCreate.addEventListener("click", async () => {
  setMode("multi");
  try {
    await ensureFirebaseReady();
  } catch {}
  const name = inputCreateName.value.trim();
  const difficulty = inputCreateDifficulty.value;
  if (!name) return showToast(elToast, "Enter your name.");
  btnCreate.disabled = true;
  try {
    const { roomId, user } = await createRoom({ name, difficulty });
    session.roomId = roomId;
    session.role = "p1";
    session.uid = user.uid;
    session.name = name;

    saveSession(roomId, { role: session.role, name: session.name });

    // update URL (shareable)
    const u = new URL(window.location.href);
    u.searchParams.set("room", roomId);
    window.history.replaceState({}, "", u.toString());

    subscribe(roomId);
    showScreen("room");
    showToast(elToast, "Room created.");

    await setOnline({ roomId, playerKey: session.role, online: true });
    await registerOnDisconnectOffline({ roomId, playerKey: session.role });
  } catch (e) {
    console.error(e);
    showToast(elToast, e?.message || "Create failed.");
  } finally {
    btnCreate.disabled = false;
  }
});

btnJoin.addEventListener("click", async () => {
  setMode("multi");
  try {
    await ensureFirebaseReady();
  } catch {}
  const name = inputJoinName.value.trim();
  const roomId = inputJoinRoom.value.trim().toUpperCase();
  if (!name) return showToast(elToast, "Enter your name.");
  if (!roomId) return showToast(elToast, "Enter room id.");
  btnJoin.disabled = true;
  try {
    const { user, room } = await joinRoom({ roomId, name });
    session.roomId = roomId;
    session.uid = user.uid;

    // Determine role based on uid. (Allows host to re-open the link.)
    if (room?.players?.p1?.uid === user.uid) {
      session.role = "p1";
      session.name = room.players.p1.name;
    } else {
      session.role = "p2";
      session.name = name;
    }

    saveSession(roomId, { role: session.role, name: session.name });

    // update URL (shareable)
    const u = new URL(window.location.href);
    u.searchParams.set("room", roomId);
    window.history.replaceState({}, "", u.toString());

    subscribe(roomId);
    showScreen("room");
    showToast(elToast, "Joined room.");
    showToast(elToast, "Waiting for host to start…");
    // immediate render
    updateRoomUI(room);

    // Mark quit on disconnect (tab close/crash)
    await setOnline({ roomId, playerKey: session.role, online: true });
    await registerOnDisconnectOffline({ roomId, playerKey: session.role });
  } catch (e) {
    console.error(e);
    showToast(elToast, e?.message || "Join failed.");
  } finally {
    btnJoin.disabled = false;
  }
});

btnCopy.addEventListener("click", async () => {
  if (!session.roomId) return;
  const link = `${window.location.origin}${window.location.pathname}?room=${session.roomId}`;
  try {
    await copyToClipboard(link);
    showToast(elToast, "Link copied.");
  } catch {
    showToast(elToast, link);
  }
});

btnStart.addEventListener("click", async () => {
  if (!session.roomId) return;
  btnStart.disabled = true;
  try {
    await startGame({ roomId: session.roomId, userUid: session.uid });
    showToast(elToast, "Game started.");
  } catch (e) {
    console.error(e);
    showToast(elToast, e?.message || "Start failed.");
  } finally {
    btnStart.disabled = false;
  }
});

async function quitNow() {
  // Single-player quit
  if (appMode === "single") {
    const gameId = currentSingleGameId || getQueryParam("game");
    if (gameId) {
      try {
        clearSingleGame(gameId);
      } catch {}
    }

    if (ui) ui.unmount();
    ui = null;
    currentSingleGameId = null;

    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("single");
      u.searchParams.delete("game");
      window.history.replaceState({}, "", u.toString());
    } catch {}

    showToast(elToast, "Quit.");
    showScreen("lobby");
    return;
  }

  if (!session.roomId || !session.role) return;
  try {
    await clearOnDisconnectOffline({ roomId: session.roomId, playerKey: session.role });
    await markQuit({ roomId: session.roomId, playerKey: session.role });
    showToast(elToast, "You quit the room.");
  } catch (e) {
    console.error(e);
    showToast(elToast, e?.message || "Quit failed.");
  }
  // Clear local persisted data for this room
  try {
    localStorage.removeItem(boardKey(session.roomId, session.uid));
  } catch {}
  clearSession(session.roomId);

  // Stop listeners/UI
  try {
    session.unsub?.();
  } catch {}
  session.unsub = null;
  if (ui) ui.unmount();
  ui = null;

  // Clear in-memory session
  session.roomId = null;
  session.role = null;
  session.name = null;
  lastOtherFinished = false;
  lastOtherQuit = false;

  // Remove room query param
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("room");
    window.history.replaceState({}, "", u.toString());
  } catch {}

  // Return to lobby
  showScreen("lobby");
}

btnModeSingle.addEventListener("click", () => setMode("single"));
btnModeMulti.addEventListener("click", () => setMode("multi"));

btnSingleStart.addEventListener("click", async () => {
  setMode("single");
  const name = singleName.value.trim();
  const difficulty = singleDifficulty.value;
  if (!name) return showToast(elToast, "Enter your name.");

  // Create a new single-player game and persist it
  const gameId = crypto.randomUUID?.() || String(Date.now());
  currentSingleGameId = gameId;

  // generate locally
  const solution = generateSolvedGrid();
  const puzzle = makePuzzleFromSolution(solution, difficulty);

  const startedAt = Date.now();
  saveSingleGame(gameId, {
    name,
    difficulty,
    startedAt,
    givens: encodeGrid81(puzzle),
    solution: encodeGrid81(solution),
    board: encodeGrid81(puzzle),
  });

  // update URL
  const u = new URL(window.location.href);
  u.searchParams.delete("room");
  u.searchParams.set("single", "1");
  u.searchParams.set("game", gameId);
  window.history.replaceState({}, "", u.toString());

  // Mount UI
  const state = createInitialState(puzzle, solution);
  if (ui) ui.unmount();
  ui = new SudokuUI({
    boardEl: elBoard,
    keypadEl: elKeypad,
    toastEl: elToast,
    timerEl: elTimer,
    onSolved: (elapsedMs) => {
      try {
        const cur = loadSingleGame(gameId);
        if (!cur) return;
        saveSingleGame(gameId, {
          ...cur,
          solved: true,
          solvedAt: Date.now(),
          solvedElapsedMs: Number.isFinite(elapsedMs) ? Number(elapsedMs) : null,
          updatedAt: Date.now(),
        });
      } catch {}
    },
    onBoardChange: (board) => {
      try {
        const cur = loadSingleGame(gameId);
        if (!cur) return;
        saveSingleGame(gameId, { ...cur, board: encodeGrid81(board), updatedAt: Date.now() });
      } catch {}
    },
  });
  elDifficulty.textContent = difficulty;
  elYou.textContent = name;
  ui.mount(state, startedAt);
  showScreen("game");
});

btnQuit.addEventListener("click", quitNow);
btnQuitGame.addEventListener("click", quitNow);

btnCheck.addEventListener("click", () => ui?.checkNow());
btnReset.addEventListener("click", () => ui?.resetToPuzzle());

// init
setTabs("create");
setMode("single");
showScreen("lobby");
init();
