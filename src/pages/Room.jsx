import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import {
    collection, query, where, onSnapshot,
    updateDoc, doc, addDoc, orderBy, arrayUnion, getDoc, deleteDoc, writeBatch,
} from "firebase/firestore";
import "@livekit/components-styles";
// LiveKit lazy-loaded → separate chunk → fixes TDZ circular dep crash
const VideoCallRoom = lazy(() => import("../components/VideoCall"));

const REACTIONS = ["❤️", "😂", "😮", "🔥", "👏", "😢"];

const EMOJI_CATEGORIES = [
    { label: "❤️ Love", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "😍", "🥰", "😘", "💏", "👫"] },
    { label: "😂 Funny", emojis: ["😂", "🤣", "😆", "😅", "😄", "😁", "😀", "🤩", "😜", "😝", "🤪", "😋", "🤭", "😏", "🙃", "😌", "🤗", "🫠", "😇", "🥳"] },
    { label: "😮 React", emojis: ["😮", "😲", "🤯", "😱", "😳", "🥺", "😢", "😭", "😤", "😡", "🤬", "🫠", "💀", "🫡", "🤔", "🧐", "😐", "🫤", "😶", "🤐"] },
    { label: "🔥 Hype", emojis: ["🔥", "⚡", "💥", "✨", "🌟", "💫", "🎉", "🎊", "🎈", "🏆", "👑", "💎", "🚀", "🌈", "🎯", "💯", "✅", "👍", "🙌", "👏"] },
    { label: "🍿 Movie", emojis: ["🍿", "🎬", "🎥", "🎞️", "📽️", "🎭", "🎪", "🎨", "🎮", "🕹️", "📺", "📻", "🎵", "🎶", "🎸", "🎤", "🎧", "🥤", "🍔", "🍕"] },
    { label: "💬 Chat", emojis: ["👋", "🤝", "🫶", "🤞", "✌️", "🤙", "👉", "💪", "🙏", "🫂", "👀", "💭", "💬", "📩", "📱", "🔔", "⏰", "🗓️", "📌", "🔑"] },
];

const getYouTubeId = (url) => {
    if (!url) return null;
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!trimmed) return null;

    // Support when DB stores only the YouTube id (11 chars).
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

    const match = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
};

const getYouTubeSrc = (id) => {
    return `https://www.youtube.com/embed/${id}?enablejsapi=1&autoplay=1`;
};

const normalizeMovieUrl = (data) => {
    if (!data) return "";
    // Backward-compat: some old rooms stored the URL in `movieId` instead of `movieUrl`.
    const candidates = [data.movieUrl, data.videoUrl, data.movieId];
    for (const v of candidates) {
        if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
};

const getMovieType = (data, movieUrl = "") => {
    if (data?.movieType) return data.movieType;
    return getYouTubeId(movieUrl) ? "youtube" : "upload";
};

// ─── Bug 6 fix: Environment variable guard ────────────────────────────────────
// Validate required env vars at module load. If any are missing in production
// (e.g. forgotten in Vercel/Netlify dashboard), we surface a clear error in the
// console AND in the UI instead of a blank white-screen crash.
const REQUIRED_ENV = {
    VITE_LIVEKIT_URL: import.meta.env.VITE_LIVEKIT_URL,
    VITE_CLOUDINARY_CLOUD_NAME: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
    VITE_CLOUDINARY_UPLOAD_PRESET: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET,
};
const MISSING_ENV = Object.entries(REQUIRED_ENV)
    .filter(([, v]) => !v)
    .map(([k]) => k);
if (MISSING_ENV.length > 0) {
    console.error(
        `[Watch Together] Missing required environment variables:\n  ${MISSING_ENV.join("\n  ")}\n` +
        "Add them to your .env file (local) or deployment dashboard (Vercel/Netlify)."
    );
}
// ─────────────────────────────────────────────────────────────────────────────

// Bug 1 fix: Key cache — roomId மாறாது, so key எப்பவும் same.
// Cache இல்லாம 50 messages = 50 × 100k = 50 lakh iterations → mobile freeze.
// Cache வச்சா first message மட்டும் 100k iterations, மீதி instant. ✅
const _keyCache = new Map();
const MAX_KEY_CACHE = 20; // max unique rooms per session
const getCryptoKey = async (roomId) => {
    if (_keyCache.has(roomId)) return _keyCache.get(roomId);
    // Evict oldest entry if cache is full
    if (_keyCache.size >= MAX_KEY_CACHE) {
        _keyCache.delete(_keyCache.keys().next().value);
    }
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", encoder.encode(roomId.padEnd(32, "0").substring(0, 32)),
        "PBKDF2", false, ["deriveKey"]
    );
    const key = await window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: encoder.encode("watch-together-salt"), iterations: 50000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
    _keyCache.set(roomId, key);
    return key;
};

const encryptMessage = async (text, roomId) => {
    try {
        const key = await getCryptoKey(roomId);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const cipher = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
        const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
        combined.set(iv, 0); combined.set(new Uint8Array(cipher), iv.byteLength);
        // Fix: btoa(String.fromCharCode(...combined)) crashes via stack overflow
        // when combined is large (>~65k bytes). Use a chunked loop instead.
        let binary = "";
        const CHUNK = 8192;
        for (let i = 0; i < combined.length; i += CHUNK) {
            binary += String.fromCharCode(...combined.subarray(i, i + CHUNK));
        }
        return btoa(binary);
    } catch { return text; }
};

// Per-message decrypt cache keyed by firestoreId.
// Prevents re-running AES-GCM on the same ciphertext every Firestore snapshot.
// Cleared on roomId change (see Reset YouTube + history useEffect).
// Size-limited to 500 entries (LRU eviction) to prevent unbounded growth.
const _decryptCache = new Map();
const MAX_DECRYPT_CACHE = 500;

const decryptMessage = async (cipherB64, roomId) => {
    try {
        const key = await getCryptoKey(roomId);
        // Bug fix #4: sanitize the Base64 string before atob().
        // atob() throws a DOMException on any non-Base64 character or wrong padding,
        // which would propagate up and break the chat UI for everyone in the room.
        // We strip whitespace, fix padding, and catch decoding errors independently
        // so a single corrupt message degrades gracefully (shows raw text) instead of
        // crashing the whole snapshot handler.
        let sanitized = cipherB64.replace(/\s/g, "");
        const remainder = sanitized.length % 4;
        if (remainder === 2) sanitized += "==";
        else if (remainder === 3) sanitized += "=";
        let combined;
        try {
            combined = Uint8Array.from(atob(sanitized), c => c.charCodeAt(0));
        } catch {
            // Not valid Base64 at all — return as plaintext
            return cipherB64;
        }
        const iv = combined.slice(0, 12); const cipher = combined.slice(12);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
        return new TextDecoder().decode(decrypted);
    } catch { return cipherB64; }
};



function Toast({ toasts }) {
    return (
        <div style={{ position: "fixed", top: "20px", right: "20px", zIndex: 99999, display: "flex", flexDirection: "column", gap: "8px", pointerEvents: "none" }}>
            {toasts.map((t) => (
                <div key={t.id} style={{ backgroundColor: t.color || "#27ae60", color: "white", padding: "12px 20px", borderRadius: "10px", fontSize: "14px", fontWeight: "bold", boxShadow: "0 4px 16px rgba(0,0,0,0.5)", animation: "slideIn 0.3s ease", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>{t.icon}</span><span>{t.message}</span>
                </div>
            ))}
        </div>
    );
}

function EmojiPicker({ onSelect, onClose }) {
    const [activeCategory, setActiveCategory] = useState(0);
    return (
        <div style={{ position: "absolute", bottom: "52px", left: 0, width: "300px", backgroundColor: "#1a1a1a", border: "1px solid #333", borderRadius: "14px", boxShadow: "0 8px 32px rgba(0,0,0,0.8)", zIndex: 1000, overflow: "hidden" }}>
            <div style={{ display: "flex", borderBottom: "1px solid #333", overflowX: "auto" }}>
                {EMOJI_CATEGORIES.map((cat, i) => (
                    <button key={i} onClick={() => setActiveCategory(i)}
                        style={{ padding: "8px 10px", background: "none", border: "none", cursor: "pointer", fontSize: "16px", borderBottom: i === activeCategory ? "2px solid #ff6b35" : "2px solid transparent", opacity: i === activeCategory ? 1 : 0.5, flexShrink: 0 }}>
                        {cat.emojis[0]}
                    </button>
                ))}
                <button onClick={onClose} style={{ marginLeft: "auto", padding: "8px 12px", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "16px", flexShrink: 0 }}>✕</button>
            </div>
            <div style={{ padding: "10px", display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "4px", maxHeight: "200px", overflowY: "auto" }}>
                {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji, i) => (
                    <button key={i} onClick={() => { onSelect(emoji); onClose(); }}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "22px", padding: "4px", borderRadius: "6px" }}
                        onMouseEnter={e => e.target.style.background = "#2a2a2a"}
                        onMouseLeave={e => e.target.style.background = "none"}>
                        {emoji}
                    </button>
                ))}
            </div>
        </div>
    );
}

function VoiceRecorder({ onSend, onCancel, T }) {
    const [recording, setRecording] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [audioBlob, setAudioBlob] = useState(null);
    const [audioUrl, setAudioUrl] = useState(null);
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const timerRef = useRef(null);
    const streamRef = useRef(null); // Bug fix #3: track stream for cleanup
    const startRecording = async () => {
        // Fix #6: Safari + some Android browsers don't support MediaRecorder — crash தடுக்கணும்
        if (!window.MediaRecorder) {
            alert("Voice recording இந்த browser-ல support இல்ல. Chrome அல்லது Firefox use பண்ணு.");
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream; // Bug fix #3: store stream ref
            const mr = new MediaRecorder(stream);
            mediaRecorderRef.current = mr; chunksRef.current = [];
            mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            mr.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob));
                stream.getTracks().forEach(t => t.stop());
            };
            mr.start(); setRecording(true); setSeconds(0);
            timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
        } catch { alert("Microphone access வேணும்!"); }
    };
    const stopRecording = () => {
        if (mediaRecorderRef.current && recording) {
            mediaRecorderRef.current.stop(); setRecording(false); clearInterval(timerRef.current);
        }
    };
    const handleCancel = () => {
        if (recording) stopRecording();
        // Bug 5 fix: audioUrl revoke பண்ணாம null பண்ணா memory leak ஆகும்.
        // URL.revokeObjectURL இங்க call பண்றோம் — unmount cleanup-ல மட்டும் நம்பல.
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioBlob(null); setAudioUrl(null); setSeconds(0); onCancel();
    };

    // Bug fix #3: Cleanup on unmount — stops mic stream, timer, and revokes
    // any object URL to prevent memory leaks.
    useEffect(() => {
        return () => {
            clearInterval(timerRef.current);
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                try { mediaRecorderRef.current.stop(); } catch { }
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            }
            // Revoke object URL to free memory
            setAudioUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
        };
    }, []);
    const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    return (
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${T.border}`, backgroundColor: T.card, display: "flex", alignItems: "center", gap: "8px" }}>
            {!audioBlob ? (
                <>
                    {recording ? (
                        <>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
                                <div style={{ width: "10px", height: "10px", backgroundColor: "#e74c3c", borderRadius: "50%", animation: "pulse2 1s infinite" }} />
                                <span style={{ color: "#e74c3c", fontSize: "14px", fontWeight: "bold" }}>{fmt(seconds)}</span>
                                <span style={{ color: T.text3, fontSize: "12px" }}>Recording...</span>
                            </div>
                            <button onClick={stopRecording} style={{ padding: "8px 14px", backgroundColor: "#e74c3c", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>⏹ Stop</button>
                        </>
                    ) : (
                        <button onClick={startRecording} style={{ padding: "8px 16px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px", flex: 1 }}>🎙️ Record பண்ணு</button>
                    )}
                    <button onClick={handleCancel} style={{ padding: "8px 12px", backgroundColor: T.card2, color: T.text2, border: `1px solid ${T.border}`, borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>✕</button>
                </>
            ) : (
                <>
                    <audio src={audioUrl} controls style={{ flex: 1, height: "32px" }} />
                    <button onClick={() => onSend(audioBlob, seconds)} style={{ padding: "8px 14px", backgroundColor: "#27ae60", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>📤 Send</button>
                    <button onClick={handleCancel} style={{ padding: "8px 10px", backgroundColor: T.card2, color: T.text2, border: `1px solid ${T.border}`, borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>✕</button>
                </>
            )}
        </div>
    );
}
function WatchHistoryModal({ roomId, onClose, T }) {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    // Bug 2 fix: "index" = composite index இல்ல, "general" = வேற error
    const [errType, setErrType] = useState(null);
    const [indexUrl, setIndexUrl] = useState("");
    useEffect(() => {
        const q = query(collection(db, "watchHistory"), where("roomId", "==", roomId), orderBy("watchedAt", "desc"));
        return onSnapshot(q,
            (snap) => { setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
            (err) => {
                if (err.code === "failed-precondition") {
                    // Firebase error message-ல index create link embed ஆகி இருக்கும்
                    const match = err.message?.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
                    setIndexUrl(match ? match[0] : "https://console.firebase.google.com/project/_/firestore/indexes");
                    setErrType("index");
                } else {
                    setErrType("general");
                }
                setLoading(false);
            }
        );
    }, [roomId]);
    return (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.8)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ backgroundColor: T.card, borderRadius: "16px", border: `1px solid ${T.border}`, width: "90%", maxWidth: "480px", maxHeight: "70vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: T.text, fontSize: "18px", fontWeight: "bold" }}>🎬 Watch History</span>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: T.text2, fontSize: "20px", cursor: "pointer" }}>✕</button>
                </div>
                <div style={{ overflowY: "auto", flex: 1, padding: "12px" }}>
                    {loading && <p style={{ color: T.text2, textAlign: "center", padding: "20px" }}>⏳ Load ஆகுது...</p>}
                    {errType === "index" && (
                        <div style={{ backgroundColor: "rgba(243,156,18,0.15)", border: "1px solid rgba(243,156,18,0.4)", borderRadius: "10px", padding: "14px", margin: "8px 0" }}>
                            <p style={{ color: "#f39c12", fontSize: "13px", fontWeight: "bold", margin: "0 0 6px 0" }}>⚠️ Firestore Index வேணும்!</p>
                            <p style={{ color: T.text2, fontSize: "12px", margin: "0 0 10px 0" }}>
                                <code style={{ backgroundColor: "rgba(0,0,0,0.3)", padding: "2px 5px", borderRadius: "4px" }}>roomId + watchedAt</code> composite index create ஆகல.
                            </p>
                            <a href={indexUrl} target="_blank" rel="noreferrer"
                                style={{ display: "inline-block", color: "white", fontSize: "12px", fontWeight: "bold", backgroundColor: "#f39c12", padding: "6px 14px", borderRadius: "8px", textDecoration: "none" }}>
                                🔗 Firebase Console-ல Index Create பண்ணு →
                            </a>
                            <p style={{ color: T.text3, fontSize: "11px", margin: "8px 0 0 0" }}>Click பண்ணி "Create index" press பண்ணு. சில minutes-ல ready ஆகும்.</p>
                        </div>
                    )}
                    {errType === "general" && <p style={{ color: "#e74c3c", textAlign: "center", padding: "20px", fontSize: "13px" }}>❌ History load ஆகல. Refresh பண்ணி try பண்ணு.</p>}
                    {!loading && !errType && history.length === 0 && <p style={{ color: T.text3, textAlign: "center", padding: "20px" }}>இன்னும் எந்த movie-உம் பார்க்கல 🍿</p>}
                    {history.map(h => (
                        <div key={h.id} style={{ backgroundColor: T.card2, borderRadius: "10px", padding: "12px 16px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "12px" }}>
                            <span style={{ fontSize: "28px" }}>{h.movieType === "youtube" ? "▶️" : "🎞️"}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ color: T.text, fontSize: "14px", fontWeight: "bold", margin: "0 0 4px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.movieTitle || h.movieUrl?.substring(0, 40) || "Movie"}</p>
                                <p style={{ color: T.text3, fontSize: "12px", margin: 0 }}>{h.watchedBy} • {h.watchedAt?.toDate ? new Date(h.watchedAt.toDate()).toLocaleDateString("ta-IN") : ""}</p>
                            </div>
                            <span style={{ color: h.movieType === "youtube" ? "#e74c3c" : "#3498db", fontSize: "11px", fontWeight: "bold", backgroundColor: T.card, padding: "2px 8px", borderRadius: "10px" }}>{h.movieType === "youtube" ? "YouTube" : "Upload"}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ===================== MAIN ROOM =====================
function Room() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const [roomData, setRoomData] = useState(null);
    const [roomDocId, setRoomDocId] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [copied, setCopied] = useState(false);
    const isSyncingRef = useRef(false);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [username, setUsername] = useState("");
    const [nameSet, setNameSet] = useState(false);
    const [showChat, setShowChat] = useState(true);
    const [floatingReactions, setFloatingReactions] = useState([]);
    const [livekitToken, setLivekitToken] = useState(null);
    const [showVideoCall, setShowVideoCall] = useState(false);
    const [incomingCall, setIncomingCall] = useState(false);
    const [callStatus, setCallStatus] = useState(null);
    const [callerName, setCallerName] = useState("");
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [acceptLoading, setAcceptLoading] = useState(false);
    const [isDark, setIsDark] = useState(true);
    const showVideoCallRef = useRef(false); // Bug 1 fix: stale closure guard
    const [toasts, setToasts] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [partnerTyping, setPartnerTyping] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
    const [replyTo, setReplyTo] = useState(null);
    const [editingMsg, setEditingMsg] = useState(null); // { id, message } - message being edited
    const editingMsgRef = useRef(null); // ref to avoid stale closure in sendMessage
    const [unreadCount, setUnreadCount] = useState(0);
    const [onlineUsers, setOnlineUsers] = useState([]);

    const [needsUserGesture, setNeedsUserGesture] = useState(false); // Bug 3: autoplay block detection
    const prevParticipantsRef = useRef([]);
    const participantsInitializedRef = useRef(false); // skip toast on first load
    const playerContainerRef = useRef(null); // Bug 4: measure actual player bounds for emoji positioning
    const iframeRef = useRef(null);
    const videoRef = useRef(null);
    const chatEndRef = useRef(null);
    const usernameRef = useRef("");
    const isSyncingSeekRef = useRef(false);
    const typingTimeoutRef = useRef(null);
    const typingWriteRef = useRef(null);
    const historyLoggedRef = useRef(false);
    const joinedRef = useRef(false);
    const prevOnlineRef = useRef([]);
    const showChatRef = useRef(true); // must match showChat useState(true) initial value
    const reactionTimers = useRef([]); // cleanup floating reaction timeouts on unmount
    const lastReactionTimeRef = useRef({}); // per-emoji debounce — flood prevention

    // FIX 1: YouTube refs defined early - before any useEffect
    // pendingYtCmdRef is now a QUEUE (array) — multiple commands before player ready
    // are all preserved and flushed in order, not overwritten by the last one.
    const ytSrcRef = useRef(null);
    const ytReadyRef = useRef(false);
    const pendingYtCmdRef = useRef([]);

    useEffect(() => { usernameRef.current = username; }, [username]);

    // 🔔 Push notifications — temporarily disabled (TODO: re-enable)
    const registerToken = async () => false;
    useEffect(() => { showVideoCallRef.current = showVideoCall; }, [showVideoCall]);
    useEffect(() => { showChatRef.current = showChat; if (showChat) setUnreadCount(0); }, [showChat]);
    // Smart scroll: only jump to bottom when the user is already near the bottom
    // (within 150 px). isMine condition removed — force scrolling when user sends
    // a message while scrolled up breaks their read position (Fix #5).
    const chatScrollRef = useRef(null);
    useEffect(() => {
        const container = chatScrollRef.current;
        if (!container) { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
        const { scrollTop, scrollHeight, clientHeight } = container;
        const nearBottom = scrollHeight - scrollTop - clientHeight < 150;
        if (nearBottom) {
            chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages]);

    // Reset YouTube state on room change OR movieUrl change within same room.
    // ytSrcRef caches the src string — must be cleared when the video changes
    // so getYouTubeSrc() builds a fresh URL for the new video.
    const prevMovieUrlRef = useRef(null);
    useEffect(() => {
        const movieUrlChanged = prevMovieUrlRef.current !== null &&
            prevMovieUrlRef.current !== (roomData?.movieUrl ?? null);
        prevMovieUrlRef.current = roomData?.movieUrl ?? null;
        if (movieUrlChanged) {
            ytSrcRef.current = null;
            ytReadyRef.current = false;
            pendingYtCmdRef.current = [];
        }
    }, [roomData?.movieUrl]);

    useEffect(() => {
        ytSrcRef.current = null;
        ytReadyRef.current = false;
        pendingYtCmdRef.current = [];
        historyLoggedRef.current = false; // reset so history logs in new room
        _decryptCache.clear();            // stale ciphertext must not survive room change
        _keyCache.clear();                // derived keys are room-specific — clear on change
        prevMovieUrlRef.current = null;
    }, [roomId]);

    useEffect(() => {
        if (!nameSet) return;
        joinedRef.current = false;
        const t = setTimeout(() => { joinedRef.current = true; }, 2000);
        return () => clearTimeout(t);
    }, [nameSet]);

    // Bug 3 fix: isPlayingRef — onLoad-ல setTimeout closure-க்குள்ள
    // isPlaying state stale ஆகிடும். Ref மூலம் latest value படிக்கிறோம்.
    const isPlayingRef = useRef(isPlaying);
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

    const showToast = useCallback((message, icon = "🔔", color = "#27ae60") => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, icon, color }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
    }, []);

    useEffect(() => {
        // Screenshot blocking strategy:
        // 1. CSS user-select: none — text copy தடுக்கிறோம்
        // 2. -webkit-user-drag: none — drag-to-save தடுக்கிறோம்  
        // 3. Keyboard shortcuts (PrintScreen, Ctrl+Shift+S) detect பண்றோம்
        // 4. CSS media: print — print/PDF block
        // NOTE: OS-level tools (Win+Shift+S, phone camera) block பண்ண முடியாது.
        const style = document.createElement("style");
        style.id = "screenshot-block";
        style.textContent = `
            * { -webkit-user-select: none !important; user-select: none !important; -webkit-user-drag: none !important; }
            input, textarea { -webkit-user-select: text !important; user-select: text !important; }
            @media print { body { display: none !important; } }
        `;
        document.head.appendChild(style);
        const blockPrint = (e) => {
            if (e.key === "PrintScreen") {
                e.preventDefault();
                navigator.clipboard.writeText("").catch(() => { });
                showToast("Screenshot block! 🚫", "🚫", "#e74c3c");
            }
            if ((e.ctrlKey && e.shiftKey && e.key === "S") || (e.metaKey && e.shiftKey && ["3", "4", "5"].includes(e.key))) {
                e.preventDefault();
                showToast("Screenshot block! 🚫", "🚫", "#e74c3c");
            }
        };
        // Block right-click context menu (prevents "Save image as" on video)
        const blockContext = (e) => e.preventDefault();
        window.addEventListener("keydown", blockPrint);
        document.addEventListener("contextmenu", blockContext);
        return () => {
            document.getElementById("screenshot-block")?.remove();
            window.removeEventListener("keydown", blockPrint);
            document.removeEventListener("contextmenu", blockContext);
        };
    }, [showToast]);

    useEffect(() => {
        const fn = (e) => { if (e.key === "Escape") { setIsFullscreen(false); setShowEmojiPicker(false); } };
        window.addEventListener("keydown", fn);
        return () => window.removeEventListener("keydown", fn);
    }, []);

    const getYouTubeSrc = useCallback((id) => {
        // Bug 3 fix: Cache key-ல id include பண்றோம்.
        // Before: ytSrcRef.current-ல first video-இன் URL மட்டும் store ஆகும்.
        // வேற video load ஆனா old URL-ஐ திரும்ப return பண்ணும் — wrong video play ஆகும்.
        // இப்போ: id மாறும்போது ytSrcRef.current null ஆகும் (prevMovieUrl useEffect),
        // so every new videoId-க்கு fresh URL build ஆகும்.
        if (!ytSrcRef.current) {
            ytSrcRef.current = `https://www.youtube.com/embed/${id}?autoplay=0&controls=1&enablejsapi=1&origin=${window.location.origin}&rel=0&playsinline=1`;
        }
        return ytSrcRef.current;
    }, []);

    const sendYtCmd = useCallback((func) => {
        if (!iframeRef.current) return;
        if (ytReadyRef.current) {
            try { iframeRef.current.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*"); } catch { }
        } else {
            // Queue commands instead of overwriting — prevents race condition
            // where a seek arrives after a play and only the seek survives.
            // Cap at 10 to prevent unbounded growth if player never becomes ready.
            if (pendingYtCmdRef.current.length < 10) {
                pendingYtCmdRef.current.push(func);
            }
        }
    }, []);

    useEffect(() => {
        const onMsg = (e) => {
            try {
                const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
                if (d?.event === "onReady" || (d?.event === "infoDelivery" && !ytReadyRef.current)) {
                    ytReadyRef.current = true;
                    // Flush the entire command queue in order
                    const queue = pendingYtCmdRef.current;
                    pendingYtCmdRef.current = [];
                    queue.forEach(func => sendYtCmd(func));
                }
            } catch { }
        };
        window.addEventListener("message", onMsg);
        return () => window.removeEventListener("message", onMsg);
    }, [sendYtCmd]);

    useEffect(() => {
        if (!roomData?.movieUrl || !getYouTubeId(roomData.movieUrl)) return;
        if (isPlaying) {
            // Mute first → play → unmute satisfies browser autoplay policy.
            // Both timers stored so cleanup cancels them if user pauses
            // before 700ms — prevents video getting stuck muted.
            const unMuteTimer = setTimeout(() => sendYtCmd("unMute"), 700);
            const t = setTimeout(() => {
                sendYtCmd("mute");
                sendYtCmd("playVideo");
                setNeedsUserGesture(false);
            }, 200);
            return () => { clearTimeout(t); clearTimeout(unMuteTimer); };
        } else {
            const t = setTimeout(() => { sendYtCmd("pauseVideo"); setNeedsUserGesture(false); }, 200);
            return () => clearTimeout(t);
        }
    }, [isPlaying, roomData?.movieUrl, sendYtCmd]);

    // FIX 4: Direct document lookup for better reliability  
    const roomLoadedRef = useRef(false);
    useEffect(() => {
        console.log("[Watch Together] Setting up room listener for roomId:", roomId);
        const roomRef = doc(db, "rooms", roomId);

        const unsubscribe = onSnapshot(
            roomRef,
            (snapshot) => {
                if (snapshot.exists()) {
                    setRoomDocId(snapshot.id);
                    const data = snapshot.data();
                    const movieUrl = normalizeMovieUrl(data);
                    const normalizedData = {
                        ...data,
                        movieUrl,
                        movieType: getMovieType(data, movieUrl),
                    };
                    setRoomData(normalizedData);

                    console.log("[Watch Together Debug] Room data:", {
                        roomId,
                        docId: snapshot.id,
                        hasMovieUrl: !!movieUrl,
                        movieUrl,
                        movieUrlLength: movieUrl ? movieUrl.length : 0,
                        rawMovieUrl: data.movieUrl,
                        legacyVideoUrl: data.videoUrl,
                        isYouTube: !!getYouTubeId(movieUrl),
                        youtubeId: getYouTubeId(movieUrl)
                    });

                    if (!roomLoadedRef.current && movieUrl) {
                        roomLoadedRef.current = true;
                        const youtubeId = getYouTubeId(movieUrl);
                        if (youtubeId) {
                            showToast("YouTube video ready! 🎬", "✅", "#27ae60");
                        } else {
                            showToast("Video file ready! 🎬", "✅", "#27ae60");
                        }
                    } else if (!roomLoadedRef.current && !movieUrl) {
                        roomLoadedRef.current = true;
                        showToast("Room loaded! Movie URL add pannunga 🏠", "⚠️", "#f39c12");
                    }

                    if (!isSyncingRef.current) {
                        setIsPlaying(normalizedData.isPlaying);
                    }
                    if (videoRef.current && normalizedData.currentTime !== undefined && !isSyncingSeekRef.current) {
                        const diff = Math.abs(videoRef.current.currentTime - normalizedData.currentTime);
                        if (diff > 0.8) {
                            videoRef.current.currentTime = normalizedData.currentTime;
                        }
                    }
                    if (videoRef.current && !isSyncingRef.current) {
                        if (normalizedData.isPlaying && videoRef.current.paused) {
                            videoRef.current.play().catch(() => { });
                        } else if (!normalizedData.isPlaying && !videoRef.current.paused) {
                            videoRef.current.pause();
                        }
                    }
                } else {
                    console.error("[Watch Together] Room document does not exist:", roomId);
                    showToast("Room illa! Room ID check pannunga.", "❌", "#e74c3c");
                }
            },
            (error) => {
                console.error("[Watch Together] Firebase snapshot error:", error);
                showToast("Firebase connection error! Internet check pannunga.", "❌", "#e74c3c");
            }
        );

        return unsubscribe;
    }, [roomId, showToast]);

    // FIX 2: Merged call+typing+presence into ONE onSnapshot listener
    useEffect(() => {
        if (!roomDocId || !nameSet) return;
        return onSnapshot(doc(db, "rooms", roomDocId), (snap) => {
            const data = snap.data(); if (!data) return;
            const me = usernameRef.current;

            // Call status
            // Only show incoming call if not already in a call
            if (data.callStatus === "calling" && data.callBy !== me && !showVideoCallRef.current) { setCallerName(data.callBy || "Partner"); setIncomingCall(true); }
            if (data.callStatus === "idle" || data.callStatus === "ended") {
                setIncomingCall(false);
                if (data.callBy !== me) { setLivekitToken(null); setShowVideoCall(false); setCallStatus(null); }
            }

            // Participants join toast
            if (data.participants && Array.isArray(data.participants)) {
                if (!participantsInitializedRef.current) {
                    // First snapshot — silently initialize, no toast for pre-existing members
                    participantsInitializedRef.current = true;
                } else {
                    const prev = prevParticipantsRef.current;
                    const newOnes = data.participants.filter(p => p !== me && !prev.includes(p));
                    newOnes.forEach(p => showToast(`${p} join ஆனாங்க! 🎉`, "💚", "#27ae60"));
                }
                prevParticipantsRef.current = data.participants;
            }

            // Typing
            if (data.typing && data.typing !== me) {
                setPartnerTyping(true);
                clearTimeout(typingTimeoutRef.current);
                typingTimeoutRef.current = setTimeout(() => setPartnerTyping(false), 3000);
            } else if (!data.typing || data.typing === me) {
                setPartnerTyping(false);
                clearTimeout(typingTimeoutRef.current);
            }

            // FIX 2: Presence handled here too - no separate listener
            if (data.presence) {
                const now = Date.now();
                const online = Object.entries(data.presence)
                    .filter(([, ts]) => ts && (now - ts) < 40000)
                    .map(([name]) => name);
                setOnlineUsers(online);
            } else {
                setOnlineUsers([]);
            }
        });
    }, [roomDocId, nameSet, showToast]);

    // Online/offline toasts
    useEffect(() => {
        if (!nameSet) return;
        const prev = prevOnlineRef.current;
        const others = onlineUsers.filter(u => u !== username);
        const prevOthers = prev.filter(u => u !== username);
        others.filter(u => !prevOthers.includes(u)).forEach(u => showToast(`${u} Online ஆனாங்க! 🟢`, "🟢", "#27ae60"));
        prevOthers.filter(u => !others.includes(u)).forEach(u => showToast(`${u} Offline ஆனாங்க 🔴`, "🔴", "#e74c3c"));
        prevOnlineRef.current = onlineUsers;
    }, [onlineUsers, username, nameSet, showToast]);

    const markMessagesRead = useCallback(async (msgs) => {
        if (!roomId || !username) return;
        const unread = msgs.filter(m =>
            m.username !== username &&
            !(m.readBy || []).includes(username) &&
            m.firestoreId
        );
        if (unread.length === 0) return;
        // Batch all readBy updates into a single Firestore commit —
        // avoids N parallel updateDoc calls that risk hitting rate limits.
        try {
            // Firestore batch limit = 500 ops. Chunk into groups of 400 for safety.
            const BATCH_SIZE = 400;
            for (let i = 0; i < unread.length; i += BATCH_SIZE) {
                const chunk = unread.slice(i, i + BATCH_SIZE);
                const batch = writeBatch(db);
                chunk.forEach(m => {
                    batch.update(doc(db, "chats", m.firestoreId), { readBy: arrayUnion(username) });
                });
                await batch.commit();
            }
        } catch { }
    }, [roomId, username]);

    useEffect(() => {
        const q = query(collection(db, "chats"), where("roomId", "==", roomId), orderBy("createdAt", "asc"));
        return onSnapshot(q, async (snap) => {
            const rawMsgs = snap.docs.map(d => ({ firestoreId: d.id, id: d.id, ...d.data() }));
            const decrypted = await Promise.all(rawMsgs.map(async (msg) => {
                if (msg.type === "voice") return msg;
                if (!msg.message) return msg;
                // Cache hit: skip re-decrypting — but invalidate if message was edited
                const cacheKey = msg.firestoreId;
                if (cacheKey && _decryptCache.has(cacheKey)) {
                    const cached = _decryptCache.get(cacheKey);
                    // editedAt changed → message was edited → must re-decrypt
                    const cachedEditedAt = cached._editedAt ?? null;
                    const msgEditedAt = msg.editedAt?.toMillis?.() ?? msg.editedAt ?? null;
                    if (cachedEditedAt === msgEditedAt) {
                        return { ...msg, ...cached };
                    }
                    // Cache stale — fall through to re-decrypt
                }
                const plain = await decryptMessage(msg.message, roomId);
                let replyPlain = null;
                if (typeof msg.replyToMessage === "string" && msg.replyToMessage.length > 0) replyPlain = await decryptMessage(msg.replyToMessage, roomId);
                // Store editedAt in cache so we can detect future edits
                const msgEditedAt = msg.editedAt?.toMillis?.() ?? msg.editedAt ?? null;
                const cached = { message: plain, replyToMessageDecrypted: replyPlain, _editedAt: msgEditedAt };
                if (cacheKey) {
                    // LRU evict oldest entry if over limit
                    if (_decryptCache.size >= MAX_DECRYPT_CACHE) {
                        _decryptCache.delete(_decryptCache.keys().next().value);
                    }
                    _decryptCache.set(cacheKey, cached);
                }
                return { ...msg, ...cached };
            }));
            setMessages(decrypted);
            markMessagesRead(decrypted);
            // Track unread count when chat is closed
            if (!showChatRef.current) {
                const myUnread = decrypted.filter(m => m.username !== usernameRef.current && !(m.readBy || []).includes(usernameRef.current));
                setUnreadCount(myUnread.length);
            } else {
                setUnreadCount(0);
            }
        });
    }, [roomId, markMessagesRead]);

    // Reactions flood fix: page load timestamp store பண்றோம்.
    // இதுக்கு முன்னாடி Firestore-ல இருந்த reactions page reload-ல
    // ஒரே நேரத்துல animate ஆகும் — அதை தடுக்க session start time use பண்றோம்.
    const sessionStartRef = useRef(new Date());

    // Cleanup all pending reaction timers on unmount
    useEffect(() => {
        return () => { reactionTimers.current.forEach(t => clearTimeout(t)); };
    }, []);

    // Periodic decrypt cache trim — long sessions-ல 500 entries hit ஆகலாம்.
    // 5 min-க்கு ஒரு முறை check; 300+ entries இருந்தா half clear பண்றோம்
    // (full clear-ஐ விட gentler — active messages re-decrypt வேண்டாம்).
    useEffect(() => {
        const id = setInterval(() => {
            if (_decryptCache.size > 300) {
                // Delete oldest 150 entries (Map iteration order = insertion order)
                let count = 0;
                for (const key of _decryptCache.keys()) {
                    if (count++ >= 150) break;
                    _decryptCache.delete(key);
                }
            }
        }, 5 * 60 * 1000);
        return () => clearInterval(id);
    }, []);

    // Reaction listener — sessionStart filter நீக்கியோம்.
    // Problem: sessionStart = உன்னோட page load time. Partner reaction அனுப்பும் போது
    // Firestore clock skew-ல "before your session" ஆகி skip ஆகும் → partner reaction வராது.
    // Fix: filter இல்லாம எல்லா new reactions-உம் வாங்குறோம்.
    // Page reload-ல old reactions re-animate ஆகாம இருக்க seenReactionIdsRef use பண்றோம்.
    const seenReactionIdsRef = useRef(new Set());
    useEffect(() => {
        const q = query(
            collection(db, "reactions"),
            where("roomId", "==", roomId),
            orderBy("createdAt", "asc")
        );
        return onSnapshot(q, (snap) => {
            snap.docChanges().forEach(change => {
                if (change.type === "added") {
                    const id = change.doc.id;
                    // Already seen (page reload replay) → skip animate, still track id
                    if (seenReactionIdsRef.current.has(id)) return;
                    seenReactionIdsRef.current.add(id);
                    const { emoji } = change.doc.data();
                    const containerW = playerContainerRef.current?.offsetWidth || 0;
                    const EMOJI_PX = 40;
                    const MARGIN = 16;
                    let x;
                    if (containerW > EMOJI_PX * 2 + MARGIN * 2) {
                        const maxLeft = containerW - EMOJI_PX - MARGIN;
                        x = Math.floor(Math.random() * (maxLeft - MARGIN) + MARGIN);
                        x = `${x}px`;
                    } else {
                        x = "45%";
                    }
                    setFloatingReactions(prev => [...prev, { id, emoji, x }]);
                    // Store timer id so we can cancel if component unmounts,
                    // preventing setState-after-unmount React warning.
                    const reactionTimer = setTimeout(() => {
                        setFloatingReactions(prev => prev.filter(r => r.id !== id));
                        deleteDoc(doc(db, "reactions", id)).catch(() => { });
                        // Bug 6 fix: completed timer-ஐ array-ல இருந்து remove பண்றோம்.
                        // இல்லன்னா reactionTimers.current unbounded-ஆ grow ஆகும் —
                        // ஒவ்வொரு reaction-க்கும் ஒரு timer id சேர்ந்துட்டே போகும்.
                        reactionTimers.current = reactionTimers.current.filter(t => t !== reactionTimer);
                    }, 3000);
                    reactionTimers.current.push(reactionTimer);
                }
            });
        });
    }, [roomId]);

    // Member limit check: participants array-ல பழைய entries இருக்கலாம் (disconnect ஆனவங்க).
    // Fix: presence map-ல இருக்கற currently online count-ஐ பாக்குறோம் — accurate count.
    useEffect(() => {
        if (!roomDocId || !username) return;
        getDoc(doc(db, "rooms", roomDocId)).then((snap) => {
            const data = snap.data();
            if (!data) return;
            const participants = data.participants || [];
            // Already in room — skip limit check (rejoin allowed)
            if (participants.includes(username)) {
                return;
            }
            const maxMembers = data.maxMembers ?? 10;
            // Use presence map for accurate online count (not stale participants array)
            const presenceMap = data.presence || {};
            const now = Date.now();
            const activeCount = Object.values(presenceMap).filter(ts => ts && (now - ts) < 60000).length;
            if (activeCount >= maxMembers) {
                alert(`❌ Room full! ${maxMembers} பேர் மட்டும் allowed. வேற room try பண்ணு.`);
                navigate("/");
                return;
            }
            updateDoc(doc(db, "rooms", roomDocId), { participants: arrayUnion(username) }).catch(() => { });
        }).catch(() => {
            updateDoc(doc(db, "rooms", roomDocId), { participants: arrayUnion(username) }).catch(() => { });
        });
    }, [roomDocId, username, navigate]);

    // FIX 3: Presence - visibilitychange properly removed
    useEffect(() => {
        if (!roomDocId || !username) return;
        const markOnline = () => updateDoc(doc(db, "rooms", roomDocId), { [`presence.${username}`]: Date.now() }).catch(() => { });
        const markOffline = () => updateDoc(doc(db, "rooms", roomDocId), { [`presence.${username}`]: null }).catch(() => { });
        const onVisibility = () => { if (document.hidden) markOffline(); else markOnline(); };
        markOnline();
        const heartbeat = setInterval(markOnline, 20000);
        window.addEventListener("beforeunload", markOffline);
        document.addEventListener("visibilitychange", onVisibility); // FIX 3: named function
        return () => {
            clearInterval(heartbeat);
            markOffline();
            window.removeEventListener("beforeunload", markOffline);
            document.removeEventListener("visibilitychange", onVisibility); // FIX 3: properly removed
        };
    }, [roomDocId, username]);

    const saveWatchHistory = useCallback(async (docId, data, user) => {
        const movieUrl = normalizeMovieUrl(data);
        if (!docId || !movieUrl || !user) return;
        const youtubeId = getYouTubeId(movieUrl);
        try {
            await addDoc(collection(db, "watchHistory"), {
                roomId, movieUrl,
                movieType: data?.movieType || (youtubeId ? "youtube" : "upload"),
                movieTitle: youtubeId ? `YouTube: ${youtubeId}` : movieUrl.split("/").pop() || "Movie",
                watchedBy: user, watchedAt: new Date(),
            });
        } catch { }
    }, [roomId]);

    useEffect(() => {
        if (isPlaying && roomDocId && roomData?.movieUrl && username && !historyLoggedRef.current) {
            historyLoggedRef.current = true;
            saveWatchHistory(roomDocId, roomData, username);
        }
    }, [isPlaying, roomDocId, roomData, username, saveWatchHistory]);

    // Bug 5 fix: wrap in useCallback with explicit deps so these functions always
    // close over the current roomDocId/username, not a stale snapshot from mount-time.
    const updatePlayState = useCallback(async (playing, time) => {
        if (!roomDocId) return;
        isSyncingRef.current = true;
        const update = { isPlaying: playing };
        if (time !== undefined) update.currentTime = time;
        await updateDoc(doc(db, "rooms", roomDocId), update);
        setTimeout(() => { isSyncingRef.current = false; }, 1000);
    }, [roomDocId]);

    const handleSeek = useCallback(async () => {
        if (!videoRef.current || !roomDocId) return;
        isSyncingSeekRef.current = true;
        await updateDoc(doc(db, "rooms", roomDocId), { currentTime: videoRef.current.currentTime });
        setTimeout(() => { isSyncingSeekRef.current = false; }, 1500);
    }, [roomDocId]);

    const lastTypingSentRef = useRef(0);
    const handleTyping = useCallback(async (e) => {
        setNewMessage(e.target.value);
        if (!roomDocId) return;
        clearTimeout(typingWriteRef.current);
        typingWriteRef.current = setTimeout(async () => {
            // Throttle: max 1 Firestore write per second for typing indicator
            const now = Date.now();
            if (now - lastTypingSentRef.current < 1000) return;
            lastTypingSentRef.current = now;
            await updateDoc(doc(db, "rooms", roomDocId), { typing: username }).catch(() => { });
        }, 300);
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(async () => {
            await updateDoc(doc(db, "rooms", roomDocId), { typing: "" }).catch(() => { });
        }, 2000);
    }, [roomDocId, username]);

    const fetchToken = useCallback(async () => {
        const url = `/api/token?roomName=room-${roomId}&participantName=${encodeURIComponent(username)}`;
        let r;
        try {
            r = await fetch(url);
        } catch {
            throw new Error("Network error — internet connection check பண்ணு");
        }
        if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || "Token fetch failed"); }
        const d = await r.json();
        if (!d.token) throw new Error("No token received");
        return d.token;
    }, [roomId, username]);

    const startVideoCall = useCallback(async () => {
        try {
            setCallStatus("calling");
            if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "calling", callBy: username });
            const token = await fetchToken();
            setLivekitToken(token); setShowVideoCall(true); setCallStatus("in-call");
        } catch (err) { setCallStatus(null); alert("Video call start ஆகல: " + err.message); }
    }, [roomDocId, username, fetchToken]);

    const acceptCall = useCallback(async () => {
        setIncomingCall(false); setAcceptLoading(true); setCallStatus("in-call");
        try {
            if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "in-call" });
            const token = await fetchToken();
            setLivekitToken(token); setShowVideoCall(true);
        } catch (err) { setCallStatus(null); alert("❌ Call accept ஆகல: " + err.message); }
        finally { setAcceptLoading(false); }
    }, [roomDocId, fetchToken]);

    const rejectCall = useCallback(async () => {
        setIncomingCall(false);
        setCallStatus(null); // Bug 4 fix: local callStatus clear பண்ணாம விட்டா "Calling..." button stuck ஆகும்
        if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "ended", callBy: username });
    }, [roomDocId, username]);

    // Bug 1 fix: null the token FIRST — this unmounts <LiveKitRoom>, which fires
    // RoomDisconnector's cleanup, stopping all hardware tracks before React tears down.
    const endVideoCall = useCallback(async () => {
        setLivekitToken(null);          // triggers RoomDisconnector unmount → hardware released
        setShowVideoCall(false);
        setCallStatus(null);
        if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "ended", callBy: username });
    }, [roomDocId, username]);

    const sendReaction = useCallback(async (emoji) => {
        // Debounce: same emoji = min 1.5s gap. Different emoji = 500ms gap.
        // Prevents reaction flood from fast taps / held-down clicks.
        const now = Date.now();
        const lastTime = lastReactionTimeRef.current[emoji] || 0;
        const COOLDOWN = 1500;
        if (now - lastTime < COOLDOWN) return;
        lastReactionTimeRef.current[emoji] = now;
        await addDoc(collection(db, "reactions"), { roomId, emoji, username, createdAt: new Date() });
    }, [roomId, username]);

    const handleEmojiSelect = useCallback((emoji) => { setNewMessage(prev => prev + emoji); }, []);

    // Fix: sendMessage previously captured newMessage and replyTo in its dep array,
    // creating a new function reference on every keystroke. Storing them in refs
    // lets us always read the latest values at send-time without the instability.
    const newMessageRef = useRef(newMessage);
    const replyToRef = useRef(replyTo);
    useEffect(() => { newMessageRef.current = newMessage; }, [newMessage]);
    useEffect(() => { editingMsgRef.current = editingMsg; }, [editingMsg]);
    useEffect(() => { replyToRef.current = replyTo; }, [replyTo]);

    // ── Edit message ────────────────────────────────────────────────────
    const editMessage = useCallback(async (msgId, newText) => {
        if (!newText.trim() || newText.length > 2000) return;
        try {
            const encrypted = await encryptMessage(newText.trim(), roomId);
            await updateDoc(doc(db, "chats", msgId), {
                message: encrypted,
                editedAt: new Date(),
            });
            // Update decrypt cache immediately with new text + new editedAt
            // so UI reflects instantly without waiting for Firestore snapshot
            const nowMillis = Date.now();
            if (_decryptCache.has(msgId)) {
                const old = _decryptCache.get(msgId);
                _decryptCache.set(msgId, { ...old, message: newText.trim(), _editedAt: nowMillis });
            } else {
                _decryptCache.set(msgId, { message: newText.trim(), _editedAt: nowMillis });
            }
            setEditingMsg(null);
            setNewMessage("");
        } catch (err) { showToast("Edit fail: " + err.message, "❌", "#e74c3c"); }
    }, [roomId, showToast]);

    // ── Delete message ────────────────────────────────────────────────
    const deleteMessage = useCallback(async (msgId) => {
        try {
            await deleteDoc(doc(db, "chats", msgId));
            _decryptCache.delete(msgId);
        } catch (err) { showToast("Delete fail: " + err.message, "❌", "#e74c3c"); }
    }, [showToast]);

    const sendMessage = useCallback(async (msg) => {
        // Edit mode: save edit instead of sending new message (use ref to avoid stale closure)
        if (editingMsgRef.current && !msg) {
            const text = newMessageRef.current.trim();
            if (text) await editMessage(editingMsgRef.current.id, text);
            else { setEditingMsg(null); setNewMessage(""); }
            return;
        }
        const text = msg || newMessageRef.current.trim();
        if (!text) return;
        // 2000 char limit — prevents huge Firestore docs and expensive encrypts
        if (text.length > 2000) {
            showToast("Message too long! Max 2000 characters.", "❌", "#e74c3c");
            return;
        }
        // Clear pending typing timers so they don't fire after message is sent
        clearTimeout(typingWriteRef.current);
        clearTimeout(typingTimeoutRef.current);
        if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { typing: "" }).catch(() => { });
        const encrypted = await encryptMessage(text, roomId);
        const chatDoc = { roomId, username, message: encrypted, createdAt: new Date(), readBy: [username] };
        const currentReplyTo = replyToRef.current;
        if (currentReplyTo) {
            chatDoc.replyToId = currentReplyTo.id;
            chatDoc.replyToUsername = currentReplyTo.username;
            chatDoc.replyToMessage = await encryptMessage(currentReplyTo.message, roomId);
        }
        await addDoc(collection(db, "chats"), chatDoc);
        if (!msg) setNewMessage("");
        setReplyTo(null);
        // 🔔 Trigger push notification to partner (fire-and-forget)
        fetch("/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                roomId,
                senderUsername: username,
                messagePreview: text.substring(0, 60), // preview, not encrypted
            }),
        }).catch(() => { }); // silent fail if not deployed
        // newMessage and replyTo are intentionally read via refs — not listed as deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomDocId, roomId, username, showToast]);



    const handleVoiceSend = useCallback(async (audioBlob, duration) => {
        setShowVoiceRecorder(false);
        // Guard: 5 MB max — Cloudinary free tier limit is 10 MB, but large files
        // cause slow uploads on mobile. 5 MB ≈ 8 min of webm audio — more than enough.
        const MAX_BYTES = 5 * 1024 * 1024;
        if (audioBlob.size > MAX_BYTES) {
            showToast(`Voice message too large (${(audioBlob.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`, "❌", "#e74c3c");
            return;
        }
        try {
            if (!import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || !import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET) {
                throw new Error("Cloudinary config missing — .env check பண்ணு");
            }
            showToast("Voice message upload ஆகுது...", "🎙️", "#8e44ad");
            const formData = new FormData();
            formData.append("file", audioBlob, "voice.webm");
            formData.append("upload_preset", import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
            formData.append("folder", "voice-messages");
            formData.append("resource_type", "video");
            const res = await fetch(`https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/video/upload`, { method: "POST", body: formData });
            const data = await res.json();
            if (!data.secure_url) throw new Error("Upload failed");
            const encLabel = await encryptMessage(`🎙️ Voice message (${duration}s)`, roomId);
            await addDoc(collection(db, "chats"), { roomId, username, message: encLabel, voiceUrl: data.secure_url, type: "voice", createdAt: new Date(), readBy: [username] });
            showToast("Voice message sent! 🎙️", "✅", "#27ae60");
        } catch (err) { showToast("Voice send fail: " + err.message, "❌", "#e74c3c"); }
    }, [roomId, username, showToast]);

    const T = isDark ? {
        bg: "#0f0f0f", card: "#1a1a1a", card2: "#2a2a2a",
        border: "#333", text: "white", text2: "#aaa", text3: "#666",
        playerBg: "#000", reactionBg: "#111",
    } : {
        bg: "#f5f5f5", card: "#ffffff", card2: "#eeeeee",
        border: "#ddd", text: "#111111", text2: "#555555", text3: "#888888",
        playerBg: "#222", reactionBg: "#e8e8e8",
    };

    if (!nameSet) {
        // Bug 6 fix: show env-var warning banner before the name gate so devs
        // catch the problem immediately during development or after a bad deploy.
        return (
            <div style={{ backgroundColor: T.bg, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px" }}>
                {MISSING_ENV.length > 0 && (
                    <div style={{ width: "100%", maxWidth: "480px", backgroundColor: "rgba(231,76,60,0.15)", border: "1px solid rgba(231,76,60,0.5)", borderRadius: "12px", padding: "16px 20px", marginBottom: "24px" }}>
                        <p style={{ color: "#e74c3c", fontSize: "14px", fontWeight: "bold", margin: "0 0 8px 0" }}>⚠️ Missing Environment Variables</p>
                        {MISSING_ENV.map(k => (
                            <p key={k} style={{ color: "#e74c3c", fontSize: "12px", fontFamily: "monospace", margin: "2px 0" }}>• {k}</p>
                        ))}
                        <p style={{ color: "#aaa", fontSize: "11px", margin: "8px 0 0 0" }}>
                            Add these to your <code>.env</code> file or Vercel/Netlify dashboard, then redeploy.
                        </p>
                    </div>
                )}
                <div style={{ backgroundColor: T.card, borderRadius: "16px", padding: "40px", width: "100%", maxWidth: "380px", textAlign: "center", border: `1px solid ${T.border}` }}>
                    <h2 style={{ color: T.text, fontSize: "24px", marginBottom: "24px" }}>👋 உன் பேர் என்ன?</h2>
                    <input type="text" placeholder="உன் பேர் type பண்ணு..." value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && username.trim() && setNameSet(true)}
                        style={{ width: "100%", padding: "12px 16px", backgroundColor: T.card2, border: `1px solid ${T.border}`, borderRadius: "8px", color: T.text, fontSize: "16px", marginBottom: "16px", boxSizing: "border-box", outline: "none" }}
                        autoFocus />
                    <button onClick={() => username.trim() && setNameSet(true)}
                        style={{ width: "100%", padding: "14px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", fontSize: "16px", cursor: "pointer", fontWeight: "bold" }}>
                        🚀 Join Room
                    </button>
                </div>
            </div>
        );
    }

    if (!roomData) return <div style={{ backgroundColor: T.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: T.text, fontSize: "18px" }}><p>⏳ Room load ஆகுது...</p></div>;

    const movieUrl = roomData?.movieUrl || "";
    const movieType = roomData?.movieType || getMovieType(roomData, movieUrl);
    const youtubeId = getYouTubeId(movieUrl);
    const isYouTubeVideo = movieType === "youtube" || !!youtubeId;
    const hasMovieUrl = !!movieUrl;

    return (
        <div style={{ backgroundColor: T.bg, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
            <Toast toasts={toasts} />
            {showHistory && <WatchHistoryModal roomId={roomId} onClose={() => setShowHistory(false)} T={T} />}

            {isFullscreen && (
                <div style={{ position: "fixed", inset: 0, zIndex: 9000, pointerEvents: "none" }}>
                    <button onClick={() => setIsFullscreen(false)}
                        style={{ position: "absolute", top: "16px", left: "16px", padding: "8px 16px", backgroundColor: "rgba(0,0,0,0.75)", color: "white", border: "1px solid #555", borderRadius: "8px", cursor: "pointer", fontSize: "13px", zIndex: 9100, pointerEvents: "all" }}>
                        ✕ Exit
                    </button>
                    <div style={{ position: "absolute", bottom: "20px", left: "20px", display: "flex", gap: "8px", zIndex: 9100, pointerEvents: "all" }}>
                        {REACTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => sendReaction(emoji)}
                                style={{ fontSize: "24px", backgroundColor: "rgba(0,0,0,0.5)", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>{emoji}</button>
                        ))}
                    </div>
                    {!showVideoCall && (
                        <div style={{ position: "absolute", bottom: "24px", right: "24px", zIndex: 9100, pointerEvents: "all" }}>
                            <button onClick={startVideoCall}
                                style={{ padding: "10px 18px", backgroundColor: "#27ae60", color: "white", border: "none", borderRadius: "12px", cursor: "pointer", fontSize: "13px", fontWeight: "bold" }}>
                                📹 Face Cam Start
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── FIXED LAYOUT: reaction bar + toolbar heights known, player fills the rest ── */}
            <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", backgroundColor: T.bg }}>

                {/* ── PLAYER: fills all space above the two fixed bars ── */}
                <div
                    ref={playerContainerRef}
                    style={isFullscreen
                        ? { position: "fixed", inset: 0, zIndex: 8999, backgroundColor: "#000" }
                        : { flex: 1, backgroundColor: T.playerBg, position: "relative", overflow: "hidden", minHeight: 0 }
                    }
                >
                    {isYouTubeVideo && youtubeId ? (
                        <div style={{ width: "100%", height: "100%", position: "relative" }}>
                            <iframe ref={iframeRef}
                                src={getYouTubeSrc(youtubeId)}
                                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                onLoad={() => {
                                    console.log("[Watch Together] YouTube iframe loaded successfully");
                                    setTimeout(() => {
                                        if (!ytReadyRef.current) {
                                            ytReadyRef.current = true;
                                            const queue = pendingYtCmdRef.current;
                                            pendingYtCmdRef.current = [];
                                            queue.forEach(func => sendYtCmd(func));
                                        }
                                        if (isPlayingRef.current) setNeedsUserGesture(true);
                                    }, 1500);
                                }}
                                onError={(e) => {
                                    console.error("[Watch Together] YouTube iframe error:", e);
                                    showToast("YouTube video load ஆகல! URL சரியா check பண்ணு.", "❌", "#e74c3c");
                                }} />

                            {needsUserGesture && (
                                <div
                                    onClick={() => {
                                        setNeedsUserGesture(false);
                                        sendYtCmd("unMute");
                                        sendYtCmd("playVideo");
                                    }}
                                    style={{
                                        position: "absolute", inset: 0, zIndex: 20,
                                        backgroundColor: "rgba(0,0,0,0.65)",
                                        display: "flex", flexDirection: "column",
                                        alignItems: "center", justifyContent: "center",
                                        cursor: "pointer", gap: "12px",
                                    }}>
                                    <div style={{ fontSize: "56px" }}>▶️</div>
                                    <p style={{ color: "white", fontSize: "18px", fontWeight: "bold", margin: 0 }}>Tap to Sync & Play</p>
                                    <p style={{ color: "#aaa", fontSize: "13px", margin: 0 }}>Browser autoplay block — ஒரு click போதும்!</p>
                                </div>
                            )}

                            <div style={{ position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
                                <button onClick={() => {
                                    const p = !isPlaying;
                                    setIsPlaying(p);
                                    updatePlayState(p);
                                    sendYtCmd(p ? "playVideo" : "pauseVideo");
                                }}
                                    style={{ padding: "8px 24px", color: "white", border: "none", borderRadius: "20px", cursor: "pointer", fontSize: "14px", fontWeight: "bold", backgroundColor: isPlaying ? "#555" : "#ff6b35" }}>
                                    {isPlaying ? "⏸ Pause Sync" : "▶ Play Sync"}
                                </button>
                            </div>
                        </div>
                    ) : hasMovieUrl ? (
                        <video
                            ref={videoRef}
                            src={movieUrl}
                            controls
                            playsInline
                            style={{ width: "100%", height: "100%", backgroundColor: "#000" }}
                            onPlay={() => { if (joinedRef.current) updatePlayState(true, videoRef.current?.currentTime); }}
                            onPause={() => { if (joinedRef.current) updatePlayState(false, videoRef.current?.currentTime); }}
                            onSeeked={handleSeek}
                        />
                    ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "16px", padding: "20px" }}>
                            <span style={{ fontSize: "64px" }}>🎬</span>
                            <p style={{ color: T.text, fontSize: "18px", fontWeight: "bold", margin: 0, textAlign: "center" }}>Movie URL இல்ல!</p>
                            <p style={{ color: T.text2, fontSize: "14px", margin: 0, textAlign: "center" }}>Home page-ல போய் YouTube URL add பண்ணு</p>
                            <button onClick={() => navigate("/")}
                                style={{ padding: "12px 24px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "bold", marginTop: "8px" }}>
                                🏠 Home-க்கு போ
                            </button>
                        </div>
                    )}
                    {floatingReactions.map((r) => (
                        <div key={r.id} style={{ position: "absolute", bottom: "20px", left: r.x, fontSize: "40px", animation: "floatUp 3s ease-out forwards", pointerEvents: "none", zIndex: 10 }}>{r.emoji}</div>
                    ))}
                </div>

                {/* ── REACTION BAR ── */}
                <div style={{ flexShrink: 0, backgroundColor: T.reactionBg, padding: "6px 16px", display: "flex", gap: "6px", justifyContent: "center", alignItems: "center", borderTop: `1px solid ${T.border}` }}>
                    {REACTIONS.map((emoji) => (
                        <button key={emoji} onClick={() => sendReaction(emoji)}
                            style={{ fontSize: "26px", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>{emoji}</button>
                    ))}
                    <button onClick={() => sendReaction("🎬")} style={{ fontSize: "22px", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>🎬</button>
                    <button onClick={() => sendReaction("🥺")} style={{ fontSize: "22px", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>🥺</button>
                    <button onClick={() => sendReaction("💕")} style={{ fontSize: "22px", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>💕</button>
                </div>

                {/* ── TOOLBAR ── */}
                <div style={{ flexShrink: 0, backgroundColor: T.card, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px", borderTop: `1px solid ${T.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ color: T.text3, fontSize: "13px" }}>Room:</span>
                        <span style={{ color: "#ff6b35", fontSize: "13px", fontWeight: "bold" }}>{roomId}</span>
                        <span style={{ backgroundColor: "rgba(39,174,96,0.15)", color: "#27ae60", border: "1px solid rgba(39,174,96,0.3)", borderRadius: "10px", padding: "2px 8px", fontSize: "11px", fontWeight: "bold" }}>🔐 Encrypted</span>
                        {onlineUsers.filter(u => u !== username).map(u => (
                            <span key={u} style={{ display: "flex", alignItems: "center", gap: "4px", backgroundColor: "rgba(39,174,96,0.12)", border: "1px solid rgba(39,174,96,0.3)", borderRadius: "20px", padding: "2px 10px" }}>
                                <span style={{ width: "7px", height: "7px", backgroundColor: "#27ae60", borderRadius: "50%", display: "inline-block", animation: "pulse2 2s infinite" }} />
                                <span style={{ color: "#27ae60", fontSize: "11px", fontWeight: "bold" }}>{u} Online</span>
                            </span>
                        ))}
                        {onlineUsers.filter(u => u !== username).length === 0 && nameSet && (
                            <span style={{ display: "flex", alignItems: "center", gap: "4px", backgroundColor: "rgba(150,150,150,0.1)", border: "1px solid #333", borderRadius: "20px", padding: "2px 10px" }}>
                                <span style={{ width: "7px", height: "7px", backgroundColor: "#666", borderRadius: "50%", display: "inline-block" }} />
                                <span style={{ color: "#666", fontSize: "11px" }}>Partner Offline</span>
                            </span>
                        )}
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button onClick={showVideoCall ? endVideoCall : startVideoCall} disabled={callStatus === "calling"}
                            style={{ padding: "8px 14px", backgroundColor: showVideoCall ? "#e74c3c" : callStatus === "calling" ? "#666" : "#27ae60", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                            {showVideoCall ? "📵 Call End" : callStatus === "calling" ? "⏳ Calling..." : "📹 Video Call"}
                        </button>
                        <button onClick={() => setIsFullscreen(true)}
                            style={{ padding: "8px 14px", backgroundColor: "#8e44ad", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>⛶ Full Screen</button>
                        <button onClick={() => setShowHistory(true)}
                            style={{ padding: "8px 14px", backgroundColor: "#2980b9", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>🎬 History</button>
                        <button onClick={async () => {
                            const ok = await registerToken();
                            showToast(ok ? "🔔 Notifications ON!" : "🔕 Browser settings-ல allow பண்ணு", ok ? "🔔" : "🔕", ok ? "#27ae60" : "#e74c3c");
                        }}
                            style={{ padding: "8px 14px", backgroundColor: "#7f8c8d", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>🔔 Notify</button>
                        <button onClick={() => setIsDark(!isDark)}
                            style={{ padding: "8px 14px", backgroundColor: isDark ? "#f39c12" : "#2c3e50", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                            {isDark ? "☀️ Light" : "🌙 Dark"}
                        </button>
                        <button onClick={() => { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                            style={{ padding: "8px 14px", backgroundColor: T.card2, color: T.text, border: `1px solid ${T.border}`, borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                            {copied ? "✅ Copied!" : "🔗 Copy Link"}
                        </button>
                        <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`🎬 என்னோட கூட movie பாரு! ${window.location.href}`)}`, "_blank")}
                            style={{ padding: "8px 14px", backgroundColor: "#25D366", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>💬 WhatsApp</button>
                        <button onClick={() => setShowChat(!showChat)}
                            style={{ padding: "8px 14px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                            {showChat ? "💬 Hide Chat" : (
                                <>💬 Chat{unreadCount > 0 && <span style={{ marginLeft: "6px", backgroundColor: "#e74c3c", color: "white", borderRadius: "50%", padding: "1px 6px", fontSize: "11px", fontWeight: "bold" }}>{unreadCount}</span>}</>
                            )}
                        </button>
                    </div>
                </div>

                {/* Bottom Sheet Chat */}
                {showChat && (
                    <>
                        <div onClick={() => setShowChat(false)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: "50vh", zIndex: 499, backgroundColor: "rgba(0,0,0,0.4)" }} />
                        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 500, display: "flex", flexDirection: "column", height: "50vh", backgroundColor: T.card, borderTop: "2px solid #ff6b35", borderRadius: "20px 20px 0 0", boxShadow: "0 -4px 32px rgba(0,0,0,0.5)", animation: "slideUp 0.25s ease" }}>
                            {/* Drag handle */}
                            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px 0", cursor: "pointer" }} onClick={() => setShowChat(false)}>
                                <div style={{ width: "40px", height: "4px", backgroundColor: "#444", borderRadius: "2px" }} />
                            </div>
                            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <span style={{ color: T.text, fontWeight: "bold", fontSize: "14px" }}>💬 Chat</span>
                                    <span style={{ backgroundColor: "rgba(39,174,96,0.15)", color: "#27ae60", border: "1px solid rgba(39,174,96,0.3)", borderRadius: "8px", padding: "1px 7px", fontSize: "10px", fontWeight: "bold" }}>🔐 E2E</span>
                                    {onlineUsers.filter(u => u !== username).length > 0 ? (
                                        <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                            <span style={{ width: "7px", height: "7px", backgroundColor: "#27ae60", borderRadius: "50%", display: "inline-block", animation: "pulse2 2s infinite" }} />
                                            <span style={{ color: "#27ae60", fontSize: "10px", fontWeight: "bold" }}>Online</span>
                                        </span>
                                    ) : (
                                        <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                            <span style={{ width: "7px", height: "7px", backgroundColor: "#555", borderRadius: "50%", display: "inline-block" }} />
                                            <span style={{ color: "#555", fontSize: "10px" }}>Offline</span>
                                        </span>
                                    )}
                                </div>
                                <span style={{ color: "#ff6b35", fontSize: "13px" }}>👤 {username}</span>
                            </div>

                            <div ref={chatScrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                                {messages.length === 0 && <p style={{ color: T.text3, textAlign: "center", fontSize: "13px" }}>message இல்ல - first message பண்ணு! 👋</p>}
                                {messages.map((msg) => {
                                    const isMe = msg.username === username;
                                    const isRead = (msg.readBy || []).length > 1;
                                    return (
                                        <div key={msg.id}
                                            style={{ maxWidth: "85%", alignSelf: isMe ? "flex-end" : "flex-start", display: "flex", flexDirection: "column", gap: "2px", position: "relative" }}
                                            onContextMenu={(e) => { e.preventDefault(); if (msg.type !== "voice") setReplyTo({ id: msg.id, username: msg.username, message: msg.message }); }}
                                            onClick={() => { if (msg.type !== "voice") setReplyTo({ id: msg.id, username: msg.username, message: msg.message }); }}>
                                            {/* Edit/Delete actions for own messages */}
                                            {isMe && msg.type !== "voice" && (
                                                <div style={{ display: "flex", gap: "4px", alignSelf: "flex-end", marginBottom: "2px" }}>
                                                    <button onClick={(e) => { e.stopPropagation(); setEditingMsg({ id: msg.id, message: msg.message }); setNewMessage(msg.message); }}
                                                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: T.text3, padding: "2px 4px", borderRadius: "4px" }}
                                                        title="Edit">✏️</button>
                                                    <button onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this message?")) deleteMessage(msg.id); }}
                                                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: T.text3, padding: "2px 4px", borderRadius: "4px" }}
                                                        title="Delete">🗑️</button>
                                                </div>
                                            )}
                                            {msg.replyToMessageDecrypted && (
                                                <div style={{ backgroundColor: isMe ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.1)", borderLeft: "3px solid #ff6b35", borderRadius: "6px", padding: "4px 8px", marginBottom: "2px" }}>
                                                    <p style={{ color: isMe ? "rgba(255,255,255,0.7)" : T.text2, fontSize: "10px", margin: "0 0 2px 0", fontWeight: "bold" }}>↩ {msg.replyToUsername}</p>
                                                    <p style={{ color: isMe ? "rgba(255,255,255,0.6)" : T.text3, fontSize: "11px", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}>{msg.replyToMessageDecrypted}</p>
                                                </div>
                                            )}
                                            <div style={{ padding: "8px 12px", borderRadius: "12px", display: "flex", flexDirection: "column", backgroundColor: isMe ? "#ff6b35" : T.card2, cursor: "pointer", transition: "opacity 0.15s" }}
                                                onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                                                onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
                                                {!isMe && <p style={{ color: T.text2, fontSize: "11px", margin: "0 0 4px 0" }}>{msg.username}</p>}
                                                {msg.type === "voice" && msg.voiceUrl ? (
                                                    <div>
                                                        <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "11px", margin: "0 0 4px 0" }}>🎙️ Voice message</p>
                                                        <audio src={msg.voiceUrl} controls style={{ width: "180px", height: "28px" }} />
                                                    </div>
                                                ) : (
                                                    <p style={{ color: "white", fontSize: "14px", margin: 0, wordBreak: "break-word" }}>{msg.message}</p>
                                                )}
                                                {isMe && (
                                                    <span style={{ alignSelf: "flex-end", marginTop: "2px", fontSize: "11px", color: isRead ? "#a8e6cf" : "rgba(255,255,255,0.5)" }}>
                                                        {msg.editedAt && <span style={{ fontSize: "10px", marginRight: "4px", opacity: 0.7 }}>edited</span>}
                                                        {isRead ? "✓✓" : "✓"}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {partnerTyping && (
                                    <div style={{ alignSelf: "flex-start", backgroundColor: T.card2, padding: "8px 14px", borderRadius: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                                        <span style={{ color: T.text2, fontSize: "12px" }}>type பண்றாங்க</span>
                                        <span style={{ display: "flex", gap: "3px" }}>
                                            {[0, 1, 2].map(i => <span key={i} style={{ width: "6px", height: "6px", backgroundColor: "#ff6b35", borderRadius: "50%", display: "inline-block", animation: `typingDot 1.2s ${i * 0.2}s infinite` }} />)}
                                        </span>
                                    </div>
                                )}
                                <div ref={chatEndRef} />
                            </div>

                            {showVoiceRecorder && (
                                <VoiceRecorder onSend={handleVoiceSend} onCancel={() => setShowVoiceRecorder(false)} T={T} />
                            )}

                            {!showVoiceRecorder && (
                                <div style={{ borderTop: `1px solid ${T.border}` }}>
                                    {/* Edit mode bar */}
                                    {editingMsg && (
                                        <div style={{ padding: "6px 12px", backgroundColor: "rgba(52,152,219,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${T.border}`, borderLeft: "3px solid #3498db" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
                                                <span style={{ fontSize: "13px" }}>✏️</span>
                                                <p style={{ color: "#3498db", fontSize: "11px", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Editing message</p>
                                            </div>
                                            <button onClick={() => { setEditingMsg(null); setNewMessage(""); }}
                                                style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: "16px", padding: "0 4px", flexShrink: 0 }}>✕</button>
                                        </div>
                                    )}
                                    {replyTo && !editingMsg && (
                                        <div style={{ padding: "6px 12px", backgroundColor: T.card2, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${T.border}` }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
                                                <span style={{ color: "#ff6b35", fontSize: "12px" }}>↩</span>
                                                <div style={{ minWidth: 0 }}>
                                                    <p style={{ color: "#ff6b35", fontSize: "10px", margin: 0, fontWeight: "bold" }}>{replyTo.username}</p>
                                                    <p style={{ color: T.text2, fontSize: "11px", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{replyTo.message}</p>
                                                </div>
                                            </div>
                                            <button onClick={() => setReplyTo(null)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: "16px", padding: "0 4px", flexShrink: 0 }}>✕</button>
                                        </div>
                                    )}
                                    <div style={{ padding: "12px", display: "flex", gap: "6px", position: "relative" }}>
                                        {showEmojiPicker && (
                                            <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
                                        )}
                                        <button onClick={() => setShowEmojiPicker(p => !p)}
                                            style={{ padding: "10px", backgroundColor: showEmojiPicker ? "#ff6b35" : T.card2, border: `1px solid ${T.border}`, borderRadius: "8px", cursor: "pointer", fontSize: "16px", flexShrink: 0 }}>😊</button>
                                        <input type="text"
                                            placeholder={editingMsg ? "Edit message..." : replyTo ? "↩ Replying..." : "Message type பண்ணு..."}
                                            value={newMessage}
                                            onChange={handleTyping}
                                            onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); if (e.key === "Escape") { setEditingMsg(null); setNewMessage(""); setReplyTo(null); } }}
                                            style={{ flex: 1, padding: "10px 12px", backgroundColor: T.card2, border: `1px solid ${editingMsg ? "#3498db" : replyTo ? "#ff6b35" : T.border}`, borderRadius: "8px", color: T.text, fontSize: "14px", outline: "none", minWidth: 0 }} />
                                        <button onClick={() => setShowVoiceRecorder(true)}
                                            style={{ padding: "10px", backgroundColor: T.card2, border: `1px solid ${T.border}`, borderRadius: "8px", cursor: "pointer", fontSize: "16px", flexShrink: 0 }}>🎙️</button>
                                        <button onClick={() => sendMessage()}
                                            style={{ padding: "10px 14px", backgroundColor: editingMsg ? "#3498db" : "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "16px", flexShrink: 0 }}>
                                            {editingMsg ? "💾" : "➤"}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}

            </div>

            {incomingCall && (
                <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ backgroundColor: T.card, borderRadius: "20px", border: "2px solid #27ae60", padding: "40px", textAlign: "center", animation: "pulse 1.5s infinite" }}>
                        <div style={{ fontSize: "56px", marginBottom: "8px" }}>📹</div>
                        <p style={{ color: T.text, fontSize: "20px", fontWeight: "bold", margin: "0 0 8px 0" }}>Incoming Video Call!</p>
                        <p style={{ color: T.text2, fontSize: "14px", margin: "0 0 28px 0" }}>{callerName} call பண்றாங்க... 💕</p>
                        <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
                            <button onClick={acceptCall} style={{ padding: "14px 32px", backgroundColor: "#27ae60", color: "white", border: "none", borderRadius: "12px", fontSize: "16px", cursor: "pointer", fontWeight: "bold" }}>✅ Accept</button>
                            <button onClick={rejectCall} style={{ padding: "14px 32px", backgroundColor: "#e74c3c", color: "white", border: "none", borderRadius: "12px", fontSize: "16px", cursor: "pointer", fontWeight: "bold" }}>❌ Reject</button>
                        </div>
                    </div>
                </div>
            )}

            {acceptLoading && (
                <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ backgroundColor: T.card, borderRadius: "20px", border: "2px solid #ff6b35", padding: "40px", textAlign: "center" }}>
                        <div style={{ fontSize: "48px", marginBottom: "12px" }}>⏳</div>
                        <p style={{ color: T.text, fontSize: "18px", fontWeight: "bold", margin: "0 0 8px 0" }}>Call connect ஆகுது...</p>
                        <p style={{ color: T.text2, fontSize: "13px", margin: "0 0 20px 0" }}>சில seconds wait பண்ணு 🙏</p>
                        <div style={{ width: "40px", height: "40px", border: "3px solid #333", borderTop: "3px solid #ff6b35", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
                    </div>
                </div>
            )}

            {showVideoCall && livekitToken && (
                <Suspense fallback={null}>
                    <VideoCallRoom
                        token={livekitToken}
                        serverUrl={import.meta.env.VITE_LIVEKIT_URL}
                        isFullscreen={isFullscreen}
                        onEnd={endVideoCall}
                    />
                </Suspense>
            )}

            <style>{`
                @keyframes floatUp { 0%{transform:translateY(0) scale(1);opacity:1} 100%{transform:translateY(-300px) scale(1.5);opacity:0} }
                @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
                @keyframes pulse { 0%,100%{box-shadow:0 8px 40px rgba(39,174,96,0.3)} 50%{box-shadow:0 8px 60px rgba(39,174,96,0.6)} }
                @keyframes pulse2 { 0%,100%{opacity:1} 50%{opacity:0.3} }
                @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
                @keyframes slideIn { from{transform:translateX(100px);opacity:0} to{transform:translateX(0);opacity:1} }
                @keyframes typingDot { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
            `}</style>
        </div>
    );
}

export default Room;