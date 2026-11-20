import {
  VocabularyItem,
  VocabularyStatus,
  StatusCounts,
  VocabularyExample,
  VocabularyReview,
  ReviewType,
  ReviewDifficulty,
  Tag,
} from "@/types";
import { getLocalStore } from "./store";
import { mapLanguageRow } from "./languages";
import { normalizeWord } from "../utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const isTestEnv = process.env.NODE_ENV === "test" || Boolean(process.env.NODE_TEST_CONTEXT);

export interface VocabularyFilterOptions {
  status?: string;
  search?: string;
  sortBy?:
    | "recently_added"
    | "recently_reviewed"
    | "next_review"
    | "alphabetical"
    | "most_forgotten"
    | "custom";
}

interface LanguageRow {
  id: number;
  code: string;
  name: string;
  native_name: string;
  flag: string;
  created_at: string;
}

interface VocabularyExampleRow {
  id: number;
  vocabulary_id: number;
  sentence: string;
  translation: string | null;
  source: string | null;
  created_at: string;
}

interface TagRow {
  id: number;
  user_id: string;
  name: string;
  created_at: string;
}

interface VocabularyTagJoinRow {
  tag: TagRow | TagRow[] | null;
}

interface VocabularyReviewRow {
  id: number;
  vocabulary_id: number;
  user_id: string;
  review_type: string;
  is_correct: boolean;
  difficulty: string;
  reviewed_at: string;
}

export interface VocabularyRow {
  id: number;
  user_id: string;
  language_id: number;
  word: string;
  meaning: string;
  pronunciation: string | null;
  part_of_speech: string | null;
  status: string;
  recognition_score: number;
  recall_score: number;
  review_count: number;
  correct_count: number;
  wrong_count: number;
  last_reviewed_at: string | null;
  next_review_at: string;
  interval_days: number;
  ease_factor: number;
  order_index: number;
  created_at: string;
  updated_at: string;
  language?: LanguageRow | LanguageRow[] | null;
  examples?: VocabularyExampleRow[] | null;
  vocabulary_tags?: VocabularyTagJoinRow[] | null;
}

const VOCABULARY_SELECT = `
  *,
  language:languages(*),
  examples:vocabulary_examples(*),
  vocabulary_tags(tag:tags(*))
`;

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function mapVocabularyRow(row: VocabularyRow): VocabularyItem {
  const langRow = unwrapSingle(row.language);
  const examples: VocabularyExample[] | undefined = row.examples
    ? row.examples.map((e) => ({
        id: e.id,
        vocabularyId: e.vocabulary_id,
        sentence: e.sentence,
        translation: e.translation,
        source: e.source,
        createdAt: new Date(e.created_at),
      }))
    : undefined;

  const tags: Tag[] | undefined = row.vocabulary_tags
    ? row.vocabulary_tags
        .map((vt) => unwrapSingle(vt.tag))
        .filter((t): t is TagRow => t !== null)
        .map((t) => ({
          id: t.id,
          userId: t.user_id,
          name: t.name,
          createdAt: new Date(t.created_at),
        }))
    : undefined;

  return {
    id: row.id,
    userId: row.user_id,
    languageId: row.language_id,
    word: row.word,
    meaning: row.meaning,
    pronunciation: row.pronunciation,
    partOfSpeech: row.part_of_speech,
    status: row.status as VocabularyStatus,
    recognitionScore: row.recognition_score,
    recallScore: row.recall_score,
    reviewCount: row.review_count,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at) : null,
    nextReviewAt: new Date(row.next_review_at),
    intervalDays: row.interval_days,
    easeFactor: row.ease_factor,
    orderIndex: row.order_index ?? 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    language: langRow ? mapLanguageRow(langRow) : undefined,
    examples,
    tags,
  };
}

function sortVocabularyItems(
  items: VocabularyItem[],
  sortBy: VocabularyFilterOptions["sortBy"] = "custom"
): VocabularyItem[] {
  return items.sort((a, b) => {
    switch (sortBy) {
      case "custom":
        return (
          (a.orderIndex ?? 0) - (b.orderIndex ?? 0) ||
          b.createdAt.getTime() - a.createdAt.getTime()
        );
      case "recently_reviewed":
        return (b.lastReviewedAt?.getTime() || 0) - (a.lastReviewedAt?.getTime() || 0);
      case "next_review":
        return a.nextReviewAt.getTime() - b.nextReviewAt.getTime();
      case "alphabetical":
        return a.word.localeCompare(b.word);
      case "most_forgotten":
        return b.wrongCount - a.wrongCount;
      case "recently_added":
      default:
        return b.createdAt.getTime() - a.createdAt.getTime();
    }
  });
}

export async function getVocabularyForUser(
  userId: string,
  languageId?: number,
  options: VocabularyFilterOptions = {}
): Promise<VocabularyItem[]> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        let query = supabase
          .from("vocabulary")
          .select(VOCABULARY_SELECT)
          .eq("user_id", userId);

        if (languageId) {
          query = query.eq("language_id", languageId);
        }
        if (options.status && options.status !== "all") {
          query = query.eq("status", options.status);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        let items = ((data || []) as unknown as VocabularyRow[]).map(mapVocabularyRow);

        if (options.search) {
          const q = options.search.toLowerCase().trim();
          items = items.filter(
            (v) =>
              v.word.toLowerCase().includes(q) ||
              v.meaning.toLowerCase().includes(q) ||
              (v.partOfSpeech && v.partOfSpeech.toLowerCase().includes(q))
          );
        }

        return sortVocabularyItems(items, options.sortBy || "custom");
      }
    } catch (e) {
      console.error("Supabase getVocabularyForUser failed, falling back:", e);
    }
  }

  const store = await getLocalStore();

  let items = store.vocabulary.filter((v) => v.userId === userId);

  if (languageId) {
    items = items.filter((v) => v.languageId === languageId);
  }

  if (options.status && options.status !== "all") {
    items = items.filter((v) => v.status === options.status);
  }

  if (options.search) {
    const q = options.search.toLowerCase().trim();
    items = items.filter(
      (v) =>
        v.word.toLowerCase().includes(q) ||
        v.meaning.toLowerCase().includes(q) ||
        (v.partOfSpeech && v.partOfSpeech.toLowerCase().includes(q))
    );
  }

  sortVocabularyItems(items, options.sortBy || "custom");

  return items.map((item) => {
    const lang = store.languages.find((l) => l.id === item.languageId);
    const examples = store.vocabularyExamples.filter((e) => e.vocabularyId === item.id);
    const tagIds = store.vocabularyTags
      .filter((vt) => vt.vocabularyId === item.id)
      .map((vt) => vt.tagId);
    const tags = store.tags.filter((t) => tagIds.includes(t.id));

    return {
      ...item,
      language: lang,
      examples,
      tags,
    };
  });
}

export async function getVocabularyByIdForUser(
  userId: string,
  vocabId: number
): Promise<VocabularyItem | null> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const { data, error } = await supabase
          .from("vocabulary")
          .select(VOCABULARY_SELECT)
          .eq("id", vocabId)
          .eq("user_id", userId)
          .maybeSingle();

        if (error) throw new Error(error.message);
        if (!data) return null;

        return mapVocabularyRow(data as unknown as VocabularyRow);
      }
    } catch (e) {
      console.error("Supabase getVocabularyByIdForUser failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const item = store.vocabulary.find((v) => v.id === vocabId && v.userId === userId);
  if (!item) return null;

  const lang = store.languages.find((l) => l.id === item.languageId);
  const examples = store.vocabularyExamples.filter((e) => e.vocabularyId === item.id);
  const tagIds = store.vocabularyTags
    .filter((vt) => vt.vocabularyId === item.id)
    .map((vt) => vt.tagId);
  const tags = store.tags.filter((t) => tagIds.includes(t.id));

  return {
    ...item,
    language: lang,
    examples,
    tags,
  };
}

export async function getVocabularyDetailForUser(
  userId: string,
  vocabId: number
): Promise<{ word: VocabularyItem; reviews: VocabularyReview[] } | null> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const [wordRes, reviewsRes] = await Promise.all([
          supabase
            .from("vocabulary")
            .select(VOCABULARY_SELECT)
            .eq("id", vocabId)
            .eq("user_id", userId)
            .maybeSingle(),
          supabase
            .from("vocabulary_reviews")
            .select("*")
            .eq("vocabulary_id", vocabId)
            .eq("user_id", userId)
            .order("reviewed_at", { ascending: false }),
        ]);

        if (wordRes.error) throw new Error(wordRes.error.message);
        if (!wordRes.data) return null;

        const word = mapVocabularyRow(wordRes.data as unknown as VocabularyRow);
        const reviews: VocabularyReview[] = (
          (reviewsRes.data || []) as VocabularyReviewRow[]
        ).map((r) => ({
          id: r.id,
          vocabularyId: r.vocabulary_id,
          userId: r.user_id,
          reviewType: r.review_type as ReviewType,
          isCorrect: r.is_correct,
          difficulty: r.difficulty as ReviewDifficulty,
          reviewedAt: new Date(r.reviewed_at),
        }));

        return { word, reviews };
      }
    } catch (e) {
      console.error("Supabase getVocabularyDetailForUser failed, falling back:", e);
    }
  }

  const word = await getVocabularyByIdForUser(userId, vocabId);
  if (!word) return null;

  const store = await getLocalStore();
  const reviews = store.vocabularyReviews
    .filter((r) => r.vocabularyId === vocabId && r.userId === userId)
    .sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime());

  return { word, reviews };
}

export async function findDuplicateWord(
  userId: string,
  languageId: number,
  word: string
): Promise<VocabularyItem | null> {
  const normalized = normalizeWord(word);

  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const { data, error } = await supabase
          .from("vocabulary")
          .select("id, word")
          .eq("user_id", userId)
          .eq("language_id", languageId);

        if (error) throw new Error(error.message);

        const match = ((data || []) as { id: number; word: string }[]).find(
          (v) => normalizeWord(v.word) === normalized
        );
        if (match) {
          return getVocabularyByIdForUser(userId, match.id);
        }
        return null;
      }
    } catch (e) {
      console.error("Supabase findDuplicateWord failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const match = store.vocabulary.find(
    (v) =>
      v.userId === userId &&
      v.languageId === languageId &&
      normalizeWord(v.word) === normalized
  );

  return match || null;
}

export interface CreateVocabularyInput {
  languageId: number;
  word: string;
  meaning: string;
  pronunciation?: string;
  partOfSpeech?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
  tags?: string[];
  status?: VocabularyStatus;
}

export async function createVocabulary(
  userId: string,
  input: CreateVocabularyInput
): Promise<{
  success: boolean;
  item?: VocabularyItem;
  error?: string;
  duplicate?: VocabularyItem;
}> {
  const trimmedWord = input.word.trim();
  const trimmedMeaning = input.meaning.trim();

  if (!trimmedWord || !trimmedMeaning) {
    return { success: false, error: "Word and meaning are required." };
  }

  // Duplicate check
  const duplicate = await findDuplicateWord(userId, input.languageId, trimmedWord);
  if (duplicate) {
    return {
      success: false,
      error: "Word already exists in your vocabulary.",
      duplicate,
    };
  }

  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (!supabase) {
        return { success: false, error: "Supabase client is not available." };
      }

      const targetStatus = input.status ?? "new";
      const { data: maxOrderRow } = await supabase
        .from("vocabulary")
        .select("order_index")
        .eq("user_id", userId)
        .eq("language_id", input.languageId)
        .eq("status", targetStatus)
        .order("order_index", { ascending: false })
        .limit(1)
        .maybeSingle();

      const maxOrderIndex = maxOrderRow ? maxOrderRow.order_index ?? 0 : -1;
      const now = new Date().toISOString();

      const { data: inserted, error: insertError } = await supabase
        .from("vocabulary")
        .insert({
          user_id: userId,
          language_id: input.languageId,
          word: trimmedWord,
          meaning: trimmedMeaning,
          pronunciation: input.pronunciation?.trim() || null,
          part_of_speech: input.partOfSpeech?.trim() || null,
          status: targetStatus,
          recognition_score: 0,
          recall_score: 0,
          review_count: 0,
          correct_count: 0,
          wrong_count: 0,
          last_reviewed_at: null,
          next_review_at: now,
          interval_days: 0,
          ease_factor: 2.5,
          order_index: maxOrderIndex + 1,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        return {
          success: false,
          error: insertError?.message || "Failed to create word.",
        };
      }

      if (input.exampleSentence?.trim()) {
        await supabase.from("vocabulary_examples").insert({
          vocabulary_id: inserted.id,
          sentence: input.exampleSentence.trim(),
          translation: input.exampleTranslation?.trim() || null,
          source: "Manual",
        });
      }

      if (input.tags && input.tags.length > 0) {
        for (const tagName of input.tags) {
          const cleanName = tagName.trim();
          if (!cleanName) continue;

          const { data: existingTag } = await supabase
            .from("tags")
            .select("id")
            .eq("user_id", userId)
            .eq("name", cleanName)
            .maybeSingle();

          let tagId = existingTag?.id;

          if (!tagId) {
            const { data: newTag } = await supabase
              .from("tags")
              .upsert(
                { user_id: userId, name: cleanName },
                { onConflict: "user_id,name" }
              )
              .select("id")
              .single();

            tagId = newTag?.id;
          }

          if (tagId) {
            await supabase
              .from("vocabulary_tags")
              .upsert(
                { vocabulary_id: inserted.id, tag_id: tagId },
                { onConflict: "vocabulary_id,tag_id", ignoreDuplicates: true }
              );
          }
        }
      }

      const created = await getVocabularyByIdForUser(userId, inserted.id);
      return { success: true, item: created! };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create word.";
      console.error("Supabase createVocabulary failed:", err);
      return { success: false, error: message };
    }
  }

  const store = await getLocalStore();

  const newId =
    store.vocabulary.length > 0
      ? Math.max(...store.vocabulary.map((v) => v.id)) + 1
      : 1;
  const now = new Date();

  const maxOrderIndex = store.vocabulary
    .filter(
      (v) =>
        v.userId === userId &&
        v.languageId === input.languageId &&
        v.status === (input.status ?? "new")
    )
    .reduce((max, v) => Math.max(max, v.orderIndex ?? 0), -1);

  const newItem: VocabularyItem = {
    id: newId,
    userId,
    languageId: input.languageId,
    word: trimmedWord,
    meaning: trimmedMeaning,
    pronunciation: input.pronunciation?.trim() || null,
    partOfSpeech: input.partOfSpeech?.trim() || null,
    status: input.status ?? "new",
    recognitionScore: 0,
    recallScore: 0,
    reviewCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lastReviewedAt: null,
    nextReviewAt: now,
    intervalDays: 0,
    easeFactor: 2.5,
    orderIndex: maxOrderIndex + 1,
    createdAt: now,
    updatedAt: now,
  };

  store.vocabulary.push(newItem);

  if (input.exampleSentence?.trim()) {
    const exampleId =
      store.vocabularyExamples.length > 0
        ? Math.max(...store.vocabularyExamples.map((e) => e.id)) + 1
        : 1;
    store.vocabularyExamples.push({
      id: exampleId,
      vocabularyId: newId,
      sentence: input.exampleSentence.trim(),
      translation: input.exampleTranslation?.trim() || null,
      source: "Manual",
      createdAt: now,
    });
  }

  if (input.tags && input.tags.length > 0) {
    for (const tagName of input.tags) {
      const cleanName = tagName.trim();
      if (!cleanName) continue;

      let tag = store.tags.find(
        (t) => t.userId === userId && t.name.toLowerCase() === cleanName.toLowerCase()
      );
      if (!tag) {
        const tagId =
          store.tags.length > 0 ? Math.max(...store.tags.map((t) => t.id)) + 1 : 1;
        tag = { id: tagId, userId, name: cleanName, createdAt: now };
        store.tags.push(tag);
      }
      store.vocabularyTags.push({ vocabularyId: newId, tagId: tag.id });
    }
  }

  await store.save();

  const created = await getVocabularyByIdForUser(userId, newId);
  return { success: true, item: created! };
}

export async function updateVocabulary(
  userId: string,
  vocabId: number,
  data: Partial<
    Pick<VocabularyItem, "word" | "meaning" | "pronunciation" | "partOfSpeech" | "status">
  > & {
    exampleSentence?: string;
    exampleTranslation?: string;
  }
): Promise<VocabularyItem | null> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const now = new Date().toISOString();
        const updateData: Record<string, unknown> = { updated_at: now };
        if (data.word !== undefined) updateData.word = data.word.trim();
        if (data.meaning !== undefined) updateData.meaning = data.meaning.trim();
        if (data.pronunciation !== undefined) {
          updateData.pronunciation = data.pronunciation?.trim() || null;
        }
        if (data.partOfSpeech !== undefined) {
          updateData.part_of_speech = data.partOfSpeech?.trim() || null;
        }
        if (data.status !== undefined) updateData.status = data.status;

        const { data: updatedRows, error: updateError } = await supabase
          .from("vocabulary")
          .update(updateData)
          .eq("id", vocabId)
          .eq("user_id", userId)
          .select("id");

        if (updateError) throw new Error(updateError.message);
        if (!updatedRows || updatedRows.length === 0) return null;

        if (data.exampleSentence !== undefined) {
          if (data.exampleSentence.trim()) {
            const { data: existing } = await supabase
              .from("vocabulary_examples")
              .select("id")
              .eq("vocabulary_id", vocabId);

            if (existing && existing.length > 0) {
              await supabase
                .from("vocabulary_examples")
                .update({
                  sentence: data.exampleSentence.trim(),
                  translation: data.exampleTranslation?.trim() || null,
                })
                .eq("vocabulary_id", vocabId);
            } else {
              await supabase.from("vocabulary_examples").insert({
                vocabulary_id: vocabId,
                sentence: data.exampleSentence.trim(),
                translation: data.exampleTranslation?.trim() || null,
                source: "Manual",
                created_at: now,
              });
            }
          } else {
            await supabase
              .from("vocabulary_examples")
              .delete()
              .eq("vocabulary_id", vocabId);
          }
        }

        return getVocabularyByIdForUser(userId, vocabId);
      }
    } catch (e) {
      console.error("Supabase updateVocabulary failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const index = store.vocabulary.findIndex(
    (v) => v.id === vocabId && v.userId === userId
  );
  if (index === -1) return null;

  const current = store.vocabulary[index];
  const now = new Date();

  store.vocabulary[index] = {
    ...current,
    word: data.word !== undefined ? data.word.trim() : current.word,
    meaning: data.meaning !== undefined ? data.meaning.trim() : current.meaning,
    pronunciation:
      data.pronunciation !== undefined
        ? data.pronunciation?.trim() || null
        : current.pronunciation,
    partOfSpeech:
      data.partOfSpeech !== undefined
        ? data.partOfSpeech?.trim() || null
        : current.partOfSpeech,
    status: data.status !== undefined ? data.status : current.status,
    updatedAt: now,
  };

  if (data.exampleSentence !== undefined) {
    const existingExample = store.vocabularyExamples.find(
      (e) => e.vocabularyId === vocabId
    );
    if (data.exampleSentence.trim()) {
      if (existingExample) {
        existingExample.sentence = data.exampleSentence.trim();
        existingExample.translation = data.exampleTranslation?.trim() || null;
      } else {
        const exampleId =
          store.vocabularyExamples.length > 0
            ? Math.max(...store.vocabularyExamples.map((e) => e.id)) + 1
            : 1;
        store.vocabularyExamples.push({
          id: exampleId,
          vocabularyId: vocabId,
          sentence: data.exampleSentence.trim(),
          translation: data.exampleTranslation?.trim() || null,
          source: "Manual",
          createdAt: now,
        });
      }
    } else if (existingExample) {
      store.vocabularyExamples = store.vocabularyExamples.filter(
        (e) => e.vocabularyId !== vocabId
      );
    }
  }

  await store.save();
  return getVocabularyByIdForUser(userId, vocabId);
}

export async function deleteVocabulary(
  userId: string,
  vocabId: number
): Promise<boolean> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const { data, error } = await supabase
          .from("vocabulary")
          .delete()
          .eq("id", vocabId)
          .eq("user_id", userId)
          .select("id");

        if (error) throw new Error(error.message);
        return (data?.length ?? 0) > 0;
      }
    } catch (e) {
      console.error("Supabase deleteVocabulary failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const initialCount = store.vocabulary.length;
  store.vocabulary = store.vocabulary.filter(
    (v) => !(v.id === vocabId && v.userId === userId)
  );
  store.vocabularyExamples = store.vocabularyExamples.filter(
    (e) => e.vocabularyId !== vocabId
  );
  store.vocabularyReviews = store.vocabularyReviews.filter(
    (r) => r.vocabularyId !== vocabId
  );
  store.vocabularyTags = store.vocabularyTags.filter(
    (vt) => vt.vocabularyId !== vocabId
  );

  await store.save();
  return store.vocabulary.length < initialCount;
}

export async function updateVocabularyStatus(
  userId: string,
  vocabId: number,
  status: VocabularyStatus
): Promise<VocabularyItem | null> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const { error } = await supabase
          .from("vocabulary")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", vocabId)
          .eq("user_id", userId);

        if (error) throw new Error(error.message);
        return getVocabularyByIdForUser(userId, vocabId);
      }
    } catch (e) {
      console.error("Supabase updateVocabularyStatus failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const item = store.vocabulary.find((v) => v.id === vocabId && v.userId === userId);
  if (!item) return null;

  item.status = status;
  item.updatedAt = new Date();
  await store.save();

  return getVocabularyByIdForUser(userId, vocabId);
}

export async function getStatusCounts(
  userId: string,
  languageId?: number
): Promise<StatusCounts> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        let query = supabase
          .from("vocabulary")
          .select("status")
          .eq("user_id", userId);

        if (languageId) {
          query = query.eq("language_id", languageId);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const counts: StatusCounts = {
          new: 0,
          learning: 0,
          familiar: 0,
          strong: 0,
          mastered: 0,
          total: 0,
        };

        for (const row of (data || []) as { status: string }[]) {
          if (row.status in counts) {
            counts[row.status as VocabularyStatus]++;
            counts.total++;
          }
        }
        return counts;
      }
    } catch (e) {
      console.error("Supabase getStatusCounts failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  let items = store.vocabulary.filter((v) => v.userId === userId);
  if (languageId) {
    items = items.filter((v) => v.languageId === languageId);
  }

  const counts: StatusCounts = {
    new: 0,
    learning: 0,
    familiar: 0,
    strong: 0,
    mastered: 0,
    total: items.length,
  };

  for (const item of items) {
    if (item.status in counts) {
      counts[item.status]++;
    }
  }

  return counts;
}

export async function reorderVocabulary(
  userId: string,
  items: { id: number; status: VocabularyStatus; orderIndex: number }[]
): Promise<boolean> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const now = new Date().toISOString();
        const results = await Promise.all(
          items.map((item) =>
            supabase
              .from("vocabulary")
              .update({
                status: item.status,
                order_index: item.orderIndex,
                updated_at: now,
              })
              .eq("id", item.id)
              .eq("user_id", userId)
          )
        );

        const failed = results.find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
        return true;
      }
    } catch (e) {
      console.error("Supabase reorderVocabulary failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  let changed = false;
  const now = new Date();

  for (const update of items) {
    const vocab = store.vocabulary.find(
      (v) => v.id === update.id && v.userId === userId
    );
    if (vocab) {
      if (vocab.status !== update.status || vocab.orderIndex !== update.orderIndex) {
        vocab.status = update.status;
        vocab.orderIndex = update.orderIndex;
        vocab.updatedAt = now;
        changed = true;
      }
    }
  }

  if (changed) {
    await store.save();
  }
  return changed;
}
