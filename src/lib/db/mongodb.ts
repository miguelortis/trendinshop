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

function getMongoUri() {
  const raw = process.env.MONGODB_URI?.trim();

  if (!raw) {
    throw new Error("MONGODB_URI no está configurada.");
  }

  // Evita errores comunes al copiar una URI a Vercel con comillas alrededor.
  const uri = raw.replace(/^(['"])|(['"])$/g, "");

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

  if (!cached.promise) {
    cached.promise = mongoose.connect(getMongoUri(), {
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
