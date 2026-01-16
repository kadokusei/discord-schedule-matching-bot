export interface CommandOption {
  name: string;
  value?: string | number;
  options?: CommandOption[];
}

export interface InteractionBody {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    user?: {
      id: string;
    };
  };
  user?: {
    id: string;
  };
  data?: {
    name?: string;
    options?: CommandOption[];
    custom_id?: string;
    values?: string[];
  };
}

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  HENRIKDEV_API_KEY: string;
  DB: D1Database;
}
