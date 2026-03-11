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

// ✅ Local Video - localParticipant camera direct attach
function LocalVideo() {
    const videoRef = useRef(null);
    const { localParticipant } = useLocalParticipant();

    useEffect(() => {
        if (!localParticipant) return;

        const attachVideo = () => {
            const publication = localParticipant.getTrackPublication("camera");
            const track = publication?.track;
            if (track && videoRef.current) {
                track.attach(videoRef.current);
            }
        };

        attachVideo();
        localParticipant.on("trackPublished", attachVideo);
        localParticipant.on("trackSubscribed", attachVideo);

        return () => {
            localParticipant.off("trackPublished", attachVideo);
            localParticipant.off("trackSubscribed", attachVideo);
            try {
                const publication = localParticipant.getTrackPublication("camera");
                if (publication?.track && videoRef.current) {
                    publication.track.detach(videoRef.current);
                }
            } catch { }
        };
    }, [localParticipant?.sid]);

    return (
        <div style={{ textAlign: "center" }}>
            <p style={{ color: "#ff6b35", fontSize: "11px", margin: "0 0 4px 0" }}>நீ 🟠</p>
            <div style={{
                position: "relative", width: "175px", height: "130px",
                borderRadius: "10px", overflow: "hidden",
                border: "2px solid #ff6b35", backgroundColor: "#111",
            }}>
                <video ref={videoRef} autoPlay muted playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                <div style={{ position: "absolute", bottom: "4px", left: "6px", color: "white", fontSize: "10px", backgroundColor: "rgba(0,0,0,0.6)", padding: "2px 5px", borderRadius: "4px" }}>
                    நீ 👤
                </div>
            </div>
        </div>
    );
}

// ✅ Remote Video - remoteParticipant camera + mic direct attach
function RemoteVideo() {
    const videoRef = useRef(null);
    const audioRef = useRef(null);
    const remoteParticipants = useRemoteParticipants();
    const remoteParticipant = remoteParticipants[0];

    useEffect(() => {
        if (!remoteParticipant) return;

        const attachTracks = () => {
            // Video
            const videoPub = remoteParticipant.getTrackPublication("camera");
            if (videoPub?.track && videoRef.current) {
                videoPub.track.attach(videoRef.current);
            }
            // Audio
            const audioPub = remoteParticipant.getTrackPublication("microphone");
            if (audioPub?.track && audioRef.current) {
                audioPub.track.attach(audioRef.current);
            }
        };

        attachTracks();
        remoteParticipant.on("trackSubscribed", attachTracks);
        remoteParticipant.on("trackPublished", attachTracks);

        return () => {
            remoteParticipant.off("trackSubscribed", attachTracks);
            remoteParticipant.off("trackPublished", attachTracks);
            try {
                const videoPub = remoteParticipant.getTrackPublication("camera");
                if (videoPub?.track && videoRef.current) videoPub.track.detach(videoRef.current);
                const audioPub = remoteParticipant.getTrackPublication("microphone");
                if (audioPub?.track && audioRef.current) audioPub.track.detach(audioRef.current);
            } catch { }
        };
    }, [remoteParticipant?.sid]);

    return (
        <div style={{ textAlign: "center" }}>
            <p style={{ color: "#27ae60", fontSize: "11px", margin: "0 0 4px 0" }}>Partner 🟢</p>
            <div style={{
                position: "relative", width: "175px", height: "130px",
                borderRadius: "10px", overflow: "hidden",
                border: "2px solid #27ae60", backgroundColor: "#111",
            }}>
                {remoteParticipant ? (
                    <video ref={videoRef} autoPlay playsInline
                        style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "8px" }}>
                        <span style={{ fontSize: "28px" }}>👤</span>
                        <span style={{ color: "#555", fontSize: "10px", textAlign: "center", padding: "0 8px" }}>
                            Partner join பண்ண காத்திருக்கோம்
                        </span>
                    </div>
                )}
                {remoteParticipant && (
                    <div style={{ position: "absolute", bottom: "4px", left: "6px", color: "white", fontSize: "10px", backgroundColor: "rgba(0,0,0,0.6)", padding: "2px 5px", borderRadius: "4px" }}>
                        {remoteParticipant.identity} 👤
                    </div>
                )}
            </div>
            {/* ✅ Hidden audio - partner voice கேக்க */}
            <audio ref={audioRef} autoPlay style={{ display: "none" }} />
        </div>
    );
}

// ✅ Draggable VideoCallUI
function VideoCallUI({ onEnd }) {
    const { localParticipant } = useLocalParticipant();
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [pos, setPos] = useState({ x: window.innerWidth - 430, y: window.innerHeight - 400 });
    const dragging = useRef(false);
    const offset = useRef({ x: 0, y: 0 });

    const onMouseDown = (e) => {
        dragging.current = true;
        offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    };
    useEffect(() => {
        const onMouseMove = (e) => {
            if (!dragging.current) return;
            setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
        };
        const onMouseUp = () => { dragging.current = false; };
        const onTouchMove = (e) => {
            if (!dragging.current) return;
            setPos({ x: e.touches[0].clientX - offset.current.x, y: e.touches[0].clientY - offset.current.y });
        };
        const onTouchEnd = () => { dragging.current = false; };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("touchmove", onTouchMove);
        window.addEventListener("touchend", onTouchEnd);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            window.removeEventListener("touchmove", onTouchMove);
            window.removeEventListener("touchend", onTouchEnd);
        };
    }, []);

    const toggleMic = async () => {
        if (localParticipant) {
            await localParticipant.setMicrophoneEnabled(isMuted);
            setIsMuted(!isMuted);
        }
    };
    const toggleCam = async () => {
        if (localParticipant) {
            await localParticipant.setCameraEnabled(isCamOff);
            setIsCamOff(!isCamOff);
        }
    };

    return (
        <div style={{
            position: "fixed", left: pos.x, top: pos.y, width: "390px",
            backgroundColor: "#1a1a1a", borderRadius: "16px",
            border: "2px solid #27ae60", zIndex: 9999, overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.9)", userSelect: "none",
        }}>
            {/* Drag Handle */}
            <div onMouseDown={onMouseDown}
                onTouchStart={(e) => {
                    dragging.current = true;
                    offset.current = { x: e.touches[0].clientX - pos.x, y: e.touches[0].clientY - pos.y };
                }}
                style={{ padding: "10px 16px", backgroundColor: "#111", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #333", cursor: "grab" }}>
                <span style={{ color: "#555", fontSize: "12px" }}>⠿ Drag</span>
                <span style={{ color: "white", fontSize: "13px", fontWeight: "bold" }}>📹 Video Call</span>
                <button onClick={onEnd} style={{ padding: "4px 10px", backgroundColor: "#e74c3c", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}>📵</button>
            </div>

            {/* Videos */}
            <div style={{ padding: "12px", display: "flex", gap: "10px", justifyContent: "center" }}>
                <LocalVideo />
                <RemoteVideo />
            </div>

            {/* Controls */}
            <div style={{ padding: "10px 12px", borderTop: "1px solid #333", display: "flex", gap: "8px", justifyContent: "center" }}>
                <button onClick={toggleMic} style={{ padding: "8px 14px", color: "white", border: "1px solid #444", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "bold", backgroundColor: isMuted ? "#e74c3c" : "#2a2a2a" }}>
                    {isMuted ? "🔇 Muted" : "🎤 Mic On"}
                </button>
                <button onClick={toggleCam} style={{ padding: "8px 14px", color: "white", border: "1px solid #444", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "bold", backgroundColor: isCamOff ? "#e74c3c" : "#2a2a2a" }}>
                    {isCamOff ? "📷 Cam Off" : "📸 Cam On"}
                </button>
                <button onClick={onEnd} style={{ padding: "8px 14px", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "bold", backgroundColor: "#e74c3c" }}>
                    📵 End
                </button>
            </div>
        </div>
    );
}

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
    // ✅ YouTube iframe mute when call active
    const iframeRef = useRef(null);
    const chatEndRef = useRef(null);
    const usernameRef = useRef("");

    useEffect(() => { usernameRef.current = username; }, [username]);
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

    // ✅ Mute YouTube when video call is on
    useEffect(() => {
        if (!iframeRef.current) return;
        try {
            if (showVideoCall) {
                iframeRef.current.contentWindow.postMessage(
                    JSON.stringify({ event: "command", func: "mute", args: [] }), "*"
                );
            } else {
                iframeRef.current.contentWindow.postMessage(
                    JSON.stringify({ event: "command", func: "unMute", args: [] }), "*"
                );
            }
        } catch { }
    }, [showVideoCall]);

    // Room Sync
    useEffect(() => {
        const q = query(collection(db, "rooms"), where("roomId", "==", roomId));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const docData = snapshot.docs[0];
                setRoomDocId(docData.id);
                const data = docData.data();
                setRoomData(data);
                if (!isSyncing) setIsPlaying(data.isPlaying);
            }
        });
        return () => unsubscribe();
    }, [roomId, isSyncing]);

    // ✅ Call Status Listener
    useEffect(() => {
        if (!roomDocId || !nameSet) return;
        const unsubscribe = onSnapshot(doc(db, "rooms", roomDocId), (snap) => {
            const data = snap.data();
            if (!data) return;
            const currentUser = usernameRef.current;
            if (data.callStatus === "calling" && data.callBy !== currentUser) {
                setCallerName(data.callBy || "Partner");
                setIncomingCall(true);
            }
            if (data.callStatus === "ended" && data.callBy !== currentUser) {
                setIncomingCall(false);
                setCallStatus(null);
                setShowVideoCall(false);
                setLivekitToken(null);
            }
        });
        return () => unsubscribe();
    }, [roomDocId, nameSet]);

    // Chat
    useEffect(() => {
        const q = query(collection(db, "chats"), where("roomId", "==", roomId), orderBy("createdAt", "asc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
        return () => unsubscribe();
    }, [roomId]);

    // Reactions
    useEffect(() => {
        const q = query(collection(db, "reactions"), where("roomId", "==", roomId), orderBy("createdAt", "asc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    const id = change.doc.id;
                    setFloatingReactions((prev) => [...prev, { id, emoji: data.emoji, x: Math.random() * 70 + 10 }]);
                    setTimeout(() => setFloatingReactions((prev) => prev.filter((r) => r.id !== id)), 3000);
                }
            });
        });
        return () => unsubscribe();
    }, [roomId]);

    const updatePlayState = async (playing) => {
        if (!roomDocId) return;
        setIsSyncing(true);
        await updateDoc(doc(db, "rooms", roomDocId), { isPlaying: playing });
        setTimeout(() => setIsSyncing(false), 1000);
    };

    const handlePlay = async () => { setIsPlaying(true); await updatePlayState(true); };
    const handlePause = async () => { setIsPlaying(false); await updatePlayState(false); };

    const fetchToken = async () => {
        const r = await fetch(`${TOKEN_SERVER}/api/token?roomName=room-${roomId}&participantName=${username}`);
        const d = await r.json();
        return d.token;
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
        setCallStatus("in-call");
        try {
            if (roomDocId) await updateDoc(doc(db, "rooms", roomDocId), { callStatus: "in-call" });
            const token = await fetchToken();
            setLivekitToken(token);
            setShowVideoCall(true);
        } catch (err) {
            setCallStatus(null);
            alert("Call accept ஆகல: " + err.message);
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

    const copyLink = () => {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const shareWhatsApp = () => {
        window.open(`https://wa.me/?text=${encodeURIComponent(`🎬 என்னோட கூட movie பாரு! ${window.location.href}`)}`, "_blank");
    };

    if (!nameSet) {
        return (
            <div style={styles.nameContainer}>
                <div style={styles.nameCard}>
                    <h2 style={styles.nameTitle}>👋 உன் பேர் என்ன?</h2>
                    <input type="text" placeholder="உன் பேர் type பண்ணு..." value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && username.trim() && setNameSet(true)}
                        style={styles.nameInput} autoFocus />
                    <button onClick={() => username.trim() && setNameSet(true)} style={styles.nameBtn}>🚀 Join Room</button>
                </div>
            </div>
        );
    }

    if (!roomData) return <div style={styles.loading}><p>⏳ Room load ஆகுது...</p></div>;

    const youtubeId = getYouTubeId(roomData.movieUrl);

    return (
        <div style={styles.container}>
            <div style={styles.mainLayout}>
                <div style={styles.playerSection}>
                    <div style={styles.playerWrapper}>
                        {youtubeId ? (
                            <div style={{ width: "100%", height: "100%", position: "relative" }}>
                                <iframe
                                    ref={iframeRef}
                                    src={`https://www.youtube.com/embed/${youtubeId}?autoplay=${isPlaying ? 1 : 0}&controls=1&enablejsapi=1&origin=${window.location.origin}&rel=0`}
                                    style={{ width: "100%", height: "100%", border: "none" }}
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                />
                                <div style={styles.syncOverlay}>
                                    <button onClick={isPlaying ? handlePause : handlePlay}
                                        style={{ ...styles.syncBtn, backgroundColor: isPlaying ? "#555" : "#ff6b35" }}>
                                        {isPlaying ? "⏸ Pause (Sync)" : "▶ Play (Sync)"}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <video src={roomData.movieUrl} controls
                                style={{ width: "100%", height: "100%", backgroundColor: "#000" }}
                                onPlay={handlePlay} onPause={handlePause} />
                        )}
                        {floatingReactions.map((r) => (
                            <div key={r.id} style={{ ...styles.floatingEmoji, left: `${r.x}%` }}>{r.emoji}</div>
                        ))}
                    </div>

                    <div style={styles.reactionBar}>
                        {REACTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => sendReaction(emoji)} style={styles.reactionBtn}>{emoji}</button>
                        ))}
                    </div>

                    <div style={styles.controls}>
                        <div style={styles.roomInfo}>
                            <span style={styles.roomLabel}>Room:</span>
                            <span style={styles.roomId}>{roomId}</span>
                        </div>
                        <div style={styles.buttonGroup}>
                            <button
                                onClick={showVideoCall ? endVideoCall : startVideoCall}
                                disabled={callStatus === "calling"}
                                style={{ ...styles.controlBtn, backgroundColor: showVideoCall ? "#e74c3c" : callStatus === "calling" ? "#666" : "#27ae60" }}
                            >
                                {showVideoCall ? "📵 Call End" : callStatus === "calling" ? "⏳ Calling..." : "📹 Video Call"}
                            </button>
                            <button onClick={copyLink} style={styles.controlBtn}>{copied ? "✅ Copied!" : "🔗 Copy Link"}</button>
                            <button onClick={shareWhatsApp} style={{ ...styles.controlBtn, backgroundColor: "#25D366" }}>💬 WhatsApp</button>
                            <button onClick={() => setShowChat(!showChat)} style={{ ...styles.controlBtn, backgroundColor: "#ff6b35" }}>
                                {showChat ? "💬 Hide Chat" : "💬 Show Chat"}
                            </button>
                        </div>
                    </div>
                </div>

                {showChat && (
                    <div style={styles.chatSection}>
                        <div style={styles.chatHeader}>
                            <span>💬 Chat</span>
                            <span style={styles.chatUser}>👤 {username}</span>
                        </div>
                        <div style={styles.messageList}>
                            {messages.length === 0 && <p style={styles.noMessages}>message இல்ல - first message பண்ணு! 👋</p>}
                            {messages.map((msg) => (
                                <div key={msg.id} style={{ ...styles.messageItem, alignSelf: msg.username === username ? "flex-end" : "flex-start", backgroundColor: msg.username === username ? "#ff6b35" : "#2a2a2a" }}>
                                    {msg.username !== username && <p style={styles.msgUsername}>{msg.username}</p>}
                                    <p style={styles.msgText}>{msg.message}</p>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>
                        <div style={styles.chatInput}>
                            <input type="text" placeholder="Message type பண்ணு..." value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                                style={styles.msgInput} />
                            <button onClick={sendMessage} style={styles.sendBtn}>➤</button>
                        </div>
                    </div>
                )}
            </div>

            {/* ✅ Incoming Call Popup */}
            {incomingCall && (
                <div style={styles.incomingOverlay}>
                    <div style={styles.incomingCard}>
                        <div style={{ fontSize: "56px", marginBottom: "8px" }}>📹</div>
                        <p style={{ color: "white", fontSize: "20px", fontWeight: "bold", margin: "0 0 8px 0" }}>Incoming Video Call!</p>
                        <p style={{ color: "#aaa", fontSize: "14px", margin: "0 0 28px 0" }}>{callerName} call பண்றாங்க... 💕</p>
                        <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
                            <button onClick={acceptCall} style={styles.acceptBtn}>✅ Accept</button>
                            <button onClick={rejectCall} style={styles.rejectBtn}>❌ Reject</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ✅ LiveKit - RoomAudioRenderer automatic audio handle பண்ணும் */}
            {showVideoCall && livekitToken && (
                <LiveKitRoom
                    token={livekitToken}
                    serverUrl={import.meta.env.VITE_LIVEKIT_URL}
                    connect={true}
                    video={true}
                    audio={true}
                    onDisconnected={endVideoCall}
                >
                    {/* ✅ This automatically handles ALL remote audio */}
                    <RoomAudioRenderer />
                    <VideoCallUI onEnd={endVideoCall} />
                </LiveKitRoom>
            )}

            <style>{`
                @keyframes floatUp {
                    0% { transform: translateY(0) scale(1); opacity: 1; }
                    100% { transform: translateY(-300px) scale(1.5); opacity: 0; }
                }
                @keyframes pulse {
                    0%, 100% { box-shadow: 0 8px 40px rgba(39,174,96,0.3); }
                    50% { box-shadow: 0 8px 60px rgba(39,174,96,0.6); }
                }
            `}</style>
        </div>
    );
}

const styles = {
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
    incomingOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" },
    incomingCard: { backgroundColor: "#1a1a1a", borderRadius: "20px", border: "2px solid #27ae60", padding: "40px", textAlign: "center", animation: "pulse 1.5s infinite" },
    acceptBtn: { padding: "14px 32px", backgroundColor: "#27ae60", color: "white", border: "none", borderRadius: "12px", fontSize: "16px", cursor: "pointer", fontWeight: "bold" },
    rejectBtn: { padding: "14px 32px", backgroundColor: "#e74c3c", color: "white", border: "none", borderRadius: "12px", fontSize: "16px", cursor: "pointer", fontWeight: "bold" },
};

export default Room;