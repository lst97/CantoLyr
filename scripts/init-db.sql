-- Dev reset: drop objects if exist
DROP TABLE IF EXISTS "public"."tone_ngrams" CASCADE;
DROP TABLE IF EXISTS "public"."syllables" CASCADE;
DROP TABLE IF EXISTS "public"."tokens" CASCADE;
DROP TABLE IF EXISTS "public"."lyric_keywords" CASCADE;
DROP TABLE IF EXISTS "public"."keywords" CASCADE;
DROP TABLE IF EXISTS "public"."lyric_themes" CASCADE;
DROP TABLE IF EXISTS "public"."themes" CASCADE;
DROP TABLE IF EXISTS "public"."lyric_lines" CASCADE;
DROP TABLE IF EXISTS "public"."song_lyricists" CASCADE;
DROP TABLE IF EXISTS "public"."song_artists" CASCADE;
DROP TABLE IF EXISTS "public"."lyricists" CASCADE;
DROP TABLE IF EXISTS "public"."artists" CASCADE;
DROP TABLE IF EXISTS "public"."songs" CASCADE;
DROP TABLE IF EXISTS "public"."feedback" CASCADE;
DROP TABLE IF EXISTS "public"."readings" CASCADE;
DROP TABLE IF EXISTS "public"."entries" CASCADE;
DROP TYPE IF EXISTS "public"."EntryType";

-- CreateEnum
CREATE TYPE "public"."EntryType" AS ENUM ('vocab', 'char');

-- CreateTable
CREATE TABLE "public"."entries" (
    "id" BIGSERIAL NOT NULL,
    "surface" TEXT NOT NULL,
    "type" "public"."EntryType" NOT NULL,
    "lang" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."readings" (
    "id" BIGSERIAL NOT NULL,
    "entryId" BIGINT NOT NULL,
    "jyutping" TEXT[] DEFAULT '{}'::text[],
    "tone" TEXT NOT NULL,
    "pronunciation" TEXT NOT NULL,
    "consonants" TEXT[] DEFAULT '{}'::text[],
    "rhymes" TEXT[] DEFAULT '{}'::text[],
    "syllables" INTEGER NOT NULL,
    "freq" DOUBLE PRECISION NOT NULL,
    "pos" TEXT NOT NULL,
    "register" TEXT NOT NULL,
    "gloss" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."feedback" (
    "id" BIGSERIAL NOT NULL,
    "readingId" BIGINT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "sessionId" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entries_type_surface_idx" ON "public"."entries"("type", "surface");

-- CreateIndex
CREATE INDEX "entries_lang_type_idx" ON "public"."entries"("lang", "type");

-- CreateIndex
CREATE INDEX "readings_pronunciation_idx" ON "public"."readings"("pronunciation");
-- GIN indexes for array containment searches (rhyme/initial lookups)
CREATE INDEX "readings_rhymes_gin_idx" ON "public"."readings" USING GIN ("rhymes");
CREATE INDEX "readings_consonants_gin_idx" ON "public"."readings" USING GIN ("consonants");

-- CreateIndex
CREATE INDEX "readings_syllables_idx" ON "public"."readings"("syllables");

-- CreateIndex
CREATE INDEX "readings_freq_idx" ON "public"."readings"("freq");

-- CreateIndex
CREATE INDEX "feedback_readingId_idx" ON "public"."feedback"("readingId");

-- CreateIndex
CREATE INDEX "feedback_sessionId_idx" ON "public"."feedback"("sessionId");

-- CreateIndex
CREATE INDEX "feedback_createdAt_idx" ON "public"."feedback"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."readings" ADD CONSTRAINT "readings_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "public"."entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."feedback" ADD CONSTRAINT "feedback_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "public"."readings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------
-- Lyrics data model
-- ------------------------------

-- CreateTable
CREATE TABLE "public"."songs" (
    "id" BIGSERIAL NOT NULL,
    "docId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "songs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."artists" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lyricists" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lyricists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."song_artists" (
    "songId" BIGINT NOT NULL,
    "artistId" BIGINT NOT NULL,

    CONSTRAINT "song_artists_pkey" PRIMARY KEY ("songId","artistId")
);

-- CreateTable
CREATE TABLE "public"."song_lyricists" (
    "songId" BIGINT NOT NULL,
    "lyricistId" BIGINT NOT NULL,

    CONSTRAINT "song_lyricists_pkey" PRIMARY KEY ("songId","lyricistId")
);

-- CreateTable
CREATE TABLE "public"."lyric_lines" (
    "id" BIGSERIAL NOT NULL,
    "lyricId" TEXT NOT NULL,
    "songId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "charCount" INTEGER NOT NULL,
    "paragraphId" TEXT,
    "prevLineId" TEXT,
    "nextLineId" TEXT,
    "sentiment" TEXT,
    "syntaxNotes" TEXT,
    "syllableCount" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "tonePatternText" TEXT NOT NULL,
    "jyutpingCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lyric_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."themes" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lyric_themes" (
    "lyricId" BIGINT NOT NULL,
    "themeId" BIGINT NOT NULL,

    CONSTRAINT "lyric_themes_pkey" PRIMARY KEY ("lyricId","themeId")
);

-- CreateTable
CREATE TABLE "public"."keywords" (
    "id" BIGSERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lyric_keywords" (
    "lyricId" BIGINT NOT NULL,
    "keywordId" BIGINT NOT NULL,

    CONSTRAINT "lyric_keywords_pkey" PRIMARY KEY ("lyricId","keywordId")
);

-- CreateTable
CREATE TABLE "public"."tokens" (
    "id" BIGSERIAL NOT NULL,
    "lyricId" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "pos" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."syllables" (
    "id" BIGSERIAL NOT NULL,
    "lyricId" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,
    "jyutping" TEXT NOT NULL,
    "consonant" TEXT,
    "rhyme" TEXT,
    "toneRaw" INTEGER,
    "toneDigit" INTEGER,
    "char" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syllables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tone_ngrams" (
    "id" BIGSERIAL NOT NULL,
    "lyricId" BIGINT NOT NULL,
    "n" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "syllableCount" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tone_ngrams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "songs_docId_key" ON "public"."songs"("docId");

-- CreateIndex
CREATE UNIQUE INDEX "artists_name_key" ON "public"."artists"("name");

-- CreateIndex
CREATE UNIQUE INDEX "lyricists_name_key" ON "public"."lyricists"("name");

-- CreateIndex
CREATE UNIQUE INDEX "lyric_lines_lyricId_key" ON "public"."lyric_lines"("lyricId");

-- CreateIndex
CREATE INDEX "lyric_lines_songId_idx" ON "public"."lyric_lines"("songId");

-- CreateIndex
CREATE INDEX "lyric_lines_lineIndex_idx" ON "public"."lyric_lines"("lineIndex");

-- CreateIndex
CREATE INDEX "lyric_lines_sentiment_idx" ON "public"."lyric_lines"("sentiment");

-- CreateIndex
CREATE UNIQUE INDEX "themes_name_key" ON "public"."themes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_word_key" ON "public"."keywords"("word");

-- CreateIndex
CREATE INDEX "tokens_lyricId_position_idx" ON "public"."tokens"("lyricId", "position");

-- CreateIndex
CREATE INDEX "syllables_lyricId_position_idx" ON "public"."syllables"("lyricId", "position");

-- CreateIndex
CREATE INDEX "syllables_rhyme_idx" ON "public"."syllables"("rhyme");

-- CreateIndex
CREATE INDEX "syllables_toneDigit_idx" ON "public"."syllables"("toneDigit");

-- CreateIndex
CREATE INDEX "tone_ngrams_lyricId_idx" ON "public"."tone_ngrams"("lyricId");

-- CreateIndex
CREATE INDEX "tone_ngrams_n_value_idx" ON "public"."tone_ngrams"("n", "value");

-- CreateIndex
CREATE INDEX "tone_ngrams_position_idx" ON "public"."tone_ngrams"("position");

-- CreateIndex
CREATE INDEX "tone_ngrams_syllableCount_tokenCount_idx" ON "public"."tone_ngrams"("syllableCount", "tokenCount");

-- AddForeignKey
ALTER TABLE "public"."song_artists" ADD CONSTRAINT "song_artists_songId_fkey" FOREIGN KEY ("songId") REFERENCES "public"."songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."song_artists" ADD CONSTRAINT "song_artists_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "public"."artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."song_lyricists" ADD CONSTRAINT "song_lyricists_songId_fkey" FOREIGN KEY ("songId") REFERENCES "public"."songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."song_lyricists" ADD CONSTRAINT "song_lyricists_lyricistId_fkey" FOREIGN KEY ("lyricistId") REFERENCES "public"."lyricists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lyric_lines" ADD CONSTRAINT "lyric_lines_songId_fkey" FOREIGN KEY ("songId") REFERENCES "public"."songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lyric_themes" ADD CONSTRAINT "lyric_themes_lyricId_fkey" FOREIGN KEY ("lyricId") REFERENCES "public"."lyric_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lyric_themes" ADD CONSTRAINT "lyric_themes_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "public"."themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lyric_keywords" ADD CONSTRAINT "lyric_keywords_lyricId_fkey" FOREIGN KEY ("lyricId") REFERENCES "public"."lyric_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lyric_keywords" ADD CONSTRAINT "lyric_keywords_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "public"."keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tokens" ADD CONSTRAINT "tokens_lyricId_fkey" FOREIGN KEY ("lyricId") REFERENCES "public"."lyric_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."syllables" ADD CONSTRAINT "syllables_lyricId_fkey" FOREIGN KEY ("lyricId") REFERENCES "public"."lyric_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tone_ngrams" ADD CONSTRAINT "tone_ngrams_lyricId_fkey" FOREIGN KEY ("lyricId") REFERENCES "public"."lyric_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create the test database
DROP DATABASE IF EXISTS cantolyr_test;
CREATE DATABASE cantolyr_test;

-- Grant permissions to the cantolyr user for both databases
GRANT ALL PRIVILEGES ON DATABASE cantolyr TO cantolyr;
GRANT ALL PRIVILEGES ON DATABASE cantolyr_test TO cantolyr;
