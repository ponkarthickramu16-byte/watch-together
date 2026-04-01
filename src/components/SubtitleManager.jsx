// src/components/SubtitleManager.jsx
import { useState, useEffect, useRef } from "react";
import { db } from "../firebase";
import { doc, updateDoc, arrayUnion, arrayRemove, getDoc } from "firebase/firestore";
import { uploadToCloudinary } from "../cloudinary";

/**
 * SubtitleManager Component
 * Features:
 * - Upload .srt, .vtt, .ass subtitle files
 * - Multiple language support
 * - Custom subtitle styling (size, color, position)
 * - Sync across all users in room
 * - Parse and display subtitles in real-time
 */

const parseSRT = (srtText) => {
    const blocks = srtText.trim().split(/\n\n+/);
    const subtitles = [];
    
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 3) continue;
        
        const timeLine = lines[1];
        const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
        
        if (!timeMatch) continue;
        
        const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + 
                         parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
        const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + 
                       parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
        
        const text = lines.slice(2).join('\n');
        
        subtitles.push({ start: startTime, end: endTime, text });
    }
    
    return subtitles;
};

const parseVTT = (vttText) => {
    const lines = vttText.split('\n');
    const subtitles = [];
    let i = 0;
    
    // Skip WEBVTT header
    while (i < lines.length && !lines[i].includes('-->')) i++;
    
    while (i < lines.length) {
        const line = lines[i].trim();
        
        if (line.includes('-->')) {
            const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
            
            if (timeMatch) {
                const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + 
                                parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
                const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + 
                              parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
                
                i++;
                const textLines = [];
                while (i < lines.length && lines[i].trim() !== '') {
                    textLines.push(lines[i].trim());
                    i++;
                }
                
                subtitles.push({ start: startTime, end: endTime, text: textLines.join('\n') });
            }
        }
        i++;
    }
    
    return subtitles;
};

export function SubtitleManager({ roomId, roomDocId, currentTime, isYouTube, T }) {
    const [subtitles, setSubtitles] = useState([]);
    const [activeSubtitle, setActiveSubtitle] = useState(null);
    const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [selectedLanguage, setSelectedLanguage] = useState(null);
    
    // Subtitle styling
    const [fontSize, setFontSize] = useState(18);
    const [fontColor, setFontColor] = useState('#FFFFFF');
    const [bgColor, setBgColor] = useState('rgba(0,0,0,0.7)');
    const [position, setPosition] = useState('bottom'); // 'top', 'bottom', 'middle'
    
    const fileInputRef = useRef(null);

    // Find active subtitle based on current time
    useEffect(() => {
        if (!selectedLanguage) {
            setActiveSubtitle(null);
            return;
        }
        
        const currentSubs = subtitles.find(s => s.language === selectedLanguage);
        if (!currentSubs) {
            setActiveSubtitle(null);
            return;
        }
        
        const active = currentSubs.cues.find(cue => 
            currentTime >= cue.start && currentTime <= cue.end
        );
        
        setActiveSubtitle(active || null);
    }, [currentTime, selectedLanguage, subtitles]);

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['srt', 'vtt', 'ass'].includes(ext)) {
            alert('Only .srt, .vtt, .ass files supported!');
            return;
        }
        
        setUploading(true);
        
        try {
            // Read file content
            const text = await file.text();
            
            // Parse based on format
            let cues = [];
            if (ext === 'srt') {
                cues = parseSRT(text);
            } else if (ext === 'vtt') {
                cues = parseVTT(text);
            } else {
                // .ass format - basic parsing
                cues = parseSRT(text); // Fallback to SRT parser
            }
            
            // Detect language from filename
            const langMatch = file.name.match(/\.(en|ta|hi|es|fr|de|ja|ko|zh)\.(?:srt|vtt|ass)$/i);
            const language = langMatch ? langMatch[1].toLowerCase() : 
                            prompt('Enter subtitle language (en/ta/hi/es/fr):') || 'en';
            
            const languageNames = {
                'en': 'English',
                'ta': 'தமிழ்',
                'hi': 'हिंदी',
                'es': 'Español',
                'fr': 'Français',
                'de': 'Deutsch',
                'ja': '日本語',
                'ko': '한국어',
                'zh': '中文'
            };
            
            const subtitleData = {
                language,
                languageName: languageNames[language] || language,
                filename: file.name,
                cues,
                uploadedAt: new Date(),
                uploadedBy: localStorage.getItem('username') || 'User'
            };
            
            // Update room with subtitle data
            const roomRef = doc(db, "rooms", roomDocId || roomId);
            await updateDoc(roomRef, {
                subtitles: arrayUnion(subtitleData)
            });
            
            setSubtitles(prev => [...prev, subtitleData]);
            setSelectedLanguage(language);
            
            alert(`✅ ${languageNames[language]} subtitle uploaded!`);
        } catch (err) {
            console.error('Subtitle upload error:', err);
            alert('❌ Upload failed: ' + err.message);
        } finally {
            setUploading(false);
        }
    };

    const removeSubtitle = async (language) => {
        const toRemove = subtitles.find(s => s.language === language);
        if (!toRemove) return;
        
        try {
            const roomRef = doc(db, "rooms", roomDocId || roomId);
            await updateDoc(roomRef, {
                subtitles: arrayRemove(toRemove)
            });
            
            setSubtitles(prev => prev.filter(s => s.language !== language));
            if (selectedLanguage === language) setSelectedLanguage(null);
        } catch (err) {
            alert('❌ Remove failed: ' + err.message);
        }
    };

    // Load subtitles from room data
    useEffect(() => {
        const loadSubtitles = async () => {
            try {
                const roomRef = doc(db, "rooms", roomDocId || roomId);
                const snapshot = await getDoc(roomRef);
                if (snapshot.exists() && snapshot.data().subtitles) {
                    setSubtitles(snapshot.data().subtitles);
                }
            } catch (err) {
                console.error('Load subtitles error:', err);
            }
        };
        
        if (roomDocId || roomId) loadSubtitles();
    }, [roomId, roomDocId]);

    const positionStyle = {
        top: { top: '10%' },
        middle: { top: '50%', transform: 'translateY(-50%)' },
        bottom: { bottom: '10%' }
    }[position] || { bottom: '10%' };

    return (
        <>
            {/* Subtitle Display Overlay */}
            {activeSubtitle && (
                <div style={{
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    ...positionStyle,
                    padding: '8px 16px',
                    backgroundColor: bgColor,
                    color: fontColor,
                    fontSize: `${fontSize}px`,
                    fontWeight: 'bold',
                    borderRadius: '6px',
                    maxWidth: '80%',
                    textAlign: 'center',
                    zIndex: 100,
                    pointerEvents: 'none',
                    lineHeight: 1.4,
                    textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                    whiteSpace: 'pre-wrap'
                }}>
                    {activeSubtitle.text}
                </div>
            )}

            {/* Subtitle Control Button */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
                <button 
                    onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
                    style={{
                        padding: '8px 14px',
                        backgroundColor: selectedLanguage ? '#ff6b35' : T.card2,
                        color: selectedLanguage ? 'white' : T.text2,
                        border: `1px solid ${selectedLanguage ? '#ff6b35' : T.border}`,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}
                >
                    <span>📝</span>
                    <span>{selectedLanguage ? 'CC' : 'Subtitles'}</span>
                </button>

                {/* Subtitle Menu */}
                {showSubtitleMenu && (
                    <div style={{
                        position: 'absolute',
                        bottom: '48px',
                        right: 0,
                        backgroundColor: T.card,
                        border: `1px solid ${T.border}`,
                        borderRadius: '12px',
                        padding: '12px',
                        minWidth: '280px',
                        maxHeight: '400px',
                        overflowY: 'auto',
                        zIndex: 1000,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{ marginBottom: '12px', paddingBottom: '8px', borderBottom: `1px solid ${T.border}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span style={{ color: T.text, fontSize: '14px', fontWeight: 'bold' }}>
                                    📝 Subtitles
                                </span>
                                <button 
                                    onClick={() => setShowSubtitleMenu(false)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: T.text3,
                                        cursor: 'pointer',
                                        fontSize: '18px'
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        {/* Available Subtitles */}
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ color: T.text3, fontSize: '11px', display: 'block', marginBottom: '6px' }}>
                                AVAILABLE
                            </label>
                            
                            {subtitles.length === 0 && (
                                <p style={{ color: T.text3, fontSize: '12px', margin: '8px 0' }}>
                                    No subtitles uploaded yet
                                </p>
                            )}
                            
                            {subtitles.map(sub => (
                                <div key={sub.language} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '8px',
                                    backgroundColor: selectedLanguage === sub.language ? 'rgba(255,107,53,0.2)' : T.card2,
                                    borderRadius: '6px',
                                    marginBottom: '4px',
                                    cursor: 'pointer'
                                }}
                                onClick={() => setSelectedLanguage(selectedLanguage === sub.language ? null : sub.language)}
                                >
                                    <div style={{ flex: 1 }}>
                                        <div style={{ color: T.text, fontSize: '13px', fontWeight: 'bold' }}>
                                            {selectedLanguage === sub.language ? '✓ ' : ''}{sub.languageName}
                                        </div>
                                        <div style={{ color: T.text3, fontSize: '10px' }}>
                                            {sub.cues.length} cues • {sub.uploadedBy}
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); removeSubtitle(sub.language); }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: '#e74c3c',
                                            cursor: 'pointer',
                                            fontSize: '16px',
                                            padding: '4px'
                                        }}
                                    >
                                        🗑️
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Upload Button */}
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            style={{
                                width: '100%',
                                padding: '10px',
                                backgroundColor: '#ff6b35',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: uploading ? 'not-allowed' : 'pointer',
                                fontSize: '13px',
                                fontWeight: 'bold',
                                marginBottom: '12px'
                            }}
                        >
                            {uploading ? '⏳ Uploading...' : '📤 Upload Subtitle'}
                        </button>
                        
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".srt,.vtt,.ass"
                            onChange={handleFileUpload}
                            style={{ display: 'none' }}
                        />

                        {/* Subtitle Styling */}
                        {selectedLanguage && (
                            <div style={{ paddingTop: '12px', borderTop: `1px solid ${T.border}` }}>
                                <label style={{ color: T.text3, fontSize: '11px', display: 'block', marginBottom: '8px' }}>
                                    CUSTOMIZE
                                </label>
                                
                                {/* Font Size */}
                                <div style={{ marginBottom: '8px' }}>
                                    <label style={{ color: T.text2, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                                        Font Size: {fontSize}px
                                    </label>
                                    <input
                                        type="range"
                                        min="12"
                                        max="36"
                                        value={fontSize}
                                        onChange={(e) => setFontSize(parseInt(e.target.value))}
                                        style={{ width: '100%' }}
                                    />
                                </div>

                                {/* Position */}
                                <div style={{ marginBottom: '8px' }}>
                                    <label style={{ color: T.text2, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                                        Position
                                    </label>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        {['top', 'middle', 'bottom'].map(pos => (
                                            <button
                                                key={pos}
                                                onClick={() => setPosition(pos)}
                                                style={{
                                                    flex: 1,
                                                    padding: '6px',
                                                    backgroundColor: position === pos ? '#ff6b35' : T.card2,
                                                    color: position === pos ? 'white' : T.text2,
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    fontSize: '11px'
                                                }}
                                            >
                                                {pos}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Colors */}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ color: T.text2, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                                            Text
                                        </label>
                                        <input
                                            type="color"
                                            value={fontColor}
                                            onChange={(e) => setFontColor(e.target.value)}
                                            style={{ width: '100%', height: '32px', borderRadius: '6px', cursor: 'pointer' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ color: T.text2, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                                            Background
                                        </label>
                                        <select
                                            value={bgColor}
                                            onChange={(e) => setBgColor(e.target.value)}
                                            style={{
                                                width: '100%',
                                                height: '32px',
                                                backgroundColor: T.card2,
                                                color: T.text,
                                                border: `1px solid ${T.border}`,
                                                borderRadius: '6px',
                                                fontSize: '11px'
                                            }}
                                        >
                                            <option value="rgba(0,0,0,0.7)">Black</option>
                                            <option value="rgba(0,0,0,0)">None</option>
                                            <option value="rgba(255,255,255,0.2)">White</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

export default SubtitleManager;
