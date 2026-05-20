import { readGitHubToken, type GitHubToken } from "./token.js";

export interface GitHubJsonRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
}

export interface GitHubClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  token?: GitHubToken;
  userAgent?: string;
}

export interface GitHubClient {
  requestJson<T>(path: string, options?: GitHubJsonRequestOptions): Promise<T>;
  requestText(path: string, options?: GitHubJsonRequestOptions): Promise<string>;
}

export class GitHubClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string
  ) {
    super(message);
    this.name = "GitHubClientError";
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps fetch with exponential backoff for rate limits (429) and server errors (5xx),
 * plus network-level retries for transient failures.
 */
async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: URL,
  requestInit: RequestInit,
  attempt: number = 1,
): Promise<Response> {
  try {
    const response = await fetchImpl(url, requestInit);

    if (response.ok) return response;

    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= MAX_RETRIES) {
      return response; // Let caller throw the error
    }

    // Calculate backoff: prefer Retry-After header, fall back to exponential + jitter
    const retryAfter = response.headers.get("Retry-After");
    const backoffMs = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000, 60_000);

    console.warn(
      `[github-client] rate-limited (${response.status}), retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms`
    );
    await delay(backoffMs);
    return fetchWithRetry(fetchImpl, url, requestInit, attempt + 1);
  } catch (error) {
    // Network-level failure (DNS, timeout, connection refused, etc.)
    if (attempt >= MAX_RETRIES) throw error;

    const backoffMs = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000, 60_000);
    console.warn(
      `[github-client] network error (${error instanceof Error ? error.message : error}), retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms`
    );
    await delay(backoffMs);
    return fetchWithRetry(fetchImpl, url, requestInit, attempt + 1);
  }
}

export function createGitHubRequestHeaders(options: {
  token?: GitHubToken;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
} = {}): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": options.userAgent ?? "pi-lab-case-builder",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...options.extraHeaders
  };
}

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.github.com";
  const token = options.token ?? readGitHubToken();

  return {
    async requestJson<T>(
      path: string,
      requestOptions: GitHubJsonRequestOptions = {}
    ): Promise<T> {
      const url = new URL(path, withTrailingSlash(baseUrl));
      const headerOptions: Parameters<typeof createGitHubRequestHeaders>[0] = {};
      const requestInit: RequestInit = {
        method: requestOptions.method ?? "GET",
        headers: createGitHubRequestHeaders(headerOptions)
      };

      if (token) {
        headerOptions.token = token;
      }

      if (options.userAgent) {
        headerOptions.userAgent = options.userAgent;
      }

      if (requestOptions.headers) {
        headerOptions.extraHeaders = requestOptions.headers;
      }

      requestInit.headers = createGitHubRequestHeaders(headerOptions);

      if (requestOptions.body !== undefined) {
        requestInit.body = JSON.stringify(requestOptions.body);
      }

      const response = await fetchWithRetry(fetchImpl, url, requestInit);

      if (!response.ok) {
        throw new GitHubClientError(
          `GitHub request failed with status ${response.status}`,
          response.status,
          await response.text()
        );
      }

      return (await response.json()) as T;
    },

    async requestText(
      path: string,
      requestOptions: GitHubJsonRequestOptions = {}
    ): Promise<string> {
      const url = new URL(path, withTrailingSlash(baseUrl));
      const headerOptions: Parameters<typeof createGitHubRequestHeaders>[0] = {};
      const requestInit: RequestInit = {
        method: requestOptions.method ?? "GET",
        headers: createGitHubRequestHeaders(headerOptions)
      };

      if (token) {
        headerOptions.token = token;
      }

      if (options.userAgent) {
        headerOptions.userAgent = options.userAgent;
      }

      if (requestOptions.headers) {
        headerOptions.extraHeaders = requestOptions.headers;
      }

      requestInit.headers = createGitHubRequestHeaders(headerOptions);

      if (requestOptions.body !== undefined) {
        requestInit.body = JSON.stringify(requestOptions.body);
      }

      const response = await fetchWithRetry(fetchImpl, url, requestInit);

      if (!response.ok) {
        throw new GitHubClientError(
          `GitHub request failed with status ${response.status}`,
          response.status,
          await response.text()
        );
      }

      return response.text();
    }
  };
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
