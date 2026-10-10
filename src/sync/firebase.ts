import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, type User } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';

// Firebase web config is public by design (it ships to every browser).
// What protects the data is database.rules.json.
const config = {
  apiKey: 'AIzaSyDs5YeJz0Sbv-yyHurvSWQLvpySf0CHVqs',
  authDomain: 'vrcalib.firebaseapp.com',
  databaseURL: 'https://vrcalib-default-rtdb.firebaseio.com',
  projectId: 'vrcalib',
  storageBucket: 'vrcalib.firebasestorage.app',
  messagingSenderId: '799004436449',
  appId: '1:799004436449:web:26f0fe7e1ba07ddca754a0',
};

const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Tests (playwright.config.ts) run against the local emulators, never the real project.
if (import.meta.env.VITE_FIREBASE_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
}

let user: Promise<User> | null = null;

/** Anonymous sign-in. The uid persists in this browser, so reloads keep session ownership. */
export function signIn(): Promise<User> {
  user ??= signInAnonymously(auth).then((c) => c.user);
  return user;
}
