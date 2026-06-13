import { DiscordHono } from "discord-hono";
import * as handlers from "./handlers";
import { handleScheduled } from "./handlers/scheduled";
import type { Env } from "./lib/types";

const createApp = (env?: Env) => {
  const app = new DiscordHono<{ Bindings: Env }>({
    verify:
      env?.DISABLE_SIGNATURE_VERIFICATION === "true"
        ? async (_body, signature, timestamp) => Boolean(signature && timestamp)
        : undefined,
  });

  app.command("schedule", handlers.handlerScheduleRecruit);
  app.command("schedule", handlers.handlerScheduleSettings);
  app.command("riot", handlers.handlerRiotAccountAdd);
  app.command("riot", handlers.handlerRiotAccountRemove);
  app.command("riot", handlers.handlerRiotAccountList);

  app.component("recruit:join", handlers.handlerRecruitJoin);
  app.component("recruit:time", handlers.handlerRecruitTime);
  app.component("recruit:cancel", handlers.handlerRecruitCancel);
  app.component("recruit:delete", handlers.handlerRecruitDelete);

  return app;
};

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    return createApp(env).fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env));
  },
};
