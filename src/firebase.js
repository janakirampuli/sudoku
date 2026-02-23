import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  off,
  update,
  set,
  get,
  child,
  serverTimestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDBoM83GJcImR5poDXfB6C5i9di7zKz4OE",
  authDomain: "sudoku-5962e.firebaseapp.com",
  projectId: "sudoku-5962e",
  databaseURL: "https://sudoku-5962e-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "sudoku-5962e.firebasestorage.app",
  messagingSenderId: "14338708223",
  appId: "1:14338708223:web:8417ab3e47ff40139172ca",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export function getDb() {
  return db;
}

export function dbRef(path) {
  return ref(db, path);
}

export function dbOnValue(r, cb) {
  onValue(r, cb);
  return () => off(r, "value", cb);
}

export const dbApi = {
  ref,
  child,
  get,
  set,
  update,
  onValue,
  off,
  serverTimestamp,
  runTransaction,
};

export async function ensureAnonymousAuth() {
  // Returns current user (after ensuring signed in).
  const existing = auth.currentUser;
  if (existing) return existing;

  await signInAnonymously(auth);
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsub();
          resolve(user);
        }
      },
      (err) => {
        unsub();
        reject(err);
      }
    );
  });
}
