// js/firebase-config.js
// ============================================================================
// FIREBASE CONFIGURATION (CDN Modular SDK v10)
// To connect your own Firebase project:
//   Firebase Console -> Project Settings -> Your apps -> SDK setup -> Config
//   and replace the values inside `firebaseConfig` below.
// ============================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyDBPtqqd3mYOrJQVxcRPCUopOZ1sxNuGo4",
  authDomain: "tution-b95fa.firebaseapp.com",
  databaseURL: "https://tution-b95fa-default-rtdb.firebaseio.com",
  projectId: "tution-b95fa",
  storageBucket: "tution-b95fa.firebasestorage.app",
  messagingSenderId: "683669015406",
  appId: "1:683669015406:web:9a9e321c91c08a12cb0f7f"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  update,
  remove,
  onValue
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  ref,
  get,
  set,
  push,
  update,
  remove,
  onValue
};
