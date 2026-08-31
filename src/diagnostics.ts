export type DebugSave = (name: string, data: Record<string, unknown>) => Promise<void>;

export class Diagnostics {
  private last: Record<string, unknown> = {};

  constructor(private readonly save: DebugSave) {}

  async record(stage: string, details: Record<string, unknown> = {}): Promise<void> {
    this.last = { stage, time: new Date().toISOString(), ...details };
    try {
      await this.save("drop-debug.json", this.last);
    } catch (error) {
      console.error("[Drop Importer] Cannot save diagnostics", error);
    }
  }

  snapshot(): Record<string, unknown> {
    return { ...this.last };
  }
}
