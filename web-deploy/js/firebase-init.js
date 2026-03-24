// ================================================================
//  FIREBASE INITIALIZATION
// ================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInAnonymously, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from './config.js';

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export {
    app, auth, db,
    signInAnonymously, signOut, onAuthStateChanged,
    collection, addDoc, setDoc, updateDoc, deleteDoc, doc,
    onSnapshot, query, orderBy, serverTimestamp, getDocs
};
