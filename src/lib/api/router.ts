import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
} from "@/lib/api/auth";
import { getAuthenticatedUser, unauthorized } from "@/lib/api/auth-context";
import { createCategory, getProductById, listCategories, listProducts } from "@/lib/api/catalog";
import { createProduct, updateProduct } from "@/lib/api/products";
import {
  addResellerCatalogItem,
  listResellerCatalog,
  removeResellerCatalogItem,
  updateResellerCatalogItem,
} from "@/lib/api/reseller-catalog";
import { adjustInventory, listInventory } from "@/lib/api/inventory";
import { createCustomer, listCustomers, removeCustomer, updateCustomer } from "@/lib/api/customers";
import { createSale, getSaleOptions, listSales } from "@/lib/api/sales";
import { listPayments, listReceivables, registerPayment } from "@/lib/api/payments";
import { bootstrapAdmin } from "@/lib/api/setup";
import {
  cleanupCurrentUserPendingImages,
  deleteBlob,
  importImageFromUrl,
  prepareBlobUpload,
} from "@/lib/api/blob";

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

  if (resource === "catalog") {
    if (method === "GET") return listResellerCatalog(user.id, user.role);
    if (method === "POST" && !action) return addResellerCatalogItem(request, user.id, user.role);
    if ((method === "PATCH" || method === "PUT") && action) {
      return updateResellerCatalogItem(request, action, user.id, user.role);
    }
    if (method === "DELETE" && action) {
      return removeResellerCatalogItem(action, user.id, user.role);
    }
  }

  if (resource === "products") {
    if (method === "GET" && action) return getProductById(action, user.role);
    if (method === "GET") return listProducts(user.role);
    if (method === "POST") return createProduct(request, user.id, user.role);
    if (method === "PUT" && action) return updateProduct(request, action, user.id, user.role);
  }

  if (resource === "sales") {
    if (method === "GET" && action === "options") return getSaleOptions(user.id, user.role);
    if (method === "GET" && !action) return listSales(user.id, user.role);
    if (method === "POST" && !action) return createSale(request, user.id, user.role);
  }

  if (resource === "receivables" && method === "GET") {
    return listReceivables(user.id);
  }

  if (resource === "payments") {
    if (method === "GET") return listPayments(user.id);
    if (method === "POST" && !action) return registerPayment(request, user.id);
  }

  if (resource === "customers") {
    if (method === "GET") return listCustomers(user.id);
    if (method === "POST" && !action) return createCustomer(request, user.id);
    if ((method === "PUT" || method === "PATCH") && action) {
      return updateCustomer(request, action, user.id);
    }
    if (method === "DELETE" && action) return removeCustomer(action, user.id);
  }

  if (resource === "inventory") {
    if (method === "GET") return listInventory(user.role);
    if (method === "POST" && action === "adjust") {
      return adjustInventory(request, user.id, user.role);
    }
  }

  if (resource === "setup" && action === "admin" && method === "POST") {
    return bootstrapAdmin(request);
  }

  if (resource === "blob") {
    if (action === "upload" && method === "POST") return prepareBlobUpload(request);
    if (action === "import" && method === "POST") return importImageFromUrl(request);
    if (action === "cleanup-pending" && method === "POST") {
      return cleanupCurrentUserPendingImages(request);
    }
    if (action === "delete" && method === "POST") return deleteBlob(request);
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
