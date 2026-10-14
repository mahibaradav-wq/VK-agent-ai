export type PublishInput = {
  platform: string;
  workspaceId: string;
  postId: string;
  targetId: string;
  versionId: string;
  title: string;
  body: string;
  mediaKeys: string[];
};

export type PublishOutcome =
  | { kind: "success"; externalId?: string }
  | { kind: "temporary_failure"; code: string; message: string }
  | { kind: "permanent_failure"; code: string; message: string }
  | { kind: "unknown"; code: string; message: string };

export type SocialAdapter = {
  platform: string;
  publish: (input: PublishInput) => Promise<PublishOutcome>;
};

export type AdapterRegistry = {
  get: (platform: string) => SocialAdapter;
};
