CREATE TABLE "capsule_contributions" (
    "id" UUID NOT NULL,
    "id_capsule" UUID NOT NULL,
    "id_author" UUID NOT NULL,
    "text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capsule_contributions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capsule_contributions_id_capsule_fkey" FOREIGN KEY ("id_capsule") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "capsule_contributions_id_author_fkey" FOREIGN KEY ("id_author") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "capsule_contributions_id_capsule_created_at_idx" ON "capsule_contributions"("id_capsule", "created_at");
CREATE INDEX "capsule_contributions_id_author_idx" ON "capsule_contributions"("id_author");

ALTER TABLE "capsule_files"
    ADD COLUMN "id_contribution" UUID,
    ADD CONSTRAINT "capsule_files_id_contribution_fkey" FOREIGN KEY ("id_contribution") REFERENCES "capsule_contributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "capsule_files_id_contribution_idx" ON "capsule_files"("id_contribution");
