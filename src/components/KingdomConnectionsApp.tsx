import React, { useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  sendPasswordResetEmail,
  linkWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Crown,
  Flame,
  Gamepad2,
  LogIn,
  Mail,
  Medal,
  MessageCircle,
  PartyPopper,
  Play,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { auth, db } from "../lib/firebase";
import { BIBLE_QUESTIONS, ICEBREAKER_PROMPTS, MULTIPLAYER_QUESTIONS } from "../data/questions";
import { HOT_TAKES, HYPOTHETICALS } from "../data/questions";
import {
  createRoom,
  joinRoom,
  setRoomMode,
  voteHotTake,
  submitHypothetical,
  advanceRound,
  subscribeRoom,
  type RoomData,
  type SpinnerCategory,
  startSpinnerMatch,
  spinForCategory,
  beginSpinnerAnswers,
  submitSpinnerAnswer,
  showSpinnerResults,
  advanceSpinnerRound,
} from "../services/roomService";
import { sounds } from "../utils/soundEffects";
import "../kingdom-connections.css";

const AVATARS = ["🕊️", "👑", "✝️", "🌟", "🔥", "💎", "🛡️", "🌸", "📖", "🍞"];
type Toast = { message: string; type?: "success" | "error" } | null;

function errorMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  const fallback = (error as Error)?.message || "Something went wrong. Please try again.";
  const map: Record<string, string> = {
    "auth/email-already-in-use": "That email already has an account. Try signing in.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-not-found": "No account was found for that email.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/network-request-failed": "Network error. Check your internet connection.",
  };
  return (code && map[code]) || fallback;
}

async function savePublicProfile(user: User, displayName?: string, avatar?: string) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const old = snap.exists() ? snap.data() : {};
  await setDoc(ref, {
    displayName: (displayName || old.displayName || user.displayName || "Kingdom Player").slice(0, 32),
    avatar: avatar || old.avatar || "🕊️",
    isAnonymous: user.isAnonymous,
    createdAt: old.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

function shareText(text: string) {
  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function KingdomConnectionsApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"guest" | "signin" | "signup" | "reset">("guest");
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);

  const [view, setView] = useState<"home" | "solo" | "room" | "profile" | "leaderboard">("home");
  const [roomCode, setRoomCode] = useState("");
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [soloIndex, setSoloIndex] = useState(0);
  const [soloAnswers, setSoloAnswers] = useState<Record<string, number>>({});
  const [soloFinished, setSoloFinished] = useState(false);
  const [hypotheticalInput, setHypotheticalInput] = useState("");
  const [icebreaker, setIcebreaker] = useState(0);
  const [flyingEmojis, setFlyingEmojis] = useState<{ id: number; emoji: string }[]>([]);
  const [spinnerSecondsLeft, setSpinnerSecondsLeft] = useState(20);

  const sendEmoji = (emoji: string) => {
    sounds.playPop();
    const id = Date.now();
    setFlyingEmojis((prev) => [...prev, { id, emoji }]);
    setTimeout(() => {
      setFlyingEmojis((prev) => prev.filter((item) => item.id !== id));
    }, 2000);
  };

  const notify = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3600);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        try { await savePublicProfile(nextUser); } catch (e) { console.error(e); }
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user || !activeRoomId) return;
    return subscribeRoom(activeRoomId, (data) => {
      setRoomData(data);
      if (!data) {
        setActiveRoomId(null);
        notify("This room no longer exists.", "error");
      }
    }, (error) => notify(error.message, "error"));
  }, [user, activeRoomId]);

  useEffect(() => {
    const game = roomData?.spinnerGame as any;
    if (roomData?.gameMode !== "spinner" || game?.phase !== "answering" || !game?.startedAt) {
      return;
    }

    const duration = game.duration || 25;

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - game.startedAt) / 1000);
      const remaining = Math.max(0, duration - elapsed);
      setSpinnerSecondsLeft(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [roomData?.gameMode, roomData?.spinnerGame?.phase, roomData?.spinnerGame?.deadline]);

  const currentQuestion = BIBLE_QUESTIONS[soloIndex];
  const soloScore = useMemo(() => BIBLE_QUESTIONS.reduce((score, q) => (
    score + (soloAnswers[q.id] === q.correctIndex ? 100 : 0)
  ), 0), [soloAnswers]);

  const roomPlayers = Object.values(roomData?.players || {});
  const isHost = !!user && roomData?.hostId === user.uid;
  const spinnerGame = roomData?.spinnerGame;

  const mySpinnerAssignment = user && spinnerGame ? spinnerGame.assignments[user.uid] : undefined;
  const spinnerQuestion = mySpinnerAssignment
    ? MULTIPLAYER_QUESTIONS.find((q) => q.id === mySpinnerAssignment.questionId)
    : undefined;

  const spinnerLeaderboard = [...roomPlayers].sort(
    (a, b) => (spinnerGame?.scores[b.uid] ?? 0) - (spinnerGame?.scores[a.uid] ?? 0)
  );

  const currentHotTake = HOT_TAKES[(roomData?.currentQuestionIdx || 0) % HOT_TAKES.length];
  const currentHypothetical = HYPOTHETICALS[(roomData?.currentQuestionIdx || 0) % HYPOTHETICALS.length];

  const startGuest = async () => {
    setBusy(true);
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      setAuthMode("guest");
      notify("You're ready to play!");
    } catch (e) { notify(errorMessage(e), "error"); }
    finally { setBusy(false); }
  };

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return notify("Enter your email address.", "error");
    setBusy(true);
    try {
      if (authMode === "reset") {
        await sendPasswordResetEmail(auth, email.trim());
        notify("Password reset email sent. Check your inbox.");
      } else if (authMode === "signup") {
        if (password.length < 6) return notify("Use a password with at least 6 characters.", "error");
        if (auth.currentUser?.isAnonymous) {
          const credential = EmailAuthProvider.credential(email.trim(), password);
          await linkWithCredential(auth.currentUser, credential);
          if (name.trim()) await updateProfile(auth.currentUser, { displayName: name.trim() });
          await savePublicProfile(auth.currentUser, name.trim(), avatar);
          notify("Guest progress linked to your account.");
        } else {
          const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
          if (name.trim()) await updateProfile(result.user, { displayName: name.trim() });
          await savePublicProfile(result.user, name.trim(), avatar);
          notify("Account created successfully.");
        }
        setAuthMode("guest");
      } else {
        const result = await signInWithEmailAndPassword(auth, email.trim(), password);
        await savePublicProfile(result.user, name.trim(), avatar);
        notify("Welcome back!");
        setAuthMode("guest");
      }
    } catch (e) { notify(errorMessage(e), "error"); }
    finally { setBusy(false); }
  };

  const handleStartSpinner = async () => {
    if (!user || !activeRoomId) return notify("Create or join a room first.", "error");
    try {
      await startSpinnerMatch(activeRoomId, user.uid);
      notify("Spinner game started!");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const handleSpin = async () => {
    if (!user || !activeRoomId) return;
    try {
      await spinForCategory(
        activeRoomId,
        user.uid,
        MULTIPLAYER_QUESTIONS.map(({ id, category }) => ({ id, category: category as SpinnerCategory }))
      );
      notify("Your question has been selected!");
    } catch (error) { notify(errorMessage(error), "error"); }
  };

 const handleBeginAnswers = async () => {
  if (!activeRoomId || !user) return;
  
  const roomRef = doc(db, "rooms", activeRoomId);
  await updateDoc(roomRef, {
    "spinnerGame.phase": "answering",
    "spinnerGame.startedAt": Date.now(), // Real-time timestamp shared across devices
    "spinnerGame.duration": 25 // Set to 25s to give a 5s grace buffer for network latency
  });
};
  const handleSpinnerAnswer = async (selectedIndex: number) => {
    if (!user || !activeRoomId || !spinnerQuestion) return;
    try {
      await submitSpinnerAnswer(activeRoomId, user.uid, selectedIndex, spinnerQuestion.correctIndex);
      notify(selectedIndex === spinnerQuestion.correctIndex ? "Correct! +10 points." : "Answer submitted.");
    } catch (error) { notify(errorMessage(error), "error"); }
  };

  const handleShowSpinnerResults = async () => {
    if (!user || !activeRoomId) return;
    try { await showSpinnerResults(activeRoomId, user.uid); } catch (error) { notify(errorMessage(error), "error"); }
  };

  const handleAdvanceSpinner = async () => {
    if (!user || !activeRoomId) return;
    try { await advanceSpinnerRound(activeRoomId, user.uid); } catch (error) { notify(errorMessage(error), "error"); }
  };

  const handleCreateRoom = async () => {
    if (!user) return notify("Start as a guest or sign in first.", "error");
    if (!name.trim() && !user.displayName) return notify("Enter a display name first.", "error");
    setBusy(true);
    try {
      const id = await createRoom(user.uid, name.trim() || user.displayName || "Player", avatar);
      setActiveRoomId(id);
      setView("room");
      notify(`Room ${id} created.`);
    } catch (e) { notify(errorMessage(e), "error"); }
    finally { setBusy(false); }
  };

  const handleJoinRoom = async () => {
    if (!user) return notify("Start as a guest or sign in first.", "error");
    if (!roomCode.trim()) return notify("Enter a room code.", "error");
    if (!name.trim() && !user.displayName) return notify("Enter a display name first.", "error");
    setBusy(true);
    try {
      const id = roomCode.trim().toUpperCase();
      await joinRoom(id, user.uid, name.trim() || user.displayName || "Player", avatar);
      setActiveRoomId(id);
      setView("room");
      notify(`Joined room ${id}.`);
    } catch (e) { notify(errorMessage(e), "error"); }
    finally { setBusy(false); }
  };

  const answerSolo = (optionIndex: number) => {
    if (!currentQuestion || soloAnswers[currentQuestion.id] !== undefined) return;
    setSoloAnswers((prev) => ({ ...prev, [currentQuestion.id]: optionIndex }));
  };

  const nextSolo = () => {
    if (soloIndex >= BIBLE_QUESTIONS.length - 1) setSoloFinished(true);
    else setSoloIndex((index) => index + 1);
  };

  const resetSolo = () => {
    setSoloIndex(0); setSoloAnswers({}); setSoloFinished(false);
  };

  const signOutUser = async () => {
    setActiveRoomId(null); setRoomData(null); setView("home");
    await signOut(auth);
    notify("Signed out.");
  };

  if (!authReady) return <div className="kc-loading"><div className="kc-orbit"><Crown size={28}/></div><p>Preparing your Kingdom...</p></div>;

  return (
    <div className="kc-app">
      {toast && <div className={`kc-toast ${toast.type === "error" ? "is-error" : ""}`} role="status"><Check size={16}/>{toast.message}<button onClick={() => setToast(null)} aria-label="Dismiss"><X size={14}/></button></div>}

      <header className="kc-header">
        <button className="kc-brand" onClick={() => setView("home")} aria-label="Kingdom Connections home">
          <span className="kc-brand-mark"><Crown size={22}/></span>
          <span><strong>Kingdom Connections</strong><small>Faith · Friendship · Fellowship</small></span>
        </button>
        <div className="kc-header-actions">
          {user ? <button className="kc-user-chip" onClick={() => setView("profile")}><span>{avatar}</span><span className="kc-user-chip-name">{name || user.displayName || "Player"}</span><ChevronRight size={14}/></button> : <button className="kc-button kc-button-small" onClick={startGuest}>Play as guest</button>}
        </div>
      </header>

      <main className="kc-main">
        {view === "home" && (
          <>
            <section className="kc-hero kc-enter">
              <div className="kc-hero-copy">
                <div className="kc-eyebrow"><Sparkles size={14}/> NAIJA SINGLES MIXER & FELLOWSHIP</div>
                <h1>Play with purpose.<br/><span>Connect beyond the game.</span></h1>
                <p>Spark real banter, share hot takes, and find your people through fun lifestyle debates and scenarios.</p>
                <div className="kc-hero-actions">
                  <button className="kc-button kc-button-primary" onClick={() => { if (!user) startGuest(); setView("solo"); }} type="button"><Play size={16} fill="currentColor"/> Bible Challenge <ArrowRight size={16}/></button>
                  <button className="kc-button kc-button-ghost" onClick={() => { if (!user) startGuest(); setView("room"); }} type="button"><Users size={16}/> Multiplayer Room</button>
                </div>
              </div>
              <div className="kc-hero-feature">
                <div className="kc-feature-label">VIBE CHECK</div>
                <div className="kc-feature-quote">“No boring small talk. Straight to the gist.”</div>
                <div className="kc-feature-divider"/>
                <p>Designed for TwitterNG, TikTok, and Christian singles ready for intentional connections.</p>
                <div className="kc-feature-footer"><span>FAITH</span><span>RELATIONSHIPS</span><span>VIBES</span></div>
              </div>
            </section>

            <section className="kc-section">
              <div className="kc-section-heading"><div><div className="kc-eyebrow">CHOOSE YOUR EXPERIENCE</div><h2>Explore the games</h2></div><span className="kc-live-pill"><i/> READY</span></div>
              <div className="kc-mode-grid">
                <button className="kc-mode-card" onClick={() => setView("solo")} type="button"><span className="kc-mode-icon"><BookOpen size={20}/></span><span className="kc-mode-label">SOLO</span><strong>Bible Challenge</strong><p>Test your scripture knowledge at your own pace.</p><span className="kc-card-link">Play solo <ArrowRight size={14}/></span></button>
                <button className="kc-mode-card" onClick={() => setView("room")} type="button"><span className="kc-mode-icon"><Users size={20}/></span><span className="kc-mode-label">MULTIPLAYER</span><strong>Hot Takes & Hypotheticals</strong><p>Debate spicy Naija relationship and lifestyle views with friends.</p><span className="kc-card-link">Enter room <ArrowRight size={14}/></span></button>
                <button className="kc-mode-card" onClick={() => { setIcebreaker((i) => (i + 1) % ICEBREAKER_PROMPTS.length); }} type="button"><span className="kc-mode-icon"><MessageCircle size={20}/></span><span className="kc-mode-label">ICEBREAKER</span><strong>Conversation Prompt</strong><p>{ICEBREAKER_PROMPTS[icebreaker]}</p><span className="kc-card-link">Next prompt <RefreshCw size={14}/></span></button>
              </div>
            </section>
          </>
        )}

        {view === "solo" && (
          <section className="kc-game-panel kc-enter">
            <div className="kc-page-top"><button className="kc-back-link" onClick={() => setView("home")} type="button">← Back to home</button><span className="kc-pill"><BookOpen size={14}/> BIBLE CHALLENGE</span></div>
            {!soloFinished ? (
              <>
                <div className="kc-game-title-row"><div><h1>Grow your knowledge.</h1><p>Choose the best answer.</p></div><div className="kc-score-box"><Trophy size={18}/><span><small>SCORE</small><strong>{soloScore}</strong></span></div></div>
                <article className="kc-question-card">
                  <div className="kc-question-meta"><span>{currentQuestion.category}</span></div>
                  <h2>{currentQuestion.question}</h2>
                  <div className="kc-answer-grid">{currentQuestion.options.map((option, index) => {
                    const selected = soloAnswers[currentQuestion.id] === index;
                    const answered = soloAnswers[currentQuestion.id] !== undefined;
                    const correct = currentQuestion.correctIndex === index;
                    return <button key={option} disabled={answered} onClick={() => answerSolo(index)} className={`kc-answer ${selected ? "selected" : ""} ${answered && correct ? "correct" : ""} ${selected && !correct ? "incorrect" : ""}`} type="button"><span className="kc-answer-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span></button>;
                  })}</div>
                  <div className="kc-question-footer"><button className="kc-button kc-button-primary" disabled={soloAnswers[currentQuestion.id] === undefined} onClick={nextSolo} type="button">Next <ArrowRight size={15}/></button></div>
                </article>
              </>
            ) : (
              <div className="kc-results-card" style={{ textAlign: "center", padding: 40 }}>
                <PartyPopper size={36} color="#285541"/>
                <h2>Challenge Complete!</h2>
                <p>Final Score: {soloScore} points</p>
                <button className="kc-button kc-button-primary" onClick={resetSolo} type="button" style={{ marginTop: 20 }}>Play again</button>
              </div>
            )}
          </section>
        )}

        {view === "room" && (
          <section className="kc-game-panel kc-enter">
            <div className="kc-page-top">
              <button className="kc-back-link" onClick={() => setView("home")} type="button">← Back to home</button>
              <span className="kc-pill"><Users size={14}/> NAIJA SINGLES ROOM</span>
            </div>

            {!activeRoomId || !roomData ? (
              <div className="kc-room-entry">
                <div className="kc-eyebrow">JOIN THE VIBE</div>
                <h1>Create or Join a Room</h1>

                <div style={{ marginTop: 20 }}>
                  {/* Your Name / Nickname Input */}
                  <div style={{ marginTop: 16 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase", color: "#666" }}>
                      Your Name / Nickname
                    </label>
                    <input
                      value={name}
                      maxLength={32}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Tunde"
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid #e2ded4",
                        boxSizing: "border-box"
                      }}
                    />
                  </div>

                  {/* Choose Avatar Grid */}
                  <div style={{ marginTop: 16 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase", color: "#666" }}>
                      Choose Avatar
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {AVATARS.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setAvatar(a)}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            border: avatar === a ? "2px solid #285541" : "1px solid #e2ded4",
                            background: avatar === a ? "#edf5ed" : "#fbfaf6",
                            fontSize: 18,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons (Create / Join) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
                    <button
                      disabled={busy}
                      className="kc-button kc-button-primary"
                      onClick={handleCreateRoom}
                      type="button"
                      style={{ width: "100%", padding: "12px", fontSize: 14, fontWeight: 600 }}
                    >
                      Create Room
                    </button>

                    <div style={{ display: "flex", gap: 8, width: "100%" }}>
                      <input
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                        placeholder="CODE"
                        maxLength={6}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid #e2ded4",
                          textAlign: "center",
                          fontWeight: 600,
                          letterSpacing: "1px"
                        }}
                      />
                      <button
                        disabled={busy || !roomCode.trim()}
                        className="kc-button kc-button-outline"
                        onClick={handleJoinRoom}
                        type="button"
                        style={{ padding: "10px 20px" }}
                      >
                        Join
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="kc-room-view">
                {/* Active room content continues here... */}

   <div className="kc-room-header">
                  <div>
                    <div className="kc-eyebrow">ROOM CODE</div>
                    <h1><span>{activeRoomId}</span></h1>
                    <p>{roomPlayers.length} player{roomPlayers.length === 1 ? "" : "s"} inside</p>
                  </div>
                  <button className="kc-button kc-button-outline" onClick={() => shareText(`Join my Kingdom Connections room! Code: ${activeRoomId}`)} type="button"><Share2 size={15}/> Share Room</button>
                </div>

                <div className="kc-player-strip">
                  {roomPlayers.map((p) => (
                    <div className="kc-player-chip" key={p.uid}>
                      <span>{p.avatar}</span><b>{p.name}</b>
                      {p.isHost && <span className="kc-host-tag"><Crown size={11}/> Host</span>}
                    </div>
                  ))}
                </div>

                {isHost && (
                  <div className="kc-host-tabs">
                    <button type="button" className={roomData.gameMode === "lobby" ? "active" : ""} onClick={() => setRoomMode(activeRoomId, user!.uid, "lobby")}>Lobby</button>
                    <button type="button" className={roomData.gameMode === "hottakes" ? "active" : ""} onClick={() => setRoomMode(activeRoomId, user!.uid, "hottakes")}>Hot Takes</button>
                    <button type="button" className={roomData.gameMode === "hypotheticals" ? "active" : ""} onClick={() => setRoomMode(activeRoomId, user!.uid, "hypotheticals")}>If E Reach Your Turn</button>
                    <button type="button" className={roomData.gameMode === "spinner" ? "active" : ""} onClick={handleStartSpinner}>Kingdom Spinner</button>
                  </div>
                )}


                {roomData.gameMode === "hottakes" && (
  <div className="kc-wyr-panel">
    <div className="kc-eyebrow">
      HOT TAKE #{ (roomData.currentQuestionIdx % HOT_TAKES.length) + 1 } · {currentHotTake.category}
    </div>
    
    <h2 style={{ fontSize: "1.25rem", margin: "12px 0 20px", lineHeight: "1.4" }}>
      {currentHotTake.statement}
    </h2>

    {/* Voting Action Buttons */}
    <div className="kc-wyr-options" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
      {(["Agree", "Disagree", "Hot Take"] as const).map((choice) => {
        const myChoice = roomData.players[user!.uid]?.hotTakeVotes?.[currentHotTake.id];
        const isPicked = myChoice === choice;
        return (
          <button
            key={choice}
            className={isPicked ? "picked" : ""}
            onClick={() => voteHotTake(activeRoomId, user!.uid, currentHotTake.id, choice)}
            type="button"
            style={{
              padding: "10px 4px",
              borderRadius: 10,
              border: isPicked ? "2px solid #285541" : "1px solid #e2ded4",
              background: isPicked ? "#edf5ed" : "#fbfaf6",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13
            }}
          >
            <span style={{ display: "block", fontSize: 10, opacity: 0.7, textTransform: "uppercase" }}>
              {isPicked ? "LOCKED" : "VOTE"}
            </span>
            {choice}
          </button>
        );
      })}
    </div>

    {/* 📊 REAL-TIME VOTING BOARD & BREAKDOWN */}
    <div style={{ marginTop: 24, padding: 16, background: "#fbfaf6", borderRadius: 12, border: "1px solid #e2ded4" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "#666" }}>
          LIVE VOTING BOARD
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#285541" }}>
          {roomPlayers.filter(p => p.hotTakeVotes?.[currentHotTake.id]).length} / {roomPlayers.length} Voted
        </div>
      </div>

      {/* Breakdown Columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
        {(["Agree", "Disagree", "Hot Take"] as const).map((choice) => {
          const voters = roomPlayers.filter(p => p.hotTakeVotes?.[currentHotTake.id] === choice);
          return (
            <div key={choice} style={{ background: "#fff", padding: 10, borderRadius: 8, border: "1px solid #eee" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#444", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                <span>{choice}</span>
                <span style={{ background: "#edf5ed", color: "#285541", padding: "0 6px", borderRadius: 10 }}>{voters.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {voters.length > 0 ? (
                  voters.map(p => (
                    <div key={p.uid} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                      <span>{p.avatar}</span>
                      <span style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                    </div>
                  ))
                ) : (
                  <span style={{ fontSize: 11, color: "#aaa", fontStyle: "italic" }}>No votes yet</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {/* Action Bar */}
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      <button 
        className="kc-button kc-button-outline" 
        onClick={() => {
          const agreeVoters = roomPlayers.filter(p => p.hotTakeVotes?.[currentHotTake.id] === "Agree").map(p => p.name).join(", ");
          const disagreeVoters = roomPlayers.filter(p => p.hotTakeVotes?.[currentHotTake.id] === "Disagree").map(p => p.name).join(", ");
          const hotTakeVoters = roomPlayers.filter(p => p.hotTakeVotes?.[currentHotTake.id] === "Hot Take").map(p => p.name).join(", ");
          
          shareText(`⚡ *KINGDOM CONNECTIONS: Hot Takes Debate*\n"${currentHotTake.statement}"\n\n📊 *Live Room Tally:*\n• Agree (${agreeVoters ? agreeVoters : 'None'})\n• Disagree (${disagreeVoters ? disagreeVoters : 'None'})\n• Hot Take (${hotTakeVoters ? hotTakeVoters : 'None'})\n\nCome and defend your vote in Room: ${activeRoomId}!`);
        }} 
        type="button"
        style={{ width: "100%", padding: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <Share2 size={15}/> Share Tally to WhatsApp 💬
      </button>

      {isHost && (
        <button 
          className="kc-button kc-button-primary" 
          onClick={() => advanceRound(activeRoomId, user!.uid, roomData.currentQuestionIdx, HOT_TAKES.length)} 
          type="button"
          style={{ width: "100%", padding: "12px" }}
        >
          Next Take ⚡
        </button>
      )}
    </div>
  </div>
)}
               {roomData.gameMode === "hypotheticals" && (
  <div className="kc-truths-panel">
    <div className="kc-eyebrow">IF E REACH YOUR TURN</div>
    <h2 style={{ fontSize: "1.25rem", margin: "12px 0 16px", lineHeight: "1.4" }}>{currentHypothetical.scenario}</h2>
    
    {/* Input Box */}
    <div style={{ margin: "16px 0" }}>
      <textarea 
        value={hypotheticalInput} 
        onChange={(e) => setHypotheticalInput(e.target.value)} 
        placeholder="Type your honest or funny answer here..." 
        rows={3} 
        style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #e2ded4", background: "#fbfaf6", boxSizing: "border-box" }}
      />
      <button 
        className="kc-button kc-button-primary" 
        onClick={() => { submitHypothetical(activeRoomId, user!.uid, currentHypothetical.id, hypotheticalInput); notify("Answer locked in!"); }} 
        type="button" 
        style={{ marginTop: 10, width: "100%", padding: "12px" }}
      >
        Lock In Answer 🎯
      </button>
    </div>
    
    {/* Live Answers Feed */}
    <div className="kc-submissions" style={{ marginTop: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#666", letterSpacing: "0.05em", marginBottom: 12 }}>
        SUBMITTED ANSWERS ({roomPlayers.filter(p => p.hypotheticalAnswers?.[currentHypothetical.id]).length}/{roomPlayers.length})
      </div>
      
      {roomPlayers.map(p => (
        p.hypotheticalAnswers?.[currentHypothetical.id] ? (
          <div key={p.uid} style={{ background: "#fff", padding: 14, borderRadius: 12, marginBottom: 10, border: "1px solid #e2ded4" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 18 }}>{p.avatar}</span>
              <strong style={{ fontSize: 13, color: "#285541" }}>{p.name}</strong>
            </div>
            <p style={{ margin: "4px 0 10px", color: "#333", fontSize: 14, lineHeight: "1.4" }}>
              "{p.hypotheticalAnswers[currentHypothetical.id]}"
            </p>
            
            {/* Reaction Badge Taps */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["💍 Husband Material", "🔥 Odogwu Energy", "🤣 Most Hilarious"].map(badge => (
                <button
                  key={badge}
                  type="button"
                  style={{
                    fontSize: 11,
                    background: "#edf5ed",
                    border: "1px solid #cce3cd",
                    padding: "4px 10px",
                    borderRadius: 20,
                    color: "#285541",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                  onClick={() => notify(`Reacted ${badge} to ${p.name}'s answer!`)}
                >
                  {badge}
                </button>
              ))}
            </div>
          </div>
        ) : null
      ))}
    </div>

    {/* Action Bar */}
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
      <button 
        className="kc-button kc-button-outline" 
        onClick={() => {
          const answersText = roomPlayers
            .map(p => p.hypotheticalAnswers?.[currentHypothetical.id] ? `• ${p.name}: "${p.hypotheticalAnswers[currentHypothetical.id]}"` : null)
            .filter(Boolean)
            .join("\n");
          shareText(`🔥 *KINGDOM CONNECTIONS: If E Reach Your Turn*\nScenario: "${currentHypothetical.scenario}"\n\nResponses:\n${answersText}\n\nJoin the room code: ${activeRoomId}`);
        }} 
        type="button"
        style={{ width: "100%", padding: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <Share2 size={15}/> Share Results to WhatsApp Group 💬
      </button>

      {isHost && (
        <button 
          className="kc-button kc-button-primary" 
          onClick={() => advanceRound(activeRoomId, user!.uid, roomData.currentQuestionIdx, HYPOTHETICALS.length)} 
          type="button"
          style={{ width: "100%", padding: "12px" }}
        >
          Next Scenario 🚀
        </button>
      )}
    </div>
  </div>
)}


                {roomData.gameMode === "spinner" && spinnerGame && (
                  <div className="kc-wyr-panel kc-spinner-panel">
                    <div className="kc-eyebrow">KINGDOM SPINNER · ROUND {spinnerGame.round} OF {spinnerGame.totalRounds}</div>
                    <div className="kc-spinner-layout">
                      <div className="kc-spinner-main">
                       {spinnerGame.phase === "spinning" && (
  <div className="kc-spinner-card-inner kc-enter" style={{ textAlign: "center" }}>
    <h2>Spin for your category!</h2>
    <p style={{ fontSize: 13, color: "#666" }}>Tap the center wheel to spin and lock in your Bible category.</p>

    {/* CIRCULAR ANIMATED WHEEL */}
    <div className="kc-wheel-wrapper">
      <div className="kc-wheel-pointer" />
      <div className={`kc-wheel-circle ${busy ? "spinning" : ""}`}>
        <button 
          className="kc-wheel-hub" 
          onClick={handleSpin} 
          disabled={!!mySpinnerAssignment || busy}
          type="button"
        >
          {busy ? "..." : mySpinnerAssignment ? "DONE" : "SPIN"}
        </button>
      </div>
    </div>

    {mySpinnerAssignment ? (
      <div className="kc-explanation" style={{ marginTop: 16 }}>
        <Check size={16}/>
        <div>
          <strong>Category Locked!</strong>
          <p>You got: <b>{mySpinnerAssignment.category}</b></p>
        </div>
      </div>
    ) : null}

    {isHost && (
      <button 
        type="button" 
        className="kc-button kc-button-primary" 
        onClick={handleBeginAnswers} 
        disabled={Object.keys(spinnerGame.assignments).length !== roomPlayers.length} 
        style={{ marginTop: 20, width: "100%", padding: "12px" }}
      >
        <Play size={16} fill="currentColor"/> Start Timer for All Players
      </button>
    )}

    <div className="kc-vote-count" style={{ marginTop: 12 }}>
      Players ready: {Object.keys(spinnerGame.assignments).length} / {roomPlayers.length}
    </div>
  </div>
)}

                        {spinnerGame.phase === "answering" && (
                          <div className="kc-spinner-card-inner kc-enter">
                            <div className="kc-spinner-timer-row">
                              <span className="kc-live-pill"><i/> LIVE QUESTION</span>
                              <div className="kc-score-box"><span><small>TIME</small><b>{spinnerSecondsLeft}s</b></span></div>
                            </div>
                            {spinnerQuestion ? (
                              <>
                                <div className="kc-question-meta"><span>{spinnerQuestion.category}</span><span>+10 PTS</span></div>
                                <h2>{spinnerQuestion.question}</h2>
                                <div className="kc-answer-grid">
                                  {spinnerQuestion.options.map((option, index) => {
                                    const myAnswer = user ? spinnerGame.answers[user.uid] : undefined;
                                    return (
                                      <button 
  key={index} 
  disabled={!!myAnswer} // Lock button only after THEY answer (removed the rigid timer lock)
  className={`kc-answer ${myAnswer?.selectedIndex === index ? "selected" : ""}`} 
  onClick={() => handleSpinnerAnswer(index)} 
  type="button"
>
  <span className="kc-answer-letter">{String.fromCharCode(65 + index)}</span>
  <span>{option}</span>
</button>
                                    );
                                  })}
                                </div>
                              </>
                            ) : <p>Loading question...</p>}
                            {isHost && <button className="kc-button kc-button-outline" onClick={handleShowSpinnerResults} type="button" style={{ marginTop: 16 }}>Show results</button>}
                          </div>
                        )}

                        {spinnerGame.phase === "results" && (
                          <div className="kc-spinner-card-inner kc-enter">
                            <h2>Round {spinnerGame.round} Results</h2>
                            {spinnerQuestion && <div className="kc-explanation"><Check size={16}/><div><strong>Correct Answer:</strong><p>{spinnerQuestion.options[spinnerQuestion.correctIndex]}</p><p>{spinnerQuestion.explanation}</p></div></div>}
                            {isHost && <button className="kc-button kc-button-primary" onClick={handleAdvanceSpinner} type="button" style={{ marginTop: 16 }}>{spinnerGame.round >= spinnerGame.totalRounds ? "Finish match" : "Next round"}</button>}
                          </div>
                        )}
                      </div>

                      <aside className="kc-spinner-leaderboard">
                        <div className="kc-eyebrow">STANDINGS</div>
                        <div className="kc-leaderboard-list">
                          {spinnerLeaderboard.map((p, idx) => (
                            <div className="kc-player-chip kc-leaderboard-chip" key={p.uid}>
                              <span className="kc-rank-num">#{idx + 1}</span>
                              <span>{p.avatar}</span>
                              <b>{p.name}</b>
                              <span style={{ marginLeft: "auto", fontWeight: 700 }}>{spinnerGame.scores[p.uid] ?? 0}</span>
                            </div>
                          ))}
                        </div>
                      </aside>
                    </div>
                  </div>
                )}

                <div className="kc-floating-emoji-container">
                  {["🔥", "👏", "😂", "👑", "😱"].map((emoji) => (
                    <button key={emoji} className="kc-emoji-btn" onClick={() => sendEmoji(emoji)} type="button">{emoji}</button>
                  ))}
                </div>
                {flyingEmojis.map((item) => (
                  <span key={item.id} className="kc-flying-emoji">{item.emoji}</span>
                ))}

                <div style={{ marginTop: 24 }}>
                  <button className="kc-back-link" onClick={() => { setActiveRoomId(null); setRoomData(null); setView("home"); }} type="button">← Leave room</button>
                </div>
              </div>
            )}
          </section>
        )}

        {view === "leaderboard" && (
          <section className="kc-game-panel kc-enter">
            <div className="kc-page-top"><button className="kc-back-link" onClick={() => setView("home")} type="button">← Back to home</button><span className="kc-pill"><Medal size={14}/> LEADERBOARD</span></div>
            <div className="kc-question-card" style={{ textAlign: "center", padding: 40 }}>
              <h2>Leaderboard</h2>
              <p style={{ color: "var(--kc-muted)", margin: "12px 0 24px" }}>Play Bible Challenges to build up your points.</p>
              <button className="kc-button kc-button-primary" onClick={() => { resetSolo(); setView("solo"); }} type="button">Start Bible Challenge</button>
            </div>
          </section>
        )}

        {view === "profile" && (
          <section className="kc-game-panel kc-enter">
            <div className="kc-page-top"><button className="kc-back-link" onClick={() => setView("home")} type="button">← Back to home</button><span className="kc-pill"><ShieldCheck size={14}/> PROFILE</span></div>
            <div className="kc-question-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{avatar}</div>
              <h2>{name || user?.displayName || "Kingdom Player"}</h2>
              <p style={{ color: "var(--kc-muted)", fontSize: 12, margin: "6px 0 20px" }}>{user?.isAnonymous ? "Guest account" : user?.email}</p>
              <button className="kc-button kc-button-ghost" onClick={signOutUser} type="button">Sign out</button>
            </div>
          </section>
        )}
      </main>

      <footer className="kc-footer"><div className="kc-footer-brand"><Crown size={15}/> KINGDOM CONNECTIONS</div><span>Faith · Friendship · Fellowship</span><span>Play with purpose.</span></footer>
    </div>
  );
}