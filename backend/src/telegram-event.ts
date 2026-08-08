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
  targetText: z.string().nullable(),
}).strict();

export const observedTelegramMessageSchema = z.object({
  kind: z.literal("participant"),
  messageId: z.number().int(),
  sender: telegramSenderIdentitySchema,
  senderDisplayName: z.string().min(1),
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

export function renderTelegramEvent(event: CanonicalTelegramEvent): string {
  const identity = `${event.senderDisplayName} [telegram-${event.sender.kind}:${event.sender.id}]`;
  const reply = event.replyTo !== null
    ? ` (reply to ${event.replyTo.targetSenderDisplayName} [telegram-${event.replyTo.targetSender.kind}:${event.replyTo.targetSender.id}], message ${event.replyTo.targetMessageId}: ${event.replyTo.targetText ?? "text unavailable"})`
    : "";
  const direct = event.kind === "participant" && event.directlyAddressed
    ? " [directly addressing Хевронія]"
    : "";
  return `[message ${event.messageId}] ${identity}${reply}${direct}: ${event.text}`;
}
