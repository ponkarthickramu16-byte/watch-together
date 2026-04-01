// src/components/PlaybackControls.jsx
import { useState, useEffect } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * PlaybackControls Component
 * Features:
 * - Playback speed control (0.25x to 2x)
 * - Video quality selection (for uploaded videos)
 * - YouTube quality hints (auto, 480p, 720p, 1080p)
 * - Sync settings across all room participants
 */

export function PlaybackControls({ 
    roomId, 
    roomDocId, 
    isYouTube, 
    videoRef, 
    iframeRef,
    playbackRate = 1,
    quality = 'auto',
    onPlaybackRateChange,
    onQualityChange,
    T 
}) {
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [showQualityMenu, setShowQualityMenu] = useState(false);
    const [currentSpeed, setCurrentSpeed] = useState(playbackRate);
    const [currentQuality, setCurrentQuality] = useState(quality);

    const SPEED_OPTIONS = [
        { value: 0.25, label: '0.25x' },
        { value: 0.5, label: '0.5x' },
        { value: 0.75, label: '0.75x' },
        { value: 1, label: 'Normal' },
        { value: 1.25, label: '1.25x' },
        { value: 1.5, label: '1.5x' },
        { value: 1.75, label: '1.75x' },
        { value: 2, label: '2x' }
    ];

    const QUALITY_OPTIONS = [
        { value: 'auto', label: 'Auto', description: 'Best for connection' },
        { value: '480p', label: '480p', description: 'Data saver' },
        { value: '720p', label: '720p', description: 'HD' },
        { value: '1080p', label: '1080p', description: 'Full HD' },
        { value: '1440p', label: '1440p', description: '2K' },
        { value: '2160p', label: '2160p', description: '4K' }
    ];

    // Sync speed from props
    useEffect(() => {
        setCurrentSpeed(playbackRate);
    }, [playbackRate]);

    // Sync quality from props
    useEffect(() => {
        setCurrentQuality(quality);
    }, [quality]);

    const handleSpeedChange = async (speed) => {
        setCurrentSpeed(speed);
        setShowSpeedMenu(false);

        try {
            // Update Firebase
            const roomRef = doc(db, "rooms", roomDocId || roomId);
            await updateDoc(roomRef, {
                playbackRate: speed,
                playbackRateUpdatedAt: new Date()
            });

            // Apply to video element
            if (isYouTube && iframeRef?.current) {
                // YouTube API command
                try {
                    iframeRef.current.contentWindow?.postMessage(
                        JSON.stringify({
                            event: 'command',
                            func: 'setPlaybackRate',
                            args: [speed]
                        }),
                        '*'
                    );
                } catch (err) {
                    console.error('YouTube speed change error:', err);
                }
            } else if (videoRef?.current) {
                // HTML5 video
                videoRef.current.playbackRate = speed;
            }

            // Callback
            if (onPlaybackRateChange) {
                onPlaybackRateChange(speed);
            }
        } catch (err) {
            console.error('Speed change error:', err);
            alert('❌ Speed change failed: ' + err.message);
        }
    };

    const handleQualityChange = async (qualityValue) => {
        setCurrentQuality(qualityValue);
        setShowQualityMenu(false);

        try {
            // Update Firebase
            const roomRef = doc(db, "rooms", roomDocId || roomId);
            await updateDoc(roomRef, {
                quality: qualityValue,
                qualityUpdatedAt: new Date()
            });

            // Apply quality
            if (isYouTube && iframeRef?.current) {
                // YouTube quality levels mapping
                const qualityMap = {
                    '2160p': 'highres',
                    '1440p': 'hd1440',
                    '1080p': 'hd1080',
                    '720p': 'hd720',
                    '480p': 'large',
                    'auto': 'default'
                };

                try {
                    iframeRef.current.contentWindow?.postMessage(
                        JSON.stringify({
                            event: 'command',
                            func: 'setPlaybackQuality',
                            args: [qualityMap[qualityValue] || 'default']
                        }),
                        '*'
                    );
                } catch (err) {
                    console.error('YouTube quality change error:', err);
                }
            } else if (videoRef?.current) {
                // For uploaded videos, this would require multiple quality versions
                // This is a placeholder - actual implementation needs video transcoding
                console.log('Quality change for uploaded video:', qualityValue);
                // You would need to have different quality URLs stored and switch between them
            }

            // Callback
            if (onQualityChange) {
                onQualityChange(qualityValue);
            }
        } catch (err) {
            console.error('Quality change error:', err);
            alert('❌ Quality change failed: ' + err.message);
        }
    };

    return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Playback Speed Control */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
                <button
                    onClick={() => {
                        setShowSpeedMenu(!showSpeedMenu);
                        setShowQualityMenu(false);
                    }}
                    style={{
                        padding: '8px 14px',
                        backgroundColor: currentSpeed !== 1 ? '#ff6b35' : T.card2,
                        color: currentSpeed !== 1 ? 'white' : T.text2,
                        border: `1px solid ${currentSpeed !== 1 ? '#ff6b35' : T.border}`,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        minWidth: '85px',
                        justifyContent: 'center'
                    }}
                >
                    <span>⚡</span>
                    <span>{currentSpeed === 1 ? 'Speed' : `${currentSpeed}x`}</span>
                </button>

                {showSpeedMenu && (
                    <div style={{
                        position: 'absolute',
                        bottom: '48px',
                        left: 0,
                        backgroundColor: T.card,
                        border: `1px solid ${T.border}`,
                        borderRadius: '12px',
                        padding: '8px',
                        minWidth: '140px',
                        zIndex: 1000,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: '8px',
                            paddingBottom: '8px',
                            borderBottom: `1px solid ${T.border}`
                        }}>
                            <span style={{ color: T.text, fontSize: '13px', fontWeight: 'bold' }}>
                                ⚡ Playback Speed
                            </span>
                            <button
                                onClick={() => setShowSpeedMenu(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: T.text3,
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    padding: '0'
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {SPEED_OPTIONS.map(option => (
                                <button
                                    key={option.value}
                                    onClick={() => handleSpeedChange(option.value)}
                                    style={{
                                        padding: '8px 12px',
                                        backgroundColor: currentSpeed === option.value ? '#ff6b35' : T.card2,
                                        color: currentSpeed === option.value ? 'white' : T.text,
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        fontWeight: currentSpeed === option.value ? 'bold' : 'normal',
                                        textAlign: 'left',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <span>{option.label}</span>
                                    {currentSpeed === option.value && <span>✓</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Video Quality Control */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
                <button
                    onClick={() => {
                        setShowQualityMenu(!showQualityMenu);
                        setShowSpeedMenu(false);
                    }}
                    style={{
                        padding: '8px 14px',
                        backgroundColor: currentQuality !== 'auto' ? '#3498db' : T.card2,
                        color: currentQuality !== 'auto' ? 'white' : T.text2,
                        border: `1px solid ${currentQuality !== 'auto' ? '#3498db' : T.border}`,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        minWidth: '90px',
                        justifyContent: 'center'
                    }}
                >
                    <span>🎬</span>
                    <span>{currentQuality === 'auto' ? 'Quality' : currentQuality}</span>
                </button>

                {showQualityMenu && (
                    <div style={{
                        position: 'absolute',
                        bottom: '48px',
                        left: 0,
                        backgroundColor: T.card,
                        border: `1px solid ${T.border}`,
                        borderRadius: '12px',
                        padding: '8px',
                        minWidth: '180px',
                        zIndex: 1000,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: '8px',
                            paddingBottom: '8px',
                            borderBottom: `1px solid ${T.border}`
                        }}>
                            <span style={{ color: T.text, fontSize: '13px', fontWeight: 'bold' }}>
                                🎬 Video Quality
                            </span>
                            <button
                                onClick={() => setShowQualityMenu(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: T.text3,
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    padding: '0'
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        {!isYouTube && (
                            <div style={{
                                backgroundColor: 'rgba(243,156,18,0.15)',
                                border: '1px solid rgba(243,156,18,0.4)',
                                borderRadius: '8px',
                                padding: '8px',
                                marginBottom: '8px'
                            }}>
                                <p style={{ color: '#f39c12', fontSize: '11px', margin: 0 }}>
                                    ⚠️ Quality control works best with YouTube videos
                                </p>
                            </div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {QUALITY_OPTIONS.map(option => (
                                <button
                                    key={option.value}
                                    onClick={() => handleQualityChange(option.value)}
                                    style={{
                                        padding: '8px 12px',
                                        backgroundColor: currentQuality === option.value ? '#3498db' : T.card2,
                                        color: currentQuality === option.value ? 'white' : T.text,
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                        textAlign: 'left',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '2px'
                                    }}
                                >
                                    <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                        <span style={{ fontWeight: currentQuality === option.value ? 'bold' : 'normal' }}>
                                            {option.label}
                                        </span>
                                        {currentQuality === option.value && <span>✓</span>}
                                    </div>
                                    <span style={{ 
                                        fontSize: '10px', 
                                        color: currentQuality === option.value ? 'rgba(255,255,255,0.8)' : T.text3 
                                    }}>
                                        {option.description}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default PlaybackControls;
