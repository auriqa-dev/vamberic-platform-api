import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import { createMailboxApplication } from "./application";
import { logger } from "../../lib/logger";
export function mailboxWorker(config: AppConfig, mongo: MongoService) {
  const app = createMailboxApplication(config, mongo);
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  async function run() {
    if (stopped) return;
    try {
      await app.tick();
    } catch {
      logger.warn("Mailbox reply synchronisation needs attention");
    }
    if (!stopped) {
      timer = setTimeout(() => void run(), 60000);
      timer.unref();
    }
  }
  timer = setTimeout(() => void run(), 5000);
  timer.unref();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
