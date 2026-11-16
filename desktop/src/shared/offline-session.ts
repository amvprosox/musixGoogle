const MAX_HISTORY = 500;

export type RandomSource = () => number;

export function shuffled<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

export class OfflineSession {
  private queue: string[];
  private order: string[];
  private position: number;
  private history: string[] = [];
  private shuffleOn: boolean;
  private readonly random: RandomSource;

  constructor(
    queue: readonly string[],
    startId: string,
    shuffle: boolean,
    random: RandomSource = Math.random,
  ) {
    this.random = random;
    this.queue = dedupe(queue);
    if (!this.queue.includes(startId)) {
      this.queue.unshift(startId);
    }
    this.shuffleOn = shuffle;
    this.order = this.buildOrder(startId);
    this.position = Math.max(0, this.order.indexOf(startId));
  }

  get current(): string | null {
    return this.order[this.position] ?? null;
  }

  get shuffle(): boolean {
    return this.shuffleOn;
  }

  get ids(): readonly string[] {
    return this.queue;
  }

  get upcoming(): readonly string[] {
    return this.order.slice(this.position + 1);
  }

  get played(): readonly string[] {
    return this.history;
  }

  next(repeatAll: boolean): string | null {
    const cur = this.current;
    if (cur === null) {
      return null;
    }
    if (this.position + 1 < this.order.length) {
      this.pushHistory(cur);
      this.position += 1;
      return this.current;
    }
    if (!repeatAll) {
      return null;
    }
    this.pushHistory(cur);
    if (this.shuffleOn) {
      const rest = shuffled(this.queue, this.random);
      if (rest.length > 1 && rest[0] === cur) {
        rest.push(rest.shift() as string);
      }
      this.order = rest;
    } else {
      this.order = [...this.queue];
    }
    this.position = 0;
    return this.current;
  }

  previous(repeatAll: boolean): string | null {
    while (this.history.length > 0) {
      const id = this.history.pop() as string;
      const idx = this.order.indexOf(id);
      if (idx >= 0) {
        this.position = idx;
        return id;
      }
    }
    if (this.position > 0) {
      this.position -= 1;
      return this.current;
    }
    if (repeatAll && this.order.length > 1) {
      this.position = this.order.length - 1;
      return this.current;
    }
    return null;
  }

  setShuffle(on: boolean): void {
    if (on === this.shuffleOn) {
      return;
    }
    this.shuffleOn = on;
    const cur = this.current;
    if (cur === null) {
      this.order = on ? shuffled(this.queue, this.random) : [...this.queue];
      this.position = 0;
      return;
    }
    this.order = this.buildOrder(cur);
    this.position = Math.max(0, this.order.indexOf(cur));
  }

  jumpTo(id: string): boolean {
    const cur = this.current;
    if (id === cur) {
      return true;
    }
    if (!this.queue.includes(id)) {
      return false;
    }
    if (cur !== null) {
      this.pushHistory(cur);
    }
    const idx = this.order.indexOf(id);
    if (this.shuffleOn && idx >= 0) {
      this.order.splice(idx, 1);
      const insertAt = Math.min(this.position + 1, this.order.length);
      this.order.splice(insertAt, 0, id);
      this.position = insertAt;
    } else {
      this.position = Math.max(0, idx);
    }
    return true;
  }

  syncQueue(ids: readonly string[]): void {
    const next = dedupe(ids);
    const keep = new Set(next);
    const cur = this.current;
    this.queue = next;
    this.history = this.history.filter((id) => keep.has(id));
    if (!this.shuffleOn) {
      this.order = [...next];
      const idx = cur !== null ? this.order.indexOf(cur) : -1;
      this.position = idx >= 0 ? idx : Math.min(this.position, Math.max(0, this.order.length - 1));
      return;
    }
    const existing = new Set(this.order);
    const kept = this.order.filter((id) => keep.has(id));
    const added = next.filter((id) => !existing.has(id));
    const curIdx = cur !== null ? kept.indexOf(cur) : -1;
    const head = curIdx >= 0 ? kept.slice(0, curIdx + 1) : [];
    const tail = shuffled([...(curIdx >= 0 ? kept.slice(curIdx + 1) : kept), ...added], this.random);
    this.order = [...head, ...tail];
    this.position = curIdx >= 0 ? curIdx : Math.min(this.position, Math.max(0, this.order.length - 1));
  }

  private buildOrder(startId: string): string[] {
    if (!this.shuffleOn) {
      return [...this.queue];
    }
    return [
      startId,
      ...shuffled(
        this.queue.filter((id) => id !== startId),
        this.random,
      ),
    ];
  }

  private pushHistory(id: string): void {
    this.history.push(id);
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
  }
}

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (id !== '' && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
