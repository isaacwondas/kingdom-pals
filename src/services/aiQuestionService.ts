
import type { QuizQuestion } from "../data/questions";

type GenerateBibleQuestionsResponse = {
  success: boolean;
  gameType: string;
  questions: QuizQuestion[];
};

export async function generateBibleQuestions(
  count = 10,
  avoidQuestions: string[] = []
): Promise<QuizQuestion[]> {
  const response = await fetch("/api/generate-questions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      gameType: "bible",
      category: "Bible Knowledge",
      count,
      avoidQuestions,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(
      data.error || "Unable to generate Bible questions."
    );
  }

  const result = data as GenerateBibleQuestionsResponse;

  if (!Array.isArray(result.questions) || result.questions.length === 0) {
    throw new Error("Gemini returned no Bible questions.");
  }

  return result.questions;
}

export type SpinnerCategory =
  | "Bible Knowledge"
  | "Love Languages"
  | "Christian Hymns";

export type SpinnerQuestion = {
  id: string;
  category: SpinnerCategory;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  reference: string;
};

type GenerateSpinnerQuestionsResponse = {
  success: boolean;
  gameType: string;
  questions: SpinnerQuestion[];
};

export async function generateSpinnerQuestions(
  count = 15,
  avoidQuestions: string[] = []
): Promise<SpinnerQuestion[]> {
  const response = await fetch("/api/generate-questions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      gameType: "spinner",
      category: "Bible Knowledge, Love Languages, Christian Hymns",
      count,
      avoidQuestions,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(
      data.error || "Unable to generate Spinner questions."
    );
  }

  const result = data as GenerateSpinnerQuestionsResponse;

  if (
    !Array.isArray(result.questions) ||
    result.questions.length === 0
  ) {
    throw new Error("Gemini returned no Spinner questions.");
  }

  return result.questions;
}
