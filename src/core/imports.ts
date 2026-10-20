import { importCardType } from "./import-fields.ts";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import yauzl from "yauzl";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors.ts";
import { personSchema, validateFields } from "./people.ts";
import { validateProfilePerson, useGeneralCardType } from "./card-profiles.ts";
export type ImportError = { field: string; error: string; fix: string };
export async function zipEntries(
  buffer: Buffer,
  handler: (name: string, data: Buffer) => Promise<void>,
  limits = { entries: 200, bytes: 100 * 1024 * 1024 },
) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (err, zip) => {
        if (err || !zip)
          return reject(
            new AppError(
              400,
              "ZIP archive could not be opened.",
              "Upload a valid, unencrypted ZIP file.",
            ),
          );
        let count = 0,
          total = 0;
        let finished = false;
        const fail = (e: unknown) => {
          if (!finished) {
            finished = true;
            zip.close();
            reject(e);
          }
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (!finished) {
            finished = true;
            resolve();
          }
        });
        zip.on("entry", (entry: yauzl.Entry) => {
          if (
            ++count > limits.entries ||
            entry.uncompressedSize > 20 * 1024 * 1024 ||
            (total += entry.uncompressedSize) > limits.bytes
          )
            return fail(
              new AppError(
                413,
                "ZIP expanded size or entry count exceeds limits.",
                "Split the archive into smaller batches.",
              ),
            );
          if (
            entry.generalPurposeBitFlag & 1 ||
            entry.fileName.includes("..") ||
            /^[\\/]/.test(entry.fileName) ||
            /^[a-z]:/i.test(entry.fileName)
          )
            return fail(
              new AppError(
                400,
                "ZIP contains unsafe paths or encrypted entries.",
                "Recreate the archive using ordinary files and relative paths.",
              ),
            );
          if (entry.fileName.endsWith("/")) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) return fail(e);
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("error", fail);
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > 20 * 1024 * 1024) {
                stream.destroy();
                fail(
                  new AppError(
                    413,
                    "ZIP entry is too large.",
                    "Reduce image size.",
                  ),
                );
              } else chunks.push(chunk);
            });
            stream.on("end", () => {
              if (!finished)
                handler(entry.fileName, Buffer.concat(chunks))
                  .then(() => zip.readEntry())
                  .catch(fail);
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
export async function parseSheet(buffer: Buffer, name: string) {
  let rows: unknown[][];
  if (name.toLowerCase().endsWith(".csv"))
    rows = parse(buffer, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 100_000,
      relax_column_count: false,
    });
  else if (name.toLowerCase().endsWith(".xlsx")) {
    await zipEntries(buffer, async () => {}, {
      entries: 3000,
      bytes: 80 * 1024 * 1024,
    });
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw new AppError(
        422,
        "The XLSX workbook could not be read.",
        "Export a fresh .xlsx workbook with values and a header row.",
      );
    }
    const sheet = workbook.worksheets[0];
    if (!sheet)
      throw new AppError(
        400,
        "Spreadsheet has no worksheets.",
        "Add a header row and data.",
      );
    rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (
          cell.type === ExcelJS.ValueType.Formula ||
          cell.type === ExcelJS.ValueType.Hyperlink
        )
          throw new AppError(
            400,
            "Spreadsheet formulas and hyperlinks are not imported.",
            "Paste values into a new workbook before uploading.",
          );
        values[col - 1] =
          cell.value instanceof Date
            ? cell.value.toISOString().slice(0, 10)
            : cell.text;
      });
      rows.push(values);
    });
  } else
    throw new AppError(
      400,
      "Unsupported import format.",
      "Choose .csv or .xlsx.",
    );
  if (rows.length < 2 || rows.length > 10001)
    throw new AppError(
      400,
      "Import must have 1–10,000 data rows.",
      "Include one header row and split larger imports.",
    );
  const columns = rows[0].map((v) => String(v ?? "").trim());
  if (
    columns.length > 100 ||
    columns.some((v) => !v) ||
    new Set(columns).size !== columns.length
  )
    throw new AppError(
      400,
      "Headers must be unique and non-empty; at most 100 columns.",
      "Rename duplicate or empty columns.",
    );
  return {
    columns,
    rows: rows
      .slice(1)
      .map((row) =>
        Object.fromEntries(
          columns.map((key, i) => [key, String(row[i] ?? "")]),
        ),
      ),
  };
}
export async function stageImport(
  c: pg.PoolClient,
  org: string,
  buffer: Buffer,
  name: string,
) {
  const parsed = await parseSheet(buffer, name),
    id = randomUUID();
  await c.query(
    "INSERT INTO import_batches(id,organization_id,original_name,columns,status) VALUES($1,$2,$3,$4,'UPLOADED')",
    [id, org, name, JSON.stringify(parsed.columns)],
  );
  for (let offset = 0; offset < parsed.rows.length; offset += 200) {
    const chunk = parsed.rows.slice(offset, offset + 200);
    await c.query(
      "INSERT INTO import_rows(organization_id,batch_id,row_number,raw) SELECT $1,$2, $3+ordinality::int, value FROM jsonb_array_elements($4::jsonb) WITH ORDINALITY",
      [org, id, offset + 1, JSON.stringify(chunk)],
    );
  }
  return { id, columns: parsed.columns, count: parsed.rows.length };
}
export async function validateImport(
  c: pg.PoolClient,
  org: string,
  id: string,
  mapping: Record<string, string>,
) {
  const batch = await c.query(
    "SELECT * FROM import_batches WHERE id=$1 AND organization_id=$2 FOR UPDATE",
    [id, org],
  );
  if (!batch.rowCount || batch.rows[0].status === "IMPORTED")
    throw new AppError(
      409,
      "Import is missing or already completed.",
      "Upload a new file.",
    );
  const targets = Object.values(mapping);
  if (
    !targets.includes("external_id") ||
    !targets.includes("name") ||
    new Set(targets).size !== targets.length
  )
    throw new AppError(
      400,
      "Mapping needs a unique ID and name target.",
      "Map external_id and name once each.",
    );
  if (Object.keys(mapping).some((k) => !batch.rows[0].columns.includes(k)))
    throw new AppError(
      400,
      "Mapping contains an unknown column.",
      "Use the uploaded column names.",
    );
  const defs = (
    await c.query(
      "SELECT key,type FROM field_definitions WHERE organization_id=$1",
      [org],
    )
  ).rows;
  const seen = new Set<string>();
  let valid = 0,
    invalid = 0;
  for (let offset = 0; ; offset += 200) {
    const rows = (
      await c.query(
        "SELECT * FROM import_rows WHERE batch_id=$1 ORDER BY row_number LIMIT 200 OFFSET $2",
        [id, offset],
      )
    ).rows;
    if (!rows.length) break;
    for (const row of rows) {
      const candidate: Record<string, unknown> = { custom_fields: {} };
      const custom = candidate.custom_fields as Record<string, unknown>;
      for (const [column, target] of Object.entries(mapping)) {
        const value = String(row.raw[column] ?? "").trim();
        if (target.startsWith("custom.")) {
          const key = target.slice(7),
            def = defs.find((d) => d.key === key);
          if (!value && !def) continue;
          custom[key] =
            value === ""
              ? null
              : key === "card_type"
                ? importCardType(value)
                : def?.type === "number"
                  ? Number(value)
                  : def?.type === "boolean"
                    ? value === "true"
                      ? true
                      : value === "false"
                        ? false
                        : value
                    : value;
        } else
          candidate[target] = target === "status" && !value ? "ACTIVE" : value;
      }
      await useGeneralCardType(c, org, candidate);
      const errors: ImportError[] = [];
      const parsed = personSchema.safeParse(candidate);
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          errors.push({
            field: issue.path.join("."),
            error: issue.message,
            fix: "Correct this value in the source file.",
          });
      else {
        try {
          await validateFields(c, org, parsed.data.custom_fields);
          await validateProfilePerson(c, org, parsed.data, true);
        } catch (e) {
          errors.push({
            field: "custom_fields",
            error: (e as AppError).fix,
            fix: "Use the configured custom-field types and required values.",
          });
        }
        if (seen.has(parsed.data.external_id))
          errors.push({
            field: "external_id",
            error: "Duplicate ID within this import.",
            fix: "Assign a unique ID.",
          });
        seen.add(parsed.data.external_id);
        if (
          (
            await c.query(
              "SELECT id FROM people WHERE organization_id=$1 AND external_id=$2",
              [org, parsed.data.external_id],
            )
          ).rowCount
        )
          errors.push({
            field: "external_id",
            error: "ID already exists in this organization.",
            fix: "Remove this row or update the person separately.",
          });
      }
      await c.query(
        "UPDATE import_rows SET normalized=$1,errors=$2 WHERE batch_id=$3 AND row_number=$4",
        [
          parsed.success ? JSON.stringify(parsed.data) : null,
          JSON.stringify(errors),
          id,
          row.row_number,
        ],
      );
      errors.length ? invalid++ : valid++;
    }
  }
  await c.query(
    "UPDATE import_batches SET mapping=$1,status='VALIDATED' WHERE id=$2",
    [JSON.stringify(mapping), id],
  );
  return { valid, invalid };
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
