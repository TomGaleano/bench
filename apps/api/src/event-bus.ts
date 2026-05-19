import type { RunEvent } from "./types.js";

export type RunEventSubscriber = (event: RunEvent) => void;

export function createRunEventBus() {
  const subscribers = new Map<string, Set<RunEventSubscriber>>();

  function publish(event: RunEvent) {
    const runSubscribers = subscribers.get(event.runId);
    if (!runSubscribers) {
      return;
    }

    for (const subscriber of runSubscribers) {
      subscriber(event);
    }
  }

  function subscribe(runId: string, subscriber: RunEventSubscriber) {
    const runSubscribers = subscribers.get(runId) ?? new Set<RunEventSubscriber>();
    runSubscribers.add(subscriber);
    subscribers.set(runId, runSubscribers);

    return () => {
      runSubscribers.delete(subscriber);
      if (runSubscribers.size === 0) {
        subscribers.delete(runId);
      }
    };
  }

  return {
    publish,
    subscribe,
  };
}

export type RunEventBus = ReturnType<typeof createRunEventBus>;
