-- CreateEnum
CREATE TYPE "capsule_status" AS ENUM ('SCHEDULED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passhash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsules" (
    "id" UUID NOT NULL,
    "id_creator" UUID NOT NULL,
    "title_content" TEXT NOT NULL,
    "text_content" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "schedule_date" TIMESTAMP(3) NOT NULL,
    "status" "capsule_status" NOT NULL DEFAULT 'SCHEDULED',
    "token" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capsules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsule_files" (
    "id" UUID NOT NULL,
    "id_capsule" UUID NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capsule_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "capsules_token_key" ON "capsules"("token");

-- CreateIndex
CREATE INDEX "capsules_status_schedule_date_idx" ON "capsules"("status", "schedule_date");

-- CreateIndex
CREATE INDEX "capsules_id_creator_idx" ON "capsules"("id_creator");

-- CreateIndex
CREATE UNIQUE INDEX "capsule_files_object_key_key" ON "capsule_files"("object_key");

-- CreateIndex
CREATE INDEX "capsule_files_id_capsule_idx" ON "capsule_files"("id_capsule");

-- AddForeignKey
ALTER TABLE "capsules" ADD CONSTRAINT "capsules_id_creator_fkey" FOREIGN KEY ("id_creator") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_files" ADD CONSTRAINT "capsule_files_id_capsule_fkey" FOREIGN KEY ("id_capsule") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
