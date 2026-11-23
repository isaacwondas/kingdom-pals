
import { GoogleGenAI } from "@google/genai";

type GameType =
  | "bible"
  | "spinner"
  | "wyr"
  | "hotTakes"
  | "hypotheticals"
  | "icebreakers";

const GAME_TYPES: GameType[] = [
  "bible",
  "spinner",
  "wyr",
  "hotTakes",
  "hypotheticals",
  "icebreakers",
];

const SPINNER_CATEGORIES = [
  "Bible Knowledge",
  "Love Languages",
  "Christian Hymns",
];

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

function getQuestionSchema(gameType: GameType) {
  const stringField = { type: "STRING" };

  const schemas: Record<GameType, any> = {
    bible: {
      type: "OBJECT",
      properties: {
        id: stringField,
        category: stringField,
        question: stringField,
        options: {
          type: "ARRAY",
          items: stringField,
        },
        correctIndex: { type: "INTEGER" },
        explanation: stringField,
        reference: stringField,
      },
      required: [
        "id", "category", "question", "options",
        "correctIndex", "explanation", "reference",
      ],
    },

    spinner: {
      type: "OBJECT",
      properties: {
        id: stringField,
        category: {
          type: "STRING",
          enum: SPINNER_CATEGORIES,
        },
        question: stringField,
        options: {
          type: "ARRAY",
          items: stringField,
        },
        correctIndex: { type: "INTEGER" },
        explanation: stringField,
        reference: stringField,
      },
      required: [
        "id", "category", "question", "options",
        "correctIndex", "explanation", "reference",
      ],
    },

    wyr: {
      type: "OBJECT",
      properties: {
        id: stringField,
        title: stringField,
        optionA: stringField,
        optionB: stringField,
      },
      required: ["id", "title", "optionA", "optionB"],
    },

    hotTakes: {
      type: "OBJECT",
      properties: {
        id: stringField,
        statement: stringField,
        category: {
          type: "STRING",
          enum: ["Lifestyle", "Relationships", "Faith"],
        },
      },
      required: ["id", "statement", "category"],
    },

    hypotheticals: {
      type: "OBJECT",
      properties: {
        id: stringField,
        scenario: stringField,
        category: {
          type: "STRING",
          enum: ["Money", "Japa & Romance", "Vibes & Dating"],
        },
      },
      required: ["id", "scenario", "category"],
    },

    icebreakers: {
      type: "OBJECT",
      properties: {
        id: stringField,
        prompt: stringField,
      },
      required: ["id", "prompt"],
    },
  };

  return {
    type: "OBJECT",
    properties: {
      questions: {
        type: "ARRAY",
        items: schemas[gameType],
      },
    },
    required: ["questions"],
  };
}

function validateQuestions(gameType: GameType, questions: any[]) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("Gemini returned no questions.");
  }

  const ids = new Set<string>();
  const seen = new Set<string>();

  for (const question of questions) {
    if (!question.id || !question.id.trim()) {
      throw new Error("A question is missing its ID.");
    }

    const text =
      question.question ??
      question.title ??
      question.statement ??
      question.scenario ??
      question.prompt;

    if (!text || typeof text !== "string") {
      throw new Error("A question has invalid text.");
    }

    const normalized = text.toLowerCase().trim();

    if (ids.has(question.id) || seen.has(normalized)) {
      throw new Error("Duplicate questions were generated.");
    }

    ids.add(question.id);
    seen.add(normalized);

    if (gameType === "bible" || gameType === "spinner") {
      if (
        !Array.isArray(question.options) ||
        question.options.length !== 4 ||
        !Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 ||
        question.correctIndex > 3
      ) {
        throw new Error("Invalid multiple-choice question.");
      }

      // Shuffle the options and keep the correct answer aligned.
      const correctAnswer = question.options[question.correctIndex];

      const shuffled = [...question.options].sort(
        () => Math.random() - 0.5
      );

      question.options = shuffled;
      question.correctIndex = shuffled.indexOf(correctAnswer);
    }
  }

  return questions;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Only POST requests are allowed.",
    });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Gemini API key is not configured.",
    });
  }

  try {
    const { gameType, category, count, avoidQuestions } = req.body ?? {};

    if (!GAME_TYPES.includes(gameType)) {
      return res.status(400).json({
        error: "Invalid game type.",
      });
    }

    const questionCount = Number(count ?? 10);

    if (
      !Number.isInteger(questionCount) ||
      questionCount < 1 ||
      questionCount > 25
    ) {
      return res.status(400).json({
        error: "Question count must be between 1 and 25.",
      });
    }

    const avoid = Array.isArray(avoidQuestions)
      ? avoidQuestions
          .filter((item: unknown) => typeof item === "string")
          .slice(0, 50)
          .map((item: string) => item.slice(0, 300))
      : [];

    const prompt = `
You are the question generator for Kingdom Connections,
a Christian social and multiplayer game.

Generate exactly ${questionCount} original items.

Game type: ${gameType}
Requested category: ${category || "Use suitable categories"}

Rules:
- Make every item clear, engaging and suitable for young adults.
- Do not repeat questions or statements.
- Do not invent Bible references.
- Bible questions must be factually accurate and based on Scripture.
- Multiple-choice questions must have exactly four distinct options.
- The correctIndex must identify the correct option, starting from zero.
- Keep the content appropriate for a Christian audience.
- Return only the requested JSON structure.

Do not generate content similar to these previous items:
${JSON.stringify(avoid)}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: getQuestionSchema(gameType),
        temperature: 0.9,
      },
    });

    if (!response.text) {
      throw new Error("Gemini returned an empty response.");
    }

    const parsed = JSON.parse(response.text);
    const questions = validateQuestions(
      gameType,
      parsed.questions
    );

    if (questions.length !== questionCount) {
      throw new Error("Gemini returned an unexpected number of questions.");
    }

    return res.status(200).json({
      success: true,
      gameType,
      questions,
    });
  } catch (error) {
    console.error("Gemini question generation error:", error);

    return res.status(500).json({
      error: "Unable to generate questions right now. Please try again.",
    });
  }
}
