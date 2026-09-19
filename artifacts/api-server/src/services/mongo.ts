import { MongoClient, type ClientSession, type Db } from "mongodb";

export const DATABASE_NAME = "vamberic_studio";

export interface MongoService {
  isAvailable(): Promise<boolean>;
  database(): Promise<Db>;
  close(): Promise<void>;
  withTransaction?<T>(
    work: (db: Db, session: ClientSession) => Promise<T>,
  ): Promise<T>;
}

export class MongoClientService implements MongoService {
  private readonly client: MongoClient;
  private connectionPromise: Promise<MongoClient> | undefined;

  constructor(uri: string) {
    this.client = new MongoClient(uri, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = await this.connect();
      await client.db(DATABASE_NAME).command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async database(): Promise<Db> {
    const client = await this.connect();
    return client.db(DATABASE_NAME);
  }

  async withTransaction<T>(
    work: (db: Db, session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const client = await this.connect();
    const session = client.startSession();
    try {
      return await session.withTransaction(
        () => work(client.db(DATABASE_NAME), session),
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          maxCommitTimeMS: 10000,
        },
      );
    } finally {
      await session.endSession();
    }
  }

  async close(): Promise<void> {
    if (!this.connectionPromise) {
      return;
    }

    await this.connectionPromise.catch(() => undefined);
    await this.client.close();
    this.connectionPromise = undefined;
  }

  private connect(): Promise<MongoClient> {
    if (!this.connectionPromise) {
      this.connectionPromise = this.client.connect().catch((error: unknown) => {
        this.connectionPromise = undefined;
        throw error;
      });
    }

    return this.connectionPromise;
  }
}
