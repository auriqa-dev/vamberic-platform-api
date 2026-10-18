import { expireInteractionContent } from "../interaction/cleanup";
import { expireWebsiteEvidence } from "../website-tracking/cleanup";
import { measurementReconciler } from "../measurement/reconcile";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import { createNbaReconciler } from "./reconcile";
export function nbaWorker(
  config: AppConfig,
  mongo: MongoService,
  onError: () => void,
) {
  const reconciler = createNbaReconciler(config, mongo);
  const measurement = measurementReconciler(mongo, onError);
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void measurement
      .tick()
      .catch(onError)
      .then(() => expireWebsiteEvidence(mongo))
      .then(() => expireInteractionContent(mongo))
      .catch(onError)
      .then(() => reconciler.tick())
      .catch(onError)
      .finally(() => {
        busy = false;
      });
  }, 10000);
  timer.unref();
  return () => clearInterval(timer);
}
