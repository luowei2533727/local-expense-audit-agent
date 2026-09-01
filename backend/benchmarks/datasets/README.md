# External benchmark datasets

Dataset binaries are intentionally excluded from Git. The project currently supports:

## WildReceipt

- Source: `https://download.openmmlab.com/mmocr/data/wildreceipt.tar`
- Official documentation: `https://mmocr.readthedocs.io/en/latest/user_guides/data_prepare/datasetzoo.html#wildreceipt`
- Contents observed in the published archive: 1,267 train annotations, 472 test annotations, 1,765 JPEG files.
- Observed archive SHA-256: `f47646e16033d95c85a0b3a180a39d90cc354a729e51a280211b2fe7cae532bd`
- License: the MMOCR dataset documentation does not specify a dataset license. Use it for local research/evaluation only and do not redistribute the archive or images without confirming rights.

Prepare the dataset from the backend directory:

```powershell
pnpm dataset:wildreceipt
```

Run a deterministic 50-image real-data benchmark:

```powershell
pnpm benchmark:real -- --limit=50 --phase=all --seed=20260831
```

The runner is resumable. OCR, Agent and end-to-end metrics are kept separate so that extraction errors are not confused with policy-reasoning errors.

## CORD v2 adapter target

CORD v2 is the preferred redistributable alternative because the official project publishes it under CC BY 4.0. The current network environment cannot reach Hugging Face, so it is documented as the next adapter rather than silently using an unofficial mirror.

- Project: `https://github.com/clovaai/cord`
- Dataset: `https://huggingface.co/datasets/naver-clova-ix/cord-v2`

## SCID Chinese invoice evaluation target

SCID is the closest public benchmark to ExpensePilot's Chinese reimbursement scenario. Its official page describes 40,716 desensitized real scanned Chinese financial documents across air itineraries, taxi invoices, quota invoices, train tickets, toll invoices and passenger tickets, with OCR and key-value annotations.

- Official page: `https://davar-lab.github.io/dataset/scid.html`
- Paper/DOI: `https://doi.org/10.11834/jig.220911`
- Split reported by the paper: 19,999 train / 10,358 validation / 10,359 test.
- Public annotation license: CC BY-NC-SA 4.0. This is non-commercial; review the terms before any portfolio or production redistribution.
- Access: the official TickLink currently returns `File not found` for its published share identifier; ScienceDB provides an application route. The project does not use an unofficial mirror or bypass access controls.

When an authorized local copy is available, place it below `benchmarks/datasets/scid/`. Do not commit images or annotations. Until then, WildReceipt supplies the executable real-image benchmark and the report must explicitly state its English-receipt domain limitation.
