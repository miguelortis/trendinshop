import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
} from "@/lib/api/auth";
import { getAuthenticatedUser, unauthorized } from "@/lib/api/auth-context";
import { createCategory, listCategories, listProducts } from "@/lib/api/catalog";
import { createProduct } from "@/lib/api/products";
import { adjustInventory, listInventory } from "@/lib/api/inventory";

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

  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  if (resource === "categories") {
    if (method === "GET") return listCategories();
    if (method === "POST") return createCategory(request, user.role);
  }

  if (resource === "products") {
    if (method === "GET") return listProducts();
    if (method === "POST") return createProduct(request, user.id, user.role);
  }

  if (resource === "inventory") {
    if (method === "GET") return listInventory();
    if (method === "POST" && action === "adjust") {
      return adjustInventory(request, user.id, user.role);
    }
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
