// src/components/AdvancedSearch.jsx
import { useState, useEffect, useMemo } from "react";
import { db } from "../firebase";
import { collection, query, where, orderBy, onSnapshot, doc, deleteDoc, writeBatch } from "firebase/firestore";

/**
 * AdvancedSearch Component
 * Features:
 * - Search by movie name, partner, date range
 * - Filter by type (YouTube/Upload), room type (Couple/Group)
 * - Sort by date, duration, name
 * - Clear individual items
 * - Clear all history with confirmation
 * - Export history as CSV/JSON
 */

const getYouTubeId = (url) => {
    if (!url) return null;
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!trimmed) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
};

const getMovieTitle = (entry) => {
    if (entry.movieTitle) return entry.movieTitle;
    const resolvedUrl = entry.movieUrl || entry.videoUrl || entry.movieId || "";
    const ytId = getYouTubeId(resolvedUrl);
    if (ytId) return "YouTube Video";
    const filename = resolvedUrl?.split("/").pop()?.split("?")[0] || "Movie";
    return decodeURIComponent(filename).substring(0, 40);
};

const formatDateTime = (date) => {
    if (!date) return { dateStr: "", timeStr: "", timestamp: 0 };
    const d = date.toDate ? date.toDate() : new Date(date);
    const dateStr = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    return { dateStr, timeStr, timestamp: d.getTime() };
};

export function AdvancedSearch({ user, onClose, T }) {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    
    // Search & Filter States
    const [searchTerm, setSearchTerm] = useState("");
    const [filterType, setFilterType] = useState("all"); // all, youtube, upload
    const [filterRoomType, setFilterRoomType] = useState("all"); // all, couple, group
    const [sortBy, setSortBy] = useState("date-desc"); // date-desc, date-asc, name-asc, name-desc
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [selectedPartner, setSelectedPartner] = useState("all");
    
    // Clear history states
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [clearingAll, setClearingAll] = useState(false);
    const [deletingItems, setDeletingItems] = useState(new Set());

    // Load history
    useEffect(() => {
        if (!user?.uid) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, "watchHistory"),
            where("watchedByUid", "==", user.uid),
            orderBy("watchedAt", "desc")
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const items = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    ...formatDateTime(doc.data().watchedAt)
                }));
                setHistory(items);
                setLoading(false);
            },
            (err) => {
                console.error("History load error:", err);
                setError("History load ஆகல. Refresh பண்ணு.");
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user?.uid]);

    // Get unique partners for filter
    const partners = useMemo(() => {
        const uniquePartners = new Set(history.map(h => h.partnerName).filter(Boolean));
        return Array.from(uniquePartners).sort();
    }, [history]);

    // Filtered & Sorted History
    const filteredHistory = useMemo(() => {
        let filtered = [...history];

        // Search by name
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(item => {
                const title = getMovieTitle(item).toLowerCase();
                const partner = (item.partnerName || "").toLowerCase();
                return title.includes(term) || partner.includes(term);
            });
        }

        // Filter by type
        if (filterType !== "all") {
            filtered = filtered.filter(item => {
                const isYT = item.movieType === "youtube" || !!getYouTubeId(item.movieUrl);
                return filterType === "youtube" ? isYT : !isYT;
            });
        }

        // Filter by room type
        if (filterRoomType !== "all") {
            filtered = filtered.filter(item => {
                const isCoupleRoom = item.roomType === "couple" || !item.roomType;
                return filterRoomType === "couple" ? isCoupleRoom : !isCoupleRoom;
            });
        }

        // Filter by partner
        if (selectedPartner !== "all") {
            filtered = filtered.filter(item => item.partnerName === selectedPartner);
        }

        // Filter by date range
        if (dateFrom) {
            const fromTime = new Date(dateFrom).getTime();
            filtered = filtered.filter(item => item.timestamp >= fromTime);
        }
        if (dateTo) {
            const toTime = new Date(dateTo).setHours(23, 59, 59, 999);
            filtered = filtered.filter(item => item.timestamp <= toTime);
        }

        // Sort
        filtered.sort((a, b) => {
            switch (sortBy) {
                case "date-desc":
                    return b.timestamp - a.timestamp;
                case "date-asc":
                    return a.timestamp - b.timestamp;
                case "name-asc":
                    return getMovieTitle(a).localeCompare(getMovieTitle(b));
                case "name-desc":
                    return getMovieTitle(b).localeCompare(getMovieTitle(a));
                default:
                    return 0;
            }
        });

        return filtered;
    }, [history, searchTerm, filterType, filterRoomType, selectedPartner, dateFrom, dateTo, sortBy]);

    // Delete single item
    const deleteHistoryItem = async (itemId) => {
        if (!window.confirm("இந்த entry-ஐ delete பண்ணலாமா?")) return;
        
        setDeletingItems(prev => new Set(prev).add(itemId));
        
        try {
            await deleteDoc(doc(db, "watchHistory", itemId));
        } catch (err) {
            console.error("Delete error:", err);
            alert("❌ Delete fail ஆச்சு: " + err.message);
        } finally {
            setDeletingItems(prev => {
                const newSet = new Set(prev);
                newSet.delete(itemId);
                return newSet;
            });
        }
    };

    // Clear all history
    const clearAllHistory = async () => {
        if (!user?.uid) return;
        
        setClearingAll(true);
        
        try {
            // Batch delete for performance
            const batch = writeBatch(db);
            history.forEach(item => {
                batch.delete(doc(db, "watchHistory", item.id));
            });
            
            await batch.commit();
            setShowClearConfirm(false);
            alert("✅ எல்லா history-யும் clear ஆச்சு!");
        } catch (err) {
            console.error("Clear all error:", err);
            alert("❌ Clear fail ஆச்சு: " + err.message);
        } finally {
            setClearingAll(false);
        }
    };

    // Export history
    const exportHistory = (format = "json") => {
        const dataToExport = filteredHistory.map(item => ({
            movieTitle: getMovieTitle(item),
            movieUrl: item.movieUrl,
            movieType: item.movieType,
            roomType: item.roomType || "couple",
            partnerName: item.partnerName || "Unknown",
            watchedAt: item.dateStr + " " + item.timeStr,
            roomId: item.roomId
        }));

        if (format === "json") {
            const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `watch-history-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else if (format === "csv") {
            const headers = ["Movie Title", "Type", "Room Type", "Partner", "Date", "Time", "Room ID"];
            const rows = dataToExport.map(item => [
                item.movieTitle,
                item.movieType,
                item.roomType,
                item.partnerName,
                item.watchedAt.split(' ')[0],
                item.watchedAt.split(' ')[1],
                item.roomId
            ]);
            
            const csvContent = [
                headers.join(","),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
            ].join("\n");
            
            const blob = new Blob([csvContent], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `watch-history-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
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
                            🔍 Advanced Search & History
                        </h2>
                        <p style={{ color: T.text3, margin: 0, fontSize: "13px" }}>
                            {filteredHistory.length} of {history.length} movies
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

                {/* Search & Filters */}
                <div style={{
                    padding: "16px 24px",
                    borderBottom: `1px solid ${T.border}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px"
                }}>
                    {/* Search Input */}
                    <input
                        type="text"
                        placeholder="🔍 Search by movie name or partner..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "12px 16px",
                            backgroundColor: T.card,
                            border: `1px solid ${T.border}`,
                            borderRadius: "10px",
                            color: T.text,
                            fontSize: "14px",
                            outline: "none",
                            boxSizing: "border-box"
                        }}
                    />

                    {/* Filters Row 1 */}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {/* Type Filter */}
                        <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            style={{
                                flex: 1,
                                minWidth: "120px",
                                padding: "8px 12px",
                                backgroundColor: T.card,
                                border: `1px solid ${T.border}`,
                                borderRadius: "8px",
                                color: T.text,
                                fontSize: "13px",
                                cursor: "pointer"
                            }}
                        >
                            <option value="all">All Types</option>
                            <option value="youtube">YouTube Only</option>
                            <option value="upload">Uploads Only</option>
                        </select>

                        {/* Room Type Filter */}
                        <select
                            value={filterRoomType}
                            onChange={(e) => setFilterRoomType(e.target.value)}
                            style={{
                                flex: 1,
                                minWidth: "120px",
                                padding: "8px 12px",
                                backgroundColor: T.card,
                                border: `1px solid ${T.border}`,
                                borderRadius: "8px",
                                color: T.text,
                                fontSize: "13px",
                                cursor: "pointer"
                            }}
                        >
                            <option value="all">All Rooms</option>
                            <option value="couple">💕 Couple</option>
                            <option value="group">👯 Group</option>
                        </select>

                        {/* Partner Filter */}
                        <select
                            value={selectedPartner}
                            onChange={(e) => setSelectedPartner(e.target.value)}
                            style={{
                                flex: 1,
                                minWidth: "140px",
                                padding: "8px 12px",
                                backgroundColor: T.card,
                                border: `1px solid ${T.border}`,
                                borderRadius: "8px",
                                color: T.text,
                                fontSize: "13px",
                                cursor: "pointer"
                            }}
                        >
                            <option value="all">All Partners</option>
                            {partners.map(partner => (
                                <option key={partner} value={partner}>{partner}</option>
                            ))}
                        </select>

                        {/* Sort By */}
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            style={{
                                flex: 1,
                                minWidth: "140px",
                                padding: "8px 12px",
                                backgroundColor: T.card,
                                border: `1px solid ${T.border}`,
                                borderRadius: "8px",
                                color: T.text,
                                fontSize: "13px",
                                cursor: "pointer"
                            }}
                        >
                            <option value="date-desc">📅 Newest First</option>
                            <option value="date-asc">📅 Oldest First</option>
                            <option value="name-asc">🔤 Name A-Z</option>
                            <option value="name-desc">🔤 Name Z-A</option>
                        </select>
                    </div>

                    {/* Date Range Filter */}
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span style={{ color: T.text3, fontSize: "12px", fontWeight: "bold" }}>DATE:</span>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            style={{
                                flex: 1,
                                padding: "8px 12px",
                                backgroundColor: T.card,
                                border: `1px solid ${T.border}`,
                                borderRadius: "8px",
                                color: T.text,
                                fontSize: "13px",
                                colorScheme: "dark"
                            }}
                        />
                        <span style={{ color: T.text3, fontSize: "12px" }}>to</span>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            style={{
                                flex: 1,
                                padding: "8px 12px",
                                backgroundColor: T.card,
                                border: `1px solid ${T.border}`,
                                borderRadius: "8px",
                                color: T.text,
                                fontSize: "13px",
                                colorScheme: "dark"
                            }}
                        />
                        {(dateFrom || dateTo) && (
                            <button
                                onClick={() => { setDateFrom(""); setDateTo(""); }}
                                style={{
                                    padding: "8px 12px",
                                    backgroundColor: T.card2,
                                    color: T.text3,
                                    border: "none",
                                    borderRadius: "8px",
                                    cursor: "pointer",
                                    fontSize: "12px"
                                }}
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                        <button
                            onClick={() => exportHistory("csv")}
                            disabled={filteredHistory.length === 0}
                            style={{
                                padding: "8px 14px",
                                backgroundColor: T.card2,
                                color: T.text,
                                border: `1px solid ${T.border}`,
                                borderRadius: "8px",
                                cursor: filteredHistory.length === 0 ? "not-allowed" : "pointer",
                                fontSize: "12px",
                                fontWeight: "bold",
                                opacity: filteredHistory.length === 0 ? 0.5 : 1
                            }}
                        >
                            📥 Export CSV
                        </button>
                        <button
                            onClick={() => exportHistory("json")}
                            disabled={filteredHistory.length === 0}
                            style={{
                                padding: "8px 14px",
                                backgroundColor: T.card2,
                                color: T.text,
                                border: `1px solid ${T.border}`,
                                borderRadius: "8px",
                                cursor: filteredHistory.length === 0 ? "not-allowed" : "pointer",
                                fontSize: "12px",
                                fontWeight: "bold",
                                opacity: filteredHistory.length === 0 ? 0.5 : 1
                            }}
                        >
                            📥 Export JSON
                        </button>
                        <button
                            onClick={() => setShowClearConfirm(true)}
                            disabled={history.length === 0}
                            style={{
                                padding: "8px 14px",
                                backgroundColor: history.length === 0 ? T.card2 : "#e74c3c",
                                color: "white",
                                border: "none",
                                borderRadius: "8px",
                                cursor: history.length === 0 ? "not-allowed" : "pointer",
                                fontSize: "12px",
                                fontWeight: "bold",
                                opacity: history.length === 0 ? 0.5 : 1
                            }}
                        >
                            🗑️ Clear All History
                        </button>
                    </div>
                </div>

                {/* History List */}
                <div style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: "16px 24px"
                }}>
                    {loading && (
                        <div style={{ textAlign: "center", padding: "40px", color: T.text2 }}>
                            ⏳ Loading...
                        </div>
                    )}

                    {error && (
                        <div style={{
                            backgroundColor: "rgba(231,76,60,0.15)",
                            border: "1px solid rgba(231,76,60,0.3)",
                            borderRadius: "10px",
                            padding: "16px",
                            color: "#e74c3c",
                            textAlign: "center"
                        }}>
                            {error}
                        </div>
                    )}

                    {!loading && !error && filteredHistory.length === 0 && (
                        <div style={{ textAlign: "center", padding: "40px" }}>
                            <div style={{ fontSize: "64px", marginBottom: "16px" }}>🔍</div>
                            <p style={{ color: T.text, fontSize: "17px", fontWeight: "bold", margin: "0 0 8px 0" }}>
                                {searchTerm || filterType !== "all" || filterRoomType !== "all" || selectedPartner !== "all" || dateFrom || dateTo
                                    ? "No results found"
                                    : "No history yet"}
                            </p>
                            <p style={{ color: T.text3, fontSize: "13px", margin: 0 }}>
                                {searchTerm || filterType !== "all" || filterRoomType !== "all" || selectedPartner !== "all" || dateFrom || dateTo
                                    ? "Try different filters"
                                    : "Start watching movies!"}
                            </p>
                        </div>
                    )}

                    {!loading && !error && filteredHistory.map((item) => {
                        const ytId = getYouTubeId(item.movieUrl);
                        const title = getMovieTitle(item);
                        const isYT = item.movieType === "youtube" || !!ytId;
                        const isCoupleRoom = item.roomType === "couple" || !item.roomType;
                        const isDeleting = deletingItems.has(item.id);

                        return (
                            <div
                                key={item.id}
                                style={{
                                    display: "flex",
                                    gap: "14px",
                                    alignItems: "center",
                                    backgroundColor: T.card,
                                    borderRadius: "12px",
                                    padding: "12px 16px",
                                    marginBottom: "10px",
                                    border: `1px solid ${T.border}`,
                                    opacity: isDeleting ? 0.5 : 1,
                                    pointerEvents: isDeleting ? "none" : "auto"
                                }}
                            >
                                {/* Thumbnail */}
                                <div style={{ position: "relative", flexShrink: 0 }}>
                                    {ytId ? (
                                        <div style={{
                                            width: "100px",
                                            height: "70px",
                                            borderRadius: "8px",
                                            overflow: "hidden",
                                            border: `1px solid ${T.border}`,
                                            backgroundColor: "#111"
                                        }}>
                                            <img
                                                src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
                                                alt=""
                                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                                onError={(e) => {
                                                    e.target.parentElement.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px">▶️</div>';
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <div style={{
                                            width: "100px",
                                            height: "70px",
                                            borderRadius: "8px",
                                            backgroundColor: T.card2,
                                            border: `1px solid ${T.border}`,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontSize: "32px"
                                        }}>
                                            🎞️
                                        </div>
                                    )}
                                    <span style={{
                                        position: "absolute",
                                        bottom: "4px",
                                        right: "4px",
                                        fontSize: "9px",
                                        fontWeight: "bold",
                                        backgroundColor: isYT ? "#e74c3c" : "#2980b9",
                                        color: "white",
                                        padding: "2px 6px",
                                        borderRadius: "4px"
                                    }}>
                                        {isYT ? "YT" : "FILE"}
                                    </span>
                                </div>

                                {/* Details */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                                        <p style={{
                                            color: T.text,
                                            fontSize: "15px",
                                            fontWeight: "bold",
                                            margin: 0,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                            flex: 1
                                        }}>
                                            {title}
                                        </p>
                                        <span style={{
                                            fontSize: "10px",
                                            fontWeight: "bold",
                                            backgroundColor: isCoupleRoom ? "rgba(255,107,53,0.2)" : "rgba(52,152,219,0.2)",
                                            color: isCoupleRoom ? "#ff6b35" : "#3498db",
                                            border: `1px solid ${isCoupleRoom ? "rgba(255,107,53,0.4)" : "rgba(52,152,219,0.4)"}`,
                                            borderRadius: "10px",
                                            padding: "2px 8px",
                                            whiteSpace: "nowrap",
                                            flexShrink: 0
                                        }}>
                                            {isCoupleRoom ? "💕 Couple" : "👯 Group"}
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                                        <span style={{ fontSize: "13px" }}>{isCoupleRoom ? "💕" : "👯"}</span>
                                        <span style={{
                                            color: isCoupleRoom ? "#ff6b35" : "#3498db",
                                            fontSize: "13px",
                                            fontWeight: "bold"
                                        }}>
                                            {item.partnerName ? `${item.partnerName}-கூட` : "Watch Together"}
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                                        <span style={{ color: T.text3, fontSize: "11px" }}>
                                            📅 {item.dateStr}
                                        </span>
                                        <span style={{ color: T.text3, fontSize: "11px" }}>
                                            🕐 {item.timeStr}
                                        </span>
                                        {item.roomId && (
                                            <span style={{ color: T.text3, fontSize: "11px" }}>
                                                🏠 {item.roomId}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Delete Button */}
                                <button
                                    onClick={() => deleteHistoryItem(item.id)}
                                    disabled={isDeleting}
                                    style={{
                                        padding: "8px 12px",
                                        backgroundColor: "rgba(231,76,60,0.15)",
                                        color: "#e74c3c",
                                        border: "1px solid rgba(231,76,60,0.3)",
                                        borderRadius: "8px",
                                        cursor: isDeleting ? "not-allowed" : "pointer",
                                        fontSize: "12px",
                                        fontWeight: "bold",
                                        flexShrink: 0
                                    }}
                                >
                                    {isDeleting ? "⏳" : "🗑️"}
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* Clear All Confirmation Modal */}
                {showClearConfirm && (
                    <div style={{
                        position: "absolute",
                        inset: 0,
                        backgroundColor: "rgba(0,0,0,0.7)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "20px"
                    }}>
                        <div style={{
                            backgroundColor: T.card,
                            borderRadius: "16px",
                            border: `1px solid ${T.border}`,
                            padding: "24px",
                            maxWidth: "400px",
                            textAlign: "center"
                        }}>
                            <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
                            <h3 style={{ color: T.text, margin: "0 0 12px 0", fontSize: "18px" }}>
                                Clear All History?
                            </h3>
                            <p style={{ color: T.text2, margin: "0 0 20px 0", fontSize: "14px" }}>
                                இது {history.length} movies-ஐ permanently delete பண்ணும்.<br />
                                இதை undo பண்ண முடியாது!
                            </p>
                            <div style={{ display: "flex", gap: "10px" }}>
                                <button
                                    onClick={() => setShowClearConfirm(false)}
                                    disabled={clearingAll}
                                    style={{
                                        flex: 1,
                                        padding: "12px",
                                        backgroundColor: T.card2,
                                        color: T.text,
                                        border: `1px solid ${T.border}`,
                                        borderRadius: "10px",
                                        cursor: clearingAll ? "not-allowed" : "pointer",
                                        fontSize: "14px",
                                        fontWeight: "bold"
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={clearAllHistory}
                                    disabled={clearingAll}
                                    style={{
                                        flex: 1,
                                        padding: "12px",
                                        backgroundColor: "#e74c3c",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "10px",
                                        cursor: clearingAll ? "not-allowed" : "pointer",
                                        fontSize: "14px",
                                        fontWeight: "bold"
                                    }}
                                >
                                    {clearingAll ? "Clearing..." : "🗑️ Clear All"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default AdvancedSearch;
