class FakeCollection {
  readonly documents = new Map<string, Record<string, unknown>>();
  indexes: Record<string, unknown>[] = [{ name: "_id_", key: { _id: 1 } }];
  aggregateResults: Record<string, unknown>[] = [];
  mutationCount = 0;

  listIndexes() {
    return { toArray: async () => this.indexes };
  }

  async createIndexes(indexes: Record<string, unknown>[]) {
    this.mutationCount += 1;
    this.indexes.push(...indexes);
    return indexes.map((index) => index.name as string);
  }

  validatorInvalidCount = 0;
  options: Record<string, unknown> = {};
  async countDocuments(filter?: Record<string, unknown>) {
    if (filter?.$nor) return this.validatorInvalidCount;
    return this.documents.size;
  }

  aggregate() {
    return { toArray: async () => this.aggregateResults };
  }

  async findOne() {
    return this.documents.get("vapp-v1") ?? null;
  }

  async insertOne(document: Record<string, unknown>) {
    this.mutationCount += 1;
    this.documents.set("vapp-v1", document);
  }

  async updateOne(_filter: unknown, update: { $set: Record<string, unknown> }) {
    this.mutationCount += 1;
    const existing = this.documents.get("vapp-v1");
    this.documents.set("vapp-v1", {
      ...existing,
      ...update.$set,
    });
    return { matchedCount: 1 };
  }
}

export class FakeDb {
  readonly collections = new Map<string, FakeCollection>();
  mutationCount = 0;

  listCollections() {
    return {
      toArray: async () =>
        [...this.collections].map(([name, collection]) => ({
          name,
          options: collection.options,
        })),
    };
  }

  async command(input: Record<string, unknown>) {
    this.mutationCount++;
    this.collection(input.collMod as string).options = {
      validator: input.validator,
      validationLevel: input.validationLevel,
      validationAction: input.validationAction,
    };
  }

  async createCollection(name: string, options: Record<string, unknown> = {}) {
    this.mutationCount += 1;
    const collection = new FakeCollection();
    collection.options = options;
    this.collections.set(name, collection);
    return collection;
  }

  collection(name: string) {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection();
      this.collections.set(name, collection);
    }
    return collection;
  }
}
