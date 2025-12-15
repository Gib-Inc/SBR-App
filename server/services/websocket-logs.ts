import { WebSocketServer, WebSocket } from "ws";
import { type Server } from "node:http";
import type { AuditLog, SystemLog, AIBatchLog } from "@shared/schema";

type LogType = "audit" | "system" | "batch";

interface LogMessage {
  type: LogType;
  data: AuditLog | SystemLog | AIBatchLog;
}

class WebSocketLogsService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws/logs" });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      console.log(`[WebSocket] Client connected. Total clients: ${this.clients.size}`);

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(`[WebSocket] Client disconnected. Total clients: ${this.clients.size}`);
      });

      ws.on("error", (error) => {
        console.error("[WebSocket] Client error:", error.message);
        this.clients.delete(ws);
      });
    });

    console.log("[WebSocket] Logs WebSocket server initialized on /ws/logs");
  }

  broadcastLog(type: LogType, data: AuditLog | SystemLog | AIBatchLog) {
    if (!this.wss || this.clients.size === 0) return;

    const message: LogMessage = { type, data };
    const jsonMessage = JSON.stringify(message);

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(jsonMessage);
      }
    });
  }

  broadcastAuditLog(log: AuditLog) {
    this.broadcastLog("audit", log);
  }

  broadcastSystemLog(log: SystemLog) {
    this.broadcastLog("system", log);
  }

  broadcastBatchLog(log: AIBatchLog) {
    this.broadcastLog("batch", log);
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const wsLogsService = new WebSocketLogsService();
