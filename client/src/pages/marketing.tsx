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

      <Tabs defaultValue="pipeline">
        <TabsList>
          <TabsTrigger value="pipeline">Content Pipeline</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        </TabsList>
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
