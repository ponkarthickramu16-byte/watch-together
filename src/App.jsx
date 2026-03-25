import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import Home from "./pages/Home";
import Room from "./pages/Room";
import Login from "./pages/Login";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{
        backgroundColor: "#0f0f0f",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontSize: "24px"
      }}>
        ⏳ Loading...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Login - Not logged in-ஆ இங்க வரும் */}
        <Route
          path="/login"
          element={user ? <Navigate to="/" /> : <Login />}
        />
        {/* Home - Login ஆனா மட்டும் */}
        <Route
          path="/"
          element={user ? <Home user={user} /> : <Navigate to="/login" />}
        />
        {/* Room - Login ஆனா மட்டும் */}
        <Route
          path="/room/:roomId"
          element={user ? <Room user={user} /> : <Navigate to="/login" />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;