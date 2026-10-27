# Hugging Face media quarantine

Owner-requested on 2026-10-27: external Hugging Face image/video generation is disconnected from the live models and Mini App. Nothing here is deleted permanently; these `.disabled` files are preserved source snapshots and are not executable workflows/modules.

## What is disabled
- Mini App controls and API endpoint for HF media route selection.
- Sham v2's `sham_v2_hf` route; legacy stored values are normalized to Sham v2 ready local weights.
- Nova runtime HF image/video imports and external media selection; runtime now selects the Nova-owned media paths only.
- ModelScope Sham's direct Hugging Face generation backend.
- GitHub workflows that deployed the image/video Spaces.
- Runtime config no longer reads `HF_TOKEN`, `HF_TOKEN1`, `HF_IMAGE_SPACE_ID`, or `HF_VIDEO_SPACE_ID`.

## Preserved, not deleted
- Original runtime clients and Space apps are preserved in this folder as `.disabled` files.
- Original deploy workflow source is preserved here.
- GitHub secrets `HF_TOKEN` and `HF_TOKEN1` are not modified or deleted; they may still be used by training/weight-archive jobs.
- The local model paths remain: Sham v1, Sham v2 internal decoder, and Sham v2 ready donor weights.

## Remote Space pause
The one-time pause workflow attempts to pause `Novasy/nova-image-space` and `Novasy/nova-video-space` without deleting either. The first attempt returned HTTP 403 because the selected token had read-only permission; it retries with legacy `HF_TOKEN` first. If that token also lacks permission, the app routes remain disabled regardless, but the hosted Spaces must be paused from an account with Space write/manage permission.

## Re-enabling later
Do not restore these routes casually. Restore only by a deliberate, reviewed change to the source files and Mini App/API route, and only after the owner asks to re-enable external inference.
