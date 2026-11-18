import { readJson } from "./api";
import {
  ProductInputSchema,
  ProductPatchSchema,
  ProductQuerySchema,
  type ProductInput,
  type ProductPatch,
  type ProductQuery,
} from "./productInput";

/**
 * The parse edge for the products routes.
 *
 * WHY A SEPARATE FILE FROM THE SCHEMA
 * -----------------------------------
 * `lib/productInput.ts` is imported by the client form, so it must stay free of
 * anything server-only. These wrappers read a `Request` body — a server concern —
 * so they live apart. The split also gives the list, create, edit and import
 * routes one import to share, instead of each calling `.parse()` its own way and
 * disagreeing about, say, whether an empty `q` is undefined or "".
 *
 * Each wrapper throws a `ZodError`, which `handle()` in lib/api.ts turns into a
 * 422 with per-field messages. The routes never see the error — they call these,
 * get a normalised shape, and get on with the work.
 */

/** Query string → the normalised list filters (defaults applied). */
export function parseQuery(params: Record<string, string>): ProductQuery {
  return ProductQuerySchema.parse(params);
}

/** A create body → the write shape, money already in kobo. */
export function parseProduct(body: unknown): ProductInput {
  return ProductInputSchema.parse(body);
}

/**
 * A PATCH body → only the fields that were sent.
 *
 * `.partial()` makes every field optional, but a field that *is* present still
 * runs its full transform — a price sent as "1,250" still lands as kobo, a
 * barcode sent as "" still normalises to null. Absent fields stay absent so the
 * route can tell "set this to empty" from "don't touch this".
 */
export function parseProductPatch(body: unknown): ProductPatch {
  return ProductPatchSchema.parse(body);
}

/** Read and JSON-parse a request body, surfacing malformed JSON as a clean 400. */
export async function readBody(request: Request): Promise<unknown> {
  return readJson(request);
}
