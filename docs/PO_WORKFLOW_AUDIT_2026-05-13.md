# PO Workflow Audit - 2026-05-13

## Section A - PO Lifecycle Visibility

### 1. All POs with filters
- **Status:** BROKEN
- **Evidence:** `client/src/pages/purchase-orders.tsx:303-318` fetches `view=live` or `view=historical`, while `server/routes.ts:14476-14501` supports `view=all` but the UI never requests it. `client/src/pages/purchase-orders.tsx:739-753` has a status filter, but it is client-side only and there is no supplier filter in the UI.
- **What's needed:** Add an "All" view or make live/history explicit for Roger, and add a supplier filter wired either client-side or to the existing API `supplierId` query.

### 2. One-place PO detail view
- **Status:** BROKEN
- **Evidence:** `client/src/pages/purchase-orders.tsx:958-1280` shows status, dates, total, email status, line items, receipts, and financial summary, but not payment terms or QBO sync status. `server/routes.ts:17585-17642` composite returns PO, supplier, lines, receipts, and display status only, not `quickbooks_bills`.
- **What's needed:** Extend the composite endpoint to include bill status and add fields in the detail dialog for payment terms/QBO bill status.

### 3. Unpaid bills filter
- **Status:** MISSING
- **Evidence:** The PO UI filter is only `statusFilter` at `client/src/pages/purchase-orders.tsx:291-293` and status options at `client/src/pages/purchase-orders.tsx:739-753`; QuickBooks bill status is only exposed by `GET /api/purchase-orders/:id/bill-status` at `server/routes.ts:22649-22666`.
- **What's needed:** Add a Roger-facing "Unpaid bills" view/query that joins POs to `quickbooks_bills` and returns rows where no bill exists or `status != 'PAID'`.

## Section B - Invoice Attachment

### 4. Invoice URL/schema support
- **Status:** WORKS
- **Evidence:** `shared/schema.ts:550-551` has `invoiceImageUrl` and `invoiceTotal`; `shared/schema.ts:511-512` also has legacy `receiptUrl`.
- **What's needed:** Minimum schema is already present for one invoice image/PDF URL; if multiple attachments are needed, add a `po_attachments` table or JSONB attachment list.

### 5. Upload endpoint for PO invoice
- **Status:** MISSING
- **Evidence:** Search found parser-only upload at `server/routes.ts:15246-15270`; no `POST /api/purchase-orders/:id/invoice` or equivalent attachment route exists.
- **What's needed:** Add a multipart upload endpoint that stores the file, writes `purchase_orders.invoice_image_url`, and optionally logs an audit event.

### 6. Invoice parser end-to-end behavior
- **Status:** WORKS
- **Evidence:** `server/services/invoice-parser-service.ts:1-6` states the parser returns structured data and never auto-saves; `server/routes.ts:15240-15270` returns `{ parsed }`; `client/src/pages/log-order.tsx:166-222` uses that output to hydrate the `/log-order` form.
- **What's needed:** Nothing for parsing; attachment persistence is separate.

## Section C - Roger Workflow

### 7. Roger email content/link/invoice
- **Status:** BROKEN
- **Evidence:** `server/services/roger-notification-service.ts:92-105` builds text with PO number, supplier, ordered-by, total, expected delivery, line items, and notes. It does not include an app link or invoice attachment; `sgMail.send` at `server/services/roger-notification-service.ts:112-123` sends only `text`.
- **What's needed:** Add a direct PO link and attach/link `invoiceImageUrl` when available.

### 8. Roger login path
- **Status:** WORKS
- **Evidence:** User invitations support arbitrary email and role at `server/routes.ts:464-478`, registration from invite at `server/routes.ts:539-565`, and role updates at `server/routes.ts:607-619`; roles are `admin`, `member`, or `warehouse`.
- **What's needed:** Invite Roger as `member` if he should use the UI; otherwise keep email as the first-class channel.

### 9. App learns QBO bill was paid
- **Status:** BROKEN
- **Evidence:** The only local `PAID` write path is manual app action `POST /api/purchase-orders/:id/mark-paid` at `server/routes.ts:16228-16253`, which calls `markPOBillAsPaidInQuickBooks`; that service writes `status: 'PAID'` at `server/services/po-quickbooks-sync.ts:106-141`. No QBO webhook or bill-payment polling path was found.
- **What's needed:** Either add a QBO polling job for Bill/BillPayment status or treat the app's "Mark paid" button as the canonical workflow and expose it to Roger.

## Section D - QBO Sync

### 10. UI button or automatic PO to QBO Bill
- **Status:** BROKEN
- **Evidence:** Approval automatically fires `syncApprovedPOToQuickBooks` at `server/routes.ts:16367-16391`; a manual API exists at `server/routes.ts:22602-22642`. The purchase-orders UI has no `create-bill` or `bill-status` calls (`client/src/pages/purchase-orders.tsx:335-491` mutations cover state, send, receive, financials).
- **What's needed:** Add a visible "Create/Retry QBO Bill" control or show the automatic sync result in the PO detail.

### 11. QBO bill payload completeness
- **Status:** WORKS
- **Evidence:** `server/services/quickbooks-client.ts:1038-1092` finds/creates vendor, builds line items with item or fallback account, sets `VendorRef`, `TxnDate`, `DueDate`, `Line`, and a PO private note.
- **What's needed:** Confirm payment terms mapping if Roger needs terms beyond due date; current payload covers vendor, lines, amounts, and due date.

### 12. Draft PO prevented from QBO sync
- **Status:** BROKEN
- **Evidence:** Automatic approval route checks `po.status !== 'APPROVAL_PENDING'` before approval/sync at `server/routes.ts:16376-16388`, but the manual `POST /api/purchase-orders/:id/create-bill` route at `server/routes.ts:22602-22642` has no status guard. `syncApprovedPOToQuickBooks` also does not verify `po.status` at `server/services/po-quickbooks-sync.ts:37-56`.
- **What's needed:** Add a guard in both manual route and sync service to allow only approved/sent or otherwise explicitly allowed statuses.

## Prioritized Punch List

1. **Build Roger's unpaid-bills view first:** expose POs joined to `quickbooks_bills`, filtered where status is not `PAID`, with supplier, amount, due/expected date, QBO bill status, and invoice link.
2. **Add invoice attachment upload:** use existing `invoice_image_url` as the cheap unblock, then include the link/attachment in Roger emails.
3. **Make QBO sync visible and safe:** add bill status to PO composite/details and block draft POs from manual Bill creation.
4. **Upgrade Roger email:** include a PO app link and invoice URL so email-only workflow stays viable.
5. **Decide paid-status source:** either Roger marks paid in-app after paying in QBO, or add QBO bill-payment polling later.
