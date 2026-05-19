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

      const response = await fetchImpl(url, requestInit);

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

      const response = await fetchImpl(url, requestInit);

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
