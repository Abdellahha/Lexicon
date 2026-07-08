import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBhQt_EZVNMXZw-pVMDWtmrMKY4FR5Y17s",
  authDomain: "lexicon-app-59a7b.firebaseapp.com",
  projectId: "lexicon-app-59a7b",
  storageBucket: "lexicon-app-59a7b.firebasestorage.app",
  messagingSenderId: "394018780013",
  appId: "1:394018780013:web:b31364d7edec352f8aa064",
  databaseURL: "https://lexicon-app-59a7b-default-rtdb.europe-west1.firebasedatabase.app"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
