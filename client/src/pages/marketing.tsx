import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Megaphone,
  Plus,
  Play,
  Eye,
  Trash2,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Zap,
  Target,
  Film,
  Send,
  Shield,
  AlertTriangle,
  Radio,
  RefreshCw,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingCart,
  BarChart3,
  Calendar,
} from "lucide-react";

// ── Types ──

interface MarketingCampaign {
  id: string;
  name: string;
  description: string | null;
  campaignType: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ContentPipelineItem {
  id: string;
  campaignId: string | null;
  title: string;
  status: string;
  avatar: string | null;
  funnelStage: string | null;
  archetype: string | null;
  platform: string | null;
  conversionFramework: string | null;
  psychologyModel: string | null;
  hookCategory: string | null;
  primaryObjection: string | null;
  paidPotential: boolean | null;
  intakeOutput: any;
  briefOutput: any;
  scriptOutput: any;
  visualOutput: any;
  distributionOutput: any;
  reviewOutput: any;
  reviewScore: number | null;
  reviewNotes: string | null;
  pipelineStopReason: string | null;
  escalationRoute: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PipelineLog {
  id: string;
  pipelineItemId: string;
  agentNumber: number;
  agentName: string;
  input: any;
  output: any;
  durationMs: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

// ── Constants ──

const AVATARS = [
  { value: "DOG_OWNER", label: "Dog Owner", color: "bg-amber-100 text-amber-800" },
  { value: "BAREFOOT_FAMILY", label: "Barefoot Family", color: "bg-green-100 text-green-800" },
  { value: "TIME_CONSCIOUS", label: "Time Conscious", color: "bg-blue-100 text-blue-800" },
  { value: "PREVENTION_THINKER", label: "Prevention Thinker", color: "bg-purple-100 text-purple-800" },
  { value: "ACREAGE_OWNER", label: "Acreage Owner", color: "bg-orange-100 text-orange-800" },
  { value: "SKEPTIC", label: "Skeptic", color: "bg-red-100 text-red-800" },
];

const FUNNEL_STAGES = ["COLD", "WARM", "HOT"];
const ARCHETYPES = ["AHA_MECHANICS", "ORIGIN_STORY", "SATAN_SPAWN"];
const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "EMAIL", "PINTEREST", "FACEBOOK"];
const CAMPAIGN_TYPES = ["SEASONAL", "PRODUCT_LAUNCH", "EVERGREEN", "RETARGETING", "B2B"];

const PIPELINE_STAGES = [
  { key: "INTAKE", label: "Intake", icon: Target, agent: 1 },
  { key: "BRIEF", label: "Brief", icon: Zap, agent: 2 },
  { key: "SCRIPT", label: "Script", icon: Megaphone, agent: 3 },
  { key: "VISUAL", label: "Visual", icon: Film, agent: 4 },
  { key: "DISTRIBUTION", label: "Distribution", icon: Send, agent: 5 },
  { key: "REVIEW", label: "Review", icon: Shield, agent: 6 },
];

const STATUS_COLORS: Record<string, string> = {
  INTAKE: "bg-slate-100 text-slate-700",
  BRIEF: "bg-blue-100 text-blue-700",
  SCRIPT: "bg-indigo-100 text-indigo-700",
  VISUAL: "bg-violet-100 text-violet-700",
  DISTRIBUTION: "bg-purple-100 text-purple-700",
  REVIEW: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  PUBLISHED: "bg-emerald-100 text-emerald-700",
  DRAFT: "bg-gray-100 text-gray-600",
};

function getAvatarInfo(avatar: string | null) {
  return AVATARS.find((a) => a.value === avatar) || { value: avatar, label: avatar || "Unknown", color: "bg-gray-100 text-gray-700" };
}

// ── Campaigns Tab ──

function CampaignsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [campaignType, setCampaignType] = useState("EVERGREEN");

  const { data: campaigns = [], isLoading } = useQuery<MarketingCampaign[]>({
    queryKey: ["/api/marketing/campaigns"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/marketing/campaigns", {
        name,
        description: description || null,
        campaignType,
        status: "DRAFT",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
      setShowCreate(false);
      setName("");
      setDescription("");
      toast({ title: "Campaign created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/marketing/campaigns/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/campaigns"] });
      toast({ title: "Campaign deleted" });
    },
  });

  if (isLoading) return <div className="p-6 text-center text-muted-foreground">Loading campaigns...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}</p>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Campaign</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Campaign</DialogTitle>
              <DialogDescription>Set up a new marketing campaign to organize content.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring Ground War 2026" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Campaign description..." />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={campaignType} onValueChange={setCampaignType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No campaigns yet. Create one to start organizing content.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <div className="font-medium">{c.name}</div>
                  {c.description && <p className="text-sm text-muted-foreground mt-1">{c.description}</p>}
                  <div className="flex gap-2 mt-2">
                    <Badge variant="outline">{c.campaignType.replace("_", " ")}</Badge>
                    <Badge className={STATUS_COLORS[c.status] || "bg-gray-100"}>{c.status}</Badge>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(c.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pipeline Tab ──

function PipelineTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [avatar, setAvatar] = useState("");
  const [funnelStage, setFunnelStage] = useState("");
  const [archetype, setArchetype] = useState("");
  const [platform, setPlatform] = useState("");
  const [selectedItem, setSelectedItem] = useState<ContentPipelineItem | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery<ContentPipelineItem[]>({
    queryKey: ["/api/marketing/pipeline"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/marketing/pipeline", {
        title,
        avatar: avatar || undefined,
        funnelStage: funnelStage || undefined,
        archetype: archetype || undefined,
        platform: platform || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/pipeline"] });
      setShowCreate(false);
      setTitle("");
      setAvatar("");
      setFunnelStage("");
      setArchetype("");
      setPlatform("");
      toast({ title: "Content added to pipeline" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const runPipelineMutation = useMutation({
    mutationFn: async (id: string) => {
      setRunningId(id);
      const res = await apiRequest("POST", `/api/marketing/pipeline/${id}/run`, {
        avatar: avatar || undefined,
        funnelStage: funnelStage || undefined,
        archetype: archetype || undefined,
        platform: platform || undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setRunningId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/pipeline"] });
      if (data.success) {
        toast({ title: "Pipeline complete. Content approved." });
      } else {
        toast({ title: "Pipeline finished", description: data.error || "Content needs revision.", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      setRunningId(null);
      toast({ title: "Pipeline error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/marketing/pipeline/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/pipeline"] });
      toast({ title: "Item removed" });
    },
  });

  if (isLoading) return <div className="p-6 text-center text-muted-foreground">Loading pipeline...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{items.length} item{items.length !== 1 ? "s" : ""} in pipeline</p>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Content</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>New Content Item</DialogTitle>
              <DialogDescription>Describe the content topic. ZO.BOT will run the D1 pipeline.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Topic / Content Description</Label>
                <Textarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Dog owner testimonial about goathead removal from their backyard"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Avatar (optional)</Label>
                  <Select value={avatar} onValueChange={setAvatar}>
                    <SelectTrigger><SelectValue placeholder="Auto-detect" /></SelectTrigger>
                    <SelectContent>
                      {AVATARS.map((a) => (
                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Funnel Stage (optional)</Label>
                  <Select value={funnelStage} onValueChange={setFunnelStage}>
                    <SelectTrigger><SelectValue placeholder="Auto-detect" /></SelectTrigger>
                    <SelectContent>
                      {FUNNEL_STAGES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Archetype (optional)</Label>
                  <Select value={archetype} onValueChange={setArchetype}>
                    <SelectTrigger><SelectValue placeholder="Auto-detect" /></SelectTrigger>
                    <SelectContent>
                      {ARCHETYPES.map((a) => (
                        <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Platform (optional)</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger><SelectValue placeholder="Auto-detect" /></SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createMutation.mutate()} disabled={!title.trim() || createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Add to Pipeline
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No content in the pipeline. Add a topic and let ZO.BOT create it.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{item.title}</div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge className={STATUS_COLORS[item.status] || "bg-gray-100"}>{item.status}</Badge>
                      {item.avatar && <Badge className={getAvatarInfo(item.avatar).color}>{getAvatarInfo(item.avatar).label}</Badge>}
                      {item.funnelStage && <Badge variant="outline">{item.funnelStage}</Badge>}
                      {item.archetype && <Badge variant="outline">{item.archetype.replace(/_/g, " ")}</Badge>}
                      {item.platform && <Badge variant="outline">{item.platform}</Badge>}
                      {item.reviewScore !== null && (
                        <Badge variant="outline" className={item.reviewScore >= 8 ? "text-green-700" : "text-red-700"}>
                          Score: {item.reviewScore}/10
                        </Badge>
                      )}
                    </div>
                    {item.pipelineStopReason && (
                      <div className="flex items-center gap-1 mt-2 text-sm text-red-600">
                        <AlertTriangle className="h-3 w-3" /> PIPELINE STOP: {item.pipelineStopReason}
                      </div>
                    )}

                    {/* Pipeline progress indicator */}
                    <div className="flex items-center gap-1 mt-3">
                      {PIPELINE_STAGES.map((stage, idx) => {
                        const stageIdx = PIPELINE_STAGES.findIndex((s) => s.key === item.status);
                        const isComplete = idx < stageIdx || item.status === "APPROVED" || item.status === "PUBLISHED";
                        const isCurrent = stage.key === item.status;
                        const isRunning = runningId === item.id && isCurrent;
                        return (
                          <div key={stage.key} className="flex items-center">
                            <div
                              className={`flex items-center justify-center h-7 w-7 rounded-full text-xs ${
                                isComplete ? "bg-green-500 text-white" : isCurrent ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                              }`}
                              title={stage.label}
                            >
                              {isRunning ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : isComplete ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : (
                                stage.agent
                              )}
                            </div>
                            {idx < PIPELINE_STAGES.length - 1 && (
                              <ChevronRight className={`h-3 w-3 mx-0.5 ${isComplete ? "text-green-500" : "text-muted-foreground"}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {(item.status === "INTAKE" || item.status === "REJECTED") && (
                      <Button
                        size="sm"
                        onClick={() => runPipelineMutation.mutate(item.id)}
                        disabled={runningId !== null}
                      >
                        {runningId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <Play className="h-4 w-4 mr-1" />
                        )}
                        Run Pipeline
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setSelectedItem(item)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(item.id)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail Dialog */}
      <PipelineDetailDialog item={selectedItem} onClose={() => setSelectedItem(null)} />
    </div>
  );
}

// ── Pipeline Detail Dialog ──

function PipelineDetailDialog({ item, onClose }: { item: ContentPipelineItem | null; onClose: () => void }) {
  const [activeAgent, setActiveAgent] = useState("1");

  const { data: logs = [] } = useQuery<PipelineLog[]>({
    queryKey: ["/api/marketing/pipeline", item?.id, "logs"],
    queryFn: async () => {
      const res = await fetch(`/api/marketing/pipeline/${item!.id}/logs`, { credentials: "include" });
      return res.json();
    },
    enabled: !!item,
  });

  if (!item) return null;

  const agentOutputs: Record<number, any> = {
    1: item.intakeOutput,
    2: item.briefOutput,
    3: item.scriptOutput,
    4: item.visualOutput,
    5: item.distributionOutput,
    6: item.reviewOutput,
  };

  const agentNames: Record<number, string> = {
    1: "Intake + Funnel Intelligence",
    2: "Brief Writer",
    3: "Conversion Script Writer",
    4: "Visual Director",
    5: "Distribution + Paid Signal",
    6: "Brand Reviewer",
  };

  return (
    <Dialog open={!!item} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            {item.title}
          </DialogTitle>
          <DialogDescription>
            <div className="flex flex-wrap gap-2 mt-1">
              <Badge className={STATUS_COLORS[item.status]}>{item.status}</Badge>
              {item.avatar && <Badge className={getAvatarInfo(item.avatar).color}>{getAvatarInfo(item.avatar).label}</Badge>}
              {item.funnelStage && <Badge variant="outline">{item.funnelStage}</Badge>}
              {item.reviewScore !== null && <Badge variant="outline">Score: {item.reviewScore}/10</Badge>}
            </div>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeAgent} onValueChange={setActiveAgent}>
          <TabsList className="grid grid-cols-6 w-full">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <TabsTrigger key={n} value={String(n)} className="text-xs" disabled={!agentOutputs[n]}>
                A{n}
              </TabsTrigger>
            ))}
          </TabsList>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <TabsContent key={n} value={String(n)}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Agent {n}: {agentNames[n]}</CardTitle>
                  {logs.find((l) => l.agentNumber === n) && (
                    <CardDescription>
                      {logs.find((l) => l.agentNumber === n)!.durationMs
                        ? `Completed in ${(logs.find((l) => l.agentNumber === n)!.durationMs! / 1000).toFixed(1)}s`
                        : ""}
                      {" "}
                      <Badge variant="outline" className="text-xs">
                        {logs.find((l) => l.agentNumber === n)!.status}
                      </Badge>
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  {agentOutputs[n] ? (
                    <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap">
                      {JSON.stringify(agentOutputs[n], null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">No output yet. Run the pipeline to generate.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        {item.reviewNotes && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="py-3">
              <div className="text-sm font-medium text-amber-800">Review Notes</div>
              <p className="text-sm text-amber-700 mt-1">{item.reviewNotes}</p>
            </CardContent>
          </Card>
        )}

        {item.escalationRoute && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-3">
              <div className="text-sm font-medium text-red-800">Escalation Required</div>
              <p className="text-sm text-red-700 mt-1">Route to: {item.escalationRoute}</p>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Morning Trap Tab ──

interface MorningTrapRun {
  id: string;
  userId: string;
  runDate: string;
  googleAdsRaw: any;
  shopifyOrderCount: number;
  shopifyGrossSales: string;
  shopifySourceBreakdown: Record<string, { orders: number; revenue: number }> | null;
  shopifyRefundCount: number;
  claudeBriefing: string | null;
  smsSent: boolean;
  smsSentAt: string | null;
  createdAt: string;
}

interface TrapCheckResult {
  success: boolean;
  briefing: string | null;
  smsSent: boolean;
  smsError?: string;
  dataSources: {
    googleAds: { success: boolean; error?: string; data?: any };
    shopify: { success: boolean; error?: string; data?: any };
  };
  runDate: string;
}

function MorningTrapTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<MorningTrapRun | null>(null);

  const { data: latest, isLoading: latestLoading } = useQuery<MorningTrapRun>({
    queryKey: ["/api/marketing/trap-check/latest"],
  });

  const { data: history = [], isLoading: historyLoading } = useQuery<MorningTrapRun[]>({
    queryKey: ["/api/marketing/trap-check/history"],
  });

  const runMutation = useMutation({
    mutationFn: async (sendSms: boolean) => {
      const res = await apiRequest("POST", "/api/marketing/trap-check", { sendSms });
      return res.json() as Promise<TrapCheckResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/trap-check/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/trap-check/history"] });
      if (data.success) {
        toast({
          title: "Trap check complete",
          description: data.smsSent ? "Briefing sent to Zo via SMS" : "Briefing generated (SMS not sent)",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Trap check failed", description: err.message, variant: "destructive" });
    },
  });

  const displayRun = selectedRun || latest;

  const formatCurrency = (val: string | number) => {
    const num = typeof val === "string" ? parseFloat(val) : val;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num || 0);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className="h-5 w-5 text-green-600" />
          <div>
            <h3 className="font-medium">Morning Trap Runner</h3>
            <p className="text-sm text-muted-foreground">
              Daily KPI briefing. Pulls Google Ads, Shopify, sends to Zo at 7 AM MST.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runMutation.mutate(false)}
            disabled={runMutation.isPending}
          >
            {runMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Run Now (no SMS)
          </Button>
          <Button
            size="sm"
            onClick={() => runMutation.mutate(true)}
            disabled={runMutation.isPending}
          >
            {runMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="mr-2 h-4 w-4" />
            )}
            Run + Send SMS
          </Button>
        </div>
      </div>

      {/* Just-ran result */}
      {runMutation.data && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-4 text-sm">
              <Badge variant={runMutation.data.success ? "default" : "destructive"}>
                {runMutation.data.success ? "Success" : "Failed"}
              </Badge>
              <div className="flex gap-4">
                {Object.entries(runMutation.data.dataSources).map(([name, src]) => (
                  <span key={name} className="flex items-center gap-1">
                    {src.success ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                    {name}
                  </span>
                ))}
              </div>
              {runMutation.data.smsSent ? (
                <Badge variant="outline" className="text-green-700 border-green-300">SMS Sent</Badge>
              ) : runMutation.data.smsError ? (
                <span className="text-xs text-red-600">{runMutation.data.smsError}</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Briefing display */}
        <div className="lg:col-span-2 space-y-4">
          {latestLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : displayRun?.claudeBriefing ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    {formatDate(displayRun.runDate)} Briefing
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {displayRun.smsSent && (
                      <Badge variant="outline" className="text-green-700 border-green-300 text-xs">
                        SMS sent {displayRun.smsSentAt ? formatTime(displayRun.smsSentAt) : ""}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {formatTime(displayRun.createdAt)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground bg-muted/50 rounded-lg p-4 max-h-[600px] overflow-y-auto">
                  {displayRun.claudeBriefing}
                </pre>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Radio className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground font-medium">No trap checks run yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Click "Run Now" to generate the first briefing, or wait for the 7 AM automatic run.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Quick stats cards from the latest run */}
          {displayRun && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <ShoppingCart className="h-3.5 w-3.5" />
                    Shopify Orders
                  </div>
                  <div className="text-2xl font-semibold">{displayRun.shopifyOrderCount}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <DollarSign className="h-3.5 w-3.5" />
                    Gross Sales
                  </div>
                  <div className="text-2xl font-semibold">{formatCurrency(displayRun.shopifyGrossSales)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <TrendingDown className="h-3.5 w-3.5" />
                    Refunds
                  </div>
                  <div className="text-2xl font-semibold">{displayRun.shopifyRefundCount}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Google Ads
                  </div>
                  <div className="text-2xl font-semibold">
                    {displayRun.googleAdsRaw?.error
                      ? "N/A"
                      : displayRun.googleAdsRaw?.totalSpend != null
                        ? formatCurrency(displayRun.googleAdsRaw.totalSpend)
                        : "N/A"
                    }
                  </div>
                  <div className="text-xs text-muted-foreground">spend MTD</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Source breakdown */}
          {displayRun?.shopifySourceBreakdown && Object.keys(displayRun.shopifySourceBreakdown).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Source Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(displayRun.shopifySourceBreakdown)
                    .sort(([, a], [, b]) => b.revenue - a.revenue)
                    .map(([source, data]) => (
                      <div key={source} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs font-mono">{source}</Badge>
                          <span className="text-muted-foreground">{data.orders} orders</span>
                        </div>
                        <span className="font-medium">{formatCurrency(data.revenue)}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* History sidebar */}
        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Run History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6 text-center">No history yet</p>
              ) : (
                <div className="max-h-[500px] overflow-y-auto">
                  {history.map((run) => (
                    <button
                      key={run.id}
                      onClick={() => setSelectedRun(run.id === selectedRun?.id ? null : run)}
                      className={`w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors ${
                        selectedRun?.id === run.id ? "bg-muted" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{formatDate(run.runDate)}</span>
                        <div className="flex items-center gap-1.5">
                          {run.smsSent && (
                            <MessageSquare className="h-3 w-3 text-green-600" />
                          )}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{run.shopifyOrderCount} orders</span>
                        <span>{formatCurrency(run.shopifyGrossSales)}</span>
                        <span>{formatTime(run.createdAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function Marketing() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6" />
            ZO.BOT Marketing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            D1 Content Pipeline. 6-agent system. SOPH.E quality gate.
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" /> 70% Intelligence Loaded
        </Badge>
      </div>

      {/* Pipeline stage legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {PIPELINE_STAGES.map((s) => (
          <div key={s.key} className="flex items-center gap-1">
            <s.icon className="h-3 w-3" />
            <span>A{s.agent}: {s.label}</span>
          </div>
        ))}
      </div>

      <Tabs defaultValue="trap-check">
        <TabsList>
          <TabsTrigger value="trap-check">Morning Trap</TabsTrigger>
          <TabsTrigger value="pipeline">Content Pipeline</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        </TabsList>
        <TabsContent value="trap-check">
          <MorningTrapTab />
        </TabsContent>
        <TabsContent value="pipeline">
          <PipelineTab />
        </TabsContent>
        <TabsContent value="campaigns">
          <CampaignsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
