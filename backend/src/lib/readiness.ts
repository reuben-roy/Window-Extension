import { prisma } from './prisma.js';

/**
 * Newest checked-in migration. A test keeps this in step with
 * `prisma/migrations`, so a release that adds a migration cannot report ready
 * until `prisma migrate deploy` has been run against its database.
 */
export const LATEST_MIGRATION = '20260911000000_quiz_deepdive_skillid';

export interface ReadinessReport {
  ok: boolean;
  database: boolean;
  migrations: {
    latest: string;
    latestApplied: boolean;
    failed: string[];
  };
  jobs: {
    queued: number;
    running: number;
    oldestQueuedSeconds: number | null;
  };
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

interface JobCountRow {
  queued: number;
  running: number;
  oldest_queued: Date | null;
}

export function evaluateMigrations(rows: readonly MigrationRow[]): ReadinessReport['migrations'] {
  const failed = rows
    .filter((row) => !row.finished_at && !row.rolled_back_at)
    .map((row) => row.migration_name);
  const latestApplied = rows.some(
    (row) => row.migration_name === LATEST_MIGRATION && row.finished_at && !row.rolled_back_at,
  );

  return { latest: LATEST_MIGRATION, latestApplied, failed };
}

export async function checkReadiness(now = new Date()): Promise<ReadinessReport> {
  const migrationRows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
  `;
  const migrations = evaluateMigrations(migrationRows);

  const [counts] = await prisma.$queryRaw<JobCountRow[]>`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0)::int AS queued,
      COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0)::int AS running,
      MIN(CASE WHEN status = 'queued' THEN "createdAt" END) AS oldest_queued
    FROM (
      SELECT status::text AS status, "createdAt" FROM "ResearchJob"
      UNION ALL SELECT status::text, "createdAt" FROM "AssistantTaskJob"
      UNION ALL SELECT status::text, "createdAt" FROM "LearningJob"
    ) AS jobs
  `;

  return {
    ok: migrations.latestApplied && migrations.failed.length === 0,
    database: true,
    migrations,
    jobs: {
      queued: counts?.queued ?? 0,
      running: counts?.running ?? 0,
      oldestQueuedSeconds: counts?.oldest_queued
        ? Math.max(0, Math.round((now.getTime() - counts.oldest_queued.getTime()) / 1000))
        : null,
    },
  };
}
