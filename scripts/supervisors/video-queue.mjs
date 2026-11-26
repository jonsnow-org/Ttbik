const PROMO_TAG = /^promo-ep-(\d+)$/;

export function assessVideoQueue({
  episodes = [],
  releases = [],
  nowMs = Date.now(),
  maxReleaseAgeHours = 80,
  minimumReadyEpisodes = 3,
} = {}) {
  const videoReleases = releases
    .map((release) => {
      const match = PROMO_TAG.exec(String(release.tag_name || ""));
      return match ? { ...release, episodeId: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.published_at || "1970-01-01T00:00:00Z") - Date.parse(a.published_at || "1970-01-01T00:00:00Z"));

  const releasedIds = new Set(videoReleases.map((release) => release.episodeId));
  const pending = episodes.filter((episode) => !releasedIds.has(Number(episode.id)));
  const ready = pending.filter((episode) => !episode.needs);
  const blocked = pending.filter((episode) => !!episode.needs);
  const latest = videoReleases[0] || null;
  const checks = [];

  if (!latest || !Number.isFinite(Date.parse(latest.published_at || ""))) {
    checks.push({
      name: "Promo video release freshness",
      level: "fail",
      detail: "no dated promo-ep-N release could be verified.",
    });
  } else {
    const ageHours = Math.max(0, (nowMs - Date.parse(latest.published_at)) / 3600000);
    checks.push({
      name: "Promo video release freshness",
      level: ageHours > maxReleaseAgeHours ? "fail" : "ok",
      detail: `latest ${latest.tag_name} was published ${Math.floor(ageHours)}h ago (limit ${maxReleaseAgeHours}h): ${latest.html_url || "GitHub Release"}`,
    });

    const assets = (latest.assets || []).filter((asset) => Number(asset.size) > 0);
    const hasVideo = assets.some((asset) => /\.mp4$/i.test(asset.name || ""));
    const hasThumbnail = assets.some((asset) => /\.jpe?g$/i.test(asset.name || ""));
    const missing = [!hasVideo && "MP4", !hasThumbnail && "JPG"].filter(Boolean);
    checks.push({
      name: "Promo video release assets",
      level: missing.length ? "fail" : "ok",
      detail: missing.length
        ? `${latest.tag_name} is missing non-empty ${missing.join(" and ")} asset(s).`
        : `${latest.tag_name} has non-empty MP4 and JPG assets.`,
    });
  }

  checks.push({
    name: "Promo video ready queue",
    level: ready.length === 0 ? "fail" : ready.length < minimumReadyEpisodes ? "warn" : "ok",
    detail: `${ready.length} ready, ${blocked.length} gated, ${pending.length} total unrendered episode(s); ready IDs: ${ready.map((episode) => episode.id).join(", ") || "none"}.`,
  });

  return {
    checks,
    latestTag: latest?.tag_name || null,
    readyIds: ready.map((episode) => Number(episode.id)),
    blockedIds: blocked.map((episode) => Number(episode.id)),
    pendingIds: pending.map((episode) => Number(episode.id)),
  };
}
