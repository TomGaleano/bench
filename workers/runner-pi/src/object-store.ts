import { createObjectStore } from "@pilab/object-store";

export type PiRunnerObjectStore = ReturnType<typeof createObjectStore>;

export function createPiRunnerObjectStore(): PiRunnerObjectStore {
  return createObjectStore({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:59000",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin",
    bucket: process.env.S3_BUCKET ?? "pilab-artifacts",
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
  });
}
