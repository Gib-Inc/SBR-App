/**
 * Shopify Webhook Admin
 * Manages webhook registration and ensures all configured topics are registered
 */

import { ShopifyClient } from '../services/shopify-client';
import { SHOPIFY_WEBHOOK_TOPICS, getShopifyWebhookUrl } from './webhooks-config';
import { storage } from '../storage';

export interface WebhookRegistrationResult {
  topic: string;
  success: boolean;
  webhookId?: number;
  error?: string;
  action: 'created' | 'exists' | 'failed';
}

export interface ExistingWebhook {
  id: number;
  topic: string;
  address: string;
  format: string;
  created_at: string;
}

/**
 * Get Shopify client from stored integration config
 */
async function getShopifyClientForUser(userId: string): Promise<ShopifyClient | null> {
  try {
    const config = await storage.getIntegrationConfig(userId, 'SHOPIFY');
    if (!config) {
      console.warn('[Webhook Admin] No Shopify integration config found');
      return null;
    }

    const shopDomain = (config.config as any)?.shopDomain || process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = config.apiKey || process.env.SHOPIFY_ACCESS_TOKEN;
    const apiVersion = (config.config as any)?.apiVersion || '2024-01';
    
    if (!shopDomain || !accessToken) {
      console.warn('[Webhook Admin] Shopify config missing credentials');
      return null;
    }

    return new ShopifyClient(shopDomain, accessToken, apiVersion);
  } catch (error: any) {
    console.error('[Webhook Admin] Error getting Shopify client:', error.message);
    return null;
  }
}

/**
 * Fetch all existing webhooks from Shopify
 */
export async function fetchExistingWebhooks(userId: string): Promise<ExistingWebhook[]> {
  const client = await getShopifyClientForUser(userId);
  if (!client) {
    return [];
  }

  try {
    return await client.listWebhooks();
  } catch (error: any) {
    console.error('[Webhook Admin] Error fetching webhooks:', error.message);
    return [];
  }
}

/**
 * Create a single webhook in Shopify
 */
export async function createWebhook(
  userId: string,
  topic: string,
  address: string
): Promise<WebhookRegistrationResult> {
  const client = await getShopifyClientForUser(userId);
  if (!client) {
    return { topic, success: false, error: 'No Shopify client available', action: 'failed' };
  }

  try {
    const webhook = await client.registerWebhook(topic, address);
    console.log(`[Webhook Admin] Created webhook: ${topic} -> ${address}`);
    return { topic, success: true, webhookId: webhook.id, action: 'created' };
  } catch (error: any) {
    if (error.message.includes('422') && error.message.includes('already exists')) {
      console.log(`[Webhook Admin] Webhook ${topic} already exists`);
      return { topic, success: true, action: 'exists' };
    }
    console.error(`[Webhook Admin] Failed to create webhook ${topic}:`, error.message);
    return { topic, success: false, error: error.message, action: 'failed' };
  }
}

/**
 * Delete a webhook from Shopify
 */
export async function deleteWebhook(userId: string, webhookId: number): Promise<boolean> {
  const client = await getShopifyClientForUser(userId);
  if (!client) {
    return false;
  }

  try {
    await client.deleteWebhook(webhookId);
    console.log(`[Webhook Admin] Deleted webhook ID: ${webhookId}`);
    return true;
  } catch (error: any) {
    console.error(`[Webhook Admin] Failed to delete webhook ${webhookId}:`, error.message);
    return false;
  }
}

/**
 * Ensure all configured webhook topics are registered in Shopify
 * This is the main function called on server startup
 * 
 * @param shopDomain - Shopify store domain
 * @param accessToken - Shopify access token
 * @param apiVersion - Shopify API version (defaults to 2024-01)
 */
export async function ensureWebhooks(
  shopDomain: string,
  accessToken: string,
  apiVersion: string = '2024-01'
): Promise<{
  success: boolean;
  registered: number;
  existing: number;
  failed: number;
  results: WebhookRegistrationResult[];
}> {
  const address = getShopifyWebhookUrl();
  
  if (!address) {
    console.error('[Webhook Admin] No webhook URL configured. Set SHOPIFY_WEBHOOK_URL or APP_BASE_URL.');
    return {
      success: false,
      registered: 0,
      existing: 0,
      failed: SHOPIFY_WEBHOOK_TOPICS.length,
      results: [],
    };
  }

  console.log(`[Webhook Admin] Ensuring ${SHOPIFY_WEBHOOK_TOPICS.length} webhooks are registered`);
  console.log(`[Webhook Admin] Webhook URL: ${address}`);

  const results: WebhookRegistrationResult[] = [];
  let created = 0;
  let exists = 0;
  let failed = 0;

  try {
    const client = new ShopifyClient(shopDomain, accessToken, apiVersion);
    const existingWebhooks = await client.listWebhooks();
    const existingTopics = new Map<string, ExistingWebhook>();
    
    for (const webhook of existingWebhooks) {
      existingTopics.set(webhook.topic, webhook);
    }

    console.log(`[Webhook Admin] Found ${existingWebhooks.length} existing webhooks`);

    for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
      const existing = existingTopics.get(topic);
      
      if (existing) {
        if (existing.address === address) {
          results.push({ topic, success: true, webhookId: existing.id, action: 'exists' });
          exists++;
          continue;
        } else {
          console.log(`[Webhook Admin] Webhook ${topic} exists but with different URL, updating...`);
          try {
            await client.deleteWebhook(existing.id);
          } catch (e: any) {
            console.warn(`[Webhook Admin] Failed to delete old webhook:`, e.message);
          }
        }
      }

      try {
        const webhook = await client.registerWebhook(topic, address);
        results.push({ topic, success: true, webhookId: webhook.id, action: 'created' });
        created++;
      } catch (error: any) {
        if (error.message?.includes('422') && error.message?.includes('already exists')) {
          results.push({ topic, success: true, action: 'exists' });
          exists++;
        } else {
          results.push({ topic, success: false, error: error.message, action: 'failed' });
          failed++;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error: any) {
    console.error('[Webhook Admin] Error during webhook registration:', error.message);
    return {
      success: false,
      registered: 0,
      existing: 0,
      failed: SHOPIFY_WEBHOOK_TOPICS.length,
      results: [],
    };
  }

  console.log(`[Webhook Admin] Complete: ${created} created, ${exists} existing, ${failed} failed`);

  return {
    success: failed === 0,
    registered: created,
    existing: exists,
    failed,
    results,
  };
}

/**
 * Remove all webhooks pointing to our URL
 */
export async function removeAllWebhooks(userId: string): Promise<{ removed: number; failed: number }> {
  const address = getShopifyWebhookUrl();
  const existingWebhooks = await fetchExistingWebhooks(userId);
  
  let removed = 0;
  let failed = 0;

  for (const webhook of existingWebhooks) {
    if (webhook.address === address || !address) {
      const success = await deleteWebhook(userId, webhook.id);
      if (success) removed++;
      else failed++;
    }
  }

  console.log(`[Webhook Admin] Removed ${removed} webhooks, ${failed} failed`);
  return { removed, failed };
}

/**
 * Get webhook status for display in UI
 */
export async function getWebhookStatus(userId: string): Promise<{
  configured: boolean;
  webhookUrl: string;
  registeredTopics: string[];
  missingTopics: string[];
  webhooks: ExistingWebhook[];
}> {
  const webhookUrl = getShopifyWebhookUrl();
  const existingWebhooks = await fetchExistingWebhooks(userId);
  
  const registeredTopics = existingWebhooks
    .filter(w => w.address === webhookUrl)
    .map(w => w.topic);
  
  const missingTopics = SHOPIFY_WEBHOOK_TOPICS.filter(
    topic => !registeredTopics.includes(topic)
  );

  return {
    configured: registeredTopics.length > 0,
    webhookUrl,
    registeredTopics,
    missingTopics,
    webhooks: existingWebhooks.filter(w => w.address === webhookUrl),
  };
}
