"use client";

import { useEffect, useState } from "react";

export interface PickProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  costPriceKobo: number;
}

/**
 * Search products on the server as someone types, a short pause after the
 * last key. Only a dozen matches come back, however big the catalogue.
 */
export function useProductSearch(query: string) {
  const [results, setResults] = useState<PickProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      const id = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(id);
    }
    const controller = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/products/pick?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = (await res.json()) as { items?: PickProduct[] };
        setResults(data.items ?? []);
      } catch {
        /* a newer search replaced this one, or the network dropped */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [query]);

  return { results, loading };
}

/** Find the product with exactly this barcode (a scan). */
export async function findByBarcode(code: string): Promise<PickProduct | null> {
  try {
    const res = await fetch(`/api/products/pick?barcode=${encodeURIComponent(code.trim())}`);
    const data = (await res.json()) as { items?: PickProduct[] };
    return data.items?.[0] ?? null;
  } catch {
    return null;
  }
}
