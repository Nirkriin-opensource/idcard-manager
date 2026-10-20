import { ZodError } from "zod";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public fix: string,
  ) {
    super(message);
  }
}
export function failure(error: unknown) {
  if (error instanceof ZodError)
    return {
      status: 400,
      body: {
        error: "Some values are invalid.",
        fix: error.issues
          .map((x) => `${x.path.join(".")}: ${x.message}`)
          .join("; "),
      },
    };
  if (error instanceof AppError)
    return {
      status: error.status,
      body: { error: error.message, fix: error.fix },
    };
  const e = (error ?? {}) as { code?: string };
  if (typeof e.code === "string" && e.code.startsWith("CSV_"))
    return {
      status: 422,
      body: {
        error: "The CSV file has inconsistent columns or invalid quoting.",
        fix: "Export a fresh UTF-8 CSV with one header row and the same number of fields on every row.",
      },
    };
  if (e.code === "23505")
    return {
      status: 409,
      body: {
        error: "A record with this identifier already exists.",
        fix: "Choose a unique identifier or update the existing record.",
      },
    };
  if (e.code === "23503")
    return {
      status: 400,
      body: {
        error: "A referenced record is unavailable.",
        fix: "Select a record from the current organization.",
      },
    };
  console.error(
    JSON.stringify({
      event: "request_failure",
      code: e.code || "internal",
      time: new Date().toISOString(),
    }),
  );
  return {
    status: 500,
    body: {
      error: "The operation could not complete.",
      fix: "Check database, storage and worker health. Retry; contact the administrator with the time of this failure.",
    },
  };
}
