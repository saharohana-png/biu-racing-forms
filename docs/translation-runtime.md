# Translation runs in the browser

`lib/translation.worker.ts` uses Transformers.js with pinned public Hebrew-to-English OPUS-MT weights, q8 precision and WASM. Model identity and revision are in `lib/local-translation-config.ts`. Static model/runtime files are fetched; the user's prose is not sent to a third-party inference service. Hebrew and resulting English are stored by this application's authenticated API.

## Save flow

1. The editor saves Hebrew on blur and through its existing debounced save path.
2. The database save atomically records a pending translation revision.
3. The open editor requests the authorized current translation plan. The browser queue runs one worker at a time and processes bounded chunks.
4. A terminology/literal preprocessor protects component identifiers, numbers, units and URLs. A validator rejects changed/missing literals or Hebrew left in the result.
5. The browser posts each validated English chunk to the same-origin application API. The server checks membership, write permission, source revision/hash, chunk key and model version.
6. Cache inserts are guarded atomically by the current database revision and hash. Late results cannot overwrite a newer edit. A field is exposed only after all its chunks are available.

English remains a draft. Literal preservation cannot verify all negation, relationships, engineering meaning or grammar. Human review is required before submission. Hebrew source is never replaced, and a failed or unavailable engine never turns a field into a completed English answer.

## Resource and failure behavior

There are no inference API credentials, subscriptions, periodic agents, server translation jobs or recurring provider retries. The first download is roughly 365 MB for the q8 weights, plus tokenizer/runtime files. Browser caching avoids normal repeat downloads but may be evicted by the browser. Inference consumes local RAM/CPU. This is local machine translation, not a dictionary-only general-language translator.

An unavailable network, unsupported browser, lack of memory, failed validation or a closed page may leave work pending. Reopening a form/document resumes pending work; the online event retries failed work. A visible retry button is available. No background timer crawls team data.

The 500-character chunk size bounds inference input; complete source text is retained exactly across the chunk plan. Cache keys include source, context, schema version, model revision and glossary version. Changing the model or terminology requires a version change and engineering-text regression checks.

## Validation

`tests/translation.test.cjs` exercises actual database revision guards, authorization, mixed scalar/table/reason fields, literal protection, partial-field withholding and cache reuse. Browser QA must also verify a real model run after blur, a rapid subsequent edit, reload persistence, and English export. Unit tests do not establish browser inference success.
