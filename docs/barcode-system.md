# Barcode System Documentation

## Overview

The barcode system provides comprehensive barcode tracking, generation, and management for manufacturing inventory. It supports both GS1-standard barcodes for finished products and internal tracking codes for raw materials.

## Core Data Fields

### Item Barcode Fields

| Field | Type | Description | Allowed Values |
|-------|------|-------------|----------------|
| `barcodeValue` | string | The actual barcode value/code | Any string (alphanumeric) |
| `barcodeFormat` | string | Barcode symbology/encoding | CODE128, QR_CODE, EAN13, GTIN12 |
| `barcodeUsage` | enum | How the barcode is used | EXTERNAL_GS1, INTERNAL_STOCK |
| `productKind` | enum | Product classification | FINISHED, RAW |
| `barcodeSource` | enum | Origin of barcode | AUTO_GENERATED, MANUAL_ENTRY, EXTERNAL_SYSTEM |

### Field Relationships & Validation Rules

**FINISHED products must use EXTERNAL_GS1 usage:**
- `productKind: "FINISHED"` → `barcodeUsage: "EXTERNAL_GS1"`
- These are sellable products with industry-standard barcodes

**RAW inventory must use INTERNAL_STOCK usage:**
- `productKind: "RAW"` → `barcodeUsage: "INTERNAL_STOCK"`  
- These are components/materials with internal tracking codes

## Barcode Generation

### GS1 GTIN-12 Generator

**Purpose:** Generate industry-standard 12-digit GTINs for finished products.

**Format:** `PPPPPPIIIIIC`
- `PPPPPP` = GS1 company prefix (6-10 digits, configured in settings)
- `IIIIII` = Item reference number (auto-incremented)
- `C` = Check digit (calculated using Luhn algorithm)

**Example:** `012345000019` 
- Prefix: `012345`
- Item ref: `000001`
- Check digit: `9`

**Algorithm:**
1. Concatenate prefix + zero-padded item ref
2. Calculate check digit:
   - Sum odd-position digits × 3
   - Sum even-position digits × 1
   - Check digit = (10 - (sum % 10)) % 10
3. Increment `nextItemRef` counter in barcode settings

**Requirements:**
- GS1 prefix must be configured in Settings → Barcode tab
- System validates prefix exists before generating
- Counter prevents duplicates

### Internal Code Generator

**Purpose:** Generate internal tracking codes for raw inventory.

**Format:** `RAW-NNNNNN`
- Fixed prefix: `RAW-`
- `NNNNNN` = Zero-padded sequential number (6 digits by default)

**Examples:**
- `RAW-000001`
- `RAW-000042`
- `RAW-001337`

**Algorithm:**
1. Read `nextInternalCode` from barcode settings
2. Zero-pad to configured digit length (default 6)
3. Concatenate `RAW-` + padded number
4. Increment `nextInternalCode` counter

**Configuration:**
- Digit length is configurable in barcode settings (`itemRefDigits`)
- Starting number defaults to 1000 but can be changed

## Import System

### Architecture

The import system provides CSV/XLSX file parsing, column mapping, validation, and upsert logic.

**Key Components:**
1. **ImportService** (`server/import-service.ts`) - Core parsing and validation logic
2. **Import API Routes** (`server/routes.ts`) - HTTP endpoints for upload/preview/execute
3. **ImportWizard** (`client/src/components/import-wizard.tsx`) - Multi-step UI

### Import Flow (End-to-End)

```
User Uploads File
     ↓
1. Parse File (CSV/XLSX)
     ↓
2. Auto-suggest Column Mapping
     ↓
3. User Confirms/Adjusts Mapping
     ↓
4. User Selects Match Strategy
     ↓
5. Preview Changes (Dry Run)
     ↓
6. Execute Import (Upsert)
     ↓
7. Show Results + Error Report
```

### Column Mapping

**Auto-detection:** The system suggests mappings by matching CSV headers to schema field names using fuzzy keywords.

**Examples:**
- CSV column "Product Name" → maps to `name`
- CSV column "UPC" → maps to `barcodeValue`
- CSV column "Type" → maps to `productKind`

**Supported Target Fields:**
- `name` (required)
- `sku` (required)
- `barcodeValue`
- `productKind` (FINISHED | RAW)
- `barcodeUsage` (EXTERNAL_GS1 | INTERNAL_STOCK)
- `barcodeFormat` (CODE128, QR_CODE, etc.)
- `barcodeSource` (AUTO_GENERATED | MANUAL_ENTRY | EXTERNAL_SYSTEM)
- `currentStock`, `minStock`, `dailyUsage`
- `unit`, `location`
- `externalSystem`, `externalId`

### Match Strategies

**1. Match by SKU** (`matchStrategy: "sku"`)
- If SKU exists in database → update existing item
- If SKU is new → create new item
- **Use case:** Updating inventory from supplier catalogs

**2. Match by Barcode** (`matchStrategy: "barcodeValue"`)
- If barcodeValue exists → update existing item
- If barcodeValue is new → create new item
- **Use case:** Syncing with external barcode systems

**3. Match by Both** (`matchStrategy: "both"`)
- If either SKU or barcodeValue matches → update existing item
- Only if both are unmatched → create new item
- **Use case:** Merging data from multiple sources

### Validation

**Required Fields:**
- `name` - Item name/description
- `sku` - Stock keeping unit

**Business Rules:**
- `productKind` must be "FINISHED" or "RAW"
- If `productKind = "FINISHED"` → `barcodeUsage` must be "EXTERNAL_GS1"
- If `productKind = "RAW"` → `barcodeUsage` must be "INTERNAL_STOCK"
- Barcode values are auto-generated if missing based on productKind
- Numeric fields (`currentStock`, `minStock`, `dailyUsage`) are parsed to numbers

**Error Handling:**
- Invalid rows are skipped and logged with error messages
- Duplicate barcodes within the same file are flagged as warnings
- Missing required fields result in row rejection
- Errors are available as downloadable CSV report

### Import Job Results

**Success Metrics:**
- `inserted` - Number of new items created
- `updated` - Number of existing items updated
- `skipped` - Number of rows skipped (conflicts)
- `failed` - Number of rows that failed validation

**Error Report:**
- Each error includes row number, error message, and raw data
- Downloadable as CSV for correction and re-import

## GS1 Integration

### Setting Up GS1 Company Prefix

**Step 1:** Obtain a GS1 company prefix from GS1.org
- Small businesses: 6-digit prefix
- Medium businesses: 7-8 digit prefix
- Large businesses: 9-10 digit prefix

**Step 2:** Configure in Settings → Barcode tab
- Navigate to Settings page
- Select "Barcode" tab
- Enter your GS1 prefix in the "GS1 Company Prefix" field
- Click "Save Settings"

**Step 3:** Start generating GTINs
- Go to Barcodes page
- Click "Create Barcode"
- Select "FINISHED" product kind
- Click "Auto-Generate" to create GS1-compliant GTIN

### Replacing GS1 Prefix Later

The system is designed to allow updating the GS1 prefix without code changes:

1. Update `gs1Prefix` in barcode settings via Settings page
2. New GTINs will use the updated prefix
3. Existing GTINs remain unchanged (no retroactive updates)
4. Counter (`nextItemRef`) continues incrementing

**Note:** Changing the prefix does not invalidate existing GTINs. You may want to keep a record of when the prefix changed for inventory reconciliation.

## API Endpoints

### Barcode Generation

**POST /api/barcodes/generate-gs1**
- Generates a GS1 GTIN-12 barcode
- Requires GS1 prefix to be configured
- Returns: `{ barcodeValue: "012345000019" }`

**POST /api/barcodes/generate-internal**
- Generates an internal RAW code  
- Returns: `{ barcodeValue: "RAW-000001" }`

### Barcode Settings

**GET /api/barcode-settings**
- Returns current barcode settings
- Response: `{ id, gs1Prefix, itemRefDigits, nextItemRef, nextInternalCode }`

**PATCH /api/barcode-settings**
- Updates barcode settings
- Body: `{ gs1Prefix?: string, itemRefDigits?: number }`

### Import Operations

**POST /api/import/upload**
- Upload CSV/XLSX file for parsing
- Returns: `{ headers: string[], suggestedMapping: ColumnMapping }`

**POST /api/import/preview**
- Preview import with dry-run validation
- Body: multipart/form-data with `file`, `columnMapping`, `matchStrategy`
- Returns: `{ totalRows, newItems, updates, conflicts, invalid, sampleRows }`

**POST /api/import/execute**
- Execute import with actual database writes
- Body: multipart/form-data with `file`, `columnMapping`, `matchStrategy`
- Returns: `{ success, inserted, updated, skipped, failed, errors[] }`

### Export

**GET /api/export/items**
- Exports all items with barcode metadata as CSV
- Returns: CSV file download

## Database Schema

### barcodeSettings Table

```typescript
{
  id: string (UUID)
  gs1Prefix: string | null       // GS1 company prefix (6-10 digits)
  itemRefDigits: integer          // Zero-padding length for item refs (default: 6)
  nextItemRef: integer            // Counter for next GS1 item reference
  nextInternalCode: integer       // Counter for next internal RAW code
}
```

### items Table (Barcode Fields)

```typescript
{
  id: string (UUID)
  name: string
  sku: string
  barcodeValue: string | null
  barcodeFormat: string | null    // CODE128, QR_CODE, EAN13, GTIN12
  barcodeUsage: string | null     // EXTERNAL_GS1, INTERNAL_STOCK
  productKind: string | null      // FINISHED, RAW
  barcodeSource: string | null    // AUTO_GENERATED, MANUAL_ENTRY, EXTERNAL_SYSTEM
  externalSystem: string | null   // Source system name (e.g., "Shopify")
  externalId: string | null       // ID in external system
  currentStock: integer
  minStock: integer
  dailyUsage: number
  unit: string
  location: string | null
  // ... other fields
}
```

## Frontend Components

### ImportWizard

**Location:** `client/src/components/import-wizard.tsx`

**Features:**
- 5-step process: Upload → Map → Strategy → Preview → Results
- Progress indicators for each step
- Help tooltips for productKind, barcodeUsage, match strategies
- Downloadable error reports
- Auto-suggests column mappings

**Usage:**
```tsx
<ImportWizard
  open={isOpen}
  onOpenChange={setIsOpen}
/>
```

### BarcodeForm

**Location:** `client/src/pages/barcodes.tsx` (BarcodeForm component)

**Features:**
- Create items with barcodes directly
- Validates productKind + barcodeUsage combinations
- Auto-generate button for GS1 and internal codes
- Real-time validation feedback

## Testing

### Unit Tests (Planned)

**GS1 Generator Tests:**
- Correct check digit calculation
- Uniqueness guarantee (no duplicate GTINs)
- Counter increments properly
- Handles missing GS1 prefix gracefully

**Internal Code Generator Tests:**
- Correct format (RAW-NNNNNN)
- Uniqueness guarantee
- Counter increments properly
- Zero-padding works correctly

### Integration Tests (Planned)

**Import Tests:**
- CSV parsing handles various formats
- Column mapping works with common variations
- All three match strategies (SKU, barcode, both) work correctly
- Upsert logic creates/updates correctly
- Validation rejects invalid data
- Error reports are accurate

**Failure Scenarios:**
- Duplicate barcodes in file
- Missing required fields (name, SKU)
- Invalid productKind values
- Mismatched productKind + barcodeUsage
- Malformed CSV rows

## Common Patterns

### Creating a Finished Product with GS1 Barcode

```typescript
// 1. Ensure GS1 prefix is configured
await apiRequest("PATCH", "/api/barcode-settings", {
  gs1Prefix: "012345"
});

// 2. Generate GS1 barcode
const { barcodeValue } = await apiRequest("POST", "/api/barcodes/generate-gs1", {});

// 3. Create item
await apiRequest("POST", "/api/items", {
  name: "Widget Pro",
  sku: "WDGT-001",
  productKind: "FINISHED",
  barcodeValue,
  barcodeFormat: "GTIN12",
  barcodeUsage: "EXTERNAL_GS1",
  barcodeSource: "AUTO_GENERATED",
  currentStock: 100,
  type: "finished_product"
});
```

### Creating Raw Inventory with Internal Code

```typescript
// 1. Generate internal code
const { barcodeValue } = await apiRequest("POST", "/api/barcodes/generate-internal", {});

// 2. Create item
await apiRequest("POST", "/api/items", {
  name: "M6 Hex Nut",
  sku: "NUT-M6-001",
  productKind: "RAW",
  barcodeValue,
  barcodeFormat: "CODE128",
  barcodeUsage: "INTERNAL_STOCK",
  barcodeSource: "AUTO_GENERATED",
  currentStock: 500,
  type: "component"
});
```

### Importing Items from CSV

```csv
name,sku,barcodeValue,productKind,currentStock
"Widget Pro","WDGT-001","012345000019","FINISHED",100
"Hex Nut M6","NUT-M6","RAW-000042","RAW",500
```

```typescript
const formData = new FormData();
formData.append("file", csvFile);
formData.append("columnMapping", JSON.stringify({
  name: "name",
  sku: "sku",
  barcodeValue: "barcodeValue",
  productKind: "productKind",
  currentStock: "currentStock"
}));
formData.append("matchStrategy", "sku");

const result = await fetch("/api/import/execute", {
  method: "POST",
  body: formData
});
```

## Troubleshooting

### "GS1 prefix not configured" Error

**Cause:** Attempting to generate GS1 barcode without setting company prefix.

**Solution:** 
1. Go to Settings → Barcode tab
2. Enter your GS1 company prefix
3. Click Save
4. Retry barcode generation

### "Invalid productKind and barcodeUsage combination" Error

**Cause:** Mismatched productKind and barcodeUsage values.

**Solution:**
- For FINISHED products → use EXTERNAL_GS1
- For RAW inventory → use INTERNAL_STOCK

### Import Shows "Invalid" Rows

**Cause:** Data doesn't meet validation rules.

**Solution:**
1. Click "Download Error Report" in import results
2. Review error messages in the CSV
3. Fix data issues in source file
4. Re-import

## Future Enhancements

- **Import Profiles:** Save column mappings for reuse
- **Import Job History:** Track all past imports with timestamps
- **Batch Barcode Generation:** Generate multiple codes at once
- **QR Code Support:** Generate QR codes in addition to linear barcodes
- **Label Templates:** Customizable print layouts
- **Barcode Validation:** Verify check digits on manual entry
