import { useState, useRef } from "react";
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
    const fileInputRef = useRef(null);

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

    const handleFileUpload = async (file) => {
        if (!file) return;

        const isVideo = file.type.startsWith("video/") ||
            /\.(mp4|mkv|avi|mov|webm|m4v|3gp|flv|wmv)$/i.test(file.name);

        if (!isVideo) {
            setError("❌ Video file மட்டும் upload பண்ணு (MP4, MKV, MOV...)");
            return;
        }

        const maxSize = 100 * 1024 * 1024;
        if (file.size > maxSize) {
            setError(`❌ File ${(file.size / 1024 / 1024).toFixed(0)}MB - Max 100MB!\nYouTube link use பண்ணு - better!`);
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
            setError("❌ Upload fail: " + err.message);
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (file) handleFileUpload(file);
        e.target.value = "";
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFileUpload(file);
    };

    const handleYouTubeOrLink = async () => {
        const url = movieUrl.trim();
        if (!url) { setError("❌ Link enter பண்ணு"); return; }
        setError("");
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

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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

                {!uploading ? (
                    <>
                        {isMobile ? (
                            /* ✅ MOBILE: label directly wraps input - no JS click needed, no permission issue */
                            <label style={styles.mobileLabel}>
                                <span style={{ fontSize: "40px" }}>📁</span>
                                <span style={{ color: "white", fontWeight: "bold", fontSize: "16px" }}>
                                    Video File Select பண்ணு
                                </span>
                                <span style={{ color: "#888", fontSize: "12px" }}>
                                    Gallery-இல் இருந்து video choose பண்ணு
                                </span>
                                <span style={{ color: "#555", fontSize: "11px" }}>
                                    MP4, MKV, MOV • Max 100MB
                                </span>
                                <input
                                    type="file"
                                    accept="video/*"
                                    onChange={handleFileChange}
                                    style={{ display: "none" }}
                                />
                            </label>
                        ) : (
                            /* ✅ DESKTOP: Drag & Drop */
                            <div
                                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    ...styles.uploadArea,
                                    borderColor: dragOver ? "#ff6b35" : "#333",
                                    backgroundColor: dragOver ? "rgba(255,107,53,0.05)" : "#111",
                                }}
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
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="video/*"
                                    onChange={handleFileChange}
                                    style={{ display: "none" }}
                                />
                            </div>
                        )}
                    </>
                ) : (
                    <div style={styles.progressContainer}>
                        <div style={{ fontSize: "32px", marginBottom: "12px" }}>⬆️</div>
                        <p style={{ color: "white", fontSize: "16px", margin: "0 0 16px 0" }}>
                            Upload ஆகுது... {uploadProgress}%
                        </p>
                        <div style={styles.progressBar}>
                            <div style={{ ...styles.progressFill, width: `${uploadProgress}%` }} />
                        </div>
                        <p style={{ color: "#555", fontSize: "12px", marginTop: "8px" }}>
                            {uploadProgress < 40 ? "Upload ஆகுது..." : uploadProgress < 80 ? "கிட்டத்தட்ட ஆச்சு..." : "Ready ஆகுது..."}
                        </p>
                    </div>
                )}

                {/* Divider */}
                <div style={styles.divider}>
                    <div style={styles.dividerLine} />
                    <span style={styles.dividerText}>அல்லது</span>
                    <div style={styles.dividerLine} />
                </div>

                {/* YouTube Input */}
                <div style={{ marginBottom: "16px" }}>
                    <p style={{ color: "#aaa", fontSize: "14px", margin: "0 0 10px 0" }}>
                        🎬 YouTube link போடு (Best - no upload needed!)
                    </p>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <input
                            type="url"
                            placeholder="https://youtube.com/watch?v=..."
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

                {/* Mobile permission help */}
                {isMobile && (
                    <div style={{ backgroundColor: "#111", borderRadius: "10px", padding: "12px 14px", marginTop: "12px" }}>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 4px 0" }}>
                            ⚠️ Permission error வந்தா:
                        </p>
                        <p style={{ color: "#444", fontSize: "11px", margin: "0 0 2px 0" }}>
                            Chrome → 🔒 → Site settings → Files → Allow
                        </p>
                        <p style={{ color: "#444", fontSize: "11px", margin: 0 }}>
                            அல்லது YouTube link use பண்ணு ✅
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

const styles = {
    container: { backgroundColor: "#0f0f0f", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px 40px" },
    header: { width: "100%", maxWidth: "600px", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0" },
    logo: { color: "white", fontSize: "20px", fontWeight: "bold" },
    userInfo: { display: "flex", alignItems: "center", gap: "10px" },
    userName: { color: "#aaa", fontSize: "14px" },
    logoutBtn: { padding: "6px 12px", backgroundColor: "transparent", color: "#666", border: "1px solid #333", borderRadius: "6px", cursor: "pointer", fontSize: "13px" },
    card: { width: "100%", maxWidth: "560px", backgroundColor: "#1a1a1a", borderRadius: "20px", padding: "32px 24px", border: "1px solid #222" },
    title: { color: "white", fontSize: "22px", margin: "0 0 8px 0", textAlign: "center", fontWeight: "bold" },
    subtitle: { color: "#666", fontSize: "14px", margin: "0 0 24px 0", textAlign: "center" },
    // ✅ Mobile label style - big tappable area
    mobileLabel: {
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "10px", padding: "32px 20px",
        backgroundColor: "#111", border: "2px dashed #ff6b35",
        borderRadius: "14px", cursor: "pointer", textAlign: "center",
        WebkitTapHighlightColor: "rgba(255,107,53,0.2)",
        minHeight: "160px",
    },
    uploadArea: { border: "2px dashed #333", borderRadius: "14px", padding: "32px 20px", textAlign: "center", transition: "all 0.2s", cursor: "pointer" },
    progressContainer: { border: "2px solid #ff6b35", borderRadius: "14px", padding: "32px 20px", textAlign: "center", backgroundColor: "rgba(255,107,53,0.05)" },
    progressBar: { width: "100%", height: "8px", backgroundColor: "#333", borderRadius: "4px", overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: "#ff6b35", borderRadius: "4px", transition: "width 0.3s ease" },
    divider: { display: "flex", alignItems: "center", gap: "12px", margin: "24px 0" },
    dividerLine: { flex: 1, height: "1px", backgroundColor: "#2a2a2a" },
    dividerText: { color: "#444", fontSize: "13px" },
    urlInput: { flex: 1, padding: "12px 14px", backgroundColor: "#2a2a2a", border: "1px solid #333", borderRadius: "8px", color: "white", fontSize: "14px", outline: "none" },
    goBtn: { padding: "12px 20px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "bold" },
    errorBox: { backgroundColor: "rgba(231,76,60,0.15)", border: "1px solid rgba(231,76,60,0.3)", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#e74c3c" },
};

export default Home;