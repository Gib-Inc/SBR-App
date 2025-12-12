import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useUnifiedScanner, type ScanResult } from "@/hooks/use-unified-scanner";
import { DamageAssessmentDialog } from "@/components/damage-assessment-dialog";

interface ScanContextType {
  scan: (code: string) => void;
  isScanning: boolean;
  lastResult: ScanResult | null;
  reset: () => void;
}

const ScanContext = createContext<ScanContextType | null>(null);

export function ScanProvider({ children }: { children: ReactNode }) {
  const [damageAssessmentOpen, setDamageAssessmentOpen] = useState(false);
  const [damageAssessmentResult, setDamageAssessmentResult] = useState<ScanResult | null>(null);

  const handleScanSuccess = useCallback((result: ScanResult) => {
    if (result.status === "PENDING_DAMAGE_ASSESSMENT") {
      setDamageAssessmentResult(result);
      setDamageAssessmentOpen(true);
    }
  }, []);

  const scanner = useUnifiedScanner({
    onScanSuccess: handleScanSuccess,
    showToasts: true,
    source: 'WAREHOUSE_SCANNER',
  });

  const handleCloseDamageAssessment = useCallback(() => {
    setDamageAssessmentOpen(false);
    setDamageAssessmentResult(null);
    scanner.reset();
  }, [scanner]);

  return (
    <ScanContext.Provider value={{
      scan: scanner.scan,
      isScanning: scanner.isScanning,
      lastResult: scanner.lastResult,
      reset: scanner.reset,
    }}>
      {children}
      
      <DamageAssessmentDialog
        open={damageAssessmentOpen}
        onClose={handleCloseDamageAssessment}
        scanResult={damageAssessmentResult}
      />
    </ScanContext.Provider>
  );
}

export function useScan() {
  const context = useContext(ScanContext);
  if (!context) {
    throw new Error("useScan must be used within a ScanProvider");
  }
  return context;
}
