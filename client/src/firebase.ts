import { initializeApp } from 'firebase/app';
import { getAuth }       from 'firebase/auth';
import { getFirestore }  from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            "AIzaSyC3-uryrU8X1Xe7-xlOoZDovEHT0RqNLZI",
  authDomain:        "drmotors-prod.firebaseapp.com",
  projectId:         "drmotors-prod",
  storageBucket:     "drmotors-prod.firebasestorage.app",
  messagingSenderId: "29521409532",
  appId:             "1:29521409532:web:afbcff5cb4d7a55eb8ae79"
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
