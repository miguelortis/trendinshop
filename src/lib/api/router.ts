import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
} from "@/lib/api/auth";

type RouteContext = {
  method: string;
  segments: string[];
};

export async function apiRouter(request: Request, context: RouteContext): Promise<Response> {
  const method = context.method.toUpperCase();
  const [resource, action] = context.segments;

  if (method === "GET" && resource === "health") {
    return Response.json({
      ok: true,
      name: "trendinshop-api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  }

  if (method === "GET" && resource === "version") {
    return Response.json({ name: "TrendinShop", api: "0.1.0" });
  }

  if (resource === "auth") {
    if (method === "POST" && action === "register") return registerUser(request);
    if (method === "POST" && action === "login") return loginUser(request);
    if (method === "GET" && action === "me") return getCurrentUser(request);
    if (method === "POST" && action === "logout") return logoutUser();
  }

  return Response.json(
    {
      ok: false,
      error: "ROUTE_NOT_FOUND",
      message: "No existe una ruta para " + method + " /api/" + context.segments.join("/"),
    },
    { status: 404 },
  );
}
