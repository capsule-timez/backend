import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

test('group capsule migration preserves existing capsules', {
  skip: !databaseUrl && 'Set MIGRATION_TEST_DATABASE_URL and make psql available to run this test.',
}, () => {
  const schema = `migration_test_${randomBytes(8).toString('hex')}`;
  const initialMigration = readFileSync('prisma/migrations/20260928185912_init/migration.sql', 'utf8');
  const groupMigration = readFileSync('prisma/migrations/20261106120000_group_capsules/migration.sql', 'utf8');
  execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl!], {
    input: `
      BEGIN;
      CREATE SCHEMA ${schema};
      SET LOCAL search_path TO ${schema};
      ${initialMigration}
      INSERT INTO users (id, name, email, passhash)
      VALUES ('00000000-0000-0000-0000-000000000001', 'Owner', 'owner@example.com', 'test');
      INSERT INTO capsules (id, id_creator, title_content, text_content, recipient_email, schedule_date, token)
      VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
        'Existing title', 'Existing text', 'recipient@example.com', '2030-01-01', 'existing-token');
      CREATE TEMP TABLE original_capsule AS SELECT * FROM capsules;
      ${groupMigration}
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT FROM capsules c JOIN original_capsule o USING (id)
          WHERE to_jsonb(c) - ARRAY['type', 'contribution_deadline', 'invite_code'] = to_jsonb(o)
            AND c.type = 'INDIVIDUAL' AND c.contribution_deadline IS NULL AND c.invite_code IS NULL
        ) OR EXISTS (SELECT FROM capsule_members) THEN
          RAISE EXCEPTION 'Existing capsule was changed by the group capsule migration';
        END IF;
      END $$;
      ROLLBACK;
    `,
  });
});
