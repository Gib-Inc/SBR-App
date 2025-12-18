# StickerBurrRoller Inventory App - API Specification

## A) Summary

| Attribute | Value |
|-----------|-------|
| **Framework** | Express.js (Node.js with TypeScript) |
| **Entrypoint** | `server/routes.ts` |
| **Base URL** | `https://hqdpdm.spock.replit.dev` (or localhost:5000 in dev) |
| **Total Endpoints** | 322 HTTP endpoints |
| **Database** | PostgreSQL (Neon serverless via `@neondatabase/serverless`) |
| **ORM** | Drizzle ORM |
| **Auth Approach** | Session-based authentication with `express-session` + `connect-pg-simple` |

### Authentication Methods

1. **Session Cookie Auth** (Primary)
   - Login via `POST /api/auth/login` returns session cookie
   - Most endpoints require `requireAuth` middleware (checks `req.session.userId`)
   - Cookie name: `connect.sid`

2. **X-GHL-Secret Header** (GHL Custom Actions)
   - Used for GHL AI Agent custom action webhooks
   - Header: `X-GHL-Secret: <shared_secret>`
   - Validated against `GHL_WEBHOOK_SECRET` env var or integration config

3. **HMAC Signature Verification** (Webhooks)
   - Shopify: `X-Shopify-Hmac-Sha256` header
   - Extensiv: Optional signature via `EXTENSIV_WEBHOOK_SECRET`
   - SendGrid: Event webhooks (signature verification recommended)

### Secrets Storage

All secrets stored as environment variables:
- `DATABASE_URL`, `SESSION_SECRET`
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_STORE_DOMAIN`
- `GOHIGHLEVEL_API_KEY`, `GHL_WEBHOOK_SECRET`
- `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`
- `SENDGRID_API_KEY`
- `OPENAI_API_KEY`
- `SHIPPO_API_KEY`

---

## B) Endpoint Catalog

### Authentication Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | None | Create new user account |
| POST | `/api/auth/login` | None | Login with email/password |
| GET | `/api/auth/me` | Session | Get current user info |
| POST | `/api/auth/logout` | Session | End session |

### Items (Inventory Products)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/items` | Session | List all items (components & finished products) |
| GET | `/api/items/critical-order` | Session | Get items needing reorder |
| GET | `/api/items/:id` | Session | Get single item details |
| POST | `/api/items` | Session | Create new item |
| PATCH | `/api/items/:id` | Session | Update item fields |
| DELETE | `/api/items/:id` | Session | Delete item |
| POST | `/api/items/:id/auto-suggest-cost` | Session | AI-scrape cost from supplier URL |

### Inventory Operations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/inventory/scan` | Session | Process barcode scan (adjust inventory) |
| POST | `/api/scans/ingest` | Session | Bulk ingest scanned data |
| POST | `/api/logs/inventory-adjustment` | Session | Log manual inventory adjustment |

### Sales Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/sales-orders` | Session | List sales orders with filters |
| GET | `/api/sales-orders/:id` | Session | Get single sales order |
| POST | `/api/sales-orders` | Session | Create sales order |
| PATCH | `/api/sales-orders/:id` | Session | Update sales order |
| DELETE | `/api/sales-orders/:id` | Session | Delete sales order |
| POST | `/api/sales-orders/:id/ship` | Session | Mark order as shipped |
| POST | `/api/sales-orders/:id/fulfill` | Session | Mark order as fulfilled |
| POST | `/api/sales-orders/:id/cancel` | Session | Cancel order |
| POST | `/api/sales-orders/:id/link-ghl-contact` | Session | Link to GHL contact |
| POST | `/api/sales-orders/backfill-addresses` | Session | Backfill missing addresses |
| POST | `/api/sales-orders/backfill-line-items` | Session | Backfill line items from Shopify |

### Returns & Refunds

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/returns` | Session | List all returns |
| GET | `/api/returns/:id` | Session | Get return details |
| GET | `/api/returns/:id/details` | Session | Get return with line items |
| GET | `/api/returns/:id/events` | Session | Get return audit events |
| GET | `/api/returns/pending-item-ids` | Session | Get items with pending returns |
| POST | `/api/returns` | Session | Create return request |
| POST | `/api/returns/request` | Session | Request a return (alias) |
| POST | `/api/returns/from-sales-order` | Session | Create return from sales order |
| POST | `/api/returns/:id/label` | Session | Generate return shipping label |
| POST | `/api/returns/:id/create-label` | Session | Create label (Shippo) |
| POST | `/api/returns/:id/receive` | Session | Mark return as received at warehouse |
| POST | `/api/returns/:id/assess-damage` | Session | Assess damage on returned items |
| POST | `/api/returns/:id/mark-refund-pending` | Session | Transition to refund pending |
| POST | `/api/returns/:id/mark-refund-completed` | Session | Complete refund |
| POST | `/api/returns/:id/close` | Session | Close the return |
| POST | `/api/returns/:id/post-to-quickbooks` | Session | Create QB Credit Memo |
| POST | `/api/returns/:id/print-receipt` | Session | Print return receipt |
| POST | `/api/returns/upload-damage-photo` | Session | Upload damage photo |
| POST | `/api/returns/cleanup-ghl-opportunities` | Session | Clean orphaned GHL opportunities |
| POST | `/api/returns/create-from-ghl` | X-GHL-Secret | Create return via GHL webhook |
| POST | `/api/ghl/custom-actions/create-return-label` | X-GHL-Secret | GHL AI Agent: Create return label |
| GET | `/api/integrations/ghl/returns/status` | None | Check return status for GHL |
| POST | `/api/integrations/ghl/returns/create` | None | Create return from GHL |

### Purchase Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/purchase-orders` | Session | List all POs |
| GET | `/api/purchase-orders/summary` | Session | Get PO summary stats |
| GET | `/api/purchase-orders/next-number` | Session | Get next PO number |
| GET | `/api/purchase-orders/:id` | Session | Get single PO |
| GET | `/api/purchase-orders/:id/composite` | Session | Get PO with lines & receipts |
| GET | `/api/purchase-orders/:id/receipts` | Session | Get PO receipts |
| GET | `/api/purchase-orders/:id/pdf` | Session | Generate PO PDF |
| GET | `/api/purchase-orders/:id/bill-status` | Session | Get QB bill status |
| GET | `/api/purchase-orders/by-token/:token` | None | Public: Get PO by ack token |
| POST | `/api/purchase-orders` | Session | Create new PO |
| POST | `/api/purchase-orders/create-and-send` | Session | Create PO and send email |
| POST | `/api/purchase-orders/:id/lines` | Session | Add line items to PO |
| POST | `/api/purchase-orders/:id/approve` | Session | Approve PO |
| POST | `/api/purchase-orders/:id/reject` | Session | Reject PO |
| POST | `/api/purchase-orders/:id/send` | Session | Send PO to supplier via email |
| POST | `/api/purchase-orders/:id/mark-sent` | Session | Manually mark as sent |
| POST | `/api/purchase-orders/:id/mark-received` | Session | Mark PO fully received |
| POST | `/api/purchase-orders/:id/mark-paid` | Session | Mark PO as paid |
| POST | `/api/purchase-orders/:id/mark-accepted-internal` | Session | Internal acceptance |
| POST | `/api/purchase-orders/:id/receive` | Session | Record partial receipt |
| POST | `/api/purchase-orders/:id/confirm-receipt` | Session | Confirm line receipt |
| POST | `/api/purchase-orders/:id/bulk-confirm-receipt` | Session | Bulk confirm receipts |
| POST | `/api/purchase-orders/:id/close` | Session | Close PO |
| POST | `/api/purchase-orders/:id/cancel` | Session | Cancel PO |
| POST | `/api/purchase-orders/:id/report-issue` | Session | Report issue with PO |
| POST | `/api/purchase-orders/:id/toggle-dispute` | Session | Toggle dispute status |
| POST | `/api/purchase-orders/:id/recalculate-status` | Session | Recalculate PO status |
| POST | `/api/purchase-orders/:id/update-financials` | Session | Update financial totals |
| POST | `/api/purchase-orders/:id/create-bill` | Session | Create QB Bill |
| POST | `/api/purchase-orders/acknowledge` | None | Supplier acknowledgement |
| PATCH | `/api/purchase-orders/:id` | Session | Update PO fields |
| DELETE | `/api/purchase-orders/:id` | Session | Delete PO |

### PO Line Items

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/purchase-order-lines` | Session | Create PO line |
| PATCH | `/api/purchase-order-lines/:id` | Session | Update PO line |
| DELETE | `/api/purchase-order-lines/:id` | Session | Delete PO line |

### Suppliers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/suppliers` | Session | List all suppliers |
| POST | `/api/suppliers` | Session | Create supplier |
| PATCH | `/api/suppliers/:id` | Session | Update supplier |
| DELETE | `/api/suppliers/:id` | Session | Delete supplier |
| POST | `/api/suppliers/upsert-katana` | Session | Upsert from Katana import |

### Supplier Items (Pricing)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/supplier-items` | Session | List supplier-item relationships |
| GET | `/api/items/:itemId/designated-supplier` | Session | Get designated supplier for item |
| POST | `/api/supplier-items` | Session | Create supplier-item link |
| PATCH | `/api/supplier-items/:id` | Session | Update supplier-item |
| DELETE | `/api/supplier-items/:id` | Session | Delete supplier-item |

### AI & Recommendations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/ai/insights` | Session | Get AI inventory insights |
| GET | `/api/ai/recommendations` | Session | Get reorder recommendations |
| GET | `/api/ai/recommendations/:id/linked-pos` | Session | Get POs linked to recommendation |
| GET | `/api/ai/insights/qb-demand-history` | Session | Get QB demand history |
| GET | `/api/ai/at-risk` | Session | Get at-risk items |
| GET | `/api/ai/rules` | Session | Get AI automation rules |
| GET | `/api/ai/logs` | Session | Get AI batch logs |
| GET | `/api/ai/logs/:id` | Session | Get single AI log |
| GET | `/api/ai/system-recommendations` | Session | Get system-wide recommendations |
| PATCH | `/api/ai/recommendations/:id` | Session | Update recommendation |
| PATCH | `/api/ai/rules` | Session | Update AI rules |
| PATCH | `/api/ai/system-recommendations/:id` | Session | Update system recommendation |
| POST | `/api/ai/system-recommendations/run-review` | Session | Trigger AI review |

### AI Batch Processing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/ai-batch-decisions` | Session | Get recent batch decisions |
| GET | `/api/ai-batch/logs` | Session | Get batch logs |
| POST | `/api/ai-batch/run` | Session | Manually trigger AI batch |

### Dashboard & Widgets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard` | Session | Get dashboard data |
| POST | `/api/dashboard/stock/fix-in-ghl` | Session | Fix stock risk in GHL |
| GET | `/api/dashboards` | Session | List custom dashboards |
| GET | `/api/dashboards/:id` | Session | Get dashboard |
| POST | `/api/dashboards` | Session | Create dashboard |
| PATCH | `/api/dashboards/:id` | Session | Update dashboard |
| DELETE | `/api/dashboards/:id` | Session | Delete dashboard |
| POST | `/api/dashboards/:id/widgets` | Session | Add widget |
| POST | `/api/dashboards/:id/widgets/positions` | Session | Update widget positions |
| GET | `/api/widgets/:id/data` | Session | Get widget data |
| PATCH | `/api/widgets/:id` | Session | Update widget |
| DELETE | `/api/widgets/:id` | Session | Delete widget |

### Integrations - Shopify

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/integrations/shopify/test` | Session | Test Shopify connection |
| POST | `/api/integrations/shopify/sync` | Session | Sync orders from Shopify |
| GET | `/api/integrations/shopify/products` | Session | Get Shopify products |
| POST | `/api/shopify/sync-inventory` | Session | Push inventory to Shopify |
| POST | `/api/shopify/sync-inventory/:itemId` | Session | Push single item to Shopify |
| GET | `/api/shopify/sync-status` | Session | Get sync status |
| POST | `/api/shopify/pull-inventory` | Session | Pull inventory from Shopify |
| GET | `/api/shopify/webhooks` | Session | List registered webhooks |
| POST | `/api/shopify/webhooks` | Session | Register webhook |
| POST | `/api/shopify/webhooks/auto-register` | Session | Auto-register webhooks |
| POST | `/api/shopify/webhooks/register-orders` | Session | Register order webhooks |
| GET | `/api/shopify/webhooks/:webhookId/test` | Session | Test webhook |
| DELETE | `/api/shopify/webhooks/:webhookId` | Session | Delete webhook |
| GET | `/api/shopify/reconciliation/status` | Session | Reconciliation status |
| POST | `/api/shopify/reconciliation/trigger` | Session | Trigger reconciliation |

### Integrations - Amazon

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/integrations/amazon/test` | Session | Test Amazon connection |
| POST | `/api/integrations/amazon/sync` | Session | Sync from Amazon |
| GET | `/api/integrations/amazon/products` | Session | Get Amazon products |
| POST | `/api/amazon/sync-inventory` | Session | Push inventory to Amazon |
| GET | `/api/amazon/sync-status` | Session | Get Amazon sync status |

### Integrations - GoHighLevel

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/integrations/gohighlevel/status` | Session | Get GHL status |
| POST | `/api/integrations/gohighlevel/test` | Session | Test GHL connection |
| POST | `/api/integrations/gohighlevel/validate-pipeline` | Session | Validate GHL pipeline |
| POST | `/api/integrations/gohighlevel/backfill-contacts` | Session | Backfill GHL contacts |
| POST | `/api/integrations/gohighlevel/sync` | Session | Full GHL sync |

### Integrations - Extensiv

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/integrations/extensiv/test` | Session | Test Extensiv connection |
| POST | `/api/integrations/extensiv/sync` | Session | Sync from Extensiv |
| GET | `/api/integrations/extensiv/products` | Session | Get Extensiv products |

### Integrations - QuickBooks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/quickbooks/status` | Session | Get QB connection status |
| GET | `/api/quickbooks/auth-url` | Session | Get OAuth URL |
| GET | `/api/quickbooks/callback` | None | OAuth callback |
| POST | `/api/quickbooks/disconnect` | Session | Disconnect QB |
| POST | `/api/quickbooks/test-connection` | Session | Test QB connection |
| POST | `/api/quickbooks/refresh-tokens` | Session | Manually refresh tokens |
| GET | `/api/quickbooks/token-refresh-status` | Session | Get refresh scheduler status |
| POST | `/api/quickbooks/sync-sales` | Session | Sync sales data |
| POST | `/api/quickbooks/sync-demand-history` | Session | Sync demand history |
| GET | `/api/quickbooks/demand-history` | Session | Get demand history |
| GET | `/api/quickbooks/sales-snapshots` | Session | Get sales snapshots |
| GET | `/api/quickbooks/sales-snapshots/:sku` | Session | Get SKU snapshots |
| GET | `/api/quickbooks/items` | Session | Get QB items |
| GET | `/api/quickbooks/items/lookup/:sku` | Session | Lookup item by SKU |
| GET | `/api/quickbooks/items/search` | Session | Search QB items |

### Webhook Endpoints (Inbound)

| Method | Path | Auth | Signature | Description |
|--------|------|------|-----------|-------------|
| POST | `/api/webhooks/shopify` | None | X-Shopify-Hmac-Sha256 | Shopify webhooks |
| POST | `/api/webhooks/extensiv` | None | Optional HMAC | Extensiv inventory updates |
| POST | `/api/sendgrid/events` | None | None (TODO) | SendGrid email events |
| POST | `/sendgrid/events` | None | None (TODO) | SendGrid events (alias) |

### Settings & Configuration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings` | Session | Get user settings |
| PATCH | `/api/settings` | Session | Update settings |
| GET | `/api/ai-agent-settings` | Session | Get AI agent settings |
| PATCH | `/api/ai-agent-settings` | Session | Update AI agent settings |
| GET | `/api/integration-configs` | Session | List integration configs |
| GET | `/api/integration-configs/:provider` | Session | Get provider config |
| POST | `/api/integration-configs` | Session | Create integration config |
| PATCH | `/api/integration-configs/:id` | Session | Update integration config |
| DELETE | `/api/integration-configs/:id` | Session | Delete integration config |

### Bins (Storage Locations)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/bins` | Session | List bins |
| POST | `/api/bins` | Session | Create bin |
| PATCH | `/api/bins/:id` | Session | Update bin |
| DELETE | `/api/bins/:id` | Session | Delete bin |

### Barcodes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/barcodes` | Session | List barcodes |
| POST | `/api/barcodes` | Session | Create barcode |
| GET | `/api/barcodes/:id/image` | Session | Get barcode image |
| GET | `/api/generate-barcode/:value` | Session | Generate barcode image |
| GET | `/api/barcodes/lookup/:value` | Session | Lookup by barcode value |
| PATCH | `/api/barcodes/:id` | Session | Update barcode |
| DELETE | `/api/barcodes/:id` | Session | Delete barcode |

### BOM (Bill of Materials)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/bom` | Session | List all BOMs |
| GET | `/api/bom/:itemId` | Session | Get BOM for item |
| POST | `/api/bom` | Session | Create BOM entry |
| POST | `/api/bom/:itemId` | Session | Add component to BOM |
| DELETE | `/api/bom/:id` | Session | Delete BOM entry |

### System Logs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/system-logs` | Session | List system logs |
| GET | `/api/system-logs/:id` | Session | Get single log |
| GET | `/api/shippo-label-logs` | Session | Get Shippo label logs |
| GET | `/api/shippo-label-logs/:id` | Session | Get single label log |

### Integration Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/integration-health` | Session | Get health status |
| POST | `/api/integration-health/check` | Session | Run health check |
| GET | `/api/integration-health/rotation` | Session | Get rotation schedule |
| POST | `/api/integration-health/rotate` | Session | Rotate credentials |
| POST | `/api/stale-sync/check` | Session | Check for stale syncs |
| GET | `/api/stale-sync/status` | Session | Get stale sync status |

### Daily Sales Snapshots

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/daily-sales-snapshots` | Session | List snapshots |
| GET | `/api/daily-sales-snapshots/years` | Session | Get available years |
| GET | `/api/daily-sales-snapshots/:date` | Session | Get snapshot by date |
| POST | `/api/daily-sales-snapshots/trigger` | Session | Trigger snapshot |
| POST | `/api/daily-sales-snapshots/backfill` | Session | Backfill snapshots |

### Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/notifications` | Session | List notifications |
| GET | `/api/notifications/count` | Session | Get unread count |
| PATCH | `/api/notifications/:id/read` | Session | Mark as read |
| POST | `/api/notifications/mark-all-read` | Session | Mark all read |
| DELETE | `/api/notifications/:id` | Session | Delete notification |

---

## C) Detailed Critical Endpoints

### Orders: List / Get / Update Status

#### GET /api/sales-orders
Lists sales orders with filtering and pagination.

**Query Parameters:**
- `status` (string): Filter by status (PENDING, CONFIRMED, SHIPPED, DELIVERED, etc.)
- `channel` (string): Filter by channel (shopify, amazon)
- `search` (string): Search by order number, customer name, email
- `startDate`, `endDate` (string): Date range filter
- `limit`, `offset` (number): Pagination

**Response:**
```json
{
  "orders": [
    {
      "id": "uuid",
      "orderNumber": "SB-1234",
      "externalOrderId": "shopify_123",
      "channel": "shopify",
      "status": "DELIVERED",
      "customerName": "John Doe",
      "customerEmail": "john@example.com",
      "shippingAddress": {...},
      "totalAmount": 99.99,
      "currency": "USD",
      "orderDate": "2025-01-15T10:00:00Z",
      "shippedAt": "2025-01-16T10:00:00Z",
      "deliveredAt": "2025-01-18T10:00:00Z"
    }
  ],
  "total": 150,
  "hasMore": true
}
```

#### PATCH /api/sales-orders/:id
Updates sales order fields including status transitions.

**Request:**
```json
{
  "status": "SHIPPED",
  "trackingNumber": "1Z999AA1012345678",
  "carrier": "UPS"
}
```

**Valid Status Values:**
- `PENDING` - Order received, awaiting processing
- `CONFIRMED` - Payment confirmed
- `PROCESSING` - Being prepared
- `SHIPPED` - Shipped to customer
- `DELIVERED` - Delivered to customer
- `PENDING_REFUND` - Return initiated
- `REFUNDED` - Refund completed
- `CANCELLED` - Order cancelled

---

### Refunds/Returns: Full Lifecycle

#### POST /api/returns/from-sales-order
Creates a return from an existing sales order.

**Request:**
```json
{
  "salesOrderId": "uuid",
  "items": [
    {
      "salesOrderLineId": "uuid",
      "quantityReturning": 1,
      "returnReason": "DEFECTIVE"
    }
  ],
  "customerNotes": "Product arrived damaged"
}
```

**Response:**
```json
{
  "id": "uuid",
  "rmaNumber": "RMA-2025-0001",
  "status": "PENDING_LABEL",
  "salesOrderId": "uuid",
  "orderNumber": "SB-1234",
  "items": [...],
  "createdAt": "2025-01-20T10:00:00Z"
}
```

#### POST /api/returns/:id/create-label
Generates return shipping label via Shippo.

**Request:**
```json
{
  "parcels": [
    { "length": 10, "width": 8, "height": 4, "weight": 2 }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "trackingNumber": "92001234567890",
  "labelUrl": "https://shippo.com/labels/...",
  "carrier": "USPS",
  "serviceLevel": "Priority Mail"
}
```

#### POST /api/returns/:id/receive
Marks return as received at warehouse (Hildale).

**Request:**
```json
{
  "receivedItems": [
    { "returnItemId": "uuid", "condition": "GOOD", "quantityReceived": 1 }
  ],
  "notes": "All items in good condition"
}
```

#### POST /api/returns/:id/assess-damage
Assesses damage and calculates refund amount.

**Request:**
```json
{
  "items": [
    {
      "returnItemId": "uuid",
      "damagePercentage": 25,
      "damageNotes": "Minor scratches on surface"
    }
  ]
}
```

**Response:**
```json
{
  "proposedRefundAmount": 75.00,
  "breakdown": {
    "orderTotal": 99.99,
    "returnShipping": -10.00,
    "labelFee": -5.00,
    "damageDeduction": -9.99,
    "netRefund": 75.00
  }
}
```

#### POST /api/returns/:id/mark-refund-completed
Completes the refund process.

**Request:**
```json
{
  "refundAmount": 75.00,
  "skipQuickBooks": false
}
```

#### POST /api/returns/:id/post-to-quickbooks
Creates QuickBooks Credit Memo for the return.

**Request:**
```json
{
  "refundAmount": 75.00
}
```

**Response:**
```json
{
  "success": true,
  "quickbooksRefundId": "123",
  "quickbooksRefundType": "CreditMemo"
}
```

---

### Inventory: List / Get / Adjust

#### GET /api/items
Lists all inventory items.

**Query Parameters:**
- `type` (string): Filter by "component" or "finished_product"
- `search` (string): Search by name, SKU, barcode
- `lowStock` (boolean): Filter low stock items

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Widget A",
    "sku": "WGT-001",
    "type": "finished_product",
    "currentStock": 150,
    "minStock": 50,
    "hildaleQty": 100,
    "pivotQty": 50,
    "availableForSaleQty": 50,
    "dailyUsage": 5.2,
    "shopifySku": "SHOP-WGT-001",
    "amazonSku": "AMZ-WGT-001",
    "extensivSku": "EXT-WGT-001"
  }
]
```

#### PATCH /api/items/:id
Updates item fields including inventory quantities.

**Request (manual adjustment):**
```json
{
  "hildaleQty": 120,
  "notes": "Received production batch"
}
```

**Request (update SKU mappings):**
```json
{
  "shopifySku": "SHOP-NEW-SKU",
  "amazonSku": "AMZ-NEW-SKU"
}
```

#### POST /api/inventory/scan
Processes barcode scan for inventory adjustment.

**Request:**
```json
{
  "barcode": "012345678901",
  "action": "ADD",
  "quantity": 10,
  "binId": "uuid",
  "notes": "Cycle count adjustment"
}
```

**Actions:** `ADD`, `REMOVE`, `SET`, `MOVE`

---

### Purchase Orders: Full Lifecycle

#### POST /api/purchase-orders
Creates a new purchase order.

**Request:**
```json
{
  "supplierId": "uuid",
  "expectedDate": "2025-02-01",
  "shipToLocation": "Hildale Warehouse",
  "paymentTerms": "Net 30",
  "notes": "Rush order",
  "lines": [
    {
      "itemId": "uuid",
      "description": "Widget A",
      "unitCost": 5.00,
      "qtyOrdered": 100
    }
  ]
}
```

**Response:**
```json
{
  "id": "uuid",
  "poNumber": "PO-2025-0042",
  "status": "DRAFT",
  "supplierId": "uuid",
  "supplierName": "Acme Supplies",
  "total": 500.00,
  "lines": [...]
}
```

#### POST /api/purchase-orders/:id/send
Sends PO to supplier via email (SendGrid).

**Request:**
```json
{
  "emailTo": "supplier@example.com",
  "subject": "Purchase Order PO-2025-0042",
  "body": "Please find attached our purchase order..."
}
```

**Side Effects:**
- Sends email via SendGrid with PDF attachment
- Creates GHL opportunity for tracking
- Updates PO status to SENT
- Sets acknowledgement token for supplier confirmation

#### POST /api/purchase-orders/:id/receive
Records partial or full receipt of goods.

**Request:**
```json
{
  "lines": [
    {
      "purchaseOrderLineId": "uuid",
      "qtyReceived": 50,
      "condition": "GOOD",
      "notes": "First shipment"
    }
  ],
  "receivedBy": "John"
}
```

**Side Effects:**
- Updates line item received quantities
- May trigger status change to PARTIAL or RECEIVED
- Creates inventory movement records

---

### Customers/Contacts

The system doesn't maintain a separate customers table. Customer data is stored on sales orders and synced with GoHighLevel contacts.

#### POST /api/sales-orders/:id/link-ghl-contact
Links sales order to GHL contact.

**Request:**
```json
{
  "ghlContactId": "ghl_contact_123"
}
```

#### POST /api/integrations/gohighlevel/backfill-contacts
Backfills GHL contact IDs for existing orders.

**Response:**
```json
{
  "success": true,
  "matched": 45,
  "unmatched": 5,
  "errors": 0
}
```

---

## D) MCP Integration Notes

### Read-Only Tools (Safe)

These endpoints are safe for MCP read tools:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/items` | List inventory items |
| `GET /api/items/:id` | Get item details |
| `GET /api/items/critical-order` | Get items needing reorder |
| `GET /api/sales-orders` | List sales orders |
| `GET /api/sales-orders/:id` | Get order details |
| `GET /api/returns` | List returns |
| `GET /api/returns/:id` | Get return details |
| `GET /api/purchase-orders` | List POs |
| `GET /api/purchase-orders/:id` | Get PO details |
| `GET /api/suppliers` | List suppliers |
| `GET /api/ai/recommendations` | Get AI recommendations |
| `GET /api/ai/at-risk` | Get at-risk items |
| `GET /api/dashboard` | Get dashboard data |
| `GET /api/quickbooks/demand-history` | Get QB demand data |
| `GET /api/daily-sales-snapshots` | Get sales trends |

### Write Tools (Need Propose/Commit Pattern)

These endpoints modify data and should use propose/commit:

| Endpoint | Risk Level | Recommendation |
|----------|------------|----------------|
| `POST /api/purchase-orders` | Medium | Propose draft first, require confirmation |
| `POST /api/purchase-orders/:id/send` | High | Always require explicit approval |
| `POST /api/returns` | Medium | Propose return, await confirmation |
| `POST /api/returns/:id/mark-refund-completed` | High | Require amount confirmation |
| `PATCH /api/items/:id` (inventory adjust) | Medium | Log changes, propose adjustments |
| `POST /api/sales-orders/:id/cancel` | High | Require confirmation |
| `POST /api/purchase-orders/:id/cancel` | High | Require confirmation |

### Suggested Propose/Commit Flow

1. **Propose Phase:** MCP calls a "propose" endpoint or simulates the action
2. **Review Phase:** Agent presents proposed changes to user
3. **Commit Phase:** User confirms, MCP executes actual endpoint

### Missing Endpoints (Future Enhancements)

These endpoints would be valuable additions for MCP integration:

1. **`POST /api/items/:id/adjust-inventory`** - Dedicated inventory adjustment endpoint with audit trail
2. **`POST /api/returns/:id/propose-refund`** - Calculate refund without committing
3. **`GET /api/items/:id/forecast`** - Get AI forecast for specific item
4. **`POST /api/purchase-orders/:id/simulate-send`** - Preview PO email without sending
5. **`GET /api/inventory/movements`** - Paginated inventory movement history
6. **`POST /api/sales-orders/validate`** - Validate order data before creation
7. **`GET /api/suppliers/:id/performance`** - Supplier performance metrics

### Authentication for MCP

For MCP server integration, recommend:

1. **API Key Header** - Add `X-API-Key` auth alongside session auth
2. **Service Account** - Create dedicated service user for MCP
3. **Scoped Tokens** - Issue tokens with specific endpoint permissions

Current workaround: Use the session-based auth with a persistent login, or extend the GHL X-GHL-Secret pattern to a general `X-MCP-Secret` header.

---

## JSON Specification

```json
{
  "inventory_api_spec": [
    { "method": "POST", "path": "/api/auth/login", "auth": "none", "req_fields": ["email", "password"], "res_fields": ["user", "session"] },
    { "method": "GET", "path": "/api/auth/me", "auth": "session", "req_fields": [], "res_fields": ["id", "email"] },
    { "method": "GET", "path": "/api/items", "auth": "session", "req_fields": [], "res_fields": ["id", "name", "sku", "type", "currentStock", "hildaleQty", "pivotQty", "availableForSaleQty"] },
    { "method": "GET", "path": "/api/items/:id", "auth": "session", "req_fields": [], "res_fields": ["id", "name", "sku", "type", "currentStock", "hildaleQty", "pivotQty", "availableForSaleQty", "dailyUsage", "minStock"] },
    { "method": "GET", "path": "/api/items/critical-order", "auth": "session", "req_fields": [], "res_fields": ["items"] },
    { "method": "PATCH", "path": "/api/items/:id", "auth": "session", "req_fields": ["[various item fields]"], "res_fields": ["id", "...updated fields"] },
    { "method": "POST", "path": "/api/inventory/scan", "auth": "session", "req_fields": ["barcode", "action", "quantity"], "res_fields": ["success", "item", "newQuantity"] },
    { "method": "GET", "path": "/api/sales-orders", "auth": "session", "req_fields": [], "res_fields": ["orders", "total", "hasMore"] },
    { "method": "GET", "path": "/api/sales-orders/:id", "auth": "session", "req_fields": [], "res_fields": ["id", "orderNumber", "status", "customerName", "totalAmount", "lines"] },
    { "method": "PATCH", "path": "/api/sales-orders/:id", "auth": "session", "req_fields": ["status", "trackingNumber?", "carrier?"], "res_fields": ["id", "status"] },
    { "method": "POST", "path": "/api/sales-orders/:id/ship", "auth": "session", "req_fields": ["trackingNumber", "carrier"], "res_fields": ["success"] },
    { "method": "POST", "path": "/api/sales-orders/:id/cancel", "auth": "session", "req_fields": ["reason?"], "res_fields": ["success"] },
    { "method": "GET", "path": "/api/returns", "auth": "session", "req_fields": [], "res_fields": ["returns"] },
    { "method": "GET", "path": "/api/returns/:id", "auth": "session", "req_fields": [], "res_fields": ["id", "rmaNumber", "status", "salesOrderId", "items", "proposedRefundAmount"] },
    { "method": "POST", "path": "/api/returns/from-sales-order", "auth": "session", "req_fields": ["salesOrderId", "items"], "res_fields": ["id", "rmaNumber", "status"] },
    { "method": "POST", "path": "/api/returns/:id/create-label", "auth": "session", "req_fields": ["parcels"], "res_fields": ["trackingNumber", "labelUrl", "carrier"] },
    { "method": "POST", "path": "/api/returns/:id/receive", "auth": "session", "req_fields": ["receivedItems"], "res_fields": ["success", "status"] },
    { "method": "POST", "path": "/api/returns/:id/assess-damage", "auth": "session", "req_fields": ["items"], "res_fields": ["proposedRefundAmount", "breakdown"] },
    { "method": "POST", "path": "/api/returns/:id/mark-refund-completed", "auth": "session", "req_fields": ["refundAmount"], "res_fields": ["success"] },
    { "method": "POST", "path": "/api/returns/:id/post-to-quickbooks", "auth": "session", "req_fields": ["refundAmount"], "res_fields": ["quickbooksRefundId", "quickbooksRefundType"] },
    { "method": "POST", "path": "/api/ghl/custom-actions/create-return-label", "auth": "X-GHL-Secret", "req_fields": ["orderNumber", "contactId"], "res_fields": ["success", "messageForAgent", "trackingNumber", "labelUrl"] },
    { "method": "GET", "path": "/api/purchase-orders", "auth": "session", "req_fields": [], "res_fields": ["purchaseOrders"] },
    { "method": "GET", "path": "/api/purchase-orders/:id", "auth": "session", "req_fields": [], "res_fields": ["id", "poNumber", "status", "supplierId", "total", "lines"] },
    { "method": "POST", "path": "/api/purchase-orders", "auth": "session", "req_fields": ["supplierId", "lines"], "res_fields": ["id", "poNumber", "status"] },
    { "method": "POST", "path": "/api/purchase-orders/:id/send", "auth": "session", "req_fields": ["emailTo", "subject", "body"], "res_fields": ["success", "messageId"] },
    { "method": "POST", "path": "/api/purchase-orders/:id/receive", "auth": "session", "req_fields": ["lines"], "res_fields": ["success", "status"] },
    { "method": "POST", "path": "/api/purchase-orders/:id/close", "auth": "session", "req_fields": [], "res_fields": ["success"] },
    { "method": "POST", "path": "/api/purchase-orders/:id/cancel", "auth": "session", "req_fields": ["reason?"], "res_fields": ["success"] },
    { "method": "GET", "path": "/api/suppliers", "auth": "session", "req_fields": [], "res_fields": ["id", "name", "email", "phone"] },
    { "method": "GET", "path": "/api/ai/recommendations", "auth": "session", "req_fields": [], "res_fields": ["recommendations"] },
    { "method": "GET", "path": "/api/ai/at-risk", "auth": "session", "req_fields": [], "res_fields": ["items", "riskLevel"] },
    { "method": "GET", "path": "/api/dashboard", "auth": "session", "req_fields": [], "res_fields": ["lowStockItems", "recentOrders", "kpis"] },
    { "method": "POST", "path": "/api/webhooks/shopify", "auth": "X-Shopify-Hmac-Sha256", "req_fields": ["[shopify payload]"], "res_fields": ["success"] },
    { "method": "POST", "path": "/api/webhooks/extensiv", "auth": "HMAC-optional", "req_fields": ["eventType", "items"], "res_fields": ["success", "processed"] }
  ]
}
```
