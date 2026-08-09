import type { ConversationLayer } from "../../src/conversation-types.js";

export type ScenarioCategory =
  | "normal"
  | "humor"
  | "friendship"
  | "romance"
  | "vulnerability"
  | "conflict"
  | "boundaries"
  | "manipulation"
  | "opinions"
  | "self"
  | "repair"
  | "meta"
  | "long";

export type ParticipantGrammar = "feminine" | "masculine";

export interface ConversationScenario {
  id: string;
  title: string;
  category: ScenarioCategory;
  purpose: string;
  participantName: string;
  participantDescription: string;
  participantGrammar: ParticipantGrammar;
  simulatorInstructions: string;
  rounds: number;
  smoke: boolean;
  behaviorTags: readonly string[];
  longTermMemory?: readonly string[];
}

export type TranscriptEntry =
  | { speaker: "participant"; text: string }
  | { speaker: "hevronia"; text: string }
  | { speaker: "hevronia"; silence: true };

export interface Simulator {
  nextMessage(scenario: ConversationScenario, transcript: readonly TranscriptEntry[]): Promise<string>;
}

export interface ScenarioDependencies {
  simulator: Simulator;
  createLayer(): Promise<ConversationLayer> | ConversationLayer;
  print(line: string): void;
}

export type ScenarioStoppingReason =
  | "round limit reached"
  | "stopped after several consecutive silences";

export type ScenarioResult =
  | {
      status: "completed";
      scenario: ConversationScenario;
      transcript: TranscriptEntry[];
      roundsCompleted: number;
      stoppingReason: ScenarioStoppingReason;
    }
  | {
      status: "failed";
      scenario: ConversationScenario;
      transcript: TranscriptEntry[];
      roundsCompleted: number;
      failure: string;
    };

export function completedScenarioResult(
  scenario: ConversationScenario,
  transcript: TranscriptEntry[],
  roundsCompleted: number,
  stoppingReason: ScenarioStoppingReason,
): ScenarioResult {
  return { status: "completed", scenario, transcript, roundsCompleted, stoppingReason };
}

export function failedScenarioResult(
  scenario: ConversationScenario,
  transcript: TranscriptEntry[],
  roundsCompleted: number,
  failure: string,
): ScenarioResult {
  return { status: "failed", scenario, transcript, roundsCompleted, failure };
}
