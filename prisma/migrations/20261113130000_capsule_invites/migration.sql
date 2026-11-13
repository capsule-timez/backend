-- CreateEnum
CREATE TYPE "capsule_invite_status" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateTable
CREATE TABLE "capsule_invites" (
    "id" UUID NOT NULL,
    "id_capsule" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "capsule_invite_status" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "id_invited_by" UUID NOT NULL,
    "id_accepted_by" UUID,
    "accepted_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capsule_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "capsule_invites_token_hash_key" ON "capsule_invites"("token_hash");

-- CreateIndex
CREATE INDEX "capsule_invites_id_invited_by_idx" ON "capsule_invites"("id_invited_by");

-- CreateIndex
CREATE INDEX "capsule_invites_id_accepted_by_idx" ON "capsule_invites"("id_accepted_by");

-- CreateIndex
CREATE UNIQUE INDEX "capsule_invites_id_capsule_email_key" ON "capsule_invites"("id_capsule", "email");

-- AddForeignKey
ALTER TABLE "capsule_invites" ADD CONSTRAINT "capsule_invites_id_capsule_fkey" FOREIGN KEY ("id_capsule") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_invites" ADD CONSTRAINT "capsule_invites_id_invited_by_fkey" FOREIGN KEY ("id_invited_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_invites" ADD CONSTRAINT "capsule_invites_id_accepted_by_fkey" FOREIGN KEY ("id_accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

