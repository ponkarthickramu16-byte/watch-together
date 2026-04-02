// src/components/ThemeCustomizer.jsx
import { useState, useEffect } from "react";
import { db } from "../firebase";
import { doc, updateDoc, getDoc } from "firebase/firestore";

/**
 * ThemeCustomizer Component
 * Features:
 * - Pre-built theme presets (Netflix, Cinema, Neon, Anime, etc.)
 * - Custom color picker for all UI elements
 * - Real-time preview
 * - Sync theme across all room participants
 * - Save custom themes
 * - Background patterns/wallpapers
 */

export const THEME_PRESETS = {
    default: {
        name: "Dark Mode (Default)",
        emoji: "🌙",
        colors: {
            bg: "#0f0f0f",
            card: "#1a1a1a",
            card2: "#2a2a2a",
            border: "#333",
            text: "#fff",
            text2: "#aaa",
            text3: "#666",
            primary: "#ff6b35",
            secondary: "#3498db"
        }
    },
    netflix: {
        name: "Netflix",
        emoji: "🍿",
        colors: {
            bg: "#141414",
            card: "#1f1f1f",
            card2: "#2a2a2a",
            border: "#333",
            text: "#fff",
            text2: "#b3b3b3",
            text3: "#808080",
            primary: "#e50914",
            secondary: "#831010"
        }
    },
    cinema: {
        name: "Cinema Gold",
        emoji: "🎬",
        colors: {
            bg: "#0a0a0a",
            card: "#1a1410",
            card2: "#2a2420",
            border: "#443c30",
            text: "#ffd700",
            text2: "#ccaa00",
            text3: "#997700",
            primary: "#ffd700",
            secondary: "#b8860b"
        }
    },
    neon: {
        name: "Neon Dreams",
        emoji: "💜",
        colors: {
            bg: "#0d0221",
            card: "#1a0b3b",
            card2: "#2a1555",
            border: "#4a2f70",
            text: "#ff00ff",
            text2: "#cc00cc",
            text3: "#9900cc",
            primary: "#00ffff",
            secondary: "#ff00ff"
        }
    },
    anime: {
        name: "Anime Pink",
        emoji: "🌸",
        colors: {
            bg: "#1a0a1e",
            card: "#2d1832",
            card2: "#3d2842",
            border: "#5a3d5c",
            text: "#ffb3d9",
            text2: "#ff8ac6",
            text3: "#cc6b9e",
            primary: "#ff69b4",
            secondary: "#ff1493"
        }
    },
    forest: {
        name: "Forest Green",
        emoji: "🌲",
        colors: {
            bg: "#0a1409",
            card: "#152814",
            card2: "#203c1e",
            border: "#2d5029",
            text: "#90ee90",
            text2: "#7bcf7b",
            text3: "#5ba05b",
            primary: "#32cd32",
            secondary: "#228b22"
        }
    },
    ocean: {
        name: "Deep Ocean",
        emoji: "🌊",
        colors: {
            bg: "#001529",
            card: "#002140",
            card2: "#003357",
            border: "#004d6d",
            text: "#87ceeb",
            text2: "#4a9fc7",
            text3: "#2d7a9e",
            primary: "#1890ff",
            secondary: "#096dd9"
        }
    },
    sunset: {
        name: "Sunset Orange",
        emoji: "🌅",
        colors: {
            bg: "#1a0f00",
            card: "#2d1f0a",
            card2: "#402f14",
            border: "#5a4420",
            text: "#ffb84d",
            text2: "#ff9f1a",
            text3: "#cc7e00",
            primary: "#ff6b35",
            secondary: "#ff4500"
        }
    },
    midnight: {
        name: "Midnight Blue",
        emoji: "🌃",
        colors: {
            bg: "#0c0c1e",
            card: "#16162d",
            card2: "#20203c",
            border: "#2d2d4d",
            text: "#e0e7ff",
            text2: "#b8c5ff",
            text3: "#8b9bcc",
            primary: "#6366f1",
            secondary: "#4f46e5"
        }
    },
    light: {
        name: "Light Mode",
        emoji: "☀️",
        colors: {
            bg: "#ffffff",
            card: "#f5f5f5",
            card2: "#e0e0e0",
            border: "#d0d0d0",
            text: "#1a1a1a",
            text2: "#4a4a4a",
            text3: "#7a7a7a",
            primary: "#ff6b35",
            secondary: "#3498db"
        }
    }
};

export function ThemeCustomizer({ roomId, roomDocId, currentTheme, onThemeChange, onClose, T }) {
    const [selectedPreset, setSelectedPreset] = useState("default");
    const [customColors, setCustomColors] = useState(currentTheme || THEME_PRESETS.default.colors);
    const [previewTheme, setPreviewTheme] = useState(customColors);
    const [isCustom, setIsCustom] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [backgroundPattern, setBackgroundPattern] = useState("none");

    // Background patterns
    const PATTERNS = {
        none: "none",
        dots: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
        lines: "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.03) 10px, rgba(255,255,255,0.03) 20px)",
        grid: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
        waves: "repeating-radial-gradient(circle at 0 0, transparent 0, rgba(255,255,255,0.03) 20px, transparent 40px)"
    };

    useEffect(() => {
        // Load saved theme from room
        if (roomDocId || roomId) {
            getDoc(doc(db, "rooms", roomDocId || roomId)).then(snap => {
                if (snap.exists() && snap.data().theme) {
                    const savedTheme = snap.data().theme;
                    setCustomColors(savedTheme.colors || THEME_PRESETS.default.colors);
                    setPreviewTheme(savedTheme.colors || THEME_PRESETS.default.colors);
                    setSelectedPreset(savedTheme.preset || "custom");
                    setBackgroundPattern(savedTheme.pattern || "none");
                    if (savedTheme.preset === "custom") {
                        setIsCustom(true);
                    }
                }
            });
        }
    }, [roomId, roomDocId]);

    const applyPreset = (presetName) => {
        const preset = THEME_PRESETS[presetName];
        if (!preset) return;
        
        setSelectedPreset(presetName);
        setCustomColors(preset.colors);
        setPreviewTheme(preset.colors);
        setIsCustom(false);
    };

    const updateCustomColor = (key, value) => {
        const newColors = { ...customColors, [key]: value };
        setCustomColors(newColors);
        setPreviewTheme(newColors);
        setIsCustom(true);
        setSelectedPreset("custom");
    };

    const saveTheme = async () => {
        setSaving(true);
        
        try {
            const themeData = {
                preset: isCustom ? "custom" : selectedPreset,
                colors: customColors,
                pattern: backgroundPattern,
                updatedAt: new Date(),
                updatedBy: localStorage.getItem('username') || 'User'
            };

            const roomRef = doc(db, "rooms", roomDocId || roomId);
            await updateDoc(roomRef, { theme: themeData });

            // Apply to current UI
            if (onThemeChange) {
                onThemeChange(customColors, backgroundPattern);
            }

            alert("✅ Theme saved successfully!");
        } catch (err) {
            console.error("Theme save error:", err);
            alert("❌ Save failed: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const resetToDefault = () => {
        if (window.confirm("Reset to default theme?")) {
            applyPreset("default");
            setBackgroundPattern("none");
        }
    };

    return (
        <div style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.85)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px"
        }}>
            <div style={{
                backgroundColor: T.bg,
                borderRadius: "20px",
                border: `1px solid ${T.border}`,
                width: "100%",
                maxWidth: "900px",
                maxHeight: "90vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden"
            }}>
                {/* Header */}
                <div style={{
                    padding: "20px 24px",
                    borderBottom: `1px solid ${T.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                }}>
                    <div>
                        <h2 style={{ color: T.text, margin: "0 0 4px 0", fontSize: "20px", fontWeight: "bold" }}>
                            🎨 Customize Theme
                        </h2>
                        <p style={{ color: T.text3, margin: 0, fontSize: "13px" }}>
                            Choose a preset or create your own
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: "none",
                            border: "none",
                            color: T.text2,
                            fontSize: "24px",
                            cursor: "pointer",
                            padding: "0 8px"
                        }}
                    >
                        ✕
                    </button>
                </div>

                <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                    {/* Left Panel - Theme Options */}
                    <div style={{
                        width: "400px",
                        borderRight: `1px solid ${T.border}`,
                        overflowY: "auto",
                        padding: "20px"
                    }}>
                        {/* Theme Presets */}
                        <div style={{ marginBottom: "24px" }}>
                            <label style={{ color: T.text2, fontSize: "12px", fontWeight: "bold", display: "block", marginBottom: "12px" }}>
                                THEME PRESETS
                            </label>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                                {Object.entries(THEME_PRESETS).map(([key, preset]) => (
                                    <button
                                        key={key}
                                        onClick={() => applyPreset(key)}
                                        style={{
                                            padding: "12px",
                                            backgroundColor: selectedPreset === key && !isCustom ? previewTheme.primary : T.card,
                                            color: selectedPreset === key && !isCustom ? "white" : T.text,
                                            border: `2px solid ${selectedPreset === key && !isCustom ? previewTheme.primary : T.border}`,
                                            borderRadius: "10px",
                                            cursor: "pointer",
                                            fontSize: "13px",
                                            fontWeight: "bold",
                                            textAlign: "left",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "4px"
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                            <span style={{ fontSize: "20px" }}>{preset.emoji}</span>
                                            <span>{preset.name}</span>
                                        </div>
                                        <div style={{ display: "flex", gap: "3px" }}>
                                            {Object.values(preset.colors).slice(0, 5).map((color, i) => (
                                                <div key={i} style={{
                                                    width: "20px",
                                                    height: "8px",
                                                    backgroundColor: color,
                                                    borderRadius: "2px"
                                                }} />
                                            ))}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Background Pattern */}
                        <div style={{ marginBottom: "24px" }}>
                            <label style={{ color: T.text2, fontSize: "12px", fontWeight: "bold", display: "block", marginBottom: "12px" }}>
                                BACKGROUND PATTERN
                            </label>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                {Object.keys(PATTERNS).map(pattern => (
                                    <button
                                        key={pattern}
                                        onClick={() => setBackgroundPattern(pattern)}
                                        style={{
                                            padding: "8px 14px",
                                            backgroundColor: backgroundPattern === pattern ? previewTheme.primary : T.card2,
                                            color: backgroundPattern === pattern ? "white" : T.text,
                                            border: "none",
                                            borderRadius: "8px",
                                            cursor: "pointer",
                                            fontSize: "12px",
                                            textTransform: "capitalize"
                                        }}
                                    >
                                        {pattern}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Advanced: Custom Colors */}
                        <div>
                            <button
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                style={{
                                    width: "100%",
                                    padding: "12px",
                                    backgroundColor: T.card2,
                                    color: T.text,
                                    border: `1px solid ${T.border}`,
                                    borderRadius: "10px",
                                    cursor: "pointer",
                                    fontSize: "13px",
                                    fontWeight: "bold",
                                    marginBottom: "12px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between"
                                }}
                            >
                                <span>🎨 Advanced Custom Colors</span>
                                <span>{showAdvanced ? "▼" : "▶"}</span>
                            </button>

                            {showAdvanced && (
                                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                    {Object.entries(customColors).map(([key, value]) => (
                                        <div key={key}>
                                            <label style={{
                                                color: T.text2,
                                                fontSize: "11px",
                                                fontWeight: "bold",
                                                display: "block",
                                                marginBottom: "6px",
                                                textTransform: "uppercase"
                                            }}>
                                                {key.replace(/([A-Z])/g, ' $1').trim()}
                                            </label>
                                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                                <input
                                                    type="color"
                                                    value={value}
                                                    onChange={(e) => updateCustomColor(key, e.target.value)}
                                                    style={{
                                                        width: "50px",
                                                        height: "36px",
                                                        border: "none",
                                                        borderRadius: "6px",
                                                        cursor: "pointer"
                                                    }}
                                                />
                                                <input
                                                    type="text"
                                                    value={value}
                                                    onChange={(e) => updateCustomColor(key, e.target.value)}
                                                    style={{
                                                        flex: 1,
                                                        padding: "8px 12px",
                                                        backgroundColor: T.card,
                                                        border: `1px solid ${T.border}`,
                                                        borderRadius: "6px",
                                                        color: T.text,
                                                        fontSize: "13px",
                                                        fontFamily: "monospace"
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "24px" }}>
                            <button
                                onClick={saveTheme}
                                disabled={saving}
                                style={{
                                    width: "100%",
                                    padding: "14px",
                                    backgroundColor: previewTheme.primary,
                                    color: "white",
                                    border: "none",
                                    borderRadius: "10px",
                                    cursor: saving ? "not-allowed" : "pointer",
                                    fontSize: "15px",
                                    fontWeight: "bold"
                                }}
                            >
                                {saving ? "⏳ Saving..." : "💾 Save & Apply Theme"}
                            </button>
                            <button
                                onClick={resetToDefault}
                                style={{
                                    width: "100%",
                                    padding: "12px",
                                    backgroundColor: T.card2,
                                    color: T.text2,
                                    border: `1px solid ${T.border}`,
                                    borderRadius: "10px",
                                    cursor: "pointer",
                                    fontSize: "13px"
                                }}
                            >
                                🔄 Reset to Default
                            </button>
                        </div>
                    </div>

                    {/* Right Panel - Live Preview */}
                    <div style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "20px",
                        backgroundColor: previewTheme.bg,
                        backgroundImage: PATTERNS[backgroundPattern],
                        backgroundSize: backgroundPattern === "grid" ? "20px 20px" : "40px 40px"
                    }}>
                        <div style={{ maxWidth: "500px", margin: "0 auto" }}>
                            <label style={{
                                color: previewTheme.text3,
                                fontSize: "12px",
                                fontWeight: "bold",
                                display: "block",
                                marginBottom: "16px"
                            }}>
                                LIVE PREVIEW
                            </label>

                            {/* Preview Card 1 */}
                            <div style={{
                                backgroundColor: previewTheme.card,
                                border: `1px solid ${previewTheme.border}`,
                                borderRadius: "16px",
                                padding: "20px",
                                marginBottom: "16px"
                            }}>
                                <h3 style={{
                                    color: previewTheme.text,
                                    margin: "0 0 12px 0",
                                    fontSize: "18px",
                                    fontWeight: "bold"
                                }}>
                                    Watch Together
                                </h3>
                                <p style={{
                                    color: previewTheme.text2,
                                    margin: "0 0 16px 0",
                                    fontSize: "14px"
                                }}>
                                    This is how your room will look with this theme. All colors and patterns sync across all participants!
                                </p>
                                <div style={{ display: "flex", gap: "8px" }}>
                                    <button style={{
                                        padding: "10px 18px",
                                        backgroundColor: previewTheme.primary,
                                        color: "white",
                                        border: "none",
                                        borderRadius: "8px",
                                        fontSize: "13px",
                                        fontWeight: "bold"
                                    }}>
                                        Primary Button
                                    </button>
                                    <button style={{
                                        padding: "10px 18px",
                                        backgroundColor: previewTheme.card2,
                                        color: previewTheme.text,
                                        border: `1px solid ${previewTheme.border}`,
                                        borderRadius: "8px",
                                        fontSize: "13px"
                                    }}>
                                        Secondary
                                    </button>
                                </div>
                            </div>

                            {/* Preview Card 2 - Message */}
                            <div style={{
                                backgroundColor: previewTheme.card,
                                border: `1px solid ${previewTheme.border}`,
                                borderRadius: "16px",
                                padding: "16px",
                                marginBottom: "16px"
                            }}>
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    marginBottom: "12px"
                                }}>
                                    <div style={{
                                        width: "40px",
                                        height: "40px",
                                        borderRadius: "50%",
                                        backgroundColor: previewTheme.primary,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "20px"
                                    }}>
                                        👤
                                    </div>
                                    <div>
                                        <div style={{
                                            color: previewTheme.text,
                                            fontSize: "14px",
                                            fontWeight: "bold"
                                        }}>
                                            Username
                                        </div>
                                        <div style={{
                                            color: previewTheme.text3,
                                            fontSize: "12px"
                                        }}>
                                            Just now
                                        </div>
                                    </div>
                                </div>
                                <div style={{
                                    backgroundColor: previewTheme.card2,
                                    borderRadius: "10px",
                                    padding: "12px",
                                    color: previewTheme.text2,
                                    fontSize: "14px"
                                }}>
                                    This is a chat message preview! 💬
                                </div>
                            </div>

                            {/* Preview Card 3 - History Item */}
                            <div style={{
                                backgroundColor: previewTheme.card,
                                border: `1px solid ${previewTheme.border}`,
                                borderRadius: "12px",
                                padding: "14px",
                                display: "flex",
                                gap: "12px"
                            }}>
                                <div style={{
                                    width: "80px",
                                    height: "60px",
                                    backgroundColor: previewTheme.card2,
                                    borderRadius: "8px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "24px"
                                }}>
                                    🎬
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{
                                        color: previewTheme.text,
                                        fontSize: "14px",
                                        fontWeight: "bold",
                                        marginBottom: "4px"
                                    }}>
                                        Movie Title
                                    </div>
                                    <div style={{
                                        color: previewTheme.secondary,
                                        fontSize: "12px",
                                        marginBottom: "4px"
                                    }}>
                                        Partner-கூட பார்த்தோம் 💕
                                    </div>
                                    <div style={{
                                        color: previewTheme.text3,
                                        fontSize: "11px"
                                    }}>
                                        🕐 2 hours ago
                                    </div>
                                </div>
                            </div>

                            {/* Color Palette Display */}
                            <div style={{
                                marginTop: "24px",
                                backgroundColor: previewTheme.card,
                                border: `1px solid ${previewTheme.border}`,
                                borderRadius: "12px",
                                padding: "16px"
                            }}>
                                <label style={{
                                    color: previewTheme.text2,
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                    display: "block",
                                    marginBottom: "12px"
                                }}>
                                    COLOR PALETTE
                                </label>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                                    {Object.entries(previewTheme).map(([key, value]) => (
                                        <div key={key} style={{ textAlign: "center" }}>
                                            <div style={{
                                                width: "100%",
                                                height: "40px",
                                                backgroundColor: value,
                                                borderRadius: "6px",
                                                border: `1px solid ${previewTheme.border}`,
                                                marginBottom: "4px"
                                            }} />
                                            <div style={{
                                                color: previewTheme.text3,
                                                fontSize: "10px",
                                                textTransform: "uppercase"
                                            }}>
                                                {key}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ThemeCustomizer;
