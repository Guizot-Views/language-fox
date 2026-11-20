# 🦊 Language Fox — Clever Vocabulary Builder

A personal multi-language vocabulary learning and retention manager built with **Next.js**, **TypeScript**, **Supabase (PostgreSQL + Auth + RLS)**, **Tailwind CSS**, and **Lucide Icons**.

---

## 🎯 Product Overview

**Language Fox** powers your language learning through an active, spaced repetition retention loop:

> **Find a word → Save it → Learn it → Review it → Master it**

Words progress through 5 distinct learning stages:
- 🆕 **New**: Newly captured, pending first study session.
- 🌱 **Learning**: Initial practice begun, still prone to memory decay.
- 🙂 **Familiar**: Recognized when seen, but recall not consistently instant.
- 💪 **Strong**: High retention and low-effort recall over days.
- 🏆 **Mastered**: Long-term retention over extended intervals (30+ days).

---

## 🛠 Tech Stack

- **Framework**: Next.js (App Router) & React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS & Lucide Icons
- **Database & Auth**: Supabase (`@supabase/supabase-js`, `@supabase/ssr`) with PostgreSQL Row Level Security (RLS)
- **Testing**: Node.js test runner with `npx tsx`

---

## 🚀 Getting Started

### 1. Installation

```bash
git clone https://github.com/Guizot-Views/language-fox.git
cd language-fox
npm install
```

### 2. Supabase Database Setup

1. Create a new project in [Supabase](https://supabase.com/dashboard).
2. Open **SQL Editor** in your Supabase project dashboard.
3. Paste and run the full contents of [`supabase/schema.sql`](./supabase/schema.sql).
   - Creates all 8 relational tables (`profiles`, `languages`, `user_languages`, `vocabulary`, `vocabulary_examples`, `vocabulary_reviews`, `tags`, `vocabulary_tags`).
   - Enables Row Level Security (RLS) policies on every table.
   - Adds `updated_at` and automatic profile creation (`on_auth_user_created`) triggers.
   - Seeds the 9 supported languages into `public.languages`.

### 3. Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Populate your credentials from **Supabase Dashboard → Project Settings → API**:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> **Note**: For local offline preview or automated testing without live Supabase credentials, the app falls back to a local JSON store (`.language-fox-data.json`).

### 4. Running the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Automated Tests

Run the full automated test suite:

```bash
npm test
```

This validates:
1. **Spaced Repetition Algorithm**: New word scheduling, correct/wrong answers, difficulty adjustments (forgot, hard, good, easy), status promotions (New → Learning → Familiar → Strong → Mastered), and demotions.
2. **Normalization & Matching**: Whitespace stripping, case-insensitivity, and recall punctuation tolerance.
3. **Vocabulary CRUD & Authorization**: Create, update, delete, duplicate detection by language, and cross-user data isolation.

---

## 📂 Project Architecture

```text
language-fox/
├── supabase/
│   └── schema.sql                       # PostgreSQL tables, indexes, triggers, RLS, and language seed
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx           # Email/password authentication
│   │   │   ├── signup/page.tsx          # Account registration
│   │   │   └── actions.ts               # Supabase Auth server actions
│   │   ├── auth/
│   │   │   └── callback/route.ts        # Supabase Auth PKCE callback handler
│   │   ├── (app)/
│   │   │   ├── layout.tsx               # App shell (Sidebar, Header, Language selector)
│   │   │   ├── dashboard/page.tsx       # Today's review banner, status counters, forgotten words
│   │   │   ├── vocabulary/
│   │   │   │   ├── page.tsx             # 5-column Kanban board (desktop) & tabs (mobile)
│   │   │   │   └── [id]/page.tsx        # Word detail view, examples, progress %, history
│   │   │   ├── review/
│   │   │   │   └── page.tsx             # Interactive review (Recognition & Recall)
│   │   │   ├── languages/page.tsx       # Enrolled languages and translation pairs
│   │   │   └── settings/page.tsx        # User profile & preferences
│   │   ├── layout.tsx                   # Root HTML & metadata
│   │   ├── page.tsx                     # Root redirect
│   │   └── globals.css                  # Tailwind styles
│   ├── components/
│   │   ├── ui/                          # Button, Input, Dialog, Progress, Card, Badge
│   │   ├── layout/                      # Header, Sidebar, ActiveLanguageSelector, MobileNav
│   │   ├── vocabulary/                  # KanbanBoard, KanbanColumn, WordCard, AddWordModal, WordFilters
│   │   ├── review/                      # ReviewSession, RecognitionCard, RecallCard, DifficultyRating
│   │   ├── dashboard/                   # ReviewBanner, StatusDistribution, DueWordsList, ForgottenWordsCard
│   │   └── language/                    # LanguageManager, AddLanguageModal
│   ├── lib/
│   │   ├── supabase/                    # Supabase SSR client, server, middleware & config helpers
│   │   ├── auth/                        # Server session helpers (getSession, requireUser)
│   │   ├── db/                          # Isolated data-access layer (vocabulary, reviews, languages)
│   │   ├── spaced-repetition/           # Deterministic spaced repetition algorithm & unit tests
│   │   └── utils.ts                     # Normalization & date utilities
│   ├── actions/                         # Server actions (vocabulary, languages, reviews)
│   ├── proxy.ts                         # Next.js proxy for Supabase session refresh & route protection
│   └── types/                           # Domain TypeScript types
```

---

## 🔒 Security & Authorization

All data queries and mutations derive ownership directly from the server-side Supabase Auth session via `requireUser()`, backed by PostgreSQL **Row Level Security (RLS)** policies (`auth.uid() = user_id`) on every user-owned table.
