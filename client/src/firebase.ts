import { initializeApp } from 'firebase/app';
import { getAuth }       from 'firebase/auth';
import { getFirestore }  from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD4s34IcOJzZC_BooI8HKn8KOyu98gNViY",
  authDomain: "facilrepuestos-prod.firebaseapp.com",
  projectId: "facilrepuestos-prod",
  storageBucket: "facilrepuestos-prod.firebasestorage.app",
  messagingSenderId: "271258776702",
  appId: "1:271258776702:web:ee70f98366a4086a8dd42f"
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
