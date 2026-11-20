-- ==============================================================================
-- LANGUAGE FOX DATABASE SCHEMA (SUPABASE / POSTGRESQL)
-- ==============================================================================
-- Cara Menggunakan:
-- 1. Buat proyek baru di https://supabase.com
-- 2. Buka menu 'SQL Editor' di dashboard Supabase Anda
-- 3. Paste seluruh isi script ini dan klik tombol 'Run'
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HELPER FUNCTION: AUTO-UPDATE updated_at
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 2. PROFILES TABLE (linked to Supabase auth.users)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS on_profiles_updated ON public.profiles;
CREATE TRIGGER on_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Automatically create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data ->> 'display_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data ->> 'full_name'), ''),
      SPLIT_PART(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own profile" ON public.profiles;
CREATE POLICY "Users can manage own profile"
  ON public.profiles
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ------------------------------------------------------------------------------
-- 3. LANGUAGES TABLE (Master supported languages)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.languages (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  native_name VARCHAR(100) NOT NULL,
  flag VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read supported languages" ON public.languages;
CREATE POLICY "Anyone can read supported languages"
  ON public.languages
  FOR SELECT
  USING (true);

-- Seed supported languages (idempotent)
INSERT INTO public.languages (code, name, native_name, flag)
VALUES
  ('en', 'English', 'English', '🇬🇧'),
  ('de', 'German', 'Deutsch', '🇩🇪'),
  ('ja', 'Japanese', '日本語', '🇯🇵'),
  ('ko', 'Korean', '한국어', '🇰🇷'),
  ('fr', 'French', 'Français', '🇫🇷'),
  ('es', 'Spanish', 'Español', '🇪🇸'),
  ('it', 'Italian', 'Italiano', '🇮🇹'),
  ('id', 'Indonesian', 'Bahasa Indonesia', '🇮🇩'),
  ('zh', 'Chinese', '中文', '🇨🇳')
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 4. USER LANGUAGES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_languages (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  language_id INTEGER NOT NULL,
  translation_language_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_languages_language_id_fkey
    FOREIGN KEY (language_id) REFERENCES public.languages(id) ON DELETE CASCADE,
  CONSTRAINT user_languages_translation_language_id_fkey
    FOREIGN KEY (translation_language_id) REFERENCES public.languages(id) ON DELETE SET NULL,
  CONSTRAINT user_language_unique_idx UNIQUE (user_id, language_id)
);

CREATE INDEX IF NOT EXISTS user_languages_user_id_idx
  ON public.user_languages (user_id);

DROP TRIGGER IF EXISTS on_user_languages_updated ON public.user_languages;
CREATE TRIGGER on_user_languages_updated
  BEFORE UPDATE ON public.user_languages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.user_languages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own languages" ON public.user_languages;
CREATE POLICY "Users can manage own languages"
  ON public.user_languages
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 5. VOCABULARY TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vocabulary (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  language_id INTEGER NOT NULL REFERENCES public.languages(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  meaning TEXT NOT NULL,
  pronunciation TEXT,
  part_of_speech VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'learning', 'familiar', 'strong', 'mastered')),
  recognition_score INTEGER NOT NULL DEFAULT 0,
  recall_score INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  interval_days INTEGER NOT NULL DEFAULT 0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vocabulary_user_lang_idx
  ON public.vocabulary (user_id, language_id);
CREATE INDEX IF NOT EXISTS vocabulary_user_status_idx
  ON public.vocabulary (user_id, status);
CREATE INDEX IF NOT EXISTS vocabulary_user_next_review_idx
  ON public.vocabulary (user_id, next_review_at);
CREATE INDEX IF NOT EXISTS vocabulary_user_created_at_idx
  ON public.vocabulary (user_id, created_at);

DROP TRIGGER IF EXISTS on_vocabulary_updated ON public.vocabulary;
CREATE TRIGGER on_vocabulary_updated
  BEFORE UPDATE ON public.vocabulary
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.vocabulary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own vocabulary" ON public.vocabulary;
CREATE POLICY "Users can manage own vocabulary"
  ON public.vocabulary
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 6. VOCABULARY EXAMPLES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vocabulary_examples (
  id SERIAL PRIMARY KEY,
  vocabulary_id INTEGER NOT NULL REFERENCES public.vocabulary(id) ON DELETE CASCADE,
  sentence TEXT NOT NULL,
  translation TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vocabulary_examples_vocab_id_idx
  ON public.vocabulary_examples (vocabulary_id);

ALTER TABLE public.vocabulary_examples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage examples of own vocabulary" ON public.vocabulary_examples;
CREATE POLICY "Users can manage examples of own vocabulary"
  ON public.vocabulary_examples
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.vocabulary v
      WHERE v.id = vocabulary_examples.vocabulary_id
        AND v.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vocabulary v
      WHERE v.id = vocabulary_examples.vocabulary_id
        AND v.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------------------
-- 7. VOCABULARY REVIEWS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vocabulary_reviews (
  id SERIAL PRIMARY KEY,
  vocabulary_id INTEGER NOT NULL REFERENCES public.vocabulary(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  review_type VARCHAR(20) NOT NULL CHECK (review_type IN ('recognition', 'recall')),
  is_correct BOOLEAN NOT NULL,
  difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('forgot', 'hard', 'good', 'easy')),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reviews_vocab_reviewed_at_idx
  ON public.vocabulary_reviews (vocabulary_id, reviewed_at);
CREATE INDEX IF NOT EXISTS reviews_user_id_idx
  ON public.vocabulary_reviews (user_id);

ALTER TABLE public.vocabulary_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own reviews" ON public.vocabulary_reviews;
CREATE POLICY "Users can manage own reviews"
  ON public.vocabulary_reviews
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 8. TAGS & VOCABULARY TAGS TABLES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tags (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tags_user_name_unique_idx UNIQUE (user_id, name)
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own tags" ON public.tags;
CREATE POLICY "Users can manage own tags"
  ON public.tags
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.vocabulary_tags (
  vocabulary_id INTEGER NOT NULL REFERENCES public.vocabulary(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (vocabulary_id, tag_id)
);

ALTER TABLE public.vocabulary_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage tags on own vocabulary" ON public.vocabulary_tags;
CREATE POLICY "Users can manage tags on own vocabulary"
  ON public.vocabulary_tags
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.vocabulary v
      WHERE v.id = vocabulary_tags.vocabulary_id
        AND v.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vocabulary v
      WHERE v.id = vocabulary_tags.vocabulary_id
        AND v.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.tags t
      WHERE t.id = vocabulary_tags.tag_id
        AND t.user_id = auth.uid()
    )
  );
