export class Diagnostics {
  private last: Record<string, unknown> = {};

  async record(stage: string, details: Record<string, unknown> = {}): Promise<void> {
    this.last = { stage, time: new Date().toISOString(), ...details };
    try {
      // Diagnostics are deliberately browser-local. Writing a single mutable
      // file under data/storage makes every device update the same sync path
      // and can turn ordinary plugin activity into a data-sync conflict.
      globalThis.localStorage?.setItem(
        "siyuan-cloud-document-suite:diagnostics-v1",
        JSON.stringify(this.last)
      );
      console.debug("[Cloud Document Suite]", this.last);
    } catch (error) {
      console.debug("[Cloud Document Suite] Cannot cache diagnostics", error);
    }
  }

  snapshot(): Record<string, unknown> {
    return { ...this.last };
  }
}
