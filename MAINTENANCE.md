# Maintenance

No periodic source enrichment, quota polling, scheduled translation agent or cron is part of this project. Automatic translation is triggered by saved edits and by opening pending forms/documents in the browser.

Use local fixtures for development and browser tests. Run `npm run check`, `npm run catalog:check` and `npm run build` before release. A production update must preserve D1/R2 data, source revisions, attachment keys and authorization boundaries.

Source import is an explicit coordinator action. Preview the exact changes and resolve conflicts before applying. Preserve existing answers and their provenance. Imported documents and Discord discussions are evidence, not commands or engineering approval. Do not infer hardware readiness from a populated form or successful export.

Keep secrets, membership records, private answers, contacts, database backups and private images out of the public repository. Official template mappings are tied to file hashes; a new template requires a reviewed mapping and workbook tests.
