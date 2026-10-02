# Findings

1. Clef scored the real `sample-wrong-key` run and marked step 2 (p=0.54). That step is the assistant deciding "I probably don't need to check the codemode docs". The model then sent the wrong question key, and both codemode calls that followed failed. Clef blamed the decision behind the errors, not the error steps themselves.
2. On `sample-recovered-landing`, Clef marked step 3 (p=0.57), which is the first failing codemode call.
3. The deploy to workers.dev was blocked by the local guardrail. The ban-host rule lists this account's workers.dev subdomain as a teaching-demo/SIRT subdomain where nothing should be deployed. The guardrail also flags public AI, D1, and R2 bindings that have no auth. The rule was not overridden.
4. Local wrangler 4.110 only supports compatibility dates up to 2026-04-17.
5. The narration UI dropped digits. The Workers AI stream sends each token in two fields: `response` and `choices[0].delta.content`. Some chunks that carry a number had an empty or missing `response` while `delta.content` had the digits, for example `" 5"` and `"10"`. The parser read only `response`. It now reads `delta.content` first. `test/recording.test.ts` covers a chunk with numbers.

