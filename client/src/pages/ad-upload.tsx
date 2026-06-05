import { AdDataUpload } from '@/components/marketing-analytics/ad-data-upload';
import { Card, CardContent } from '@/components/ui/card';
import { Upload } from 'lucide-react';

export default function AdUploadPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Upload className="h-6 w-6" /> SBR — Ad Data Upload
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload weekly CSV exports from Google Ads, Meta Ads, Amazon Ads, or Pinterest Ads.
        </p>
      </div>

      <AdDataUpload />

      <Card>
        <CardContent className="pt-4 space-y-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Quick Guide</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li><strong>Select the platform</strong> that matches your CSV file (Google, Meta, Amazon, or Pinterest).</li>
            <li><strong>Choose the CSV file</strong> you downloaded or received via email from the ad platform.</li>
            <li><strong>Click Upload.</strong> The system auto-detects columns and imports the data.</li>
            <li><strong>Check the results:</strong> "Inserted" = new rows, "Updated" = refreshed existing data, "Skipped" = empty rows ignored.</li>
          </ol>
          <p className="text-xs border-t pt-3">
            Upload weekly — every Monday is ideal. Google and Meta can auto-email CSVs (set up scheduled reports in each platform). Amazon and Pinterest require manual CSV download. Duplicates are safe — re-uploading the same data updates existing rows rather than creating duplicates.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
