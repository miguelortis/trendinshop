import mongoose from "mongoose";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache =
  global.mongooseCache ?? {
    conn: null,
    promise: null,
  };

global.mongooseCache = cached;

function requireEnv(name: "MONGODB_URI" | "MONGODB_DB"): string {
  const value = process.env[name];

  if (typeof value !== "string") {
    throw new Error(`${name} no está configurada.`);
  }

  const normalized = value.trim().replace(/^['"]|['"]$/g, "");

  if (!normalized) {
    throw new Error(`${name} no puede estar vacía.`);
  }

  return normalized;
}

function requireMongoUri(): string {
  const uri = requireEnv("MONGODB_URI");

  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error(
      'MONGODB_URI debe comenzar exactamente con "mongodb://" o "mongodb+srv://". Revisa la variable en Vercel.',
    );
  }

  return uri;
}

export async function connectMongoDB() {
  if (cached.conn) {
    return cached.conn;
  }

  const mongoUri = requireMongoUri();
  const databaseName = requireEnv("MONGODB_DB");

  if (!cached.promise) {
    cached.promise = mongoose.connect(mongoUri, {
      bufferCommands: false,
      dbName: databaseName,
      authSource: "admin",
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
