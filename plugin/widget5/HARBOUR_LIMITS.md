# Harbour unloading limits: governance

The Harbour Wave Conditions panel and the Harbour Conditions Advisory PDF show an
OK / Caution / Stop verdict for barge unloading against one of three authorities,
always labelled on screen and in the PDF.

## Where limits live

| Kind | Where | Status shown to users |
| --- | --- | --- |
| **Provisional** | `public/harbour-limits.json` with `"status": "provisional"`: placeholder values chosen by the SPC team so verdicts work before real criteria exist | "PROVISIONAL (placeholder values, not confirmed by Cook Islands Government)" |
| **Approved** | `public/harbour-limits.json`, versioned in git, served with the app | "Approved limits, version N, approved by X, effective D" |
| **Local draft** | The editor, stored in that one browser only | "DRAFT limits (not approved)" on screen and in any PDF made from them |

A local draft (or a provisional set) never becomes approved by itself. It can be exported as a proposal
file and sent to the approving authority.

The shipped provisional values are placeholders, not Cook Islands criteria. Replace
them with approved limits as soon as they exist.

## Publishing or changing approved limits

1. Start from a proposal file (panel: *Edit unloading limits > Export proposal*) or
   edit `public/harbour-limits.json` directly.
2. Set `"status": "approved"`, and fill in `approvedBy`, `approvedOn` and
   `effectiveFrom` (ISO dates). Limits are applied only from `effectiveFrom`.
3. Bump `version` by one, and append a `history` entry (`version`, `date`, `by`,
   `summary`).
4. Merge through normal review. The git history plus the in-file `history` is the
   audit trail. The file is validated on load: a malformed, unapproved or
   inverted (Stop not above Caution) file is rejected, and the panel says so
   instead of showing verdicts.

## Limit model

Per variable (wave height `hsM`, peak period `tpS` as a maximum, wind `windKt`),
a `caution` and a `stop` value; `null` means no limit on that variable. A
`harbours` entry (keyed by coastal-risk point id) replaces `default` wholesale for
that harbour.

If any variable that has a limit is missing from the forecast, the verdict is
**Incomplete**, never OK. A proven Stop still shows Stop.
