/**
 * AI System Reviewer Service
 * 
 * Weekly service that analyzes audit logs and system patterns using LLM
 * to generate actionable improvement recommendations for the manufacturing
 * inventory management system.
 */

import { storage } from "../storage";
import { AuditLogger, type AuditSource } from "./audit-logger";
import { LLMService, type LLMProvider } from "./llm";
import type { AuditLog, InsertAiSystemRecommendation } from "@shared/schema";

export type RecommendationSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RecommendationCategory = 
  | 'INTEGRATION_ISSUE'    // API failures, sync problems, auth issues
  | 'INVENTORY_PATTERN'    // Stockout patterns, unusual consumption
  | 'PROCESS_IMPROVEMENT'  // Workflow inefficiencies
  | 'SECURITY_CONCERN'     // Auth failures, access patterns
  | 'PERFORMANCE'          // Slow operations, timeouts
  | 'DATA_QUALITY'         // Inconsistencies, missing data
  | 'OTHER';

export interface SystemReviewInput {
  periodStart: Date;
  periodEnd: Date;
  auditLogs: AuditLog[];
}

export interface ParsedRecommendation {
  severity: RecommendationSeverity;
  category: RecommendationCategory;
  title: string;
  description: string;
  suggestedChange?: string;
  relatedLogPatterns?: string[];
}

export interface SystemReviewResult {
  success: boolean;
  periodStart: Date;
  periodEnd: Date;
  logsAnalyzed: number;
  recommendationsGenerated: number;
  recommendations: ParsedRecommendation[];
  error?: string;
}

const SYSTEM_REVIEW_PROMPT_TEMPLATE = `You are an expert inventory management system analyst. Your task is to review system logs and identify patterns that indicate issues, inefficiencies, or opportunities for improvement.

**Review Period:** {periodStart} to {periodEnd}

**Log Summary:**
- Total Events: {totalEvents}
- Error Events: {errorCount}
- Warning Events: {warningCount}
- By Source: {sourceBreakdown}
- By Event Type: {eventTypeBreakdown}

**Recent Errors and Warnings (Last {errorWarningLimit}):**
{errorWarningLogs}

**Integration Sync Activity:**
{integrationLogs}

**Inventory Movement Patterns:**
{inventoryLogs}

**Your Analysis Task:**
Review these logs and identify:
1. **Integration Issues** - API failures, auth problems, sync inconsistencies
2. **Inventory Patterns** - Unusual stockout patterns, consumption anomalies
3. **Process Improvements** - Workflow inefficiencies, manual steps that could be automated
4. **Security Concerns** - Authentication failures, suspicious access patterns
5. **Performance Issues** - Slow operations, timeouts, bottlenecks
6. **Data Quality** - Inconsistencies, missing data, duplicate records

**Output Format:**
Respond with a JSON array of recommendations. Each recommendation must have:
- severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
- category: "INTEGRATION_ISSUE" | "INVENTORY_PATTERN" | "PROCESS_IMPROVEMENT" | "SECURITY_CONCERN" | "PERFORMANCE" | "DATA_QUALITY" | "OTHER"
- title: Brief summary (max 100 chars)
- description: Detailed explanation of the issue and its impact
- suggestedChange: Actionable steps to address the issue
- relatedLogPatterns: Array of log event types or patterns involved

**Example Response:**
[
  {
    "severity": "HIGH",
    "category": "INTEGRATION_ISSUE",
    "title": "Shopify sync failing intermittently",
    "description": "Over the past week, 12 Shopify sync operations failed with authentication errors. This may indicate an expiring API token or rate limiting.",
    "suggestedChange": "Check Shopify API credentials and consider implementing retry logic with exponential backoff. Review API rate limits.",
    "relatedLogPatterns": ["INTEGRATION_ERROR", "SHOPIFY"]
  }
]

If no significant issues are found, return an empty array: []

**IMPORTANT:** Only output the JSON array, no other text.`;

class AISystemReviewerService {
  private readonly DEFAULT_REVIEW_PERIOD_DAYS = 7;
  private readonly MAX_LOGS_TO_ANALYZE = 1000;
  private readonly ERROR_WARNING_LOG_LIMIT = 50;

  /**
   * Run a system review for the specified period
   */
  async runReview(options?: {
    periodStart?: Date;
    periodEnd?: Date;
    userId?: string;
    provider?: LLMProvider;
    apiKey?: string;
    customEndpoint?: string;
  }): Promise<SystemReviewResult> {
    const periodEnd = options?.periodEnd || new Date();
    const periodStart = options?.periodStart || 
      new Date(periodEnd.getTime() - this.DEFAULT_REVIEW_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    try {
      // Fetch audit logs for the period
      const { logs: auditLogs, total } = await storage.getAuditLogs({
        dateFrom: periodStart,
        dateTo: periodEnd,
        limit: this.MAX_LOGS_TO_ANALYZE,
      });

      await AuditLogger.logAISystemReviewStarted({
        periodStart,
        periodEnd,
        logsToAnalyze: Math.min(total, this.MAX_LOGS_TO_ANALYZE),
      });

      const startTime = Date.now();

      // Get LLM settings from user-specific settings if userId provided
      const settings = options?.userId ? await storage.getSettings(options.userId) : undefined;
      const llmProvider = (options?.provider || settings?.llmProvider || 'chatgpt') as LLMProvider;
      const apiKey = options?.apiKey || settings?.llmApiKey;
      const customEndpoint = options?.customEndpoint || settings?.llmCustomEndpoint || undefined;

      if (!apiKey) {
        const result: SystemReviewResult = {
          success: false,
          periodStart,
          periodEnd,
          logsAnalyzed: 0,
          recommendationsGenerated: 0,
          recommendations: [],
          error: 'No LLM API key configured. Please configure an LLM provider in Settings.',
        };

        await AuditLogger.logAISystemReviewFailed({
          periodStart,
          periodEnd,
          error: result.error!,
        });

        return result;
      }

      // Prepare the analysis prompt
      const prompt = this.buildAnalysisPrompt(periodStart, periodEnd, auditLogs);

      // Call LLM for analysis
      const llmResponse = await LLMService.askLLM({
        provider: llmProvider,
        apiKey,
        customEndpoint,
        taskType: 'system_review' as any, // Extended task type
        payload: { prompt },
      });

      const duration = Date.now() - startTime;

      if (!llmResponse.success) {
        const result: SystemReviewResult = {
          success: false,
          periodStart,
          periodEnd,
          logsAnalyzed: auditLogs.length,
          recommendationsGenerated: 0,
          recommendations: [],
          error: `LLM analysis failed: ${llmResponse.error}`,
        };

        await AuditLogger.logAISystemReviewFailed({
          periodStart,
          periodEnd,
          error: result.error!,
          context: { llmProvider, logsAnalyzed: auditLogs.length },
        });

        return result;
      }

      // Parse recommendations from LLM response
      const recommendations = this.parseRecommendations(llmResponse.data);

      // Store recommendations in database
      for (const rec of recommendations) {
        const inserted = await storage.createAiSystemRecommendation({
          severity: rec.severity,
          category: rec.category,
          title: rec.title,
          description: rec.description,
          suggestedChange: rec.suggestedChange,
          status: 'NEW',
          relatedLogIds: rec.relatedLogPatterns,
          reviewPeriodStart: periodStart,
          reviewPeriodEnd: periodEnd,
        });

        await AuditLogger.logAIRecommendationCreated({
          recommendationId: inserted.id,
          title: inserted.title,
          severity: inserted.severity,
          category: inserted.category,
        });
      }

      await AuditLogger.logAISystemReviewCompleted({
        periodStart,
        periodEnd,
        logsAnalyzed: auditLogs.length,
        recommendationsGenerated: recommendations.length,
        duration,
      });

      return {
        success: true,
        periodStart,
        periodEnd,
        logsAnalyzed: auditLogs.length,
        recommendationsGenerated: recommendations.length,
        recommendations,
      };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error during system review';
      
      await AuditLogger.logAISystemReviewFailed({
        periodStart,
        periodEnd,
        error: errorMessage,
        context: { stack: error.stack },
      });

      return {
        success: false,
        periodStart,
        periodEnd,
        logsAnalyzed: 0,
        recommendationsGenerated: 0,
        recommendations: [],
        error: errorMessage,
      };
    }
  }

  /**
   * Build the analysis prompt from audit logs
   */
  private buildAnalysisPrompt(periodStart: Date, periodEnd: Date, logs: AuditLog[]): string {
    // Count by status
    const errorCount = logs.filter(l => l.status === 'ERROR').length;
    const warningCount = logs.filter(l => l.status === 'WARNING').length;

    // Breakdown by source
    const sourceBreakdown = this.getGroupedCounts(logs, 'source');
    const eventTypeBreakdown = this.getGroupedCounts(logs, 'eventType');

    // Get error and warning logs
    const errorWarningLogs = logs
      .filter(l => l.status === 'ERROR' || l.status === 'WARNING')
      .slice(0, this.ERROR_WARNING_LOG_LIMIT)
      .map(l => this.formatLogEntry(l))
      .join('\n');

    // Get integration-related logs
    const integrationLogs = logs
      .filter(l => 
        l.eventType?.includes('SYNC') || 
        l.eventType?.includes('INTEGRATION') ||
        ['SHOPIFY', 'AMAZON', 'EXTENSIV', 'GHL', 'QUICKBOOKS', 'PHANTOMBUSTER'].includes(l.source || '')
      )
      .slice(0, 30)
      .map(l => this.formatLogEntry(l))
      .join('\n');

    // Get inventory movement logs
    const inventoryLogs = logs
      .filter(l => 
        l.eventType?.includes('INVENTORY') ||
        l.eventType?.includes('STOCK') ||
        l.eventType?.includes('TRANSFER') ||
        l.eventType?.includes('PRODUCTION')
      )
      .slice(0, 30)
      .map(l => this.formatLogEntry(l))
      .join('\n');

    return SYSTEM_REVIEW_PROMPT_TEMPLATE
      .replace('{periodStart}', periodStart.toISOString())
      .replace('{periodEnd}', periodEnd.toISOString())
      .replace('{totalEvents}', String(logs.length))
      .replace('{errorCount}', String(errorCount))
      .replace('{warningCount}', String(warningCount))
      .replace('{sourceBreakdown}', sourceBreakdown)
      .replace('{eventTypeBreakdown}', eventTypeBreakdown)
      .replace('{errorWarningLimit}', String(this.ERROR_WARNING_LOG_LIMIT))
      .replace('{errorWarningLogs}', errorWarningLogs || 'No errors or warnings in this period.')
      .replace('{integrationLogs}', integrationLogs || 'No integration activity in this period.')
      .replace('{inventoryLogs}', inventoryLogs || 'No inventory movements in this period.');
  }

  /**
   * Get grouped counts for a field
   */
  private getGroupedCounts(logs: AuditLog[], field: keyof AuditLog): string {
    const counts: Record<string, number> = {};
    for (const log of logs) {
      const value = log[field] as string || 'UNKNOWN';
      counts[value] = (counts[value] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  }

  /**
   * Format a log entry for the prompt
   */
  private formatLogEntry(log: AuditLog): string {
    const timestamp = log.timestamp ? new Date(log.timestamp).toISOString() : 'N/A';
    const status = log.status || 'INFO';
    const source = log.source || 'SYSTEM';
    const eventType = log.eventType || 'UNKNOWN';
    const description = log.description || '';
    return `[${timestamp}] [${status}] [${source}] ${eventType}: ${description}`;
  }

  /**
   * Parse LLM response into recommendations
   */
  private parseRecommendations(llmData: any): ParsedRecommendation[] {
    try {
      let recommendations: any[];
      
      // Handle different response formats
      if (Array.isArray(llmData)) {
        recommendations = llmData;
      } else if (typeof llmData === 'string') {
        // Try to extract JSON from string
        const jsonMatch = llmData.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          recommendations = JSON.parse(jsonMatch[0]);
        } else {
          console.warn('[AISystemReviewer] Could not parse LLM response as JSON array');
          return [];
        }
      } else if (llmData?.recommendations) {
        recommendations = llmData.recommendations;
      } else if (llmData?.data?.recommendations) {
        recommendations = llmData.data.recommendations;
      } else if (llmData?.recommendation) {
        // Stub response format
        if (typeof llmData.recommendation === 'string' && llmData.recommendation.includes('[')) {
          const jsonMatch = llmData.recommendation.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            recommendations = JSON.parse(jsonMatch[0]);
          } else {
            return [];
          }
        } else {
          return [];
        }
      } else {
        console.warn('[AISystemReviewer] Unknown LLM response format:', typeof llmData);
        return [];
      }

      // Validate and normalize each recommendation
      return recommendations
        .filter(rec => rec && typeof rec === 'object')
        .map(rec => ({
          severity: this.validateSeverity(rec.severity),
          category: this.validateCategory(rec.category),
          title: String(rec.title || 'Untitled Recommendation').slice(0, 200),
          description: String(rec.description || ''),
          suggestedChange: rec.suggestedChange ? String(rec.suggestedChange) : undefined,
          relatedLogPatterns: Array.isArray(rec.relatedLogPatterns) 
            ? rec.relatedLogPatterns.map(String) 
            : undefined,
        }));
    } catch (error: any) {
      console.error('[AISystemReviewer] Failed to parse recommendations:', error.message);
      return [];
    }
  }

  /**
   * Validate and normalize severity
   */
  private validateSeverity(severity: any): RecommendationSeverity {
    const valid = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const normalized = String(severity).toUpperCase();
    return valid.includes(normalized) ? normalized as RecommendationSeverity : 'MEDIUM';
  }

  /**
   * Validate and normalize category
   */
  private validateCategory(category: any): RecommendationCategory {
    const valid = [
      'INTEGRATION_ISSUE',
      'INVENTORY_PATTERN', 
      'PROCESS_IMPROVEMENT',
      'SECURITY_CONCERN',
      'PERFORMANCE',
      'DATA_QUALITY',
      'OTHER',
    ];
    const normalized = String(category).toUpperCase().replace(/[- ]/g, '_');
    return valid.includes(normalized) ? normalized as RecommendationCategory : 'OTHER';
  }

  /**
   * Get the count of pending (NEW) recommendations
   */
  async getNewRecommendationsCount(): Promise<number> {
    return storage.countAiSystemRecommendationsByStatus('NEW');
  }

  /**
   * Acknowledge a recommendation (mark as reviewed)
   */
  async acknowledgeRecommendation(id: string, userId?: string): Promise<void> {
    const rec = await storage.getAiSystemRecommendation(id);
    if (!rec) {
      throw new Error(`Recommendation not found: ${id}`);
    }

    await storage.updateAiSystemRecommendation(id, {
      status: 'ACKNOWLEDGED',
      acknowledgedAt: new Date(),
      acknowledgedByUserId: userId,
    });

    await AuditLogger.logAIRecommendationAcknowledged({
      recommendationId: id,
      title: rec.title,
      userId,
    });
  }

  /**
   * Dismiss a recommendation
   */
  async dismissRecommendation(id: string, userId?: string): Promise<void> {
    const rec = await storage.getAiSystemRecommendation(id);
    if (!rec) {
      throw new Error(`Recommendation not found: ${id}`);
    }

    await storage.updateAiSystemRecommendation(id, {
      status: 'DISMISSED',
      dismissedAt: new Date(),
      dismissedByUserId: userId,
    });

    await AuditLogger.logAIRecommendationDismissed({
      recommendationId: id,
      title: rec.title,
      userId,
    });
  }
}

export const AISystemReviewer = new AISystemReviewerService();
