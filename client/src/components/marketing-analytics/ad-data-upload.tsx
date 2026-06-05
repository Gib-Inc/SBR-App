import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Upload, FileUp, CheckCircle2, AlertTriangle, Loader2, Info } from 'lucide-react';

type Platform = 'GOOGLE' | 'META' | 'AMAZON' | 'PINTEREST';

interface UploadResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  totalRows: number;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  GOOGLE: 'Google Ads',
  META: 'Meta Ads',
  AMAZON: 'Amazon Ads',
  PINTEREST: 'Pinterest Ads',
};

const PLATFORM_HELP: Record<Platform, string> = {
  GOOGLE: 'Export from Google Ads: Reports > Campaigns. Include columns: Campaign, Day, Cost, Conversions, Conv. value, Impressions, Clicks. Optionally include Device and Country/Territory.',
  META: 'Export from Meta Ads Manager: Ads Reporting > Export. Include columns: Campaign name, Day, Amount spent, Purchases (or Results), Purchase ROAS, Impressions, Link clicks.',
  AMAZON: 'Export from Amazon Ads: Reports > Campaign report. Include: Campaign Name, Date, Spend, Orders, Sales, Impressions, Clicks.',
  PINTEREST: 'Export from Pinterest Ads Manager: Analytics > Export. Include: Campaign name, Date, Spend, Conversions, Conversion value, Impressions, Clicks.',
};

export function AdDataUpload() {
  const [platform, setPlatform] = useState<Platform>('GOOGLE');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');

      const formData = new FormData();
      formData.append('file', file);
      formData.append('platform', platform);

      const res = await fetch('/api/marketing-analytics/cmo/upload-ad-csv', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!res.ok) {
        const text = await res.text();
        let msg: string;
        try {
          msg = JSON.parse(text).error || text;
        } catch {
          msg = text;
        }
        throw new Error(msg);
      }

      return res.json() as Promise<UploadResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({
        title: 'Upload complete',
        description: `${data.inserted} inserted, ${data.updated} updated, ${data.skipped} skipped.`,
      });
      // Invalidate ad metrics queries so dashboards refresh
      queryClient.invalidateQueries({ queryKey: ['/api/marketing-analytics'] });
      // Also invalidate specific CMO queries
      queryClient.invalidateQueries({ predicate: (q) => {
        const key = q.queryKey[0];
        return typeof key === 'string' && key.includes('/marketing-analytics/cmo/');
      }});
    },
    onError: (err: Error) => {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setResult(null);
  };

  const handleUpload = () => {
    if (!file) return;
    uploadMutation.mutate();
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Upload Ad Data CSV
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Platform selector and file input */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Platform</label>
            <Select value={platform} onValueChange={(v) => { setPlatform(v as Platform); setResult(null); }}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                  <SelectItem key={p} value={p}>{PLATFORM_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">CSV File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
            />
          </div>

          <Button
            onClick={handleUpload}
            disabled={!file || uploadMutation.isPending}
            size="sm"
          >
            {uploadMutation.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Uploading...</>
            ) : (
              <><FileUp className="h-3.5 w-3.5 mr-1.5" /> Upload</>
            )}
          </Button>

          {result && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              Clear
            </Button>
          )}
        </div>

        {/* Platform-specific help text */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{PLATFORM_HELP[platform]}</span>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                {result.inserted} inserted
              </Badge>
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3 text-blue-500" />
                {result.updated} updated
              </Badge>
              <Badge variant="secondary" className="gap-1">
                {result.skipped} skipped
              </Badge>
              <Badge variant="secondary" className="gap-1 text-muted-foreground">
                {result.totalRows} total rows
              </Badge>
            </div>

            {result.errors.length > 0 && (
              <div className="bg-destructive/5 border border-destructive/20 rounded-md p-2.5 max-h-32 overflow-y-auto">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-xs font-medium text-destructive">{result.errors.length} error(s)</span>
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
