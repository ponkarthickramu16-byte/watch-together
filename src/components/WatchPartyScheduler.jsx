// src/components/WatchPartyScheduler.jsx
import { useState, useEffect, useRef } from "react";
import { db } from "../firebase";
import { doc, updateDoc, onSnapshot } from "firebase/firestore";

/**
 * WatchPartyScheduler Component
 * Features:
 * - Schedule watch party with date & time
 * - Live countdown timer
 * - Timezone handling
 * - Auto-start when countdown ends
 * - Send notifications to room participants
 * - Recurring schedules (daily, weekly)
 * - Cancel/edit scheduled parties
 */

const formatCountdown = (ms) => {
    if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, isActive: false };
    
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / 1000 / 60) % 60);
    const hours = Math.floor((ms / 1000 / 60 / 60) % 24);
    const days = Math.floor(ms / 1000 / 60 / 60 / 24);
    
    return { days, hours, minutes, seconds, isActive: true };
};

export function WatchPartyScheduler({ 
    roomId, 
    roomDocId, 
    onSchedule, 
    onCountdownEnd,
    currentSchedule,
    T 
}) {
    const [showScheduler, setShowScheduler] = useState(false);
    const [scheduledTime, setScheduledTime] = useState("");
    const [scheduledDate, setScheduledDate] = useState("");
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [recurring, setRecurring] = useState("none"); // none, daily, weekly
    const [notifyMinutes, setNotifyMinutes] = useState(5); // Notify X minutes before
    const [saving, setSaving] = useState(false);
    
    const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, isActive: false });
    const [schedule, setSchedule] = useState(currentSchedule || null);
    
    const countdownIntervalRef = useRef(null);

    // Load schedule from Firebase
    useEffect(() => {
        if (!roomDocId && !roomId) return;

        const unsubscribe = onSnapshot(doc(db, "rooms", roomDocId || roomId), (snapshot) => {
            if (snapshot.exists() && snapshot.data().schedule) {
                const scheduleData = snapshot.data().schedule;
                setSchedule(scheduleData);
            } else {
                setSchedule(null);
            }
        });

        return () => unsubscribe();
    }, [roomId, roomDocId]);

    // Countdown timer
    useEffect(() => {
        if (!schedule?.targetTime) {
            setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0, isActive: false });
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            return;
        }

        const updateCountdown = () => {
            const targetMs = new Date(schedule.targetTime).getTime();
            const now = Date.now();
            const diff = targetMs - now;
            
            const newCountdown = formatCountdown(diff);
            setCountdown(newCountdown);
            
            // Countdown ended
            if (diff <= 0 && schedule.active) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
                
                // Mark schedule as completed
                if (roomDocId || roomId) {
                    updateDoc(doc(db, "rooms", roomDocId || roomId), {
                        "schedule.active": false,
                        "schedule.completed": true,
                        "schedule.completedAt": new Date()
                    });
                }
                
                // Callback
                if (onCountdownEnd) {
                    onCountdownEnd(schedule);
                }
                
                // Auto-start video if configured
                if (schedule.autoStart) {
                    // This will be handled by parent component
                }
            }
            
            // Show notification X minutes before
            if (schedule.active && !schedule.notificationSent && diff > 0 && diff <= schedule.notifyBefore * 60 * 1000) {
                showNotification(`Watch party starting in ${schedule.notifyBefore} minutes! 🎬`);
                
                // Mark notification as sent
                if (roomDocId || roomId) {
                    updateDoc(doc(db, "rooms", roomDocId || roomId), {
                        "schedule.notificationSent": true
                    });
                }
            }
        };

        updateCountdown();
        countdownIntervalRef.current = setInterval(updateCountdown, 1000);

        return () => {
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
        };
    }, [schedule, roomId, roomDocId, onCountdownEnd]);

    const showNotification = (message) => {
        // Browser notification
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Watch Together", {
                body: message,
                icon: "/icon-192.png",
                badge: "/icon-192.png"
            });
        }
        
        // In-app notification (can be a toast)
        console.log("Notification:", message);
    };

    const requestNotificationPermission = async () => {
        if ("Notification" in window && Notification.permission === "default") {
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
                showNotification("Notifications enabled! You'll be reminded when your watch party starts. 🎉");
            }
        }
    };

    const scheduleWatchParty = async () => {
        if (!scheduledDate || !scheduledTime) {
            alert("Date and time வேணும்!");
            return;
        }

        const targetDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
        const now = new Date();

        if (targetDateTime <= now) {
            alert("Future date & time select பண்ணு!");
            return;
        }

        setSaving(true);

        try {
            const scheduleData = {
                targetTime: targetDateTime.toISOString(),
                title: title.trim() || "Watch Party",
                message: message.trim() || "Let's watch together!",
                recurring,
                notifyBefore: notifyMinutes,
                autoStart: true, // Auto-start video when countdown ends
                active: true,
                completed: false,
                notificationSent: false,
                createdAt: new Date(),
                createdBy: localStorage.getItem('username') || 'User'
            };

            const roomRef = doc(db, "rooms", roomDocId || roomId);
            await updateDoc(roomRef, { schedule: scheduleData });

            // Request notification permission
            await requestNotificationPermission();

            setShowScheduler(false);
            
            // Reset form
            setScheduledDate("");
            setScheduledTime("");
            setTitle("");
            setMessage("");
            setRecurring("none");

            if (onSchedule) {
                onSchedule(scheduleData);
            }
        } catch (err) {
            console.error("Schedule error:", err);
            alert("❌ Schedule fail ஆச்சு: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const cancelSchedule = async () => {
        if (!window.confirm("Schedule-ஐ cancel பண்ணலாமா?")) return;

        try {
            const roomRef = doc(db, "rooms", roomDocId || roomId);
            await updateDoc(roomRef, { schedule: null });
        } catch (err) {
            console.error("Cancel error:", err);
            alert("❌ Cancel fail ஆச்சு: " + err.message);
        }
    };

    // Quick schedule presets
    const scheduleQuick = async (minutes) => {
        const targetDateTime = new Date(Date.now() + minutes * 60 * 1000);
        
        const scheduleData = {
            targetTime: targetDateTime.toISOString(),
            title: `Watch Party in ${minutes} minutes`,
            message: "Quick schedule!",
            recurring: "none",
            notifyBefore: Math.min(minutes - 1, 5),
            autoStart: true,
            active: true,
            completed: false,
            notificationSent: false,
            createdAt: new Date(),
            createdBy: localStorage.getItem('username') || 'User'
        };

        try {
            const roomRef = doc(db, "rooms", roomDocId || roomId);
            await updateDoc(roomRef, { schedule: scheduleData });
            await requestNotificationPermission();
        } catch (err) {
            alert("❌ Quick schedule fail: " + err.message);
        }
    };

    return (
        <>
            {/* Countdown Display (when scheduled) */}
            {schedule?.active && countdown.isActive && (
                <div style={{
                    position: "fixed",
                    top: "20px",
                    right: "20px",
                    backgroundColor: T.card,
                    border: `2px solid ${T.primary}`,
                    borderRadius: "16px",
                    padding: "16px 20px",
                    zIndex: 9999,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    minWidth: "280px"
                }}>
                    <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "12px"
                    }}>
                        <div>
                            <div style={{
                                color: T.text,
                                fontSize: "14px",
                                fontWeight: "bold",
                                marginBottom: "2px"
                            }}>
                                ⏰ {schedule.title}
                            </div>
                            <div style={{
                                color: T.text3,
                                fontSize: "11px"
                            }}>
                                {schedule.message}
                            </div>
                        </div>
                        <button
                            onClick={cancelSchedule}
                            style={{
                                background: "none",
                                border: "none",
                                color: T.text3,
                                cursor: "pointer",
                                fontSize: "16px",
                                padding: "0 4px"
                            }}
                        >
                            ✕
                        </button>
                    </div>

                    {/* Countdown Timer */}
                    <div style={{
                        display: "flex",
                        gap: "8px",
                        justifyContent: "center"
                    }}>
                        {countdown.days > 0 && (
                            <div style={{
                                backgroundColor: T.card2,
                                borderRadius: "10px",
                                padding: "10px 12px",
                                textAlign: "center",
                                minWidth: "50px"
                            }}>
                                <div style={{
                                    color: T.primary,
                                    fontSize: "22px",
                                    fontWeight: "bold",
                                    lineHeight: 1
                                }}>
                                    {countdown.days}
                                </div>
                                <div style={{
                                    color: T.text3,
                                    fontSize: "10px",
                                    marginTop: "4px"
                                }}>
                                    DAYS
                                </div>
                            </div>
                        )}
                        <div style={{
                            backgroundColor: T.card2,
                            borderRadius: "10px",
                            padding: "10px 12px",
                            textAlign: "center",
                            minWidth: "50px"
                        }}>
                            <div style={{
                                color: T.primary,
                                fontSize: "22px",
                                fontWeight: "bold",
                                lineHeight: 1
                            }}>
                                {String(countdown.hours).padStart(2, '0')}
                            </div>
                            <div style={{
                                color: T.text3,
                                fontSize: "10px",
                                marginTop: "4px"
                            }}>
                                HRS
                            </div>
                        </div>
                        <div style={{
                            backgroundColor: T.card2,
                            borderRadius: "10px",
                            padding: "10px 12px",
                            textAlign: "center",
                            minWidth: "50px"
                        }}>
                            <div style={{
                                color: T.primary,
                                fontSize: "22px",
                                fontWeight: "bold",
                                lineHeight: 1
                            }}>
                                {String(countdown.minutes).padStart(2, '0')}
                            </div>
                            <div style={{
                                color: T.text3,
                                fontSize: "10px",
                                marginTop: "4px"
                            }}>
                                MIN
                            </div>
                        </div>
                        <div style={{
                            backgroundColor: T.card2,
                            borderRadius: "10px",
                            padding: "10px 12px",
                            textAlign: "center",
                            minWidth: "50px"
                        }}>
                            <div style={{
                                color: T.primary,
                                fontSize: "22px",
                                fontWeight: "bold",
                                lineHeight: 1,
                                animation: "pulse 1s infinite"
                            }}>
                                {String(countdown.seconds).padStart(2, '0')}
                            </div>
                            <div style={{
                                color: T.text3,
                                fontSize: "10px",
                                marginTop: "4px"
                            }}>
                                SEC
                            </div>
                        </div>
                    </div>

                    {countdown.days === 0 && countdown.hours === 0 && countdown.minutes < 5 && (
                        <div style={{
                            marginTop: "12px",
                            padding: "8px",
                            backgroundColor: "rgba(255,107,53,0.15)",
                            border: "1px solid rgba(255,107,53,0.3)",
                            borderRadius: "8px",
                            textAlign: "center",
                            color: T.primary,
                            fontSize: "12px",
                            fontWeight: "bold"
                        }}>
                            🔥 Starting soon! Get ready!
                        </div>
                    )}
                </div>
            )}

            {/* Schedule Button */}
            <button
                onClick={() => setShowScheduler(!showScheduler)}
                style={{
                    padding: "8px 14px",
                    backgroundColor: schedule?.active ? T.primary : T.card2,
                    color: schedule?.active ? "white" : T.text,
                    border: `1px solid ${schedule?.active ? T.primary : T.border}`,
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                }}
            >
                <span>⏰</span>
                <span>{schedule?.active ? "Scheduled" : "Schedule"}</span>
            </button>

            {/* Scheduler Modal */}
            {showScheduler && (
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
                        maxWidth: "500px",
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
                                    ⏰ Schedule Watch Party
                                </h2>
                                <p style={{ color: T.text3, margin: 0, fontSize: "13px" }}>
                                    Set a time to watch together
                                </p>
                            </div>
                            <button
                                onClick={() => setShowScheduler(false)}
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

                        <div style={{
                            padding: "24px",
                            overflowY: "auto"
                        }}>
                            {/* Quick Schedule */}
                            <div style={{ marginBottom: "24px" }}>
                                <label style={{
                                    color: T.text2,
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                    display: "block",
                                    marginBottom: "10px"
                                }}>
                                    ⚡ QUICK SCHEDULE
                                </label>
                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                    {[5, 10, 15, 30, 60].map(mins => (
                                        <button
                                            key={mins}
                                            onClick={() => {
                                                scheduleQuick(mins);
                                                setShowScheduler(false);
                                            }}
                                            style={{
                                                padding: "10px 16px",
                                                backgroundColor: T.card,
                                                color: T.text,
                                                border: `1px solid ${T.border}`,
                                                borderRadius: "8px",
                                                cursor: "pointer",
                                                fontSize: "13px",
                                                fontWeight: "bold"
                                            }}
                                        >
                                            {mins} min
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div style={{
                                height: "1px",
                                backgroundColor: T.border,
                                margin: "24px 0"
                            }} />

                            {/* Custom Schedule */}
                            <div style={{ marginBottom: "16px" }}>
                                <label style={{
                                    color: T.text2,
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                    display: "block",
                                    marginBottom: "6px"
                                }}>
                                    Title (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Friday Movie Night 🎬"
                                    style={{
                                        width: "100%",
                                        padding: "12px",
                                        backgroundColor: T.card,
                                        border: `1px solid ${T.border}`,
                                        borderRadius: "10px",
                                        color: T.text,
                                        fontSize: "14px",
                                        outline: "none",
                                        boxSizing: "border-box"
                                    }}
                                />
                            </div>

                            <div style={{ marginBottom: "16px" }}>
                                <label style={{
                                    color: T.text2,
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                    display: "block",
                                    marginBottom: "6px"
                                }}>
                                    Message (Optional)
                                </label>
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="Don't miss it! 🍿"
                                    rows={2}
                                    style={{
                                        width: "100%",
                                        padding: "12px",
                                        backgroundColor: T.card,
                                        border: `1px solid ${T.border}`,
                                        borderRadius: "10px",
                                        color: T.text,
                                        fontSize: "14px",
                                        outline: "none",
                                        boxSizing: "border-box",
                                        resize: "vertical"
                                    }}
                                />
                            </div>

                            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{
                                        color: T.text2,
                                        fontSize: "12px",
                                        fontWeight: "bold",
                                        display: "block",
                                        marginBottom: "6px"
                                    }}>
                                        Date *
                                    </label>
                                    <input
                                        type="date"
                                        value={scheduledDate}
                                        onChange={(e) => setScheduledDate(e.target.value)}
                                        min={new Date().toISOString().split('T')[0]}
                                        style={{
                                            width: "100%",
                                            padding: "12px",
                                            backgroundColor: T.card,
                                            border: `1px solid ${T.border}`,
                                            borderRadius: "10px",
                                            color: T.text,
                                            fontSize: "14px",
                                            outline: "none",
                                            boxSizing: "border-box",
                                            colorScheme: "dark"
                                        }}
                                    />
                                </div>

                                <div style={{ flex: 1 }}>
                                    <label style={{
                                        color: T.text2,
                                        fontSize: "12px",
                                        fontWeight: "bold",
                                        display: "block",
                                        marginBottom: "6px"
                                    }}>
                                        Time *
                                    </label>
                                    <input
                                        type="time"
                                        value={scheduledTime}
                                        onChange={(e) => setScheduledTime(e.target.value)}
                                        style={{
                                            width: "100%",
                                            padding: "12px",
                                            backgroundColor: T.card,
                                            border: `1px solid ${T.border}`,
                                            borderRadius: "10px",
                                            color: T.text,
                                            fontSize: "14px",
                                            outline: "none",
                                            boxSizing: "border-box",
                                            colorScheme: "dark"
                                        }}
                                    />
                                </div>
                            </div>

                            <div style={{ marginBottom: "16px" }}>
                                <label style={{
                                    color: T.text2,
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                    display: "block",
                                    marginBottom: "6px"
                                }}>
                                    Recurring
                                </label>
                                <select
                                    value={recurring}
                                    onChange={(e) => setRecurring(e.target.value)}
                                    style={{
                                        width: "100%",
                                        padding: "12px",
                                        backgroundColor: T.card,
                                        border: `1px solid ${T.border}`,
                                        borderRadius: "10px",
                                        color: T.text,
                                        fontSize: "14px",
                                        cursor: "pointer"
                                    }}
                                >
                                    <option value="none">One-time only</option>
                                    <option value="daily">Daily (same time)</option>
                                    <option value="weekly">Weekly (same day & time)</option>
                                </select>
                            </div>

                            <div style={{ marginBottom: "24px" }}>
                                <label style={{
                                    color: T.text2,
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                    display: "block",
                                    marginBottom: "6px"
                                }}>
                                    Notify Before (minutes)
                                </label>
                                <input
                                    type="number"
                                    value={notifyMinutes}
                                    onChange={(e) => setNotifyMinutes(parseInt(e.target.value) || 5)}
                                    min={1}
                                    max={60}
                                    style={{
                                        width: "100%",
                                        padding: "12px",
                                        backgroundColor: T.card,
                                        border: `1px solid ${T.border}`,
                                        borderRadius: "10px",
                                        color: T.text,
                                        fontSize: "14px",
                                        outline: "none",
                                        boxSizing: "border-box"
                                    }}
                                />
                            </div>

                            <button
                                onClick={scheduleWatchParty}
                                disabled={saving || !scheduledDate || !scheduledTime}
                                style={{
                                    width: "100%",
                                    padding: "14px",
                                    backgroundColor: (!scheduledDate || !scheduledTime || saving) ? T.card2 : T.primary,
                                    color: "white",
                                    border: "none",
                                    borderRadius: "10px",
                                    cursor: (!scheduledDate || !scheduledTime || saving) ? "not-allowed" : "pointer",
                                    fontSize: "15px",
                                    fontWeight: "bold",
                                    opacity: (!scheduledDate || !scheduledTime || saving) ? 0.5 : 1
                                }}
                            >
                                {saving ? "⏳ Scheduling..." : "✅ Schedule Watch Party"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </>
    );
}

export default WatchPartyScheduler;
