# ML artifacts in S3

The dedup pipeline's built artifacts live in S3, not in git. This is the layout
and the reasoning.

**Bucket:** `loop-dashboard-ml-<ACCOUNT_ID>` (us-east-1, account `<ACCOUNT_ID>`)
**Versioning:** enabled · **Public access:** fully blocked (all four settings)

## Why

The 1.2 MB Titan index was committed to git. Two problems with that:

1. Git stores every version of a binary-ish blob forever. An embedding index is
   *regenerated output* — a megabyte of float32 per rebuild, permanently in the
   history, for a file nobody ever reads a diff of.
2. Nothing but this laptop had the artifacts. A container has no `data/`
   directory, so the runtime path could not work anywhere else.

S3 fixes both: one durable location, versioned so index history is preserved
without git carrying it, readable from anywhere with credentials.

## Key layout

| Key | What | Size |
| --- | --- | --- |
| `embeddings/local/latest.json` | most recent MiniLM index (384 dims) | 463 KB |
| `embeddings/local/<sha256>.json` | immutable, content-addressed archive of one build | 463 KB |
| `embeddings/titan/latest.json` | most recent Titan v2 index (1024 dims) | 1.2 MB |
| `embeddings/titan/<sha256>.json` | immutable, content-addressed archive of one build | 1.2 MB |
| `corpus/corpus.jsonl` | the 132-document corpus | 351 KB |
| `metrics/dedup-eval.json` | evaluation results | 294 KB |
| `gold-pairs/gold-pairs-llm.jsonl` | LLM-labelled pairs | 104 KB |

`latest.json` is the moving pointer the runtime loader reads. The
content-addressed copy alongside it exists so a run can be pinned to an exact
index by sha — a sha is a stable, greppable, portable identifier in a way an S3
version id is not, and it makes "is this the same index the metrics were
computed from" a string comparison rather than an API call. Both are written on
every build, content-addressed first, so `latest.json` never points at a build
whose archive copy failed to land.

Bucket versioning is on top of that, not instead of it: overwriting
`latest.json` still leaves every prior build recoverable.

`corpus.jsonl` and the gold pairs stay tracked in git as well — they are small,
hand-curated inputs rather than regenerated output, and having them in the repo
means the pipeline is inspectable without AWS.

## Reading (`lib/dedup/artifact-store.ts`)

```
ML_ARTIFACT_STORE=s3     (default) try S3, fall back to the local file
ML_ARTIFACT_STORE=local            never touch the network
ML_ARTIFACT_BUCKET=…               override the bucket
ML_ARTIFACT_REGION=…               override the region (else AWS_REGION, else us-east-1)
```

Credentials come from the default AWS provider chain — env vars,
`~/.aws/credentials`, SSO, ECS task role, IMDS — never an API key in code, the
same treatment `lib/dedup/embed.ts` gives Bedrock.

`loadArtifact` returns the source it actually used (`"s3"` or `"local"`), so a
caller that needs to prove where bytes came from can assert on it rather than
assume. Every fallback is announced on stderr; a failure of *both* stores
throws with both errors in the message.

### Why this falls back when the Bedrock path refuses to

`embed.ts` deliberately never falls back from Titan to MiniLM, because that
would silently mislabel *which model produced a number* and corrupt an
evaluation. Falling back from S3 to the local copy changes only *where the
identical bytes were read from*. One is a correctness question, the other is a
transport detail — hence the different policies.

`scripts/ml/_shared.mjs`'s `loadAllEmbeddings()` calls into this module rather
than reimplementing the fallback, so there is one loader, not two.

## Writing (`scripts/ml/build-index.mjs`)

Every build writes the local file first, then uploads. Upload is on by default
when AWS credentials look present:

```
ML_ARTIFACT_UPLOAD=1|true|always   force on
ML_ARTIFACT_UPLOAD=0|false|never   force off
```

An upload failure is fatal rather than a warning. A build that reports success
while `latest.json` still points at the previous index is how a stale artifact
gets evaluated for a week without anyone noticing.

## Cost

~4.1 MB across 7 objects. At S3 Standard's $0.023/GB-month that is
**about $0.0001/month** — well under a cent, and request costs at this volume
round to zero. Versioning adds a copy per rebuild; at ~1.2 MB a build this stays
negligible for the foreseeable future. If it ever stops being negligible, a
lifecycle rule expiring noncurrent versions after N days is the fix.
