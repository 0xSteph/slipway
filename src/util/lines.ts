// xtool redraws progress with bare \r, so a carriage return also ends a line.
export class LineSplitter {
  private pending = "";

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    const parts = (this.pending + chunk).split(/\r\n|\n|\r/);
    this.pending = parts.pop() ?? "";
    for (const part of parts) this.onLine(part);
  }

  get partial(): string {
    return this.pending;
  }

  flush(): void {
    if (this.pending) this.onLine(this.pending);
    this.pending = "";
  }
}
