import type { RequestHandler } from "express";

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let requestsSinceCleanup = 0;

  return (req, res, next) => {
    const now = Date.now();

    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 1000) {
      for (const [client, bucket] of buckets) {
        if (bucket.resetAt <= now) {
          buckets.delete(client);
        }
      }
      requestsSinceCleanup = 0;
    }

    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const current = buckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + options.windowMs }
        : current;

    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader("x-ratelimit-limit", options.maxRequests);
    res.setHeader(
      "x-ratelimit-remaining",
      Math.max(0, options.maxRequests - bucket.count),
    );
    res.setHeader("x-ratelimit-reset", Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > options.maxRequests) {
      res.setHeader("retry-after", Math.ceil((bucket.resetAt - now) / 1000));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests",
        },
      });
      return;
    }

    next();
  };
}
