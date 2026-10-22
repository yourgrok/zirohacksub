import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export type LlmErrorKind = "disabled" | "timeout" | "rate_limit" | "unavailable" | "invalid_json" | "schema" | "error" | "budget";
export class LlmError extends Error {
  constructor(public kind: LlmErrorKind, message: string) { super(message); }
}

export interface LlmRequest { model: string; system: string; prompt: string; jsonSchema: Record<string, unknown> }
/** Low-level client: returns the model's text output. Mocked in unit tests. */
export interface LlmClient { generate(req: LlmRequest): Promise<string> }

export function geminiEnabled(): boolean {
  return (process.env.LLM_PROVIDER ?? "gemini") !== "none" && !!process.env.GEMINI_API_KEY;
}
export const plannerModel = () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
export const fastModel = () => process.env.GEMINI_FAST_MODEL || "gemini-3.5-flash-lite";

const redact = (s: string) => {
  const k = process.env.GEMINI_API_KEY;
  return k ? s.split(k).join("[redacted]") : s;
};

/** Real client: official @google/genai SDK, Interactions API (NOT generateContent, NOT managed agents). */
export class GeminiSdkClient implements LlmClient {
  private ai: GoogleGenAI;
  constructor(apiKey: string) { this.ai = new GoogleGenAI({ apiKey }); }
  async generate(req: LlmRequest): Promise<string> {
    const interaction = await this.ai.interactions.create({
      model: req.model,
      input: req.prompt,
      system_instruction: req.system,
      response_format: { type: "text", mime_type: "application/json", schema: req.jsonSchema },
    });
    return interaction.output_text ?? "";
  }
}

let injected: LlmClient | null = null;
export function setLlmClient(c: LlmClient | null) { injected = c; cache.clear(); calls = 0; }
let real: GeminiSdkClient | null = null;
function client(): LlmClient {
  if (injected) return injected;
  if (!real) real = new GeminiSdkClient(process.env.GEMINI_API_KEY!);
  return real;
}

const cache = new Map<string, unknown>();
let calls = 0;
export const llmCallCount = () => calls;
let chain: Promise<unknown> = Promise.resolve();

const TIMEOUT_MS = () => Number(process.env.LLM_TIMEOUT_MS ?? 8000);
const BACKOFF_MS = () => Number(process.env.LLM_BACKOFF_MS ?? 1500);

function classify(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  const msg = redact(String((e as any)?.message ?? e));
  const status = (e as any)?.status ?? (e as any)?.code;
  if (status === 429 || /\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(msg)) return new LlmError("rate_limit", msg.slice(0, 200));
  if (status === 404 || /\b404\b|not found|not supported|unsupported|NOT_FOUND/i.test(msg)) return new LlmError("unavailable", msg.slice(0, 200));
  return new LlmError("error", msg.slice(0, 200));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new LlmError("timeout", `no answer within ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function callOnce(req: LlmRequest): Promise<string> {
  calls++;
  return withTimeout(client().generate(req), TIMEOUT_MS());
}

async function callWithRetry(req: LlmRequest): Promise<string> {
  try { return await callOnce(req); }
  catch (e) {
    const err = classify(e);
    if (err.kind !== "rate_limit") throw err;
    await new Promise((r) => setTimeout(r, BACKOFF_MS()));
    try { return await callOnce(req); } catch (e2) { throw classify(e2); }
  }
}

export function toJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, any>;
  const strip = (o: any): any => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(o)) if (k !== "$schema" && k !== "additionalProperties") out[k] = strip(v);
      return out;
    }
    return o;
  };
  return strip(js);
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch { throw new LlmError("invalid_json", "model did not return valid JSON"); }
}

export interface JsonResult<T> { data: T; model: string; cached: boolean }

/**
 * Serialised (one call at a time), cached, retried once on 429, 8 s timeout, Zod-validated.
 * Tries each model in order if one is unavailable on the account/free tier.
 */
export function llmJson<T>(schema: z.ZodType<T>, opts: { models: string[]; system: string; prompt: string }): Promise<JsonResult<T>> {
  if (!geminiEnabled()) return Promise.reject(new LlmError("disabled", "no LLM configured"));
  const run = async (): Promise<JsonResult<T>> => {
    const jsonSchema = toJsonSchema(schema);
    let last: LlmError = new LlmError("error", "no model tried");
    for (const model of opts.models) {
      const key = `${model}\n${opts.system}\n${opts.prompt}`;
      if (cache.has(key)) return { data: cache.get(key) as T, model, cached: true };
      try {
        const text = await callWithRetry({ model, system: opts.system, prompt: opts.prompt, jsonSchema });
        const parsed = schema.safeParse(parseJson(text));
        if (!parsed.success) throw new LlmError("schema", `response failed validation: ${parsed.error.issues[0]?.message ?? "?"}`);
        cache.set(key, parsed.data);
        return { data: parsed.data, model, cached: false };
      } catch (e) {
        last = classify(e);
        if (last.kind === "unavailable") continue; // try the other model
        throw last;
      }
    }
    throw last;
  };
  const p = chain.then(run, run) as Promise<JsonResult<T>>;
  chain = p.catch(() => undefined);
  return p;
}
