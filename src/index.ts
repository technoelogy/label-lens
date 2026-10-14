import { SYSTEM_PROMPT } from "./system-prompt";

interface Env {
  ANTHROPIC_API_KEY: string;
  GCP_VISION_API_KEY: string;
  ASSETS: Fetcher;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const STRUCTURE_MODEL = "claude-haiku-4-5";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/decode" && request.method === "POST") {
      return handleDecode(request, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleDecode(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { image?: string };

    if (!body.image || !body.image.startsWith("data:image/")) {
      return jsonResponse({ error: "No image provided" }, 400);
    }

    const match = body.image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      return jsonResponse({ error: "Invalid image format" }, 400);
    }

    const base64Data = match[2];

    const estimatedBytes = (base64Data.length * 3) / 4;
    if (estimatedBytes > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "Image too large (max 5MB)" }, 413);
    }

    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${env.GCP_VISION_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Data },
              features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
              imageContext: { languageHints: ["en", "hi"] },
            },
          ],
        }),
      }
    );

    if (!visionResponse.ok) {
      const errText = await visionResponse.text();
      console.error("GCP Vision error:", errText);
      return jsonResponse({ error: "OCR unavailable", details: errText }, 502);
    }

    const visionData = (await visionResponse.json()) as {
      responses?: Array<{
        fullTextAnnotation?: { text?: string };
        error?: { message?: string };
      }>;
    };

    const visionResult = visionData.responses?.[0];
    if (visionResult?.error) {
      return jsonResponse({ error: "OCR failed", details: visionResult.error.message }, 502);
    }

    const ocrText = visionResult?.fullTextAnnotation?.text ?? "";

    if (!ocrText.trim()) {
      return jsonResponse({ error: "No text detected on label" }, 422);
    }

    const structureResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: STRUCTURE_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `OCR INPUT (verbatim text extracted from pack label by Google Cloud Vision):\n\n${ocrText}\n\nStructure this into the JSON schema. Only use text that appears above.`,
          },
        ],
      }),
    });

    if (!structureResponse.ok) {
      const errText = await structureResponse.text();
      console.error("Structure pass error:", errText);
      return jsonResponse({ error: "Structuring unavailable", ocr_text: ocrText }, 502);
    }

    const structureData = (await structureResponse.json()) as {
      content?: Array<{ text?: string }>;
    };
    const structuredText = structureData.content?.[0]?.text ?? "";

    try {
      const cleaned = structuredText
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      parsed._debug_ocr = ocrText;
      return jsonResponse(parsed, 200);
    } catch {
      return jsonResponse(
        { error: "Model returned invalid JSON", raw: structuredText, ocr_text: ocrText },
        500
      );
    }
  } catch (err) {
    console.error("handleDecode error:", err);
    return jsonResponse({ error: "Server error", details: String(err) }, 500);
  }
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}