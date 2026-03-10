import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import {
    collection,
    query,
    where,
    onSnapshot,
    updateDoc,
    doc,
    addDoc,
    orderBy,
} from "firebase/firestore";
import Daily from "@daily-co/daily-js";

const REACTIONS = ["❤️", "😂", "😮", "🔥", "👏", "😢"];

const getYouTubeId = (url) => {
    const match = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
};

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

    // WebRTC States
    const [callStarted, setCallStarted] = useState(false);
    const [participants, setParticipants] = useState({});
    const [dailyRoom, setDailyRoom] = useState(null);
    const callRef = useRef(null);

    // Draggable cam
    const [camPos, setCamPos] = useState({ x: 20, y: 100 });
    const [dragging, setDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    const chatEndRef = useRef(null);
    const localVideoRef = useRef(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Room Sync
    useEffect(() => {
        const q = query(collection(db, "rooms"), where("roomId", "==", roomId));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const docData = snapshot.docs[0];
                setRoomDocId(docData.id);
                const data = docData.data();
                setRoomData(data);
                if (!isSyncing) {
                    setIsPlaying(data.isPlaying);
                }
                // Daily room URL save ஆனா set பண்ணு
                if (data.dailyRoomUrl) {
                    setDailyRoom(data.dailyRoomUrl);
                }
            }
        });
        return () => unsubscribe();
    }, [roomId, isSyncing]);

    // Chat Listen
    useEffect(() => {
        const q = query(
            collection(db, "chats"),
            where("roomId", "==", roomId),
            orderBy("createdAt", "asc")
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
            setMessages(msgs);
        });
        return () => unsubscribe();
    }, [roomId]);

    // Reactions Listen
    useEffect(() => {
        const q = query(
            collection(db, "reactions"),
            where("roomId", "==", roomId),
            orderBy("createdAt", "asc")
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    const id = change.doc.id;
                    setFloatingReactions((prev) => [
                        ...prev,
                        { id, emoji: data.emoji, x: Math.random() * 70 + 10 },
                    ]);
                    setTimeout(() => {
                        setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
                    }, 3000);
                }
            });
        });
        return () => unsubscribe();
    }, [roomId]);

    // Cleanup Daily call on unmount
    useEffect(() => {
        return () => {
            if (callRef.current) {
                callRef.current.destroy();
            }
        };
    }, []);

    // Play/Pause Sync
    const updatePlayState = async (playing) => {
        if (!roomDocId) return;
        setIsSyncing(true);
        await updateDoc(doc(db, "rooms", roomDocId), {
            isPlaying: playing,
        });
        setTimeout(() => setIsSyncing(false), 1000);
    };

    const handlePlay = async () => {
        setIsPlaying(true);
        await updatePlayState(true);
    };

    const handlePause = async () => {
        setIsPlaying(false);
        await updatePlayState(false);
    };

    // Daily.co Room Create பண்ணு
    const createDailyRoom = async () => {
        try {
            const API_KEY = import.meta.env.VITE_DAILY_API_KEY;
            const response = await fetch("https://api.daily.co/v1/rooms", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${API_KEY}`,
                },
                body: JSON.stringify({
                    name: `watch-together-${roomId}`,
                    properties: {
                        max_participants: 2,
                        enable_chat: false,
                        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
                    },
                }),
            });
            const data = await response.json();
            // Already exists error-ஆ?
            if (data.url) return data.url;
            // Room already exists - get it
            const getRes = await fetch(
                `https://api.daily.co/v1/rooms/watch-together-${roomId}`,
                {
                    headers: { Authorization: `Bearer ${API_KEY}` },
                }
            );
            const getData = await getRes.json();
            return getData.url;
        } catch (err) {
            console.error("Daily room error:", err);
            return null;
        }
    };

    // Video Call Start பண்ணு
    const startVideoCall = async () => {
        try {
            let roomUrl = dailyRoom;

            // Room இல்லன்னா create பண்ணு
            if (!roomUrl) {
                roomUrl = await createDailyRoom();
                if (!roomUrl) {
                    alert("Video call start ஆகல. Try again!");
                    return;
                }
                // Firebase-ல save பண்ணு - partner-உம் same room join ஆவாங்க
                await updateDoc(doc(db, "rooms", roomDocId), {
                    dailyRoomUrl: roomUrl,
                });
            }

            // Daily call object create
            const call = Daily.createCallObject({
                videoSource: true,
                audioSource: true,
            });

            callRef.current = call;

            // Events listen
            call.on("participant-joined", (event) => {
                setParticipants((prev) => ({
                    ...prev,
                    [event.participant.session_id]: event.participant,
                }));
            });

            call.on("participant-updated", (event) => {
                setParticipants((prev) => ({
                    ...prev,
                    [event.participant.session_id]: event.participant,
                }));
                // Local video update
                if (event.participant.local && localVideoRef.current) {
                    const track = event.participant.tracks?.video?.persistentTrack;
                    if (track) {
                        localVideoRef.current.srcObject = new MediaStream([track]);
                    }
                }
            });

            call.on("participant-left", (event) => {
                setParticipants((prev) => {
                    const updated = { ...prev };
                    delete updated[event.participant.session_id];
                    return updated;
                });
            });

            call.on("track-started", (event) => {
                setParticipants((prev) => ({
                    ...prev,
                    [event.participant.session_id]: event.participant,
                }));
            });

            // Room join
            await call.join({ url: roomUrl, userName: username });
            setCallStarted(true);

            // Local video set
            setTimeout(() => {
                const localP = call.participants()?.local;
                if (localP?.tracks?.video?.persistentTrack && localVideoRef.current) {
                    localVideoRef.current.srcObject = new MediaStream([
                        localP.tracks.video.persistentTrack,
                    ]);
                }
            }, 1000);

        } catch (err) {
            alert("Error: " + err.message);
        }
    };

    // Video Call Stop
    const stopVideoCall = async () => {
        if (callRef.current) {
            await callRef.current.destroy();
            callRef.current = null;
        }
        setCallStarted(false);
        setParticipants({});
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
        }
    };

    // Reaction Send
    const sendReaction = async (emoji) => {
        await addDoc(collection(db, "reactions"), {
            roomId, emoji, username, createdAt: new Date(),
        });
    };

    // Chat Send
    const sendMessage = async () => {
        if (!newMessage.trim()) return;
        await addDoc(collection(db, "chats"), {
            roomId, username, message: newMessage.trim(), createdAt: new Date(),
        });
        setNewMessage("");
    };

    const handleKeyPress = (e) => {
        if (e.key === "Enter") sendMessage();
    };

    // Drag handlers
    const onMouseDown = (e) => {
        setDragging(true);
        dragOffset.current = { x: e.clientX - camPos.x, y: e.clientY - camPos.y };
    };
    const onMouseMove = (e) => {
        if (!dragging) return;
        setCamPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const onMouseUp = () => setDragging(false);
    const onTouchStart = (e) => {
        const t = e.touches[0];
        setDragging(true);
        dragOffset.current = { x: t.clientX - camPos.x, y: t.clientY - camPos.y };
    };
    const onTouchMove = (e) => {
        if (!dragging) return;
        const t = e.touches[0];
        setCamPos({ x: t.clientX - dragOffset.current.x, y: t.clientY - dragOffset.current.y });
    };

    const copyLink = () => {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const shareWhatsApp = () => {
        const text = `🎬 என்னோட கூட movie பாரு! ${window.location.href}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    };

    // Remote participants render
    const remoteParticipants = Object.values(participants).filter((p) => !p.local);

    // Username Screen
    if (!nameSet) {
        return (
            <div style={styles.nameContainer}>
                <div style={styles.nameCard}>
                    <h2 style={styles.nameTitle}>👋 உன் பேர் என்ன?</h2>
                    <input
                        type="text"
                        placeholder="உன் பேர் type பண்ணு..."
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && username.trim() && setNameSet(true)}
                        style={styles.nameInput}
                        autoFocus
                    />
                    <button
                        onClick={() => username.trim() && setNameSet(true)}
                        style={styles.nameBtn}
                    >
                        🚀 Join Room
                    </button>
                </div>
            </div>
        );
    }

    if (!roomData) {
        return (
            <div style={styles.loading}>
                <p>⏳ Room load ஆகுது...</p>
            </div>
        );
    }

    const youtubeId = getYouTubeId(roomData.movieUrl);

    return (
        <div
            style={styles.container}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onTouchMove={onTouchMove}
            onTouchEnd={onMouseUp}
        >
            <div style={styles.mainLayout}>

                {/* Left - Video */}
                <div style={styles.playerSection}>
                    <div style={styles.playerWrapper}>
                        {youtubeId ? (
                            <div style={{ width: "100%", height: "100%", position: "relative" }}>
                                <iframe
                                    src={`https://www.youtube.com/embed/${youtubeId}?autoplay=${isPlaying ? 1 : 0}&controls=1&enablejsapi=1&origin=${window.location.origin}&rel=0`}
                                    style={{ width: "100%", height: "100%", border: "none" }}
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                />
                                <div style={styles.syncOverlay}>
                                    <button
                                        onClick={isPlaying ? handlePause : handlePlay}
                                        style={{
                                            ...styles.syncBtn,
                                            backgroundColor: isPlaying ? "#555" : "#ff6b35",
                                        }}
                                    >
                                        {isPlaying ? "⏸ Pause (Sync)" : "▶ Play (Sync)"}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <video
                                src={roomData.movieUrl}
                                controls
                                style={{ width: "100%", height: "100%", backgroundColor: "#000" }}
                                onPlay={handlePlay}
                                onPause={handlePause}
                            />
                        )}

                        {/* Floating Reactions */}
                        {floatingReactions.map((r) => (
                            <div key={r.id} style={{ ...styles.floatingEmoji, left: `${r.x}%` }}>
                                {r.emoji}
                            </div>
                        ))}
                    </div>

                    {/* Reaction Bar */}
                    <div style={styles.reactionBar}>
                        {REACTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => sendReaction(emoji)} style={styles.reactionBtn}>
                                {emoji}
                            </button>
                        ))}
                    </div>

                    {/* Controls */}
                    <div style={styles.controls}>
                        <div style={styles.roomInfo}>
                            <span style={styles.roomLabel}>Room:</span>
                            <span style={styles.roomId}>{roomId}</span>
                        </div>
                        <div style={styles.buttonGroup}>
                            {/* Video Call Button */}
                            <button
                                onClick={callStarted ? stopVideoCall : startVideoCall}
                                style={{
                                    ...styles.controlBtn,
                                    backgroundColor: callStarted ? "#e74c3c" : "#27ae60",
                                }}
                            >
                                {callStarted ? "📵 Call End" : "📹 Video Call"}
                            </button>
                            <button onClick={copyLink} style={styles.controlBtn}>
                                {copied ? "✅ Copied!" : "🔗 Copy Link"}
                            </button>
                            <button
                                onClick={shareWhatsApp}
                                style={{ ...styles.controlBtn, backgroundColor: "#25D366" }}
                            >
                                💬 WhatsApp
                            </button>
                            <button
                                onClick={() => setShowChat(!showChat)}
                                style={{ ...styles.controlBtn, backgroundColor: "#ff6b35" }}
                            >
                                {showChat ? "💬 Hide Chat" : "💬 Show Chat"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right - Chat */}
                {showChat && (
                    <div style={styles.chatSection}>
                        <div style={styles.chatHeader}>
                            <span>💬 Chat</span>
                            <span style={styles.chatUser}>👤 {username}</span>
                        </div>
                        <div style={styles.messageList}>
                            {messages.length === 0 && (
                                <p style={styles.noMessages}>message இல்ல - first message பண்ணு! 👋</p>
                            )}
                            {messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    style={{
                                        ...styles.messageItem,
                                        alignSelf: msg.username === username ? "flex-end" : "flex-start",
                                        backgroundColor: msg.username === username ? "#ff6b35" : "#2a2a2a",
                                    }}
                                >
                                    {msg.username !== username && (
                                        <p style={styles.msgUsername}>{msg.username}</p>
                                    )}
                                    <p style={styles.msgText}>{msg.message}</p>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>
                        <div style={styles.chatInput}>
                            <input
                                type="text"
                                placeholder="Message type பண்ணு..."
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                onKeyPress={handleKeyPress}
                                style={styles.msgInput}
                            />
                            <button onClick={sendMessage} style={styles.sendBtn}>➤</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Local Video - உன் face */}
            {callStarted && (
                <div
                    style={{
                        ...styles.faceCamBox,
                        left: camPos.x,
                        top: camPos.y,
                        cursor: dragging ? "grabbing" : "grab",
                    }}
                    onMouseDown={onMouseDown}
                    onTouchStart={onTouchStart}
                >
                    <video
                        ref={localVideoRef}
                        autoPlay
                        muted
                        playsInline
                        style={styles.faceCamVideo}
                    />
                    <div style={styles.camLabel}>நீ (You)</div>
                    <button
                        onClick={stopVideoCall}
                        style={styles.closeCamBtn}
                        onMouseDown={(e) => e.stopPropagation()}
                    >✕</button>
                </div>
            )}

            {/* Remote Videos - Partner face */}
            {remoteParticipants.map((participant, index) => (
                <RemoteVideo
                    key={participant.session_id}
                    participant={participant}
                    index={index}
                />
            ))}

            <style>{`
                @keyframes floatUp {
                    0% { transform: translateY(0) scale(1); opacity: 1; }
                    100% { transform: translateY(-300px) scale(1.5); opacity: 0; }
                }
            `}</style>
        </div>
    );
}

// Remote Video Component - Partner face render பண்ண
function RemoteVideo({ participant, index }) {
    const videoRef = useRef(null);

    useEffect(() => {
        const track = participant.tracks?.video?.persistentTrack;
        if (track && videoRef.current) {
            videoRef.current.srcObject = new MediaStream([track]);
        }
    }, [participant.tracks?.video?.persistentTrack]);

    return (
        <div
            style={{
                position: "fixed",
                bottom: `${120 + index * 160}px`,
                right: "20px",
                width: "180px",
                height: "135px",
                borderRadius: "12px",
                overflow: "hidden",
                border: "2px solid #27ae60",
                zIndex: 998,
                backgroundColor: "#000",
            }}
        >
            <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            <div style={{
                position: "absolute",
                bottom: "4px",
                left: "8px",
                color: "white",
                fontSize: "11px",
                backgroundColor: "rgba(0,0,0,0.5)",
                padding: "2px 6px",
                borderRadius: "4px",
            }}>
                {participant.user_name || "Partner"} 👤
            </div>
        </div>
    );
}

const styles = {
    container: { backgroundColor: "#0f0f0f", minHeight: "100vh", display: "flex", flexDirection: "column", userSelect: "none" },
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
    faceCamBox: { position: "fixed", width: "180px", height: "135px", borderRadius: "12px", overflow: "hidden", border: "2px solid #ff6b35", zIndex: 999, backgroundColor: "#000" },
    faceCamVideo: { width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" },
    closeCamBtn: { position: "absolute", top: "4px", right: "4px", backgroundColor: "rgba(0,0,0,0.7)", color: "white", border: "none", borderRadius: "50%", width: "24px", height: "24px", cursor: "pointer", fontSize: "12px", zIndex: 1000 },
    camLabel: { position: "absolute", bottom: "4px", left: "8px", color: "white", fontSize: "11px", backgroundColor: "rgba(0,0,0,0.5)", padding: "2px 6px", borderRadius: "4px" },
};

export default Room;
