"""
Sham — real web search + fetch for autonomous_knowledge_crawler.py.

The gap this closes: autonomous_knowledge_crawler.py's crawl_and_learn()
takes search_fn/fetch_fn as PLUGGABLE callables (SearchFn/FetchFn type
aliases) — its own __main__ only ever exercises them with deterministic
mocks, since this sandbox has no reachable internet (same documented
boundary as data_acquisition.py). That mechanism was always real and
correct; what was missing is the actual real, internet-facing
implementation to plug into it. This file is that implementation:

  - real_search(): real DDGS() web search, the exact same call already
    proven live in ai-system/scripts/gather_knowledge.py — not a new,
    unverified integration.
  - real_fetch(): a real HTTP GET with an honest, identifying User-Agent,
    real retry-with-backoff on transient failures (429/503/timeouts),
    and real robots.txt compliance (skips a URL its own site disallows,
    rather than trying to defeat that) — a real, professional crawler,
    not a stealth/anti-detection tool. This project does not build
    tools to evade legitimate anti-bot/anti-scraping security measures,
    paywalls, or CAPTCHAs; "avoiding being blocked" here means behaving
    like a normal, well-mannered client (a real identifying UA, sane
    pacing, respecting robots.txt), which is the actual, legitimate fix
    for the class of block this project has already hit once for real:
    this repo's own gather_knowledge.py documents DuckDuckGo blocking
    scraping specifically from Render's shared cloud IP, and running
    from Kaggle/GitHub Actions instead (different IP ranges) was the
    real, working fix there -- not any kind of evasion technique.

Both functions match autonomous_knowledge_crawler.py's SearchFn/FetchFn
signatures exactly, so `crawl_and_learn(topics, real_search, real_fetch,
corpus, ...)` is the complete, real, non-mocked call.
"""

from __future__ import annotations

import logging
import time
import urllib.robotparser
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

USER_AGENT = (
    "ShamKnowledgeCrawler/1.0 "
    "(+https://github.com/jonsnow-org/Ttbik; educational research crawler "
    "collecting training data for a from-scratch, non-commercial language model)"
)

_robots_cache: dict[str, urllib.robotparser.RobotFileParser] = {}


def _robots_allows(url: str) -> bool:
    """Real robots.txt compliance -- a missing/unreadable robots.txt is
    treated as "allowed" (the standard, documented RobotFileParser
    default), matching how every well-behaved crawler treats a site
    that simply never published one. Cached per-domain so a whole
    crawl run fetches each site's robots.txt at most once, not once
    per page."""
    parsed = urlparse(url)
    domain = f"{parsed.scheme}://{parsed.netloc}"
    parser = _robots_cache.get(domain)
    if parser is None:
        parser = urllib.robotparser.RobotFileParser()
        parser.set_url(f"{domain}/robots.txt")
        try:
            parser.read()
        except Exception as e:
            logger.info("could not read robots.txt for %s (%s) -- treating as allowed", domain, e)
        _robots_cache[domain] = parser
    try:
        return parser.can_fetch(USER_AGENT, url)
    except Exception:
        return True


def real_search(query: str, language: str = "ar", max_results: int = 5) -> list[str]:
    """Matches autonomous_knowledge_crawler.SearchFn: (query, language) ->
    list of real URLs. Real DDGS() call, the same one already proven
    live in ai-system/scripts/gather_knowledge.py (that script reads
    only title/body from the same results; this reads href, the URL,
    since crawl_and_learn() needs a page to actually fetch, not just a
    snippet)."""
    from ddgs import DDGS

    region = "xa-ar" if language == "ar" else "us-en"
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, region=region, max_results=max_results))
    except Exception as e:
        # Real, previously-hit failure mode in this exact project:
        # gather_knowledge.py's own docstring documents DuckDuckGo
        # blocking scraping from Render's shared cloud IP specifically.
        # Naming that here turns a silent, confusing "zero results"
        # into an actionable diagnostic instead.
        logger.warning(
            "real_search('%s') failed (%s) -- if this keeps happening, this IP may be rate-limited/blocked by "
            "the search provider (this project has hit exactly that before from Render's shared IP; "
            "Kaggle/GitHub Actions runners were not affected the same way).",
            query, e,
        )
        return []
    return [r["href"] for r in results if r.get("href")]


def real_fetch(url: str, timeout: float = 10.0, max_retries: int = 3) -> str:
    """Matches autonomous_knowledge_crawler.FetchFn: url -> real raw
    HTML. Real retry-with-exponential-backoff on transient failures
    (429 Too Many Requests, 503 Service Unavailable, timeouts/connection
    errors) -- a single transient hiccup must not permanently discard an
    otherwise-good URL from this crawl run. Raises (rather than
    returning empty text) once every retry is exhausted, since
    crawl_and_learn() already treats a raised exception from fetch_fn as
    one real "fetch failed" stat, exactly the right outcome here."""
    if not _robots_allows(url):
        raise PermissionError(f"robots.txt disallows fetching {url} for this crawler's user agent")

    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            response = requests.get(
                url,
                headers={"User-Agent": USER_AGENT, "Accept-Language": "ar,en;q=0.8"},
                timeout=timeout,
            )
            if response.status_code == 200:
                return response.text
            if response.status_code in (429, 503):
                logger.info("real_fetch(%s) got %s -- retrying after backoff", url, response.status_code)
                time.sleep(2**attempt)
                continue
            response.raise_for_status()
        except requests.RequestException as e:
            last_exc = e
            logger.info("real_fetch(%s) attempt %d/%d failed (%s)", url, attempt + 1, max_retries, e)
            time.sleep(2**attempt)

    raise RuntimeError(f"failed to fetch {url} after {max_retries} attempts: {last_exc}")


if __name__ == "__main__":
    from unittest.mock import MagicMock, patch

    # Real, mocked verification of the wiring/retry/robots logic --
    # no real network available in this sandbox (same documented
    # boundary as data_acquisition.py and autonomous_knowledge_crawler.py's
    # own __main__), so what's proven here is that THIS module's logic
    # is correct, ready to run for real on Kaggle/GitHub Actions.

    # --- 1) real_search extracts hrefs and handles a failure gracefully
    with patch("ddgs.DDGS") as MockDDGS:
        mock_instance = MockDDGS.return_value.__enter__.return_value
        mock_instance.text.return_value = [
            {"title": "A", "href": "https://example.com/a", "body": "..."},
            {"title": "B", "href": "https://example.com/b", "body": "..."},
            {"title": "C", "body": "no href here"},
        ]
        urls = real_search("test query")
        assert urls == ["https://example.com/a", "https://example.com/b"], f"unexpected urls: {urls}"
        print(f"real_search correctly extracted {len(urls)} real URLs and skipped a result missing href.")

    with patch("ddgs.DDGS", side_effect=RuntimeError("simulated block")):
        urls = real_search("test query")
        assert urls == [], "a search failure must return an empty list, not raise, so one bad query doesn't kill a whole crawl run"
        print("real_search correctly degrades to an empty list (with a logged diagnostic) on failure, instead of raising.")

    # --- 2) real_fetch retries on 429 then succeeds
    _robots_cache.clear()
    with patch("urllib.robotparser.RobotFileParser.read", return_value=None), \
         patch("urllib.robotparser.RobotFileParser.can_fetch", return_value=True), \
         patch("time.sleep", return_value=None), \
         patch("requests.get") as mock_get:
        resp_429 = MagicMock(status_code=429)
        resp_200 = MagicMock(status_code=200, text="<html>real page</html>")
        mock_get.side_effect = [resp_429, resp_200]
        html = real_fetch("https://example.com/page")
        assert html == "<html>real page</html>"
        assert mock_get.call_count == 2
        print("real_fetch correctly retried once after a 429 and succeeded on the second attempt.")

    # --- 3) real_fetch raises after exhausting all retries
    with patch("urllib.robotparser.RobotFileParser.read", return_value=None), \
         patch("urllib.robotparser.RobotFileParser.can_fetch", return_value=True), \
         patch("time.sleep", return_value=None), \
         patch("requests.get") as mock_get:
        mock_get.return_value = MagicMock(status_code=503)
        try:
            real_fetch("https://example.com/always-503", max_retries=2)
            raise AssertionError("expected RuntimeError after exhausting retries")
        except RuntimeError:
            print("real_fetch correctly raises once every retry against a persistently failing page is exhausted.")

    # --- 4) real_fetch refuses a URL robots.txt disallows
    _robots_cache.clear()
    with patch("urllib.robotparser.RobotFileParser.read", return_value=None), \
         patch("urllib.robotparser.RobotFileParser.can_fetch", return_value=False), \
         patch("requests.get") as mock_get:
        try:
            real_fetch("https://example.com/disallowed")
            raise AssertionError("expected PermissionError for a robots.txt-disallowed URL")
        except PermissionError:
            assert mock_get.call_count == 0, "must never even attempt a GET for a robots.txt-disallowed URL"
            print("real_fetch correctly refuses a robots.txt-disallowed URL without ever attempting the request.")

    # --- 5) robots.txt is fetched at most once per domain across many calls
    _robots_cache.clear()
    with patch("urllib.robotparser.RobotFileParser.read", return_value=None) as mock_read, \
         patch("urllib.robotparser.RobotFileParser.can_fetch", return_value=True), \
         patch("requests.get", return_value=MagicMock(status_code=200, text="ok")):
        real_fetch("https://example.com/page1")
        real_fetch("https://example.com/page2")
        real_fetch("https://example.com/page3")
        assert mock_read.call_count == 1, f"expected robots.txt read exactly once per domain, got {mock_read.call_count}"
        print("robots.txt is correctly cached per-domain -- 3 pages on the same site triggered only 1 robots.txt read.")

    print("\nAll web_access checks passed: real_search/real_fetch match autonomous_knowledge_crawler.py's "
          "SearchFn/FetchFn contract exactly, with real retry/backoff, real robots.txt compliance (cached "
          "per domain), and graceful degradation on search failure -- ready to plug into crawl_and_learn() "
          "for a genuinely real, non-mocked crawl on Kaggle or GitHub Actions.")
