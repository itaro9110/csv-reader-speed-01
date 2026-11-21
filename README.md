# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/itaro9110/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/itaro9110/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Reads broken CSV files faster than csv-reader 1.0.0 — 4.33× faster on the practice set, byte-identical output.

## Run it

```sh
node main.ts
```

`solve.js` (ES module, `run(input)` → `{columns, rows, errors}`) is a drop-in replacement for csv-reader 1.0.0; `main.ts` drives it over `/input/cases.json` and writes `/output/answers.json`. Node 22, dependency-free, no WASM/native.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ptcn8f06&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>

## Design

- **Line fast path**: a physical line with no `"` and no stray CR is one record; its fields are `content.split(',')`. This covers the large majority of records.
- **Field parser (fallback)**: quoted fields find the closing quote with an indexOf loop that skips `""` pairs; if the quoted segment has no CR and no `""`, the value is one slice; otherwise a short rebuild loop turns `""` into `"` and every CR/CRLF into LF. Unquoted fields and quote-junk use an indexOf fast path with a parts-accumulation slow path only when a lone CR is present.
- **v3 (lineHasCR)**: the main loop records whether the current line holds a CR; when it holds none, `readUnquoted` skips its per-field slice + `\r` check. The flag is recomputed whenever `lineEnd` is re-derived, so the flagged content always covers the field's segment.
- Error order, record-line/row accounting, the stray-CR-only-line no-record rule, and the unterminated-quote re-read all mirror the reference exactly. Fields stay strings, never trimmed or converted.

## Validation

- Practice set (6 cases, ~10.6 MB): **6/6 identical to the reference**, byte-for-byte (difftest + end-to-end driver + `cmp` clean).
- Fuzz differential vs reference: **200,197 checks, 0 failures** (random texts + structured records + ~90 targeted edge cases + non-string coercion).
- Determinism: two separate `node main.ts` runs produce byte-identical `answers.json`.
- Timing (CPU time, `run()` alone, full practice set, 21 rounds trimmed mean): **v3 mine 166.4 ms vs reference csv-reader 1.0.0 719.9 ms — 4.33× faster** (v2 was 3.60×). Well above the 1.9× the house measured for d3-dsv and ~1.77× for papaparse on the same kind of set.

## License

MIT — see `LICENSE`.
