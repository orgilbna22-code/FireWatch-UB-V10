import { useCallback, useEffect, useState } from 'react';
import type { Language } from '../types';

export type ApiAvailabilityStatus = 'checking' | 'available' | 'unavailable';

export interface ApiHealthSnapshot {
  status: ApiAvailabilityStatus;
  hasGemini: boolean;
  checkedAtMs: number;
  error?: string;
}

export interface SafeFetchSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export interface SafeFetchFailure {
  ok: false;
  status: number;
  isApiMissing: boolean;
  error: string;
}

export type SafeFetchResult<T> = SafeFetchSuccess<T> | SafeFetchFailure;

/**
 * Resolves the optional VITE_API_BASE prefix cleanly without trailing slashes.
 */
export function normalizeApiBase(rawBase: string | undefined): string {
  const trimmed = (rawBase ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

export function buildApiUrl(path: string, baseOverride?: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const envBase =
    baseOverride !== undefined
      ? baseOverride
      : ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE ?? '');
  const base = normalizeApiBase(envBase);
  return base ? `${base}${cleanPath}` : cleanPath;
}

/**
 * Checks response Content-Type BEFORE parsing JSON so static-host HTML fallbacks
 * never throw raw errors like "Unexpected token '<'".
 */
export async function safeParseJsonResponse<T>(
  res: Response,
  language: Language = 'mn'
): Promise<SafeFetchResult<T>> {
  const isMn = language === 'mn';
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json') || contentType.includes('+json');

  if (!isJson) {
    // Static hosts (e.g. GitHub Pages) return text/html 404 or index.html on /api/*
    return {
      ok: false,
      status: res.status || 404,
      isApiMissing: true,
      error: isMn
        ? 'Энэ демо хувилбарт AI тайлбар болон хадгалалт идэвхгүй.'
        : 'AI explanation and server saving are disabled in this demo.',
    };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return {
      ok: false,
      status: res.status,
      isApiMissing: false,
      error: isMn
        ? 'Серверийн хариуг уншихад алдаа гарлаа. Дахин оролдоно уу.'
        : 'Could not read the server response. Please retry.',
    };
  }

  if (!res.ok) {
    const serverMsg =
      parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : '';

    let friendly = serverMsg;
    if (res.status === 429) {
      friendly = isMn
        ? 'Хэт олон хүсэлт илгээгдлээ. Түр хүлээгээд дахин оролдоно уу.'
        : 'Too many requests. Please wait a moment and try again.';
    } else if (res.status === 503) {
      friendly = isMn
        ? 'Энэ үйлчилгээ одоогоор тохируулагдаагүй эсвэл түр идэвхгүй байна.'
        : serverMsg || 'This service is currently unavailable on the server.';
    } else if (res.status === 504) {
      friendly = isMn
        ? 'Хүсэлтийн хугацаа дууслаа. Дахин оролдоно уу.'
        : 'Request timed out. Please retry.';
    } else if (!friendly) {
      friendly = isMn
        ? `Серверийн алдаа (HTTP ${res.status}). Дахин оролдоно уу.`
        : `Server error (HTTP ${res.status}). Please retry.`;
    }

    return {
      ok: false,
      status: res.status,
      isApiMissing: res.status === 404,
      error: friendly,
    };
  }

  return {
    ok: true,
    status: res.status,
    data: parsed as T,
  };
}

export async function safeFetchJson<T>(
  path: string,
  init: RequestInit = {},
  language: Language = 'mn',
  timeoutMs = 12_000
): Promise<SafeFetchResult<T>> {
  const isMn = language === 'mn';
  const controller = new AbortController();
  const timer =
    typeof globalThis.setTimeout === 'function'
      ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const url = path.startsWith('http://') || path.startsWith('https://') ? path : buildApiUrl(path);
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    });
    return await safeParseJsonResponse<T>(res, language);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      isApiMissing: !isAbort,
      error: isAbort
        ? isMn
          ? 'Серверийн хариу удааширлаа. Дахин оролдоно уу.'
          : 'Request timed out. Please try again.'
        : isMn
          ? 'Сервертэй холбогдож чадсангүй.'
          : 'Unable to reach the backend API.',
    };
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

type Listener = (snap: ApiHealthSnapshot) => void;

class ApiAvailabilityStore {
  private snapshot: ApiHealthSnapshot = {
    status: 'checking',
    hasGemini: false,
    checkedAtMs: 0,
  };
  private listeners = new Set<Listener>();
  private inflight: Promise<ApiHealthSnapshot> | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  getSnapshot(): ApiHealthSnapshot {
    return this.snapshot;
  }

  private emit(next: ApiHealthSnapshot) {
    this.snapshot = next;
    for (const fn of this.listeners) fn(next);
  }

  markUnavailable(error?: string) {
    if (this.snapshot.status === 'unavailable') return;
    this.emit({
      status: 'unavailable',
      hasGemini: false,
      checkedAtMs: Date.now(),
      error,
    });
  }

  async check(force = false, language: Language = 'mn'): Promise<ApiHealthSnapshot> {
    const age = Date.now() - this.snapshot.checkedAtMs;
    if (!force && this.snapshot.checkedAtMs > 0 && age < 60_000) {
      return this.snapshot;
    }
    if (this.inflight && !force) return this.inflight;

    const run = (async () => {
      const result = await safeFetchJson<{ ok?: boolean; hasGemini?: boolean }>(
        '/api/health',
        {},
        language,
        6_000
      );
      if (result.ok && result.data.ok) {
        const next: ApiHealthSnapshot = {
          status: 'available',
          hasGemini: Boolean(result.data.hasGemini),
          checkedAtMs: Date.now(),
        };
        this.emit(next);
        return next;
      }
      const next: ApiHealthSnapshot = {
        status: 'unavailable',
        hasGemini: false,
        checkedAtMs: Date.now(),
        error: result.ok ? 'Health check returned ok=false' : result.error,
      };
      this.emit(next);
      return next;
    })().finally(() => {
      if (this.inflight === run) this.inflight = null;
    });

    this.inflight = run;
    return run;
  }
}

export const apiAvailability = new ApiAvailabilityStore();

export function useApiAvailability(language: Language = 'mn') {
  const [snapshot, setSnapshot] = useState<ApiHealthSnapshot>(() => apiAvailability.getSnapshot());

  useEffect(() => {
    const unsub = apiAvailability.subscribe(setSnapshot);
    void apiAvailability.check(false, language);
    return unsub;
  }, [language]);

  const recheck = useCallback(() => {
    return apiAvailability.check(true, language);
  }, [language]);

  return { ...snapshot, recheck };
}
