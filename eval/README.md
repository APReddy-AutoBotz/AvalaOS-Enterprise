# Extraction eval

Measures how well source documents are turned into a Process Model. Every change to parsing, extraction prompts or merge logic is scored here before it ships.

## Cases

### `ap-invoice`: vendor invoice processing at a fictional manufacturer

Kaveri Industrial Components Ltd. (Pune, India) processes about 9,000 to 10,000 vendor invoices a month in SAP S/4HANA. All content is synthetic. Company names, people, email domains (`*.example`) and GSTINs are invented.

| Source | Format | What it contributes |
| --- | --- | --- |
| `01-discovery-call-2026-10-06.vtt` | Teams transcript (WebVTT, speaker tags) | Overall flow, volumes, pain points, DoA, scope, a 2% tolerance statement. Has a recording gap and off-topic lines |
| `02-exceptions-deep-dive-2026-10-09.srt` | Zoom transcript (SRT) | Exception types and shares, GR and approval follow-up timings, buyer judgment, four-eyes review |
| `03-sap-integration-call-2026-10-14.txt` | Exported transcript (plain text) | Which SAP APIs exist, which are confirmed, reported or unknown; GUI scripting disabled; data classification; a 5% tolerance in SAP configuration |
| `04-SOP-FIN-AP-004-vendor-invoice-processing.docx` | Word SOP with tables | Numbered procedure, policy rules, DoA table, exception table, an 8,500 per month volume figure |
| `05-AP-Invoice-AsIs.drawio` | draw.io swimlane flowchart | Steps by lane, decisions and end states, with shape ids |
| `06-AP-Invoice-AsIs.png` | Image of the same flowchart | For image-based ingestion |

What the case deliberately tests:

- **Conflicts, not silent picks.** Tolerance: policy says 2% or INR 5,000; SAP is configured at 5%. Volume: 9,000 to 10,000 recently versus 8,500 in the SOP.
- **API availability is not assumed.** The supplier invoice API exists in the product but is not activated; GR and attachment APIs are unknown; PO and business partner read APIs are confirmed. UI automation is not available because GUI scripting is disabled.
- **Gaps become questions.** Non-PO handling time, paper share, GL coding for new vendors, buyer turnaround and others are never stated.
- **Human judgment is visible.** Variance resolution by the buyer and the four-eyes review are stated as judgment points.

`expected.model.json` is the hand-checked gold. It contains only what the sources say.

## Commands

```
npm run eval -- ap-invoice                   # score the gold against itself (must be 100%)
npm run eval -- ap-invoice result.json       # score an extraction result
npm run eval -- ap-invoice result.json --json --strict
npm run test:new                             # scorer tests and gold integrity
```

## Targets

| Measure | Target |
| --- | --- |
| Step recall and precision | 90% or more |
| Role assignment on matched steps | 85% or more |
| System assignment on matched steps | 85% or more |
| Excerpts found verbatim in their source | 100% |
| Expected open questions raised | 80% or more |
| Access methods marked confirmed when they are not | 0 |

Also reported: rule, exception, metric and conflict recall; provenance rate; missed and extra steps; roles and systems with no counterpart in the gold.

## Changing the case

Edit the generators in `corpus/ap-invoice/build/`, never the outputs by hand:

```
cd eval/corpus/ap-invoice/build
python3 make_sop.py ../sources/04-SOP-FIN-AP-004-vendor-invoice-processing.docx   # needs python-docx
node make_flowchart.mjs ../sources                                                 # PNG needs sharp
python3 make_gold.py                                                               # fails on any excerpt not found in its source
```

Transcripts are plain text files in `sources/` and are edited directly. After any edit, run `make_gold.py` and `npm run test:new`.
