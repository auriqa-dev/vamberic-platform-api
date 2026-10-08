import { z } from "zod";

/** Internal transaction write token, not a grant/epoch supplied by a caller.
 * Absent means zero. Exhaustion fails closed; never wrap or reset. */
export const ExecutionSerialSchema = z.number().int().safe().nonnegative();
export const executionSerializationFields = {
  executionSerial: ExecutionSerialSchema.optional(),
};
