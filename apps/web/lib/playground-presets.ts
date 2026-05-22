export type PlaygroundPreset = {
  id: string;
  name: string;
  description: string;
  modelIds: string[];
};

export const PLAYGROUND_PRESETS: PlaygroundPreset[] = [
  {
    id: "frontier-showdown",
    name: "Frontier Showdown",
    description:
      "The current top-of-leaderboard flagships from each major lab. Use when you're paying for the win, not the receipt.",
    modelIds: [
      "anthropic/claude-opus-4",
      "openai/gpt-4o",
      "google/gemini-2.0-pro-exp",
      "x-ai/grok-2",
    ],
  },
  {
    id: "cheapest-4",
    name: "Cheapest 4",
    description:
      "Sub-$1/1M models that punch above their weight on agent-style tasks. Great for variance checks at scale.",
    modelIds: [
      "anthropic/claude-haiku-4",
      "openai/gpt-4o-mini",
      "deepseek/deepseek-chat",
      "meta-llama/llama-3.3-70b-instruct",
    ],
  },
  {
    id: "best-web",
    name: "Best for web apps",
    description:
      "Models we've measured with strong pass-rates on full-stack web build tasks in recent sessions.",
    modelIds: [
      "anthropic/claude-opus-4",
      "openai/gpt-4o",
      "qwen/qwen-2.5-coder-32b-instruct",
    ],
  },
];
