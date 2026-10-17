import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../lib/firebase";

export type Player = {
  uid: string;
  name: string;
  avatar: string;
  isHost: boolean;
  joinedAt?: unknown;
  hotTakeVotes?: Record<string, "Agree" | "Disagree" | "Hot Take">;
  hypotheticalAnswers?: Record<string, string>;
  streak?: number;
};

export type SpinnerCategory =
  | "Bible Knowledge"
  | "Love Languages"
  | "Christian Hymns";

export type SpinnerPhase =
  | "lobby"
  | "spinning"
  | "answering"
  | "results"
  | "finished";

export type SpinnerAnswer = {
  selectedIndex: number | null;
  submittedAt: number | null;
  points: number;
};

export type SpinnerGameState = {
  phase: SpinnerPhase;
  round: number;
  totalRounds: number;
  deadline: number | null;
  assignments: Record<
    string,
    { category: SpinnerCategory; questionId: string }
  >;
  answers: Record<string, SpinnerAnswer>;
  usedQuestionIds: string[];
  scores: Record<string, number>;
  startedAt?: number;
};

export type SpinnerQuestionOption = {
  id: string;
  category: SpinnerCategory;
};

export type RoomData = {
  roomId: string;
  hostId: string;
  gameMode: "lobby" | "hottakes" | "hypotheticals" | "spinner";
  currentQuestionIdx: number;
  status: "waiting" | "playing" | "finished";
  createdAt?: unknown;
  players: Record<string, Player>;
  spinnerGame?: SpinnerGameState;
};

// --- Firebase Reference Helpers ---
const roomRef = (roomId: string) => doc(db, "rooms", roomId);
const playersRef = (roomId: string) => collection(db, "rooms", roomId, "players");
const playerRef = (roomId: string, uid: string) => doc(db, "rooms", roomId, "players", uid);

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

function makePlayer(uid: string, name: string, avatar: string, isHost: boolean): Player {
  return {
    uid,
    name: name.trim().slice(0, 32),
    avatar,
    isHost,
    joinedAt: serverTimestamp(),
    hotTakeVotes: {},
    hypotheticalAnswers: {},
  };
}

// --- Room Core Actions ---

export async function createRoom(uid: string, name: string, avatar: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const roomId = makeRoomCode();
    const ref = roomRef(roomId);
    const hostRef = playerRef(roomId, uid);

    try {
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists()) {
          throw new Error("ROOM_CODE_COLLISION");
        }

        tx.set(ref, {
          roomId,
          hostId: uid,
          gameMode: "lobby",
          currentQuestionIdx: 0,
          status: "waiting",
          createdAt: serverTimestamp(),
        });

        tx.set(hostRef, makePlayer(uid, name, avatar, true));
      });

      return roomId;
    } catch (error) {
      if (attempt === 3 || (error as Error).message !== "ROOM_CODE_COLLISION") {
        throw error;
      }
    }
  }
  throw new Error("Could not create a room. Please try again.");
}

export async function joinRoom(roomId: string, uid: string, name: string, avatar: string) {
  const normalizedId = roomId.toUpperCase().trim();
  const ref = roomRef(normalizedId);
  const memberRef = playerRef(normalizedId, uid);

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(ref);
    const memberSnap = await tx.get(memberRef);

    if (!roomSnap.exists()) {
      throw new Error("Room not found.");
    }

    const room = roomSnap.data() as Omit<RoomData, "players">;

    if (room.status !== "waiting") {
      throw new Error("This session has already started. Please wait for the next session.");
    }

    if (!memberSnap.exists()) {
      tx.set(memberRef, makePlayer(uid, name, avatar, room.hostId === uid));
    }
  });
}

export function subscribeRoom(
  roomId: string,
  callback: (data: RoomData | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  let room: Omit<RoomData, "players"> | null | undefined;
  let players: Record<string, Player> = {};
  let playersReady = false;

  const emit = () => {
    if (room === null) {
      callback(null);
      return;
    }
    if (room === undefined || !playersReady) return;
    callback({ ...room, players });
  };

  const unsubscribeRoom = onSnapshot(
    roomRef(roomId),
    (snapshot) => {
      room = snapshot.exists() ? (snapshot.data() as Omit<RoomData, "players">) : null;
      emit();
    },
    (error) => onError?.(error),
  );

  const unsubscribePlayers = onSnapshot(
    playersRef(roomId),
    (snapshot) => {
      players = {};
      snapshot.forEach((item) => {
        players[item.id] = item.data() as Player;
      });
      playersReady = true;
      emit();
    },
    (error) => onError?.(error),
  );

  return () => {
    unsubscribeRoom();
    unsubscribePlayers();
  };
}

export async function setRoomMode(roomId: string, uid: string, gameMode: RoomData["gameMode"]) {
  const ref = roomRef(roomId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error("Room no longer exists.");
    }

    const data = snap.data() as RoomData;
    if (data.hostId !== uid) {
      throw new Error("Only the host can change game mode.");
    }

    tx.update(ref, {
      gameMode,
      currentQuestionIdx: 0,
      status: gameMode === "lobby" ? "waiting" : "playing",
    });
  });
}

export async function advanceRound(roomId: string, uid: string, nextIndex: number, total: number) {
  if (!Number.isInteger(total) || total <= 0) {
    throw new Error("Invalid question count.");
  }

  const ref = roomRef(roomId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error("Room no longer exists.");
    }

    const data = snap.data() as RoomData;
    if (data.hostId !== uid) {
      throw new Error("Only the host can advance the round.");
    }

    tx.update(ref, {
      currentQuestionIdx: (nextIndex + 1) % total,
    });
  });
}

export async function voteHotTake(roomId: string, uid: string, questionId: string, choice: "Agree" | "Disagree" | "Hot Take") {
  await updateDoc(playerRef(roomId, uid), {
    [`hotTakeVotes.${questionId}`]: choice,
  });
}

export async function submitHypothetical(roomId: string, uid: string, questionId: string, answer: string) {
  if (!answer.trim()) throw new Error("Please enter an answer.");
  await updateDoc(playerRef(roomId, uid), {
    [`hypotheticalAnswers.${questionId}`]: answer.trim().slice(0, 200),
  });
}

// --- Kingdom Spinner Actions ---

const SPINNER_CATEGORIES: SpinnerCategory[] = [
  "Bible Knowledge",
  "Love Languages",
  "Christian Hymns",
];

export async function startSpinnerMatch(roomId: string, uid: string) {
  const ref = roomRef(roomId);
  const playersSnap = await getDocs(playersRef(roomId));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Room no longer exists.");
    const room = snap.data() as RoomData;

    if (room.hostId !== uid) {
      throw new Error("Only the host can start the spinner game.");
    }

    const scores: Record<string, number> = {};
    playersSnap.forEach((playerDoc) => {
      scores[playerDoc.id] = 0;
    });

    tx.update(ref, {
      gameMode: "spinner",
      status: "playing",
      currentQuestionIdx: 0,
      spinnerGame: {
        phase: "spinning",
        round: 1,
        totalRounds: 10,
        deadline: null,
        assignments: {},
        answers: {},
        usedQuestionIds: [],
        scores,
      } satisfies SpinnerGameState,
    });
  });
}

export async function spinForCategory(
  roomId: string,
  uid: string,
  questions: SpinnerQuestionOption[],
) {
  const ref = roomRef(roomId);
  const memberRef = playerRef(roomId, uid);

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(ref);
    const memberSnap = await tx.get(memberRef);

    if (!roomSnap.exists()) throw new Error("Room no longer exists.");
    if (!memberSnap.exists()) throw new Error("You are not a player in this room.");

    const room = roomSnap.data() as RoomData;
    const game = room.spinnerGame;

    if (!game || game.phase !== "spinning") {
      throw new Error("The spinner is not accepting spins right now.");
    }

    if (game.assignments[uid]) {
      throw new Error("You have already spun this round.");
    }

    let unusedQuestions = questions.filter(
      (question) => !game.usedQuestionIds.includes(question.id),
    );

    if (unusedQuestions.length === 0) {
      unusedQuestions = questions;
    }

    const availableCategories = SPINNER_CATEGORIES.filter((category) =>
      unusedQuestions.some((question) => question.category === category),
    );

    const category =
      availableCategories[
        Math.floor(Math.random() * availableCategories.length)
      ];

    const categoryQuestions = unusedQuestions.filter(
      (question) => question.category === category,
    );

    const selectedQuestion =
      categoryQuestions[
        Math.floor(Math.random() * categoryQuestions.length)
      ];

    tx.update(ref, {
      [`spinnerGame.assignments.${uid}`]: {
        category,
        questionId: selectedQuestion.id,
      },
      "spinnerGame.usedQuestionIds": [
        ...game.usedQuestionIds,
        selectedQuestion.id,
      ],
    });
  });
}

export async function beginSpinnerAnswers(
  roomId: string,
  uid: string,
  durationMs = 20000,
) {
  if (!Number.isFinite(durationMs) || durationMs < 1000) {
    throw new Error("The answer timer must be at least one second.");
  }

  const ref = roomRef(roomId);
  const playersSnapshot = await getDocs(playersRef(roomId));
  const playerIds = playersSnapshot.docs.map((player) => player.id);

  if (playerIds.length === 0) {
    throw new Error("There are no players in this room.");
  }

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Room no longer exists.");

    const room = snap.data() as Omit<RoomData, "players">;
    const game = room.spinnerGame;

    if (room.hostId !== uid) {
      throw new Error("Only the host can start the answer timer.");
    }

    if (!game || game.phase !== "spinning") {
      throw new Error("The game is not in the spinning phase.");
    }

    const assignments = game.assignments ?? {};
    const missingPlayers = playerIds.filter(
      (playerId) => !assignments[playerId],
    );

    if (missingPlayers.length > 0) {
      throw new Error(
        `Still waiting for ${missingPlayers.length} player(s) to spin.`,
      );
    }

    tx.update(ref, {
      "spinnerGame.phase": "answering",
      "spinnerGame.deadline": Date.now() + durationMs,
    });
  });
}

export async function submitSpinnerAnswer(
  roomId: string,
  uid: string,
  selectedIndex: number,
  correctIndex: number,
) {
  const ref = roomRef(roomId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Room no longer exists.");

    const room = snap.data() as RoomData;
    const game = room.spinnerGame;

    if (!game || game.phase !== "answering") {
      throw new Error("The answer round is closed.");
    }

    if (!game.assignments[uid]) {
      throw new Error("Spin before answering.");
    }

    if (Date.now() > (game.deadline ?? 0)) {
      throw new Error("Time is up. Your answer was not recorded.");
    }

    if (game.answers[uid]) {
      throw new Error("You have already submitted an answer.");
    }

    const points = selectedIndex === correctIndex ? 10 : 0;

    tx.update(ref, {
      [`spinnerGame.answers.${uid}`]: {
        selectedIndex,
        submittedAt: Date.now(),
        points,
      },
      [`spinnerGame.scores.${uid}`]:
        (game.scores[uid] ?? 0) + points,
    });
  });
}

export async function showSpinnerResults(roomId: string, uid: string) {
  const ref = roomRef(roomId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Room no longer exists.");

    const room = snap.data() as RoomData;
    if (room.hostId !== uid) {
      throw new Error("Only the host can reveal the results.");
    }

    if (!room.spinnerGame || room.spinnerGame.phase !== "answering") {
      throw new Error("The answer round is not active.");
    }

    tx.update(ref, {
      "spinnerGame.phase": "results",
      "spinnerGame.deadline": null,
    });
  });
}

export async function advanceSpinnerRound(roomId: string, uid: string) {
  const ref = roomRef(roomId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Room no longer exists.");

    const room = snap.data() as RoomData;
    const game = room.spinnerGame;

    if (room.hostId !== uid) {
      throw new Error("Only the host can advance the round.");
    }

    if (!game || game.phase !== "results") {
      throw new Error("Reveal the results before continuing.");
    }

    if (game.round >= game.totalRounds) {
      tx.update(ref, {
        status: "finished",
        "spinnerGame.phase": "finished",
        "spinnerGame.deadline": null,
      });
      return;
    }

    tx.update(ref, {
      currentQuestionIdx: game.round,
      "spinnerGame.phase": "spinning",
      "spinnerGame.round": game.round + 1,
      "spinnerGame.deadline": null,
      "spinnerGame.assignments": {},
      "spinnerGame.answers": {},
    });
  });
}