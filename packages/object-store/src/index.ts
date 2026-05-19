import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";

export type ObjectStoreConfig = {
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
};

export type StoredArtifact = {
  key: string;
  bucket: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type PutJsonArtifactInput = {
  value: JsonValue;
  key?: string;
  keyPrefix?: string;
  contentType?: string;
  metadata?: Record<string, string>;
};

const jsonContentType = "application/json";
const defaultJsonKeyPrefix = "artifacts/json";

export function stringifyJsonDeterministic(value: JsonValue): string {
  return JSON.stringify(normalizeJsonValue(value));
}

function normalizeJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON artifacts cannot contain non-finite numbers");
    }

    return value;
  }

  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, normalizeJsonValue(item)]),
    );
  }

  return null;
}

function buildJsonArtifactKey(input: {
  key?: string;
  keyPrefix?: string;
  sha256: string;
}) {
  if (input.key) {
    return input.key;
  }

  const prefix = (input.keyPrefix ?? defaultJsonKeyPrefix).replace(/^\/+|\/+$/g, "");
  const fileName = `${input.sha256}.json`;

  return prefix ? `${prefix}/${fileName}` : fileName;
}

export function createObjectStore(config: ObjectStoreConfig) {
  const clientConfig = {
    region: config.region ?? "us-east-1",
    forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  };

  const client = new S3Client(clientConfig);

  async function ensureBucket(): Promise<void> {
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      return;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  }

  async function putArtifact(input: {
    key: string;
    body: string | Uint8Array;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<StoredArtifact> {
    const bytes =
      typeof input.body === "string"
        ? new TextEncoder().encode(input.body)
        : input.body;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const contentType = input.contentType ?? "application/octet-stream";

    const commandInput: PutObjectCommandInput = {
      Bucket: config.bucket,
      Key: input.key,
      Body: bytes,
      ContentType: contentType,
      Metadata: {
        sha256,
        ...(input.metadata ?? {}),
      },
    };

    await client.send(new PutObjectCommand(commandInput));

    return {
      key: input.key,
      bucket: config.bucket,
      sha256,
      sizeBytes: bytes.byteLength,
      contentType,
    };
  }

  async function putJsonArtifact(
    input: PutJsonArtifactInput,
  ): Promise<StoredArtifact> {
    const body = stringifyJsonDeterministic(input.value);
    const bytes = new TextEncoder().encode(body);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const keyOptions: { key?: string; keyPrefix?: string; sha256: string } = {
      sha256,
    };

    if (input.key !== undefined) {
      keyOptions.key = input.key;
    }

    if (input.keyPrefix !== undefined) {
      keyOptions.keyPrefix = input.keyPrefix;
    }

    const key = buildJsonArtifactKey(keyOptions);
    const contentType = input.contentType ?? jsonContentType;
    const putInput: {
      key: string;
      body: Uint8Array;
      contentType: string;
      metadata?: Record<string, string>;
    } = {
      key,
      body: bytes,
      contentType,
    };

    if (input.metadata !== undefined) {
      putInput.metadata = input.metadata;
    }

    await putArtifact(putInput);

    return {
      key,
      bucket: config.bucket,
      sha256,
      sizeBytes: bytes.byteLength,
      contentType,
    };
  }

  async function getReadUrl(key: string, expiresInSeconds = 900) {
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async function getArtifactText(key: string): Promise<string> {
    const response = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );

    return readBodyAsText(response.Body);
  }

  async function getJsonArtifact<T = JsonValue>(key: string): Promise<T> {
    return JSON.parse(await getArtifactText(key)) as T;
  }

  return {
    client,
    ensureBucket,
    putArtifact,
    putJsonArtifact,
    getArtifactText,
    getJsonArtifact,
    getReadUrl,
  };
}

async function readBodyAsText(body: unknown): Promise<string> {
  if (body === undefined || body === null) {
    throw new Error("S3 object response did not include a body");
  }

  if (typeof body === "string") {
    return body;
  }

  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }

  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }

  if (hasTransformToString(body)) {
    return body.transformToString();
  }

  if (hasText(body)) {
    return body.text();
  }

  if (isAsyncIterable(body)) {
    return decodeBodyChunks(body);
  }

  if (isReadableStream(body)) {
    return decodeReadableStream(body);
  }

  throw new TypeError("Unsupported S3 object body type");
}

function hasTransformToString(
  body: unknown,
): body is { transformToString: () => Promise<string> } {
  return (
    typeof body === "object" &&
    body !== null &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  );
}

function hasText(body: unknown): body is { text: () => Promise<string> } {
  return (
    typeof body === "object" &&
    body !== null &&
    "text" in body &&
    typeof body.text === "function"
  );
}

function isAsyncIterable(
  body: unknown,
): body is AsyncIterable<string | Uint8Array | ArrayBuffer> {
  return (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === "function"
  );
}

function isReadableStream(
  body: unknown,
): body is ReadableStream<string | Uint8Array | ArrayBuffer> {
  return (
    typeof body === "object" &&
    body !== null &&
    "getReader" in body &&
    typeof body.getReader === "function"
  );
}

async function decodeBodyChunks(
  chunks: AsyncIterable<string | Uint8Array | ArrayBuffer>,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";

  for await (const chunk of chunks) {
    text += decodeBodyChunk(chunk, decoder, { stream: true });
  }

  return text + decoder.decode();
}

async function decodeReadableStream(
  stream: ReadableStream<string | Uint8Array | ArrayBuffer>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      text += decodeBodyChunk(result.value, decoder, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return text + decoder.decode();
}

function decodeBodyChunk(
  chunk: string | Uint8Array | ArrayBuffer,
  decoder: TextDecoder,
  options?: TextDecodeOptions,
): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  return decoder.decode(chunk, options);
}

function isNotFoundError(error: unknown): boolean {
  const metadataStatus =
    error &&
    typeof error === "object" &&
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object" &&
    "httpStatusCode" in error.$metadata
      ? error.$metadata.httpStatusCode
      : undefined;

  if (metadataStatus === 404) {
    return true;
  }

  const name =
    error && typeof error === "object" && "name" in error
      ? error.name
      : undefined;

  return name === "NotFound" || name === "NoSuchBucket";
}
