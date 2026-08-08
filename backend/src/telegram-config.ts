const EXPECTED_NAME = "Хевронія";
const EXPECTED_USERNAME = "hevronia_bot";

export interface TelegramBotIdentity {
  id: number;
  first_name: string;
  username?: string;
  can_read_all_group_messages?: boolean;
}

export class MissingGroupMessageAccessError extends Error {
  constructor() {
    super("Telegram Group Privacy Mode is enabled. Disable it with BotFather and re-add the bot to groups before starting Хевронія.");
    this.name = "MissingGroupMessageAccessError";
  }
}

export function isMissingGroupMessageAccessError(
  error: unknown,
): error is MissingGroupMessageAccessError {
  return error instanceof MissingGroupMessageAccessError;
}

export function tokenFromEnv(): string {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not set in the environment. " +
        "Provide the bot token before starting the bot.",
    );
  }
  return token;
}

export function logBotIdentity(me: TelegramBotIdentity): void {
  console.log(
    `Authenticated with Telegram: id=${me.id}, name="${me.first_name}", username=@${me.username}`,
  );
  if (me.first_name !== EXPECTED_NAME || me.username !== EXPECTED_USERNAME) {
    console.warn(
      `Unexpected bot identity — expected "${EXPECTED_NAME}" / @${EXPECTED_USERNAME}, ` +
        `got "${me.first_name}" / @${me.username}`,
    );
  }
  if (me.can_read_all_group_messages !== true) {
    throw new MissingGroupMessageAccessError();
  }
}
