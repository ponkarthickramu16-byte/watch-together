import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { collection, addDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { uploadToCloudinary } from "../cloudinary";

const generateRoomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const getYouTubeId = (url) => {
    const match = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
};

function Home({ user }) {
    const navigate = useNavigate();
    const [movieUrl, setMovieUrl] = useState("");
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [error, setError] = useState("");
    const [dragOver, setDragOver] = useState(false);

    const createRoom = async (url, type) => {
        const roomId = generateRoomId();
        await addDoc(collection(db, "rooms"), {
            roomId,
            movieUrl: url,
            movieType: type,
            isPlaying: false,
            currentTime: 0,
            createdAt: new Date(),
            createdBy: user?.displayName || "Anonymous",
            callStatus: "idle",
            callBy: "",
        });
        navigate(`/room/${roomId}`);
    };

    // ✅ File upload handler - mobile + desktop both work
    const handleFileUpload = async (file) => {
        if (!file) return;

        // ✅ Check file type - video/* accept panna mobile la kadaiyathu, so manual check
        const isVideo = file.type.startsWith("video/") ||
            file.name.match(/\.(mp4|mkv|avi|mov|webm|m4v|3gp|flv|wmv)$/i);

        if (!isVideo) {
            setError("❌ Video file மட்டும் upload பண்ணு (MP4, MKV, MOV...)");
            return;
        }

        // ✅ Size check - Cloudinary free = 100MB limit
        const maxSize = 100 * 1024 * 1024; // 100MB
        if (file.size > maxSize) {
            setError(`❌ File size too big! Maximum 100MB. உன் file: ${(file.size / 1024 / 1024).toFixed(0)}MB\n\nYouTube link use பண்ணு - அது better!`);
            return;
        }

        setError("");
        setUploading(true);
        setUploadProgress(0);

        try {
            const url = await uploadToCloudinary(file, (progress) => {
                setUploadProgress(progress);
            });
            await createRoom(url, "cloudinary");
        } catch (err) {
            setError("❌ Upload fail ஆச்சு: " + err.message);
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) handleFileUpload(file);
    };

    // ✅ Drag and drop
    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFileUpload(file);
    };

    const handleYouTubeOrLink = async () => {
        const url = movieUrl.trim();
        if (!url) { setError("❌ Link enter பண்ணு"); return; }

        const ytId = getYouTubeId(url);
        if (ytId) {
            await createRoom(url, "youtube");
        } else if (url.startsWith("http")) {
            await createRoom(url, "direct");
        } else {
            setError("❌ Valid YouTube link அல்லது video URL enter பண்ணு");
        }
    };

    const handleLogout = async () => {
        await signOut(auth);
    };

    return (
        <div style={styles.container}>
            {/* Header */}
            <div style={styles.header}>
                <div style={styles.logo}>🎬 Watch Together</div>
                <div style={styles.userInfo}>
                    {user?.photoURL && (
                        <img src={user.photoURL} alt="avatar"
                            style={{ width: "32px", height: "32px", borderRadius: "50%", border: "2px solid #ff6b35" }} />
                    )}
                    <span style={styles.userName}>{user?.displayName || "User"}</span>
                    <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
                </div>
            </div>

            {/* Main Card */}
            <div style={styles.card}>
                <h1 style={styles.title}>உன் partner-கூட movie பாரு 🍿</h1>
                <p style={styles.subtitle}>Movie upload பண்ணு அல்லது YouTube link போடு</p>

                {/* ✅ Upload Area - Drag & Drop + Click */}
                {!uploading ? (
                    <div
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        style={{
                            ...styles.uploadArea,
                            borderColor: dragOver ? "#ff6b35" : "#333",
                            backgroundColor: dragOver ? "rgba(255,107,53,0.05)" : "#111",
                        }}
                        onClick={() => document.getElementById("fileInput").click()}
                    >
                        <div style={{ fontSize: "48px", marginBottom: "12px" }}>📁</div>
                        <p style={{ color: "white", fontSize: "16px", margin: "0 0 8px 0", fontWeight: "bold" }}>
                            Click பண்ணி movie select பண்ணு
                        </p>
                        <p style={{ color: "#555", fontSize: "13px", margin: "0 0 4px 0" }}>
                            அல்லது இங்க drag & drop பண்ணு
                        </p>
                        <p style={{ color: "#444", fontSize: "12px", margin: 0 }}>
                            MP4, MKV, MOV, AVI • Max 100MB
                        </p>

                        {/* ✅ Mobile fix - no accept attribute, handle manually */}
                        <input
                            id="fileInput"
                            type="file"
                            accept="video/*,video/mp4,video/x-matroska,video/quicktime,video/x-msvideo,video/webm,.mp4,.mkv,.mov,.avi,.webm,.m4v,.3gp"
                            onChange={handleFileChange}
                            style={{ display: "none" }}
                            capture={false}
                        />
                    </div>
                ) : (
                    /* Upload Progress */
                    <div style={styles.progressContainer}>
                        <div style={{ fontSize: "32px", marginBottom: "12px" }}>⬆️</div>
                        <p style={{ color: "white", fontSize: "16px", margin: "0 0 16px 0" }}>
                            Upload ஆகுது... {uploadProgress}%
                        </p>
                        <div style={styles.progressBar}>
                            <div style={{ ...styles.progressFill, width: `${uploadProgress}%` }} />
                        </div>
                        <p style={{ color: "#555", fontSize: "12px", marginTop: "8px" }}>
                            {uploadProgress < 50 ? "Upload ஆகுது..." : uploadProgress < 90 ? "கிட்டத்தட்ட ஆச்சு..." : "Ready ஆகுது..."}
                        </p>
                    </div>
                )}

                {/* Divider */}
                <div style={styles.divider}>
                    <div style={styles.dividerLine} />
                    <span style={styles.dividerText}>அல்லது</span>
                    <div style={styles.dividerLine} />
                </div>

                {/* YouTube / Link Input */}
                <div style={styles.linkSection}>
                    <p style={{ color: "#aaa", fontSize: "14px", margin: "0 0 10px 0" }}>
                        🔗 YouTube link அல்லது Direct video URL
                    </p>
                    <div style={styles.inputRow}>
                        <input
                            type="url"
                            placeholder="https://youtube.com/watch?v=... or https://..."
                            value={movieUrl}
                            onChange={(e) => { setMovieUrl(e.target.value); setError(""); }}
                            onKeyPress={(e) => e.key === "Enter" && handleYouTubeOrLink()}
                            style={styles.urlInput}
                        />
                        <button onClick={handleYouTubeOrLink} style={styles.goBtn}>▶ Go</button>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div style={styles.errorBox}>
                        <p style={{ margin: 0, fontSize: "13px", whiteSpace: "pre-line" }}>{error}</p>
                    </div>
                )}

                {/* Info */}
                <div style={styles.infoBox}>
                    <p style={styles.infoText}>💡 <strong>Tips:</strong></p>
                    <p style={styles.infoText}>• YouTube link best - unlimited, fast ✅</p>
                    <p style={styles.infoText}>• File upload max 100MB (Cloudinary free limit)</p>
                    <p style={styles.infoText}>• Mobile-ல gallery-இல் இருந்து video select பண்ணலாம்</p>
                </div>
            </div>

            <style>{`
                @media (max-width: 600px) {
                    .upload-area { padding: 24px 16px !important; }
                }
            `}</style>
        </div>
    );
}

const styles = {
    container: {
        backgroundColor: "#0f0f0f",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 16px 40px",
    },
    header: {
        width: "100%",
        maxWidth: "600px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "20px 0",
    },
    logo: { color: "white", fontSize: "20px", fontWeight: "bold" },
    userInfo: { display: "flex", alignItems: "center", gap: "10px" },
    userName: { color: "#aaa", fontSize: "14px" },
    logoutBtn: { padding: "6px 12px", backgroundColor: "transparent", color: "#666", border: "1px solid #333", borderRadius: "6px", cursor: "pointer", fontSize: "13px" },
    card: {
        width: "100%",
        maxWidth: "560px",
        backgroundColor: "#1a1a1a",
        borderRadius: "20px",
        padding: "32px",
        border: "1px solid #222",
    },
    title: { color: "white", fontSize: "24px", margin: "0 0 8px 0", textAlign: "center" },
    subtitle: { color: "#666", fontSize: "14px", margin: "0 0 28px 0", textAlign: "center" },
    uploadArea: {
        border: "2px dashed #333",
        borderRadius: "14px",
        padding: "32px 20px",
        textAlign: "center",
        cursor: "pointer",
        transition: "all 0.2s",
    },
    progressContainer: {
        border: "2px solid #ff6b35",
        borderRadius: "14px",
        padding: "32px 20px",
        textAlign: "center",
        backgroundColor: "rgba(255,107,53,0.05)",
    },
    progressBar: { width: "100%", height: "8px", backgroundColor: "#333", borderRadius: "4px", overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: "#ff6b35", borderRadius: "4px", transition: "width 0.3s ease" },
    divider: { display: "flex", alignItems: "center", gap: "12px", margin: "24px 0" },
    dividerLine: { flex: 1, height: "1px", backgroundColor: "#2a2a2a" },
    dividerText: { color: "#444", fontSize: "13px" },
    linkSection: { marginBottom: "16px" },
    inputRow: { display: "flex", gap: "8px" },
    urlInput: { flex: 1, padding: "12px 14px", backgroundColor: "#2a2a2a", border: "1px solid #333", borderRadius: "8px", color: "white", fontSize: "14px", outline: "none" },
    goBtn: { padding: "12px 20px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "bold", whiteSpace: "nowrap" },
    errorBox: { backgroundColor: "rgba(231,76,60,0.15)", border: "1px solid rgba(231,76,60,0.3)", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#e74c3c" },
    infoBox: { backgroundColor: "#111", borderRadius: "10px", padding: "14px 16px", marginTop: "16px" },
    infoText: { color: "#555", fontSize: "12px", margin: "0 0 4px 0" },
};

export default Home;