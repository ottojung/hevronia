const EXPECTED_NAME = "Хевронія";
const EXPECTED_USERNAME = "hevronia_bot";

export interface TelegramBotIdentity {
  id: number;
  first_name: string;
  username?: string;
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
}
