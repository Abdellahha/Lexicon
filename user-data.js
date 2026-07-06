import { db } from './firebase-config.js';
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

export async function loadUserData(uid) {
  const snap = await get(ref(db, 'users/' + uid));
  return snap.exists() ? snap.val() : null;
}

export async function saveUserData(uid, data) {
  await update(ref(db, 'users/' + uid), data); // merges fields, doesn't wipe others
}