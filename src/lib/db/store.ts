import fs from "fs/promises";
import path from "path";
import { Language, VocabularyItem, VocabularyExample, VocabularyReview, Tag } from "@/types";
import { SUPPORTED_LANGUAGES } from "./languages";

interface StoredUserLanguage {
  id: number;
  userId: string;
  languageId: number;
  translationLanguageId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredVocabularyTag {
  vocabularyId: number;
  tagId: number;
}

export interface DatabaseState {
  languages: Language[];
  userLanguages: StoredUserLanguage[];
  vocabulary: VocabularyItem[];
  vocabularyExamples: VocabularyExample[];
  vocabularyReviews: VocabularyReview[];
  tags: Tag[];
  vocabularyTags: StoredVocabularyTag[];
  save: () => Promise<void>;
}

let cachedStore: DatabaseState | null = null;
const isTestEnv = process.env.NODE_ENV === "test" || Boolean(process.env.NODE_TEST_CONTEXT);
const DATA_FILE = isTestEnv
  ? path.join(process.cwd(), ".lingo-fox-test-data.json")
  : path.join(process.cwd(), ".lingo-fox-data.json");
const LEGACY_DATA_FILE = path.join(process.cwd(), ".grwly-data.json");

function createInitialState(): Omit<DatabaseState, "save"> {
  const initialLanguages: Language[] = SUPPORTED_LANGUAGES.map((l, index) => ({
    id: index + 1,
    code: l.code,
    name: l.name,
    nativeName: l.nativeName,
    flag: l.flag,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }));

  const germanId = initialLanguages.find((l) => l.code === "de")!.id;
  const indonesianId = initialLanguages.find((l) => l.code === "id")!.id;
  const englishId = initialLanguages.find((l) => l.code === "en")!.id;

  const demoUserId = "user_lingo_fox_demo";

  const initialUserLanguages: StoredUserLanguage[] = [
    {
      id: 1,
      userId: demoUserId,
      languageId: germanId,
      translationLanguageId: indonesianId,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: 2,
      userId: demoUserId,
      languageId: englishId,
      translationLanguageId: indonesianId,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
  ];

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const initialVocabulary: VocabularyItem[] = [
    {
      id: 1,
      userId: demoUserId,
      languageId: germanId,
      word: "gemütlich",
      meaning: "nyaman, hangat & menyenangkan (cozy / comfortable)",
      pronunciation: "ɡəˈmyːtlɪç",
      partOfSpeech: "adjective",
      status: "learning",
      recognitionScore: 80,
      recallScore: 60,
      reviewCount: 3,
      correctCount: 2,
      wrongCount: 1,
      lastReviewedAt: yesterday,
      nextReviewAt: now,
      intervalDays: 1,
      easeFactor: 2.5,
      orderIndex: 0,
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    },
    {
      id: 2,
      userId: demoUserId,
      languageId: germanId,
      word: "schwierig",
      meaning: "sulit / susah (difficult)",
      pronunciation: "ˈʃviːʁɪç",
      partOfSpeech: "adjective",
      status: "new",
      recognitionScore: 0,
      recallScore: 0,
      reviewCount: 0,
      correctCount: 0,
      wrongCount: 0,
      lastReviewedAt: null,
      nextReviewAt: now,
      intervalDays: 0,
      easeFactor: 2.5,
      orderIndex: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 3,
      userId: demoUserId,
      languageId: germanId,
      word: "ausgezeichnet",
      meaning: "luar biasa, istimewa (excellent)",
      pronunciation: "ˈaʊ̯sɡəˌtsaɪ̯çnət",
      partOfSpeech: "adjective",
      status: "familiar",
      recognitionScore: 75,
      recallScore: 70,
      reviewCount: 4,
      correctCount: 3,
      wrongCount: 1,
      lastReviewedAt: yesterday,
      nextReviewAt: now,
      intervalDays: 3,
      easeFactor: 2.5,
      orderIndex: 0,
      createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    },
    {
      id: 4,
      userId: demoUserId,
      languageId: germanId,
      word: "verstehen",
      meaning: "mengerti / memahami (to understand)",
      pronunciation: "fɛɐ̯ˈʃteːən",
      partOfSpeech: "verb",
      status: "strong",
      recognitionScore: 90,
      recallScore: 85,
      reviewCount: 6,
      correctCount: 6,
      wrongCount: 0,
      lastReviewedAt: yesterday,
      nextReviewAt: tomorrow,
      intervalDays: 7,
      easeFactor: 2.6,
      orderIndex: 0,
      createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    },
    {
      id: 5,
      userId: demoUserId,
      languageId: germanId,
      word: "danke",
      meaning: "terima kasih (thank you)",
      pronunciation: "ˈdaŋkə",
      partOfSpeech: "interjection",
      status: "mastered",
      recognitionScore: 100,
      recallScore: 100,
      reviewCount: 10,
      correctCount: 10,
      wrongCount: 0,
      lastReviewedAt: yesterday,
      nextReviewAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
      intervalDays: 30,
      easeFactor: 2.8,
      orderIndex: 0,
      createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    },
    {
      id: 6,
      userId: demoUserId,
      languageId: germanId,
      word: "vorsichtig",
      meaning: "hati-hati, waspada (careful / cautious)",
      pronunciation: "ˈfoːɐ̯ˌzɪçtɪç",
      partOfSpeech: "adjective",
      status: "learning",
      recognitionScore: 40,
      recallScore: 30,
      reviewCount: 5,
      correctCount: 2,
      wrongCount: 3,
      lastReviewedAt: yesterday,
      nextReviewAt: now,
      intervalDays: 1,
      easeFactor: 2.1,
      orderIndex: 1,
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    },
  ];

  const initialExamples: VocabularyExample[] = [
    {
      id: 1,
      vocabularyId: 1,
      sentence: "Das Zimmer ist sehr gemütlich.",
      translation: "Kamarnya sangat nyaman dan hangat.",
      source: "Manual",
      createdAt: now,
    },
    {
      id: 2,
      vocabularyId: 3,
      sentence: "Das Essen schmeckt ausgezeichnet!",
      translation: "Makanannya terasa luar biasa enak!",
      source: "Manual",
      createdAt: now,
    },
  ];

  const initialReviews: VocabularyReview[] = [
    {
      id: 1,
      vocabularyId: 1,
      userId: demoUserId,
      reviewType: "recognition",
      isCorrect: true,
      difficulty: "good",
      reviewedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    },
    {
      id: 2,
      vocabularyId: 1,
      userId: demoUserId,
      reviewType: "recall",
      isCorrect: false,
      difficulty: "forgot",
      reviewedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    },
    {
      id: 3,
      vocabularyId: 1,
      userId: demoUserId,
      reviewType: "recognition",
      isCorrect: true,
      difficulty: "good",
      reviewedAt: yesterday,
    },
  ];

  const initialTags: Tag[] = [
    { id: 1, userId: demoUserId, name: "Daily Life", createdAt: now },
    { id: 2, userId: demoUserId, name: "Travel", createdAt: now },
    { id: 3, userId: demoUserId, name: "Work", createdAt: now },
  ];

  const initialVocabularyTags: StoredVocabularyTag[] = [
    { vocabularyId: 1, tagId: 1 },
    { vocabularyId: 3, tagId: 2 },
  ];

  return {
    languages: initialLanguages,
    userLanguages: initialUserLanguages,
    vocabulary: initialVocabulary,
    vocabularyExamples: initialExamples,
    vocabularyReviews: initialReviews,
    tags: initialTags,
    vocabularyTags: initialVocabularyTags,
  };
}

/**
 * Local JSON store used for unit tests (NODE_ENV=test) and offline preview
 * when Supabase credentials are not configured.
 */
export async function getLocalStore(): Promise<DatabaseState> {
  if (isTestEnv && cachedStore) {
    return cachedStore;
  }

  let stateData: Omit<DatabaseState, "save">;

  try {
    let raw: string;
    try {
      raw = await fs.readFile(DATA_FILE, "utf-8");
    } catch {
      raw = await fs.readFile(LEGACY_DATA_FILE, "utf-8");
    }
    const parsed = JSON.parse(raw);

    stateData = {
      languages: parsed.languages.map((l: Language) => ({
        ...l,
        createdAt: new Date(l.createdAt),
      })),
      userLanguages: parsed.userLanguages.map((ul: StoredUserLanguage) => ({
        ...ul,
        createdAt: new Date(ul.createdAt),
        updatedAt: new Date(ul.updatedAt),
      })),
      vocabulary: parsed.vocabulary.map((v: VocabularyItem) => ({
        ...v,
        orderIndex: v.orderIndex ?? 0,
        createdAt: new Date(v.createdAt),
        updatedAt: new Date(v.updatedAt),
        nextReviewAt: new Date(v.nextReviewAt),
        lastReviewedAt: v.lastReviewedAt ? new Date(v.lastReviewedAt) : null,
      })),
      vocabularyExamples: parsed.vocabularyExamples.map((e: VocabularyExample) => ({
        ...e,
        createdAt: new Date(e.createdAt),
      })),
      vocabularyReviews: parsed.vocabularyReviews.map((r: VocabularyReview) => ({
        ...r,
        reviewedAt: new Date(r.reviewedAt),
      })),
      tags: parsed.tags.map((t: Tag) => ({
        ...t,
        createdAt: new Date(t.createdAt),
      })),
      vocabularyTags: parsed.vocabularyTags,
    };
  } catch {
    stateData = createInitialState();
  }

  let currentInstance: DatabaseState;
  const save = async () => {
    try {
      const serialized = JSON.stringify(
        {
          languages: currentInstance.languages,
          userLanguages: currentInstance.userLanguages,
          vocabulary: currentInstance.vocabulary,
          vocabularyExamples: currentInstance.vocabularyExamples,
          vocabularyReviews: currentInstance.vocabularyReviews,
          tags: currentInstance.tags,
          vocabularyTags: currentInstance.vocabularyTags,
        },
        null,
        2
      );
      await fs.writeFile(DATA_FILE, serialized, "utf-8");
    } catch {
      // Ignore write errors in read-only serverless environments
    }
  };

  currentInstance = {
    ...stateData,
    save,
  };

  if (isTestEnv) {
    cachedStore = currentInstance;
  }

  return currentInstance;
}
