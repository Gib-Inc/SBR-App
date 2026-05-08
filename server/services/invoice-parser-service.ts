// Invoice parser using Anthropic Claude vision. Accepts an image or PDF
// buffer and returns structured order data the /log-order Tab A form
// hydrates from. We never auto-save the parsed result — the operator
// reviews and edits before submitting — so this service is intentionally
// "best-effort": it returns whatever Claude can extract and lets the UI
// handle gaps and corrections.

import Anthropic from "@anthropic-ai/sdk";

// Project default Claude model. Spec named claude-sonnet-4-20250514
// (Sonnet 4.0, older release); we standardise on the same Sonnet 4.5
// release the rest of the codebase uses so model rollout stays uniform.
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

export interface ParsedLineItem {
  sku: string | null;
  description: string;
  qty: number;
  unit_cost: number;
}

export interface ParsedInvoice {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null; // YYYY-MM-DD
  expected_delivery_date: string | null; // YYYY-MM-DD
  line_items: ParsedLineItem[];
  total: number | null;
}

export interface ParseInvoiceResult {
  parsed: ParsedInvoice | null;
  error?: string;
  rawResponse?: string;
}

const SYSTEM_PROMPT = `Extract structured data from this supplier invoice. Return ONLY valid JSON, no markdown, no commentary. Schema:
{
  "supplier_name": string,
  "invoice_number": string,
  "invoice_date": "YYYY-MM-DD" or null,
  "expected_delivery_date": "YYYY-MM-DD" or null (look for "ship date", "delivery date", or estimate 5 days after invoice_date if not present),
  "line_items": [{ "sku": string or null, "description": string, "qty": number, "unit_cost": number }],
  "total": number
}
If a field is unclear, use null. Never invent data.`;

export async function parseInvoiceImage(
  fileBuffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<ParseInvoiceResult> {
  if (!apiKey) {
    return { parsed: null, error: "ANTHROPIC_API_KEY not configured" };
  }
  // Claude vision accepts image media types; PDFs are supported as a
  // separate "document" content type in the SDK. We branch on mime so
  // PDF uploads still work.
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");
  if (!isPdf && !isImage) {
    return { parsed: null, error: `Unsupported file type: ${mimeType}` };
  }

  const client = new Anthropic({ apiKey });
  const base64 = fileBuffer.toString("base64");

  // Build the user message — text instruction plus the source content.
  const userContent: any[] = [
    { type: "text", text: "Extract the invoice. Reply with the JSON only." },
  ];
  if (isPdf) {
    userContent.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    });
  } else {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: mimeType, data: base64 },
    });
  }

  let rawResponse = "";
  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    // Concatenate all text blocks (Claude can return multiple).
    rawResponse = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  } catch (err: any) {
    return {
      parsed: null,
      error: err?.message ?? "Anthropic API call failed",
    };
  }

  // Claude sometimes wraps the JSON in ```json ... ``` fences despite the
  // system prompt asking it not to; strip those before parsing.
  const cleaned = rawResponse
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as ParsedInvoice;
    // Defensive normalisation — Claude may return slightly different
    // shapes; coerce numbers and ensure line_items is an array.
    parsed.line_items = Array.isArray(parsed.line_items)
      ? parsed.line_items.map((li: any) => ({
          sku: li?.sku ?? null,
          description: String(li?.description ?? ""),
          qty: Number(li?.qty) || 0,
          unit_cost: Number(li?.unit_cost) || 0,
        }))
      : [];
    if (parsed.total != null) parsed.total = Number(parsed.total) || null;
    return { parsed, rawResponse };
  } catch (err: any) {
    return {
      parsed: null,
      error: `Could not parse Claude response as JSON: ${err?.message ?? "unknown"}`,
      rawResponse,
    };
  }
}
