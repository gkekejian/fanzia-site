import "dotenv/config";
import { runDeployTasks } from "@/lib/startup";

/**
 * Build step: `npm run build` runs this before `next build`.
 *
 * Only migrates when this is a production deploy (VERCEL_ENV=production)
 * or when RUN_DEPLOY_TASKS=1 is set explicitly. Preview deployments often
 * share the production DATABASE_URL on small Vercel setups; letting every
 * feature branch migrate the production schema is how you end up with a
 * half-applied migration from a branch you never merged.
 */
async function main() {
  const shouldRun = process.env.VERCEL_ENV === "production" || process.env.RUN_DEPLOY_TASKS === "1";
  if (!shouldRun) {
    console.log(`[deploy] skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
    return;
  }
  await runDeployTasks();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
