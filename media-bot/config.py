import os
from dataclasses import dataclass


@dataclass
class Config:
    bot_token: str
    owner_id: int
    archive_channel_id: str | None
    force_sub_channel: str | None
    enable_global_feed: bool

    @classmethod
    def from_env(cls) -> "Config":
        token = os.getenv("BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError("BOT_TOKEN is required")

        owner_raw = os.getenv("OWNER_ID", "").strip()
        if not owner_raw.isdigit():
            raise RuntimeError("OWNER_ID must be a numeric Telegram user id")

        return cls(
            bot_token=token,
            owner_id=int(owner_raw),
            archive_channel_id=os.getenv("ARCHIVE_CHANNEL_ID", "").strip() or None,
            force_sub_channel=os.getenv("FORCE_SUB_CHANNEL", "").strip() or None,
            enable_global_feed=os.getenv("ENABLE_GLOBAL_FEED", "false").lower() in ("1", "true", "yes"),
        )
