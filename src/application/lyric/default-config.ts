import { LinePipelineConfig } from "./SessionService.ts";

export function buildDefaultLinePipelineConfig(): LinePipelineConfig {
  return {
    retrieval: {
      semanticTarget: 0.8,
      freqTop: 100,
      freqRandom: 50,
      minSemanticThreshold: 0.3,
    },
    generation: {
      variantsPerPattern: 5,
      maxRetriesPerSentence: 2,
    },
    ranking: {
      topKSize: 3,
      mmrLambda: 0.5,
      similarityThreshold: 0.7,
    },
  };
}

export default buildDefaultLinePipelineConfig;
