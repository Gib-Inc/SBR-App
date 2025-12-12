import { storage } from "../storage";
import type { ReturnRequest, ReturnShipment } from "@shared/schema";

interface ShippoAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

interface ShippoShipmentResult {
  success: boolean;
  shipmentId?: string;
  transactionId?: string;
  carrier?: string;
  trackingNumber?: string;
  labelUrl?: string;
  labelCost?: number;
  labelCurrency?: string;
  estimatedDeliveryDate?: Date;
  error?: string;
}

interface ShippoTrackingStatus {
  status: string;
  statusDetails: string;
  statusDate: Date;
  location?: string;
}

const WAREHOUSE_ADDRESS: ShippoAddress = {
  name: process.env.RETURN_TO_NAME || process.env.SHIPPO_WAREHOUSE_NAME || "Sticker Burr Roller",
  street1: process.env.RETURN_TO_STREET1 || process.env.SHIPPO_WAREHOUSE_STREET1 || "123 Warehouse St",
  street2: process.env.RETURN_TO_STREET2 || process.env.SHIPPO_WAREHOUSE_STREET2 || undefined,
  city: process.env.RETURN_TO_CITY || process.env.SHIPPO_WAREHOUSE_CITY || "Salt Lake City",
  state: process.env.RETURN_TO_STATE || process.env.SHIPPO_WAREHOUSE_STATE || "UT",
  zip: process.env.RETURN_TO_ZIP || process.env.SHIPPO_WAREHOUSE_ZIP || "84101",
  country: process.env.RETURN_TO_COUNTRY || process.env.SHIPPO_WAREHOUSE_COUNTRY || "US",
  phone: process.env.RETURN_TO_PHONE || process.env.SHIPPO_WAREHOUSE_PHONE,
};

export class ShippoReturnsService {
  private apiToken: string | null;
  private defaultCarrier: string;
  private defaultService: string;

  constructor() {
    this.apiToken = process.env.SHIPPO_API_KEY || null;
    this.defaultCarrier = process.env.SHIPPO_DEFAULT_CARRIER || "ups";
    this.defaultService = process.env.SHIPPO_DEFAULT_SERVICE || "ups_ground";
  }

  isConfigured(): boolean {
    return !!this.apiToken;
  }

  async createReturnLabel(returnRequest: ReturnRequest): Promise<ShippoShipmentResult> {
    console.log(`[ShippoReturns] Creating return label for return ${returnRequest.rmaNumber || returnRequest.id}`);

    if (!this.isConfigured()) {
      console.log("[ShippoReturns] Shippo not configured, using stub response");
      return this.createStubLabel(returnRequest);
    }

    try {
      const customerAddress = this.parseCustomerAddress(returnRequest);
      if (!customerAddress) {
        return {
          success: false,
          error: "No valid customer shipping address available",
        };
      }

      const shipmentPayload = {
        address_from: WAREHOUSE_ADDRESS,
        address_to: customerAddress,
        parcels: [{
          length: "10",
          width: "8",
          height: "4",
          distance_unit: "in",
          weight: "1",
          mass_unit: "lb",
        }],
        extra: {
          is_return: true,
        },
        async: false,
      };

      const shipmentResponse = await fetch("https://api.goshippo.com/shipments/", {
        method: "POST",
        headers: {
          "Authorization": `ShippoToken ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(shipmentPayload),
      });

      if (!shipmentResponse.ok) {
        const errorData = await shipmentResponse.json();
        console.error("[ShippoReturns] Shipment creation failed:", errorData);
        return {
          success: false,
          error: `Shippo API error: ${JSON.stringify(errorData)}`,
        };
      }

      const shipment = await shipmentResponse.json();
      const rates = shipment.rates || [];
      
      const preferredRate = rates.find((r: any) => 
        r.provider?.toLowerCase() === this.defaultCarrier.toLowerCase()
      ) || rates[0];

      if (!preferredRate) {
        return {
          success: false,
          error: "No shipping rates available for this address",
        };
      }

      const transactionPayload = {
        rate: preferredRate.object_id,
        label_file_type: "PDF",
        async: false,
      };

      const transactionResponse = await fetch("https://api.goshippo.com/transactions/", {
        method: "POST",
        headers: {
          "Authorization": `ShippoToken ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(transactionPayload),
      });

      if (!transactionResponse.ok) {
        const errorData = await transactionResponse.json();
        console.error("[ShippoReturns] Transaction creation failed:", errorData);
        return {
          success: false,
          error: `Failed to purchase label: ${JSON.stringify(errorData)}`,
        };
      }

      const transaction = await transactionResponse.json();

      if (transaction.status !== "SUCCESS") {
        return {
          success: false,
          error: transaction.messages?.map((m: any) => m.text).join(", ") || "Label purchase failed",
        };
      }

      console.log(`[ShippoReturns] Label created successfully: ${transaction.tracking_number}`);

      return {
        success: true,
        shipmentId: shipment.object_id,
        transactionId: transaction.object_id,
        carrier: preferredRate.provider,
        trackingNumber: transaction.tracking_number,
        labelUrl: transaction.label_url,
        labelCost: parseFloat(preferredRate.amount),
        labelCurrency: preferredRate.currency,
        estimatedDeliveryDate: preferredRate.estimated_days 
          ? new Date(Date.now() + preferredRate.estimated_days * 24 * 60 * 60 * 1000)
          : undefined,
      };

    } catch (error: any) {
      console.error("[ShippoReturns] Error creating return label:", error);
      return {
        success: false,
        error: error.message || "Unknown error creating return label",
      };
    }
  }

  async getTrackingStatus(carrier: string, trackingNumber: string): Promise<ShippoTrackingStatus | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const response = await fetch(
        `https://api.goshippo.com/tracks/${carrier}/${trackingNumber}`,
        {
          headers: {
            "Authorization": `ShippoToken ${this.apiToken}`,
          },
        }
      );

      if (!response.ok) {
        console.error("[ShippoReturns] Tracking lookup failed");
        return null;
      }

      const tracking = await response.json();
      const latestEvent = tracking.tracking_status;

      if (!latestEvent) {
        return null;
      }

      return {
        status: latestEvent.status,
        statusDetails: latestEvent.status_details,
        statusDate: new Date(latestEvent.status_date),
        location: latestEvent.location?.city 
          ? `${latestEvent.location.city}, ${latestEvent.location.state}`
          : undefined,
      };

    } catch (error: any) {
      console.error("[ShippoReturns] Error fetching tracking:", error);
      return null;
    }
  }

  mapShippoStatusToReturnStatus(shippoStatus: string): string | null {
    const statusMap: Record<string, string> = {
      "PRE_TRANSIT": "LABEL_CREATED",
      "TRANSIT": "IN_TRANSIT",
      "DELIVERED": "RETURNED",
      "RETURNED": "RETURNED",
      "FAILURE": "LABEL_CREATED",
      "UNKNOWN": null as any,
    };
    return statusMap[shippoStatus] || null;
  }

  private parseCustomerAddress(returnRequest: ReturnRequest): ShippoAddress | null {
    const shippingAddress = returnRequest.shippingAddress as any;
    
    if (!shippingAddress) {
      return null;
    }

    if (typeof shippingAddress === 'object') {
      return {
        name: shippingAddress.name || returnRequest.customerName,
        street1: shippingAddress.street1 || shippingAddress.address1 || shippingAddress.line1,
        street2: shippingAddress.street2 || shippingAddress.address2 || shippingAddress.line2,
        city: shippingAddress.city,
        state: shippingAddress.state || shippingAddress.province || shippingAddress.region,
        zip: shippingAddress.zip || shippingAddress.postal_code || shippingAddress.postalCode,
        country: shippingAddress.country || shippingAddress.country_code || "US",
        phone: shippingAddress.phone || returnRequest.customerPhone || undefined,
        email: returnRequest.customerEmail || undefined,
      };
    }

    return null;
  }

  private createStubLabel(returnRequest: ReturnRequest): ShippoShipmentResult {
    const stubTrackingNumber = `STUB${Date.now()}${Math.random().toString(36).substring(7).toUpperCase()}`;
    
    return {
      success: true,
      shipmentId: `stub_shipment_${returnRequest.id}`,
      transactionId: `stub_transaction_${returnRequest.id}`,
      carrier: "USPS",
      trackingNumber: stubTrackingNumber,
      labelUrl: `https://example.com/stub-label/${returnRequest.id}.pdf`,
      labelCost: 8.50,
      labelCurrency: "USD",
      estimatedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    };
  }
}

export const shippoReturnsService = new ShippoReturnsService();
