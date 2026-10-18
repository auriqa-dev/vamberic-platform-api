import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import { createCommunications } from "./service";
import { logger } from "../../lib/logger";
export function communicationsWorker(config: AppConfig, mongo: MongoService) {
  const app = createCommunications(config, mongo);
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void app
      .tick()
      .catch(() => logger.warn("Communications worker needs attention"))
      .finally(() => {
        busy = false;
      });
  }, 15000);
  timer.unref();
  return () => clearInterval(timer);
}
