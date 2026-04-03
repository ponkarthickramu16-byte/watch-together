import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { collection, addDoc, query, where, onSnapshot, orderBy, doc, getDoc, setDoc } from "firebase/firestore";
import ProfileSetup from "./ProfileSetup";
import { signOut } from "firebase/auth";
import { uploadToCloudinary } from "../cloudinary";
import AdvancedSearch from "../components/AdvancedSearch";

const generateRoomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const getYouTubeId = (url) => {
    if (!url) return null;
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!trimmed) return null;

    // Support when DB/API stores only the YouTube id (11 chars).
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

    const match = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
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
    const resolvedUrl = entry.movieUrl || entry.videoUrl || entry.movieId || "";
    const ytId = getYouTubeId(resolvedUrl);
    if (ytId) return "YouTube Video";
    const filename = resolvedUrl?.split("/").pop()?.split("?")[0] || "Movie";
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
    const [historyError, setHistoryError] = useState("");
    const [indexCreateUrl, setIndexCreateUrl] = useState("");
    const [roomType, setRoomType] = useState("couple");
    // Bug 2 fix: linkLoading-ஐ இங்க declare பண்றோம் — functions-க்கு முன்னாடி.
    // முன்னாடி line 137-ல handleFileUpload-க்கு பிறகு இருந்தது — Rules of Hooks violation.
    const [linkLoading, setLinkLoading] = useState(false);
    const [profile, setProfile] = useState(null);      // user's Firestore profile
    const [profileLoading, setProfileLoading] = useState(true);
    const [showProfileSetup, setShowProfileSetup] = useState(false);
    const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);

    // ✅ Bug fix #4 — prevent double-click creating 2 rooms
    const creatingRef = useRef(false);

    // Load profile from Firestore
    useEffect(() => {
        if (!user?.uid) { setProfileLoading(false); return; }
        getDoc(doc(db, "profiles", user.uid)).then(snap => {
            if (snap.exists()) {
                setProfile(snap.data());
            } else {
                // No profile yet → show setup
                setShowProfileSetup(true);
            }
            setProfileLoading(false);
        }).catch(() => setProfileLoading(false));
    }, [user?.uid]);

    // ✅ Bug fix #2 & #3 — show error if history fails, handle null displayName
    // Bug fix #1 — capture the Firebase-provided index creation URL from the error message
    useEffect(() => {
        const uid = user?.uid || null;
        const fallbackName = profile?.name || user?.displayName || user?.email || null;

        if (!uid && !fallbackName) {
            setHistoryLoading(false);
            return;
        }

        setHistoryError("");
        setHistoryLoading(true);

        let fallbackUnsub = null;

        const handleErr = (err) => {
            console.error("History load error:", err);
            if (err.code === "failed-precondition") {
                const urlMatch = err.message?.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
                setIndexCreateUrl(urlMatch ? urlMatch[0] : "https://console.firebase.google.com/project/_/firestore/indexes");
                setHistoryError("index");
            } else {
                setHistoryError("general");
            }
            setHistoryLoading(false);
        };

        // Primary: UID-based history (reliable)
        if (uid) {
            const qUid = query(
                collection(db, "watchHistory"),
                where("watchedByUid", "==", uid),
                orderBy("watchedAt", "desc")
            );

            const unsub = onSnapshot(
                qUid,
                (snap) => {
                    if (!snap.empty) {
                        // Got data → stop any fallback listener
                        fallbackUnsub?.();
                        fallbackUnsub = null;
                        setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                        setHistoryLoading(false);
                        return;
                    }

                    // No UID-based docs (old data). Fallback to name-based query.
                    if (fallbackName && !fallbackUnsub) {
                        const qName = query(
                            collection(db, "watchHistory"),
                            where("watchedBy", "==", fallbackName),
                            orderBy("watchedAt", "desc")
                        );
                        fallbackUnsub = onSnapshot(
                            qName,
                            (snap2) => {
                                setHistory(snap2.docs.map(d => ({ id: d.id, ...d.data() })));
                                setHistoryLoading(false);
                            },
                            handleErr
                        );
                    } else if (!fallbackName) {
                        setHistory([]);
                        setHistoryLoading(false);
                    }
                },
                handleErr
            );

            return () => {
                fallbackUnsub?.();
                unsub();
            };
        }

        // No uid available → name-based only
        const qNameOnly = query(
            collection(db, "watchHistory"),
            where("watchedBy", "==", fallbackName),
            orderBy("watchedAt", "desc")
        );
        const unsubNameOnly = onSnapshot(
            qNameOnly,
            (snap) => {
                setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setHistoryLoading(false);
            },
            handleErr
        );
        return () => unsubNameOnly();
    }, [user?.uid, user?.displayName, user?.email, profile?.name]);

    // Home.jsx - createRoom function-ல இத செக் பண்ணுங்க

    const createRoom = async (inputUrl = "", inputType = "") => {
        console.log("[Watch Together Home] createRoom called with:", { inputUrl, inputType });

        if (!profile || !auth.currentUser) {
            console.error("[Watch Together Home] Missing profile or auth:", { profile: !!profile, auth: !!auth.currentUser });
            setError("❌ Profile setup பண்ணு or login பண்ணு");
            return;
        }

        const trimmedUrl = typeof inputUrl === "string" ? inputUrl.trim() : "";
        console.log("[Watch Together Home] Trimmed URL:", trimmedUrl);

        if (!trimmedUrl || trimmedUrl.length === 0) {
            console.error("[Watch Together Home] Empty URL detected");
            setError("❌ Valid YouTube link அல்லது video URL enter பண்ணு");
            return;
        }

        const isYouTube = !!getYouTubeId(trimmedUrl);
        const movieType = inputType || (isYouTube ? "youtube" : "upload");

        console.log("[Watch Together Home] URL analysis:", {
            isYouTube,
            movieType,
            urlLength: trimmedUrl.length,
            youtubeId: getYouTubeId(trimmedUrl)
        });

        // Prevent double-creation
        if (creatingRef.current) {
            console.warn("[Watch Together Home] Room creation already in progress");
            return;
        }
        creatingRef.current = true;

        try {
            const roomId = generateRoomId();
            console.log("[Watch Together Home] Generated room ID:", roomId);

            const newRoom = {
                roomId,
                hostId: auth.currentUser.uid,
                hostName: profile.name,
                hostAvatar: profile.avatar || "🧑",
                hostPic: profile.profilePic || "",
                createdAt: new Date(),
                status: "active",
                roomType,
                movieUrl: trimmedUrl,
                movieType,
                movieTitle: isYouTube ? "YouTube Video" : "Uploaded Video",
                isPlaying: false,
                currentTime: 0,
                participants: [auth.currentUser.uid],
                presence: { [auth.currentUser.uid]: Date.now() },
                typing: "",
                callStatus: "idle",
            };

            console.log("[Watch Together Home] Creating room with data:", {
                roomId: newRoom.roomId,
                movieUrl: newRoom.movieUrl,
                movieType: newRoom.movieType,
                hasMovieUrl: !!newRoom.movieUrl
            });

            await setDoc(doc(db, "rooms", roomId), newRoom);
            console.log("[Watch Together Home] Room created successfully in Firestore");

            console.log("[Watch Together Home] Navigating to room:", `/room/${roomId}`);
            navigate(`/room/${roomId}`);

        } catch (err) {
            console.error("[Watch Together Home] Room create error:", err);
            setError("❌ Room create பண்ண முடியல: " + err.message);
            alert("Room create பண்ண முடியல! Console பாத்து error check பண்ணு.");
        } finally {
            creatingRef.current = false;
        }
    };
    const handleFileUpload = async (file) => {
        if (!file) return;

        // Validate video file type
        const isVideo = file.type.startsWith("video/") ||
            file.name.match(/\.(mp4|mkv|avi|mov|webm|m4v|3gp|flv|wmv)$/i);

        if (!isVideo) {
            setError("❌ Video file மட்டும் upload பண்ணு (MP4, MKV, MOV...)");
            return;
        }

        // Updated: Maximum file size is now 2GB (2048MB)
        const maxSizeMB = 2048; // 2GB
        const fileSizeMB = file.size / (1024 * 1024);

        console.log(`[Upload] File name: ${file.name}`);
        console.log(`[Upload] File size: ${fileSizeMB.toFixed(2)}MB`);
        console.log(`[Upload] File type: ${file.type}`);

        if (fileSizeMB > maxSizeMB) {
            setError(
                `❌ File too big! Maximum ${maxSizeMB}MB (${(maxSizeMB / 1024).toFixed(1)}GB).
                உன் file: ${fileSizeMB.toFixed(0)}MB
                
                💡 Tips:
                - Use video compression tools
                - Upload to YouTube and use the link instead
                - Split into smaller parts`
            );
            return;
        }

        // Show upload type based on file size
        if (fileSizeMB > 100) {
            console.log(`[Upload] Large file detected (${fileSizeMB.toFixed(0)}MB) - Using chunked upload`);
        } else {
            console.log(`[Upload] Standard upload for ${fileSizeMB.toFixed(0)}MB file`);
        }

        setError("");
        setUploading(true);
        setUploadProgress(0);

        try {
            // uploadToCloudinary automatically handles chunking for large files
            const url = await uploadToCloudinary(file, (progress) => {
                setUploadProgress(progress);
                console.log(`[Upload] Progress: ${progress}%`);
            });

            console.log(`[Upload] Success! URL: ${url}`);

            // Create room with the uploaded video
            await createRoom(url, "upload");

        } catch (err) {
            console.error("[Upload] Error:", err);
            setError("❌ Upload fail: " + err.message);

            // Show helpful error message
            if (err.message.includes("chunk")) {
                setError("❌ Upload interrupted. Please check your internet connection and try again.");
            }
        } finally {
            setUploading(false);
            setUploadProgress(0);
            creatingRef.current = false;
        }
    };


    const handleFileChange = (e) => { const f = e.target.files[0]; if (f) handleFileUpload(f); e.target.value = ""; };
    const handleDrop = (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); };

    const handleYouTubeOrLink = async () => {
        if (linkLoading || creatingRef.current) return;
        const url = movieUrl.trim();
        if (!url) { setError("❌ Link enter பண்ணு"); return; }
        setError(""); setLinkLoading(true);
        try {
            const ytId = getYouTubeId(url);
            if (ytId) await createRoom(url, "youtube");
            else if (url.startsWith("http")) await createRoom(url, "upload");
            else setError("❌ Valid YouTube link அல்லது video URL enter பண்ணு");
        } finally {
            setLinkLoading(false);
            creatingRef.current = false;
        }
    };

    const handleLogout = async () => { await signOut(auth); };

    const groupedHistory = history.reduce((acc, item) => {
        const { dateStr, timeStr } = formatDateTime(item.watchedAt);
        const key = dateStr || "Unknown Date";
        if (!acc[key]) acc[key] = [];
        acc[key].push({ ...item, _time: timeStr });
        return acc;
    }, {});

    const isCouple = roomType === "couple";

    // Show profile setup if needed
    if (showProfileSetup || (!profileLoading && !profile)) {
        return (
            <ProfileSetup
                user={user}
                existingProfile={profile}
                onComplete={(p) => { setProfile(p); setShowProfileSetup(false); }}
            />
        );
    }

    return (
        <div style={S.container}>
            {/* Header */}
            <div style={S.header}>
                <div style={S.logo}>🎬 Watch Together</div>
                <div style={S.userInfo}>
                    <div onClick={() => setShowProfileSetup(true)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }} title="Profile edit">
                        <div style={{ width: "34px", height: "34px", borderRadius: "50%", border: "2px solid #ff6b35", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#2a2a2a" }}>
                            {profile?.photoUrl
                                ? <img src={profile.photoUrl} alt="profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : <span style={{ fontSize: "18px" }}>{profile?.avatar || "🧑"}</span>
                            }
                        </div>
                        <span style={S.userName}>{profile?.name || user?.displayName || user?.email || "User"}</span>
                    </div>
                    <button onClick={handleLogout} style={S.logoutBtn}>Logout</button>
                </div>
            </div>

            {/* Profile Card */}
            {profile && (
                <div style={{ margin: "0 16px 16px", backgroundColor: "#1a1a1a", borderRadius: "16px", border: "1px solid #333", padding: "16px", display: "flex", alignItems: "center", gap: "14px" }}>
                    <div style={{ width: "60px", height: "60px", borderRadius: "50%", border: "3px solid #ff6b35", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#2a2a2a", flexShrink: 0 }}>
                        {profile.photoUrl
                            ? <img src={profile.photoUrl} alt="profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <span style={{ fontSize: "28px" }}>{profile.avatar || "🧑"}</span>
                        }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: "white", fontWeight: "bold", fontSize: "16px", margin: "0 0 2px 0" }}>{profile.name}</p>
                        <p style={{ color: "#aaa", fontSize: "12px", margin: "0 0 4px 0" }}>{profile.email}</p>
                        {profile.dob && (
                            <p style={{ color: "#ff6b35", fontSize: "11px", margin: "0 0 4px 0" }}>
                                🎂 {new Date(profile.dob).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                                {" · "}{Math.floor((Date.now() - new Date(profile.dob)) / (365.25 * 24 * 60 * 60 * 1000))} வயசு
                            </p>
                        )}
                        {profile.genres?.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                {profile.genres.map(g => (
                                    <span key={g} style={{ backgroundColor: "rgba(255,107,53,0.15)", color: "#ff6b35", fontSize: "10px", padding: "2px 7px", borderRadius: "10px", border: "1px solid rgba(255,107,53,0.3)" }}>{g}</span>
                                ))}
                            </div>
                        )}
                    </div>
                    <button onClick={() => setShowProfileSetup(true)}
                        style={{ backgroundColor: "#2a2a2a", border: "1px solid #444", color: "#aaa", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "12px", flexShrink: 0 }}>
                        ✏️ Edit
                    </button>
                </div>
            )}

            {/* Main Tabs */}
            <div style={S.tabs}>
                <button onClick={() => setActiveTab("create")}
                    style={{ ...S.tab, ...(activeTab === "create" ? S.tabActive : {}) }}>
                    ➕ New Room
                </button>
                <button onClick={() => setActiveTab("history")}
                    style={{ ...S.tab, ...(activeTab === "history" ? S.tabActive : {}) }}>
                    📜 Watch History
                    {history.length > 0 && <span style={S.badge}>{history.length}</span>}
                </button>
            </div>

            {/* ===== CREATE ROOM ===== */}
            {activeTab === "create" && (
                <div style={S.card}>
                    {/* Room Type Selector */}
                    <div style={{ marginBottom: "24px" }}>
                        <p style={{ color: "#aaa", fontSize: "13px", textAlign: "center", margin: "0 0 12px 0" }}>
                            எந்த மாதிரி room வேணும்?
                        </p>
                        <div style={{ display: "flex", gap: "10px" }}>
                            {/* Couple */}
                            <button onClick={() => setRoomType("couple")} style={{
                                flex: 1, padding: "16px 12px",
                                backgroundColor: isCouple ? "rgba(255,107,53,0.12)" : "#111",
                                border: isCouple ? "2px solid #ff6b35" : "2px solid #2a2a2a",
                                borderRadius: "14px", cursor: "pointer", textAlign: "center", transition: "all 0.2s",
                            }}>
                                <div style={{ fontSize: "32px", marginBottom: "6px" }}>💕</div>
                                <p style={{ color: isCouple ? "#ff6b35" : "white", fontSize: "15px", fontWeight: "bold", margin: "0 0 4px 0" }}>Couple Room</p>
                                <p style={{ color: isCouple ? "#ff8c5a" : "#555", fontSize: "12px", margin: 0 }}>2 பேர் மட்டும் • Private 🔒</p>
                                {isCouple && (
                                    <div style={{ marginTop: "8px", backgroundColor: "#ff6b35", color: "white", borderRadius: "20px", padding: "2px 10px", fontSize: "11px", fontWeight: "bold", display: "inline-block" }}>✓ Selected</div>
                                )}
                            </button>

                            {/* Group */}
                            <button onClick={() => setRoomType("group")} style={{
                                flex: 1, padding: "16px 12px",
                                backgroundColor: !isCouple ? "rgba(52,152,219,0.12)" : "#111",
                                border: !isCouple ? "2px solid #3498db" : "2px solid #2a2a2a",
                                borderRadius: "14px", cursor: "pointer", textAlign: "center", transition: "all 0.2s",
                            }}>
                                <div style={{ fontSize: "32px", marginBottom: "6px" }}>👯</div>
                                <p style={{ color: !isCouple ? "#3498db" : "white", fontSize: "15px", fontWeight: "bold", margin: "0 0 4px 0" }}>Group Room</p>
                                <p style={{ color: !isCouple ? "#5dade2" : "#555", fontSize: "12px", margin: 0 }}>4+ பேர் • Friends 🎉</p>
                                {!isCouple && (
                                    <div style={{ marginTop: "8px", backgroundColor: "#3498db", color: "white", borderRadius: "20px", padding: "2px 10px", fontSize: "11px", fontWeight: "bold", display: "inline-block" }}>✓ Selected</div>
                                )}
                            </button>
                        </div>

                        <div style={{ marginTop: "10px", backgroundColor: isCouple ? "rgba(255,107,53,0.07)" : "rgba(52,152,219,0.07)", borderRadius: "10px", padding: "10px 14px", border: `1px solid ${isCouple ? "rgba(255,107,53,0.2)" : "rgba(52,152,219,0.2)"}` }}>
                            {isCouple ? (
                                <p style={{ color: "#aaa", fontSize: "12px", margin: 0 }}>💕 <strong style={{ color: "#ff6b35" }}>Couple Room:</strong> நீயும் உன் partner-உம் மட்டும். 3rd person join ஆக முடியாது. Super private! 🔐</p>
                            ) : (
                                <p style={{ color: "#aaa", fontSize: "12px", margin: 0 }}>👯 <strong style={{ color: "#3498db" }}>Group Room:</strong> Friends எல்லாரும் join ஆகலாம். Link share பண்ணு, கூட்டமா பாரு! 🎊</p>
                            )}
                        </div>
                    </div>

                    <h1 style={S.title}>{isCouple ? "💕 Partner-கூட movie பாரு" : "👯 Friends-கூட movie பாரு"}</h1>
                    <p style={S.subtitle}>Movie upload பண்ணு அல்லது YouTube link போடு</p>

                    {/* Upload area */}
                    {!uploading ? (
                        <label htmlFor="fileInput"
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            style={{
                                ...S.uploadArea,
                                borderColor: dragOver ? (isCouple ? "#ff6b35" : "#3498db") : "#333",
                                backgroundColor: dragOver ? (isCouple ? "rgba(255,107,53,0.08)" : "rgba(52,152,219,0.08)") : "#111",
                                display: "block", cursor: "pointer",
                            }}>
                            <div style={{ fontSize: "48px", marginBottom: "12px" }}>📁</div>
                            <p style={{ color: "white", fontSize: "16px", fontWeight: "bold", margin: "0 0 8px 0" }}>
                                Drag & drop video file இங்க
                            </p>
                            <p style={{ color: "#666", fontSize: "13px", margin: "0 0 16px 0" }}>
                                அல்லது click பண்ணி select பண்ணு
                            </p>
                            <p style={{ color: "#888", fontSize: "11px", margin: "0 0 12px 0" }}>
                                ✅ Support: MP4, MKV, AVI, MOV, WEBM, M4V
                            </p>
                            <p style={{ color: "#ff6b35", fontSize: "12px", fontWeight: "bold", margin: 0 }}>
                                📦 Max Size: 2GB (2048MB) {/* UPDATED */}
                            </p>
                            <p style={{ color: "#666", fontSize: "10px", margin: "4px 0 0 0" }}>
                                💡 Large files (&gt;100MB) use smart chunked upload
                            </p>
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
                                onKeyDown={(e) => e.key === "Enter" && handleYouTubeOrLink()}
                                style={S.urlInput} />
                            {/* ✅ Bug fix #4 — disabled during loading */}
                            <button onClick={handleYouTubeOrLink} disabled={linkLoading || uploading}
                                style={{ ...S.goBtn, backgroundColor: linkLoading ? "#555" : isCouple ? "#ff6b35" : "#3498db", cursor: linkLoading ? "not-allowed" : "pointer" }}>
                                {linkLoading ? "⏳" : "▶ Go"}
                            </button>
                        </div>
                    </div>

                    {error && <div style={S.errorBox}><p style={{ margin: 0, fontSize: "13px", whiteSpace: "pre-line" }}>{error}</p></div>}

                    <div style={S.infoBox}>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 4px 0" }}>💡 <strong style={{ color: "#666" }}>Tips:</strong></p>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 3px 0" }}>• YouTube link best - fast & unlimited ✅</p>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 3px 0" }}>• File upload max 100MB (personal videos மட்டும்)</p>
                        <p style={{ color: "#555", fontSize: "12px", margin: 0 }}>
                            {isCouple ? "• Couple Room - 2 பேர் மட்டும் join ஆகலாம் 🔒" : "• Group Room - எத்தனை பேர் வேணும்னாலும் join ஆகலாம் 🎉"}
                        </p>
                    </div>
                </div>
            )}

            {/* ===== WATCH HISTORY ===== */}
            {activeTab === "history" && (
                <div style={S.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", gap: "12px", flexWrap: "wrap" }}>
                        <h2 style={{ color: "white", fontSize: "20px", margin: 0 }}>📜 Watch History</h2>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <span style={{ color: "#555", fontSize: "13px" }}>மொத்தம் {history.length} movies</span>
                            <button
                                onClick={() => setShowAdvancedSearch(true)}
                                style={{
                                    padding: "8px 16px",
                                    backgroundColor: "#3498db",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "8px",
                                    cursor: "pointer",
                                    fontSize: "13px",
                                    fontWeight: "bold"
                                }}
                            >
                                🔍 Advanced Search
                            </button>
                        </div>
                    </div>

                    {/* ✅ Bug fix #2 — show index error with fix link */}
                    {historyError === "index" && (
                        <div style={{ backgroundColor: "rgba(243,156,18,0.15)", border: "1px solid rgba(243,156,18,0.3)", borderRadius: "10px", padding: "14px", marginBottom: "16px" }}>
                            <p style={{ color: "#f39c12", fontSize: "13px", margin: "0 0 8px 0", fontWeight: "bold" }}>⚠️ Firestore Composite Index வேணும்!</p>
                            <p style={{ color: "#aaa", fontSize: "12px", margin: "0 0 10px 0" }}>
                                <code style={{ backgroundColor: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>watchedBy (Asc) + watchedAt (Desc)</code> index create ஆகல.
                                கீழே உள்ள link-ல click பண்ணி Firebase automatically create பண்ணும்:
                            </p>
                            <a href={indexCreateUrl}
                                target="_blank" rel="noreferrer"
                                style={{ display: "inline-block", color: "white", fontSize: "12px", fontWeight: "bold", backgroundColor: "#f39c12", padding: "6px 14px", borderRadius: "8px", textDecoration: "none" }}>
                                🔗 Create Index in Firebase Console →
                            </a>
                            <p style={{ color: "#666", fontSize: "11px", margin: "8px 0 0 0" }}>Link click பண்ணி "Create index" button press பண்ணு. சில minutes-ல ready ஆகும்.</p>
                        </div>
                    )}

                    {historyError === "general" && (
                        <div style={{ backgroundColor: "rgba(231,76,60,0.15)", border: "1px solid rgba(231,76,60,0.3)", borderRadius: "10px", padding: "14px", marginBottom: "16px" }}>
                            <p style={{ color: "#e74c3c", fontSize: "13px", margin: 0 }}>❌ History load ஆகல. Refresh பண்ணி try பண்ணு.</p>
                        </div>
                    )}

                    {historyLoading && (
                        <div style={{ textAlign: "center", padding: "48px" }}>
                            <div style={{ width: "36px", height: "36px", border: "3px solid #333", borderTop: "3px solid #ff6b35", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
                            <p style={{ color: "#555", fontSize: "14px" }}>Load ஆகுது...</p>
                        </div>
                    )}

                    {!historyLoading && !historyError && history.length === 0 && (
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

                    {!historyLoading && Object.entries(groupedHistory).map(([dateStr, items]) => (
                        <div key={dateStr} style={{ marginBottom: "28px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                                <div style={{ height: "1px", flex: 1, backgroundColor: "#2a2a2a" }} />
                                <div style={{ backgroundColor: "#2a2a2a", border: "1px solid #333", borderRadius: "20px", padding: "4px 14px", display: "flex", alignItems: "center", gap: "6px" }}>
                                    <span style={{ fontSize: "12px" }}>📅</span>
                                    <span style={{ color: "#aaa", fontSize: "12px", fontWeight: "bold", whiteSpace: "nowrap" }}>{dateStr}</span>
                                </div>
                                <div style={{ height: "1px", flex: 1, backgroundColor: "#2a2a2a" }} />
                            </div>

                            {items.map((item) => {
                                const ytId = getYouTubeId(item.movieUrl || "");
                                const title = getMovieTitle(item);
                                const isYT = item.movieType === "youtube" || !!ytId;
                                const isCoupleRoom = item.roomType === "couple" || !item.roomType;

                                return (
                                    <div key={item.id} style={S.historyItem}>
                                        <div style={{ position: "relative", flexShrink: 0 }}>
                                            {ytId ? (
                                                <div style={{ width: "80px", height: "56px", borderRadius: "8px", overflow: "hidden", border: "1px solid #2a2a2a", backgroundColor: "#111" }}>
                                                    <img src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`} alt=""
                                                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                                        onError={(e) => { e.target.parentElement.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px">▶️</div>'; }} />
                                                </div>
                                            ) : (
                                                <div style={{ width: "80px", height: "56px", borderRadius: "8px", backgroundColor: "#2a2a2a", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px" }}>🎞️</div>
                                            )}
                                            <span style={{ position: "absolute", bottom: "3px", right: "3px", fontSize: "9px", fontWeight: "bold", backgroundColor: isYT ? "#e74c3c" : "#2980b9", color: "white", padding: "1px 5px", borderRadius: "4px" }}>
                                                {isYT ? "YT" : "FILE"}
                                            </span>
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                                                <p style={{ color: "white", fontSize: "14px", fontWeight: "bold", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                                    {title}
                                                </p>
                                                <span style={{ fontSize: "10px", fontWeight: "bold", backgroundColor: isCoupleRoom ? "rgba(255,107,53,0.2)" : "rgba(52,152,219,0.2)", color: isCoupleRoom ? "#ff6b35" : "#3498db", border: `1px solid ${isCoupleRoom ? "rgba(255,107,53,0.4)" : "rgba(52,152,219,0.4)"}`, borderRadius: "10px", padding: "1px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>
                                                    {isCoupleRoom ? "💕 Couple" : "👯 Group"}
                                                </span>
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px" }}>
                                                <span style={{ fontSize: "12px" }}>{isCoupleRoom ? "💕" : "👯"}</span>
                                                <span style={{ color: isCoupleRoom ? "#ff6b35" : "#3498db", fontSize: "12px", fontWeight: "bold" }}>
                                                    {item.partnerName ? `${item.partnerName}-கூட பார்த்தோம்` : "Watch Together"}
                                                </span>
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                                                <span style={{ color: "#555", fontSize: "11px" }}>🕐 {item._time}</span>
                                                {item.roomId && <span style={{ color: "#333", fontSize: "11px" }}>🏠 {item.roomId}</span>}
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
            {showAdvancedSearch && (
                <AdvancedSearch
                    user={user}
                    onClose={() => setShowAdvancedSearch(false)}
                    T={{
                        bg: "#0f0f0f",
                        card: "#1a1a1a",
                        card2: "#2a2a2a",
                        border: "#333",
                        text: "white",
                        text2: "#aaa",
                        text3: "#666",
                        primary: "#ff6b35",
                        secondary: "#3498db",
                    }}
                />
            )}
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
    title: { color: "white", fontSize: "20px", margin: "0 0 6px 0", textAlign: "center", fontWeight: "bold" },
    subtitle: { color: "#666", fontSize: "14px", margin: "0 0 20px 0", textAlign: "center" },
    uploadArea: { border: "2px dashed #333", borderRadius: "14px", padding: "28px 20px", textAlign: "center", transition: "all 0.2s" },
    progressContainer: { border: "2px solid #ff6b35", borderRadius: "14px", padding: "28px 20px", textAlign: "center", backgroundColor: "rgba(255,107,53,0.05)" },
    progressBar: { width: "100%", height: "8px", backgroundColor: "#333", borderRadius: "4px", overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: "#ff6b35", borderRadius: "4px", transition: "width 0.3s ease" },
    divider: { display: "flex", alignItems: "center", gap: "12px", margin: "20px 0" },
    dividerLine: { flex: 1, height: "1px", backgroundColor: "#2a2a2a" },
    dividerText: { color: "#444", fontSize: "13px" },
    urlInput: { flex: 1, padding: "12px 14px", backgroundColor: "#2a2a2a", border: "1px solid #333", borderRadius: "8px", color: "white", fontSize: "14px", outline: "none" },
    goBtn: { padding: "12px 20px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "bold", whiteSpace: "nowrap" },
    errorBox: { backgroundColor: "rgba(231,76,60,0.15)", border: "1px solid rgba(231,76,60,0.3)", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#e74c3c" },
    infoBox: { backgroundColor: "#111", borderRadius: "10px", padding: "14px 16px", marginTop: "16px" },
    historyItem: { display: "flex", gap: "14px", alignItems: "center", backgroundColor: "#111", borderRadius: "12px", padding: "12px 14px", marginBottom: "10px", border: "1px solid #222" },
};

export default Home;