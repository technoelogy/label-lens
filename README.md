# Label Lens

Point your phone at an Indian supplement or OTC pack. Get a plain-language read in 7 seconds.

Built as Exhibit 02 for [Technoelogy Lab](https://technoelogy.com).

**Live:** https://label-lens.technoelogy.workers.dev

## Stack

- Cloudflare Worker + Workers Assets (edge hosting)
- Google Cloud Vision API (OCR, Pass 1)
- Claude Haiku 4.5 (structuring, Pass 2)
- One HTML page, no framework

## Why two-pass

Vision LLMs hallucinate on blurry Indian/Ayurvedic pack photos — invented actives, swapped manufacturers, Sanskrit mistranslations. Splitting OCR (deterministic) from structuring (reasoning) means the model can only work with text that actually exists on the pack.

## Local dev

​```bash
npm install
cp .dev.vars.example .dev.vars  # add your keys
npm run dev
​```

## Deploy

​```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GCP_VISION_API_KEY
npx wrangler deploy
​```

---

Not medical advice. Always consult a pharmacist or doctor.