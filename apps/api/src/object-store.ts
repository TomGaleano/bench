import { createObjectStore, type JsonValue } from "@pilab/object-store";

export type ApiObjectStore = ReturnType<typeof createObjectStore>;

export function createApiObjectStore(): ApiObjectStore {
  return createObjectStore({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:59000",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
    bucket: process.env.S3_BUCKET ?? "pilab-artifacts",
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
  });
}

export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
