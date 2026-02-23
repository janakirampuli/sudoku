import { dbApi, dbRef, dbOnValue, ensureAnonymousAuth } from "./firebase.js";
import {
  decodeGrid81,
  encodeGrid81,
  generateSolvedGrid,
  makePuzzleFromSolution,
} from "./sudoku.js";
import { randomRoomId } from "./utils.js";

const { get, set, update, runTransaction, serverTimestamp } = dbApi;

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

  // Use a transaction to claim p2 if empty.
  const r = dbRef(path);
  const { committed, snapshot } = await runTransaction(r, (current) => {
    if (!current) return current;
    const players = current.players || {};
    const p1 = players.p1;
    const p2 = players.p2;
    if (!p1) return current; // malformed
    if (p1.uid === user.uid) return current; // already host on this device
    if (p2 && p2.uid && p2.uid !== user.uid) {
      // already taken
      return;
    }

    // If we already joined as p2 on this device earlier, keep joinedAt.
    const joinedAt = p2?.uid === user.uid ? p2.joinedAt : { ".sv": "timestamp" };
    current.players = {
      ...players,
      p2: {
        uid: user.uid,
        name,
        joinedAt,
        finished: p2?.uid === user.uid ? Boolean(p2.finished) : false,
        finishedAt: p2?.uid === user.uid ? p2.finishedAt ?? null : null,
      },
    };
    return current;
  });

  if (!committed) {
    throw new Error("Could not join. Room full or does not exist.");
  }

  const room = snapshot.val();
  return { user, room };
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
  const r = dbRef(path);
  const { committed } = await runTransaction(r, (current) => {
    if (!current) return current;
    if (current.createdBy !== userUid) return; // only host
    if (current.status !== "waiting") return; // already started
    if (!current.players?.p2?.uid) return; // need p2

    current.status = "started";
    current.startedAt = { ".sv": "timestamp" };
    return current;
  });
  if (!committed) throw new Error("Start failed.");
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
