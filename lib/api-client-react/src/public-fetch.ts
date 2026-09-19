import { customFetch, type CustomFetchOptions } from "./custom-fetch";

/** Only the public enquiry operation selects this mutator in OpenAPI codegen. */
export function publicFetch<T>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  return customFetch<T>(input, {
    ...options,
    authentication: "omit",
    credentials: "omit",
  });
}
