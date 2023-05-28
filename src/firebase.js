// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth'
// TODO: Add SDKs for Firebase products that you want to use

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_authDomain,
  databaseURL: import.meta.env.VITE_FIREBASE_databaseURL,
  projectId: import.meta.env.VITE_FIREBASE_projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_appId
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)
const database = getDatabase(app)
const functions = getFunctions(app, 'asia-east1')

export {
  database,
  functions,
  httpsCallable,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
}
