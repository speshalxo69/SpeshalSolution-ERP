// ================================================================
//  FIREBASE INITIALIZATION
// ================================================================
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp, getDocs, getDoc, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from './config.js';

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

function createSecondaryAuthSession(name = `secondary-auth-${Date.now()}`) {
    const secondaryApp = initializeApp(firebaseConfig, name);
    return {
        app: secondaryApp,
        auth: getAuth(secondaryApp),
    };
}

export {
    app, auth, db,
    createSecondaryAuthSession, deleteApp,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
    collection, addDoc, setDoc, updateDoc, deleteDoc, doc,
    onSnapshot, query, orderBy, serverTimestamp, getDocs, getDoc, where
};
