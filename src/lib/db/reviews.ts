import {
  ReviewDifficulty,
  ReviewQueueItem,
  ReviewType,
  VocabularyItem,
  VocabularyReview,
  VocabularyStatus,
} from "@/types";
import { getLocalStore } from "./store";
import { calculateNextReview } from "../spaced-repetition/algorithm";
import { getVocabularyByIdForUser, mapVocabularyRow, VocabularyRow } from "./vocabulary";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const isTestEnv = process.env.NODE_ENV === "test" || Boolean(process.env.NODE_TEST_CONTEXT);

interface VocabularyReviewRow {
  id: number;
  vocabulary_id: number;
  user_id: string;
  review_type: string;
  is_correct: boolean;
  difficulty: string;
  reviewed_at: string;
}

function mapReviewRow(row: VocabularyReviewRow): VocabularyReview {
  return {
    id: row.id,
    vocabularyId: row.vocabulary_id,
    userId: row.user_id,
    reviewType: row.review_type as ReviewType,
    isCorrect: row.is_correct,
    difficulty: row.difficulty as ReviewDifficulty,
    reviewedAt: new Date(row.reviewed_at),
  };
}

function calculatePriority(item: VocabularyItem, now: Date): number {
  let score = 0;
  const diffMs = now.getTime() - item.nextReviewAt.getTime();
  const overdueDays = diffMs / (1000 * 60 * 60 * 24);

  if (overdueDays > 0) {
    score += Math.min(50, overdueDays * 10);
  }

  if (item.status === "learning") score += 30;
  else if (item.status === "new") score += 25;
  else if (item.status === "familiar") score += 15;
  else if (item.status === "strong") score += 10;
  else if (item.status === "mastered") score += 5;

  if (item.wrongCount > 0) {
    score += Math.min(30, item.wrongCount * 8);
  }

  return score;
}

function buildReviewQueueWithOptions(
  queue: VocabularyItem[],
  wordPool: { id: number; meaning: string }[]
): ReviewQueueItem[] {
  const fallbackDistractors = [
    "cepat dan mudah (fast and simple)",
    "kurang menyenangkan (unpleasant)",
    "sangat mahal (expensive)",
    "mudah pecah (fragile)",
  ];

  return queue.map((item) => {
    const otherWords = wordPool.filter(
      (w) => w.id !== item.id && w.meaning !== item.meaning
    );
    const shuffledOthers = [...otherWords].sort(() => 0.5 - Math.random());
    const distractors = shuffledOthers.slice(0, 3).map((w) => w.meaning);

    while (distractors.length < 3) {
      const fallback = fallbackDistractors[distractors.length];
      if (!distractors.includes(fallback) && fallback !== item.meaning) {
        distractors.push(fallback);
      } else {
        distractors.push(`arti lain #${distractors.length + 1}`);
      }
    }

    const options = [item.meaning, ...distractors].sort(() => 0.5 - Math.random());

    return {
      ...item,
      options,
    };
  });
}

/**
 * Returns the prioritized review queue for a user and learning language.
 */
export async function getReviewQueue(
  userId: string,
  languageId?: number,
  limit: number = 20
): Promise<ReviewQueueItem[]> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const now = new Date();
        const endOfToday = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          23,
          59,
          59,
          999
        );

        let queueQuery = supabase
          .from("vocabulary")
          .select("*")
          .eq("user_id", userId)
          .or(`next_review_at.lte.${endOfToday.toISOString()},status.eq.new`);

        let poolQuery = supabase
          .from("vocabulary")
          .select("id, meaning")
          .eq("user_id", userId);

        if (languageId) {
          queueQuery = queueQuery.eq("language_id", languageId);
          poolQuery = poolQuery.eq("language_id", languageId);
        }

        const [queueRes, poolRes] = await Promise.all([queueQuery, poolQuery]);

        if (queueRes.error) throw new Error(queueRes.error.message);
        if (poolRes.error) throw new Error(poolRes.error.message);

        const candidates = ((queueRes.data || []) as unknown as VocabularyRow[]).map(
          mapVocabularyRow
        );

        candidates.sort((a, b) => calculatePriority(b, now) - calculatePriority(a, now));
        const queue = candidates.slice(0, limit);
        const wordPool = (poolRes.data || []) as { id: number; meaning: string }[];

        return buildReviewQueueWithOptions(queue, wordPool);
      }
    } catch (e) {
      console.error("Supabase getReviewQueue failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const now = new Date();
  const endOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );

  const candidates = store.vocabulary.filter((v) => {
    if (v.userId !== userId) return false;
    if (languageId && v.languageId !== languageId) return false;
    return v.nextReviewAt <= endOfToday || v.status === "new";
  });

  candidates.sort((a, b) => calculatePriority(b, now) - calculatePriority(a, now));
  const queue = candidates.slice(0, limit);

  const langWords = store.vocabulary.filter(
    (v) => (languageId ? v.languageId === languageId : true) && v.userId === userId
  );

  return buildReviewQueueWithOptions(queue, langWords);
}

export interface SubmitReviewInput {
  vocabularyId: number;
  reviewType: ReviewType;
  difficulty: ReviewDifficulty;
}

export interface SubmitReviewResult {
  vocabulary: VocabularyItem;
  review: VocabularyReview;
}

/**
 * Records a review result and updates vocabulary spaced repetition state
 */
export async function submitReview(
  userId: string,
  input: SubmitReviewInput
): Promise<SubmitReviewResult | null> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const { data: wordRow, error: fetchError } = await supabase
          .from("vocabulary")
          .select("*")
          .eq("id", input.vocabularyId)
          .eq("user_id", userId)
          .maybeSingle();

        if (fetchError) throw new Error(fetchError.message);
        if (!wordRow) return null;

        const now = new Date();
        const vocabItem = mapVocabularyRow(wordRow as unknown as VocabularyRow);
        const update = calculateNextReview(
          vocabItem,
          input.difficulty,
          input.reviewType,
          now
        );

        const { error: updateError } = await supabase
          .from("vocabulary")
          .update({
            status: update.status,
            interval_days: update.intervalDays,
            ease_factor: update.easeFactor,
            next_review_at: update.nextReviewAt.toISOString(),
            review_count: update.reviewCount,
            correct_count: update.correctCount,
            wrong_count: update.wrongCount,
            recognition_score: update.recognitionScore,
            recall_score: update.recallScore,
            last_reviewed_at: update.lastReviewedAt.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", vocabItem.id)
          .eq("user_id", userId);

        if (updateError) throw new Error(updateError.message);

        const isCorrect = input.difficulty !== "forgot";
        const { data: newReview, error: reviewError } = await supabase
          .from("vocabulary_reviews")
          .insert({
            vocabulary_id: vocabItem.id,
            user_id: userId,
            review_type: input.reviewType,
            is_correct: isCorrect,
            difficulty: input.difficulty,
            reviewed_at: now.toISOString(),
          })
          .select("*")
          .single();

        if (reviewError || !newReview) {
          throw new Error(reviewError?.message || "Failed to insert review");
        }

        const updatedVocab = await getVocabularyByIdForUser(userId, vocabItem.id);

        return {
          vocabulary: updatedVocab!,
          review: mapReviewRow(newReview as VocabularyReviewRow),
        };
      }
    } catch (e) {
      console.error("Supabase submitReview failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const wordIndex = store.vocabulary.findIndex(
    (v) => v.id === input.vocabularyId && v.userId === userId
  );
  if (wordIndex === -1) return null;

  const word = store.vocabulary[wordIndex];
  const now = new Date();
  const isCorrect = input.difficulty !== "forgot";

  const update = calculateNextReview(word, input.difficulty, input.reviewType, now);

  const updatedWord: VocabularyItem = {
    ...word,
    status: update.status,
    intervalDays: update.intervalDays,
    easeFactor: update.easeFactor,
    nextReviewAt: update.nextReviewAt,
    reviewCount: update.reviewCount,
    correctCount: update.correctCount,
    wrongCount: update.wrongCount,
    recognitionScore: update.recognitionScore,
    recallScore: update.recallScore,
    lastReviewedAt: update.lastReviewedAt,
    updatedAt: now,
  };

  store.vocabulary[wordIndex] = updatedWord;

  const reviewId =
    store.vocabularyReviews.length > 0
      ? Math.max(...store.vocabularyReviews.map((r) => r.id)) + 1
      : 1;

  const newReview: VocabularyReview = {
    id: reviewId,
    vocabularyId: word.id,
    userId,
    reviewType: input.reviewType,
    isCorrect,
    difficulty: input.difficulty,
    reviewedAt: now,
  };

  store.vocabularyReviews.push(newReview);
  await store.save();

  return {
    vocabulary: updatedWord,
    review: newReview,
  };
}

export interface SubmitFlashcardReviewInput {
  vocabularyId: number;
  newStatus: VocabularyStatus;
  reviewDirection: "target_to_meaning" | "meaning_to_target";
  actionType: "demote" | "keep" | "promote";
}

function computeFlashcardReview(
  word: VocabularyItem,
  input: SubmitFlashcardReviewInput,
  now: Date
) {
  const reviewType: ReviewType =
    input.reviewDirection === "target_to_meaning" ? "recognition" : "recall";
  const isCorrect = input.actionType !== "demote";

  let newRecognition = word.recognitionScore;
  let newRecall = word.recallScore;

  if (reviewType === "recognition") {
    if (input.actionType === "promote") {
      newRecognition = Math.min(100, newRecognition + 25);
    } else if (input.actionType === "keep") {
      newRecognition = Math.min(100, newRecognition + 10);
    } else {
      newRecognition = Math.max(0, newRecognition - 15);
    }
  } else {
    if (input.actionType === "promote") {
      newRecall = Math.min(100, newRecall + 25);
    } else if (input.actionType === "keep") {
      newRecall = Math.min(100, newRecall + 10);
    } else {
      newRecall = Math.max(0, newRecall - 15);
    }
  }

  let intervalDays = 1;
  switch (input.newStatus) {
    case "new":
      intervalDays = 1;
      break;
    case "learning":
      intervalDays = 2;
      break;
    case "familiar":
      intervalDays = 4;
      break;
    case "strong":
      intervalDays = 7;
      break;
    case "mastered":
      intervalDays = 14;
      break;
  }

  const nextReviewAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  const difficulty: ReviewDifficulty =
    input.actionType === "promote"
      ? "easy"
      : input.actionType === "keep"
      ? "good"
      : "forgot";

  return {
    reviewType,
    isCorrect,
    newRecognition,
    newRecall,
    intervalDays,
    nextReviewAt,
    difficulty,
  };
}

/**
 * Records a flashcard review action with direct status updates,
 * adjusting Recognition/Recall dimensions and scheduling next review.
 */
export async function submitFlashcardReview(
  userId: string,
  input: SubmitFlashcardReviewInput
): Promise<SubmitReviewResult | null> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const { data: wordRow, error: fetchError } = await supabase
          .from("vocabulary")
          .select("*")
          .eq("id", input.vocabularyId)
          .eq("user_id", userId)
          .maybeSingle();

        if (fetchError) throw new Error(fetchError.message);
        if (!wordRow) return null;

        const now = new Date();
        const word = mapVocabularyRow(wordRow as unknown as VocabularyRow);
        const calc = computeFlashcardReview(word, input, now);

        const { error: updateError } = await supabase
          .from("vocabulary")
          .update({
            status: input.newStatus,
            interval_days: calc.intervalDays,
            next_review_at: calc.nextReviewAt.toISOString(),
            review_count: word.reviewCount + 1,
            correct_count: calc.isCorrect ? word.correctCount + 1 : word.correctCount,
            wrong_count: !calc.isCorrect ? word.wrongCount + 1 : word.wrongCount,
            recognition_score: calc.newRecognition,
            recall_score: calc.newRecall,
            last_reviewed_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", word.id)
          .eq("user_id", userId);

        if (updateError) throw new Error(updateError.message);

        const { data: newReview, error: reviewError } = await supabase
          .from("vocabulary_reviews")
          .insert({
            vocabulary_id: word.id,
            user_id: userId,
            review_type: calc.reviewType,
            is_correct: calc.isCorrect,
            difficulty: calc.difficulty,
            reviewed_at: now.toISOString(),
          })
          .select("*")
          .single();

        if (reviewError || !newReview) {
          throw new Error(reviewError?.message || "Failed to insert flashcard review");
        }

        const updatedVocab = await getVocabularyByIdForUser(userId, word.id);

        return {
          vocabulary: updatedVocab!,
          review: mapReviewRow(newReview as VocabularyReviewRow),
        };
      }
    } catch (e) {
      console.error("Supabase submitFlashcardReview failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const wordIndex = store.vocabulary.findIndex(
    (v) => v.id === input.vocabularyId && v.userId === userId
  );
  if (wordIndex === -1) return null;

  const word = store.vocabulary[wordIndex];
  const now = new Date();
  const calc = computeFlashcardReview(word, input, now);

  const updatedWord: VocabularyItem = {
    ...word,
    status: input.newStatus,
    intervalDays: calc.intervalDays,
    nextReviewAt: calc.nextReviewAt,
    reviewCount: word.reviewCount + 1,
    correctCount: calc.isCorrect ? word.correctCount + 1 : word.correctCount,
    wrongCount: !calc.isCorrect ? word.wrongCount + 1 : word.wrongCount,
    recognitionScore: calc.newRecognition,
    recallScore: calc.newRecall,
    lastReviewedAt: now,
    updatedAt: now,
  };

  store.vocabulary[wordIndex] = updatedWord;

  const reviewId =
    store.vocabularyReviews.length > 0
      ? Math.max(...store.vocabularyReviews.map((r) => r.id)) + 1
      : 1;

  const newReview: VocabularyReview = {
    id: reviewId,
    vocabularyId: word.id,
    userId,
    reviewType: calc.reviewType,
    isCorrect: calc.isCorrect,
    difficulty: calc.difficulty,
    reviewedAt: now,
  };

  store.vocabularyReviews.push(newReview);
  await store.save();

  return {
    vocabulary: updatedWord,
    review: newReview,
  };
}

/**
 * Returns words with wrongCount >= 3 ("Words I Keep Forgetting")
 */
export async function getForgottenWords(
  userId: string,
  languageId?: number,
  limit: number = 10
): Promise<VocabularyItem[]> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        let query = supabase
          .from("vocabulary")
          .select("*, language:languages(*)")
          .eq("user_id", userId)
          .gte("wrong_count", 3)
          .order("wrong_count", { ascending: false })
          .limit(limit);

        if (languageId) {
          query = query.eq("language_id", languageId);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        return ((data || []) as unknown as VocabularyRow[]).map(mapVocabularyRow);
      }
    } catch (e) {
      console.error("Supabase getForgottenWords failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  let items = store.vocabulary.filter((v) => v.userId === userId && v.wrongCount >= 3);

  if (languageId) {
    items = items.filter((v) => v.languageId === languageId);
  }

  items.sort((a, b) => b.wrongCount - a.wrongCount);

  return items.slice(0, limit).map((item) => ({
    ...item,
    language: store.languages.find((l) => l.id === item.languageId),
  }));
}

/**
 * Returns review history for a vocabulary item
 */
export async function getReviewHistory(
  userId: string,
  vocabularyId: number
): Promise<VocabularyReview[]> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const { data, error } = await supabase
          .from("vocabulary_reviews")
          .select("*")
          .eq("vocabulary_id", vocabularyId)
          .eq("user_id", userId)
          .order("reviewed_at", { ascending: false });

        if (error) throw new Error(error.message);
        return ((data || []) as VocabularyReviewRow[]).map(mapReviewRow);
      }
    } catch (e) {
      console.error("Supabase getReviewHistory failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  return store.vocabularyReviews
    .filter((r) => r.vocabularyId === vocabularyId && r.userId === userId)
    .sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime());
}
