import { z } from "zod";
import { API_RESPONSE_SCHEMA_CATALOG, loginResponseSchema, meResponseSchema } from "@cvg/contracts";
import { AUTH_OPS_RESPONSE_SCHEMAS } from "./auth-ops.ts";
import { clinicalResponseSchemas } from "./clinical.ts";
import { remainingResponseSchemas } from "./remaining.ts";

const payloadSchemaEntries: ReadonlyArray<readonly [string, z.ZodTypeAny]> = [
  ["LoginResponse", loginResponseSchema],
  ["IdentityResponse", meResponseSchema],
  ...AUTH_OPS_RESPONSE_SCHEMAS,
  ...clinicalResponseSchemas,
  ...remainingResponseSchemas
];

const payloadSchemas = new Map<string, z.ZodTypeAny>(payloadSchemaEntries);

const expectedNames = new Set(API_RESPONSE_SCHEMA_CATALOG.map((descriptor) => descriptor.name));
const payloadEntryNames = payloadSchemaEntries.map(([name]) => name);
const duplicateNames = payloadEntryNames.filter((name, index, names) => names.indexOf(name) !== index);
const missingNames = [...expectedNames].filter((name) => !payloadSchemas.has(name));
const unknownNames = [...payloadSchemas.keys()].filter((name) => !expectedNames.has(name));
if (duplicateNames.length || missingNames.length || unknownNames.length || payloadSchemas.size !== expectedNames.size) {
  throw new Error(`API payload schema registry is incomplete: duplicates=${duplicateNames.join(",")} missing=${missingNames.join(",")} unknown=${unknownNames.join(",")} count=${payloadSchemas.size}/${expectedNames.size}`);
}

/** The executable 80/80 payload registry. The envelope validator owns egress. */
export const API_PAYLOAD_RESPONSE_SCHEMAS: ReadonlyMap<string, z.ZodTypeAny> = payloadSchemas;
