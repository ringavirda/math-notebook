/** A synchronous in-process publish and subscribe channel for one event union. */
export class EventBus<E extends { type: string }> {
  private readonly listeners: ((event: E) => void)[] = [];

  /** Calls every listener in subscription order, before returning. */
  publish(event: E): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  /** @returns a function that removes this listener. */
  subscribe(listener: (event: E) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }
}
