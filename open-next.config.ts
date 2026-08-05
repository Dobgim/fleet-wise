import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext turns the Next.js build output into a Cloudflare Worker.
 *
 * Defaults are deliberate: no incremental-cache or tag-cache bindings are
 * configured because nothing in MotorWise uses ISR — every page is either
 * static or rendered per request against the signed-in user's data.
 */
export default defineCloudflareConfig();
