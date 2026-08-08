import { z } from "zod";

const chatKindSchema = z.enum(["private", "group", "supergroup"]);
const replyRelationshipSchema = z.object({
  messageId: z.number().int(),
  senderId: z.number().int(),
  senderDisplayName: z.string().min(1),
  isHevronia: z.boolean(),
}).strict();

export const observedTelegramMessageSchema = z.object({
  kind: z.literal("participant"),
  messageId: z.number().int(),
  senderId: z.number().int().positive(),
  senderDisplayName: z.string().min(1),
  chatKind: chatKindSchema,
  text: z.string(),
  replyTo: replyRelationshipSchema.nullable(),
  directlyAddressed: z.boolean(),
}).strict();

export const deliveredHevroniaMessageSchema = z.object({
  kind: z.literal("hevronia"),
  messageId: z.number().int(),
  senderId: z.number().int().positive(),
  senderDisplayName: z.literal("Хевронія"),
  chatKind: chatKindSchema,
  text: z.string().min(1),
  replyToMessageId: z.number().int(),
}).strict();

export const canonicalTelegramEventSchema = z.discriminatedUnion("kind", [
  observedTelegramMessageSchema,
  deliveredHevroniaMessageSchema,
]);

export type ObservedTelegramMessage = z.infer<typeof observedTelegramMessageSchema>;
export type DeliveredHevroniaMessage = z.infer<typeof deliveredHevroniaMessageSchema>;
export type CanonicalTelegramEvent = z.infer<typeof canonicalTelegramEventSchema>;

export function serializeTelegramEvent(event: CanonicalTelegramEvent): string {
  return JSON.stringify(event);
}

export function deserializeTelegramEvent(serialized: string): CanonicalTelegramEvent {
  return canonicalTelegramEventSchema.parse(JSON.parse(serialized));
}

export function renderTelegramEvent(event: CanonicalTelegramEvent): string {
  const identity = `${event.senderDisplayName} [telegram-user:${event.senderId}]`;
  const reply = event.kind === "participant" && event.replyTo !== null
    ? ` (reply to ${event.replyTo.senderDisplayName} [telegram-user:${event.replyTo.senderId}], message ${event.replyTo.messageId})`
    : "";
  const direct = event.kind === "participant" && event.directlyAddressed
    ? " [directly addressing Хевронія]"
    : "";
  return `[message ${event.messageId}] ${identity}${reply}${direct}: ${event.text}`;
}
