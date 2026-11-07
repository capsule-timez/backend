CREATE TYPE "capsule_type" AS ENUM ('INDIVIDUAL', 'GROUP');
CREATE TYPE "capsule_member_role" AS ENUM ('OWNER', 'MEMBER');

ALTER TABLE "capsules"
    ADD COLUMN "type" "capsule_type" NOT NULL DEFAULT 'INDIVIDUAL',
    ADD COLUMN "contribution_deadline" TIMESTAMP(3),
    ADD COLUMN "invite_code" TEXT,
    ADD CONSTRAINT "capsules_group_fields_check" CHECK (
        ("type" = 'INDIVIDUAL' AND "contribution_deadline" IS NULL AND "invite_code" IS NULL)
        OR ("type" = 'GROUP' AND "contribution_deadline" IS NOT NULL AND "invite_code" IS NOT NULL)
    );

CREATE UNIQUE INDEX "capsules_invite_code_key" ON "capsules"("invite_code");

CREATE TABLE "capsule_members" (
    "id_capsule" UUID NOT NULL,
    "id_user" UUID NOT NULL,
    "role" "capsule_member_role" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capsule_members_pkey" PRIMARY KEY ("id_capsule", "id_user"),
    CONSTRAINT "capsule_members_id_capsule_fkey" FOREIGN KEY ("id_capsule") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "capsule_members_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "capsule_members_id_user_idx" ON "capsule_members"("id_user");
