// Firebase web app configuration. These values identify the project; they are
// not a service-account key. Never put private credentials in frontend files.
export const firebaseConfig = {
  apiKey: "AIzaSyDG6edEuTVcf3Bq3-k6qh-X9VrmC40woIg",
  authDomain: "swiftdesk-2c03a.firebaseapp.com",
  projectId: "swiftdesk-2c03a",
  storageBucket: "swiftdesk-2c03a.firebasestorage.app",
  messagingSenderId: "401102154522",
  appId: "1:401102154522:web:1ed9572ca2aa2b037cdaa3"
};

export const firebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.trim().length > 0
);
