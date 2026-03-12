import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { collection, addDoc, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { uploadToCloudinary } from "../cloudinary";

const generateRoomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const getYouTubeId = (url) => {
    const match = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
};

const formatDateTime = (date) => {
    if (!date) return { dateStr: "", timeStr: "" };
    const d = date.toDate ? date.toDate() : new Date(date);
    const dateStr = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return { dateStr, timeStr };
};

const getMovieTitle = (entry) => {
    if (entry.movieTitle) return entry.movieTitle;
    const ytId = getYouTubeId(entry.movieUrl || "");
    if (ytId) return "YouTube Video";
    const filename = entry.movieUrl?.split("/").pop()?.split("?")[0] || "Movie";
    return decodeURIComponent(filename).substring(0, 40);
};

function Home({ user }) {
    const navigate = useNavigate();
    const [movieUrl, setMovieUrl] = useState("");
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [error, setError] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const [activeTab, setActiveTab] = useState("create");
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(true);

    // ✅ Load watch history for current user
    useEffect(() => {
        if (!user?.displayName) return;
        const q = query(
            collection(db, "watchHistory"),
            where("watchedBy", "==", user.displayName),
            orderBy("watchedAt", "desc")
        );
        const unsub = onSnapshot(q, (snap) => {
            setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setHistoryLoading(false);
        }, () => setHistoryLoading(false));
        return unsub;
    }, [user?.displayName]);

    const createRoom = async (url, type) => {
        const roomId = generateRoomId();
        await addDoc(collection(db, "rooms"), {
            roomId, movieUrl: url, movieType: type,
            isPlaying: false, currentTime: 0, createdAt: new Date(),
            createdBy: user?.displayName || "Anonymous",
            callStatus: "idle", callBy: "",
        });
        navigate(`/room/${roomId}`);
    };

    const handleFileUpload = async (file) => {
        if (!file) return;
        const isVideo = file.type.startsWith("video/") || file.name.match(/\.(mp4|mkv|avi|mov|webm|m4v|3gp|flv|wmv)$/i);
        if (!isVideo) { setError("❌ Video file மட்டும் upload பண்ணு (MP4, MKV, MOV...)"); return; }
        const maxSize = 100 * 1024 * 1024;
        if (file.size > maxSize) { setError(`❌ File too big! Max 100MB. உன் file: ${(file.size / 1024 / 1024).toFixed(0)}MB — YouTube link use பண்ணு!`); return; }
        setError(""); setUploading(true); setUploadProgress(0);
        try {
            const url = await uploadToCloudinary(file, (p) => setUploadProgress(p));
            await createRoom(url, "cloudinary");
        } catch (err) {
            setError("❌ Upload fail: " + err.message);
        } finally {
            setUploading(false); setUploadProgress(0);
        }
    };

    const handleFileChange = (e) => { const f = e.target.files[0]; if (f) handleFileUpload(f); e.target.value = ""; };
    const handleDrop = (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); };

    const handleYouTubeOrLink = async () => {
        const url = movieUrl.trim();
        if (!url) { setError("❌ Link enter பண்ணு"); return; }
        setError("");
        const ytId = getYouTubeId(url);
        if (ytId) await createRoom(url, "youtube");
        else if (url.startsWith("http")) await createRoom(url, "direct");
        else setError("❌ Valid YouTube link அல்லது video URL enter பண்ணு");
    };

    const handleLogout = async () => { await signOut(auth); };

    // Group by date
    const groupedHistory = history.reduce((acc, item) => {
        const { dateStr, timeStr } = formatDateTime(item.watchedAt);
        const key = dateStr || "Unknown Date";
        if (!acc[key]) acc[key] = [];
        acc[key].push({ ...item, _time: timeStr });
        return acc;
    }, {});

    return (
        <div style={S.container}>
            {/* Header */}
            <div style={S.header}>
                <div style={S.logo}>🎬 Watch Together</div>
                <div style={S.userInfo}>
                    {user?.photoURL && (
                        <img src={user.photoURL} alt="avatar"
                            style={{ width: "32px", height: "32px", borderRadius: "50%", border: "2px solid #ff6b35" }} />
                    )}
                    <span style={S.userName}>{user?.displayName || "User"}</span>
                    <button onClick={handleLogout} style={S.logoutBtn}>Logout</button>
                </div>
            </div>

            {/* Tabs */}
            <div style={S.tabs}>
                <button onClick={() => setActiveTab("create")}
                    style={{ ...S.tab, ...(activeTab === "create" ? S.tabActive : {}) }}>
                    ➕ New Room
                </button>
                <button onClick={() => setActiveTab("history")}
                    style={{ ...S.tab, ...(activeTab === "history" ? S.tabActive : {}) }}>
                    📜 Watch History
                    {history.length > 0 && (
                        <span style={S.badge}>{history.length}</span>
                    )}
                </button>
            </div>

            {/* ===== CREATE ROOM ===== */}
            {activeTab === "create" && (
                <div style={S.card}>
                    <h1 style={S.title}>உன் partner-கூட movie பாரு 🍿</h1>
                    <p style={S.subtitle}>Movie upload பண்ணு அல்லது YouTube link போடு</p>

                    {!uploading ? (
                        <label htmlFor="fileInput"
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            style={{ ...S.uploadArea, borderColor: dragOver ? "#ff6b35" : "#333", backgroundColor: dragOver ? "rgba(255,107,53,0.08)" : "#111", display: "block", cursor: "pointer" }}>
                            <div style={{ fontSize: "48px", marginBottom: "12px" }}>📁</div>
                            <p style={{ color: "white", fontSize: "16px", margin: "0 0 8px 0", fontWeight: "bold" }}>இங்க tap பண்ணி video select பண்ணு</p>
                            <p style={{ color: "#555", fontSize: "13px", margin: "0 0 4px 0" }}>Gallery / Files app-ல இருந்து select பண்ணலாம்</p>
                            <p style={{ color: "#444", fontSize: "12px", margin: 0 }}>MP4, MKV, MOV, AVI • Max 100MB</p>
                            <input id="fileInput" type="file" accept="video/*" onChange={handleFileChange} style={{ display: "none" }} />
                        </label>
                    ) : (
                        <div style={S.progressContainer}>
                            <div style={{ fontSize: "32px", marginBottom: "12px" }}>⬆️</div>
                            <p style={{ color: "white", fontSize: "16px", margin: "0 0 16px 0" }}>Upload ஆகுது... {uploadProgress}%</p>
                            <div style={S.progressBar}><div style={{ ...S.progressFill, width: `${uploadProgress}%` }} /></div>
                            <p style={{ color: "#555", fontSize: "12px", marginTop: "8px" }}>
                                {uploadProgress < 50 ? "Upload ஆகுது, wait பண்ணு..." : uploadProgress < 90 ? "கிட்டத்தட்ட ஆச்சு..." : "Ready ஆகுது..."}
                            </p>
                        </div>
                    )}

                    <div style={S.divider}>
                        <div style={S.dividerLine} /><span style={S.dividerText}>அல்லது</span><div style={S.dividerLine} />
                    </div>

                    <div style={{ marginBottom: "16px" }}>
                        <p style={{ color: "#aaa", fontSize: "14px", margin: "0 0 10px 0" }}>🔗 YouTube link அல்லது Direct video URL</p>
                        <div style={{ display: "flex", gap: "8px" }}>
                            <input type="url" placeholder="https://youtube.com/watch?v=..." value={movieUrl}
                                onChange={(e) => { setMovieUrl(e.target.value); setError(""); }}
                                onKeyPress={(e) => e.key === "Enter" && handleYouTubeOrLink()}
                                style={S.urlInput} />
                            <button onClick={handleYouTubeOrLink} style={S.goBtn}>▶ Go</button>
                        </div>
                    </div>

                    {error && <div style={S.errorBox}><p style={{ margin: 0, fontSize: "13px", whiteSpace: "pre-line" }}>{error}</p></div>}

                    <div style={S.infoBox}>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 4px 0" }}>💡 <strong style={{ color: "#666" }}>Tips:</strong></p>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 3px 0" }}>• YouTube link best - fast & unlimited ✅</p>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 3px 0" }}>• File upload max 100MB (personal videos மட்டும்)</p>
                        <p style={{ color: "#555", fontSize: "12px", margin: 0 }}>• Mobile gallery-இல் இருந்து video select ஆகும் ✅</p>
                    </div>
                </div>
            )}

            {/* ===== WATCH HISTORY ===== */}
            {activeTab === "history" && (
                <div style={S.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                        <h2 style={{ color: "white", fontSize: "20px", margin: 0 }}>📜 Watch History</h2>
                        <span style={{ color: "#555", fontSize: "13px" }}>மொத்தம் {history.length} movies</span>
                    </div>

                    {/* Loading */}
                    {historyLoading && (
                        <div style={{ textAlign: "center", padding: "48px" }}>
                            <div style={{ width: "36px", height: "36px", border: "3px solid #333", borderTop: "3px solid #ff6b35", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
                            <p style={{ color: "#555", fontSize: "14px" }}>Load ஆகுது...</p>
                        </div>
                    )}

                    {/* Empty */}
                    {!historyLoading && history.length === 0 && (
                        <div style={{ textAlign: "center", padding: "48px 20px" }}>
                            <div style={{ fontSize: "64px", marginBottom: "16px" }}>🍿</div>
                            <p style={{ color: "white", fontSize: "17px", fontWeight: "bold", margin: "0 0 8px 0" }}>இன்னும் எந்த movie-உம் பார்க்கல!</p>
                            <p style={{ color: "#555", fontSize: "13px", margin: "0 0 24px 0" }}>Partner-கூட first movie பாரு 💕</p>
                            <button onClick={() => setActiveTab("create")}
                                style={{ padding: "12px 28px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "bold" }}>
                                🎬 Movie பாரு
                            </button>
                        </div>
                    )}

                    {/* History grouped by date */}
                    {!historyLoading && Object.entries(groupedHistory).map(([dateStr, items]) => (
                        <div key={dateStr} style={{ marginBottom: "28px" }}>
                            {/* Date divider */}
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                                <div style={{ height: "1px", flex: 1, backgroundColor: "#2a2a2a" }} />
                                <div style={{ backgroundColor: "#2a2a2a", border: "1px solid #333", borderRadius: "20px", padding: "4px 14px", display: "flex", alignItems: "center", gap: "6px" }}>
                                    <span style={{ fontSize: "12px" }}>📅</span>
                                    <span style={{ color: "#aaa", fontSize: "12px", fontWeight: "bold", whiteSpace: "nowrap" }}>{dateStr}</span>
                                </div>
                                <div style={{ height: "1px", flex: 1, backgroundColor: "#2a2a2a" }} />
                            </div>

                            {/* Items */}
                            {items.map((item) => {
                                const ytId = getYouTubeId(item.movieUrl || "");
                                const title = getMovieTitle(item);
                                const isYT = item.movieType === "youtube" || !!ytId;

                                return (
                                    <div key={item.id} style={S.historyItem}>
                                        {/* Thumbnail */}
                                        <div style={{ position: "relative", flexShrink: 0 }}>
                                            {ytId ? (
                                                <div style={{ width: "80px", height: "56px", borderRadius: "8px", overflow: "hidden", border: "1px solid #2a2a2a", backgroundColor: "#111" }}>
                                                    <img src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`} alt=""
                                                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                                        onError={(e) => { e.target.parentElement.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px">▶️</div>'; }} />
                                                </div>
                                            ) : (
                                                <div style={{ width: "80px", height: "56px", borderRadius: "8px", backgroundColor: "#2a2a2a", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px" }}>
                                                    🎞️
                                                </div>
                                            )}
                                            <span style={{ position: "absolute", bottom: "3px", right: "3px", fontSize: "9px", fontWeight: "bold", backgroundColor: isYT ? "#e74c3c" : "#2980b9", color: "white", padding: "1px 5px", borderRadius: "4px" }}>
                                                {isYT ? "YT" : "FILE"}
                                            </span>
                                        </div>

                                        {/* Info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            {/* Title */}
                                            <p style={{ color: "white", fontSize: "14px", fontWeight: "bold", margin: "0 0 6px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {title}
                                            </p>
                                            {/* Partner */}
                                            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px" }}>
                                                <span style={{ fontSize: "12px" }}>💕</span>
                                                <span style={{ color: "#ff6b35", fontSize: "12px", fontWeight: "bold" }}>
                                                    {item.partnerName ? `${item.partnerName}-கூட பார்த்தோம்` : "Watch Together"}
                                                </span>
                                            </div>
                                            {/* Time + Room */}
                                            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                                                <span style={{ color: "#555", fontSize: "11px", display: "flex", alignItems: "center", gap: "3px" }}>
                                                    🕐 {item._time}
                                                </span>
                                                {item.roomId && (
                                                    <span style={{ color: "#333", fontSize: "11px", display: "flex", alignItems: "center", gap: "3px" }}>
                                                        🏠 {item.roomId}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}

            <style>{`@keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
        </div>
    );
}

const S = {
    container: { backgroundColor: "#0f0f0f", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px 40px" },
    header: { width: "100%", maxWidth: "600px", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0" },
    logo: { color: "white", fontSize: "20px", fontWeight: "bold" },
    userInfo: { display: "flex", alignItems: "center", gap: "10px" },
    userName: { color: "#aaa", fontSize: "14px" },
    logoutBtn: { padding: "6px 12px", backgroundColor: "transparent", color: "#666", border: "1px solid #333", borderRadius: "6px", cursor: "pointer", fontSize: "13px" },
    tabs: { width: "100%", maxWidth: "560px", display: "flex", gap: "8px", marginBottom: "16px" },
    tab: { flex: 1, padding: "11px 16px", backgroundColor: "#1a1a1a", color: "#666", border: "1px solid #2a2a2a", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" },
    tabActive: { backgroundColor: "#ff6b35", color: "white", border: "1px solid #ff6b35" },
    badge: { backgroundColor: "rgba(255,255,255,0.25)", color: "white", fontSize: "11px", fontWeight: "bold", padding: "1px 7px", borderRadius: "10px", minWidth: "18px", textAlign: "center" },
    card: { width: "100%", maxWidth: "560px", backgroundColor: "#1a1a1a", borderRadius: "20px", padding: "28px", border: "1px solid #222" },
    title: { color: "white", fontSize: "22px", margin: "0 0 8px 0", textAlign: "center" },
    subtitle: { color: "#666", fontSize: "14px", margin: "0 0 24px 0", textAlign: "center" },
    uploadArea: { border: "2px dashed #333", borderRadius: "14px", padding: "32px 20px", textAlign: "center", transition: "all 0.2s" },
    progressContainer: { border: "2px solid #ff6b35", borderRadius: "14px", padding: "32px 20px", textAlign: "center", backgroundColor: "rgba(255,107,53,0.05)" },
    progressBar: { width: "100%", height: "8px", backgroundColor: "#333", borderRadius: "4px", overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: "#ff6b35", borderRadius: "4px", transition: "width 0.3s ease" },
    divider: { display: "flex", alignItems: "center", gap: "12px", margin: "24px 0" },
    dividerLine: { flex: 1, height: "1px", backgroundColor: "#2a2a2a" },
    dividerText: { color: "#444", fontSize: "13px" },
    urlInput: { flex: 1, padding: "12px 14px", backgroundColor: "#2a2a2a", border: "1px solid #333", borderRadius: "8px", color: "white", fontSize: "14px", outline: "none" },
    goBtn: { padding: "12px 20px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "bold", whiteSpace: "nowrap" },
    errorBox: { backgroundColor: "rgba(231,76,60,0.15)", border: "1px solid rgba(231,76,60,0.3)", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#e74c3c" },
    infoBox: { backgroundColor: "#111", borderRadius: "10px", padding: "14px 16px", marginTop: "16px" },
    historyItem: { display: "flex", gap: "14px", alignItems: "center", backgroundColor: "#111", borderRadius: "12px", padding: "12px 14px", marginBottom: "10px", border: "1px solid #222" },
};

export default Home;