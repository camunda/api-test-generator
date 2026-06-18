/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH under
 * one or more contributor license agreements. See the NOTICE file distributed
 * with this work for additional information regarding copyright ownership.
 * Licensed under the Camunda License 1.0. You may not use this file
 * except in compliance with the Camunda License 1.0.
 */

// Vendored support file. Read and (optionally) edit if you need to customize
// auth or base URL handling — this file is regenerated on each codegen run
// and any edits will be overwritten unless you remove the materializer call.

const DEFAULT_BASE_URL = 'http://localhost:8080';

export interface Credentials {
  baseUrl: string;
  username?: string;
  password?: string;
}

function loadCredentials(): Credentials {
  return {
    baseUrl: process.env.CORE_APPLICATION_URL ?? DEFAULT_BASE_URL,
    username: process.env.CAMUNDA_BASIC_AUTH_USER || undefined,
    password: process.env.CAMUNDA_BASIC_AUTH_PASSWORD || undefined,
  };
}

export const credentials: Credentials = loadCredentials();

/**
 * Credentials for the read-side RBAC deny-test probe user (#359) — a non-admin
 * user with NO grants, created by the suite global-setup. Deny-tests authenticate
 * as this user so an authorizations-enabled server rejects the request. Defaults
 * to `rbac-deny-probe` / a fixed dev password; override via env for CI.
 */
export interface ProbeCredentials {
  username: string;
  password: string;
}

export const denyProbeCredentials: ProbeCredentials = {
  username: process.env.RBAC_DENY_PROBE_USER || 'rbac-deny-probe',
  password: process.env.RBAC_DENY_PROBE_PASSWORD || 'rbac-deny-probe-pw',
};

/**
 * Reduced-permission Bearer token for the deny probe in `authDenyMode:
 * 'all-secured'` (e.g. Camunda Hub): a token that authenticates (valid signature
 * + audience, so it passes the 401 gate) but lacks the operation's required
 * permission, so the server denies it with 403. Minted from a Keycloak client
 * scoped without the public-api authorities — see docker/start-hub.sh. When
 * unset, deny-tests fall back to the Basic-auth zero-grant probe user (OCA).
 */
export const denyProbeBearerToken: string | undefined =
  process.env.RBAC_DENY_PROBE_BEARER_TOKEN || undefined;

let partialCredsWarned = false;

function encode(value: string): string {
  return Buffer.from(value).toString('base64');
}

/** Basic-auth header for an arbitrary user (used by the RBAC deny probe). */
export function basicAuthHeaders(username: string, password: string): Record<string, string> {
  return { Authorization: `Basic ${encode(`${username}:${password}`)}` };
}

/**
 * Authorization header for the RBAC deny-test probe — a principal that lacks the
 * operation's permission so an authorizations-enabled server denies it with 403.
 * Never the admin.
 *
 * Bearer when `RBAC_DENY_PROBE_BEARER_TOKEN` is set (the `all-secured` mode, e.g.
 * Hub — a reduced-permission token minted from Keycloak); otherwise the Basic-auth
 * zero-grant probe user the suite global-setup provisions (the OCA read-side slice).
 */
export function denyProbeHeaders(): Record<string, string> {
  if (denyProbeBearerToken) return { Authorization: `Bearer ${denyProbeBearerToken}` };
  return basicAuthHeaders(denyProbeCredentials.username, denyProbeCredentials.password);
}

/**
 * Build the Authorization header from configured credentials.
 *
 * Basic auth (CAMUNDA_BASIC_AUTH_USER / CAMUNDA_BASIC_AUTH_PASSWORD) takes
 * precedence when set. BEARER_TOKEN is used only when Basic creds are absent
 * AND RV_PROFILE is not 'rbac' — the rbac suite relies on Basic-only auth;
 * a stray BEARER_TOKEN in the environment must not silently satisfy it.
 * Returns an empty object when no credentials are supplied so the suite
 * can run unauthenticated against dev clusters without manual editing.
 */
export function authHeaders(): Record<string, string> {
  const { username, password } = credentials;
  if (username && password) return { Authorization: `Basic ${encode(`${username}:${password}`)}` };
  if ((username || password) && !partialCredsWarned) {
    partialCredsWarned = true;
    console.warn(
      '[auth] Only one of CAMUNDA_BASIC_AUTH_USER / CAMUNDA_BASIC_AUTH_PASSWORD is set — Basic auth requires both. The partial credential is ignored.',
    );
  }
  const bearerToken = process.env.BEARER_TOKEN;
  if (bearerToken && process.env.RV_PROFILE !== 'rbac') return { Authorization: `Bearer ${bearerToken}` };
  return {};
}

export function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...authHeaders(),
  };
}
