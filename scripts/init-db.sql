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
    "jyutping" TEXT NOT NULL,
    "toneOriginal" TEXT NOT NULL,
    "toneMapped" TEXT NOT NULL,
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
CREATE INDEX "readings_toneMapped_idx" ON "public"."readings"("toneMapped");

-- CreateIndex
CREATE INDEX "readings_toneMapped_syllables_idx" ON "public"."readings"("toneMapped", "syllables");

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

-- Create the test database
CREATE DATABASE cantolyr_test;

-- Grant permissions to the cantolyr user for both databases
GRANT ALL PRIVILEGES ON DATABASE cantolyr TO cantolyr;
GRANT ALL PRIVILEGES ON DATABASE cantolyr_test TO cantolyr;
