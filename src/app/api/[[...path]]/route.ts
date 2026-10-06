import { apiRouter } from "@/lib/api/router";

type RouteProps = {
  params: Promise<{ path?: string[] }>;
};

async function handle(request: Request, { params }: RouteProps) {
  const { path = [] } = await params;
  return apiRouter(request, {
    method: request.method,
    segments: path,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
