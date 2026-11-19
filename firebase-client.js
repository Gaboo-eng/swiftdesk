import { firebaseConfig, firebaseConfigured } from "./firebase-config.js";

export const firebaseReady = (async () => {
  if (!firebaseConfigured) {
    throw new Error("Completa la configuración web de Firebase en firebase-config.js.");
  }

  const [appSdk, authSdk, firestoreSdk] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
  ]);
  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);

  await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);

  return {
    auth,
    db,
    signInWithEmailAndPassword: authSdk.signInWithEmailAndPassword,
    sendPasswordResetEmail: authSdk.sendPasswordResetEmail,
    signOut: authSdk.signOut,
    onAuthStateChanged: authSdk.onAuthStateChanged,
    setPersistence: authSdk.setPersistence,
    inMemoryPersistence: authSdk.inMemoryPersistence,
    getAuth: authSdk.getAuth,
    createUserWithEmailAndPassword: authSdk.createUserWithEmailAndPassword,
    deleteUser: authSdk.deleteUser,
    deleteApp: appSdk.deleteApp,
    initializeApp: appSdk.initializeApp,
    collection: firestoreSdk.collection,
    doc: firestoreSdk.doc,
    getDoc: firestoreSdk.getDoc,
    getDocs: firestoreSdk.getDocs,
    addDoc: firestoreSdk.addDoc,
    setDoc: firestoreSdk.setDoc,
    updateDoc: firestoreSdk.updateDoc,
    deleteDoc: firestoreSdk.deleteDoc,
    onSnapshot: firestoreSdk.onSnapshot,
    serverTimestamp: firestoreSdk.serverTimestamp
  };
})();
