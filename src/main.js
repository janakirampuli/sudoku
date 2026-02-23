import { $ } from "./utils.js";
import {
  copyToClipboard,
  getQueryParam,
  showToast,
} from "./utils.js";
import {
  createInitialState,
} from "./sudoku.js";
import { SudokuUI } from "./ui.js";
import {
  createRoom,
  getCurrentUser,
  joinRoom,
  markFinished,
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
const btnStart = $("btn-start");
const btnCheck = $("btn-check");
const btnReset = $("btn-reset");

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

let lastOtherFinished = false;

function showScreen(which) {
  elLobby.classList.toggle("hidden", which !== "lobby");
  elRoom.classList.toggle("hidden", which !== "room");
  elGame.classList.toggle("hidden", which !== "game");
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
      <div class="player-name">${label}: ${p?.name ? escapeHtml(p.name) : "—"}</div>
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

  elRoomId.textContent = session.roomId || "—";
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
  }
  lastOtherFinished = otherFinished;

  if (room.status === "started") {
    showGame(room);
  } else {
    showScreen("room");
  }
}

function showGame(room) {
  showScreen("game");

  elDifficulty.textContent = room.difficulty || "—";
  elYou.textContent = session.name || "—";

  const { puzzle, solution } = parsePuzzle(room);
  const state = createInitialState(puzzle, solution);
  const startedAt = room.startedAt ? Number(room.startedAt) : Date.now();

  if (ui) ui.unmount();
  ui = new SudokuUI({
    boardEl: elBoard,
    keypadEl: elKeypad,
    toastEl: elToast,
    timerEl: elTimer,
    onSolved: async () => {
      try {
        await markFinished({ roomId: session.roomId, playerKey: session.role });
      } catch (e) {
        console.error(e);
      }
    },
  });

  ui.mount(state, startedAt);
}

function subscribe(roomId) {
  if (session.unsub) session.unsub();
  session.unsub = subscribeRoom(roomId, (room) => {
    updateRoomUI(room);
  });
}

async function init() {
  try {
    const user = await getCurrentUser();
    session.uid = user.uid;
    elConn.textContent = "Connected";
  } catch (e) {
    console.error(e);
    elConn.textContent = "Firebase error";
    showToast(elToast, "Firebase init failed.");
    return;
  }

  // If opened with ?room=...
  const roomFromUrl = getQueryParam("room");
  if (roomFromUrl) {
    setTabs("join");
    inputJoinRoom.value = roomFromUrl.toUpperCase();
  }
}

tabCreate.addEventListener("click", () => setTabs("create"));
tabJoin.addEventListener("click", () => setTabs("join"));

btnCreate.addEventListener("click", async () => {
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

    // update URL (shareable)
    const u = new URL(window.location.href);
    u.searchParams.set("room", roomId);
    window.history.replaceState({}, "", u.toString());

    subscribe(roomId);
    showScreen("room");
    showToast(elToast, "Room created.");
  } catch (e) {
    console.error(e);
    showToast(elToast, e?.message || "Create failed.");
  } finally {
    btnCreate.disabled = false;
  }
});

btnJoin.addEventListener("click", async () => {
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

    // update URL (shareable)
    const u = new URL(window.location.href);
    u.searchParams.set("room", roomId);
    window.history.replaceState({}, "", u.toString());

    subscribe(roomId);
    showScreen("room");
    showToast(elToast, "Joined room.");
    // immediate render
    updateRoomUI(room);
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

btnCheck.addEventListener("click", () => ui?.checkNow());
btnReset.addEventListener("click", () => ui?.resetToPuzzle());

// init
setTabs("create");
showScreen("lobby");
init();
