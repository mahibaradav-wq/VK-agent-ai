export const aiKinds = ["ideas", "post", "headline", "cta", "hashtags"] as const;
export type AiKind = (typeof aiKinds)[number];

export const aiTones = ["neutral", "friendly", "expert", "playful"] as const;
export type AiTone = (typeof aiTones)[number];

export const aiLengths = ["short", "medium", "long"] as const;
export type AiLength = (typeof aiLengths)[number];

export type AiGenerateInput = {
  kind: AiKind;
  prompt: string;
  tone: AiTone;
  length: AiLength;
  platform: string;
};

export type AiGenerateOutput = {
  title: string;
  body: string;
  items: string[];
  raw: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type AiProvider = {
  name: string;
  model: string;
  ready: boolean;
  generate: (input: AiGenerateInput) => Promise<AiGenerateOutput>;
};
