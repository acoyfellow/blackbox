# Findings

1. Clef scored the real `sample-wrong-key` run and marked step 2 (p=0.54). That step is the assistant deciding "I probably don't need to check the codemode docs". The model then sent the wrong question key, and both codemode calls that followed failed. Clef blamed the decision behind the errors, not the error steps themselves.
2. On `sample-recovered-landing`, Clef marked step 3 (p=0.57), which is the first failing codemode call.
3. The deploy to workers.dev was blocked by the local guardrail. The ban-host rule lists this account's workers.dev subdomain as a teaching-demo/SIRT subdomain where nothing should be deployed. The guardrail also flags public AI, D1, and R2 bindings that have no auth. The rule was not overridden.
4. Local wrangler 4.110 only supports compatibility dates up to 2026-04-17.
