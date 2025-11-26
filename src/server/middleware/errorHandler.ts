import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    error: {
      message: err.message || "Unexpected error",
      suggestion: "Please retry or adjust your settings.",
      code: status
    }
  });
};
