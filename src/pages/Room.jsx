import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import {
    collection, query, where, onSnapshot,
    updateDoc, doc, addDoc, orderBy,
} from "firebase/firestore";
import {
    LiveKitRoom,
    useLocalParticipant,
    useRemoteParticipants,
    RoomAudioRenderer,
} from "@livekit/components-react";
import "@livekit/components-styles";

const REACTIONS = ["❤️", "😂", "😮", "🔥", "👏", "😢"];
const TOKEN_SERVER = "https://livekit-token-server-t3ko.onrender.com";

const getYouTubeId = (url) => {
    const match = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
};

// ✅ LocalVideo - உன் face
function LocalVideo({ small }) {
    const videoRef = useRef(null);
    const { localParticipant } = useLocalParticipant();
    const attachedRef = useRef(false);

    useEffect(() => {
        if (!localParticipant) return;
        attachedRef.current = false;
        const tryAttach = () => {
            const pub = localParticipant.getTrackPublication("camera");
            const track = pub?.videoTrack ?? pub?.track;
            if (track && videoRef.current && !attachedRef.current) {
                track.attach(videoRef.current);
                attachedRef.current = true;
            }
        };
        tryAttach();
        const iv = setInterval(tryAttach, 500);
        setTimeout(() => clearInterval(iv), 10000);
        localParticipant.on("localTrackPublished", tryAttach);
        return () => {
            clearInterval(iv);
            localParticipant.off("localTrackPublished", tryAttach);
            try {
                const pub = localParticipant.getTrackPublication("camera");
                const track = pub?.videoTrack ?? pub?.track;
                if (track && videoRef.current) track.detach(videoRef.current);
            } catch { }
            attachedRef.current = false;
        };
    }, [localParticipant?.sid]);

    const w = small ? "120px" : "175px";
    const h = small ? "90px" : "130px";

    return (
        <div style={{ textAlign: "center" }}>
            {!small && <p style={{ color: "#ff6b35", fontSize: "11px", margin: "0 0 4px 0" }}>நீ 🟠</p>}
            <div style={{ position: "relative", width: w, height: h, borderRadius: "10px", overflow: "hidden", border: `2px solid #ff6b35`, backgroundColor: "#111" }}>
                <video ref={videoRef} autoPlay muted playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                <div style={{ position: "absolute", bottom: "3px", left: "5px", color: "white", fontSize: "9px", backgroundColor: "rgba(0,0,0,0.6)", padding: "1px 4px", borderRadius: "3px" }}>
                    நீ 🟠
                </div>
            </div>
        </div>
    );
}

// ✅ RemoteVideo - partner face
function RemoteVideo({ small }) {
    const videoRef = useRef(null);
    const remoteParticipants = useRemoteParticipants();
    const remoteParticipant = remoteParticipants[0];
    const attachedRef = useRef(false);

    useEffect(() => {
        if (!remoteParticipant) return;
        attachedRef.current = false;
        const tryAttach = () => {
            const pub = remoteParticipant.getTrackPublication("camera");
            const track = pub?.videoTrack ?? pub?.track;
            if (track && videoRef.current && !attachedRef.current) {
                track.attach(videoRef.current);
                attachedRef.current = true;
            }
        };
        tryAttach();
        const iv = setInterval(tryAttach, 500);
        setTimeout(() => clearInterval(iv), 15000);
        remoteParticipant.on("trackSubscribed", tryAttach);
        remoteParticipant.on("trackPublished", tryAttach);
        return () => {
            clearInterval(iv);
            remoteParticipant.off("trackSubscribed", tryAttach);
            remoteParticipant.off("trackPublished", tryAttach);
            try {
                const pub = remoteParticipant.getTrackPublication("camera");
                const track = pub?.videoTrack ?? pub?.track;
                if (track && videoRef.current) track.detach(videoRef.current);
            } catch { }
            attachedRef.current = false;
        };
    }, [remoteParticipant?.sid]);

    const w = small ? "120px" : "175px";
    const h = small ? "90px" : "130px";

    return (
        <div style={{ textAlign: "center" }}>
            {!small && <p style={{ color: "#27ae60", fontSize: "11px", margin: "0 0 4px 0" }}>Partner 🟢</p>}
            <div style={{ position: "relative", width: w, height: h, borderRadius: "10px", overflow: "hidden", border: "2px solid #27ae60", backgroundColor: "#111" }}>
                {remoteParticipant ? (
                    <video ref={videoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: "22px" }}>👤</span>
                    </div>
                )}
                <div style={{ position: "absolute", bottom: "3px", left: "5px", color: "white", fontSize: "9px", backgroundColor: "rgba(0,0,0,0.6)", padding: "1px 4px", borderRadius: "3px" }}>
                    {remoteParticipant ? `${remoteParticipant.identity} 🟢` : "காத்திருக்கோம்"}
                </div>
            </div>
        </div>
    );
}

// ✅ Fullscreen mode-ல காட்டும் - இரண்டு faces side by side small
function FullscreenFaceBar({ onEnd, isMuted, isCamOff, onToggleMic, onToggleCam }) {
    return (
        <div style={{
            position: "absolute",
            bottom: "20px",
            right: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            zIndex: 500,
            alignItems: "flex-end",
        }}>
            {/* Both faces */}
            <div style={{ display: "flex", gap: "8px" }}>
                <LocalVideo small />
                <RemoteVideo small />
            </div>
            {/* Controls */}
            <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={onToggleMic} style={{ padding: "6px 12px", color: "white", border: "none", borderRadius: "16px", cursor: "pointer", fontSize: "12px", backgroundColor: isMuted ? "#e74c3c" : "rgba(0,0,0,0.7)" }}>
                    {isMuted ? "🔇" : "🎤"}
                </button>
                <button onClick={onToggleCam} style={{ padding: "6px 12px", color: "white", border: "none", borderRadius: "16px", cursor: "pointer", fontSize: "12px", backgroundColor: isCamOff ? "#e74c3c" : "rgba(0,0,0,0.7)" }}>
                    {isCamOff ? "📷" : "📸"}
                </button>
                <button onClick={onEnd} style={{ padding: "6px 12px", color: "white", border: "none", borderRadius: "16px", cursor: "pointer", fontSize: "12px", backgroundColor: "#e74c3c" }}>
                    📵
                </button>
            </div>
        </div>
    );
}

// ✅ Normal mode popup
function NormalCallPopup({ onEnd, isMuted, isCamOff, onToggleMic, onToggleCam }) {
    const [pos, setPos] = useState({ x: window.innerWidth - 430, y: window.innerHeight - 420 });
    const dragging = useRef(false);
    const offset = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const onMM = (e) => { if (!dragging.current) return; setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y }); };
        const onMU = () => { dragging.current = false; };
        const onTM = (e) => { if (!dragging.current) return; setPos({ x: e.touches[0].clientX - offset.current.x, y: e.touches[0].clientY - offset.current.y }); };
        const onTE = () => { dragging.current = false; };
        window.addEventListener("mousemove", onMM); window.addEventListener("mouseup", onMU);
        window.addEventListener("touchmove", onTM); window.addEventListener("touchend", onTE);
        return () => {
            window.removeEventListener("mousemove", onMM); window.removeEventListener("mouseup", onMU);
            window.removeEventListener("touchmove", onTM); window.removeEventListener("touchend", onTE);
        };
    }, []);

    return (
        <div style={{ position: "fixed", left: pos.x, top: pos.y, width: "390px", backgroundColor: "#1a1a1a", borderRadius: "16px", border: "2px solid #27ae60", zIndex: 9999, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.9)", userSelect: "none" }}>
            <div
                onMouseDown={(e) => { dragging.current = true; offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; }}
                onTouchStart={(e) => { dragging.current = true; offset.current = { x: e.touches[0].clientX - pos.x, y: e.touches[0].clientY - pos.y }; }}
                style={{ padding: "10px 16px", backgroundColor: "#111", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #333", cursor: "grab" }}>
                <span style={{ color: "#555", fontSize: "12px" }}>⠿ Drag</span>
                <span style={{ color: "white", fontSize: "13px", fontWeight: "bold" }}>📹 Video Call</span>
                <button onClick={onEnd} style={{ padding: "4px 10px", backgroundColor: "#e74c3c", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}>📵</button>
            </div>
            <div style={{ padding: "12px", display: "flex", gap: "10px", justifyContent: "center" }}>
                <LocalVideo />
                <RemoteVideo />
            </div>
            <div style={{ padding: "10px 12px", borderTop: "1px solid #333", display: "flex", gap: "8px", justifyContent: "center" }}>
                <button onClick={onToggleMic} style={{ padding: "8px 14px", color: "white", border: "1px solid #444", borderRadius: "8px", cursor: "pointer", fontSize: "12px", backgroundColor: isMuted ? "#e74c3c" : "#2a2a2a" }}>
                    {isMuted ? "🔇 Muted" : "🎤 Mic On"}
                </button>
                <button onClick={onToggleCam} style={{ padding: "8px 14px", color: "white", border: "1px solid #444", borderRadius: "8px", cursor: "pointer", fontSize: "12px", backgroundColor: isCamOff ? "#e74c3c" : "#2a2a2a" }}>
                    {isCamOff ? "📷 Cam Off" : "📸 Cam On"}
                </button>
                <button onClick={onEnd} style={{ padding: "8px 14px", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "12px", backgroundColor: "#e74c3c" }}>
                    📵 End
                </button>
            </div>
        </div>
    );
}

// ✅ Main wrapper - LiveKitRoom-க்கு inside-ல call controls
function CallUI({ isFullscreen, onEnd }) {
    const { localParticipant } = useLocalParticipant();
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);

    const toggleMic = async () => {
        if (localParticipant) { await localParticipant.setMicrophoneEnabled(isMuted); setIsMuted(!isMuted); }
    };
    const toggleCam = async () => {
        if (localParticipant) { await localParticipant.setCameraEnabled(isCamOff); setIsCamOff(!isCamOff); }
    };

    return isFullscreen ? (
        <FullscreenFaceBar onEnd={onEnd} isMuted={isMuted} isCamOff={isCamOff} onToggleMic={toggleMic} onToggleCam={toggleCam} />
    ) : (
        <NormalCallPopup onEnd={onEnd} isMuted={isMuted} isCamOff={isCamOff} onToggleMic={toggleMic} onToggleCam={toggleCam} />
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

    const iframeRef = useRef(null);
    const chatEndRef = useRef(null);
    const usernameRef = useRef("");

    useEffect(() => { usernameRef.current = username; }, [username]);
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

    // ESC to exit fullscreen
    useEffect(() => {
        const fn = (e) => { if (e.key === "Escape") setIsFullscreen(false); };
        window.addEventListener("keydown", fn);
        return () => window.removeEventListener("keydown", fn);
    }, []);

    // YouTube mute when call
    useEffect(() => {
        if (!iframeRef.current) return;
        try {
            iframeRef.current.contentWindow.postMessage(
                JSON.stringify({ event: "command", func: showVideoCall ? "mute" : "unMute", args: [] }), "*"
            );
        } catch { }
    }, [showVideoCall]);

    // Room Sync
    useEffect(() => {
        const q = query(collection(db, "rooms"), where("roomId", "==", roomId));
        return onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const docData = snapshot.docs[0];
                setRoomDocId(docData.id);
                const data = docData.data();
                setRoomData(data);
                if (!isSyncing) setIsPlaying(data.isPlaying);
            }
        });
    }, [roomId, isSyncing]);

    // Call Status
    useEffect(() => {
        if (!roomDocId || !nameSet) return;
        return onSnapshot(doc(db, "rooms", roomDocId), (snap) => {
            const data = snap.data();
            if (!data) return;
            const me = usernameRef.current;
            if (data.callStatus === "calling" && data.callBy !== me) {
                setCallerName(data.callBy || "Partner");
                setIncomingCall(true);
            }
            if (data.callStatus === "ended" && data.callBy !== me) {
                setIncomingCall(false);
                setCallStatus(null);
                setShowVideoCall(false);
                setLivekitToken(null);
            }
        });
    }, [roomDocId, nameSet]);

    // Chat
    useEffect(() => {
        const q = query(collection(db, "chats"), where("roomId", "==", roomId), orderBy("createdAt", "asc"));
        return onSnapshot(q, (snapshot) => {
            setMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
    }, [roomId]);

    // Reactions
    useEffect(() => {
        const q = query(collection(db, "reactions"), where("roomId", "==", roomId), orderBy("createdAt", "asc"));
        return onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const { emoji } = change.doc.data();
                    const id = change.doc.id;
                    setFloatingReactions((prev) => [...prev, { id, emoji, x: Math.random() * 70 + 10 }]);
                    setTimeout(() => setFloatingReactions((prev) => prev.filter((r) => r.id !== id)), 3000);
                }
            });
        });
    }, [roomId]);

    const updatePlayState = async (playing) => {
        if (!roomDocId) return;
        setIsSyncing(true);
        await updateDoc(doc(db, "rooms", roomDocId), { isPlaying: playing });
        setTimeout(() => setIsSyncing(false), 1000);
    };

    // ✅ Render.com sleep ஆயிருந்தா wake up பண்ணி retry பண்றோம்
    const fetchToken = async () => {
        const url = `${TOKEN_SERVER}/api/token?roomName=room-${roomId}&participantName=${username}`;

        // First try - 8 second timeout
        const fetchWithTimeout = (ms) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), ms);
            return fetch(url, { signal: controller.signal })
                .finally(() => clearTimeout(timer));
        };

        try {
            // முதல் attempt
            const r = await fetchWithTimeout(8000);
            if (!r.ok) throw new Error("Server error");
            const d = await r.json();
            if (!d.token) throw new Error("No token");
            return d.token;
        } catch (e) {
            // Render sleep ஆயிருந்தா - wake up call பண்ணி 15s wait பண்ணி retry
            try {
                await fetch(`${TOKEN_SERVER}/health`).catch(() => { });
                await new Promise(res => setTimeout(res, 8000));
                const r2 = await fetchWithTimeout(15000);
                if (!r2.ok) throw new Error("Server error after retry");
                const d2 = await r2.json();
                if (!d2.token) throw new Error("No token after retry");
                return d2.token;
            } catch {
                throw new Error("Token server respond பண்ணல - சில seconds wait பண்ணி மறுபடியும் try பண்ணு");
            }
        }
    };

    const startVideoCall = async () => {
        try {
            setCallStatus("calling");
            if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "calling", callBy: username });
            const token = await fetchToken();
            setLivekitToken(token);
            setShowVideoCall(true);
            setCallStatus("in-call");
        } catch (err) {
            setCallStatus(null);
            alert("Video call start ஆகல: " + err.message);
        }
    };

    const acceptCall = async () => {
        setIncomingCall(false);
        setAcceptLoading(true);
        setCallStatus("in-call");
        try {
            if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "in-call" });
            const token = await fetchToken();
            setLivekitToken(token);
            setShowVideoCall(true);
        } catch (err) {
            setCallStatus(null);
            alert("❌ Call accept ஆகல: " + err.message);
        } finally {
            setAcceptLoading(false);
        }
    };

    const rejectCall = async () => {
        setIncomingCall(false);
        if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "ended", callBy: username });
    };

    const endVideoCall = async () => {
        setShowVideoCall(false);
        setLivekitToken(null);
        setCallStatus(null);
        if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "ended", callBy: username });
    };

    const sendReaction = async (emoji) => {
        await addDoc(collection(db, "reactions"), { roomId, emoji, username, createdAt: new Date() });
    };

    const sendMessage = async () => {
        if (!newMessage.trim()) return;
        await addDoc(collection(db, "chats"), { roomId, username, message: newMessage.trim(), createdAt: new Date() });
        setNewMessage("");
    };

    if (!nameSet) {
        return (
            <div style={S.nameContainer}>
                <div style={S.nameCard}>
                    <h2 style={S.nameTitle}>👋 உன் பேர் என்ன?</h2>
                    <input type="text" placeholder="உன் பேர் type பண்ணு..." value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && username.trim() && setNameSet(true)}
                        style={S.nameInput} autoFocus />
                    <button onClick={() => username.trim() && setNameSet(true)} style={S.nameBtn}>🚀 Join Room</button>
                </div>
            </div>
        );
    }

    if (!roomData) return <div style={S.loading}><p>⏳ Room load ஆகுது...</p></div>;

    const youtubeId = getYouTubeId(roomData.movieUrl);

    // ===================== VIDEO PLAYER (reuse in both modes) =====================
    const VideoPlayer = (
        <>
            {youtubeId ? (
                <div style={{ width: "100%", height: "100%", position: "relative" }}>
                    <iframe
                        ref={iframeRef}
                        src={`https://www.youtube.com/embed/${youtubeId}?autoplay=${isPlaying ? 1 : 0}&controls=1&enablejsapi=1&origin=${window.location.origin}&rel=0`}
                        style={{ width: "100%", height: "100%", border: "none" }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />
                    <div style={S.syncOverlay}>
                        <button onClick={isPlaying ? () => { setIsPlaying(false); updatePlayState(false); } : () => { setIsPlaying(true); updatePlayState(true); }}
                            style={{ ...S.syncBtn, backgroundColor: isPlaying ? "#555" : "#ff6b35" }}>
                            {isPlaying ? "⏸ Pause (Sync)" : "▶ Play (Sync)"}
                        </button>
                    </div>
                </div>
            ) : (
                <video src={roomData.movieUrl} controls
                    style={{ width: "100%", height: "100%", backgroundColor: "#000" }}
                    onPlay={() => { setIsPlaying(true); updatePlayState(true); }}
                    onPause={() => { setIsPlaying(false); updatePlayState(false); }} />
            )}
            {floatingReactions.map((r) => (
                <div key={r.id} style={{ ...S.floatingEmoji, left: `${r.x}%` }}>{r.emoji}</div>
            ))}
        </>
    );

    // ===================== FULLSCREEN MODE =====================
    if (isFullscreen) {
        return (
            <div style={{ position: "fixed", inset: 0, backgroundColor: "#000", zIndex: 9000 }}>
                {/* Video */}
                <div style={{ width: "100%", height: "100%", position: "relative" }}>
                    {VideoPlayer}

                    {/* Exit button */}
                    <button onClick={() => setIsFullscreen(false)}
                        style={{ position: "absolute", top: "16px", left: "16px", padding: "8px 16px", backgroundColor: "rgba(0,0,0,0.75)", color: "white", border: "1px solid #555", borderRadius: "8px", cursor: "pointer", fontSize: "13px", zIndex: 9100 }}>
                        ✕ Exit
                    </button>

                    {/* ✅ Reactions bar */}
                    <div style={{ position: "absolute", bottom: "20px", left: "20px", display: "flex", gap: "8px", zIndex: 9100 }}>
                        {REACTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => sendReaction(emoji)}
                                style={{ fontSize: "24px", backgroundColor: "rgba(0,0,0,0.5)", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: "8px" }}>
                                {emoji}
                            </button>
                        ))}
                    </div>

                    {/* ✅ CallUI inside fullscreen div - partner face இங்க தெரியும்! */}
                    {showVideoCall && livekitToken && (
                        <LiveKitRoom
                            token={livekitToken}
                            serverUrl={import.meta.env.VITE_LIVEKIT_URL}
                            connect={true}
                            video={true}
                            audio={true}
                            onDisconnected={endVideoCall}
                        >
                            <RoomAudioRenderer />
                            <CallUI isFullscreen={true} onEnd={endVideoCall} />
                        </LiveKitRoom>
                    )}
                </div>
            </div>
        );
    }

    // ===================== NORMAL MODE =====================
    return (
        <div style={S.container}>
            <div style={S.mainLayout}>
                <div style={S.playerSection}>
                    <div style={S.playerWrapper}>
                        {VideoPlayer}
                    </div>

                    <div style={S.reactionBar}>
                        {REACTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => sendReaction(emoji)} style={S.reactionBtn}>{emoji}</button>
                        ))}
                    </div>

                    <div style={S.controls}>
                        <div style={S.roomInfo}>
                            <span style={S.roomLabel}>Room: </span>
                            <span style={S.roomId}>{roomId}</span>
                        </div>
                        <div style={S.buttonGroup}>
                            <button
                                onClick={showVideoCall ? endVideoCall : startVideoCall}
                                disabled={callStatus === "calling"}
                                style={{ ...S.controlBtn, backgroundColor: showVideoCall ? "#e74c3c" : callStatus === "calling" ? "#666" : "#27ae60" }}>
                                {showVideoCall ? "📵 Call End" : callStatus === "calling" ? "⏳ Calling..." : "📹 Video Call"}
                            </button>
                            <button onClick={() => setIsFullscreen(true)} style={{ ...S.controlBtn, backgroundColor: "#8e44ad" }}>
                                ⛶ Full Screen
                            </button>
                            <button onClick={() => { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={S.controlBtn}>
                                {copied ? "✅ Copied!" : "🔗 Copy Link"}
                            </button>
                            <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`🎬 என்னோட கூட movie பாரு! ${window.location.href}`)}`, "_blank")} style={{ ...S.controlBtn, backgroundColor: "#25D366" }}>
                                💬 WhatsApp
                            </button>
                            <button onClick={() => setShowChat(!showChat)} style={{ ...S.controlBtn, backgroundColor: "#ff6b35" }}>
                                {showChat ? "💬 Hide Chat" : "💬 Show Chat"}
                            </button>
                        </div>
                    </div>
                </div>

                {showChat && (
                    <div style={S.chatSection}>
                        <div style={S.chatHeader}>
                            <span>💬 Chat</span>
                            <span style={S.chatUser}>👤 {username}</span>
                        </div>
                        <div style={S.messageList}>
                            {messages.length === 0 && <p style={S.noMessages}>message இல்ல - first message பண்ணு! 👋</p>}
                            {messages.map((msg) => (
                                <div key={msg.id} style={{ ...S.messageItem, alignSelf: msg.username === username ? "flex-end" : "flex-start", backgroundColor: msg.username === username ? "#ff6b35" : "#2a2a2a" }}>
                                    {msg.username !== username && <p style={S.msgUsername}>{msg.username}</p>}
                                    <p style={S.msgText}>{msg.message}</p>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>
                        <div style={S.chatInput}>
                            <input type="text" placeholder="Message type பண்ணு..." value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                                style={S.msgInput} />
                            <button onClick={sendMessage} style={S.sendBtn}>➤</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Incoming Call */}
            {incomingCall && (
                <div style={S.incomingOverlay}>
                    <div style={S.incomingCard}>
                        <div style={{ fontSize: "56px", marginBottom: "8px" }}>📹</div>
                        <p style={{ color: "white", fontSize: "20px", fontWeight: "bold", margin: "0 0 8px 0" }}>Incoming Video Call!</p>
                        <p style={{ color: "#aaa", fontSize: "14px", margin: "0 0 28px 0" }}>{callerName} call பண்றாங்க... 💕</p>
                        <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
                            <button onClick={acceptCall} style={S.acceptBtn}>✅ Accept</button>
                            <button onClick={rejectCall} style={S.rejectBtn}>❌ Reject</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ✅ Accept loading - token fetch ஆகும் வரை காட்டு */}
            {acceptLoading && (
                <div style={S.incomingOverlay}>
                    <div style={{ ...S.incomingCard, animation: "none", border: "2px solid #ff6b35" }}>
                        <div style={{ fontSize: "48px", marginBottom: "12px" }}>⏳</div>
                        <p style={{ color: "white", fontSize: "18px", fontWeight: "bold", margin: "0 0 8px 0" }}>
                            Call connect ஆகுது...
                        </p>
                        <p style={{ color: "#aaa", fontSize: "13px", margin: "0 0 20px 0" }}>
                            சில seconds wait பண்ணு 🙏
                        </p>
                        {/* Spinner */}
                        <div style={{ width: "40px", height: "40px", border: "3px solid #333", borderTop: "3px solid #ff6b35", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
                    </div>
                </div>
            )}

            {/* ✅ Normal mode LiveKitRoom */}
            {showVideoCall && livekitToken && (
                <LiveKitRoom
                    token={livekitToken}
                    serverUrl={import.meta.env.VITE_LIVEKIT_URL}
                    connect={true}
                    video={true}
                    audio={true}
                    onDisconnected={endVideoCall}
                >
                    <RoomAudioRenderer />
                    <CallUI isFullscreen={false} onEnd={endVideoCall} />
                </LiveKitRoom>
            )}

            <style>{`
                @keyframes floatUp { 0%{transform:translateY(0) scale(1);opacity:1} 100%{transform:translateY(-300px) scale(1.5);opacity:0} }
                @keyframes pulse { 0%,100%{box-shadow:0 8px 40px rgba(39,174,96,0.3)} 50%{box-shadow:0 8px 60px rgba(39,174,96,0.6)} }
                @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
            `}</style>
        </div>
    );
}

const S = {
    container: { backgroundColor: "#0f0f0f", minHeight: "100vh", display: "flex", flexDirection: "column" },
    loading: { backgroundColor: "#0f0f0f", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: "18px" },
    nameContainer: { backgroundColor: "#0f0f0f", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" },
    nameCard: { backgroundColor: "#1a1a1a", borderRadius: "16px", padding: "40px", width: "100%", maxWidth: "380px", textAlign: "center" },
    nameTitle: { color: "white", fontSize: "24px", marginBottom: "24px" },
    nameInput: { width: "100%", padding: "12px 16px", backgroundColor: "#2a2a2a", border: "1px solid #333", borderRadius: "8px", color: "white", fontSize: "16px", marginBottom: "16px", boxSizing: "border-box" },
    nameBtn: { width: "100%", padding: "14px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", fontSize: "16px", cursor: "pointer", fontWeight: "bold" },
    mainLayout: { display: "flex", flex: 1, height: "100vh" },
    playerSection: { flex: 1, display: "flex", flexDirection: "column" },
    playerWrapper: { flex: 1, backgroundColor: "#000", position: "relative", minHeight: "0", overflow: "hidden" },
    syncOverlay: { position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)", zIndex: 10 },
    syncBtn: { padding: "8px 24px", color: "white", border: "none", borderRadius: "20px", cursor: "pointer", fontSize: "14px", fontWeight: "bold", opacity: 0.9 },
    floatingEmoji: { position: "absolute", bottom: "20px", fontSize: "40px", animation: "floatUp 3s ease-out forwards", pointerEvents: "none", zIndex: 10 },
    reactionBar: { backgroundColor: "#111", padding: "10px 20px", display: "flex", gap: "8px", justifyContent: "center", borderTop: "1px solid #222" },
    reactionBtn: { fontSize: "28px", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: "8px" },
    controls: { backgroundColor: "#1a1a1a", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" },
    roomInfo: { display: "flex", alignItems: "center", gap: "8px" },
    roomLabel: { color: "#666", fontSize: "13px" },
    roomId: { color: "#ff6b35", fontSize: "13px", fontWeight: "bold" },
    buttonGroup: { display: "flex", gap: "8px", flexWrap: "wrap" },
    controlBtn: { padding: "8px 14px", backgroundColor: "#2a2a2a", color: "white", border: "1px solid #333", borderRadius: "8px", cursor: "pointer", fontSize: "13px" },
    chatSection: { width: "320px", backgroundColor: "#1a1a1a", display: "flex", flexDirection: "column", borderLeft: "1px solid #333" },
    chatHeader: { padding: "16px", borderBottom: "1px solid #333", display: "flex", justifyContent: "space-between", alignItems: "center", color: "white", fontWeight: "bold" },
    chatUser: { color: "#ff6b35", fontSize: "13px" },
    messageList: { flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" },
    noMessages: { color: "#666", textAlign: "center", fontSize: "13px" },
    messageItem: { maxWidth: "80%", padding: "8px 12px", borderRadius: "12px", display: "flex", flexDirection: "column" },
    msgUsername: { color: "#aaa", fontSize: "11px", margin: "0 0 4px 0" },
    msgText: { color: "white", fontSize: "14px", margin: 0, wordBreak: "break-word" },
    chatInput: { padding: "12px", borderTop: "1px solid #333", display: "flex", gap: "8px" },
    msgInput: { flex: 1, padding: "10px 12px", backgroundColor: "#2a2a2a", border: "1px solid #333", borderRadius: "8px", color: "white", fontSize: "14px" },
    sendBtn: { padding: "10px 16px", backgroundColor: "#ff6b35", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "16px" },
    incomingOverlay: { position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" },
    incomingCard: { backgroundColor: "#1a1a1a", borderRadius: "20px", border: "2px solid #27ae60", padding: "40px", textAlign: "center", animation: "pulse 1.5s infinite" },
    acceptBtn: { padding: "14px 32px", backgroundColor: "#27ae60", color: "white", border: "none", borderRadius: "12px", fontSize: "16px", cursor: "pointer", fontWeight: "bold" },
    rejectBtn: { padding: "14px 32px", backgroundColor: "#e74c3c", color: "white", border: "none", borderRadius: "12px", fontSize: "16px", cursor: "pointer", fontWeight: "bold" },
};

export default Room;