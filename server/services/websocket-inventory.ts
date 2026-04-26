// Realtime inventory broadcaster. Mirrors websocket-logs.ts but on its own
// /ws/inventory path so audit-log clients don't have to filter out item
// updates and vice versa.
//
// Server emits one message per InventoryMovement.apply success and per
// direct field write (count-inventory submit, write-off, receive-stock).
// Clients subscribe via the useInventoryRealtime hook and invalidate React
// Query caches on receipt — the UI re-fetches the affected pages without a
// manual refresh.

import { WebSocketServer, WebSocket } from "ws";
import { type Server } from "node:http";

export type InventoryChangeReason =
  | "MOVEMENT"           // generic InventoryMovement.apply
  | "COUNT"              // /api/count-inventory/submit
  | "WRITEOFF"           // /api/inventory/writeoff
  | "RECEIVE"            // /api/receive-stock
  | "TRANSFER"           // hildale → pyvott transfer
  | "SHIP";              // sales-order ship path

export type InventoryChangeMessage = {
  type: "inventory-changed";
  itemIds: string[];          // affected items (one or many)
  fields: string[];           // which item fields changed (e.g. ["hildaleQty","extensivOnHandSnapshot"])
  reason: InventoryChangeReason;
  ts: string;                 // ISO timestamp
};

class WebSocketInventoryService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws/inventory" });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      console.log(`[WebSocket Inventory] Client connected. Total: ${this.clients.size}`);

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(`[WebSocket Inventory] Client disconnected. Total: ${this.clients.size}`);
      });

      ws.on("error", (err) => {
        console.error("[WebSocket Inventory] Client error:", err.message);
        this.clients.delete(ws);
      });
    });

    console.log("[WebSocket Inventory] Server initialized on /ws/inventory");
  }

  broadcast(payload: Omit<InventoryChangeMessage, "type" | "ts">) {
    if (!this.wss || this.clients.size === 0) return;
    const message: InventoryChangeMessage = {
      type: "inventory-changed",
      ts: new Date().toISOString(),
      ...payload,
    };
    const json = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(json);
        } catch (err) {
          console.error("[WebSocket Inventory] Send failed:", err);
        }
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const wsInventoryService = new WebSocketInventoryService();
