import type { IStorage } from "./storage";

export interface BarcodeGenerationResult {
  success: boolean;
  barcodeValue?: string;
  error?: string;
}

export class BarcodeGenerator {
  constructor(private storage: IStorage) {}

  private calculateGTIN12CheckDigit(first11Digits: string): string {
    if (first11Digits.length !== 11) {
      throw new Error("GTIN-12 check digit requires exactly 11 digits");
    }

    let sum = 0;
    for (let i = 0; i < 11; i++) {
      const digit = parseInt(first11Digits[i], 10);
      sum += digit * (i % 2 === 0 ? 3 : 1);
    }

    const checkDigit = (10 - (sum % 10)) % 10;
    return checkDigit.toString();
  }

  async generateGS1Barcode(): Promise<BarcodeGenerationResult> {
    const settings = await this.storage.getBarcodeSettings();

    if (!settings || !settings.gs1Prefix) {
      return {
        success: false,
        error: "GS1 prefix not configured. Please configure barcode settings first.",
      };
    }

    const prefix = settings.gs1Prefix;
    const itemRefDigits = settings.itemRefDigits;

    if (prefix.length + itemRefDigits !== 11) {
      return {
        success: false,
        error: `Invalid configuration: GS1 prefix (${prefix.length} digits) + item reference (${itemRefDigits} digits) must equal 11 digits for GTIN-12.`,
      };
    }

    const nextRef = await this.storage.incrementItemRef();
    
    const itemRefString = nextRef.toString().padStart(itemRefDigits, "0");
    
    if (itemRefString.length > itemRefDigits) {
      return {
        success: false,
        error: `Item reference ${nextRef} exceeds ${itemRefDigits} digits. Maximum value is ${Math.pow(10, itemRefDigits) - 1}.`,
      };
    }

    const first11Digits = prefix + itemRefString;
    const checkDigit = this.calculateGTIN12CheckDigit(first11Digits);
    const gtin12 = first11Digits + checkDigit;

    return {
      success: true,
      barcodeValue: gtin12,
    };
  }

  async generateInternalCode(): Promise<BarcodeGenerationResult> {
    const nextCode = await this.storage.incrementInternalCode();
    const internalCode = `RAW-${nextCode.toString().padStart(6, "0")}`;

    return {
      success: true,
      barcodeValue: internalCode,
    };
  }

  validateProductKindAndUsage(
    productKind: string | null,
    barcodeUsage: string | null
  ): { valid: boolean; error?: string } {
    if (productKind === "FINISHED" && barcodeUsage !== "EXTERNAL_GS1") {
      return {
        valid: false,
        error: "FINISHED products must use EXTERNAL_GS1 barcode usage.",
      };
    }

    if (productKind === "RAW" && barcodeUsage !== "INTERNAL_STOCK") {
      return {
        valid: false,
        error: "RAW inventory must use INTERNAL_STOCK barcode usage.",
      };
    }

    return { valid: true };
  }
}
