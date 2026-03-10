import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { useState } from "react";
import { db } from "../firebase";
import { collection, addDoc } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { useNavigate } from "react-router-dom";

function Home() {
    const [movieLink, setMovieLink] = useState("");
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const navigate = useNavigate();

    const handleLogout = async () => {
        await signOut(auth);
    };

    // YouTube URL Convert பண்ணு
    const convertYouTubeUrl = (url) => {
        // youtu.be/ID format
        const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (shortMatch) {
            return `https://www.youtube.com/watch?v=${shortMatch[1]}`;
        }
        // Already correct format
        return url;
    };

    // YouTube/Drive Link Room Create
    const createRoomWithLink = async () => {
        if (!movieLink.trim()) {
            alert("Movie link enter பண்ணு!");
            return;
        }
        try {
            setUploading(true);
            const convertedUrl = convertYouTubeUrl(movieLink);
            const roomId = uuidv4().slice(0, 8);
            await addDoc(collection(db, "rooms"), {
                roomId,
                movieUrl: convertedUrl,
                movieType: "link",
                createdAt: new Date(),
                isPlaying: false,
                currentTime: 0,
            });
            navigate(`/room/${roomId}`);
        } catch (error) {
            alert("Error: " + error.message);
        } finally {
            setUploading(false);
        }
    };

    // Movie File Upload Room Create
    const createRoomWithUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            setUploading(true);
            setUploadProgress(0);

            const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
            const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

            const formData = new FormData();
            formData.append("file", file);
            formData.append("upload_preset", UPLOAD_PRESET);
            formData.append("folder", "movies");
            formData.append("resource_type", "video");

            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener("progress", (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    setUploadProgress(percent);
                }
            });

            xhr.addEventListener("load", async () => {
                const data = JSON.parse(xhr.responseText);
                if (data.secure_url) {
                    const roomId = uuidv4().slice(0, 8);
                    await addDoc(collection(db, "rooms"), {
                        roomId,
                        movieUrl: data.secure_url,
                        movieType: "upload",
                        createdAt: new Date(),
                        isPlaying: false,
                        currentTime: 0,
                    });
                    navigate(`/room/${roomId}`);
                } else {
                    alert("Upload failed!");
                }
                setUploading(false);
            });

            xhr.open(
                "POST",
                `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`
            );
            xhr.send(formData);
        } catch (error) {
            alert("Error: " + error.message);
            setUploading(false);
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.card}>

                {/* Top Bar - User + Logout */}
                <div style={styles.topBar}>
                    <div style={styles.userInfo}>
                        <img
                            src={auth.currentUser?.photoURL}
                            alt="profile"
                            style={styles.avatar}
                        />
                        <span style={styles.userName}>
                            {auth.currentUser?.displayName}
                        </span>
                    </div>
                    <button onClick={handleLogout} style={styles.logoutBtn}>
                        🚪 Logout
                    </button>
                </div>

                {/* Header */}
                <div style={styles.header}>
                    <h1 style={styles.title}>🎬 Watch Together</h1>
                    <p style={styles.subtitle}>
                        உன் partner-ஓட சேர்ந்து movie பாரு!
                    </p>
                </div>

                {/* Upload Section */}
                <div style={styles.section}>
                    <h2 style={styles.sectionTitle}>📁 Movie Upload பண்ணு</h2>
                    <label style={styles.uploadBox}>
                        <input
                            type="file"
                            accept="video/*"
                            onChange={createRoomWithUpload}
                            style={{ display: "none" }}
                            disabled={uploading}
                        />
                        {uploading && uploadProgress > 0 ? (
                            <div>
                                <p style={styles.uploadText}>Uploading... {uploadProgress}%</p>
                                <div style={styles.progressBar}>
                                    <div
                                        style={{
                                            ...styles.progressFill,
                                            width: `${uploadProgress}%`,
                                        }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div>
                                <p style={styles.uploadIcon}>☁️</p>
                                <p style={styles.uploadText}>Click பண்ணி movie select பண்ணு</p>
                                <p style={styles.uploadSubtext}>MP4, MKV, AVI support</p>
                            </div>
                        )}
                    </label>
                </div>

                {/* Divider */}
                <div style={styles.divider}>
                    <span style={styles.dividerText}>அல்லது</span>
                </div>

                {/* Link Section */}
                <div style={styles.section}>
                    <h2 style={styles.sectionTitle}>🔗 YouTube / Drive Link</h2>
                    <input
                        type="text"
                        placeholder="https://youtube.com/watch?v=..."
                        value={movieLink}
                        onChange={(e) => setMovieLink(e.target.value)}
                        style={styles.input}
                        disabled={uploading}
                    />
                    <button
                        onClick={createRoomWithLink}
                        style={styles.button}
                        disabled={uploading}
                    >
                        {uploading ? "Creating..." : "🚀 Room Create பண்ணு"}
                    </button>
                </div>
            </div>
        </div>
    );
}

const styles = {
    container: {
        minHeight: "100vh",
        backgroundColor: "#0f0f0f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
    },
    card: {
        backgroundColor: "#1a1a1a",
        borderRadius: "16px",
        padding: "40px",
        width: "100%",
        maxWidth: "480px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    },
    topBar: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "24px",
        paddingBottom: "16px",
        borderBottom: "1px solid #2a2a2a",
    },
    userInfo: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    avatar: {
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        border: "2px solid #ff6b35",
    },
    userName: {
        color: "#ffffff",
        fontSize: "14px",
        fontWeight: "bold",
    },
    logoutBtn: {
        padding: "6px 14px",
        backgroundColor: "transparent",
        color: "#666",
        border: "1px solid #333",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "13px",
    },
    header: {
        textAlign: "center",
        marginBottom: "32px",
    },
    title: {
        color: "#ffffff",
        fontSize: "32px",
        margin: "0 0 8px 0",
    },
    subtitle: {
        color: "#888",
        fontSize: "14px",
        margin: 0,
    },
    section: {
        marginBottom: "24px",
    },
    sectionTitle: {
        color: "#ffffff",
        fontSize: "16px",
        marginBottom: "12px",
    },
    uploadBox: {
        display: "block",
        border: "2px dashed #333",
        borderRadius: "12px",
        padding: "32px",
        textAlign: "center",
        cursor: "pointer",
        transition: "border-color 0.2s",
    },
    uploadIcon: {
        fontSize: "40px",
        margin: "0 0 8px 0",
    },
    uploadText: {
        color: "#ffffff",
        fontSize: "14px",
        margin: "0 0 4px 0",
    },
    uploadSubtext: {
        color: "#666",
        fontSize: "12px",
        margin: 0,
    },
    progressBar: {
        backgroundColor: "#333",
        borderRadius: "4px",
        height: "8px",
        marginTop: "8px",
    },
    progressFill: {
        backgroundColor: "#ff6b35",
        borderRadius: "4px",
        height: "8px",
        transition: "width 0.3s",
    },
    divider: {
        textAlign: "center",
        margin: "24px 0",
        position: "relative",
        borderTop: "1px solid #333",
    },
    dividerText: {
        backgroundColor: "#1a1a1a",
        color: "#666",
        padding: "0 12px",
        position: "relative",
        top: "-10px",
        fontSize: "13px",
    },
    input: {
        width: "100%",
        padding: "12px 16px",
        backgroundColor: "#2a2a2a",
        border: "1px solid #333",
        borderRadius: "8px",
        color: "#ffffff",
        fontSize: "14px",
        marginBottom: "12px",
        boxSizing: "border-box",
    },
    button: {
        width: "100%",
        padding: "14px",
        backgroundColor: "#ff6b35",
        color: "white",
        border: "none",
        borderRadius: "8px",
        fontSize: "16px",
        cursor: "pointer",
        fontWeight: "bold",
    },
};

export default Home;
