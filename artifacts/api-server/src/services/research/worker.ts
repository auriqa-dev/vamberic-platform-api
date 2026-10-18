import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import { createResearchService } from "./service";
import { contentGeneratorFromEnvironment } from "../content-strategy/generate";
export function researchWorker(config: AppConfig, mongo: MongoService) {
  const app = createResearchService(
    config,
    mongo,
    contentGeneratorFromEnvironment(),
  );
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void app
      .tick()
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  }, 30000);
  timer.unref();
  return () => clearInterval(timer);
}
