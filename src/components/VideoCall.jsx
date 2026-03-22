// src/components/VideoCall.jsx
// All LiveKit code isolated here — lazy loaded to prevent circular dep TDZ crash

import { useState, useEffect, useRef } from "react";
import {
    LiveKitRoom,
    useLocalParticipant,
    useRemoteParticipants,
    RoomAudioRenderer,
    useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";

// ── RoomDisconnector ──────────────────────────────────────────────────────────
function RoomDisconnector({ onDisconnected }) {
    const room = useRoomContext();
    const onDisconnectedRef = useRef(onDisconnected);
    useEffect(() => { onDisconnectedRef.current = onDisconnected; }, [onDisconnected]);
    useEffect(() => {
        return () => {
            if (!room) return;
            try {
                room.localParticipant?.audioTrackPublications?.forEach(pub => pub.track?.stop());
                room.localParticipant?.videoTrackPublications?.forEach(pub => pub.track?.stop());
                room.disconnect(true);
            } catch { }
            onDisconnectedRef.current?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
}

// ── LocalVideo ────────────────────────────────────────────────────────────────
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
        const stopTimer = setTimeout(() => clearInterval(iv), 15000);
        localParticipant.on("localTrackPublished", tryAttach);
        localParticipant.on("trackPublished", tryAttach);
        return () => {
            clearInterval(iv); clearTimeout(stopTimer);
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

// ── RemoteVideo ───────────────────────────────────────────────────────────────
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
        const stopTimer = setTimeout(() => clearInterval(iv), 20000);
        remoteParticipant.on("trackSubscribed", tryAttach);
        remoteParticipant.on("trackPublished", tryAttach);
        return () => {
            clearInterval(iv); clearTimeout(stopTimer);
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

// ── FullscreenFaceBar ─────────────────────────────────────────────────────────
function FullscreenFaceBar({ onEnd, isMuted, isCamOff, onToggleMic, onToggleCam }) {
    return (
        <div style={{ position: "fixed", bottom: "24px", right: "24px", display: "flex", flexDirection: "column", gap: "8px", zIndex: 9999, alignItems: "flex-end" }}>
            <div style={{ display: "flex", gap: "6px" }}><LocalVideo small /><RemoteVideo small /></div>
            <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={onToggleMic} style={{ padding: "6px 12px", color: "white", border: "none", borderRadius: "16px", cursor: "pointer", fontSize: "12px", backgroundColor: isMuted ? "#e74c3c" : "rgba(0,0,0,0.75)" }}>{isMuted ? "🔇" : "🎤"}</button>
                <button onClick={onToggleCam} style={{ padding: "6px 12px", color: "white", border: "none", borderRadius: "16px", cursor: "pointer", fontSize: "12px", backgroundColor: isCamOff ? "#e74c3c" : "rgba(0,0,0,0.75)" }}>{isCamOff ? "📷" : "📸"}</button>
                <button onClick={onEnd} style={{ padding: "6px 12px", color: "white", border: "none", borderRadius: "16px", cursor: "pointer", fontSize: "12px", backgroundColor: "#e74c3c" }}>📵</button>
            </div>
        </div>
    );
}

// ── NormalCallPopup ───────────────────────────────────────────────────────────
function NormalCallPopup({ onEnd, isMuted, isCamOff, onToggleMic, onToggleCam }) {
    const [pos, setPos] = useState({ x: 20, y: 60 });
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

// ── CallUI ────────────────────────────────────────────────────────────────────
function CallUI({ isFullscreen, onEnd }) {
    const { localParticipant } = useLocalParticipant();
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const toggleMic = async () => { if (localParticipant) { await localParticipant.setMicrophoneEnabled(isMuted); setIsMuted(!isMuted); } };
    const toggleCam = async () => { if (localParticipant) { await localParticipant.setCameraEnabled(isCamOff); setIsCamOff(!isCamOff); } };
    return isFullscreen
        ? <FullscreenFaceBar onEnd={onEnd} isMuted={isMuted} isCamOff={isCamOff} onToggleMic={toggleMic} onToggleCam={toggleCam} />
        : <NormalCallPopup onEnd={onEnd} isMuted={isMuted} isCamOff={isCamOff} onToggleMic={toggleMic} onToggleCam={toggleCam} />;
}

// ── Main export: VideoCallRoom ────────────────────────────────────────────────
export default function VideoCallRoom({ token, serverUrl, isFullscreen, onEnd }) {
    return (
        <LiveKitRoom token={token} serverUrl={serverUrl} connect={true} video={true} audio={true} onDisconnected={onEnd}>
            <RoomAudioRenderer />
            <RoomDisconnector onDisconnected={onEnd} />
            <CallUI isFullscreen={isFullscreen} onEnd={onEnd} />
        </LiveKitRoom>
    );
}