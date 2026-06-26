/**
 * Error Contract - unified error response format
 */

import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { Env } from "../env.js";
import { DomainError } from "../../domain/models/errors.js";

/** Standard error response format */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/** Error handler for Hono app */
export const errorHandler: ErrorHandler<Env> = (err, c) => {
  const requestId = c.get("requestId") ?? "unknown";

  // Zod validation errors
  if (err instanceof ZodError) {
    const response: ErrorResponse = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        requestId,
        details: err.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    };
    return c.json(response, 400);
  }

  // Domain errors
  if (err instanceof DomainError) {
    const response: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        requestId,
      },
    };
    return c.json(response, err.status as 400 | 403 | 404 | 409);
  }

  // HTTP exceptions
  if (err instanceof HTTPException) {
    const code = getHttpErrorCode(err.status);
    const response: ErrorResponse = {
      error: {
        code,
        message: err.message,
        requestId,
      },
    };
    return c.json(response, err.status);
  }

  // Unknown errors - log and return generic response
  console.error(`[${requestId}] Unhandled error:`, err);

  const response: ErrorResponse = {
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred",
      requestId,
    },
  };
  return c.json(response, 500);
};

function getHttpErrorCode(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE_ENTITY";
    case 429:
      return "TOO_MANY_REQUESTS";
    default:
      return "HTTP_ERROR";
  }
}
