import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import {
    collection, query, where, onSnapshot,
    updateDoc, doc, addDoc, orderBy,
} from "firebase/firestore";
import {
    LiveKitRoom,
    useTracks,
    useLocalParticipant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";

const REACTIONS = ["❤️", "😂", "😮", "🔥", "👏", "😢"];

const getYouTubeId = (url) => {
    const match = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
};

// ✅ Fixed VideoTile
function VideoTile({ participant, local }) {
    const videoRef = useRef(null);
    const tracks = useTracks(
        [{ source: Track.Source.Camera, withPlaceholder: false }],
        { participant }
    );

    useEffect(() => {
        const track = tracks[0]?.publication?.track;
        if (track && videoRef.current) {
            track.attach(videoRef.current);
        }
        return () => {
            try {
                const track = tracks[0]?.publication?.track;
                if (track && videoRef.current) {
                    track.detach(videoRef.current);
                }
            } catch { }
        };
    }, [tracks[0]?.publication?.track]);

    if (!tracks[0]?.publication?.track) {
        return (
            <div style={{
                width: "180px",
                height: "135px",
                borderRadius: "12px",
                backgroundColor: "#111",
                border: `2px solid ${local ? "#ff6b35" : "#27ae60"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: "8px",
            }}>
                <span style={{ fontSize: "32px" }}>👤</span>
                <span style={{ color: "#666", fontSize: "12px" }}>
                    {local ? "நீ" : "Partner"}
                </span>
            </div>
        );
    }

    return (
        <div style={{
            position: "relative",
            width: "180px",
            height: "135px",
            borderRadius: "12px",
            overflow: "hidden",
            border: `2px solid ${local ? "#ff6b35" : "#27ae60"}`,
            backgroundColor: "#000",
        }}>
            <video
                ref={videoRef}
                autoPlay
                muted={local}
                playsInline
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: local ? "scaleX(-1)" : "none",
                }}
            />
            <div style={{
                position: "absolute",
                bottom: "4px",
                left: "8px",
                color: "white",
                fontSize: "11px",
                backgroundColor: "rgba(0,0,0,0.6)",
                padding: "2px 6px",
                borderRadius: "4px",
            }}>
                {local ? "நீ 👤" : `${participant?.identity || "Partner"} 👤`}
            </div>
        </div>
    );
}

// ✅ Fixed VideoCallUI - Local vs Remote properly separate
function VideoCallUI({ onEnd }) {
    const { localParticipant } = useLocalParticipant();
    const allTracks = useTracks(
        [{ source: Track.Source.Camera, withPlaceholder: false }],
    );

    // ✅ Local vs Remote தனித்தனியா separate
    const remoteTracks = allTracks.filter(
        (t) => t.participant.identity !== localParticipant?.identity
    );

    return (
        <div style={videoCallStyles.container}>
            <div style={videoCallStyles.header}>
                <span style={{ color: "white", fontSize: "14px" }}>
                    📹 Video Call {remoteTracks.length > 0 ? "✅ Connected!" : "⏳ Waiting..."}
                </span>
                <button onClick={onEnd} style={videoCallStyles.endBtn}>
                    📵 End
                </button>
            </div>
            <div style={videoCallStyles.videoGrid}>

                {/* ✅ உன் face மட்டும் - Left */}
                <div style={{ textAlign: "center" }}>
                    <p style={{ color: "#ff6b35", fontSize: "11px", margin: "0 0 4px 0" }}>
                        நீ 🟠
                    </p>
                    {localParticipant && (
                        <VideoTile participant={localParticipant} local={true} />
                    )}
                </div>

                {/* ✅ Partner face மட்டும் - Right */}
                <div style={{ textAlign: "center" }}>
                    <p style={{ color: "#27ae60", fontSize: "11px", margin: "0 0 4px 0" }}>
                        Partner 🟢
                    </p>
                    {remoteTracks.length > 0 ? (
                        <VideoTile
                            participant={remoteTracks[0].participant}
                            local={false}
                        />
                    ) : (
                        <div style={{
                            width: "180px",
                            height: "135px",
                            borderRadius: "12px",
                            backgroundColor: "#111",
                            border: "2px dashed #27ae60",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexDirection: "column",
                            gap: "8px",
                        }}>
                            <span style={{ fontSize: "32px" }}>👤</span>
                            <span style={{ color: "#666", fontSize: "11px", textAlign: "center", padding: "0 8px" }}>
                                Partner Video Call click பண்ண காத்திருக்கோம்
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const videoCallStyles = {
    container: {
        position: "fixed",
        bottom: "80px",
        right: "20px",
        width: "420px",
        backgroundColor: "#1a1a1a",
        borderRadius: "16px",
        border: "2px solid #27ae60",
        zIndex: 999,
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
    },
    header: {
        padding: "12px 16px",
        backgroundColor: "#111",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #333",
    },
    endBtn: {
        padding: "6px 14px",
        backgroundColor: "#e74c3c",
        color: "white",
        border: "none",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "13px",
    },
    videoGrid: {
        padding: "16px",
        display: "flex",
        gap: "12px",
        justifyContent: "center",
        alignItems: "flex-start",
    },
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
    const [livekitToken, setLivekitToken] = useState(null);
    const [showVideoCall, setShowVideoCall] = useState(false);
    const chatEndRef = useRef(null);

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
                if (!isSyncing) setIsPlaying(data.isPlaying);
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

    const updatePlayState = async (playing) => {
        if (!roomDocId) return;
        setIsSyncing(true);
        await updateDoc(doc(db, "rooms", roomDocId), { isPlaying: playing });
        setTimeout(() => setIsSyncing(false), 1000);
    };

    const handlePlay = async () => { setIsPlaying(true); await updatePlayState(true); };
    const handlePause = async () => { setIsPlaying(false); await updatePlayState(false); };

    const startVideoCall = async () => {
        try {
            const tokenServerUrl = import.meta.env.VITE_TOKEN_SERVER_URL;
            const response = await fetch(
                `${tokenServerUrl}/api/token?roomName=room-${roomId}&participantName=${username}`
            );
            const data = await response.json();
            setLivekitToken(data.token);
            setShowVideoCall(true);
        } catch (err) {
            alert("Video call start ஆகல: " + err.message);
        }
    };

    const endVideoCall = () => {
        setShowVideoCall(false);
        setLivekitToken(null);
    };

    const sendReaction = async (emoji) => {
        await addDoc(collection(db, "reactions"), {
            roomId, emoji, username, createdAt: new Date(),
        });
    };

    const sendMessage = async () => {
        if (!newMessage.trim()) return;
        await addDoc(collection(db, "chats"), {
            roomId, username, message: newMessage.trim(), createdAt: new Date(),
        });
        setNewMessage("");
    };

    const handleKeyPress = (e) => { if (e.key === "Enter") sendMessage(); };

    const copyLink = () => {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const shareWhatsApp = () => {
        const text = `🎬 என்னோட கூட movie பாரு! ${window.location.href}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    };

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
        <div style={styles.container}>
            <div style={styles.mainLayout}>
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
                        {floatingReactions.map((r) => (
                            <div key={r.id} style={{ ...styles.floatingEmoji, left: `${r.x}%` }}>
                                {r.emoji}
                            </div>
                        ))}
                    </div>

                    <div style={styles.reactionBar}>
                        {REACTIONS.map((emoji) => (
                            <button key={emoji} onClick={() => sendReaction(emoji)} style={styles.reactionBtn}>
                                {emoji}
                            </button>
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
                                style={{
                                    ...styles.controlBtn,
                                    backgroundColor: showVideoCall ? "#e74c3c" : "#27ae60",
                                }}
                            >
                                {showVideoCall ? "📵 Call End" : "📹 Video Call"}
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

            {/* ✅ LiveKit Video Call */}
            {showVideoCall && livekitToken && (
                <LiveKitRoom
                    token={livekitToken}
                    serverUrl={import.meta.env.VITE_LIVEKIT_URL}
                    connect={true}
                    video={true}
                    audio={true}
                    onDisconnected={endVideoCall}
                >
                    <VideoCallUI onEnd={endVideoCall} />
                </LiveKitRoom>
            )}

            <style>{`
                @keyframes floatUp {
                    0% { transform: translateY(0) scale(1); opacity: 1; }
                    100% { transform: translateY(-300px) scale(1.5); opacity: 0; }
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
};

export default Room;