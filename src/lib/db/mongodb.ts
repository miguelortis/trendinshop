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

function requireMongoUri(): string {
  const value = process.env.MONGODB_URI;

  if (typeof value !== "string") {
    throw new Error("MONGODB_URI no está configurada.");
  }

  const uri = value.trim().replace(/^['"]|['"]$/g, "");

  if (!uri) {
    throw new Error("MONGODB_URI no puede estar vacía.");
  }

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

  const mongoUri: string = requireMongoUri();

  if (!cached.promise) {
    cached.promise = mongoose.connect(mongoUri, {
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
