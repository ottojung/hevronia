export interface TelegramTextEventInput {
  messageId: number;
  speakerName: string;
  text: string;
}

export function renderTelegramTextEvent(input: TelegramTextEventInput): string {
  return `[message ${input.messageId}] ${input.speakerName}: ${input.text}`;
}
