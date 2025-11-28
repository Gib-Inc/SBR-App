import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Wrench } from "lucide-react";

export default function Suppliers() {
  return (
    <div className="flex flex-col gap-6 p-6" data-testid="page-suppliers">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">
          Suppliers
        </h1>
        <p className="text-muted-foreground" data-testid="text-page-subtitle">
          Supplier discovery and relationship management (coming in V2).
        </p>
      </div>

      <div className="flex items-center justify-center flex-1 min-h-[400px]">
        <Card className="max-w-md w-full" data-testid="card-v2-coming-soon">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle className="flex items-center justify-center gap-2">
              <Wrench className="h-5 w-5" />
              Supplier tools are coming soon
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted-foreground" data-testid="text-v2-description">
              In V2, this page will help you discover, organize, and manage suppliers. 
              For now, manage purchase orders and receipts from the Purchase Orders section.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
