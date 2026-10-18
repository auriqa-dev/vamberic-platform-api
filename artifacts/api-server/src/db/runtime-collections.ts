import type { Db } from "mongodb";
import type { DomainCollections } from "./collections";
import { COLLECTION_NAMES } from "./collection-names";

export function getDomainCollections(db: Db): DomainCollections {
  return Object.fromEntries(
    COLLECTION_NAMES.map((name) => [name, db.collection(name)]),
  ) as DomainCollections;
}

/** Short alias for repositories that already use the generic collections name. */
export const getCollections = getDomainCollections;
