// Shared Firebase setup for Lexicon.
// Loaded as an ES module by index.html, login.html and signup.html.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBhQt_EZVNMXZw-pVMDWtmrMKY4FR5Y17s",
  authDomain: "lexicon-app-59a7b.firebaseapp.com",
  projectId: "lexicon-app-59a7b",
  storageBucket: "lexicon-app-59a7b.firebasestorage.app",
  messagingSenderId: "394018780013",
  appId: "1:394018780013:web:b31364d7edec352f8aa064"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache()
});

import { db } from './firebase-config.js';
import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

// Fetch the current user's saved data (or null if they're new)
export async function loadUserData(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Save/merge data into the current user's document
export async function saveUserData(uid, data) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, data, { merge: true }); // merge so partial saves don't wipe other fields
}