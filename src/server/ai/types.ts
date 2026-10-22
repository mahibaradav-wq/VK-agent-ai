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

export type AiImageSize = "1024x1024";

export type AiImageInput = {
  prompt: string;
  size?: AiImageSize;
};

export type AiImageOutput = {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  provider: string;
  model: string;
};

export type AiProvider = {
  name: string;
  model: string;
  imageModel: string;
  ready: boolean;
  imageReady: boolean;
  generate: (input: AiGenerateInput) => Promise<AiGenerateOutput>;
  generateImage: (input: AiImageInput) => Promise<AiImageOutput>;
};
