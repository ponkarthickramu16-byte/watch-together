import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import {
    collection, query, where, onSnapshot,
    updateDoc, doc, addDoc, orderBy, arrayUnion,
} from "firebase/firestore";
import {
    LiveKitRoom,
    useLocalParticipant,
    useRemoteParticipants,
    RoomAudioRenderer,
} from "@livekit/components-react";
import "@livekit/components-styles";

const REACTIONS = ["❤️", "😂", "😮", "🔥", "👏", "😢"];

const EMOJI_CATEGORIES = [
    { label: "❤️ Love", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "😍", "🥰", "😘", "💏", "👫"] },
    { label: "😂 Funny", emojis: ["😂", "🤣", "😆", "😅", "😄", "😁", "😀", "🤩", "😜", "😝", "🤪", "😋", "🤭", "😏", "🙃", "😌", "🤗", "🫠", "😇", "🥳"] },
    { label: "😮 React", emojis: ["😮", "😲", "🤯", "😱", "😳", "🥺", "😢", "😭", "😤", "😡", "🤬", "😤", "💀", "🫡", "🤔", "🧐", "😐", "🫤", "😶", "🤐"] },
    { label: "🔥 Hype", emojis: ["🔥", "⚡", "💥", "✨", "🌟", "💫", "🎉", "🎊", "🎈", "🏆", "👑", "💎", "🚀", "🌈", "🎯", "💯", "✅", "👍", "🙌", "👏"] },
    { label: "🍿 Movie", emojis: ["🍿", "🎬", "🎥", "🎞️", "📽️", "🎭", "🎪", "🎨", "🎮", "🕹️", "📺", "📻", "🎵", "🎶", "🎸", "🎤", "🎧", "🥤", "🍔", "🍕"] },
    { label: "💬 Chat", emojis: ["👋", "🤝", "🫶", "🤞", "✌️", "🤙", "👉", "💪", "🙏", "🫂", "👀", "💭", "💬", "📩", "📱", "🔔", "⏰", "🗓️", "📌", "🔑"] },
];

const getYouTubeId = (url) => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
};

// ============================================================
// ✅ AES-GCM ENCRYPTION HELPERS
// Key = roomId (same for everyone in room, nobody outside knows)
// Firestore-ல ciphertext மட்டும் store ஆகும்
// ============================================================
const getCryptoKey = async (roomId) => {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        encoder.encode(roomId.padEnd(32, "0").substring(0, 32)), // 32 bytes = 256 bit
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: encoder.encode("watch-together-salt"), iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
};

const encryptMessage = async (text, roomId) => {
    try {
        const key = await getCryptoKey(roomId);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const cipher = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
        // Combine iv + ciphertext → base64
        const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(cipher), iv.byteLength);
        return btoa(String.fromCharCode(...combined));
    } catch {
        return text; // fallback - plain text
    }
};

const decryptMessage = async (cipherB64, roomId) => {
    try {
        const key = await getCryptoKey(roomId);
        const combined = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
        const iv = combined.slice(0, 12);
        const cipher = combined.slice(12);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
        return new TextDecoder().decode(decrypted);
    } catch {
        return cipherB64; // fallback - return as-is (old unencrypted messages)
    }
};

// ============================================================

// ✅ Toast
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

// ✅ Emoji Picker
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

// ✅ Voice Recorder
function VoiceRecorder({ onSend, onCancel, T }) {
    const [recording, setRecording] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [audioBlob, setAudioBlob] = useState(null);
    const [audioUrl, setAudioUrl] = useState(null);
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const timerRef = useRef(null);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mr = new MediaRecorder(stream);
            mediaRecorderRef.current = mr;
            chunksRef.current = [];
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
        setAudioBlob(null); setAudioUrl(null); setSeconds(0); onCancel();
    };

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

// ✅ LocalVideo
function LocalVideo({ small }) {
    const videoRef = useRef(null);
    const { localParticipant } = useLocalParticipant();
    const attachedRef = useRef(false);
    useEffect(() => {
        if (!localParticipant) return;
        attachedRef.current = false;
        const tryAttach = () => {
            if (attachedRef.current || !videoRef.current) return;
            for (const pub of localParticipant.videoTrackPublications.values()) {
                const track = pub.videoTrack ?? pub.track;
                if (track) { track.attach(videoRef.current); attachedRef.current = true; return; }
            }
        };
        tryAttach();
        const iv = setInterval(tryAttach, 800);
        setTimeout(() => clearInterval(iv), 15000);
        localParticipant.on("localTrackPublished", tryAttach);
        localParticipant.on("trackPublished", tryAttach);
        return () => {
            clearInterval(iv);
            localParticipant.off("localTrackPublished", tryAttach);
            localParticipant.off("trackPublished", tryAttach);
            try { for (const pub of localParticipant.videoTrackPublications.values()) { const track = pub.videoTrack ?? pub.track; if (track && videoRef.current) track.detach(videoRef.current); } } catch { }
            attachedRef.current = false;
        };
    }, [localParticipant?.sid]);
    const w = small ? "110px" : "175px"; const h = small ? "82px" : "130px";
    return (
        <div style={{ textAlign: "center" }}>
            {!small && <p style={{ color: "#ff6b35", fontSize: "11px", margin: "0 0 4px 0" }}>நீ 🟠</p>}
            <div style={{ position: "relative", width: w, height: h, borderRadius: "10px", overflow: "hidden", border: "2px solid #ff6b35", backgroundColor: "#111" }}>
                <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                <div style={{ position: "absolute", bottom: "3px", left: "5px", color: "white", fontSize: "9px", backgroundColor: "rgba(0,0,0,0.6)", padding: "1px 4px", borderRadius: "3px" }}>நீ 🟠</div>
            </div>
        </div>
    );
}

// ✅ RemoteVideo
function RemoteVideo({ small }) {
    const videoRef = useRef(null);
    const remoteParticipants = useRemoteParticipants();
    const remoteParticipant = remoteParticipants[0];
    const attachedRef = useRef(false);
    useEffect(() => {
        if (!remoteParticipant) return;
        attachedRef.current = false;
        const tryAttach = () => {
            if (attachedRef.current || !videoRef.current) return;
            for (const pub of remoteParticipant.videoTrackPublications.values()) {
                const track = pub.videoTrack ?? pub.track;
                if (track && pub.isSubscribed) { track.attach(videoRef.current); attachedRef.current = true; return; }
            }
        };
        tryAttach();
        const iv = setInterval(tryAttach, 800);
        setTimeout(() => clearInterval(iv), 20000);
        remoteParticipant.on("trackSubscribed", tryAttach);
        remoteParticipant.on("trackPublished", tryAttach);
        return () => {
            clearInterval(iv);
            remoteParticipant.off("trackSubscribed", tryAttach);
            remoteParticipant.off("trackPublished", tryAttach);
            try { for (const pub of remoteParticipant.videoTrackPublications.values()) { const track = pub.videoTrack ?? pub.track; if (track && videoRef.current) track.detach(videoRef.current); } } catch { }
            attachedRef.current = false;
        };
    }, [remoteParticipant?.sid]);
    const w = small ? "110px" : "175px"; const h = small ? "82px" : "130px";
    return (
        <div style={{ textAlign: "center" }}>
            {!small && <p style={{ color: "#27ae60", fontSize: "11px", margin: "0 0 4px 0" }}>Partner 🟢</p>}
            <div style={{ position: "relative", width: w, height: h, borderRadius: "10px", overflow: "hidden", border: "2px solid #27ae60", backgroundColor: "#111" }}>
                {remoteParticipant ? (
                    <video ref={videoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: "22px" }}>👤</span></div>
                )}
                <div style={{ position: "absolute", bottom: "3px", left: "5px", color: "white", fontSize: "9px", backgroundColor: "rgba(0,0,0,0.6)", padding: "1px 4px", borderRadius: "3px" }}>
                    {remoteParticipant ? `${remoteParticipant.identity} 🟢` : "காத்திருக்கோம்"}
                </div>
            </div>
        </div>
    );
}

// ✅ Fullscreen face bar
function FullscreenFaceBar({ onEnd, isMuted, isCamOff, onToggleMic, onToggleCam }) {
    return (
        <div style={{ position: "absolute", bottom: "24px", right: "24px", display: "flex", flexDirection: "column", gap: "8px", zIndex: 9500, alignItems: "flex-end" }}>
            <div style={{ display: "flex", gap: "6px" }}><LocalVideo small /><RemoteVideo small /></div>
            <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={onToggleMic} style={{ padding: "6px 12px", color: "white", border: "none", borderRadius: "16px", cursor: "pointer", fontSize: "12px", backgroundColor: isMuted ? "#e74c3c" : "rgba(0,0,0,0.75)" }}>{isMuted ? "🔇" : "🎤"}</button>
                <button onClick={onToggleCam} style={{ padding: "6px 12px", color: "white", border: "none", borderRadius: "16px", cursor: "pointer", fontSize: "12px", backgroundColor: isCamOff ? "#e74c3c" : "rgba(0,0,0,0.75)" }}>{isCamOff ? "📷" : "📸"}</button>
                <button onClick={onEnd} style={{ padding: "6px 12px", color: "white", border: "none", borderRadius: "16px", cursor: "pointer", fontSize: "12px", backgroundColor: "#e74c3c" }}>📵</button>
            </div>
        </div>
    );
}

function NormalCallPopup({ onEnd, isMuted, isCamOff, onToggleMic, onToggleCam }) {
    const [pos, setPos] = useState({ x: window.innerWidth - 430, y: window.innerHeight - 420 });
    const dragging = useRef(false); const offset = useRef({ x: 0, y: 0 });
    useEffect(() => {
        const onMM = (e) => { if (!dragging.current) return; setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y }); };
        const onMU = () => { dragging.current = false; };
        const onTM = (e) => { if (!dragging.current) return; setPos({ x: e.touches[0].clientX - offset.current.x, y: e.touches[0].clientY - offset.current.y }); };
        const onTE = () => { dragging.current = false; };
        window.addEventListener("mousemove", onMM); window.addEventListener("mouseup", onMU);
        window.addEventListener("touchmove", onTM); window.addEventListener("touchend", onTE);
        return () => { window.removeEventListener("mousemove", onMM); window.removeEventListener("mouseup", onMU); window.removeEventListener("touchmove", onTM); window.removeEventListener("touchend", onTE); };
    }, []);
    return (
        <div style={{ position: "fixed", left: pos.x, top: pos.y, width: "390px", backgroundColor: "#1a1a1a", borderRadius: "16px", border: "2px solid #27ae60", zIndex: 9999, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.9)", userSelect: "none" }}>
            <div onMouseDown={(e) => { dragging.current = true; offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; }}
                onTouchStart={(e) => { dragging.current = true; offset.current = { x: e.touches[0].clientX - pos.x, y: e.touches[0].clientY - pos.y }; }}
                style={{ padding: "10px 16px", backgroundColor: "#111", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #333", cursor: "grab" }}>
                <span style={{ color: "#555", fontSize: "12px" }}>⠿ Drag</span>
                <span style={{ color: "white", fontSize: "13px", fontWeight: "bold" }}>📹 Video Call</span>
                <button onClick={onEnd} style={{ padding: "4px 10px", backgroundColor: "#e74c3c", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}>📵</button>
            </div>
            <div style={{ padding: "12px", display: "flex", gap: "10px", justifyContent: "center" }}><LocalVideo /><RemoteVideo /></div>
            <div style={{ padding: "10px 12px", borderTop: "1px solid #333", display: "flex", gap: "8px", justifyContent: "center" }}>
                <button onClick={onToggleMic} style={{ padding: "8px 14px", color: "white", border: "1px solid #444", borderRadius: "8px", cursor: "pointer", fontSize: "12px", backgroundColor: isMuted ? "#e74c3c" : "#2a2a2a" }}>{isMuted ? "🔇 Muted" : "🎤 Mic On"}</button>
                <button onClick={onToggleCam} style={{ padding: "8px 14px", color: "white", border: "1px solid #444", borderRadius: "8px", cursor: "pointer", fontSize: "12px", backgroundColor: isCamOff ? "#e74c3c" : "#2a2a2a" }}>{isCamOff ? "📷 Cam Off" : "📸 Cam On"}</button>
                <button onClick={onEnd} style={{ padding: "8px 14px", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "12px", backgroundColor: "#e74c3c" }}>📵 End</button>
            </div>
        </div>
    );
}

function CallUI({ isFullscreen, onEnd }) {
    const { localParticipant } = useLocalParticipant();
    const [isMuted, setIsMuted] = useState(false); const [isCamOff, setIsCamOff] = useState(false);
    const toggleMic = async () => { if (localParticipant) { await localParticipant.setMicrophoneEnabled(isMuted); setIsMuted(!isMuted); } };
    const toggleCam = async () => { if (localParticipant) { await localParticipant.setCameraEnabled(isCamOff); setIsCamOff(!isCamOff); } };
    return isFullscreen
        ? <FullscreenFaceBar onEnd={onEnd} isMuted={isMuted} isCamOff={isCamOff} onToggleMic={toggleMic} onToggleCam={toggleCam} />
        : <NormalCallPopup onEnd={onEnd} isMuted={isMuted} isCamOff={isCamOff} onToggleMic={toggleMic} onToggleCam={toggleCam} />;
}

// ✅ Watch History Modal
function WatchHistoryModal({ roomId, onClose, T }) {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const q = query(collection(db, "watchHistory"), where("roomId", "==", roomId), orderBy("watchedAt", "desc"));
        return onSnapshot(q, (snap) => { setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); });
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
                    {!loading && history.length === 0 && <p style={{ color: T.text3, textAlign: "center", padding: "20px" }}>இன்னும் எந்த movie-உம் பார்க்கல 🍿</p>}
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
    const [roomData, setRoomData] = useState(null);
    const [roomDocId, setRoomDocId] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [copied, setCopied] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
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
    const [toasts, setToasts] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [partnerTyping, setPartnerTyping] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);

    const prevParticipantsRef = useRef([]);
    const iframeRef = useRef(null);
    const videoRef = useRef(null);
    const chatEndRef = useRef(null);
    const usernameRef = useRef("");
    const isSyncingSeekRef = useRef(false);
    const typingTimeoutRef = useRef(null);
    const historyLoggedRef = useRef(false);

    useEffect(() => { usernameRef.current = username; }, [username]);
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

    const showToast = useCallback((message, icon = "🔔", color = "#27ae60") => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, icon, color }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
    }, []);

    // Screenshot block
    useEffect(() => {
        const style = document.createElement("style");
        style.id = "screenshot-block";
        style.textContent = `* { -webkit-user-select: none !important; user-select: none !important; } input, textarea { -webkit-user-select: text !important; user-select: text !important; }`;
        document.head.appendChild(style);
        const blockPrint = (e) => {
            if (e.key === "PrintScreen") { e.preventDefault(); navigator.clipboard.writeText("").catch(() => { }); showToast("Screenshot block! 🚫", "🚫", "#e74c3c"); }
            if (e.ctrlKey && e.shiftKey && e.key === "S") { e.preventDefault(); showToast("Screenshot block! 🚫", "🚫", "#e74c3c"); }
        };
        window.addEventListener("keydown", blockPrint);
        return () => { document.getElementById("screenshot-block")?.remove(); window.removeEventListener("keydown", blockPrint); };
    }, [showToast]);

    useEffect(() => {
        const fn = (e) => { if (e.key === "Escape") { setIsFullscreen(false); setShowEmojiPicker(false); } };
        window.addEventListener("keydown", fn);
        return () => window.removeEventListener("keydown", fn);
    }, []);

    useEffect(() => {
        if (!iframeRef.current) return;
        try { iframeRef.current.contentWindow.postMessage(JSON.stringify({ event: "command", func: showVideoCall ? "mute" : "unMute", args: [] }), "*"); } catch { }
    }, [showVideoCall]);

    // Room sync
    useEffect(() => {
        const q = query(collection(db, "rooms"), where("roomId", "==", roomId));
        return onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const docData = snapshot.docs[0];
                setRoomDocId(docData.id);
                const data = docData.data();
                setRoomData(data);
                if (!isSyncing) setIsPlaying(data.isPlaying);
                if (videoRef.current && data.currentTime !== undefined && !isSyncingSeekRef.current) {
                    const diff = Math.abs(videoRef.current.currentTime - data.currentTime);
                    if (diff > 2) videoRef.current.currentTime = data.currentTime;
                }
                if (videoRef.current && !isSyncing) {
                    if (data.isPlaying && videoRef.current.paused) videoRef.current.play().catch(() => { });
                    else if (!data.isPlaying && !videoRef.current.paused) videoRef.current.pause();
                }
            }
        });
    }, [roomId, isSyncing]);

    // Call + join + typing
    useEffect(() => {
        if (!roomDocId || !nameSet) return;
        return onSnapshot(doc(db, "rooms", roomDocId), (snap) => {
            const data = snap.data(); if (!data) return;
            const me = usernameRef.current;
            if (data.callStatus === "calling" && data.callBy !== me) { setCallerName(data.callBy || "Partner"); setIncomingCall(true); }
            if (data.callStatus === "ended" && data.callBy !== me) { setIncomingCall(false); setCallStatus(null); setShowVideoCall(false); setLivekitToken(null); }
            if (data.participants && Array.isArray(data.participants)) {
                const prev = prevParticipantsRef.current;
                const newOnes = data.participants.filter(p => p !== me && !prev.includes(p));
                newOnes.forEach(p => showToast(`${p} join ஆனாங்க! 🎉`, "💚", "#27ae60"));
                prevParticipantsRef.current = data.participants;
            }
            if (data.typing && data.typing !== me) {
                setPartnerTyping(true);
                clearTimeout(typingTimeoutRef.current);
                typingTimeoutRef.current = setTimeout(() => setPartnerTyping(false), 3000);
            } else if (!data.typing || data.typing === me) {
                setPartnerTyping(false);
                clearTimeout(typingTimeoutRef.current);
            }
        });
    }, [roomDocId, nameSet, showToast]);

    // ✅ Chat - decrypt messages on receive
    useEffect(() => {
        const q = query(collection(db, "chats"), where("roomId", "==", roomId), orderBy("createdAt", "asc"));
        return onSnapshot(q, async (snap) => {
            const rawMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Decrypt all messages in parallel
            const decrypted = await Promise.all(rawMsgs.map(async (msg) => {
                if (msg.type === "voice") return msg; // voice messages not encrypted (URL only)
                if (!msg.message) return msg;
                const plain = await decryptMessage(msg.message, roomId);
                return { ...msg, message: plain };
            }));
            setMessages(decrypted);
        });
    }, [roomId]);

    // Reactions
    useEffect(() => {
        const q = query(collection(db, "reactions"), where("roomId", "==", roomId), orderBy("createdAt", "asc"));
        return onSnapshot(q, (snap) => {
            snap.docChanges().forEach(change => {
                if (change.type === "added") {
                    const { emoji } = change.doc.data(); const id = change.doc.id;
                    setFloatingReactions(prev => [...prev, { id, emoji, x: Math.random() * 70 + 10 }]);
                    setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 3000);
                }
            });
        });
    }, [roomId]);

    // Register participant
    useEffect(() => {
        if (!roomDocId || !username) return;
        updateDoc(doc(db, "rooms", roomDocId), { participants: arrayUnion(username) }).catch(() => { });
    }, [roomDocId, username]);

    // Watch history
    const saveWatchHistory = useCallback(async (docId, data, user) => {
        if (!docId || !data?.movieUrl || !user) return;
        try {
            await addDoc(collection(db, "watchHistory"), {
                roomId, movieUrl: data.movieUrl,
                movieType: data.movieType || (getYouTubeId(data.movieUrl) ? "youtube" : "upload"),
                movieTitle: getYouTubeId(data.movieUrl) ? `YouTube: ${getYouTubeId(data.movieUrl)}` : data.movieUrl.split("/").pop() || "Movie",
                watchedBy: user, watchedAt: new Date(),
            });
        } catch { }
    }, [roomId]);

    useEffect(() => {
        if (isPlaying && roomDocId && roomData?.movieUrl && username && !historyLoggedRef.current) {
            historyLoggedRef.current = true;
            saveWatchHistory(roomDocId, roomData, username);
        }
        if (!isPlaying) historyLoggedRef.current = false;
    }, [isPlaying, roomDocId, roomData, username, saveWatchHistory]);

    const updatePlayState = async (playing, time) => {
        if (!roomDocId) return;
        setIsSyncing(true);
        const update = { isPlaying: playing };
        if (time !== undefined) update.currentTime = time;
        await updateDoc(doc(db, "rooms", roomDocId), update);
        setTimeout(() => setIsSyncing(false), 1000);
    };

    const handleSeek = async () => {
        if (!videoRef.current || !roomDocId) return;
        isSyncingSeekRef.current = true;
        await updateDoc(doc(db, "rooms", roomDocId), { currentTime: videoRef.current.currentTime });
        setTimeout(() => { isSyncingSeekRef.current = false; }, 1500);
    };

    const handleTyping = async (e) => {
        setNewMessage(e.target.value);
        if (!roomDocId) return;
        await updateDoc(doc(db, "rooms", roomDocId), { typing: username }).catch(() => { });
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(async () => {
            await updateDoc(doc(db, "rooms", roomDocId), { typing: "" }).catch(() => { });
        }, 2000);
    };

    const fetchToken = async () => {
        const url = `/api/token?roomName=room-${roomId}&participantName=${encodeURIComponent(username)}`;
        const r = await fetch(url);
        if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || "Token fetch failed"); }
        const d = await r.json();
        if (!d.token) throw new Error("No token received");
        return d.token;
    };

    const startVideoCall = async () => {
        try {
            setCallStatus("calling");
            if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "calling", callBy: username });
            const token = await fetchToken();
            setLivekitToken(token); setShowVideoCall(true); setCallStatus("in-call");
        } catch (err) { setCallStatus(null); alert("Video call start ஆகல: " + err.message); }
    };

    const acceptCall = async () => {
        setIncomingCall(false); setAcceptLoading(true); setCallStatus("in-call");
        try {
            if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "in-call" });
            const token = await fetchToken();
            setLivekitToken(token); setShowVideoCall(true);
        } catch (err) { setCallStatus(null); alert("❌ Call accept ஆகல: " + err.message); }
        finally { setAcceptLoading(false); }
    };

    const rejectCall = async () => { setIncomingCall(false); if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "ended", callBy: username }); };
    const endVideoCall = async () => { setShowVideoCall(false); setLivekitToken(null); setCallStatus(null); if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "ended", callBy: username }); };
    const sendReaction = async (emoji) => { await addDoc(collection(db, "reactions"), { roomId, emoji, username, createdAt: new Date() }); };
    const handleEmojiSelect = (emoji) => { setNewMessage(prev => prev + emoji); };

    // ✅ Send message - ENCRYPTED
    const sendMessage = async (msg) => {
        const text = msg || newMessage.trim();
        if (!text) return;
        if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { typing: "" }).catch(() => { });
        clearTimeout(typingTimeoutRef.current);
        // Encrypt before storing
        const encrypted = await encryptMessage(text, roomId);
        await addDoc(collection(db, "chats"), { roomId, username, message: encrypted, createdAt: new Date() });
        if (!msg) setNewMessage("");
    };

    // ✅ Voice message send
    const handleVoiceSend = async (audioBlob, duration) => {
        setShowVoiceRecorder(false);
        try {
            showToast("Voice message upload ஆகுது...", "🎙️", "#8e44ad");
            const formData = new FormData();
            formData.append("file", audioBlob, "voice.webm");
            formData.append("upload_preset", import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
            formData.append("folder", "voice-messages");
            formData.append("resource_type", "video");
            const res = await fetch(`https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/video/upload`, { method: "POST", body: formData });
            const data = await res.json();
            if (!data.secure_url) throw new Error("Upload failed");
            // Voice label also encrypted
            const encLabel = await encryptMessage(`🎙️ Voice message (${duration}s)`, roomId);
            await addDoc(collection(db, "chats"), {
                roomId, username,
                message: encLabel,
                voiceUrl: data.secure_url,
                type: "voice",
                createdAt: new Date(),
            });
            showToast("Voice message sent! 🎙️", "✅", "#27ae60");
        } catch (err) {
            showToast("Voice send fail: " + err.message, "❌", "#e74c3c");
        }
    };

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
        return (
            <div style={{ backgroundColor: T.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ backgroundColor: T.card, borderRadius: "16px", padding: "40px", width: "100%", maxWidth: "380px", textAlign: "center", border: `1px solid ${T.border}` }}>
                    <h2 style={{ color: T.text, fontSize: "24px", marginBottom: "24px" }}>👋 உன் பேர் என்ன?</h2>
                    <input type="text" placeholder="உன் பேர் type பண்ணு..." value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && username.trim() && setNameSet(true)}
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

    const youtubeId = getYouTubeId(roomData.movieUrl);

    const VideoPlayer = (
        <>
            {youtubeId ? (
                <div style={{ width: "100%", height: "100%", position: "relative" }}>
                    <iframe ref={iframeRef}
                        src={`https://www.youtube.com/embed/${youtubeId}?autoplay=${isPlaying ? 1 : 0}&controls=1&enablejsapi=1&origin=${window.location.origin}&rel=0`}
                        style={{ width: "100%", height: "100%", border: "none" }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                    <div style={{ position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
                        <button onClick={() => { const p = !isPlaying; setIsPlaying(p); updatePlayState(p); }}
                            style={{ padding: "8px 24px", color: "white", border: "none", borderRadius: "20px", cursor: "pointer", fontSize: "14px", fontWeight: "bold", backgroundColor: isPlaying ? "#555" : "#ff6b35" }}>
                            {isPlaying ? "⏸ Pause Sync" : "▶ Play Sync"}
                        </button>
                    </div>
                </div>
            ) : (
                <video ref={videoRef} src={roomData.movieUrl} controls style={{ width: "100%", height: "100%", backgroundColor: "#000" }}
                    onPlay={() => updatePlayState(true, videoRef.current?.currentTime)}
                    onPause={() => updatePlayState(false, videoRef.current?.currentTime)}
                    onSeeked={handleSeek} />
            )}
            {floatingReactions.map((r) => (
                <div key={r.id} style={{ position: "absolute", bottom: "20px", left: `${r.x}%`, fontSize: "40px", animation: "floatUp 3s ease-out forwards", pointerEvents: "none", zIndex: 10 }}>{r.emoji}</div>
            ))}
        </>
    );

    if (isFullscreen) {
        return (
            <div style={{ position: "fixed", inset: 0, backgroundColor: "#000", zIndex: 9000 }}>
                <Toast toasts={toasts} />
                <div style={{ width: "100%", height: "100%", position: "relative" }}>
                    {VideoPlayer}
                    <button onClick={() => setIsFullscreen(false)}
                        style={{ position: "absolute", top: "16px", left: "16px", padding: "8px 16px", backgroundColor: "rgba(0,0,0,0.75)", color: "white", border: "1px solid #555", borderRadius: "8px", cursor: "pointer", fontSize: "13px", zIndex: 9100 }}>
                        ✕ Exit
                    </button>
                    <div style={{ position: "absolute", bottom: "20px", left: "20px", display: "flex", gap: "8px", zIndex: 9100 }}>
                        {REACTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => sendReaction(emoji)}
                                style={{ fontSize: "24px", backgroundColor: "rgba(0,0,0,0.5)", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>{emoji}</button>
                        ))}
                    </div>
                    {showVideoCall && livekitToken ? (
                        <LiveKitRoom token={livekitToken} serverUrl={import.meta.env.VITE_LIVEKIT_URL} connect={true} video={true} audio={true} onDisconnected={endVideoCall}>
                            <RoomAudioRenderer />
                            <CallUI isFullscreen={true} onEnd={endVideoCall} />
                        </LiveKitRoom>
                    ) : (
                        <div style={{ position: "absolute", bottom: "24px", right: "24px", zIndex: 9100 }}>
                            <button onClick={startVideoCall}
                                style={{ padding: "10px 18px", backgroundColor: "#27ae60", color: "white", border: "none", borderRadius: "12px", cursor: "pointer", fontSize: "13px", fontWeight: "bold" }}>
                                📹 Face Cam Start
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div style={{ backgroundColor: T.bg, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
            <Toast toasts={toasts} />
            {showHistory && <WatchHistoryModal roomId={roomId} onClose={() => setShowHistory(false)} T={T} />}

            <div style={{ display: "flex", flex: 1, height: "100vh" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <div style={{ flex: 1, backgroundColor: T.playerBg, position: "relative", minHeight: "0", overflow: "hidden" }}>
                        {VideoPlayer}
                    </div>

                    <div style={{ backgroundColor: T.reactionBg, padding: "8px 16px", display: "flex", gap: "6px", justifyContent: "center", alignItems: "center", borderTop: `1px solid ${T.border}` }}>
                        {REACTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => sendReaction(emoji)}
                                style={{ fontSize: "26px", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>{emoji}</button>
                        ))}
                        <button onClick={() => sendReaction("🎬")} style={{ fontSize: "22px", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>🎬</button>
                        <button onClick={() => sendReaction("🥺")} style={{ fontSize: "22px", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>🥺</button>
                        <button onClick={() => sendReaction("💕")} style={{ fontSize: "22px", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>💕</button>
                    </div>

                    <div style={{ backgroundColor: T.card, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", borderTop: `1px solid ${T.border}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ color: T.text3, fontSize: "13px" }}>Room:</span>
                            <span style={{ color: "#ff6b35", fontSize: "13px", fontWeight: "bold" }}>{roomId}</span>
                            {/* ✅ Encryption indicator */}
                            <span style={{ backgroundColor: "rgba(39,174,96,0.15)", color: "#27ae60", border: "1px solid rgba(39,174,96,0.3)", borderRadius: "10px", padding: "2px 8px", fontSize: "11px", fontWeight: "bold" }}>
                                🔐 Encrypted
                            </span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <button onClick={showVideoCall ? endVideoCall : startVideoCall} disabled={callStatus === "calling"}
                                style={{ padding: "8px 14px", backgroundColor: showVideoCall ? "#e74c3c" : callStatus === "calling" ? "#666" : "#27ae60", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                                {showVideoCall ? "📵 Call End" : callStatus === "calling" ? "⏳ Calling..." : "📹 Video Call"}
                            </button>
                            <button onClick={() => setIsFullscreen(true)}
                                style={{ padding: "8px 14px", backgroundColor: "#8e44ad", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                                ⛶ Full Screen
                            </button>
                            <button onClick={() => setShowHistory(true)}
                                style={{ padding: "8px 14px", backgroundColor: "#2980b9", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                                🎬 History
                            </button>
                            <button onClick={() => setIsDark(!isDark)}
                                style={{ padding: "8px 14px", backgroundColor: isDark ? "#f39c12" : "#2c3e50", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                                {isDark ? "☀️ Light" : "🌙 Dark"}
                            </button>
                            <button onClick={() => { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                                style={{ padding: "8px 14px", backgroundColor: T.card2, color: T.text, border: `1px solid ${T.border}`, borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                                {copied ? "✅ Copied!" : "🔗 Copy Link"}
                            </button>
                            <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`🎬 என்னோட கூட movie பாரு! ${window.location.href}`)}`, "_blank")}
                                style={{ padding: "8px 14px", backgroundColor: "#25D366", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                                💬 WhatsApp
                            </button>
                            <button onClick={() => setShowChat(!showChat)}
                                style={{ padding: "8px 14px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
                                {showChat ? "💬 Hide Chat" : "💬 Show Chat"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* ✅ Chat panel */}
                {showChat && (
                    <div style={{ width: "320px", backgroundColor: T.card, display: "flex", flexDirection: "column", borderLeft: `1px solid ${T.border}` }}>
                        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ color: T.text, fontWeight: "bold", fontSize: "14px" }}>💬 Chat</span>
                                <span style={{ backgroundColor: "rgba(39,174,96,0.15)", color: "#27ae60", border: "1px solid rgba(39,174,96,0.3)", borderRadius: "8px", padding: "1px 7px", fontSize: "10px", fontWeight: "bold" }}>🔐 E2E</span>
                            </div>
                            <span style={{ color: "#ff6b35", fontSize: "13px" }}>👤 {username}</span>
                        </div>

                        <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                            {messages.length === 0 && <p style={{ color: T.text3, textAlign: "center", fontSize: "13px" }}>message இல்ல - first message பண்ணு! 👋</p>}
                            {messages.map((msg) => (
                                <div key={msg.id} style={{ maxWidth: "85%", padding: "8px 12px", borderRadius: "12px", display: "flex", flexDirection: "column", alignSelf: msg.username === username ? "flex-end" : "flex-start", backgroundColor: msg.username === username ? "#ff6b35" : T.card2 }}>
                                    {msg.username !== username && <p style={{ color: T.text2, fontSize: "11px", margin: "0 0 4px 0" }}>{msg.username}</p>}
                                    {msg.type === "voice" && msg.voiceUrl ? (
                                        <div>
                                            <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "11px", margin: "0 0 4px 0" }}>🎙️ Voice message</p>
                                            <audio src={msg.voiceUrl} controls style={{ width: "180px", height: "28px" }} />
                                        </div>
                                    ) : (
                                        <p style={{ color: T.text, fontSize: "14px", margin: 0, wordBreak: "break-word" }}>{msg.message}</p>
                                    )}
                                </div>
                            ))}
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
                            <div style={{ padding: "12px", borderTop: `1px solid ${T.border}`, display: "flex", gap: "6px", position: "relative" }}>
                                {showEmojiPicker && (
                                    <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
                                )}
                                <button onClick={() => setShowEmojiPicker(p => !p)}
                                    style={{ padding: "10px", backgroundColor: showEmojiPicker ? "#ff6b35" : T.card2, border: `1px solid ${T.border}`, borderRadius: "8px", cursor: "pointer", fontSize: "16px", flexShrink: 0 }}>
                                    😊
                                </button>
                                <input type="text" placeholder="Message type பண்ணு..." value={newMessage}
                                    onChange={handleTyping}
                                    onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                                    style={{ flex: 1, padding: "10px 12px", backgroundColor: T.card2, border: `1px solid ${T.border}`, borderRadius: "8px", color: T.text, fontSize: "14px", outline: "none", minWidth: 0 }} />
                                <button onClick={() => setShowVoiceRecorder(true)}
                                    style={{ padding: "10px", backgroundColor: T.card2, border: `1px solid ${T.border}`, borderRadius: "8px", cursor: "pointer", fontSize: "16px", flexShrink: 0 }}>
                                    🎙️
                                </button>
                                <button onClick={() => sendMessage()}
                                    style={{ padding: "10px 14px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "16px", flexShrink: 0 }}>➤</button>
                            </div>
                        )}
                    </div>
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

            {showVideoCall && livekitToken && !isFullscreen && (
                <LiveKitRoom token={livekitToken} serverUrl={import.meta.env.VITE_LIVEKIT_URL} connect={true} video={true} audio={true} onDisconnected={endVideoCall}>
                    <RoomAudioRenderer />
                    <CallUI isFullscreen={false} onEnd={endVideoCall} />
                </LiveKitRoom>
            )}

            <style>{`
                @keyframes floatUp { 0%{transform:translateY(0) scale(1);opacity:1} 100%{transform:translateY(-300px) scale(1.5);opacity:0} }
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