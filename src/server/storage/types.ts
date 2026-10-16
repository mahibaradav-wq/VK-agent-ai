export type StoredObject = {
  key: string;
  driver: "local" | "s3";
};

export type StorageDriver = {
  driver: "local" | "s3" | "unconfigured";
  ready: boolean;
  setupMessage?: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
};
