import { MongoClient } from "mongodb";

const DATABASE_NAME = "vamberic_studio";

export interface MongoService {
  isAvailable(): Promise<boolean>;
  close(): Promise<void>;
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
