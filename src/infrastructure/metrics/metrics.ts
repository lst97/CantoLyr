// Metrics utilities (Infrastructure)
// Lightweight in-process instrumentation for timing, counters & histograms.
// No external dependencies; can be swapped later for OpenTelemetry.

export interface CounterMetric {
  inc(by?: number): void;
  value(): number;
}
export interface HistogramMetric {
  observe(v: number): void;
  summary(): { count: number; min: number; max: number; p50: number; p95: number; avg: number };
}
export interface TimerResult {
  ms: number;
}

class Counter implements CounterMetric {
  private v = 0;
  inc(by = 1) {
    this.v += by;
  }
  value() {
    return this.v;
  }
}

class Histogram implements HistogramMetric {
  private samples: number[] = [];
  observe(v: number) {
    this.samples.push(v);
  }
  summary() {
    if (!this.samples.length) return { count: 0, min: 0, max: 0, p50: 0, p95: 0, avg: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const count = sorted.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
    const sum = sorted.reduce((a, b) => a + b, 0);
    return { count, min, max, p50: p(0.5), p95: p(0.95), avg: +(sum / count).toFixed(3) };
  }
}

export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Histogram>();

  counter(name: string): CounterMetric {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter();
      this.counters.set(name, c);
    }
    return c;
  }

  histogram(name: string): HistogramMetric {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram();
      this.histograms.set(name, h);
    }
    return h;
  }

  time<T>(name: string, fn: () => Promise<T> | T): Promise<[T, TimerResult]> {
    const start = performance.now();
    const h = this.histogram(`${name}_latency_ms`);
    const p = Promise.resolve().then(fn);
    return p.then((res) => {
      const ms = performance.now() - start;
      h.observe(ms);
      return [res, { ms }];
    });
  }

  snapshot() {
    const counters: Record<string, number> = {};
    const hist: Record<string, ReturnType<HistogramMetric["summary"]>> = {};
    for (const [k, c] of this.counters.entries()) counters[k] = c.value();
    for (const [k, h] of this.histograms.entries()) hist[k] = h.summary();
    return { counters, histograms: hist };
  }
}

export const globalMetrics = new MetricsRegistry();

export function instrumentAsync<T extends (...args: any[]) => Promise<any>>(
  name: string,
  fn: T,
): T {
  const wrapped = (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const [res] = await globalMetrics.time(name, () => fn(...(args as any)));
    return res as ReturnType<T>;
  }) as T;
  return wrapped;
}

export default globalMetrics;
