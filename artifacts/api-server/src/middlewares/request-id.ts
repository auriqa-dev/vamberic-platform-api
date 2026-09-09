import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incomingRequestId = req.header("x-request-id");
  const id =
    incomingRequestId && requestIdPattern.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();

  req.headers["x-request-id"] = id;
  res.setHeader("x-request-id", id);
  next();
};
