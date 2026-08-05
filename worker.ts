/**
 * Cloudflare Worker entry point.
 *
 * OpenNext generates a Worker that only exports `fetch`. MotorWise also needs
 * a `scheduled` handler for the nightly maintenance reminders — the job that
 * used to run as a Vercel cron — so this file wraps the generated handler and
 * adds one.
 *
 * `.open-next/worker.js` does not exist until `opennextjs-cloudflare build`
 * has run, which is why it is excluded from tsconfig: type-checking the repo
 * from a clean checkout would otherwise fail on a file that is a build
 * artefact.
 */
// @ts-expect-error - generated at build time by opennextjs-cloudflare
import nextHandler from "./.open-next/worker.js";

interface Env {
  CRON_SECRET?: string;
  NEXT_PUBLIC_SITE_URL?: string;
}

type Handler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
};

const handler = nextHandler as Handler;

export default {
  fetch: handler.fetch,

  /**
   * Fired by the cron trigger in wrangler.jsonc.
   *
   * Rather than duplicate the reminder logic, this calls the existing route
   * through the same Worker. The route already authenticates with
   * CRON_SECRET and is idempotent — it claims each reminder in
   * reminder_item_log before sending — so a retry cannot email anyone twice.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const base = env.NEXT_PUBLIC_SITE_URL ?? "https://motorwise.co";
    const request = new Request(`${base}/api/cron/reminders`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET ?? ""}` },
    });

    ctx.waitUntil(
      handler
        .fetch(request, env, ctx)
        .then(async (res) => {
          const body = await res.text().catch(() => "");
          // Cron output is invisible unless logged; without this a silently
          // failing reminder job would look identical to a quiet night.
          console.log("cron reminders", event.cron, res.status, body.slice(0, 300));
        })
        .catch((err) => console.error("cron reminders failed", err))
    );
  },
};
