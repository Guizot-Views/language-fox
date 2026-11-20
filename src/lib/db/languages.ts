import { Language, UserLanguage } from "@/types";
import { getLocalStore } from "./store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const isTestEnv = process.env.NODE_ENV === "test" || Boolean(process.env.NODE_TEST_CONTEXT);

export const SUPPORTED_LANGUAGES: Omit<Language, "id" | "createdAt">[] = [
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "zh", name: "Chinese", nativeName: "中文", flag: "🇨🇳" },
];

interface LanguageRow {
  id: number;
  code: string;
  name: string;
  native_name: string;
  flag: string;
  created_at: string;
}

interface UserLanguageRow {
  id: number;
  user_id: string;
  language_id: number;
  translation_language_id: number | null;
  created_at: string;
  updated_at: string;
  language: LanguageRow | LanguageRow[] | null;
  translation_language: LanguageRow | LanguageRow[] | null;
}

function unwrapSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function mapLanguageRow(row: LanguageRow): Language {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nativeName: row.native_name,
    flag: row.flag,
    createdAt: new Date(row.created_at),
  };
}

const USER_LANGUAGE_SELECT = `
  id,
  user_id,
  language_id,
  translation_language_id,
  created_at,
  updated_at,
  language:languages!user_languages_language_id_fkey(*),
  translation_language:languages!user_languages_translation_language_id_fkey(*)
`;

/**
 * Returns all supported languages
 */
export async function getLanguages(): Promise<Language[]> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const { data, error } = await supabase
          .from("languages")
          .select("*")
          .order("id", { ascending: true });

        if (!error && data && data.length > 0) {
          return (data as LanguageRow[]).map(mapLanguageRow);
        }
        if (error) {
          console.error("Supabase getLanguages failed, falling back:", error.message);
        }
      }
    } catch (e) {
      console.error("Supabase getLanguages failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  return store.languages;
}

/**
 * Returns languages enrolled by the user
 */
export async function getUserLanguages(userId: string): Promise<UserLanguage[]> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const [userLangsRes, vocabRes] = await Promise.all([
          supabase
            .from("user_languages")
            .select(USER_LANGUAGE_SELECT)
            .eq("user_id", userId)
            .order("created_at", { ascending: true }),
          supabase
            .from("vocabulary")
            .select("language_id")
            .eq("user_id", userId),
        ]);

        if (userLangsRes.error) {
          throw new Error(userLangsRes.error.message);
        }

        const countMap = new Map<number, number>();
        if (!vocabRes.error && vocabRes.data) {
          for (const row of vocabRes.data as { language_id: number }[]) {
            countMap.set(row.language_id, (countMap.get(row.language_id) || 0) + 1);
          }
        }

        return ((userLangsRes.data || []) as unknown as UserLanguageRow[])
          .map((ul): UserLanguage | null => {
            const langRow = unwrapSingle(ul.language);
            if (!langRow) return null;
            const transLangRow = unwrapSingle(ul.translation_language);

            return {
              id: ul.id,
              userId: ul.user_id,
              languageId: ul.language_id,
              translationLanguageId: ul.translation_language_id,
              language: mapLanguageRow(langRow),
              translationLanguage: transLangRow ? mapLanguageRow(transLangRow) : null,
              wordCount: countMap.get(ul.language_id) || 0,
              createdAt: new Date(ul.created_at),
              updatedAt: new Date(ul.updated_at),
            };
          })
          .filter((item): item is UserLanguage => item !== null);
      }
    } catch (e) {
      console.error("Supabase getUserLanguages failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const userLangs = store.userLanguages.filter((ul) => ul.userId === userId);

  return userLangs.map((ul) => {
    const lang = store.languages.find((l) => l.id === ul.languageId)!;
    const transLang = ul.translationLanguageId
      ? store.languages.find((l) => l.id === ul.translationLanguageId) || null
      : null;
    const wordCount = store.vocabulary.filter(
      (v) => v.userId === userId && v.languageId === ul.languageId
    ).length;

    return {
      id: ul.id,
      userId: ul.userId,
      languageId: ul.languageId,
      translationLanguageId: ul.translationLanguageId,
      language: lang,
      translationLanguage: transLang,
      wordCount,
      createdAt: ul.createdAt,
      updatedAt: ul.updatedAt,
    };
  });
}

/**
 * Adds a new learning language for the user
 */
export async function addUserLanguage(
  userId: string,
  languageId: number,
  translationLanguageId?: number | null
): Promise<UserLanguage> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const now = new Date().toISOString();
        const { data: entry, error } = await supabase
          .from("user_languages")
          .upsert(
            {
              user_id: userId,
              language_id: languageId,
              translation_language_id: translationLanguageId || null,
              updated_at: now,
            },
            { onConflict: "user_id,language_id" }
          )
          .select(USER_LANGUAGE_SELECT)
          .single();

        if (error || !entry) {
          throw new Error(error?.message || "Failed to upsert user language");
        }

        const { count } = await supabase
          .from("vocabulary")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("language_id", languageId);

        const row = entry as unknown as UserLanguageRow;
        const langRow = unwrapSingle(row.language)!;
        const transLangRow = unwrapSingle(row.translation_language);

        return {
          id: row.id,
          userId: row.user_id,
          languageId: row.language_id,
          translationLanguageId: row.translation_language_id,
          language: mapLanguageRow(langRow),
          translationLanguage: transLangRow ? mapLanguageRow(transLangRow) : null,
          wordCount: count || 0,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        };
      }
    } catch (e) {
      console.error("Supabase addUserLanguage failed, falling back:", e);
    }
  }

  const store = await getLocalStore();

  const existing = store.userLanguages.find(
    (ul) => ul.userId === userId && ul.languageId === languageId
  );
  if (existing) {
    if (
      translationLanguageId !== undefined &&
      existing.translationLanguageId !== translationLanguageId
    ) {
      existing.translationLanguageId = translationLanguageId || null;
      existing.updatedAt = new Date();
      await store.save();
    }
    const lang = store.languages.find((l) => l.id === existing.languageId)!;
    const transLang = existing.translationLanguageId
      ? store.languages.find((l) => l.id === existing.translationLanguageId) || null
      : null;
    return {
      ...existing,
      language: lang,
      translationLanguage: transLang,
      wordCount: store.vocabulary.filter(
        (v) => v.userId === userId && v.languageId === lang.id
      ).length,
    };
  }

  const newId =
    store.userLanguages.length > 0
      ? Math.max(...store.userLanguages.map((ul) => ul.id)) + 1
      : 1;

  const newEntry = {
    id: newId,
    userId,
    languageId,
    translationLanguageId: translationLanguageId || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  store.userLanguages.push(newEntry);
  await store.save();

  const lang = store.languages.find((l) => l.id === languageId)!;
  const transLang = translationLanguageId
    ? store.languages.find((l) => l.id === translationLanguageId) || null
    : null;

  return {
    ...newEntry,
    language: lang,
    translationLanguage: transLang,
    wordCount: 0,
  };
}

/**
 * Removes a learning language for the user
 */
export async function removeUserLanguage(
  userId: string,
  languageId: number
): Promise<boolean> {
  if (!isTestEnv && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        const [ulRes, vocabRes] = await Promise.all([
          supabase
            .from("user_languages")
            .delete()
            .eq("user_id", userId)
            .eq("language_id", languageId),
          supabase
            .from("vocabulary")
            .delete()
            .eq("user_id", userId)
            .eq("language_id", languageId),
        ]);

        if (ulRes.error) throw new Error(ulRes.error.message);
        if (vocabRes.error) throw new Error(vocabRes.error.message);
        return true;
      }
    } catch (e) {
      console.error("Supabase removeUserLanguage failed, falling back:", e);
    }
  }

  const store = await getLocalStore();
  const initialCount = store.userLanguages.length;
  store.userLanguages = store.userLanguages.filter(
    (ul) => !(ul.userId === userId && ul.languageId === languageId)
  );
  store.vocabulary = store.vocabulary.filter(
    (v) => !(v.userId === userId && v.languageId === languageId)
  );
  await store.save();
  return store.userLanguages.length < initialCount;
}
