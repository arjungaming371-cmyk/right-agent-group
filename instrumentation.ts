// Next.js instrumentation hook — runs once when the server process starts,
// before any request is handled. Used to boot the in-app cron scheduler
// (see lib/scheduler.ts) so scheduled jobs work on any platform this app
// runs on, not just Windows (where DIGEST.ps1's Task Scheduler lives).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler")
    startScheduler()
  }
}
