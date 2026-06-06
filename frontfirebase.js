import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const firebaseConfig = {
  apiKey: "AIzaSyC2Ja45yVDE8RzlyI-23z4LW89cy99Yvt0",
  authDomain: "siomai-b3afe.firebaseapp.com",
  projectId: "siomai-b3afe",
  storageBucket: "siomai-b3afe.appspot.com",
  messagingSenderId: "576185589251",
  appId: "1:576185589251:web:cffb3dd4bfd939ae273836",
  measurementId: "G-Q8NFMB0N29"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

