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
  length: AiLength | "caption";
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

export const aiImageSizes = ["1024x1024", "1024x1536", "1536x1024"] as const;
export type AiImageSize = (typeof aiImageSizes)[number];

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
