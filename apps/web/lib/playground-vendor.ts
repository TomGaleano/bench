export const PG_VENDOR: Record<string, string> = {
  openai: "#10a37f",
  anthropic: "#d97757",
  google: "#4285f4",
  meta: "#0467df",
  "meta-llama": "#0467df",
  mistralai: "#ff7000",
  "x-ai": "#0c0c0d",
  cohere: "#39594d",
  deepseek: "#4d6bfe",
  qwen: "#615ced",
  microsoft: "#00a4ef",
  nvidia: "#76b900",
  perplexity: "#1fb8cd",
};

export function pgVendorSlug(modelId: string | null | undefined): string {
  if (!modelId) return "—";
  const head = modelId.split("/")[0];
  return head || "—";
}

export function pgVendor(modelId: string | null | undefined): string {
  return PG_VENDOR[pgVendorSlug(modelId)] ?? "#888";
}

export function pgVendorName(modelId: string | null | undefined): string {
  return pgVendorSlug(modelId).replace(/-/g, " ");
}
