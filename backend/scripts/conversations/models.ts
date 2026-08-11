import { EMBEDDING_MODEL, MEMORY_MODEL } from "../../src/long-term-memory/index.js";
import { cheapModelFromEnv, modelFromEnv, smartModelFromEnv } from "../../src/model.js";

export interface ModelSelections {
  responseModel: string;
  simulatorModel: string;
  memoryModel: string;
  embeddingModel: string;
  cheapModel: string;
  smartModel: string;
}

export function collectModelSelections(simulatorModel: string): ModelSelections {
  return {
    responseModel: modelFromEnv(),
    simulatorModel,
    memoryModel: MEMORY_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    cheapModel: cheapModelFromEnv(),
    smartModel: smartModelFromEnv(),
  };
}

export function renderModelSelections(selections: ModelSelections): string[] {
  return [
    `- **Response model:** ${selections.responseModel}`,
    `- **Simulator model:** ${selections.simulatorModel}`,
    `- **Memory extraction model:** ${selections.memoryModel}`,
    `- **Embedding model:** ${selections.embeddingModel}`,
    `- **Cheap tier:** ${selections.cheapModel}`,
    `- **Smart tier:** ${selections.smartModel}`,
  ];
}
