/**
 * ZO.BOT.1000 — D1 Content Pipeline Service
 *
 * 6-agent pipeline for SBR marketing content creation.
 * Each agent passes output to the next. Agent 6 (Brand Reviewer) gates all output.
 *
 * SOPH.E.1000 standard: if it wouldn't make Stacy proud, it doesn't go out.
 */

import Anthropic from "@anthropic-ai/sdk";
import { storage } from "../storage";
import type { ContentPipelineItem, InsertContentPipelineLog } from "@shared/schema";

const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

// ── ZO.BOT System Prompt (shared across all agents) ──

const ZOBOT_SYSTEM_BASE = `You are ZO.BOT.1000 — the marketing intelligence system for Sticker Burr Roller (SBR).

BRAND: Sticker Burr Roller (SBR) — Inspired Tool Design LLC, Hildale, Utah.
Patent: US 11,678,611 B2. Made in USA.
The only patented mechanical seed bank removal system on the market.

PRODUCTS:
- Push 1.0: $400 MSRP (under 1/4 acre)
- Push 2.0: $500 MSRP (1/4 to 1 acre)
- Pull-Behind Original: $2,000 MSRP (1-5 acres, 1-3 acres/hour)
- Bigfoot: $2,250 MSRP (5+ acres, chainable to 9 units = 414-inch width)

AU BRAND: Bindi Roller (never "Sticker Burr Roller" in Australian content).

VOICE RULES (NON-NEGOTIABLE):
- Contractions always: didn't not did not. Won't not will not.
- No em dashes ever. Period or comma instead.
- Short sentences. One idea per sentence.
- Max one exclamation mark per piece.
- Warm. Plain-spoken. Knowledgeable neighbor, not a salesperson.
- Never hype. Never corporate. Never performative.
- Always present options, never one direction only.

BANNED PHRASES (ZERO TOLERANCE):
game-changer, revolutionary, unlock, leverage, seamless, incredible, amazing, powerful, supercharge, Great question, Absolutely, Of course, Certainly, I would love to help, No worries, Perfect, Awesome, Sure thing, I totally understand, Does that sound good, Ready to buy, Don't hesitate to reach out

ACTIVE CODES: ROLLY10, ASKROLLY20, SAMM20, MATT20, REORDER15
BANNED CODES: CODESALE20 (retired), PBPR1 (not active)

PIPELINE_STOP TRIGGERS:
- CODESALE20 appears anywhere
- PBPR1 appears anywhere
- "buy" in COLD funnel content
- Product name in COLD funnel content

AVATARS:
1. DOG_OWNER (highest performing) — dog paws, pet safe, chemical-free
2. BAREFOOT_FAMILY — kids outside, barefoot summer, safe backyard
3. TIME_CONSCIOUS — hours, every year, faster, easier
4. PREVENTION_THINKER — permanent, seed bank, root cause
5. ACREAGE_OWNER — acres, ATV, ranch, pasture
6. SKEPTIC — tried everything, proof first, patent

WAR VOCABULARY (consumer only, never B2B):
Seed bank, Ammunition, Fallen soldiers, Ground War, Mother plant, The Protocol, Drain the seed bank, Barefoot Freedom, Armor-piercing, Acres per hour, The enemy is resting, Seed factories, Free seed distribution

ARCHETYPES:
- AHA_MECHANICS: Raw, garage-style, practical. Shows how it works.
- ORIGIN_STORY: Stacy's personal journey. STACY_APPROVAL_REQUIRED before production.
- SATAN_SPAWN: High energy against burrs. TikTok ONLY.

PSYCHOLOGY MODELS:
LOSS_AVERSION, IKEA_EFFECT, ZEIGARNIK, GOAL_GRADIENT, ENDOWMENT, SCARCITY_ETHICAL, SOCIAL_PROOF, ANCHORING

PROOF POINTS:
- City of Hobbs NM: 3 Pull-Behind units. Eliminated annual herbicide program.
- Antelope Island State Park UT: Rangers operate Bigfoot via UTVs.
- Hatch Valley Public Schools NM: Eliminated all herbicide on school grounds.
- City of Portales NM: Ongoing active municipal account.

Respond ONLY with valid JSON. No markdown fences, no extra text.`;

// ── Agent Prompts ──

const AGENT_PROMPTS: Record<number, string> = {
  1: `You are Agent 1: INTAKE + FUNNEL INTELLIGENCE.

Given a content request/topic, analyze and assign:
- avatar: which of the 6 avatars this content targets
- funnel_stage: COLD, WARM, or HOT
- conversion_framework: PAS or AIDA
- hook_formula: the formula structure to use
- hook_category: PAIN, TIME_SAVING, CONTRARIAN, CURIOSITY, or TESTIMONIAL
- psychology_model: which of the 8 models to apply
- primary_objection: the main objection this content must overcome
- paid_potential: true/false, whether this has paid ad potential

Return JSON with these exact fields.`,

  2: `You are Agent 2: BRIEF WRITER.

Given the intake analysis from Agent 1, produce a creative brief:
- avatar_angle: the specific emotional angle for this avatar
- war_vocabulary: array of 3-5 war vocabulary terms to use
- hook_options: array of 3 hook text options
- key_message: the single most important message
- psychology_note: how to apply the psychology model
- paid_signal: object with { lane: "testing"|"scaling"|"retargeting", daily_budget: number, audience_note: string }

Return JSON with these exact fields.`,

  3: `You are Agent 3: CONVERSION SCRIPT WRITER.

Given the brief from Agent 2, write the full content:
- hook_text_overlay: short text for video overlay (under 10 words)
- hook_variants: array of 3 hook variants (different angles, same message)
- full_script: the complete script with [VISUAL] and [AUDIO] cues
- retention_mechanics: array of 2-3 retention hooks embedded in the script
- caption: social media caption (under 200 chars, includes relevant hashtags)
- talent_notes: direction notes for Zo (the filmmaker/talent)

RULES:
- COLD funnel: NO product name, NO price, NO discount code
- SATAN_SPAWN archetype: TikTok only. Flag if assigned elsewhere.
- ORIGIN_STORY: Add "STACY_APPROVAL_REQUIRED" tag.
- CTA format: [one specific benefit] + "Link in bio."

Return JSON with these exact fields.`,

  4: `You are Agent 4: VISUAL DIRECTOR.

Given the script from Agent 3, produce visual direction:
- shot_list: array of shots, each with { shot_number, description, duration_seconds, camera_angle, notes }
- universal_9_check: object mapping each of the 9 mandatory shots to true/false (whether included)
- pre_roll_checklist: array of items Zo should verify before filming
- thumbnail_direction: description of the thumbnail frame
- editing_notes: array of post-production notes

The Universal 9 (mandatory every session):
1. Ground POV roll, extreme close-up
2. Foam close-up, surface texture
3. Basket filling, slow pan
4. Basket dump, hold 3 full seconds
5. Path before/after, same camera angle
6. Dog in yard, natural
7. Barefoot feet on cleared ground
8. Wide establishing shot before rolling
9. Wide shot after rolling, same angle

Return JSON with these exact fields.`,

  5: `You are Agent 5: DISTRIBUTION + PAID SIGNAL.

Given all previous agent outputs, produce the distribution plan:
- posting_schedule: array of { platform, date_offset_days, time_slot, format }
- cross_post_sequence: ordered array of platforms for cross-posting
- hashtags: array of relevant hashtags (max 15)
- paid_brief: object with { lane, daily_budget, audience_targeting, hook_to_test_first, kill_threshold, scale_signal, retargeting_opportunity, fatigue_watch_days }

Kill rule: CTR below 1% after $100-150 spend = kill.
Scale rule: CTR above 2% + ATC signal = +15% budget.

Return JSON with these exact fields.`,

  6: `You are Agent 6: BRAND REVIEWER + FINAL COMPILER.

You are the quality gate. Review ALL previous agent outputs against SBR brand standards.

Score on these 10 points (1 = pass, 0 = fail):
1. Voice matches Stacy's standard (warm, direct, no hype)
2. No banned phrases used
3. No banned codes (CODESALE20, PBPR1)
4. Correct funnel stage rules (no product names/prices in COLD)
5. War vocabulary used correctly (consumer only, not B2B)
6. SATAN_SPAWN is TikTok-only (if applicable)
7. ORIGIN_STORY has STACY_APPROVAL_REQUIRED tag (if applicable)
8. CTA follows format rule
9. Psychology model applied correctly
10. Universal 9 shots addressed in visual direction

Return JSON:
- total_score: number 0-10
- checks: array of { check_number, name, passed: boolean, note: string }
- approved: boolean (true if score >= 8)
- revision_notes: string (if not approved, what to fix)
- pipeline_stop: boolean (true if any PIPELINE_STOP trigger found)
- pipeline_stop_reason: string or null
- escalation_route: string or null (ZO, T4, STACY, SAMMIE, GIBE, KEVIN_ZO, MARK_ZO)
- final_package: the compiled output ready for Zo (all agent outputs merged)`
};

// ── Pipeline Runner ──

async function getAnthropicClient(): Promise<Anthropic> {
  const settings = await storage.getSettings();
  const apiKey = settings?.find((s: any) => s.key === "anthropic_api_key")?.value
    || settings?.find((s: any) => s.key === "llm_api_key")?.value;
  if (!apiKey) {
    throw new Error("No Anthropic API key configured. Add your key in Settings.");
  }
  return new Anthropic({ apiKey });
}

interface AgentResult {
  agentNumber: number;
  agentName: string;
  output: any;
  durationMs: number;
  status: "SUCCESS" | "ERROR" | "PIPELINE_STOP";
  errorMessage?: string;
}

const AGENT_NAMES: Record<number, string> = {
  1: "INTAKE",
  2: "BRIEF_WRITER",
  3: "SCRIPT_WRITER",
  4: "VISUAL_DIRECTOR",
  5: "DISTRIBUTION",
  6: "BRAND_REVIEWER",
};

async function runAgent(
  client: Anthropic,
  agentNumber: number,
  userPrompt: string,
): Promise<AgentResult> {
  const start = Date.now();
  const agentName = AGENT_NAMES[agentNumber];

  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: ZOBOT_SYSTEM_BASE + "\n\n" + AGENT_PROMPTS[agentNumber],
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    let output: any;
    try {
      output = JSON.parse(text);
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        output = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Agent did not return valid JSON");
      }
    }

    // Check for pipeline stops in Agent 6
    if (agentNumber === 6 && output.pipeline_stop) {
      return {
        agentNumber,
        agentName,
        output,
        durationMs: Date.now() - start,
        status: "PIPELINE_STOP",
        errorMessage: output.pipeline_stop_reason,
      };
    }

    return {
      agentNumber,
      agentName,
      output,
      durationMs: Date.now() - start,
      status: "SUCCESS",
    };
  } catch (error: any) {
    return {
      agentNumber,
      agentName,
      output: null,
      durationMs: Date.now() - start,
      status: "ERROR",
      errorMessage: error.message,
    };
  }
}

/**
 * Run the full D1 pipeline for a content item.
 * Agents run sequentially: 1 → 2 → 3 → 4 → 5 → 6
 */
export async function runD1Pipeline(
  pipelineItemId: string,
  topic: string,
  overrides?: {
    avatar?: string;
    funnelStage?: string;
    archetype?: string;
    platform?: string;
  }
): Promise<{ success: boolean; item: ContentPipelineItem | null; error?: string }> {
  const client = await getAnthropicClient();
  const results: AgentResult[] = [];

  // Build initial prompt for Agent 1
  let agent1Input = `Content topic/request: "${topic}"`;
  if (overrides?.avatar) agent1Input += `\nTarget avatar: ${overrides.avatar}`;
  if (overrides?.funnelStage) agent1Input += `\nFunnel stage: ${overrides.funnelStage}`;
  if (overrides?.archetype) agent1Input += `\nContent archetype: ${overrides.archetype}`;
  if (overrides?.platform) agent1Input += `\nTarget platform: ${overrides.platform}`;

  // Agent 1: Intake
  await storage.updateContentPipelineItem(pipelineItemId, { status: "INTAKE" });
  const a1 = await runAgent(client, 1, agent1Input);
  results.push(a1);
  await logAgent(pipelineItemId, a1, agent1Input);

  if (a1.status === "ERROR") {
    await storage.updateContentPipelineItem(pipelineItemId, { status: "REJECTED", reviewNotes: a1.errorMessage });
    return { success: false, item: null, error: `Agent 1 failed: ${a1.errorMessage}` };
  }

  // Update item with Agent 1 classifications
  await storage.updateContentPipelineItem(pipelineItemId, {
    intakeOutput: a1.output,
    avatar: a1.output.avatar || overrides?.avatar,
    funnelStage: a1.output.funnel_stage || overrides?.funnelStage,
    conversionFramework: a1.output.conversion_framework,
    psychologyModel: a1.output.psychology_model,
    hookCategory: a1.output.hook_category,
    primaryObjection: a1.output.primary_objection,
    paidPotential: a1.output.paid_potential,
    status: "BRIEF",
  });

  // Agent 2: Brief Writer
  const a2Input = `Intake analysis from Agent 1:\n${JSON.stringify(a1.output, null, 2)}\n\nOriginal topic: "${topic}"`;
  const a2 = await runAgent(client, 2, a2Input);
  results.push(a2);
  await logAgent(pipelineItemId, a2, a2Input);

  if (a2.status === "ERROR") {
    await storage.updateContentPipelineItem(pipelineItemId, { status: "REJECTED", reviewNotes: a2.errorMessage });
    return { success: false, item: null, error: `Agent 2 failed: ${a2.errorMessage}` };
  }

  await storage.updateContentPipelineItem(pipelineItemId, { briefOutput: a2.output, status: "SCRIPT" });

  // Agent 3: Script Writer
  const a3Input = `Intake analysis:\n${JSON.stringify(a1.output, null, 2)}\n\nCreative brief:\n${JSON.stringify(a2.output, null, 2)}\n\nOriginal topic: "${topic}"`;
  const a3 = await runAgent(client, 3, a3Input);
  results.push(a3);
  await logAgent(pipelineItemId, a3, a3Input);

  if (a3.status === "ERROR") {
    await storage.updateContentPipelineItem(pipelineItemId, { status: "REJECTED", reviewNotes: a3.errorMessage });
    return { success: false, item: null, error: `Agent 3 failed: ${a3.errorMessage}` };
  }

  await storage.updateContentPipelineItem(pipelineItemId, { scriptOutput: a3.output, status: "VISUAL" });

  // Agent 4: Visual Director
  const a4Input = `Full pipeline context:\nIntake: ${JSON.stringify(a1.output)}\nBrief: ${JSON.stringify(a2.output)}\nScript: ${JSON.stringify(a3.output)}`;
  const a4 = await runAgent(client, 4, a4Input);
  results.push(a4);
  await logAgent(pipelineItemId, a4, a4Input);

  if (a4.status === "ERROR") {
    await storage.updateContentPipelineItem(pipelineItemId, { status: "REJECTED", reviewNotes: a4.errorMessage });
    return { success: false, item: null, error: `Agent 4 failed: ${a4.errorMessage}` };
  }

  await storage.updateContentPipelineItem(pipelineItemId, { visualOutput: a4.output, status: "DISTRIBUTION" });

  // Agent 5: Distribution
  const a5Input = `Full pipeline context:\nIntake: ${JSON.stringify(a1.output)}\nBrief: ${JSON.stringify(a2.output)}\nScript: ${JSON.stringify(a3.output)}\nVisual: ${JSON.stringify(a4.output)}`;
  const a5 = await runAgent(client, 5, a5Input);
  results.push(a5);
  await logAgent(pipelineItemId, a5, a5Input);

  if (a5.status === "ERROR") {
    await storage.updateContentPipelineItem(pipelineItemId, { status: "REJECTED", reviewNotes: a5.errorMessage });
    return { success: false, item: null, error: `Agent 5 failed: ${a5.errorMessage}` };
  }

  await storage.updateContentPipelineItem(pipelineItemId, { distributionOutput: a5.output, status: "REVIEW" });

  // Agent 6: Brand Reviewer (quality gate)
  const a6Input = `REVIEW ALL OUTPUTS for brand compliance and quality:\n\nIntake: ${JSON.stringify(a1.output)}\nBrief: ${JSON.stringify(a2.output)}\nScript: ${JSON.stringify(a3.output)}\nVisual: ${JSON.stringify(a4.output)}\nDistribution: ${JSON.stringify(a5.output)}\n\nOriginal topic: "${topic}"`;
  const a6 = await runAgent(client, 6, a6Input);
  results.push(a6);
  await logAgent(pipelineItemId, a6, a6Input);

  if (a6.status === "PIPELINE_STOP") {
    await storage.updateContentPipelineItem(pipelineItemId, {
      reviewOutput: a6.output,
      reviewScore: a6.output?.total_score || 0,
      reviewNotes: a6.output?.revision_notes,
      pipelineStopReason: a6.errorMessage,
      escalationRoute: a6.output?.escalation_route,
      status: "REJECTED",
    });
    return { success: false, item: null, error: `PIPELINE_STOP: ${a6.errorMessage}` };
  }

  if (a6.status === "ERROR") {
    await storage.updateContentPipelineItem(pipelineItemId, { status: "REJECTED", reviewNotes: a6.errorMessage });
    return { success: false, item: null, error: `Agent 6 failed: ${a6.errorMessage}` };
  }

  const approved = a6.output?.approved === true;
  const finalStatus = approved ? "APPROVED" : "REJECTED";

  const updatedItem = await storage.updateContentPipelineItem(pipelineItemId, {
    reviewOutput: a6.output,
    reviewScore: a6.output?.total_score || 0,
    reviewNotes: a6.output?.revision_notes,
    escalationRoute: a6.output?.escalation_route,
    status: finalStatus,
  });

  return { success: approved, item: updatedItem || null };
}

/**
 * Run a single agent step (for manual/step-by-step pipeline control)
 */
export async function runSingleAgent(
  pipelineItemId: string,
  agentNumber: number,
  inputOverride?: string,
): Promise<AgentResult> {
  const client = await getAnthropicClient();
  const item = await storage.getContentPipelineItem(pipelineItemId);
  if (!item) throw new Error("Pipeline item not found");

  let input = inputOverride || "";
  if (!inputOverride) {
    // Build input from previous agent outputs
    const parts: string[] = [`Original topic: "${item.title}"`];
    if (item.intakeOutput) parts.push(`Intake: ${JSON.stringify(item.intakeOutput)}`);
    if (item.briefOutput) parts.push(`Brief: ${JSON.stringify(item.briefOutput)}`);
    if (item.scriptOutput) parts.push(`Script: ${JSON.stringify(item.scriptOutput)}`);
    if (item.visualOutput) parts.push(`Visual: ${JSON.stringify(item.visualOutput)}`);
    if (item.distributionOutput) parts.push(`Distribution: ${JSON.stringify(item.distributionOutput)}`);
    input = parts.join("\n\n");
  }

  const result = await runAgent(client, agentNumber, input);
  await logAgent(pipelineItemId, result, input);

  // Update the appropriate output field
  const outputField = {
    1: "intakeOutput",
    2: "briefOutput",
    3: "scriptOutput",
    4: "visualOutput",
    5: "distributionOutput",
    6: "reviewOutput",
  }[agentNumber] as keyof ContentPipelineItem;

  if (result.status === "SUCCESS" && outputField) {
    await storage.updateContentPipelineItem(pipelineItemId, { [outputField]: result.output } as any);
  }

  return result;
}

async function logAgent(pipelineItemId: string, result: AgentResult, input: string): Promise<void> {
  try {
    await storage.createContentPipelineLog({
      pipelineItemId,
      agentNumber: result.agentNumber,
      agentName: result.agentName,
      input: { text: input.substring(0, 2000) }, // Truncate for storage
      output: result.output,
      durationMs: result.durationMs,
      status: result.status,
      errorMessage: result.errorMessage || null,
    } as any);
  } catch (e) {
    console.error("Failed to log agent result:", e);
  }
}
