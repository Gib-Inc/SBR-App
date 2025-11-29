// ============================================================================
// RETURN LABEL SERVICE
// ============================================================================
// Provider-agnostic service for generating return shipping labels.
// Currently uses a stub implementation. In production, this would integrate
// with a real shipping provider like Shippo, EasyPost, or ShipStation.

export interface ReturnLabelRequest {
  customerName: string;
  customerAddress?: {
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
  };
  carrierPreference?: string; // e.g., 'UPS', 'USPS', 'FEDEX'
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    weight?: number; // In ounces/grams (provider-specific)
  }>;
}

export interface ReturnLabelResponse {
  carrier: string;
  trackingNumber: string;
  labelUrl: string;
  // Extended fields for Shippo logging
  shippoShipmentId?: string;
  shippoTransactionId?: string;
  serviceLevel?: string;
  labelCost?: number;
  labelCurrency?: string;
}

export interface IReturnLabelService {
  generateLabel(request: ReturnLabelRequest): Promise<ReturnLabelResponse>;
}

// ============================================================================
// STUB IMPLEMENTATION
// ============================================================================
// Generates fake but deterministic shipping labels for testing and development.
// TODO: Replace with real shipping provider integration (Shippo/EasyPost/ShipStation)
// when ready for production. Ensure compliance with carrier ToS and marketplace
// policies (Amazon/Shopify/etc.) when implementing real provider.

export class StubReturnLabelService implements IReturnLabelService {
  private counter = 1000;

  async generateLabel(request: ReturnLabelRequest): Promise<ReturnLabelResponse> {
    // Generate deterministic fake data
    const trackingId = this.generateTrackingNumber();
    const carrier = request.carrierPreference || this.selectDefaultCarrier(request);
    
    // In production, this would be a real PDF/PNG URL from the shipping provider
    const labelUrl = `https://example.com/labels/${trackingId}.pdf`;

    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      carrier,
      trackingNumber: trackingId,
      labelUrl,
    };
  }

  private generateTrackingNumber(): string {
    const id = this.counter++;
    const timestamp = Date.now().toString().slice(-6);
    return `FAKE-TRK-${timestamp}-${id}`;
  }

  private selectDefaultCarrier(request: ReturnLabelRequest): string {
    // In production, this would use actual shipping rates and transit times
    // For now, just pick a random carrier
    const carriers = ['USPS', 'UPS', 'FEDEX'];
    return carriers[Math.floor(Math.random() * carriers.length)];
  }
}

// ============================================================================
// SHIPPO IMPLEMENTATION
// ============================================================================
// Real Shippo API integration for production shipping label generation.
// Requires SHIPPO_API_KEY environment variable to be set.

export class ShippoReturnLabelService implements IReturnLabelService {
  private apiKey: string;
  private apiBaseUrl = 'https://api.goshippo.com';
  
  // Warehouse/return address - configure this via environment or DB
  private readonly warehouseAddress = {
    name: process.env.WAREHOUSE_NAME || 'Returns Department',
    street1: process.env.WAREHOUSE_STREET1 || '123 Warehouse St',
    street2: process.env.WAREHOUSE_STREET2 || '',
    city: process.env.WAREHOUSE_CITY || 'Los Angeles',
    state: process.env.WAREHOUSE_STATE || 'CA',
    zip: process.env.WAREHOUSE_ZIP || '90001',
    country: process.env.WAREHOUSE_COUNTRY || 'US',
  };

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateLabel(request: ReturnLabelRequest): Promise<ReturnLabelResponse> {
    if (!request.customerAddress) {
      throw new Error('Customer address is required for Shippo label generation');
    }

    try {
      // Step 1: Create shipment (from customer to warehouse)
      const shipment = await this.createShipment(request);
      
      // Step 2: Select cheapest rate
      const rate = this.selectBestRate(shipment.rates, request.carrierPreference);
      
      // Step 3: Purchase label
      const transaction = await this.purchaseLabel(rate.object_id);
      
      return {
        carrier: transaction.tracking_carrier || rate.provider,
        trackingNumber: transaction.tracking_number,
        labelUrl: transaction.label_url,
        // Extended fields for logging
        shippoShipmentId: shipment.object_id,
        shippoTransactionId: transaction.object_id,
        serviceLevel: rate.servicelevel?.name || rate.servicelevel_name,
        labelCost: parseFloat(rate.amount) || undefined,
        labelCurrency: rate.currency || 'USD',
      };
    } catch (error: any) {
      console.error('[ShippoService] Label generation failed:', error.message);
      throw new Error(`Failed to generate Shippo label: ${error.message}`);
    }
  }

  private async createShipment(request: ReturnLabelRequest) {
    const totalWeight = request.items.reduce((sum, item) => 
      sum + ((item.weight || 8) * item.quantity), 0 // Default 8oz per item if no weight
    );

    const shipmentData = {
      address_from: request.customerAddress,
      address_to: this.warehouseAddress,
      parcels: [{
        length: "12",
        width: "10",
        height: "6",
        distance_unit: "in",
        weight: totalWeight.toString(),
        mass_unit: "oz"
      }],
      async: false
    };

    const response = await fetch(`${this.apiBaseUrl}/shipments/`, {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(shipmentData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create Shippo shipment');
    }

    return await response.json();
  }

  private selectBestRate(rates: any[], carrierPreference?: string) {
    if (!rates || rates.length === 0) {
      throw new Error('No shipping rates available');
    }

    // Filter by carrier preference if provided
    let filteredRates = rates;
    if (carrierPreference) {
      filteredRates = rates.filter(r => 
        r.provider.toLowerCase().includes(carrierPreference.toLowerCase())
      );
    }

    // If no rates match preference, fall back to all rates
    if (filteredRates.length === 0) {
      filteredRates = rates;
    }

    // Sort by price and select cheapest
    filteredRates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
    return filteredRates[0];
  }

  private async purchaseLabel(rateId: string) {
    const response = await fetch(`${this.apiBaseUrl}/transactions/`, {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rate: rateId,
        label_file_type: "PDF",
        async: false
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to purchase Shippo label');
    }

    return await response.json();
  }
}

// Factory function to create the label service
// Checks environment to determine which provider to use
export function createReturnLabelService(): IReturnLabelService {
  const shippoKey = process.env.SHIPPO_API_KEY;
  
  // Use Shippo if API key is configured
  if (shippoKey) {
    console.log('[LabelService] Using Shippo for return label generation');
    return new ShippoReturnLabelService(shippoKey);
  }
  
  // Fall back to stub in development/testing
  console.log('[LabelService] Using stub for return label generation (set SHIPPO_API_KEY to use Shippo)');
  return new StubReturnLabelService();
}
