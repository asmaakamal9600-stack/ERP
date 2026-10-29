
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TENANT_COORDINATOR: DurableObjectNamespace;

  // Secrets will be configured in Cloudflare later.
  APP_SECRET?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  EMAIL_FROM?: string;
}

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
      ...extraHeaders
    }
  });
}

function securityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function healthCheck(env: Env): Promise<Response> {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();

    return jsonResponse({
      success: true,
      service: "System ABR",
      status: "available",
      database: "connected"
    });
  } catch {
    // Do not expose database errors or configuration secrets.
    return jsonResponse(
      {
        success: false,
        service: "System ABR",
        status: "degraded",
        database: "unavailable"
      },
      503
    );
  }
}

async function handleApi(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  if (url.pathname === "/api/health" && request.method === "GET") {
    return healthCheck(env);
  }

  if (url.pathname === "/api/health" && request.method === "HEAD") {
    const response = await healthCheck(env);

    return new Response(null, {
      status: response.status,
      headers: response.headers
    });
  }

  return jsonResponse(
    {
      success: false,
      error: "NOT_FOUND",
      message: "مسار API غير موجود."
    },
    404
  );
}

async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, env, url);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse(
      {
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "طريقة الطلب غير مسموح بها."
      },
      405,
      { Allow: "GET, HEAD" }
    );
  }

  const assetResponse = await env.ASSETS.fetch(request);
  return securityHeaders(assetResponse);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch {
      // Avoid exposing stack traces, SQL details, or secrets.
      return jsonResponse(
        {
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "حدث خطأ داخلي. حاولي مرة أخرى."
        },
        500
      );
    }
  }
};

/**
 * Durable Object foundation.
 * This class is intentionally not yet used for financial operations.
 * Its coordination logic will be added only when the relevant API
 * and concurrency requirements are implemented.
 */
export class TenantCoordinator {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly _env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      url.pathname === "/internal/health"
    ) {
      return jsonResponse({
        success: true,
        service: "System ABR coordinator",
        status: "available"
      });
    }

    return jsonResponse(
      {
        success: false,
        error: "NOT_IMPLEMENTED",
        message: "هذه العملية لم تُنفذ بعد."
      },
      501
    );
  }
}
