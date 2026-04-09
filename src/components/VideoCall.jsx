// src/components/VideoCall.jsx
// LiveKit overlay for 1:1 and group calls.
import { useEffect, useMemo, useRef, useState } from "react";
import {
    LiveKitRoom,
    RoomAudioRenderer,
    useLocalParticipant,
    useRemoteParticipants,
    useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";

function RoomDisconnector({ onDisconnected }) {
    const room = useRoomContext();
    const onDisconnectedRef = useRef(onDisconnected);
    useEffect(() => { onDisconnectedRef.current = onDisconnected; }, [onDisconnected]);

    useEffect(() => {
        return () => {
            if (!room) return;
            try {
                room.localParticipant?.audioTrackPublications?.forEach((pub) => pub.track?.stop());
                room.localParticipant?.videoTrackPublications?.forEach((pub) => pub.track?.stop());
                room.disconnect(true);
            } catch (err) {
                console.error("[VideoCall] Cleanup error:", err);
            }
            onDisconnectedRef.current?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
}

function ParticipantTile({ participant, label, borderColor = "#27ae60", mirror = false }) {
    const videoRef = useRef(null);
    const attachedRef = useRef(false);

    useEffect(() => {
        if (!participant) return;
        attachedRef.current = false;

        const tryAttach = () => {
            if (attachedRef.current || !videoRef.current) return;
            for (const pub of participant.videoTrackPublications.values()) {
                const track = pub.videoTrack ?? pub.track;
                if (track && (participant.isLocal || pub.isSubscribed)) {
                    track.attach(videoRef.current);
                    attachedRef.current = true;
                    return;
                }
            }
        };

        tryAttach();
        const iv = setInterval(tryAttach, 700);
        const stopTimer = setTimeout(() => clearInterval(iv), 20000);

        participant.on("trackSubscribed", tryAttach);
        participant.on("trackPublished", tryAttach);
        participant.on("localTrackPublished", tryAttach);

        return () => {
            clearInterval(iv);
            clearTimeout(stopTimer);
            participant.off("trackSubscribed", tryAttach);
            participant.off("trackPublished", tryAttach);
            participant.off("localTrackPublished", tryAttach);
            try {
                for (const pub of participant.videoTrackPublications.values()) {
                    const track = pub.videoTrack ?? pub.track;
                    if (track && videoRef.current) track.detach(videoRef.current);
                }
            } catch (err) {
                console.error("[VideoCall] Track detach error:", err);
            }
            attachedRef.current = false;
        };
    }, [participant?.sid, participant]);

    const hasVideo = !!participant && Array.from(participant.videoTrackPublications.values()).length > 0;

    return (
        <div style={{ borderRadius: "10px", overflow: "hidden", border: `2px solid ${borderColor}`, backgroundColor: "#111", position: "relative", minHeight: "120px" }}>
            {hasVideo ? (
                <video
                    ref={videoRef}
                    autoPlay
                    muted={participant?.isLocal}
                    playsInline
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: mirror ? "scaleX(-1)" : "none",
                    }}
                />
            ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: "28px" }}>👤</span>
                </div>
            )}
            <div style={{ position: "absolute", bottom: "4px", left: "6px", color: "white", fontSize: "10px", backgroundColor: "rgba(0,0,0,0.65)", padding: "2px 6px", borderRadius: "4px" }}>
                {label}
            </div>
        </div>
    );
}

function CallUI({ isFullscreen, onEnd }) {
    const { localParticipant } = useLocalParticipant();
    const remoteParticipants = useRemoteParticipants();
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);

    const [pos, setPos] = useState({ x: 20, y: 60 });
    const dragging = useRef(false);
    const offset = useRef({ x: 0, y: 0 });

    useEffect(() => {
        if (isFullscreen) return;
        const onMM = (e) => {
            if (!dragging.current) return;
            setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
        };
        const onMU = () => { dragging.current = false; };
        const onTM = (e) => {
            if (!dragging.current) return;
            setPos({ x: e.touches[0].clientX - offset.current.x, y: e.touches[0].clientY - offset.current.y });
        };
        const onTE = () => { dragging.current = false; };
        window.addEventListener("mousemove", onMM);
        window.addEventListener("mouseup", onMU);
        window.addEventListener("touchmove", onTM);
        window.addEventListener("touchend", onTE);
        return () => {
            window.removeEventListener("mousemove", onMM);
            window.removeEventListener("mouseup", onMU);
            window.removeEventListener("touchmove", onTM);
            window.removeEventListener("touchend", onTE);
        };
    }, [isFullscreen]);

    const toggleMic = async () => {
        if (!localParticipant) return;
        await localParticipant.setMicrophoneEnabled(isMuted);
        setIsMuted(!isMuted);
    };
    const toggleCam = async () => {
        if (!localParticipant) return;
        await localParticipant.setCameraEnabled(isCamOff);
        setIsCamOff(!isCamOff);
    };

    const participantTiles = useMemo(() => {
        const arr = [];
        if (localParticipant) {
            arr.push(
                <ParticipantTile
                    key={`local-${localParticipant.sid}`}
                    participant={localParticipant}
                    label="நீ 🟠"
                    borderColor="#ff6b35"
                    mirror
                />
            );
        }
        remoteParticipants.forEach((p) => {
            arr.push(
                <ParticipantTile
                    key={p.sid}
                    participant={p}
                    label={`${p.identity || "Participant"} 🟢`}
                    borderColor="#27ae60"
                />
            );
        });
        return arr;
    }, [localParticipant, remoteParticipants]);

    const count = participantTiles.length;
    const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;

    const shellStyle = isFullscreen
        ? {
            position: "fixed",
            right: "18px",
            bottom: "18px",
            width: "min(560px, 92vw)",
            zIndex: 9999,
        }
        : {
            position: "fixed",
            left: pos.x,
            top: pos.y,
            width: "min(560px, 94vw)",
            zIndex: 9999,
        };

    return (
        <div style={{ ...shellStyle, backgroundColor: "#1a1a1a", borderRadius: "16px", border: "2px solid #27ae60", overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.9)", userSelect: "none" }}>
            <div
                onMouseDown={isFullscreen ? undefined : (e) => { dragging.current = true; offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; }}
                onTouchStart={isFullscreen ? undefined : (e) => { dragging.current = true; offset.current = { x: e.touches[0].clientX - pos.x, y: e.touches[0].clientY - pos.y }; }}
                style={{ padding: "10px 14px", backgroundColor: "#111", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #333", cursor: isFullscreen ? "default" : "grab" }}
            >
                <span style={{ color: "#777", fontSize: "12px" }}>{isFullscreen ? "Group Call" : "⠿ Drag"}</span>
                <span style={{ color: "white", fontSize: "13px", fontWeight: "bold" }}>📹 Video Call ({remoteParticipants.length + (localParticipant ? 1 : 0)})</span>
                <button onClick={onEnd} style={{ padding: "4px 10px", backgroundColor: "#e74c3c", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}>📵</button>
            </div>

            <div style={{ padding: "12px", maxHeight: isFullscreen ? "42vh" : "48vh", overflowY: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: "10px" }}>
                    {participantTiles}
                </div>
            </div>

            <div style={{ padding: "10px 12px", borderTop: "1px solid #333", display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={toggleMic} style={{ padding: "8px 14px", color: "white", border: "1px solid #444", borderRadius: "8px", cursor: "pointer", fontSize: "12px", backgroundColor: isMuted ? "#e74c3c" : "#2a2a2a" }}>{isMuted ? "🔇 Muted" : "🎤 Mic On"}</button>
                <button onClick={toggleCam} style={{ padding: "8px 14px", color: "white", border: "1px solid #444", borderRadius: "8px", cursor: "pointer", fontSize: "12px", backgroundColor: isCamOff ? "#e74c3c" : "#2a2a2a" }}>{isCamOff ? "📷 Cam Off" : "📸 Cam On"}</button>
                <button onClick={onEnd} style={{ padding: "8px 14px", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "12px", backgroundColor: "#e74c3c" }}>📵 End</button>
            </div>
        </div>
    );
}

export default function VideoCallRoom({ token, serverUrl, isFullscreen, onEnd }) {
    return (
        <LiveKitRoom token={token} serverUrl={serverUrl} connect={true} video={true} audio={true} onDisconnected={onEnd}>
            <RoomAudioRenderer />
            <RoomDisconnector onDisconnected={onEnd} />
            <CallUI isFullscreen={isFullscreen} onEnd={onEnd} />
        </LiveKitRoom>
    );
}

