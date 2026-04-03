// src/components/ResizableChatLayout.jsx
import { useState, useRef, useEffect } from "react";

/**
 * ResizableChatLayout Component
 * 
 * Problem: Chat box either covers video or pushes it up when messages increase
 * Solution: Split-screen layout with resizable divider
 * 
 * Features:
 * - Drag divider to resize video/chat areas
 * - Remember user's preferred split ratio
 * - Toggle fullscreen video
 * - Toggle chat visibility
 * - Mobile responsive (stacks vertically)
 * - Smooth animations
 */

export function ResizableChatLayout({ 
    videoContent,  // Video player JSX
    chatContent,   // Chat box JSX
    defaultSplit = 60, // Video takes 60% by default
    minVideoHeight = 200, // Minimum video height in pixels
    minChatHeight = 150,  // Minimum chat height in pixels
    onSplitChange,  // Callback when split ratio changes
    T  // Theme colors
}) {
    const [splitRatio, setSplitRatio] = useState(() => {
        // Load saved preference from localStorage
        const saved = localStorage.getItem('watchTogether_splitRatio');
        return saved ? parseInt(saved) : defaultSplit;
    });
    
    const [isDragging, setIsDragging] = useState(false);
    const [showChat, setShowChat] = useState(true);
    const [isVideoFullscreen, setIsVideoFullscreen] = useState(false);
    const containerRef = useRef(null);
    const dragStartY = useRef(0);
    const dragStartRatio = useRef(splitRatio);

    // Save split ratio preference
    useEffect(() => {
        localStorage.setItem('watchTogether_splitRatio', splitRatio.toString());
        if (onSplitChange) {
            onSplitChange(splitRatio);
        }
    }, [splitRatio, onSplitChange]);

    // Handle drag start
    const handleDragStart = (e) => {
        e.preventDefault();
        setIsDragging(true);
        dragStartY.current = e.type === 'mousedown' ? e.clientY : e.touches[0].clientY;
        dragStartRatio.current = splitRatio;
        
        // Add event listeners
        if (e.type === 'mousedown') {
            document.addEventListener('mousemove', handleDragMove);
            document.addEventListener('mouseup', handleDragEnd);
        } else {
            document.addEventListener('touchmove', handleDragMove);
            document.addEventListener('touchend', handleDragEnd);
        }
    };

    // Handle drag move
    const handleDragMove = (e) => {
        if (!containerRef.current) return;
        
        const containerRect = containerRef.current.getBoundingClientRect();
        const containerHeight = containerRect.height;
        const currentY = e.type === 'mousemove' ? e.clientY : e.touches[0].clientY;
        const deltaY = currentY - dragStartY.current;
        const deltaPercent = (deltaY / containerHeight) * 100;
        
        let newRatio = dragStartRatio.current + deltaPercent;
        
        // Enforce minimum heights
        const minVideoPercent = (minVideoHeight / containerHeight) * 100;
        const maxVideoPercent = 100 - ((minChatHeight / containerHeight) * 100);
        
        newRatio = Math.max(minVideoPercent, Math.min(maxVideoPercent, newRatio));
        
        setSplitRatio(Math.round(newRatio));
    };

    // Handle drag end
    const handleDragEnd = () => {
        setIsDragging(false);
        
        // Remove event listeners
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
        document.removeEventListener('touchmove', handleDragMove);
        document.removeEventListener('touchend', handleDragEnd);
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleDragMove);
            document.removeEventListener('mouseup', handleDragEnd);
            document.removeEventListener('touchmove', handleDragMove);
            document.removeEventListener('touchend', handleDragEnd);
        };
    }, []);

    // Quick resize presets
    const setPreset = (ratio) => {
        setSplitRatio(ratio);
    };

    // Toggle video fullscreen
    const toggleVideoFullscreen = () => {
        setIsVideoFullscreen(!isVideoFullscreen);
    };

    // Toggle chat visibility
    const toggleChat = () => {
        setShowChat(!showChat);
    };

    return (
        <div 
            ref={containerRef}
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            {/* Control Bar */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                backgroundColor: T.card,
                borderBottom: `1px solid ${T.border}`,
                gap: '8px',
                flexWrap: 'wrap'
            }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ color: T.text3, fontSize: '11px', fontWeight: 'bold' }}>
                        LAYOUT:
                    </span>
                    <button
                        onClick={() => setPreset(70)}
                        style={{
                            padding: '4px 10px',
                            backgroundColor: splitRatio >= 65 && splitRatio <= 75 ? T.primary : T.card2,
                            color: splitRatio >= 65 && splitRatio <= 75 ? 'white' : T.text,
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '11px'
                        }}
                    >
                        📺 Big Video
                    </button>
                    <button
                        onClick={() => setPreset(50)}
                        style={{
                            padding: '4px 10px',
                            backgroundColor: splitRatio >= 45 && splitRatio <= 55 ? T.primary : T.card2,
                            color: splitRatio >= 45 && splitRatio <= 55 ? 'white' : T.text,
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '11px'
                        }}
                    >
                        ⚖️ Equal
                    </button>
                    <button
                        onClick={() => setPreset(30)}
                        style={{
                            padding: '4px 10px',
                            backgroundColor: splitRatio >= 25 && splitRatio <= 35 ? T.primary : T.card2,
                            color: splitRatio >= 25 && splitRatio <= 35 ? 'white' : T.text,
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '11px'
                        }}
                    >
                        💬 Big Chat
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                        onClick={toggleVideoFullscreen}
                        style={{
                            padding: '4px 10px',
                            backgroundColor: isVideoFullscreen ? T.primary : T.card2,
                            color: isVideoFullscreen ? 'white' : T.text,
                            border: `1px solid ${T.border}`,
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 'bold'
                        }}
                    >
                        {isVideoFullscreen ? '⬇️ Exit' : '⬆️ Video Only'}
                    </button>
                    <button
                        onClick={toggleChat}
                        style={{
                            padding: '4px 10px',
                            backgroundColor: showChat ? T.primary : T.card2,
                            color: showChat ? 'white' : T.text,
                            border: `1px solid ${T.border}`,
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 'bold'
                        }}
                    >
                        {showChat ? '💬 Chat' : '💬 Show'}
                    </button>
                </div>
            </div>

            {/* Video Area */}
            <div style={{
                height: isVideoFullscreen ? '100%' : `${splitRatio}%`,
                minHeight: isVideoFullscreen ? 'auto' : `${minVideoHeight}px`,
                overflow: 'hidden',
                backgroundColor: '#000',
                position: 'relative',
                transition: isDragging ? 'none' : 'height 0.2s ease'
            }}>
                {videoContent}
            </div>

            {/* Resizable Divider */}
            {!isVideoFullscreen && showChat && (
                <div
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                    style={{
                        height: '8px',
                        backgroundColor: isDragging ? T.primary : T.border,
                        cursor: 'ns-resize',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        zIndex: 10,
                        transition: isDragging ? 'none' : 'background-color 0.2s ease',
                        userSelect: 'none'
                    }}
                    onMouseEnter={(e) => {
                        if (!isDragging) {
                            e.currentTarget.style.backgroundColor = T.primary;
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (!isDragging) {
                            e.currentTarget.style.backgroundColor = T.border;
                        }
                    }}
                >
                    <div style={{
                        width: '40px',
                        height: '4px',
                        backgroundColor: isDragging ? 'white' : T.text3,
                        borderRadius: '2px'
                    }} />
                </div>
            )}

            {/* Chat Area */}
            {!isVideoFullscreen && showChat && (
                <div style={{
                    height: `${100 - splitRatio}%`,
                    minHeight: `${minChatHeight}px`,
                    overflow: 'hidden',
                    backgroundColor: T.bg,
                    display: 'flex',
                    flexDirection: 'column',
                    transition: isDragging ? 'none' : 'height 0.2s ease'
                }}>
                    {chatContent}
                </div>
            )}

            {/* Drag Indicator */}
            {isDragging && (
                <div style={{
                    position: 'absolute',
                    top: `${splitRatio}%`,
                    left: 0,
                    right: 0,
                    height: '2px',
                    backgroundColor: T.primary,
                    boxShadow: '0 0 10px rgba(255,107,53,0.5)',
                    pointerEvents: 'none',
                    zIndex: 100
                }} />
            )}
        </div>
    );
}

export default ResizableChatLayout;
