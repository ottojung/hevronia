import { z } from "zod";

const chatKindSchema = z.enum(["private", "group", "supergroup"]);
export const telegramSenderIdentitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("chat"), id: z.number().int() }).strict(),
]);
export const replyRelationshipSchema = z.object({
  targetMessageId: z.number().int(),
  targetSender: telegramSenderIdentitySchema,
  targetSenderDisplayName: z.string().min(1),
  targetSenderUsername: z.string().nullable().default(null),
  targetText: z.string().nullable(),
  // Canonical flag from the observation pipeline: whether the reply targets
  // Хевронія herself. Never inferred from the display name.
  targetIsHevronia: z.boolean(),
}).strict();

export const observedTelegramMessageSchema = z.object({
  kind: z.literal("participant"),
  messageId: z.number().int(),
  sender: telegramSenderIdentitySchema,
  senderDisplayName: z.string().min(1),
  senderUsername: z.string().nullable().default(null),
  chatKind: chatKindSchema,
  text: z.string(),
  messageThreadId: z.number().int().positive().nullable(),
  replyTo: replyRelationshipSchema.nullable(),
  directlyAddressed: z.boolean(),
}).strict();

export const deliveredHevroniaMessageSchema = z.object({
  kind: z.literal("hevronia"),
  messageId: z.number().int(),
  sender: telegramSenderIdentitySchema,
  senderDisplayName: z.literal("Хевронія"),
  senderUsername: z.string().nullable().default(null),
  chatKind: chatKindSchema,
  text: z.string().min(1),
  messageThreadId: z.number().int().positive().nullable(),
  replyTo: replyRelationshipSchema.nullable(),
}).strict();

export const canonicalTelegramEventSchema = z.discriminatedUnion("kind", [
  observedTelegramMessageSchema,
  deliveredHevroniaMessageSchema,
]);

export type ObservedTelegramMessage = z.infer<typeof observedTelegramMessageSchema>;
export type DeliveredHevroniaMessage = z.infer<typeof deliveredHevroniaMessageSchema>;
export type CanonicalTelegramEvent = z.infer<typeof canonicalTelegramEventSchema>;
export type ReplyRelationship = z.infer<typeof replyRelationshipSchema>;
export type TelegramSenderIdentity = z.infer<typeof telegramSenderIdentitySchema>;

export function serializeTelegramEvent(event: CanonicalTelegramEvent): string {
  return JSON.stringify(event);
}

export function deserializeTelegramEvent(serialized: string): CanonicalTelegramEvent {
  return canonicalTelegramEventSchema.parse(JSON.parse(serialized));
}

/**
 * Notebook label for a Telegram sender: the ordinary private bookkeeping
 * Хевронія uses to tell recurring dream characters apart. Person-like
 * characters are "character N"; chats and channels are sources named
 * "channel N" with the sign of the internal Telegram id hidden.
 */
export function notebookSubject(sender: TelegramSenderIdentity): string {
  return sender.kind === "user" ? `character ${sender.id}` : `channel ${Math.abs(sender.id)}`;
}

/** Persisted natural names keyed by Telegram user id. */
export type NaturalNames = ReadonlyMap<number, string>;

/**
 * The dream label for a sender: the natural name for a user the notebook has
 * named, otherwise the stable notebook label ("character N" / "channel N").
 */
export function dreamSubject(sender: TelegramSenderIdentity, naturalNames: NaturalNames): string {
  if (sender.kind === "user") {
    return naturalNames.get(sender.id) ?? notebookSubject(sender);
  }
  return notebookSubject(sender);
}

export function notebookLabel(sender: TelegramSenderIdentity): string {
  return sender.kind === "user"
    ? `the character your notebook calls “character ${sender.id}”`
    : `the source your notebook calls “channel ${Math.abs(sender.id)}”`;
}
