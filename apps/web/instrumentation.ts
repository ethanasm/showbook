export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBoss, registerAllJobs } = await import('@showbook/jobs');

    try {
      const boss = await startBoss();
      await registerAllJobs(boss);
    } catch (error) {
      console.error('Failed to start pg-boss:', error);
    }
  }
}
