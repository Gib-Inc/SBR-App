import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { IStorage } from "./storage";
import type { InsertItem } from "@shared/schema";
import { BarcodeGenerator } from "./barcode-generator";

export interface ColumnMapping {
  [csvColumn: string]: string | null; // Maps CSV column to schema field name
}

export interface ImportPreviewResult {
  totalRows: number;
  newItems: number;
  updates: number;
  conflicts: number;
  invalid: number;
  sampleRows: Array<{
    rowNumber: number;
    action: "create" | "update" | "conflict" | "invalid";
    data: Partial<InsertItem>;
    error?: string;
  }>;
}

export interface ImportExecutionResult {
  success: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{
    rowNumber: number;
    error: string;
    data: any;
  }>;
}

export type MatchStrategy = "barcodeValue" | "sku" | "both";

export class ImportService {
  constructor(private storage: IStorage) {}

  parseFile(buffer: Buffer, fileName: string): any[] {
    const ext = fileName.toLowerCase().split(".").pop();

    if (ext === "csv") {
      return parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      return XLSX.utils.sheet_to_json(worksheet);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  suggestColumnMappings(headers: string[]): ColumnMapping {
    const mapping: ColumnMapping = {};
    const fieldMappings: { [key: string]: string[] } = {
      name: ["name", "product name", "item name", "title", "description"],
      sku: ["sku", "product code", "item code", "part number", "item number"],
      barcodeValue: ["barcode", "barcode value", "upc", "ean", "gtin", "code", "barcode_value"],
      productKind: ["product kind", "type", "product type", "kind", "product_kind"],
      barcodeUsage: ["barcode usage", "usage", "barcode_usage"],
      barcodeFormat: ["barcode format", "format", "symbology", "barcode_format"],
      barcodeSource: ["barcode source", "source", "barcode_source"],
      externalSystem: ["external system", "system", "source system", "external_system"],
      externalId: ["external id", "external_id", "external reference", "external ref"],
      currentStock: ["current stock", "stock", "quantity", "qty", "current_stock"],
      minStock: ["min stock", "minimum stock", "min_stock", "reorder point"],
      dailyUsage: ["daily usage", "usage", "daily_usage", "avg usage"],
      unit: ["unit", "uom", "unit of measure"],
      location: ["location", "warehouse", "bin"],
    };

    for (const header of headers) {
      const lowerHeader = header.toLowerCase().trim();

      for (const [field, keywords] of Object.entries(fieldMappings)) {
        if (keywords.includes(lowerHeader)) {
          mapping[header] = field;
          break;
        }
      }

      if (!mapping[header]) {
        mapping[header] = null;
      }
    }

    return mapping;
  }

  mapRowToItem(row: any, columnMapping: ColumnMapping): Partial<InsertItem> {
    const item: Partial<InsertItem> = {};

    for (const [csvColumn, schemaField] of Object.entries(columnMapping)) {
      if (schemaField && row[csvColumn] !== undefined && row[csvColumn] !== "") {
        const value = row[csvColumn];

        switch (schemaField) {
          case "currentStock":
          case "minStock":
            item[schemaField] = parseInt(value, 10) || 0;
            break;
          case "dailyUsage":
            item[schemaField] = parseFloat(value) || 0;
            break;
          case "productKind":
            // Normalize productKind values - handle both type values and productKind values
            const normalizedValue = String(value).trim().toLowerCase();
            if (normalizedValue === "finished" || normalizedValue === "finished_product") {
              item.productKind = "FINISHED";
            } else if (normalizedValue === "raw" || normalizedValue === "component") {
              item.productKind = "RAW";
            } else {
              // Keep the original value for validation to catch invalid values
              item.productKind = String(value).trim().toUpperCase();
            }
            break;
          default:
            (item as any)[schemaField] = String(value).trim();
        }
      }
    }

    // If productKind is still not set but type is, derive productKind from type
    if (!item.productKind && item.type) {
      const typeValue = String(item.type).toLowerCase();
      if (typeValue === "finished_product" || typeValue === "finished") {
        item.productKind = "FINISHED";
      } else if (typeValue === "component" || typeValue === "raw") {
        item.productKind = "RAW";
      }
    }

    if (!item.productKind && item.barcodeValue) {
      const barcodeValue = String(item.barcodeValue);
      if (/^\d{12,13}$/.test(barcodeValue)) {
        item.productKind = "FINISHED";
        if (!item.barcodeUsage) {
          item.barcodeUsage = "EXTERNAL_GS1";
        }
      } else {
        if (!item.barcodeUsage) {
          item.barcodeUsage = "INTERNAL_STOCK";
        }
      }
    }

    if (!item.barcodeSource) {
      item.barcodeSource = "IMPORTED";
    }

    // Infer type from productKind if available, but don't default to 'component'
    // This forces explicit classification for safety
    if (!item.type && item.productKind) {
      item.type = item.productKind === "FINISHED" ? "finished_product" : "component";
    }

    if (!item.unit) {
      item.unit = "units";
    }

    return item;
  }

  validateItem(item: Partial<InsertItem>, isUpdate: boolean = false): { valid: boolean; error?: string; warnings?: string[] } {
    const warnings: string[] = [];

    // Required fields
    if (!item.name || String(item.name).trim().length === 0) {
      return { valid: false, error: "Missing required field: name" };
    }

    if (!item.sku || String(item.sku).trim().length === 0) {
      return { valid: false, error: "Missing required field: sku" };
    }

    // Type classification is required for new items (creates)
    // Updates can rely on existing item type
    if (!isUpdate && !item.type && !item.productKind) {
      return {
        valid: false,
        error: "Missing required field: type or productKind. Items must be classified as component or finished_product",
      };
    }

    // Product kind validation
    if (item.productKind && !["FINISHED", "RAW"].includes(item.productKind)) {
      return {
        valid: false,
        error: `Invalid productKind: "${item.productKind}". Must be FINISHED or RAW`,
      };
    }

    // Barcode usage validation
    if (item.barcodeUsage && !["EXTERNAL_GS1", "INTERNAL_STOCK"].includes(item.barcodeUsage)) {
      return {
        valid: false,
        error: `Invalid barcodeUsage: "${item.barcodeUsage}". Must be EXTERNAL_GS1 or INTERNAL_STOCK`,
      };
    }

    // Business rule: FINISHED → EXTERNAL_GS1
    if (item.productKind === "FINISHED" && item.barcodeUsage && item.barcodeUsage !== "EXTERNAL_GS1") {
      return {
        valid: false,
        error: "FINISHED products must use EXTERNAL_GS1 barcode usage",
      };
    }

    // Business rule: RAW → INTERNAL_STOCK
    if (item.productKind === "RAW" && item.barcodeUsage && item.barcodeUsage !== "INTERNAL_STOCK") {
      return {
        valid: false,
        error: "RAW inventory must use INTERNAL_STOCK barcode usage",
      };
    }

    // Suspicious data warnings
    if (item.barcodeValue && String(item.barcodeValue).length < 4) {
      warnings.push("Barcode value is very short (less than 4 characters)");
    }

    if (item.barcodeValue && !/^[A-Z0-9-]+$/i.test(String(item.barcodeValue))) {
      warnings.push("Barcode contains special characters or spaces");
    }

    if (item.currentStock && (item.currentStock < 0 || item.currentStock > 1000000)) {
      warnings.push("Current stock value is outside normal range (0-1,000,000)");
    }

    if (item.dailyUsage && (item.dailyUsage < 0 || item.dailyUsage > 10000)) {
      warnings.push("Daily usage value is outside normal range (0-10,000)");
    }

    return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
  }

  async findMatchingItem(
    item: Partial<InsertItem>,
    matchStrategy: MatchStrategy
  ): Promise<{ matched: boolean; matchedItem?: any; ambiguous: boolean }> {
    const allItems = await this.storage.getAllItems();

    if (matchStrategy === "barcodeValue" && item.barcodeValue) {
      const matched = allItems.find((i) => i.barcodeValue === item.barcodeValue);
      return { matched: !!matched, matchedItem: matched, ambiguous: false };
    }

    if (matchStrategy === "sku" && item.sku) {
      const matched = allItems.find((i) => i.sku === item.sku);
      return { matched: !!matched, matchedItem: matched, ambiguous: false };
    }

    if (matchStrategy === "both" && item.barcodeValue && item.sku) {
      const barcodeMatch = allItems.find((i) => i.barcodeValue === item.barcodeValue);
      const skuMatch = allItems.find((i) => i.sku === item.sku);

      if (barcodeMatch && skuMatch && barcodeMatch.id === skuMatch.id) {
        return { matched: true, matchedItem: barcodeMatch, ambiguous: false };
      }

      if (barcodeMatch || skuMatch) {
        return { matched: true, matchedItem: barcodeMatch || skuMatch, ambiguous: true };
      }
    }

    return { matched: false, ambiguous: false };
  }

  async previewImport(
    rows: any[],
    columnMapping: ColumnMapping,
    matchStrategy: MatchStrategy
  ): Promise<ImportPreviewResult> {
    const result: ImportPreviewResult = {
      totalRows: rows.length,
      newItems: 0,
      updates: 0,
      conflicts: 0,
      invalid: 0,
      sampleRows: [],
    };

    for (let i = 0; i < Math.min(rows.length, 100); i++) {
      const row = rows[i];
      const item = this.mapRowToItem(row, columnMapping);
      
      // Determine if this will be an update or create
      const match = await this.findMatchingItem(item, matchStrategy);
      const isUpdate = match.matched && !match.ambiguous;
      
      const validation = this.validateItem(item, isUpdate);

      if (!validation.valid) {
        result.invalid++;
        result.sampleRows.push({
          rowNumber: i + 1,
          action: "invalid",
          data: item,
          error: validation.error,
        });
        continue;
      }

      if (match.ambiguous) {
        result.conflicts++;
        result.sampleRows.push({
          rowNumber: i + 1,
          action: "conflict",
          data: item,
          error: "Ambiguous match: barcode and SKU match different items",
        });
      } else if (match.matched) {
        result.updates++;
        if (result.sampleRows.length < 20) {
          result.sampleRows.push({
            rowNumber: i + 1,
            action: "update",
            data: item,
          });
        }
      } else {
        result.newItems++;
        if (result.sampleRows.length < 20) {
          result.sampleRows.push({
            rowNumber: i + 1,
            action: "create",
            data: item,
          });
        }
      }
    }

    for (let i = 100; i < rows.length; i++) {
      const row = rows[i];
      const item = this.mapRowToItem(row, columnMapping);
      
      // Determine if this will be an update or create
      const match = await this.findMatchingItem(item, matchStrategy);
      const isUpdate = match.matched && !match.ambiguous;
      
      const validation = this.validateItem(item, isUpdate);

      if (!validation.valid) {
        result.invalid++;
        continue;
      }

      if (match.ambiguous) {
        result.conflicts++;
      } else if (match.matched) {
        result.updates++;
      } else {
        result.newItems++;
      }
    }

    return result;
  }

  async executeImport(
    rows: any[],
    columnMapping: ColumnMapping,
    matchStrategy: MatchStrategy
  ): Promise<ImportExecutionResult> {
    const result: ImportExecutionResult = {
      success: true,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const item = this.mapRowToItem(row, columnMapping);
        
        // Determine if this will be an update or create
        const match = await this.findMatchingItem(item, matchStrategy);
        const isUpdate = match.matched && !match.ambiguous;
        
        // Validate with proper context (isUpdate determines required fields)
        const validation = this.validateItem(item, isUpdate);

        if (!validation.valid) {
          result.skipped++;
          result.errors.push({
            rowNumber: i + 1,
            error: validation.error || "Validation failed",
            data: row,
          });
          continue;
        }

        if (match.ambiguous) {
          result.skipped++;
          result.errors.push({
            rowNumber: i + 1,
            error: "Ambiguous match: barcode and SKU match different items",
            data: row,
          });
          continue;
        }

        // Server-side guard: Prevent currentStock for finished products
        // Finished products use only pivotQty and hildaleQty as sources of truth
        // For updates: check the matched item's type; for creates: check inferred type from productKind
        const isFinishedProduct = match.matched 
          ? match.matchedItem?.type === 'finished_product'
          : (item.productKind === 'FINISHED' || item.type === 'finished_product');
        
        if (isFinishedProduct && 'currentStock' in item) {
          delete item.currentStock;
        }
        
        if (match.matched && match.matchedItem) {
          await this.storage.updateItem(match.matchedItem.id, item);
          result.updated++;
        } else {
          await this.storage.createItem(item as InsertItem);
          result.inserted++;
        }
      } catch (error: any) {
        result.failed++;
        result.errors.push({
          rowNumber: i + 1,
          error: error.message || "Unknown error",
          data: row,
        });
      }
    }

    if (result.failed > 0) {
      result.success = false;
    }

    return result;
  }
}
