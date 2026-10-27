# Nova video Space

This directory is deployed to the Hugging Face Space configured by the repository Actions secrets `HF_VIDEO_SPACE_ID` and `HF_TOKEN`.

Expected Space: `Novasy/nova-video-space`.

The deployment workflow copies `app.py` and `requirements.txt` into the Space repository. Keep access tokens in GitHub Actions secrets and the runtime token in Render service environment variables; never commit token values here.
