// Typed views over the auto-generated schema.ts.
// Imports are types-only so this stays client-safe.
import type { TableName, FieldsOf } from "./schema";

/** Airtable cell values are dynamic per field type; keep them `unknown`
 *  and narrow at call sites with the existing pickStr/pickNum/firstId helpers. */
export type RecordOf<T extends TableName> =
  { id: string } & { [K in FieldsOf<T>]?: unknown };

export interface FilterOps {
  in?: ReadonlyArray<string | number>;
  notIn?: ReadonlyArray<string | number>;
  not?: string | number | boolean | null;
  gte?: string | number;
  lte?: string | number;
  gt?: string | number;
  lt?: string | number;
  equals?: string | number;
  contains?: string;
  linkAnyOf?: ReadonlyArray<string>;
  isEmpty?: boolean;
}

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | FilterOps;

/** Filter keyed by camelCase field names of the table (+ synthetic "recordId"). */
export type TypedFilters<T extends TableName> =
  Partial<Record<FieldsOf<T> | "recordId", FilterValue>>;

/** Write payload: schema fields + escape hatch for off-schema columns (e.g. clientOpId). */
export type WritePayload<T extends TableName> =
  Partial<Record<FieldsOf<T>, unknown>> & {
    __extraFields?: Record<string, unknown>;
  };

export type SortSpec<T extends TableName> = {
  field: FieldsOf<T>;
  direction?: "asc" | "desc";
};
