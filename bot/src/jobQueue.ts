import type { ExecJob } from "./executor.js";
import { executeJob } from "./executor.js";

export interface Notifier {
  notify(chatId: string, text: string): void | Promise<void>;
}

export class JobQueue {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly notifier: Notifier) {}

  enqueue(job: ExecJob): void {
    const key = job.project.name;
    const running = this.chains.has(key);

    if (running) {
      this.notifier.notify(
        job.chatId,
        "⏳ In attesa: c'è già un task in corso su questo progetto. " +
          "Partirà automaticamente al termine del precedente."
      );
    }

    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => {
        /* un job fallito non deve bloccare quelli in coda */
      })
      .then(() => executeJob(job, this.notifier));

    this.chains.set(key, next);

    next.finally(() => {
      if (this.chains.get(key) === next) {
        this.chains.delete(key);
      }
    });
  }
}
