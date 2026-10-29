import { checkDatabase } from "./db-check";
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TENANT_COORDINATOR: DurableObjectNamespace;
  APP_SECRET?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  EMAIL_FROM?: string;
}

function jsonResponse(
  data: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self'; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self'; " +
        "font-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self'; " +
        "frame-ancestors 'none'"
    }
  });
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "METHOD_NOT_ALLOWED"
    }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Allow": allowed.join(", "),
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}
async function handleHealth(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed(["GET", "HEAD"]);
  }

  const result = await checkDatabase(env.DB);

  if (!result.connected) {
    return jsonResponse(
      {
        ok: false,
        service: "system-abr",
        database: "unavailable",
        error: "DATABASE_UNAVAILABLE"
      },
      503
    );
  }

  return jsonResponse({
    ok: true,
    service: "system-abr",
    database: "connected",
    timestamp: new Date().toISOString()
  });
}


async function handleApi(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  if (url.pathname === "/api/health") {
    const response = await handleHealth(request, env);

    if (request.method === "HEAD") {
      return new Response(null, {
        status: response.status,
        headers: response.headers
      });
    }

    return response;
  }

  if (url.pathname.startsWith("/api/")) {
    return jsonResponse(
      {
        ok: false,
        error: "API_ROUTE_NOT_IMPLEMENTED",
        message: "هذا المسار لم يتم تنفيذه بعد."
      },
      404
    );
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url = new URL(request.url);

    try {
      return await handleApi(request, env, url);
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "حدث خطأ داخلي. حاولي مرة أخرى."
        },
        500
      );
    }
  }
};

export class TenantCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (
      url.pathname === "/internal/health" &&
      request.method === "GET"
    ) {
      return jsonResponse({
        ok: true,
        service: "tenant-coordinator"
      });
    }

    return jsonResponse(
      {
        ok: false,
        error: "NOT_IMPLEMENTED"
      },
      501
    );
  }
}
