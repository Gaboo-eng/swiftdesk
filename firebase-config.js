// Firebase web app configuration. These values identify the project; they are
// not a service-account key. Never put private credentials in frontend files.
export const firebaseConfig = {
  apiKey: "AIzaSyAPv2wWzE9bLPwf-yX_LcUQ71iHHX7TpFY",
  authDomain: "swifdesk-5086b.firebaseapp.com",
  projectId: "swifdesk-5086b",
  storageBucket: "swifdesk-5086b.firebasestorage.app",
  messagingSenderId: "683314669237",
  appId: "1:683314669237:web:8ab6b6f3eb828b83d840fc"
};

export const firebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.trim().length > 0
);
