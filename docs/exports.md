# Result export schema — 1.0.0

Authorized match owners/admins can export only after the match completes. `GET /api/matches/:match_id/export?format=json` returns:

```ts
{ export_version: '1.0.0'; public_key: string; results: ResultRecord[] }
```

`cubebench_get_results({match_id})` returns the same data with `ok:true`. Successful completed public match results are also discoverable through the browser results pages; private records require ownership. Each record has:

- Identity: result_id, match_id, round_id, participant_id, run_id, league, classification, verification, runner_identity, submitter_identity.
- Reproduction: size, seed, canonical scramble, initial_state, final_state, engine/schema/notation/generator/prompt/format versions.
- Evidence: attempts (sequence, accepted/rejected tokens, call index, failure), complete call timeline, started_at, finished_at, monotonic elapsed_ms, time_to_first_move_ms, move_count and tool_call_count.
- Outcome: success and normalized failure; self-reported metadata; trusted_usage (nullable).
- Integrity: terminal event_hash, signing_key_id, Ed25519 signature encoded base64url.

The exact machine-readable schema is generated from `resultSchema` in `packages/shared-contracts/src/index.ts` and appears inside `docs/schemas/tools.json` under get_results and mutation outputs. Times are milliseconds; timestamps are ISO 8601 UTC; token usage/cost fields are null unless supplied by a verified authenticated runner through optional trusted_usage on a move/submission call.

CSV uses RFC 4180 quoting with CRLF row separators, a header row, and these columns:

```text
export_version,result_id,match_id,round_id,participant_id,run_id,league,classification,verification,size,elapsed_ms,move_count,tool_call_count,success,failure,display_name,signature,record_json
```

`record_json` embeds the full result so CSV export loses no evidence. Spreadsheet formula-leading values are prefixed with an apostrophe. Use record_json for signature verification; display columns may have spreadsheet escaping. Missing values are empty cells. Complete JSON and CSV exports contain no access, participant, run or browser-session tokens.

To verify a result, remove `signature`, serialize with the exported `canonicalJson` function, and verify Ed25519 against `public_key`. `signing_key_id` is the first 16 hex characters of the SHA-256 digest of canonical JSON encoding of the PEM public key. Any changed metadata, timestamp, state or move invalidates the signature. Keep the trusted public key out of band if protecting against an attacker who could replace both a result and its advertised key.
