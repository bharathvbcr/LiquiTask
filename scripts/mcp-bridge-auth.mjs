/**
 * Shared HMAC envelope helpers for the LiquiTask MCP file bridge.
 * Rust (`agent_mcp.rs`) signs with the same v1 envelope format.
 */
import crypto from "node:crypto";
import fs from "node:fs";

export const MCP_AUTH_VERSION = 1;

/** @param {string} secret @param {string} body */
export function hmacHex(secret, body) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** @param {unknown} payload */
export function stablePayloadJson(payload) {
  return JSON.stringify(payload);
}

/**
 * @param {string} secret
 * @param {Record<string, unknown>} payload
 */
export function wrapSignedPayload(secret, payload) {
  const body = stablePayloadJson(payload);
  return {
    v: MCP_AUTH_VERSION,
    mac: hmacHex(secret, body),
    payload,
  };
}

/**
 * @param {string} secret
 * @param {unknown} envelope
 * @returns {Record<string, unknown> | null}
 */
export function unwrapSignedPayload(secret, envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }
  const { v, mac, payload } = envelope;
  if (v !== MCP_AUTH_VERSION || typeof mac !== "string" || !payload || typeof payload !== "object") {
    return null;
  }
  const body = stablePayloadJson(payload);
  const expected = hmacHex(secret, body);
  if (mac.length !== expected.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(mac, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }
  return /** @type {Record<string, unknown>} */ (payload);
}

/**
 * Legacy (pre-auth) responses were raw JSON objects without an envelope.
 * @param {unknown} parsed
 */
export function isLegacyUnsignedResponse(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  return !("v" in parsed) && !("mac" in parsed);
}

/**
 * @param {unknown} response
 */
export function isPermissionAllowResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  const content = /** @type {{ content?: unknown }} */ (response).content;
  if (!Array.isArray(content) || content.length === 0) return false;
  const first = content[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return false;
  const text = /** @type {{ text?: unknown }} */ (first).text;
  if (typeof text !== "string") return false;
  try {
    const parsed = JSON.parse(text);
    return parsed?.behavior === "allow";
  } catch {
    return false;
  }
}

/**
 * Response MAC binds to the inflight request identity so a co-located agent
 * cannot replay or swap approvals across requests.
 *
 * @param {string} secret
 * @param {{ requestId: string, tool: string, expiresAt: number, appOriginated?: boolean, response: unknown }} bound
 */
export function wrapBoundResponse(secret, bound) {
  return wrapSignedPayload(secret, {
    requestId: bound.requestId,
    tool: bound.tool,
    expiresAt: bound.expiresAt,
    appOriginated: bound.appOriginated === true,
    response: bound.response,
  });
}

/**
 * @param {string} secret
 * @param {unknown} envelope
 * @param {{ requestId: string, tool: string, expiresAt: number }} expected
 * @returns {unknown | null}
 */
export function unwrapBoundResponse(secret, envelope, expected) {
  const payload = unwrapSignedPayload(secret, envelope);
  if (!payload) return null;
  if (payload.requestId !== expected.requestId) return null;
  if (payload.tool !== expected.tool) return null;
  if (payload.expiresAt !== expected.expiresAt) return null;
  if (typeof payload.expiresAt === "number" && Date.now() > payload.expiresAt) return null;
  const response = payload.response;
  if (
    expected.tool === "permission_prompt" &&
    isPermissionAllowResponse(response) &&
    payload.appOriginated !== true
  ) {
    return null;
  }
  return response;
}

/**
 * @param {string} inflightPath
 * @returns {{ requestId: string, tool: string, expiresAt: number } | null}
 */
export function readInflightBinding(inflightPath) {
  if (!inflightPath) return null;
  try {
    const raw = fs.readFileSync(inflightPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.request && typeof parsed.request === "object") {
      const request = parsed.request;
      return {
        requestId: String(request.requestId ?? ""),
        tool: String(request.tool ?? ""),
        expiresAt: Number(parsed.expiresAt ?? 0),
      };
    }
    return {
      requestId: String(parsed.requestId ?? ""),
      tool: String(parsed.tool ?? ""),
      expiresAt: Number(parsed.expiresAt ?? 0),
    };
  } catch {
    return null;
  }
}
