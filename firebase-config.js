// Firebase configuration
// Replace these values with your actual Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDbyT1uJ6iAjOQMm_CYRgcKfu7PJPBN78M",
  authDomain: "gateease-23400.firebaseapp.com",
  projectId: "gateease-23400",
  storageBucket: "gateease-23400.firebasestorage.app",
  messagingSenderId: "155438760432",
  appId: "1:155438760432:web:1a22ce8a1d4d8c5ff2dd35",
  measurementId: "G-LXLGP679XW"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Export for use in other files
window.db = db;
window.firebase = firebase;