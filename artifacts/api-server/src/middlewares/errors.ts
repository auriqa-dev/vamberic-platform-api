import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.path}`,
    },
  });
};

export const errorHandler: ErrorRequestHandler = (
  error,
  req,
  res,
  _next,
) => {
  const isValidationError = error instanceof ZodError;
  const statusCode = isValidationError ? 400 : 500;
  const code = isValidationError ? "VALIDATION_ERROR" : "INTERNAL_SERVER_ERROR";
  const message = isValidationError
    ? "Request validation failed"
    : "An unexpected error occurred";

  logger.error(
    {
      err: error,
      requestId: req.header("x-request-id"),
      statusCode,
    },
    "Request failed",
  );

  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(isValidationError ? { details: error.issues } : {}),
    },
  });
};