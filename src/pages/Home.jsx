import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { collection, addDoc, query, where, onSnapshot, orderBy, doc, getDoc, setDoc } from "firebase/firestore";
import ProfileSetup from "./ProfileSetup";
import { signOut, onAuthStateChanged } from "firebase/auth";
import AdvancedSearch from "../components/AdvancedSearch";

const generateRoomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// ─── YouTube ID Extract ───────────────────────────────────────────────────────
const getYouTubeId = (url) => {
    if (!url) return null;
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!trimmed) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
};

// ─── Google Drive File ID Extract ─────────────────────────────────────────────
const getDriveFileId = (url) => {
    if (!url) return null;
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!trimmed) return null;

    // Format 1: https://drive.google.com/file/d/FILE_ID/view
    // Format 2: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
    // Format 3: https://drive.google.com/open?id=FILE_ID
    // Format 4: https://drive.google.com/uc?id=FILE_ID
    const patterns = [
        /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
        /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
        /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/,
        /docs\.google\.com\/.*\/d\/([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (match) return match[1];
    }
    return null;
};

// ─── Drive link → Direct playback URL ────────────────────────────────────────
// Use Google Drive's preview URL for video playback (no proxy needed)
export const getDriveEmbedUrl = (url) => {
    const fileId = getDriveFileId(url);
    if (!fileId) return null;
    // Preview URL - works in iframe and direct video playback
    return `https://drive.google.com/file/d/${fileId}/preview`;
};

// ─── Detect link type ─────────────────────────────────────────────────────────
export const detectLinkType = (url) => {
    if (!url) return "unknown";
    if (getYouTubeId(url)) return "youtube";
    if (getDriveFileId(url)) return "drive";
    if (url.startsWith("http")) return "direct";
    return "unknown";
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
    if (getDriveFileId(resolvedUrl)) return "Google Drive Video";
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
    const [linkLoading, setLinkLoading] = useState(false);
    const [profile, setProfile] = useState(null);
    const [profileLoading, setProfileLoading] = useState(true);
    const [showProfileSetup, setShowProfileSetup] = useState(false);
    const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
    const [authChecked, setAuthChecked] = useState(false);

    // Link preview state — paste பண்ணும்போது type காட்டும்
    const [linkPreview, setLinkPreview] = useState(null); // "youtube" | "drive" | "direct" | null

    const creatingRef = useRef(false);

    // Check auth state on mount
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, () => {
            setAuthChecked(true);
        });
        return () => unsub();
    }, []);

    // Load profile
    useEffect(() => {
        if (!user?.uid) { setProfileLoading(false); return; }
        getDoc(doc(db, "profiles", user.uid)).then(snap => {
            if (snap.exists()) {
                setProfile(snap.data());
            } else {
                setShowProfileSetup(true);
            }
            setProfileLoading(false);
        }).catch(() => setProfileLoading(false));
    }, [user?.uid]);

    // Watch history
    useEffect(() => {
        // FIX: Check authentication FIRST before building any queries.
        // authChecked = true means auth state resolved (could be logged out).
        // Only proceed if user is actually authenticated via Firebase.
        if (!authChecked || !auth.currentUser) {
            setHistoryLoading(false);
            return;
        }

        const uid = user?.uid || null;
        const fallbackName = profile?.name || user?.displayName || user?.email || null;

        if (!uid && !fallbackName) {
            setHistoryLoading(false);
            return;
        }

        setHistoryError("");
        setHistoryLoading(true);

        const handleErr = (err) => {
            console.error("History load error:", err);
            if (err.code === "failed-precondition") {
                const urlMatch = err.message?.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
                setIndexCreateUrl(urlMatch ? urlMatch[0] : "https://console.firebase.google.com/project/_/firestore/indexes");
                setHistoryError("index");
            } else if (err.code === "permission-denied") {
                // Firestore rules block unauthenticated or unauthorized reads.
                // Show empty history silently — user is not logged in or rules need update.
                setHistory([]);
                setHistoryError("");
            } else {
                setHistoryError("general");
            }
            setHistoryLoading(false);
        };

        // Fix: Run both queries independently (no nested listeners).
        // Nested onSnapshot inside another onSnapshot callback causes stale
        // listeners to pile up — every outer snapshot fires creates a new inner
        // listener that is never cleaned up. Instead, run them in parallel and
        // merge results, deduplicating by document ID.
        const latestByKey = new Map(); // id → data

        // Fix: When uid is available, ONLY run the uid-based query.
        // Running both uid + name queries simultaneously causes permission-denied
        // because UID-owned docs satisfy watchedByUid == auth.uid rule, NOT the
        // watchedByUid == null && watchedBy == name branch. The name query then
        // fails on those documents → "Missing or insufficient permissions" error.
        // name-based query is only needed for legacy docs (watchedByUid == null).
        const shouldRunNameQuery = !uid && !!fallbackName;

        let uidDone = !uid;
        let nameDone = !shouldRunNameQuery;

        const merge = () => {
            if (!uidDone || !nameDone) return; // wait for both to resolve
            const merged = Array.from(latestByKey.values())
                .sort((a, b) => {
                    const ta = a.watchedAt?.toMillis?.() ?? 0;
                    const tb = b.watchedAt?.toMillis?.() ?? 0;
                    return tb - ta;
                });
            setHistory(merged);
            setHistoryLoading(false);
        };

        const unsubs = [];

        if (uid) {
            const qUid = query(
                collection(db, "watchHistory"),
                where("watchedByUid", "==", uid),
                orderBy("watchedAt", "desc")
            );
            const unsubUid = onSnapshot(qUid, (snap) => {
                snap.docs.forEach(d => latestByKey.set(d.id, { id: d.id, ...d.data() }));
                uidDone = true;
                merge();
            }, (err) => { uidDone = true; handleErr(err); });
            unsubs.push(unsubUid);
        }

        // Only run name query for legacy (pre-uid) data when no uid is available
        if (shouldRunNameQuery) {
            const qName = query(
                collection(db, "watchHistory"),
                where("watchedBy", "==", fallbackName),
                orderBy("watchedAt", "desc")
            );
            const unsubName = onSnapshot(qName, (snap) => {
                snap.docs.forEach(d => latestByKey.set(d.id, { id: d.id, ...d.data() }));
                nameDone = true;
                merge();
            }, (err) => { nameDone = true; handleErr(err); });
            unsubs.push(unsubName);
        }

        return () => unsubs.forEach(u => u());
    }, [user?.uid, user?.displayName, user?.email, profile?.name, authChecked]);

    // ─── Create Room ────────────────────────────────────────────────────────────
    const createRoom = async (inputUrl = "", inputType = "") => {
        if (!profile || !auth.currentUser) {
            setError("❌ Profile setup பண்ணு or login பண்ணு");
            return;
        }

        const trimmedUrl = typeof inputUrl === "string" ? inputUrl.trim() : "";
        if (!trimmedUrl) {
            setError("❌ Valid link enter பண்ணு");
            return;
        }

        // Drive link-ஆ இருந்தா embed URL-ஆ convert பண்ணு
        let finalUrl = trimmedUrl;
        let finalType = inputType;

        if (inputType === "drive") {
            const embedUrl = getDriveEmbedUrl(trimmedUrl);
            if (!embedUrl) {
                setError("❌ Invalid Google Drive link. 'Share → Anyone with link' பண்ணி copy பண்ணு.");
                return;
            }
            finalUrl = embedUrl;
            finalType = "drive";
        }

        if (creatingRef.current) return;
        creatingRef.current = true;

        try {
            const roomId = generateRoomId();
            const isYouTube = finalType === "youtube";
            const isDrive = finalType === "drive";

            const newRoom = {
                roomId,
                hostId: auth.currentUser.uid,
                hostName: profile.name,
                hostAvatar: profile.avatar || "🧑",
                hostPic: profile.profilePic || "",
                createdAt: new Date(),
                status: "active",
                roomType,
                movieUrl: finalUrl,
                movieType: finalType,
                movieTitle: isYouTube ? "YouTube Video" : isDrive ? "Google Drive Video" : "Uploaded Video",
                isPlaying: false,
                currentTime: 0,
                participants: [], // Room.jsx adds username on join; UID here mismatches username check
                presence: {}, // Room.jsx writes presence.${username}; UID key here conflicts
                typing: "",
                callStatus: "idle",
            };

            await setDoc(doc(db, "rooms", roomId), newRoom);
            navigate(`/room/${roomId}`);

        } catch (err) {
            console.error("[Home] Room create error:", err);
            setError("❌ Room create பண்ண முடியல: " + err.message);
        } finally {
            creatingRef.current = false;
        }
    };

    // ─── File Upload (local file — not used for large, just UI kept) ────────────
    const handleFileUpload = async (file) => {
        if (!file) return;
        setError("❌ இப்போ file upload support இல்ல.\n\n💡 Google Drive-ல upload பண்ணி share link paste பண்ணு — 2GB வரை free! 🎬");
    };

    const handleFileChange = (e) => {
        const f = e.target.files[0];
        if (f) handleFileUpload(f);
        e.target.value = "";
    };
    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) handleFileUpload(f);
    };

    // ─── URL input change — live preview ─────────────────────────────────────
    const handleUrlChange = (e) => {
        const val = e.target.value;
        setMovieUrl(val);
        setError("");
        if (!val.trim()) { setLinkPreview(null); return; }
        const type = detectLinkType(val.trim());
        setLinkPreview(type === "unknown" ? null : type);
    };

    // ─── Go button — YouTube / Drive / Direct ────────────────────────────────
    const handleYouTubeOrLink = async () => {
        if (linkLoading || creatingRef.current) return;
        const url = movieUrl.trim();
        if (!url) { setError("❌ Link enter பண்ணு"); return; }

        setError("");
        setLinkLoading(true);

        try {
            const type = detectLinkType(url);

            if (type === "youtube") {
                await createRoom(url, "youtube");
            } else if (type === "drive") {
                await createRoom(url, "drive");
            } else if (type === "direct") {
                await createRoom(url, "upload");
            } else {
                setError("❌ Valid YouTube link அல்லது Google Drive link enter பண்ணு");
            }
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
                <div style={{ width: "100%", maxWidth: "560px", margin: "0 0 16px 0", backgroundColor: "#1a1a1a", borderRadius: "16px", border: "1px solid #333", padding: "16px", display: "flex", alignItems: "center", gap: "14px" }}>
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

            {/* Tabs */}
            <div style={S.tabs}>
                <button onClick={() => setActiveTab("create")} style={{ ...S.tab, ...(activeTab === "create" ? S.tabActive : {}) }}>
                    ➕ New Room
                </button>
                <button onClick={() => setActiveTab("history")} style={{ ...S.tab, ...(activeTab === "history" ? S.tabActive : {}) }}>
                    📜 Watch History
                    {history.length > 0 && <span style={S.badge}>{history.length}</span>}
                </button>
            </div>

            {/* ===== CREATE ROOM ===== */}
            {activeTab === "create" && (
                <div style={S.card}>
                    {/* Room Type */}
                    <div style={{ marginBottom: "24px" }}>
                        <p style={{ color: "#aaa", fontSize: "13px", textAlign: "center", margin: "0 0 12px 0" }}>எந்த மாதிரி room வேணும்?</p>
                        <div style={{ display: "flex", gap: "10px" }}>
                            <button onClick={() => setRoomType("couple")} style={{
                                flex: 1, padding: "16px 12px",
                                backgroundColor: isCouple ? "rgba(255,107,53,0.12)" : "#111",
                                border: isCouple ? "2px solid #ff6b35" : "2px solid #2a2a2a",
                                borderRadius: "14px", cursor: "pointer", textAlign: "center", transition: "all 0.2s",
                            }}>
                                <div style={{ fontSize: "32px", marginBottom: "6px" }}>💕</div>
                                <p style={{ color: isCouple ? "#ff6b35" : "white", fontSize: "15px", fontWeight: "bold", margin: "0 0 4px 0" }}>Couple Room</p>
                                <p style={{ color: isCouple ? "#ff8c5a" : "#555", fontSize: "12px", margin: 0 }}>2 பேர் மட்டும் • Private 🔒</p>
                                {isCouple && <div style={{ marginTop: "8px", backgroundColor: "#ff6b35", color: "white", borderRadius: "20px", padding: "2px 10px", fontSize: "11px", fontWeight: "bold", display: "inline-block" }}>✓ Selected</div>}
                            </button>

                            <button onClick={() => setRoomType("group")} style={{
                                flex: 1, padding: "16px 12px",
                                backgroundColor: !isCouple ? "rgba(52,152,219,0.12)" : "#111",
                                border: !isCouple ? "2px solid #3498db" : "2px solid #2a2a2a",
                                borderRadius: "14px", cursor: "pointer", textAlign: "center", transition: "all 0.2s",
                            }}>
                                <div style={{ fontSize: "32px", marginBottom: "6px" }}>👯</div>
                                <p style={{ color: !isCouple ? "#3498db" : "white", fontSize: "15px", fontWeight: "bold", margin: "0 0 4px 0" }}>Group Room</p>
                                <p style={{ color: !isCouple ? "#5dade2" : "#555", fontSize: "12px", margin: 0 }}>4+ பேர் • Friends 🎉</p>
                                {!isCouple && <div style={{ marginTop: "8px", backgroundColor: "#3498db", color: "white", borderRadius: "20px", padding: "2px 10px", fontSize: "11px", fontWeight: "bold", display: "inline-block" }}>✓ Selected</div>}
                            </button>
                        </div>

                        <div style={{ marginTop: "10px", backgroundColor: isCouple ? "rgba(255,107,53,0.07)" : "rgba(52,152,219,0.07)", borderRadius: "10px", padding: "10px 14px", border: `1px solid ${isCouple ? "rgba(255,107,53,0.2)" : "rgba(52,152,219,0.2)"}` }}>
                            {isCouple
                                ? <p style={{ color: "#aaa", fontSize: "12px", margin: 0 }}>💕 <strong style={{ color: "#ff6b35" }}>Couple Room:</strong> நீயும் உன் partner-உம் மட்டும். 3rd person join ஆக முடியாது. Super private! 🔐</p>
                                : <p style={{ color: "#aaa", fontSize: "12px", margin: 0 }}>👯 <strong style={{ color: "#3498db" }}>Group Room:</strong> Friends எல்லாரும் join ஆகலாம். Link share பண்ணு, கூட்டமா பாரு! 🎊</p>
                            }
                        </div>
                    </div>

                    <h1 style={S.title}>{isCouple ? "💕 Partner-கூட movie பாரு" : "👯 Friends-கூட movie பாரு"}</h1>
                    <p style={S.subtitle}>Google Drive / YouTube link paste பண்ணு</p>

                    {/* ── Google Drive Guide Box ── */}
                    <div style={{ backgroundColor: "#0d1f0d", border: "1px solid #1a4a1a", borderRadius: "14px", padding: "16px", marginBottom: "20px" }}>
                        <p style={{ color: "#4caf50", fontSize: "13px", fontWeight: "bold", margin: "0 0 10px 0" }}>📁 Google Drive-ல movie share பண்றது எப்படி?</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            {[
                                { n: "1", t: "drive.google.com போய் movie upload பண்ணு (2GB வரை free!)" },
                                { n: "2", t: "File-ஐ right click → 'Share' click பண்ணு" },
                                { n: "3", t: "'Anyone with the link' select பண்ணு → 'Copy link' click" },
                                { n: "4", t: "அந்த link-ஐ கீழே paste பண்ணி Go! 🚀" },
                            ].map(s => (
                                <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                                    <div style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "#1a4a1a", color: "#4caf50", fontSize: "11px", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "1px" }}>{s.n}</div>
                                    <p style={{ color: "#aaa", fontSize: "12px", margin: 0, lineHeight: "1.4" }}>{s.t}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── URL Input ── */}
                    <div style={{ marginBottom: "16px" }}>
                        <p style={{ color: "#aaa", fontSize: "14px", margin: "0 0 10px 0" }}>
                            🔗 Google Drive link அல்லது YouTube link
                        </p>
                        <div style={{ display: "flex", gap: "8px" }}>
                            <input
                                type="url"
                                placeholder="https://drive.google.com/file/d/... அல்லது YouTube URL"
                                value={movieUrl}
                                onChange={handleUrlChange}
                                onKeyDown={(e) => e.key === "Enter" && handleYouTubeOrLink()}
                                style={S.urlInput}
                            />
                            <button
                                onClick={handleYouTubeOrLink}
                                disabled={linkLoading || uploading}
                                style={{ ...S.goBtn, backgroundColor: linkLoading ? "#555" : isCouple ? "#ff6b35" : "#3498db", cursor: linkLoading ? "not-allowed" : "pointer" }}>
                                {linkLoading ? "⏳" : "▶ Go"}
                            </button>
                        </div>

                        {/* Live link preview badge */}
                        {linkPreview && (
                            <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                                {linkPreview === "youtube" && (
                                    <span style={{ backgroundColor: "rgba(231,76,60,0.15)", color: "#e74c3c", border: "1px solid rgba(231,76,60,0.3)", borderRadius: "20px", padding: "3px 10px", fontSize: "12px", fontWeight: "bold" }}>
                                        ✅ YouTube link detected
                                    </span>
                                )}
                                {linkPreview === "drive" && (
                                    <span style={{ backgroundColor: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)", borderRadius: "20px", padding: "3px 10px", fontSize: "12px", fontWeight: "bold" }}>
                                        ✅ Google Drive link detected
                                    </span>
                                )}
                                {linkPreview === "direct" && (
                                    <span style={{ backgroundColor: "rgba(52,152,219,0.15)", color: "#3498db", border: "1px solid rgba(52,152,219,0.3)", borderRadius: "20px", padding: "3px 10px", fontSize: "12px", fontWeight: "bold" }}>
                                        ✅ Direct video link detected
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {error && <div style={S.errorBox}><p style={{ margin: 0, fontSize: "13px", whiteSpace: "pre-line" }}>{error}</p></div>}

                    {/* Info Box */}
                    <div style={S.infoBox}>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 4px 0" }}>💡 <strong style={{ color: "#666" }}>Tips:</strong></p>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 3px 0" }}>• Google Drive — 2GB வரை free ✅ (Recommended!)</p>
                        <p style={{ color: "#555", fontSize: "12px", margin: "0 0 3px 0" }}>• YouTube link — fast & unlimited ✅</p>
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
                            <button onClick={() => setShowAdvancedSearch(true)}
                                style={{ padding: "8px 16px", backgroundColor: "#3498db", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "bold" }}>
                                🔍 Advanced Search
                            </button>
                        </div>
                    </div>

                    {historyError === "index" && (
                        <div style={{ backgroundColor: "rgba(243,156,18,0.15)", border: "1px solid rgba(243,156,18,0.3)", borderRadius: "10px", padding: "14px", marginBottom: "16px" }}>
                            <p style={{ color: "#f39c12", fontSize: "13px", margin: "0 0 8px 0", fontWeight: "bold" }}>⚠️ Firestore Composite Index வேணும்!</p>
                            <p style={{ color: "#aaa", fontSize: "12px", margin: "0 0 10px 0" }}>
                                <code style={{ backgroundColor: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>watchedBy (Asc) + watchedAt (Desc)</code> index create ஆகல.
                            </p>
                            <a href={indexCreateUrl} target="_blank" rel="noreferrer"
                                style={{ display: "inline-block", color: "white", fontSize: "12px", fontWeight: "bold", backgroundColor: "#f39c12", padding: "6px 14px", borderRadius: "8px", textDecoration: "none" }}>
                                🔗 Create Index in Firebase Console →
                            </a>
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
                                const driveId = getDriveFileId(item.movieUrl || "");
                                const title = getMovieTitle(item);
                                const isYT = item.movieType === "youtube" || !!ytId;
                                const isDrive = item.movieType === "drive" || !!driveId;
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
                                                <div style={{ width: "80px", height: "56px", borderRadius: "8px", backgroundColor: "#2a2a2a", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px" }}>
                                                    {isDrive ? "📁" : "🎞️"}
                                                </div>
                                            )}
                                            <span style={{ position: "absolute", bottom: "3px", right: "3px", fontSize: "9px", fontWeight: "bold", backgroundColor: isYT ? "#e74c3c" : isDrive ? "#4caf50" : "#2980b9", color: "white", padding: "1px 5px", borderRadius: "4px" }}>
                                                {isYT ? "YT" : isDrive ? "GD" : "FILE"}
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
                        bg: "#0f0f0f", card: "#1a1a1a", card2: "#2a2a2a", border: "#333",
                        text: "white", text2: "#aaa", text3: "#666",
                        primary: "#ff6b35", secondary: "#3498db",
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