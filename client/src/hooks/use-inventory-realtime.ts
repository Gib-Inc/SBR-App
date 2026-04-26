import { useEffect, useRef } from "react";
import { queryClient } from "@/lib/queryClient";

// Subscribe to /ws/inventory and invalidate the supplied React Query keys
// whenever the server broadcasts an inventory-change event. Auto-reconnects
// with backoff so a brief network blip doesn't silently kill realtime.
//
// `queryKeys` should be the prefix-strings used in useQuery({queryKey: [...]})
// — anything starting with one of these prefixes is invalidated on receipt.
// Pass the most-specific prefix you can; "/api" alone would refetch the world.

type InventoryChangeMessage = {
  type: "inventory-changed";
  itemIds: string[];
  fields: string[];
  reason: string;
  ts: string;
};

export function useInventoryRealtime(queryKeyPrefixes: string[]) {
  // Pin the prefixes in a ref so the effect can read the latest list without
  // re-creating the WebSocket every render.
  const keysRef = useRef(queryKeyPrefixes);
  useEffect(() => {
    keysRef.current = queryKeyPrefixes;
  }, [queryKeyPrefixes]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    let stopped = false;

    const buildUrl = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${window.location.host}/ws/inventory`;
    };

    const connect = () => {
      if (stopped) return;
      ws = new WebSocket(buildUrl());

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as InventoryChangeMessage;
          if (msg.type !== "inventory-changed") return;
          // Invalidate every query whose key (first element, when string)
          // begins with one of the registered prefixes. React Query dedupes
          // refetches so multiple invalidations in a tight window collapse.
          for (const prefix of keysRef.current) {
            queryClient.invalidateQueries({
              predicate: (q) => {
                const k = q.queryKey[0];
                return typeof k === "string" && k.startsWith(prefix);
              },
            });
          }
        } catch {
          // Ignore malformed frames.
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        // Exponential backoff capped at 30s — covers brief network blips and
        // long server restarts without hammering the endpoint.
        attempt += 1;
        const delay = Math.min(30_000, 1_000 * Math.pow(2, Math.min(attempt, 5)));
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // The close handler will run next; let it schedule the reconnect.
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, []);
}
