// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Durable key-value store — the monitor's system of record.
 *
 * In-host the backend is the host **`host.data`** extension
 * (`hostLocalStorage`), an async host-RPC store that survives reload, device
 * sleep, and webview storage eviction. Standalone/dev falls back to browser
 * `localStorage`; if neither is available (e.g. early WkWebView startup) an
 * in-memory map is used so the app never hard-crashes on a storage gap.
 *
 * All backends expose the same async `KvStore` so the monitors stay async
 * end-to-end and the backing store can be swapped (incl. in tests).
 */
import { hostLocalStorage } from "@/shared/api/host/host-api.ts";
import { isInHost } from "@/shared/api/host/connection.ts";

export const KV_SCOPE = "w3s-payment-processor";

export interface KvStore {
  getJSON<T>(key: string): Promise<T | undefined>;
  setJSON(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createHostKvStore(prefix: string = KV_SCOPE): KvStore {
  return {
    async getJSON<T>(key: string): Promise<T | undefined> {
      try {
        const value = await hostLocalStorage.readJSON(`${prefix}:${key}`);
        return value == null ? undefined : (value as T);
      } catch {
        return undefined;
      }
    },
    async setJSON(key: string, value: unknown): Promise<void> {
      await hostLocalStorage.writeJSON(`${prefix}:${key}`, value);
    },
    async remove(key: string): Promise<void> {
      await hostLocalStorage.clear(`${prefix}:${key}`);
    },
  };
}

export function createBrowserKvStore(prefix: string = KV_SCOPE): KvStore {
  return {
    async getJSON<T>(key: string): Promise<T | undefined> {
      const raw = window.localStorage.getItem(`${prefix}:${key}`);
      if (raw == null) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    },
    async setJSON(key: string, value: unknown): Promise<void> {
      window.localStorage.setItem(`${prefix}:${key}`, JSON.stringify(value));
    },
    async remove(key: string): Promise<void> {
      window.localStorage.removeItem(`${prefix}:${key}`);
    },
  };
}

/**
 * In-memory KV over a JSON-serialized map. Used as the last-resort backend and
 * as a test seam — passing the same `backing` map to two stores simulates a
 * durable reload (write, re-instantiate, read).
 */
export function createMemoryKvStore(backing: Map<string, string> = new Map(), prefix: string = KV_SCOPE): KvStore {
  return {
    async getJSON<T>(key: string): Promise<T | undefined> {
      const raw = backing.get(`${prefix}:${key}`);
      return raw == null ? undefined : (JSON.parse(raw) as T);
    },
    async setJSON(key: string, value: unknown): Promise<void> {
      backing.set(`${prefix}:${key}`, JSON.stringify(value));
    },
    async remove(key: string): Promise<void> {
      backing.delete(`${prefix}:${key}`);
    },
  };
}

export function resolveKvStore(prefix: string = KV_SCOPE): KvStore {
  if (isInHost()) return createHostKvStore(prefix);
  if (typeof window !== "undefined" && hasLocalStorage()) return createBrowserKvStore(prefix);
  return createMemoryKvStore(new Map(), prefix);
}

function hasLocalStorage(): boolean {
  try {
    return typeof window.localStorage !== "undefined";
  } catch {
    // Some webviews throw on `localStorage` access before bridge init.
    return false;
  }
}
