# BIU Racing Forms

תיעוד קבוצתי בעברית ובאנגלית לעונת 2027: 21 מערכות חשמל, טופס רכז, וטופס SES מכני עם ארבע קבוצות עבודה מוצעות. הקוד הוא פרויקט עצמאי ב־Git; ההפעלה והכניסה אינן דורשות ChatGPT.

## Automatic Hebrew → English

Saving a field, including leaving the field, queues translation in a browser Web Worker. The pinned OPUS-MT model runs on the visitor's device. There is **no OpenAI key, paid inference API, AI credit balance or scheduled agent**. Hebrew remains the source; English is saved separately against the exact source revision. Tables, notes and dependencies are included. Identifiers, units, numbers, links and workbook cell addresses are protected.

The first use downloads about 365 MB of model weights plus runtime files; browser storage normally caches them. A reasonably capable desktop browser, memory and an initial Internet connection are needed. Closing the page stops processing; pending work resumes when the relevant form/document is opened. Translation is an engineering draft, not a correctness or compliance guarantee. See [translation design](docs/translation-runtime.md) and [model attribution](THIRD_PARTY_NOTICES.md).

## Run locally

Node.js 22.13+ and npm are required. Node 22 is used in CI.

```sh
npm ci
npm run templates:prepare
npm run setup:local
npm run dev
```

Open http://127.0.0.1:5173. Local development uses an isolated D1 database and a development coordinator identity. It contains no production answers, memberships or uploaded files. Keep the dev listener on loopback; never set `LOCAL_DEV` on a hosted deployment.

```sh
npm run check
npm run catalog:check
npm run build
```

The official workbooks are downloaded from the competition's own URLs and checked against pinned SHA-256 values. A changed file fails preparation rather than silently invalidating cell mappings. Private workbook and example-image build inputs are ignored by Git.

## Collaboration and hosting

Fork the repository, create a branch and open a pull request. The owner chooses which contributions to merge and whom to grant direct repository access. Public source code does not make team answers or production storage public. See [CONTRIBUTING.md](CONTRIBUTING.md).

This is a full-stack React/Vinext application for Cloudflare Workers, D1 and R2, not a static GitHub Pages site. [Deployment and migration](docs/deployment.md) documents the required account resources, Cloudflare Access configuration and separate transfer of existing private data. The checked-in database ID is a placeholder; cloning or building does not deploy anything. Hosting/storage charges depend on the account plan; the no-quota statement concerns translation inference.

## Official form versions

- ESF: Italian FEI2023 template.
- ASES: FS26 v1.0 macro-enabled template.
- SES: FS26 v1.3, all 49 sheets preserved, 34 sheets with declared editable ranges.

These are working draft templates. Their acceptance for the 2027 Italian event has **not** been verified. The SES editor requests explicit workbook cell addresses and rejects locked/formula/invalid destinations. Original formulas, validation, formatting, images and merged cells are preserved; Excel must recalculate the exported workbook. Attachments remain in the evidence package. Proposed mechanical ownership is marked as proposed, not an assigned task.

## Data and maintenance

Existing saved answers are not included in this repository. No recurring Drive/Discord enrichment or quota polling is enabled. Imports are explicit coordinator actions with previews and revision checks. See [MAINTENANCE.md](MAINTENANCE.md).
