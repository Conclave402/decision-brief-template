# Decision Brief

A product template for the [Kognai engine](https://www.npmjs.com/package/@kognai/build).
It turns one sentence of user input into a decision brief: a goal for the engine, a run,
and a shaped product with a summary, options, a recommendation and open questions.

## What it makes

Input: `{ brief: "Which paid x402 data feed should a small agent buy first?" }`.
Output under `outDir`:

- `brief.md` - the shaped product: header, mode, engine cost, then the engine's sections.
- `brief.json` - the manifest: template id, the brief, mode, cost, engine files, product files.
- `engine/` - whatever the engine wrote, kept unmodified so the shaping is auditable.

## Install

Node 20 or later. This package has no runtime dependencies; the engine is invoked
through `npx`. There is no install script.

```
git clone <this repository>
cd decision-brief-template
npm test
```

## Run on the cloud

```
ANTHROPIC_API_KEY=... node -e '
  const { runTemplate } = require("./src/index.js");
  runTemplate({ brief: "Which paid x402 data feed should a small agent buy first?" },
              { outDir: "./out" }).then(r => console.log(r));
'
```

The engine prints its own spend; `runTemplate` returns it as `cost_usd` and writes it
into `brief.json`.

## Run sovereign (local, 0 USD)

Same call with `sovereign: true`; the engine gets `--sovereign` and routes all inference
to a local Ollama instance, so no API key is needed and the cost is 0.

```
runTemplate({ brief: "...", sovereign: true }, { outDir: "./out" })
```

## Cost per run

From the engine's own cost estimator (`estimateCost`, @kognai/build 0.7.10) with four
tasks (cloud-code, cloud-exec, cloud-code, cloud-exec) and this template's tools:

| mode | USD per run |
| --- | --- |
| cloud | 0.38 (envelope; hard cap 0.57) |
| sovereign | 0.01 (tool layer only) |

`kognai-template.json` carries these numbers in `cost_per_run` with `runs: 0` and
`measured_on` naming the estimator, because no billed run has been made yet. M2 replaces
that field with the cost printed by a real run.

## Tests

`npm test` runs offline with no dependencies. Each test is named after the acceptance
item it proves: A1 template shape and cost, A2 the engine arguments, A3 shaping and cost,
A3b the sovereign path, A4 the failure and empty-output rejections. A5 and A6 are marked
todo at M1; A5 is checked by `./scripts/clean-check.sh`.

## Examples

`examples/README.md` describes the sample output, and `examples/fixture-run/` is the exact
shape produced by the injected test engine. It is not a real engine run; a real one lands
with the measured cost at M2.
