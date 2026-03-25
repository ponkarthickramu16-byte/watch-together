// src/pages/ProfileSetup.jsx
// First-time profile setup + edit — shown when user has no profile in Firestore

import { useState, useRef } from "react";
import { db } from "../firebase";
import { doc, setDoc } from "firebase/firestore";
import { uploadImageToCloudinary } from "../cloudinary";

const GENRES = ["Romance 💕", "Action 🔥", "Comedy 😂", "Horror 👻", "Thriller 😱", "Sci-Fi 🚀", "Drama 😢", "Animation 🎨", "Documentary 📽️", "Fantasy ✨"];

const AVATARS = ["🧑", "👩", "👨", "🧒", "👧", "👦", "🧔", "👩‍🦱", "👩‍🦰", "👨‍🦱", "🧑‍🎤", "👩‍🎤", "🦊", "🐱", "🐻", "🐼", "🦁", "🐯", "🐸", "🐧"];

export default function ProfileSetup({ user, onComplete, existingProfile = null }) {
    // Bug 1 fix: uid & email — user object-ல இருந்து safe-ஆ எடுக்கிறோம்.
    // uid empty ஆனா Firestore "odd segments" error வரும்.
    const uid = user?.uid || "";
    const email = user?.email || "";

    // Bug 3 fix: Google login-ல user.photoURL automatically இருக்கும்.
    // existingProfile இல்லன்னா அதை default-ஆ use பண்றோம்.
    const googlePhoto = user?.photoURL || "";

    const [name, setName] = useState(existingProfile?.name || user?.displayName || "");
    const [dob, setDob] = useState(existingProfile?.dob || "");
    const [genres, setGenres] = useState(existingProfile?.genres || []);
    const [avatar, setAvatar] = useState(existingProfile?.avatar || "🧑");
    // Google photo இருந்தா automatically set பண்றோம்
    const [photoUrl, setPhotoUrl] = useState(existingProfile?.photoUrl || googlePhoto || "");
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    // Google photo இருந்தா "upload" tab default-ஆ காட்டுவோம்
    const [tab, setTab] = useState(
        existingProfile?.photoUrl || googlePhoto ? "upload" : "avatar"
    );
    const fileRef = useRef(null);

    const toggleGenre = (g) => {
        setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g].slice(0, 5));
    };

    const handlePhotoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { setError("5MB-க்கு கீழ upload பண்ணு"); return; }
        setUploading(true);
        setError("");
        try {
            const url = await uploadImageToCloudinary(file);
            setPhotoUrl(url);
            setTab("upload");
        } catch { setError("Upload fail ஆச்சு, retry பண்ணு"); }
        finally { setUploading(false); }
    };

    const handleSave = async () => {
        if (!name.trim()) { setError("பேரு கண்டிப்பா போடணும்"); return; }

        // Bug 1 fix: uid இல்லன்னா save பண்ண முயற்சிக்காம clear error காட்டுவோம்.
        if (!uid) {
            setError("Login session expire ஆச்சு — page refresh பண்ணு அல்லது logout பண்ணி மறுபடியும் login பண்ணு");
            return;
        }

        setSaving(true);
        setError("");
        try {
            const profile = {
                uid,
                email,
                name: name.trim(),
                dob: dob || null,
                genres,
                avatar,
                photoUrl: photoUrl || null,
                updatedAt: new Date(),
            };
            await setDoc(doc(db, "profiles", uid), profile);
            onComplete(profile);
        } catch (err) { setError("Save fail: " + err.message); }
        finally { setSaving(false); }
    };

    const profilePic = tab === "upload" && photoUrl ? photoUrl : null;

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#0f0f0f", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", fontFamily: "system-ui, sans-serif" }}>
            <div style={{ width: "100%", maxWidth: "480px", backgroundColor: "#1a1a1a", borderRadius: "20px", border: "1px solid #333", overflow: "hidden" }}>
                {/* Header */}
                <div style={{ background: "linear-gradient(135deg, #ff6b35, #e55a2b)", padding: "24px", textAlign: "center" }}>
                    <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎬</div>
                    <h2 style={{ color: "white", margin: 0, fontSize: "20px", fontWeight: "bold" }}>
                        {existingProfile ? "Profile Edit பண்ணு" : "Profile Setup பண்ணு"}
                    </h2>
                    <p style={{ color: "rgba(255,255,255,0.8)", margin: "6px 0 0", fontSize: "13px" }}>
                        உன் partner-க்கு உன்னை introduce பண்றோம் 💕
                    </p>
                </div>

                <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
                    {/* Profile Picture */}
                    <div>
                        <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "8px", display: "block" }}>PROFILE PICTURE</label>
                        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                            {/* Preview */}
                            <div style={{ width: "72px", height: "72px", borderRadius: "50%", border: "3px solid #ff6b35", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#2a2a2a", flexShrink: 0 }}>
                                {profilePic
                                    ? <img src={profilePic} alt="profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    : <span style={{ fontSize: "36px" }}>{avatar}</span>
                                }
                            </div>
                            <div style={{ flex: 1 }}>
                                {/* Tab switcher */}
                                <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                                    <button onClick={() => setTab("avatar")} style={{ padding: "4px 10px", borderRadius: "12px", border: "none", cursor: "pointer", fontSize: "11px", backgroundColor: tab === "avatar" ? "#ff6b35" : "#2a2a2a", color: tab === "avatar" ? "white" : "#aaa" }}>😊 Avatar</button>
                                    <button onClick={() => setTab("upload")} style={{ padding: "4px 10px", borderRadius: "12px", border: "none", cursor: "pointer", fontSize: "11px", backgroundColor: tab === "upload" ? "#ff6b35" : "#2a2a2a", color: tab === "upload" ? "white" : "#aaa" }}>📸 Photo</button>
                                </div>
                                {tab === "upload" && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                        {/* Bug 3 fix: Google photo இருந்தா "Using Google photo" காட்டுவோம் */}
                                        {photoUrl && photoUrl === googlePhoto && !existingProfile?.photoUrl && (
                                            <p style={{ color: "#27ae60", fontSize: "11px", margin: 0 }}>
                                                ✅ Google photo automatic-ஆ set ஆச்சு
                                            </p>
                                        )}
                                        <button onClick={() => fileRef.current?.click()} disabled={uploading}
                                            style={{ padding: "6px 14px", backgroundColor: "#2a2a2a", color: "#ff6b35", border: "1px solid #ff6b35", borderRadius: "8px", cursor: "pointer", fontSize: "12px" }}>
                                            {uploading ? "Uploading..." : photoUrl ? "Change Photo" : "Upload Photo"}
                                        </button>
                                        <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Avatar grid */}
                        {tab === "avatar" && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                                {AVATARS.map(a => (
                                    <button key={a} onClick={() => setAvatar(a)}
                                        style={{ width: "40px", height: "40px", borderRadius: "50%", border: avatar === a ? "2px solid #ff6b35" : "2px solid #333", backgroundColor: avatar === a ? "rgba(255,107,53,0.15)" : "#2a2a2a", cursor: "pointer", fontSize: "20px" }}>
                                        {a}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Name */}
                    <div>
                        <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "6px", display: "block" }}>உன் பேரு *</label>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="பேரு போடு..."
                            style={{ width: "100%", padding: "10px 12px", backgroundColor: "#2a2a2a", border: "1px solid #444", borderRadius: "8px", color: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                    </div>

                    {/* Email (read-only) — Bug 2 fix: email blank-ஆ வந்தா warning காட்டுவோம் */}
                    <div>
                        <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "6px", display: "block" }}>Email</label>
                        <input value={email} readOnly
                            style={{ width: "100%", padding: "10px 12px", backgroundColor: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", color: email ? "#888" : "#555", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                            placeholder="Email load ஆகல — refresh பண்ணு" />
                        {!email && (
                            <p style={{ color: "#f39c12", fontSize: "11px", margin: "4px 0 0" }}>
                                ⚠️ Email தெரியல — logout பண்ணி மறுபடியும் login பண்ணு
                            </p>
                        )}
                    </div>

                    {/* DOB */}
                    <div>
                        <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "6px", display: "block" }}>🎂 பிறந்த நாள் (optional)</label>
                        <input type="date" value={dob} onChange={e => setDob(e.target.value)}
                            style={{ width: "100%", padding: "10px 12px", backgroundColor: "#2a2a2a", border: "1px solid #444", borderRadius: "8px", color: "white", fontSize: "14px", outline: "none", boxSizing: "border-box", colorScheme: "dark" }} />
                    </div>

                    {/* Favorite Genres */}
                    <div>
                        <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "6px", display: "block" }}>🎬 Favorite Genres (max 5)</label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {GENRES.map(g => (
                                <button key={g} onClick={() => toggleGenre(g)}
                                    style={{ padding: "5px 10px", borderRadius: "16px", border: "none", cursor: "pointer", fontSize: "12px", backgroundColor: genres.includes(g) ? "#ff6b35" : "#2a2a2a", color: genres.includes(g) ? "white" : "#aaa", transition: "all 0.15s" }}>
                                    {g}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && <p style={{ color: "#e74c3c", fontSize: "13px", margin: 0 }}>❌ {error}</p>}

                    {/* Save */}
                    <button onClick={handleSave} disabled={saving || uploading || !uid}
                        style={{ width: "100%", padding: "14px", backgroundColor: (saving || !uid) ? "#555" : "#ff6b35", color: "white", border: "none", borderRadius: "10px", cursor: (saving || !uid) ? "not-allowed" : "pointer", fontSize: "16px", fontWeight: "bold" }}>
                        {saving ? "Saving..." : existingProfile ? "💾 Update Profile" : "✅ Profile Save பண்ணு"}
                    </button>

                    {existingProfile && (
                        <button onClick={() => onComplete(existingProfile)}
                            style={{ width: "100%", padding: "10px", backgroundColor: "transparent", color: "#666", border: "1px solid #333", borderRadius: "10px", cursor: "pointer", fontSize: "14px" }}>
                            Cancel
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

const toggleGenre = (g) => {
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g].slice(0, 5));
};

const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("5MB-க்கு கீழ upload பண்ணு"); return; }
    setUploading(true);
    setError("");
    try {
        const url = await uploadToCloudinary(file);
        setPhotoUrl(url);
        setTab("upload");
    } catch { setError("Upload fail ஆச்சு, retry பண்ணு"); }
    finally { setUploading(false); }
};

// ProfileSetup.jsx - handleSave function-ஐ இப்படி மாத்துங்க

const handleSave = async () => {
    // uid இல்லனா உடனே ரிட்டன் பண்ணிடணும், இல்லனா Firestore crash ஆகும்
    if (!uid) {
        setError("User ID not found. Please re-login.");
        return;
    }
    if (!name.trim()) {
        setError("Please enter your name!");
        return;
    }

    setSaving(true);
    setError("");

    try {
        let finalImageUrl = profilePic;
        if (imageFile) {
            finalImageUrl = await uploadToCloudinary(imageFile);
        }

        const profileData = {
            uid,
            name: name.trim(),
            email,
            profilePic: finalImageUrl,
            avatar,
            genres,
            updatedAt: new Date(),
        };

        // Correct way to reference the document
        const userDocRef = doc(db, "users", uid);
        await setDoc(userDocRef, profileData, { merge: true });

        onComplete(profileData);
    } catch (err) {
        console.error("Error saving profile:", err);
        setError("Profile save பண்ண முடியல. கொஞ்சம் அப்புறம் try பண்ணுங்க.");
    } finally {
        setSaving(false);
    }
};

const profilePic = tab === "upload" && photoUrl ? photoUrl : null;

return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0f0f0f", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ width: "100%", maxWidth: "480px", backgroundColor: "#1a1a1a", borderRadius: "20px", border: "1px solid #333", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ background: "linear-gradient(135deg, #ff6b35, #e55a2b)", padding: "24px", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎬</div>
                <h2 style={{ color: "white", margin: 0, fontSize: "20px", fontWeight: "bold" }}>
                    {existingProfile ? "Profile Edit பண்ணு" : "Profile Setup பண்ணு"}
                </h2>
                <p style={{ color: "rgba(255,255,255,0.8)", margin: "6px 0 0", fontSize: "13px" }}>
                    உன் partner-க்கு உன்னை introduce பண்றோம் 💕
                </p>
            </div>

            <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
                {/* Profile Picture */}
                <div>
                    <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "8px", display: "block" }}>PROFILE PICTURE</label>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        {/* Preview */}
                        <div style={{ width: "72px", height: "72px", borderRadius: "50%", border: "3px solid #ff6b35", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#2a2a2a", flexShrink: 0 }}>
                            {profilePic
                                ? <img src={profilePic} alt="profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : <span style={{ fontSize: "36px" }}>{avatar}</span>
                            }
                        </div>
                        <div style={{ flex: 1 }}>
                            {/* Tab switcher */}
                            <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                                <button onClick={() => setTab("avatar")} style={{ padding: "4px 10px", borderRadius: "12px", border: "none", cursor: "pointer", fontSize: "11px", backgroundColor: tab === "avatar" ? "#ff6b35" : "#2a2a2a", color: tab === "avatar" ? "white" : "#aaa" }}>😊 Avatar</button>
                                <button onClick={() => setTab("upload")} style={{ padding: "4px 10px", borderRadius: "12px", border: "none", cursor: "pointer", fontSize: "11px", backgroundColor: tab === "upload" ? "#ff6b35" : "#2a2a2a", color: tab === "upload" ? "white" : "#aaa" }}>📸 Photo</button>
                            </div>
                            {tab === "upload" && (
                                <div>
                                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                                        style={{ padding: "6px 14px", backgroundColor: "#2a2a2a", color: "#ff6b35", border: "1px solid #ff6b35", borderRadius: "8px", cursor: "pointer", fontSize: "12px" }}>
                                        {uploading ? "Uploading..." : photoUrl ? "Change Photo" : "Upload Photo"}
                                    </button>
                                    <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Avatar grid */}
                    {tab === "avatar" && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                            {AVATARS.map(a => (
                                <button key={a} onClick={() => setAvatar(a)}
                                    style={{ width: "40px", height: "40px", borderRadius: "50%", border: avatar === a ? "2px solid #ff6b35" : "2px solid #333", backgroundColor: avatar === a ? "rgba(255,107,53,0.15)" : "#2a2a2a", cursor: "pointer", fontSize: "20px" }}>
                                    {a}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Name */}
                <div>
                    <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "6px", display: "block" }}>உன் பேரு *</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="பேரு போடு..."
                        style={{ width: "100%", padding: "10px 12px", backgroundColor: "#2a2a2a", border: "1px solid #444", borderRadius: "8px", color: "white", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>

                {/* Email (read-only) */}
                <div>
                    <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "6px", display: "block" }}>Email</label>
                    <input value={email} readOnly
                        style={{ width: "100%", padding: "10px 12px", backgroundColor: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", color: "#666", fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
                </div>

                {/* DOB */}
                <div>
                    <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "6px", display: "block" }}>🎂 பிறந்த நாள் (optional)</label>
                    <input type="date" value={dob} onChange={e => setDob(e.target.value)}
                        style={{ width: "100%", padding: "10px 12px", backgroundColor: "#2a2a2a", border: "1px solid #444", borderRadius: "8px", color: "white", fontSize: "14px", outline: "none", boxSizing: "border-box", colorScheme: "dark" }} />
                </div>

                {/* Favorite Genres */}
                <div>
                    <label style={{ color: "#aaa", fontSize: "12px", marginBottom: "6px", display: "block" }}>🎬 Favorite Genres (max 5)</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {GENRES.map(g => (
                            <button key={g} onClick={() => toggleGenre(g)}
                                style={{ padding: "5px 10px", borderRadius: "16px", border: "none", cursor: "pointer", fontSize: "12px", backgroundColor: genres.includes(g) ? "#ff6b35" : "#2a2a2a", color: genres.includes(g) ? "white" : "#aaa", transition: "all 0.15s" }}>
                                {g}
                            </button>
                        ))}
                    </div>
                </div>

                {error && <p style={{ color: "#e74c3c", fontSize: "13px", margin: 0 }}>❌ {error}</p>}

                {/* Save */}
                <button onClick={handleSave} disabled={saving || uploading}
                    style={{ width: "100%", padding: "14px", backgroundColor: saving ? "#555" : "#ff6b35", color: "white", border: "none", borderRadius: "10px", cursor: saving ? "not-allowed" : "pointer", fontSize: "16px", fontWeight: "bold" }}>
                    {saving ? "Saving..." : existingProfile ? "💾 Update Profile" : "✅ Profile Save பண்ணு"}
                </button>

                {existingProfile && (
                    <button onClick={() => onComplete(existingProfile)}
                        style={{ width: "100%", padding: "10px", backgroundColor: "transparent", color: "#666", border: "1px solid #333", borderRadius: "10px", cursor: "pointer", fontSize: "14px" }}>
                        Cancel
                    </button>
                )}
            </div>
        </div>
    </div>
);
