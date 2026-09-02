import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const allowedOrigins = new Set([
  "https://yzyjoe.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:8095",
]);

const statusDescriptions: Record<string, string> = {
  submitted: "Pedido recebido. Aguardando atendimento.",
  accepted: "O agente assumiu o pedido e está falando com o vendedor.",
  purchased: "O produto foi comprado.",
  logistics: "A transportadora e o código de rastreio foram identificados.",
  warehouse: "O produto chegou ao armazém e está em inspeção de qualidade.",
  shipped: "O pedido foi enviado para o destino.",
  delivered: "Pedido entregue.",
  cancelled: "Pedido cancelado.",
};

function responseHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return true;
  if (!token) return false;

  const payload = new FormData();
  payload.set("secret", secret);
  payload.set("response", token);
  if (remoteIp && remoteIp !== "unknown") payload.set("remoteip", remoteIp);

  const verification = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: payload },
  );
  if (!verification.ok) return false;
  const result = await verification.json() as { success?: boolean };
  return result.success === true;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    if (origin && !allowedOrigins.has(origin)) {
      return jsonResponse({ error: "Origem não permitida." }, 403, origin);
    }
    const headers = responseHeaders(origin);
    (headers as Record<string, string>)["Access-Control-Allow-Headers"] = "content-type";
    (headers as Record<string, string>)["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    (headers as Record<string, string>)["Access-Control-Max-Age"] = "86400";
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405, origin);
  }
  if (origin && !allowedOrigins.has(origin)) {
    return jsonResponse({ error: "Origem não permitida." }, 403, origin);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 2048) {
    return jsonResponse({ error: "Solicitação inválida." }, 413, origin);
  }

  let payload: { code?: unknown; captchaToken?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitação inválida." }, 400, origin);
  }

  const code = String(payload.code || "").trim().toUpperCase();
  const captchaToken = String(payload.captchaToken || "").trim();
  if (!/^[A-Z0-9-]{6,32}$/.test(code)) {
    return jsonResponse({ error: "Código inválido." }, 400, origin);
  }

  const remoteIp = (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    "unknown"
  ).trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Serviço indisponível." }, 503, origin);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ipHash = await sha256(`ip:${remoteIp}`);
  const codeHash = await sha256(`code:${code}`);
  // Keep these calls sequential. A single client issuing concurrent privileged
  // RPCs occasionally receives a transient authorization failure at the edge.
  const ipLimit = await supabase.rpc("consume_tracking_rate_limit", {
    p_key_hash: ipHash,
  });
  const codeLimit = await supabase.rpc("consume_tracking_rate_limit", {
    p_key_hash: codeHash,
  });

  if (ipLimit.error || codeLimit.error) {
    console.error("tracking rate limit error", ipLimit.error || codeLimit.error);
    return jsonResponse({ error: "Serviço indisponível." }, 503, origin);
  }
  if (!ipLimit.data || !codeLimit.data) {
    return jsonResponse(
      { error: "Muitas consultas. Aguarde 10 minutos e tente novamente." },
      429,
      origin,
    );
  }

  if (!(await verifyTurnstile(captchaToken, remoteIp))) {
    return jsonResponse({ error: "Confirme que você não é um robô." }, 403, origin);
  }

  const orderResult = await supabase
    .from("orders")
    .select("id,order_code,product_name,model_code,image_url,status,updated_at")
    .ilike("order_code", code)
    .eq("public_tracking_enabled", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (orderResult.error) {
    console.error("tracking lookup error", orderResult.error);
    return jsonResponse({ error: "Serviço indisponível." }, 503, origin);
  }
  if (!orderResult.data) {
    await new Promise((resolve) => setTimeout(resolve, 220));
    return jsonResponse({ error: "Código não encontrado." }, 404, origin);
  }

  const eventsResult = await supabase
    .from("order_events")
    .select("status,description,occurred_at")
    .eq("order_id", orderResult.data.id)
    .order("occurred_at", { ascending: true });

  if (eventsResult.error) {
    console.error("tracking history error", eventsResult.error);
    return jsonResponse({ error: "Serviço indisponível." }, 503, origin);
  }

  const events = eventsResult.data || [];
  const latest = events.length ? events[events.length - 1] : null;
  const status = String(latest?.status || orderResult.data.status);
  const description = String(
    latest?.description || statusDescriptions[status] || "Atualização registrada.",
  );
  const occurredAt = String(latest?.occurred_at || orderResult.data.updated_at);

  return jsonResponse({
    order: {
      code: orderResult.data.order_code,
      product: orderResult.data.product_name,
      model: orderResult.data.model_code || "Não informado",
      image: orderResult.data.image_url || null,
      statusKey: status,
      statusPt: description,
      statusAt: occurredAt,
      history: events.map((event) => ({
        statusKey: event.status,
        statusPt: event.description,
        statusAt: event.occurred_at,
      })),
    },
  }, 200, origin);
});
