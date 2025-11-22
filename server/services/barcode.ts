import bwipjs from 'bwip-js';

/**
 * Barcode generation service using bwip-js for actual barcode image generation
 */

export interface BarcodeGenerationRequest {
  value: string;
  format?: "CODE128" | "CODE39" | "EAN13" | "UPC";
  width?: number;
  height?: number;
}

export interface BarcodeImage {
  imageData: string; // Base64 encoded image
  format: string;
  width: number;
  height: number;
}

export class BarcodeService {
  /**
   * Generate a barcode image buffer using bwip-js
   */
  static async generateBarcodeBuffer(request: BarcodeGenerationRequest): Promise<Buffer> {
    const format = request.format || "CODE128";
    const height = request.height || 100;

    try {
      const png = await bwipjs.toBuffer({
        bcid: format.toLowerCase().replace('_', ''),
        text: request.value,
        scale: 3,
        height: Math.floor(height / 10),
        includetext: true,
        textxalign: 'center',
      });

      return png;
    } catch (error) {
      console.error('Barcode generation error:', error);
      throw new Error(`Failed to generate barcode: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Generate a barcode image with base64 encoding
   */
  static async generateBarcode(request: BarcodeGenerationRequest): Promise<BarcodeImage> {
    const format = request.format || "CODE128";
    const width = request.width || 300;
    const height = request.height || 100;

    const png = await this.generateBarcodeBuffer(request);
    const base64 = png.toString('base64');
    
    return {
      imageData: `data:image/png;base64,${base64}`,
      format,
      width,
      height,
    };
  }
  
  /**
   * Generate a barcode value based on purpose and counter
   */
  static generateBarcodeValue(purpose: string, counter: number): string {
    const paddedCounter = counter.toString().padStart(3, '0');
    
    switch (purpose) {
      case 'bin':
        return `BIN-${paddedCounter}`;
      case 'item':
        return `ITEM-${paddedCounter}`;
      case 'finished_product':
        return `PROD-${paddedCounter}`;
      default:
        return `BAR-${paddedCounter}`;
    }
  }

  /**
   * Generate a printable barcode layout (HTML/CSS optimized for printing)
   */
  static generatePrintLayout(barcodes: Array<{ value: string; name: string; sku?: string }>): string {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Barcode Print Sheet</title>
  <style>
    @media print {
      @page { margin: 1cm; }
      body { margin: 0; }
      .no-print { display: none; }
    }
    
    body {
      font-family: Arial, sans-serif;
      background: white;
      color: black;
    }
    
    .barcode-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1cm;
      padding: 1cm;
    }
    
    .barcode-item {
      border: 1px solid #ccc;
      padding: 1cm;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    
    .barcode-image {
      width: 100%;
      max-width: 300px;
      height: 100px;
      border: 1px solid #ddd;
      margin: 0 auto 0.5cm;
      display: flex;
      align-items: center;
      justify-content: center;
      background: white;
    }
    
    .barcode-name {
      font-size: 14pt;
      font-weight: bold;
      margin-bottom: 0.3cm;
    }
    
    .barcode-sku {
      font-size: 12pt;
      font-family: monospace;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="barcode-grid">
    ${barcodes.map(barcode => `
      <div class="barcode-item">
        <div class="barcode-image">
          <div style="font-family: monospace; font-size: 10pt;">${barcode.value}</div>
        </div>
        <div class="barcode-name">${barcode.name}</div>
        ${barcode.sku ? `<div class="barcode-sku">${barcode.sku}</div>` : ''}
      </div>
    `).join('')}
  </div>
  <script>
    // Auto-print when loaded
    window.onload = () => {
      setTimeout(() => window.print(), 500);
    };
  </script>
</body>
</html>
    `;
    
    return html;
  }
}
