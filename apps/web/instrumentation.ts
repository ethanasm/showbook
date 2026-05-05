export async function register() {
  // Gate node-only imports inside the `=== 'nodejs'` form so Next's
  // bundler statically excludes `pg` / `pg-boss` from the edge bundle.
  // The `!== 'nodejs' return` shape is not recognised the same way and
  // causes the edge build to try to resolve `fs`.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logger, flushObservability } = await import('@showbook/observability');
    const { startBoss, registerAllJobs } = await import('@showbook/jobs');

    try {
      const boss = await startBoss();
      await registerAllJobs(boss);
      logger.info(
        { event: 'pgboss.boot.ok' },
        'pg-boss started and jobs registered',
      );
    } catch (err) {
      // Total background-pipeline failure: nothing else will alert on it
      // (the health-check job itself can't run if pg-boss didn't start),
      // so emit a structured event and flush so it reaches Axiom before
      // the web process moves on. Don't re-throw — a degraded web is
      // strictly better than a crashed web.
      logger.error(
        { event: 'pgboss.boot.failed', err },
        'Failed to start pg-boss',
      );
      await flushObservability();
    }
  }
}
