import { auth } from "../firebase";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

function Login() {
    const handleGoogleLogin = async () => {
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            // Login success - App.jsx auto redirect பண்ணும்!
        } catch (err) {
            alert("Login failed: " + err.message);
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.card}>

                {/* Logo */}
                <div style={styles.logo}>
                    <span style={styles.logoEmoji}>🎬</span>
                    <h1 style={styles.logoText}>Watch Together</h1>
                    <p style={styles.logoSub}>உன் partner-ஓட சேர்ந்து movie பாரு!</p>
                </div>

                {/* Google Login Button */}
                <button onClick={handleGoogleLogin} style={styles.googleBtn}>
                    <img
                        src="https://www.google.com/favicon.ico"
                        alt="Google"
                        style={styles.googleIcon}
                    />
                    Google-ல Login பண்ணு
                </button>

                <p style={styles.note}>
                    Login ஆனா உன் partner-கு link share பண்ணி சேர்ந்து movie பாக்கலாம்! 🎉
                </p>
            </div>
        </div>
    );
}

const styles = {
    container: {
        backgroundColor: "#0f0f0f",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
    },
    card: {
        backgroundColor: "#1a1a1a",
        borderRadius: "20px",
        padding: "40px",
        width: "100%",
        maxWidth: "400px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        textAlign: "center",
    },
    logo: {
        marginBottom: "40px",
    },
    logoEmoji: {
        fontSize: "56px",
    },
    logoText: {
        color: "white",
        fontSize: "28px",
        margin: "8px 0 4px 0",
    },
    logoSub: {
        color: "#666",
        fontSize: "14px",
        margin: 0,
    },
    googleBtn: {
        width: "100%",
        padding: "14px",
        backgroundColor: "white",
        color: "#333",
        border: "none",
        borderRadius: "10px",
        fontSize: "16px",
        cursor: "pointer",
        fontWeight: "bold",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        marginBottom: "20px",
    },
    googleIcon: {
        width: "20px",
        height: "20px",
    },
    note: {
        color: "#555",
        fontSize: "13px",
        lineHeight: "1.5",
    },
};

export default Login;