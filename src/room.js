import { dbApi, dbRef, dbOnValue, ensureAnonymousAuth } from "./firebase.js";
import {
  decodeGrid81,
  encodeGrid81,
  generateSolvedGrid,
  makePuzzleFromSolution,
} from "./sudoku.js";
import { randomRoomId } from "./utils.js";

const { get, set, update, runTransaction, serverTimestamp, onDisconnect } = dbApi;

function roomPath(roomId) {
  return `rooms/${roomId}`;
}

export async function getCurrentUser() {
  return ensureAnonymousAuth();
}

export async function createRoom({ name, difficulty }) {
  const user = await getCurrentUser();
  let roomId = null;
  let path = null;

  // very low probability of collision, but we still guard with a few retries.
  for (let i = 0; i < 6; i++) {
    const candidate = randomRoomId(6);
    const existing = await get(dbRef(roomPath(candidate)));
    if (!existing.exists()) {
      roomId = candidate;
      path = roomPath(candidate);
      break;
    }
  }
  if (!roomId) throw new Error("Could not allocate room id. Try again.");

  // generate puzzle locally by host, but store givens+solution in RTDB.
  const solution = generateSolvedGrid();
  const puzzle = makePuzzleFromSolution(solution, difficulty);

  const payload = {
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    difficulty,
    status: "waiting",
    puzzle: {
      givens: encodeGrid81(puzzle),
      solution: encodeGrid81(solution),
    },
    players: {
      p1: {
        uid: user.uid,
        name,
        joinedAt: serverTimestamp(),
        finished: false,
        finishedAt: null,
      },
    },
    startedAt: null,
    finishedAt: null,
  };

  await set(dbRef(path), payload);
  return { roomId, user };
}

export async function joinRoom({ roomId, name }) {
  const user = await getCurrentUser();
  const path = roomPath(roomId);

  const existing = await get(dbRef(path));
  if (!existing.exists()) throw new Error("Room does not exist.");

  const room = existing.val();
  if (room?.players?.p1?.uid === user.uid) {
    // Host re-opening the link on the same device.
    if (room?.players?.p1?.quit) {
      throw new Error("You already quit this room.");
    }
    return { user, room };
  }

  // Use a transaction to claim p2 if empty.
  const p2Ref = dbRef(`${path}/players/p2`);
  const { committed, snapshot } = await runTransaction(p2Ref, (currentP2) => {
    // If already taken by someone else, abort.
    if (currentP2?.uid && currentP2.uid !== user.uid) return;

    // Claim (or re-claim) p2.
    return {
      uid: user.uid,
      name,
      joinedAt: currentP2?.uid === user.uid ? currentP2.joinedAt : { ".sv": "timestamp" },
      finished: currentP2?.uid === user.uid ? Boolean(currentP2.finished) : false,
      finishedAt: currentP2?.uid === user.uid ? currentP2.finishedAt ?? null : null,
      quit: currentP2?.uid === user.uid ? Boolean(currentP2.quit) : false,
      quitAt: currentP2?.uid === user.uid ? currentP2.quitAt ?? null : null,
    };
  });

  if (!committed) {
    throw new Error("Could not join. Room full or does not exist.");
  }

  // Re-fetch full room (we only transacted on players/p2)
  const updated = await get(dbRef(path));
  return { user, room: updated.val() };
}

export async function getRoomOnce(roomId) {
  const snap = await get(dbRef(roomPath(roomId)));
  return snap.exists() ? snap.val() : null;
}

export function subscribeRoom(roomId, cb) {
  return dbOnValue(dbRef(roomPath(roomId)), (snap) => {
    cb(snap.exists() ? snap.val() : null);
  });
}

export async function startGame({ roomId, userUid }) {
  const path = roomPath(roomId);
  // (writes restricted by rules)

  // Validate constraints via a read (rules also enforce host-only writes on status/startedAt).
  const snap = await get(dbRef(path));
  const current = snap.val();
  if (!current) throw new Error("Room not found");
  if (current.createdBy !== userUid) throw new Error("Only host can start");
  if (current.status !== "waiting") throw new Error("Already started");
  if (!current.players?.p2?.uid) throw new Error("Need Player 2");

  // Write only the allowed fields.
  await update(dbRef(path), {
    status: "started",
    startedAt: { ".sv": "timestamp" },
  });

  const committed = true;
  if (!committed) throw new Error("Start failed.");
}

export async function markQuit({ roomId, playerKey }) {
  const path = `${roomPath(roomId)}/players/${playerKey}`;
  await update(dbRef(path), {
    quit: true,
    quitAt: serverTimestamp(),
  });
}

export async function setOnline({ roomId, playerKey, online }) {
  const r = dbRef(`${roomPath(roomId)}/players/${playerKey}`);
  await update(r, {
    online: Boolean(online),
    lastSeen: serverTimestamp(),
  });
}

export async function registerOnDisconnectOffline({ roomId, playerKey }) {
  // Refresh should NOT count as quit. We only mark the user offline.
  const r = dbRef(`${roomPath(roomId)}/players/${playerKey}`);
  await onDisconnect(r).update({
    online: false,
    lastSeen: { ".sv": "timestamp" },
  });
}

export async function clearOnDisconnectOffline({ roomId, playerKey }) {
  const r = dbRef(`${roomPath(roomId)}/players/${playerKey}`);
  await onDisconnect(r).cancel();
}

export async function markFinished({ roomId, playerKey }) {
  const path = `${roomPath(roomId)}/players/${playerKey}`;
  await update(dbRef(path), {
    finished: true,
    finishedAt: serverTimestamp(),
  });
}

export function parsePuzzle(room) {
  const givensStr = room?.puzzle?.givens;
  const solStr = room?.puzzle?.solution;
  if (!givensStr || !solStr) throw new Error("Room puzzle missing");
  return {
    puzzle: decodeGrid81(givensStr),
    solution: decodeGrid81(solStr),
  };
}
