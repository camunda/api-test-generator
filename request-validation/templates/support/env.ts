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

function encode(value: string): string {
  return Buffer.from(value).toString('base64');
}

/**
 * Build the Authorization header from configured credentials.
 *
 * Returns an empty object when no credentials are supplied so the suite
 * can run unauthenticated against dev clusters without manual editing.
 */
export function authHeaders(): Record<string, string> {
  const { username, password } = credentials;
  if (!username || !password) return {};
  return { Authorization: `Basic ${encode(`${username}:${password}`)}` };
}

export function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...authHeaders(),
  };
}
