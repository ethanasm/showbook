// Counts how many times Next.js invokes `register()` in this process.
// Prod logs in 2026-05 showed every scheduled cron firing two
// `job.start` events with two distinct jobIds — strongly suggesting
// `boss.work(name, handler)` was registered twice per queue. The
// counter (logged on every call as `pgboss.register.invoked`) lets
// Axiom answer "is Next.js calling this twice in the same process?"
// independently of whether `registerAllJobs` itself dedupes.
let registerCallCount = 0;

export async function register() {
  // Gate node-only imports inside the `=== 'nodejs'` form so Next's
  // bundler statically excludes `pg` / `pg-boss` from the edge bundle.
  // The `!== 'nodejs' return` shape is not recognised the same way and
  // causes the edge build to try to resolve `fs`.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logger, flushObservability } = await import('@showbook/observability');
    const { startBoss, stopBoss, registerAllJobs } = await import('@showbook/jobs');

    registerCallCount += 1;
    logger.info(
      { event: 'pgboss.register.invoked', call: registerCallCount, runtime: process.env.NEXT_RUNTIME },
      `instrumentation.register() invocation #${registerCallCount}`,
    );

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

    // Without graceful shutdown, jobs that are mid-handler when the
    // container dies stay in `pgboss.job` with state='active' until
    // expire-maintenance times them out (queue `expireInSeconds`, set
    // in registry.ts). For users of the Spotify importer that meant
    // the per-artist "still importing" bullet stayed lit for minutes
    // after each deploy that landed during their import. `boss.stop`
    // with `graceful: true` waits for in-flight handlers to finish,
    // then `failWip()` releases anything still running so it retries
    // immediately on next boot rather than waiting for expire.
    //
    // Docker's default SIGTERM-to-SIGKILL grace is 10 s; we cap at
    // 8 s so flushObservability still has time to drain. The compose
    // files set `stop_grace_period: 30s` to give us headroom.
    const shutdown = async (signal: NodeJS.Signals) => {
      logger.info({ event: 'pgboss.shutdown.start', signal }, 'pg-boss shutdown initiated');
      try {
        await stopBoss({ graceful: true, timeout: 8000 });
        logger.info({ event: 'pgboss.shutdown.complete' }, 'pg-boss stopped');
      } catch (err) {
        logger.error({ event: 'pgboss.shutdown.failed', err }, 'pg-boss shutdown failed');
      }
      await flushObservability();
    };

    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  }
}
