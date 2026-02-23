export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function randomRoomId(len = 6) {
  // Crockford-ish base32 without ambiguous chars.
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

export async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

export function showToast(elToast, msg) {
  elToast.textContent = msg;
  elToast.classList.add("toast--show");
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    elToast.classList.remove("toast--show");
  }, 2400);
}
