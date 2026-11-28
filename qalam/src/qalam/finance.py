"""Qalam's finance and trading engine: a real, deterministic executor for the `finance` tool group. Nothing here predicts the market and nothing promises a profit; it
measures, sizes, tests and guards. The model's job in this domain is to (1) get the numbers right (indicators, risk, pricing, portfolio maths), (2) test an idea honestly
(no look-ahead, costs, out-of-sample, walk-forward, an overfitting warning) and (3) refuse to risk money outside hard limits. Real orders go through `LiveGate`, which is a
pure rule check: live trading is OFF until the owner enables it in the limits file, every order needs a typed confirmation, a stop-loss, a size inside the limits, a sane price,
a drawdown/daily-loss budget and a released emergency stop; the broker connection itself is a connector the owner grants (`mcp_call`), never code in the model's reach."""
from __future__ import annotations

import csv
import json
import math
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from .audit import AuditLog, EmergencyStop

TRADING_DAYS = 252
DISCLAIMER = "past results do not predict future results; this is analysis, not advice, and no strategy is guaranteed to make money"


class FinanceError(Exception):
    pass


def _f(x) -> float:
    """JSON-safe float (nan / inf become None)."""
    x = float(x)
    return round(x, 6) if math.isfinite(x) else None


# ------------------------------------------------------------------ data
def load_ohlcv(path: str | Path) -> dict[str, np.ndarray]:
    """CSV with a header: date/time, open, high, low, close, volume (case-insensitive; only `close` is required). Rows are sorted by date; bad rows are rejected loudly."""
    p = Path(path)
    if not p.exists():
        raise FinanceError(f"{p.name}: no such file")
    with open(p, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    if len(rows) < 2:
        raise FinanceError("need at least 2 rows of prices")
    cols = {k.strip().lower(): k for k in rows[0]}
    if "close" not in cols and "adj close" not in cols and "price" not in cols:
        raise FinanceError("the file needs a close column")
    ck = cols.get("close") or cols.get("adj close") or cols["price"]
    dk = cols.get("date") or cols.get("datetime") or cols.get("time") or cols.get("timestamp")
    out: dict[str, list] = {"date": [], "open": [], "high": [], "low": [], "close": [], "volume": []}
    for i, r in enumerate(rows):
        try:
            c = float(r[ck])
        except (TypeError, ValueError):
            raise FinanceError(f"row {i + 2}: close is not a number") from None
        if not math.isfinite(c) or c <= 0:
            raise FinanceError(f"row {i + 2}: close must be positive")

        def g(name, default):
            k = cols.get(name)
            try:
                return float(r[k]) if k and r[k] not in ("", None) else default
            except ValueError:
                return default
        out["date"].append(r[dk] if dk else str(i))
        out["close"].append(c)
        out["open"].append(g("open", c))
        out["high"].append(g("high", c))
        out["low"].append(g("low", c))
        out["volume"].append(g("volume", 0.0))
    order = np.argsort(np.array(out["date"], dtype=object), kind="stable") if dk else np.arange(len(rows))
    data = {k: (np.array(v, dtype=object)[order] if k == "date" else np.array(v, dtype=float)[order]) for k, v in out.items()}
    bad = (data["high"] < data["low"]) | (data["high"] < np.maximum(data["open"], data["close"]) - 1e-9) | (data["low"] > np.minimum(data["open"], data["close"]) + 1e-9)
    if bad.any():
        raise FinanceError(f"{int(bad.sum())} rows have an impossible high/low (first at row {int(np.argmax(bad)) + 2})")
    return data


# ------------------------------------------------------------------ indicators (all causal: value at t uses data up to and including t)
def sma(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if n <= len(x):
        c = np.cumsum(np.insert(x, 0, 0.0))
        out[n - 1:] = (c[n:] - c[:-n]) / n
    return out


def ema(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if n > len(x):
        return out
    a = 2.0 / (n + 1)
    out[n - 1] = x[:n].mean()
    for i in range(n, len(x)):
        out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out


def _wilder(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if n >= len(x):
        return out
    out[n] = x[1:n + 1].mean()
    for i in range(n + 1, len(x)):
        out[i] = (out[i - 1] * (n - 1) + x[i]) / n
    return out


def rsi(close: np.ndarray, n: int = 14) -> np.ndarray:
    d = np.diff(close, prepend=close[0])
    up, dn = np.where(d > 0, d, 0.0), np.where(d < 0, -d, 0.0)
    au, ad = _wilder(up, n), _wilder(dn, n)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = au / ad
        r = 100.0 - 100.0 / (1.0 + rs)
    r[(ad == 0) & (au > 0)] = 100.0
    return r


def macd(close: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    line = ema(close, fast) - ema(close, slow)
    sig = np.full(len(close), np.nan)
    ok = ~np.isnan(line)
    if ok.sum() >= signal:
        start = int(np.argmax(ok))
        sig[start:] = ema(line[start:], signal)
    return line, sig, line - sig


def bollinger(close: np.ndarray, n: int = 20, k: float = 2.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    m = sma(close, n)
    sd = np.full(len(close), np.nan)
    for i in range(n - 1, len(close)):
        sd[i] = close[i - n + 1:i + 1].std(ddof=0)
    return m - k * sd, m, m + k * sd


def true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    pc = np.roll(close, 1)
    pc[0] = close[0]
    return np.maximum(high - low, np.maximum(np.abs(high - pc), np.abs(low - pc)))


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, n: int = 14) -> np.ndarray:
    return _wilder(true_range(high, low, close), n)


def stochastic(high: np.ndarray, low: np.ndarray, close: np.ndarray, n: int = 14, d: int = 3) -> tuple[np.ndarray, np.ndarray]:
    k = np.full(len(close), np.nan)
    for i in range(n - 1, len(close)):
        hh, ll = high[i - n + 1:i + 1].max(), low[i - n + 1:i + 1].min()
        k[i] = 50.0 if hh == ll else 100.0 * (close[i] - ll) / (hh - ll)
    dd = np.full(len(close), np.nan)
    ok = ~np.isnan(k)
    if ok.sum() >= d:
        st = int(np.argmax(ok))
        dd[st:] = sma(k[st:], d)
    return k, dd


def adx(high: np.ndarray, low: np.ndarray, close: np.ndarray, n: int = 14) -> np.ndarray:
    up, dn = np.diff(high, prepend=high[0]), -np.diff(low, prepend=low[0])
    pdm, mdm = np.where((up > dn) & (up > 0), up, 0.0), np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = _wilder(true_range(high, low, close), n)
    with np.errstate(divide="ignore", invalid="ignore"):
        pdi, mdi = 100 * _wilder(pdm, n) / tr, 100 * _wilder(mdm, n) / tr
        dx = 100 * np.abs(pdi - mdi) / (pdi + mdi)
    out = np.full(len(close), np.nan)
    ok = ~np.isnan(dx)
    if ok.sum() > n:
        s = int(np.argmax(ok))
        out[s:] = _wilder(np.concatenate([[0.0], dx[s:]]), n)[1:]
    return out


def roc(close: np.ndarray, n: int = 10) -> np.ndarray:
    out = np.full(len(close), np.nan)
    out[n:] = close[n:] / close[:-n] - 1.0
    return out


def obv(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    return np.cumsum(np.sign(np.diff(close, prepend=close[0])) * volume)


def donchian(high: np.ndarray, low: np.ndarray, n: int = 20) -> tuple[np.ndarray, np.ndarray]:
    hi, lo = np.full(len(high), np.nan), np.full(len(low), np.nan)
    for i in range(n - 1, len(high)):
        hi[i], lo[i] = high[i - n + 1:i + 1].max(), low[i - n + 1:i + 1].min()
    return hi, lo


def zscore(x: np.ndarray, n: int = 20) -> np.ndarray:
    out = np.full(len(x), np.nan)
    for i in range(n - 1, len(x)):
        w = x[i - n + 1:i + 1]
        sd = w.std(ddof=0)
        out[i] = 0.0 if sd == 0 else (x[i] - w.mean()) / sd
    return out


INDICATORS = ("sma", "ema", "rsi", "macd", "bollinger", "atr", "stochastic", "adx", "roc", "obv", "donchian", "zscore")


def indicators(data: dict[str, np.ndarray], specs: list) -> dict[str, list]:
    """specs: ['rsi', {'name': 'sma', 'n': 50}, ...] -> {column: values (None where not yet defined)}. Only the last 400 values are returned in text form by the caller."""
    c, h, lo, v = data["close"], data["high"], data["low"], data["volume"]
    out: dict[str, np.ndarray] = {}
    for s in specs:
        s = {"name": s} if isinstance(s, str) else dict(s)
        nm, n = str(s.get("name", "")).lower(), s.get("n")
        if nm not in INDICATORS:
            raise FinanceError(f"unknown indicator {nm!r}; known: {', '.join(INDICATORS)}")
        if n is not None and (not isinstance(n, int) or not 1 <= n <= len(c)):
            raise FinanceError(f"{nm}: n must be between 1 and the number of rows")
        if nm == "sma":
            out[f"sma_{n or 20}"] = sma(c, n or 20)
        elif nm == "ema":
            out[f"ema_{n or 20}"] = ema(c, n or 20)
        elif nm == "rsi":
            out[f"rsi_{n or 14}"] = rsi(c, n or 14)
        elif nm == "macd":
            m_, sg, hi_ = macd(c, int(s.get("fast", 12)), int(s.get("slow", 26)), int(s.get("signal", 9)))
            out.update(macd=m_, macd_signal=sg, macd_hist=hi_)
        elif nm == "bollinger":
            lw, md, up = bollinger(c, n or 20, float(s.get("k", 2.0)))
            out.update(bb_lower=lw, bb_mid=md, bb_upper=up)
        elif nm == "atr":
            out[f"atr_{n or 14}"] = atr(h, lo, c, n or 14)
        elif nm == "stochastic":
            k_, d_ = stochastic(h, lo, c, n or 14)
            out.update(stoch_k=k_, stoch_d=d_)
        elif nm == "adx":
            out[f"adx_{n or 14}"] = adx(h, lo, c, n or 14)
        elif nm == "roc":
            out[f"roc_{n or 10}"] = roc(c, n or 10)
        elif nm == "obv":
            out["obv"] = obv(c, v)
        elif nm == "donchian":
            hi_, lo_ = donchian(h, lo, n or 20)
            out.update(donchian_high=hi_, donchian_low=lo_)
        elif nm == "zscore":
            out[f"zscore_{n or 20}"] = zscore(c, n or 20)
    return {k: [None if not math.isfinite(x) else round(float(x), 6) for x in v_] for k, v_ in out.items()}


# ------------------------------------------------------------------ performance and risk
def returns_from_prices(close: np.ndarray) -> np.ndarray:
    return close[1:] / close[:-1] - 1.0


def max_drawdown(equity: np.ndarray) -> float:
    peak = np.maximum.accumulate(equity)
    return float(((equity - peak) / peak).min()) if len(equity) else 0.0


def performance(returns: np.ndarray, periods: int = TRADING_DAYS, rf: float = 0.0) -> dict:
    """Standard measures on a series of per-period returns. `rf` is the annual risk-free rate."""
    r = np.asarray(returns, dtype=float)
    if len(r) < 2:
        raise FinanceError("need at least 2 returns")
    eq = np.cumprod(1.0 + r)
    n = len(r)
    total = float(eq[-1] - 1.0)
    cagr = float(eq[-1] ** (periods / n) - 1.0) if eq[-1] > 0 else -1.0
    ex = r - rf / periods
    sd = float(r.std(ddof=1))
    dd = r[r < 0]
    dsd = float(np.sqrt((np.minimum(r - rf / periods, 0.0) ** 2).mean())) if len(r) else 0.0
    mdd = max_drawdown(eq)
    return {"periods": n, "total_return": _f(total), "cagr": _f(cagr), "volatility_annual": _f(sd * math.sqrt(periods)),
            "sharpe": _f(ex.mean() / sd * math.sqrt(periods)) if sd > 0 else None, "sortino": _f(ex.mean() / dsd * math.sqrt(periods)) if dsd > 0 else None,
            "max_drawdown": _f(mdd), "calmar": _f(cagr / abs(mdd)) if mdd < 0 else None, "hit_rate": _f((r > 0).mean()),
            "best": _f(r.max()), "worst": _f(r.min()), "skew": _f(((r - r.mean()) ** 3).mean() / sd ** 3) if sd > 0 else None,
            "excess_kurtosis": _f(((r - r.mean()) ** 4).mean() / sd ** 4 - 3.0) if sd > 0 else None,
            "avg_loss": _f(dd.mean()) if len(dd) else None}


def _norm_ppf(p: float) -> float:
    """Acklam's rational approximation of the normal quantile (error ~1e-9), no scipy."""
    if not 0 < p < 1:
        raise FinanceError("probability must be strictly between 0 and 1")
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
    if p < 0.02425:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p > 1 - 0.02425:
        return -_norm_ppf(1 - p)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def value_at_risk(returns: np.ndarray, level: float = 0.95, method: str = "historical", horizon: int = 1) -> dict:
    """Loss not exceeded with probability `level` over `horizon` periods (positive numbers are losses), plus expected shortfall (the mean loss beyond VaR)."""
    r = np.asarray(returns, dtype=float)
    if len(r) < 20:
        raise FinanceError("VaR needs at least 20 returns")
    if not 0.5 < level < 1:
        raise FinanceError("level must be between 0.5 and 1")
    if method == "historical":
        var1 = -float(np.quantile(r, 1 - level))
        tail = r[r <= -var1]
        es1 = -float(tail.mean()) if len(tail) else var1
    elif method == "parametric":
        mu, sd = float(r.mean()), float(r.std(ddof=1))
        z = _norm_ppf(level)
        var1 = -(mu - z * sd)
        es1 = -(mu - sd * math.exp(-z * z / 2) / (math.sqrt(2 * math.pi) * (1 - level)))
    else:
        raise FinanceError("method is historical or parametric")
    s = math.sqrt(max(horizon, 1))
    out = {"level": level, "method": method, "horizon": horizon, "var": _f(var1 * s), "expected_shortfall": _f(es1 * s), "observations": len(r)}
    if len(r) < 250:
        out["warning"] = "fewer than 250 observations: the tail estimate is unreliable"
    return out


def correlation(matrix_returns: np.ndarray) -> np.ndarray:
    return np.corrcoef(matrix_returns, rowvar=False)


# ------------------------------------------------------------------ position sizing
def position_size(method: str, equity: float, entry: float, stop: float | None = None, risk_pct: float = 1.0, win_rate: float | None = None,
                  payoff: float | None = None, atr_value: float | None = None, atr_mult: float = 2.0, target_vol: float | None = None,
                  asset_vol: float | None = None, max_leverage: float = 1.0, lot: float = 1.0) -> dict:
    """How many units to buy. Every method is capped by max_leverage * equity and by the stop-risk budget, and rounds DOWN to the lot size."""
    if equity <= 0 or entry <= 0:
        raise FinanceError("equity and entry must be positive")
    if not 0 < risk_pct <= 5:
        raise FinanceError("risk_pct must be in (0, 5]: risking more than 5% of the account on one trade is refused")
    budget = equity * risk_pct / 100.0
    if method == "fixed_fractional":
        if stop is None or stop <= 0 or stop == entry:
            raise FinanceError("fixed_fractional needs a stop price different from the entry")
        units = budget / abs(entry - stop)
    elif method == "atr":
        if not atr_value or atr_value <= 0:
            raise FinanceError("atr sizing needs atr_value")
        units = budget / (atr_value * atr_mult)
        stop = entry - atr_value * atr_mult
    elif method == "kelly":
        if win_rate is None or payoff is None or not 0 < win_rate < 1 or payoff <= 0:
            raise FinanceError("kelly needs win_rate in (0,1) and payoff > 0")
        f = win_rate - (1 - win_rate) / payoff
        f = max(0.0, f) * 0.25                                     # quarter Kelly: full Kelly is far too aggressive for noisy estimates
        units = equity * min(f, risk_pct / 100.0 * 5) / entry
    elif method == "volatility_target":
        if target_vol is None or asset_vol is None or asset_vol <= 0 or target_vol <= 0:
            raise FinanceError("volatility_target needs target_vol and asset_vol (annual, e.g. 0.15)")
        units = equity * min(target_vol / asset_vol, max_leverage) / entry
    else:
        raise FinanceError("method is fixed_fractional, atr, kelly or volatility_target")
    cap = equity * max_leverage / entry
    capped = units > cap
    units = min(units, cap)
    units = math.floor(units / lot) * lot
    notional = units * entry
    risk = units * abs(entry - stop) if stop else None
    out = {"units": _f(units), "notional": _f(notional), "leverage": _f(notional / equity), "risk_amount": _f(risk) if risk is not None else None,
           "risk_pct_of_equity": _f(risk / equity * 100) if risk is not None else None, "capped_by_leverage": bool(capped)}
    if units <= 0:
        out["warning"] = "the size rounds to zero: the stop is too wide or the account too small for this lot size"
    return out


# ------------------------------------------------------------------ strategies and honest backtesting
STRATEGIES = ("buy_hold", "sma_cross", "ema_cross", "rsi_reversion", "bollinger_reversion", "breakout", "macd", "momentum", "trend_filter")


def _signal(name: str, data: dict[str, np.ndarray], p: dict) -> np.ndarray:
    """Desired position AT THE CLOSE of bar t, in {-1, 0, 1}. The backtest trades it on bar t+1, so no signal ever sees the future."""
    c, h, lo = data["close"], data["high"], data["low"]
    n = len(c)
    pos = np.zeros(n)
    if name == "buy_hold":
        pos[:] = 1.0
    elif name in ("sma_cross", "ema_cross"):
        f, s = int(p.get("fast", 20)), int(p.get("slow", 50))
        if f >= s:
            raise FinanceError("fast must be smaller than slow")
        fn = sma if name == "sma_cross" else ema
        a, b = fn(c, f), fn(c, s)
        pos = np.where(np.isnan(a) | np.isnan(b), 0.0, np.where(a > b, 1.0, -1.0))
    elif name == "rsi_reversion":
        r = rsi(c, int(p.get("n", 14)))
        lo_, hi_, cur = float(p.get("oversold", 30)), float(p.get("overbought", 70)), 0.0
        for i in range(n):
            if not np.isnan(r[i]):
                if r[i] < lo_:
                    cur = 1.0
                elif r[i] > hi_:
                    cur = -1.0
                elif (cur == 1.0 and r[i] > 50) or (cur == -1.0 and r[i] < 50):
                    cur = 0.0
            pos[i] = cur
    elif name == "bollinger_reversion":
        lw, md, up = bollinger(c, int(p.get("n", 20)), float(p.get("k", 2.0)))
        cur = 0.0
        for i in range(n):
            if not np.isnan(lw[i]):
                if c[i] < lw[i]:
                    cur = 1.0
                elif c[i] > up[i]:
                    cur = -1.0
                elif (cur == 1.0 and c[i] >= md[i]) or (cur == -1.0 and c[i] <= md[i]):
                    cur = 0.0
            pos[i] = cur
    elif name == "breakout":
        k = int(p.get("n", 20))
        hh, ll = donchian(h, lo, k)
        cur = 0.0
        for i in range(1, n):
            if not np.isnan(hh[i - 1]):
                if c[i] > hh[i - 1]:
                    cur = 1.0
                elif c[i] < ll[i - 1]:
                    cur = -1.0
            pos[i] = cur
    elif name == "macd":
        m_, sg, _ = macd(c, int(p.get("fast", 12)), int(p.get("slow", 26)), int(p.get("signal", 9)))
        pos = np.where(np.isnan(m_) | np.isnan(sg), 0.0, np.where(m_ > sg, 1.0, -1.0))
    elif name == "momentum":
        k = int(p.get("n", 60))
        m_ = roc(c, k)
        pos = np.where(np.isnan(m_), 0.0, np.where(m_ > 0, 1.0, -1.0))
    elif name == "trend_filter":                                  # long only while price is above its long average and the trend is strong enough
        a = sma(c, int(p.get("n", 200)))
        ax = adx(h, lo, c, 14)
        pos = np.where(np.isnan(a) | np.isnan(ax), 0.0, np.where((c > a) & (ax > float(p.get("min_adx", 20))), 1.0, 0.0))
    else:
        raise FinanceError(f"unknown strategy {name!r}; known: {', '.join(STRATEGIES)}")
    return pos


def backtest(data: dict[str, np.ndarray], strategy: str, params: dict | None = None, fee_bps: float = 5.0, slippage_bps: float = 2.0, allow_short: bool = False,
             stop_loss_pct: float | None = None, periods: int = TRADING_DAYS, rf: float = 0.0) -> dict:
    """Long/flat(/short) backtest. The position decided at the close of bar t is held over bar t+1 (no look-ahead); every change of position pays fee+slippage on the traded
    fraction; an optional stop loss exits intrabar at the stop (or at the open if it gapped past it). Returns the metrics, the trade list size and the equity curve tail."""
    params = params or {}
    if not 0 <= fee_bps <= 500 or not 0 <= slippage_bps <= 500:
        raise FinanceError("fee_bps and slippage_bps must be in [0, 500]")
    c, o, h, lo = data["close"], data["open"], data["high"], data["low"]
    n = len(c)
    if n < 30:
        raise FinanceError("need at least 30 bars to backtest")
    want = _signal(strategy, data, params)
    if not allow_short:
        want = np.maximum(want, 0.0)
    cost = (fee_bps + slippage_bps) / 10_000.0
    pos = np.zeros(n)                                             # position actually held DURING bar t
    ret = np.zeros(n)
    entry_price = np.nan
    trades = 0
    stopped = 0
    blocked = None                                                # after a stop-out, stay flat until the signal CHANGES
    for t in range(1, n):
        new = want[t - 1]                                          # decided at the previous close
        if blocked is not None:
            if new == blocked:
                new = 0.0
            else:
                blocked = None
        prev = pos[t - 1]
        turnover = abs(new - prev)
        pos[t] = new
        if turnover:
            trades += int(round(turnover))
            entry_price = o[t] if new != 0 else np.nan
            r = prev * (o[t] / c[t - 1] - 1.0) + new * (c[t] / o[t] - 1.0) - cost * turnover   # exit at the open, enter at the open
        else:
            r = new * (c[t] / c[t - 1] - 1.0)
        if stop_loss_pct and pos[t] != 0 and not np.isnan(entry_price):
            sp = entry_price * (1 - pos[t] * stop_loss_pct / 100.0)
            hit = (pos[t] > 0 and lo[t] <= sp) or (pos[t] < 0 and h[t] >= sp)
            if hit:
                fill = min(o[t], sp) if pos[t] > 0 else max(o[t], sp)         # a gap through the stop fills at the open, not at the stop
                base = o[t] if turnover else c[t - 1]
                r = (prev * (o[t] / c[t - 1] - 1.0) if turnover else 0.0) + pos[t] * (fill / base - 1.0) - cost * turnover - cost
                blocked = new
                pos[t] = 0.0
                entry_price = np.nan
                stopped += 1
        ret[t] = r
    strat = ret[1:]
    bench = returns_from_prices(c)
    res = performance(strat, periods, rf)
    res["strategy"], res["params"] = strategy, params
    res["trades"] = trades
    res["stops_hit"] = stopped
    res["exposure"] = _f((pos != 0).mean())
    res["benchmark_buy_hold"] = {k: performance(bench, periods, rf)[k] for k in ("total_return", "cagr", "sharpe", "max_drawdown")}
    res["costs_bps_per_side"] = fee_bps + slippage_bps
    eq = np.cumprod(1.0 + strat)
    res["equity_tail"] = [round(float(x), 4) for x in eq[-20:]]
    warns = []
    if trades < 30:
        warns.append(f"only {trades} trades: the result is statistically weak")
    if n < 500:
        warns.append("fewer than 500 bars: not enough history to trust a backtest")
    if res["sharpe"] and res["sharpe"] > 3:
        warns.append("Sharpe above 3 is almost always a bug or an overfit: check for look-ahead, costs and survivorship")
    res["warnings"] = warns
    res["note"] = DISCLAIMER
    res["_returns"] = strat
    return res


def backtest_split(data: dict[str, np.ndarray], strategy: str, params: dict | None = None, train_frac: float = 0.7, **kw) -> dict:
    """In-sample vs out-of-sample on one split. The out-of-sample half is what counts; a large gap means the idea (or its parameters) was fitted to the past."""
    n = len(data["close"])
    cut = int(n * train_frac)
    if cut < 60 or n - cut < 60:
        raise FinanceError("each part needs at least 60 bars")
    part = lambda a, b: {k: v[a:b] for k, v in data.items()}  # noqa: E731
    a, b = backtest(part(0, cut), strategy, params, **kw), backtest(part(cut, n), strategy, params, **kw)
    for r in (a, b):
        r.pop("_returns", None)
    sa, sb = a["sharpe"] or 0.0, b["sharpe"] or 0.0
    out = {"in_sample": a, "out_of_sample": b, "sharpe_ratio_oos_over_is": _f(sb / sa) if sa > 0 else None}
    if sa > 0 and sb < 0.5 * sa:
        out["verdict"] = "likely overfit: the out-of-sample Sharpe is less than half the in-sample one"
    elif sb <= 0:
        out["verdict"] = "no edge out of sample"
    else:
        out["verdict"] = "holds out of sample on this split (still one split: run walk_forward before trusting it)"
    return out


def walk_forward(data: dict[str, np.ndarray], strategy: str, grid: dict[str, list], train_bars: int = 500, test_bars: int = 125, **kw) -> dict:
    """Re-fit the parameters on each training window (best Sharpe over the grid), then trade the NEXT unseen window with them. The stitched out-of-sample curve is the honest result."""
    n = len(data["close"])
    if n < train_bars + test_bars:
        raise FinanceError("not enough bars for one walk-forward step")
    keys = sorted(grid)
    combos: list[dict] = [{}]
    for k in keys:
        combos = [{**c, k: v} for c in combos for v in grid[k]]
    if not 1 <= len(combos) <= 200:
        raise FinanceError("the grid has 1 to 200 combinations")
    part = lambda a, b: {k: v[a:b] for k, v in data.items()}  # noqa: E731
    oos: list[np.ndarray] = []
    steps = []
    start = 0
    while start + train_bars + test_bars <= n:
        tr, te = part(start, start + train_bars), part(start + train_bars, start + train_bars + test_bars)
        best, best_s = None, -1e9
        for pm in combos:
            try:
                s = backtest(tr, strategy, pm, **kw)["sharpe"]
            except FinanceError:
                continue
            if s is not None and s > best_s:
                best, best_s = pm, s
        if best is None:
            start += test_bars
            continue
        r = backtest(te, strategy, best, **kw)
        oos.append(r["_returns"])
        steps.append({"train_from": start, "params": best, "train_sharpe": _f(best_s), "test_sharpe": r["sharpe"], "test_return": r["total_return"]})
        start += test_bars
    if not oos:
        raise FinanceError("no walk-forward step could be run")
    allr = np.concatenate(oos)
    res = performance(allr, kw.get("periods", TRADING_DAYS), kw.get("rf", 0.0))
    res["steps"] = steps
    res["combinations_tested_per_step"] = len(combos)
    res["note"] = "out-of-sample only. " + DISCLAIMER
    return res


def monte_carlo(returns: np.ndarray, horizon: int = 252, paths: int = 2000, ruin_drawdown: float = 0.3, seed: int = 0, block: int = 5) -> dict:
    """Block-bootstrap the strategy's own returns to see the RANGE of outcomes (not a forecast): percentiles of the final equity, of the worst drawdown, and the chance of a ruin drawdown."""
    r = np.asarray(returns, dtype=float)
    if len(r) < 30:
        raise FinanceError("need at least 30 returns")
    if not 1 <= paths <= 20_000 or not 1 <= horizon <= 5_000:
        raise FinanceError("paths 1..20000, horizon 1..5000")
    rng = np.random.default_rng(seed)
    nb = math.ceil(horizon / block)
    starts = rng.integers(0, len(r) - block + 1, size=(paths, nb))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(paths, -1)[:, :horizon]
    sim = r[idx]
    eq = np.cumprod(1.0 + sim, axis=1)
    peak = np.maximum.accumulate(eq, axis=1)
    mdd = ((eq - peak) / peak).min(axis=1)
    fin = eq[:, -1] - 1.0
    q = lambda a, p: _f(np.quantile(a, p))  # noqa: E731
    return {"paths": paths, "horizon": horizon, "final_return": {"p5": q(fin, .05), "p25": q(fin, .25), "median": q(fin, .5), "p75": q(fin, .75), "p95": q(fin, .95)},
            "max_drawdown": {"median": q(mdd, .5), "p5_worst": q(mdd, .05)}, "prob_loss": _f((fin < 0).mean()), "prob_ruin": _f((mdd <= -abs(ruin_drawdown)).mean()),
            "ruin_drawdown": abs(ruin_drawdown), "note": "a range of outcomes under the assumption that the future resembles the past; " + DISCLAIMER}


# ------------------------------------------------------------------ portfolio
def _project_simplex(v: np.ndarray) -> np.ndarray:
    u = np.sort(v)[::-1]
    css = np.cumsum(u)
    k = np.nonzero(u * np.arange(1, len(v) + 1) > (css - 1))[0][-1]
    return np.maximum(v - (css[k] - 1) / (k + 1), 0.0)


def portfolio_weights(returns: np.ndarray, method: str = "risk_parity", periods: int = TRADING_DAYS, max_weight: float = 1.0, seed: int = 0) -> dict:
    """Long-only weights summing to 1 from a (T x N) matrix of returns."""
    R = np.asarray(returns, dtype=float)
    if R.ndim != 2 or R.shape[1] < 2 or R.shape[0] < 30:
        raise FinanceError("need a (T>=30) x (N>=2) matrix of returns")
    N = R.shape[1]
    if not 1.0 / N <= max_weight <= 1.0:
        raise FinanceError("max_weight must be between 1/N and 1")
    mu, cov = R.mean(axis=0) * periods, np.cov(R, rowvar=False) * periods
    vol = np.sqrt(np.diag(cov))

    def clip(w):
        w = np.maximum(w, 0.0)
        for _ in range(50):
            w = w / w.sum()
            over = w > max_weight + 1e-12
            if not over.any():
                break
            ex = (w[over] - max_weight).sum()
            w[over] = max_weight
            free = ~over
            if not free.any() or w[free].sum() == 0:
                break
            w[free] += ex * w[free] / w[free].sum()
        return w / w.sum()
    if method == "equal":
        w = np.ones(N) / N
    elif method == "inverse_vol":
        w = 1.0 / vol
    elif method == "min_variance":
        step = 1.0 / (2.0 * float(np.linalg.eigvalsh(cov).max()) + 1e-12)
        w = np.ones(N) / N
        for _ in range(5000):                                       # projected gradient descent on the long-only simplex
            w = _project_simplex(w - step * 2.0 * (cov @ w))
    elif method == "risk_parity":
        w = 1.0 / vol
        w /= w.sum()
        for _ in range(500):
            rc = w * (cov @ w)
            w = w * (rc.mean() / rc) ** 0.5
            w /= w.sum()
    elif method == "max_sharpe":
        rng = np.random.default_rng(seed)
        best, best_s = np.ones(N) / N, -1e9
        for cand in np.vstack([np.ones(N) / N, rng.dirichlet(np.ones(N), size=4000)]):
            cand = clip(cand.copy())
            s = (cand @ mu) / math.sqrt(cand @ cov @ cand)
            if s > best_s:
                best, best_s = cand, s
        w = best
    else:
        raise FinanceError("method is equal, inverse_vol, min_variance, risk_parity or max_sharpe")
    w = clip(np.asarray(w, dtype=float))
    risk = float(math.sqrt(w @ cov @ w))
    rc = w * (cov @ w) / (risk ** 2) if risk > 0 else np.zeros(N)
    out = {"method": method, "weights": [_f(x) for x in w], "expected_return_annual": _f(w @ mu), "volatility_annual": _f(risk),
           "sharpe": _f((w @ mu) / risk) if risk > 0 else None, "risk_contribution": [_f(x) for x in rc],
           "diversification_ratio": _f((w @ vol) / risk) if risk > 0 else None}
    if method == "max_sharpe":
        out["warning"] = "mean returns are the least reliable input: treat max_sharpe weights as fragile and prefer risk_parity or min_variance"
    return out


# ------------------------------------------------------------------ derivatives, bonds, time value
def black_scholes(spot: float, strike: float, t: float, rate: float, vol: float, kind: str = "call", div: float = 0.0) -> dict:
    if min(spot, strike, t, vol) <= 0:
        raise FinanceError("spot, strike, t (years) and vol must be positive")
    if kind not in ("call", "put"):
        raise FinanceError("kind is call or put")
    sq = vol * math.sqrt(t)
    d1 = (math.log(spot / strike) + (rate - div + 0.5 * vol * vol) * t) / sq
    d2 = d1 - sq
    pdf = math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
    disc_s, disc_k = spot * math.exp(-div * t), strike * math.exp(-rate * t)
    if kind == "call":
        price, delta = disc_s * _norm_cdf(d1) - disc_k * _norm_cdf(d2), math.exp(-div * t) * _norm_cdf(d1)
        theta = (-disc_s * pdf * vol / (2 * math.sqrt(t)) - rate * disc_k * _norm_cdf(d2) + div * disc_s * _norm_cdf(d1)) / 365.0
        rho = strike * t * math.exp(-rate * t) * _norm_cdf(d2) / 100.0
    else:
        price, delta = disc_k * _norm_cdf(-d2) - disc_s * _norm_cdf(-d1), -math.exp(-div * t) * _norm_cdf(-d1)
        theta = (-disc_s * pdf * vol / (2 * math.sqrt(t)) + rate * disc_k * _norm_cdf(-d2) - div * disc_s * _norm_cdf(-d1)) / 365.0
        rho = -strike * t * math.exp(-rate * t) * _norm_cdf(-d2) / 100.0
    return {"price": _f(price), "delta": _f(delta), "gamma": _f(math.exp(-div * t) * pdf / (spot * sq)), "vega_per_1pct": _f(disc_s * pdf * math.sqrt(t) / 100.0),
            "theta_per_day": _f(theta), "rho_per_1pct": _f(rho), "d1": _f(d1), "d2": _f(d2), "model": "Black-Scholes (European, constant volatility)"}


def implied_vol(price: float, spot: float, strike: float, t: float, rate: float, kind: str = "call", div: float = 0.0) -> dict:
    lo_, hi_ = 1e-4, 5.0
    f = lambda v: black_scholes(spot, strike, t, rate, v, kind, div)["price"] - price  # noqa: E731
    if f(lo_) > 0 or f(hi_) < 0:
        raise FinanceError("the price is outside the range Black-Scholes can produce (arbitrage bounds): no implied volatility")
    for _ in range(200):
        mid = 0.5 * (lo_ + hi_)
        if f(mid) > 0:
            hi_ = mid
        else:
            lo_ = mid
        if hi_ - lo_ < 1e-9:
            break
    return {"implied_vol": _f(0.5 * (lo_ + hi_))}


def bond(face: float, coupon_rate: float, years: float, freq: int = 2, ytm: float | None = None, price: float | None = None) -> dict:
    """Price from yield, or yield from price; Macaulay and modified duration, convexity."""
    if face <= 0 or years <= 0 or freq not in (1, 2, 4, 12) or coupon_rate < 0:
        raise FinanceError("face>0, years>0, coupon>=0, freq in 1,2,4,12")
    n = int(round(years * freq))
    cf = np.full(n, face * coupon_rate / freq)
    cf[-1] += face
    tt = np.arange(1, n + 1) / freq

    def px(y):
        return float((cf / (1 + y / freq) ** (tt * freq)).sum())
    if (ytm is None) == (price is None):
        raise FinanceError("give exactly one of ytm or price")
    if ytm is None:
        lo_, hi_ = -0.5, 5.0
        if not px(hi_) <= price <= px(lo_):
            raise FinanceError("the price is outside the possible range")
        for _ in range(200):
            mid = 0.5 * (lo_ + hi_)
            if px(mid) > price:
                lo_ = mid
            else:
                hi_ = mid
        ytm = 0.5 * (lo_ + hi_)
    p = px(ytm)
    pv = cf / (1 + ytm / freq) ** (tt * freq)
    mac = float((tt * pv).sum() / p)
    conv = float((pv * tt * (tt + 1 / freq)).sum() / (p * (1 + ytm / freq) ** 2))
    return {"price": _f(p), "ytm": _f(ytm), "macaulay_duration": _f(mac), "modified_duration": _f(mac / (1 + ytm / freq)), "convexity": _f(conv),
            "current_yield": _f(face * coupon_rate / p)}


def npv_irr(cashflows: list, rate: float | None = None) -> dict:
    cf = np.array(cashflows, dtype=float)
    if len(cf) < 2 or not (cf < 0).any() or not (cf > 0).any():
        raise FinanceError("need at least one outflow and one inflow")
    out: dict = {}
    if rate is not None:
        out["npv"] = _f((cf / (1 + rate) ** np.arange(len(cf))).sum())
    f = lambda r: (cf / (1 + r) ** np.arange(len(cf))).sum()  # noqa: E731
    lo_, hi_ = -0.99, 10.0
    if f(lo_) * f(hi_) < 0:
        for _ in range(300):
            mid = 0.5 * (lo_ + hi_)
            if f(lo_) * f(mid) <= 0:
                hi_ = mid
            else:
                lo_ = mid
        out["irr"] = _f(0.5 * (lo_ + hi_))
    else:
        out["irr"] = None
        out["warning"] = "no single IRR in (-99%, 1000%)"
    return out


def loan(principal: float, annual_rate: float, years: float, freq: int = 12) -> dict:
    if principal <= 0 or years <= 0 or annual_rate < 0:
        raise FinanceError("principal>0, years>0, rate>=0")
    n, i = int(round(years * freq)), annual_rate / freq
    pay = principal / n if i == 0 else principal * i / (1 - (1 + i) ** -n)
    bal, interest = principal, 0.0
    first = []
    for k in range(1, n + 1):
        it = bal * i
        interest += it
        bal -= pay - it
        if k <= 3:
            first.append({"period": k, "payment": _f(pay), "interest": _f(it), "principal": _f(pay - it), "balance": _f(max(bal, 0))})
    return {"payment": _f(pay), "periods": n, "total_paid": _f(pay * n), "total_interest": _f(interest), "first_periods": first}


# ------------------------------------------------------------------ risk limits, paper broker, live gate
@dataclass
class RiskLimits:
    """Hard limits. They live in a file the OWNER edits; the model can read them and cannot change them (the file is protected by governance)."""
    live_trading_enabled: bool = False          # OFF until the owner turns it on
    max_order_notional: float = 1_000.0
    max_position_pct: float = 10.0              # of equity in one symbol
    max_gross_exposure_pct: float = 100.0
    max_daily_loss_pct: float = 2.0
    max_drawdown_pct: float = 10.0
    max_orders_per_day: int = 20
    max_price_deviation_pct: float = 5.0        # fat-finger check against the last known price
    require_stop_loss: bool = True
    allowed_symbols: list = field(default_factory=list)      # empty = none allowed: the owner lists what may be traded
    min_seconds_between_orders: float = 5.0

    @staticmethod
    def load(path: str | Path) -> "RiskLimits":
        p = Path(path)
        if not p.exists():
            return RiskLimits()
        raw = json.loads(p.read_text(encoding="utf-8"))
        known = {k: v for k, v in raw.items() if k in RiskLimits.__dataclass_fields__}
        return RiskLimits(**known)

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")


@dataclass
class Order:
    symbol: str
    side: str                                  # buy | sell
    qty: float
    price: float                               # the reference price (limit, or the last price for a market order)
    stop_loss: float | None = None
    kind: str = "market"                       # market | limit


@dataclass
class AccountState:
    equity: float
    start_of_day_equity: float
    peak_equity: float
    positions: dict = field(default_factory=dict)            # symbol -> signed qty
    last_prices: dict = field(default_factory=dict)
    orders_today: int = 0
    last_order_time: float = 0.0


def confirmation_phrase(o: Order) -> str:
    """The exact text a person must type for a real order: it names the action, the size and the symbol, so a reflex 'yes' cannot send it."""
    return f"{o.side.upper()} {o.qty:g} {o.symbol.upper()}"


def check_order(o: Order, lim: RiskLimits, st: AccountState, live: bool, typed: str = "", stop: EmergencyStop | None = None, now: float | None = None) -> tuple[bool, list[str]]:
    """Every rule that applies, all reported (not just the first). Paper orders skip the live-only rules (typed confirmation, enabled flag, symbol list, rate)."""
    now = time.time() if now is None else now
    why: list[str] = []
    sym = o.symbol.upper()
    if o.side not in ("buy", "sell"):
        why.append("side is buy or sell")
    if not (o.qty > 0 and math.isfinite(o.qty)) or not (o.price > 0 and math.isfinite(o.price)):
        why.append("quantity and price must be positive numbers")
        return False, why
    if stop is not None and stop.engaged():
        why.append("the emergency stop is engaged")
    notional = o.qty * o.price
    cur = st.positions.get(sym, 0.0)
    signed = o.qty if o.side == "buy" else -o.qty
    reducing = (cur > 0 and signed < 0 and abs(signed) <= abs(cur)) or (cur < 0 and signed > 0 and abs(signed) <= abs(cur))
    if live:
        if not lim.live_trading_enabled:
            why.append("live trading is switched off in the owner's limits")
        if not lim.allowed_symbols or sym not in [s.upper() for s in lim.allowed_symbols]:
            why.append(f"{sym} is not on the owner's list of tradable symbols")
        if typed.strip() != confirmation_phrase(o):
            why.append(f"typed confirmation must be exactly: {confirmation_phrase(o)}")
        if st.orders_today >= lim.max_orders_per_day:
            why.append("daily order count reached")
        if now - st.last_order_time < lim.min_seconds_between_orders:
            why.append("orders are too close together")
    if notional > lim.max_order_notional:
        why.append(f"order value {notional:.2f} exceeds the per-order limit {lim.max_order_notional:.2f}")
    last = st.last_prices.get(sym)
    if last and abs(o.price / last - 1) * 100 > lim.max_price_deviation_pct:
        why.append(f"price is {abs(o.price / last - 1) * 100:.1f}% away from the last price (limit {lim.max_price_deviation_pct}%): looks like a typo")
    if not reducing:
        if lim.require_stop_loss and o.stop_loss is None:
            why.append("an opening order needs a stop loss")
        elif o.stop_loss is not None and ((o.side == "buy" and o.stop_loss >= o.price) or (o.side == "sell" and o.stop_loss <= o.price)):
            why.append("the stop loss is on the wrong side of the price")
        if st.equity <= 0:
            why.append("no equity")
        else:
            newpos = abs(cur + signed) * o.price
            if newpos / st.equity * 100 > lim.max_position_pct:
                why.append(f"position would be {newpos / st.equity * 100:.1f}% of equity (limit {lim.max_position_pct}%)")
            gross = sum(abs(q) * st.last_prices.get(s, o.price) for s, q in st.positions.items() if s != sym) + newpos
            if gross / st.equity * 100 > lim.max_gross_exposure_pct:
                why.append(f"gross exposure would be {gross / st.equity * 100:.1f}% (limit {lim.max_gross_exposure_pct}%)")
        if st.start_of_day_equity > 0 and (st.start_of_day_equity - st.equity) / st.start_of_day_equity * 100 >= lim.max_daily_loss_pct:
            why.append("the daily loss limit is reached: no new positions today")
        if st.peak_equity > 0 and (st.peak_equity - st.equity) / st.peak_equity * 100 >= lim.max_drawdown_pct:
            why.append("the drawdown limit is reached: no new positions until the owner reviews")
    return not why, why


class PaperBroker:
    """A simulated account with the same risk rules as a live one: the place to run a strategy before any real money. State is a JSON file in the workspace; every fill is also
    written to a hash-chained audit log."""

    def __init__(self, path: str | Path, cash: float = 10_000.0, limits: RiskLimits | None = None, audit: AuditLog | None = None, fee_bps: float = 5.0, slippage_bps: float = 2.0) -> None:
        self.path = Path(path)
        self.limits = limits or RiskLimits(allowed_symbols=[], live_trading_enabled=False)
        self.audit = audit
        self.fee, self.slip = fee_bps / 10_000.0, slippage_bps / 10_000.0
        if self.path.exists():
            self.s = json.loads(self.path.read_text(encoding="utf-8"))
        else:
            self.s = {"cash": float(cash), "positions": {}, "avg": {}, "prices": {}, "peak": float(cash), "sod": float(cash), "orders_today": 0, "fills": [], "realized": 0.0}
            self._save()

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.s, indent=1), encoding="utf-8")

    def equity(self) -> float:
        return self.s["cash"] + sum(q * self.s["prices"].get(sym, self.s["avg"].get(sym, 0.0)) for sym, q in self.s["positions"].items())

    def mark(self, prices: dict[str, float]) -> dict:
        for k, v in prices.items():
            if not (v > 0 and math.isfinite(v)):
                raise FinanceError(f"bad price for {k}")
            self.s["prices"][k.upper()] = float(v)
        eq = self.equity()
        self.s["peak"] = max(self.s["peak"], eq)
        self._save()
        return self.summary()

    def new_day(self) -> None:
        self.s["sod"], self.s["orders_today"] = self.equity(), 0
        self._save()

    def state(self) -> AccountState:
        return AccountState(self.equity(), self.s["sod"], self.s["peak"], dict(self.s["positions"]), dict(self.s["prices"]), self.s["orders_today"], 0.0)

    def order(self, o: Order, stop: EmergencyStop | None = None) -> dict:
        o.symbol = o.symbol.upper()
        ok, why = check_order(o, self.limits, self.state(), live=False, stop=stop)
        if not ok:
            if self.audit:
                self.audit.append("paper_order_rejected", order=asdict(o), reasons=why)
            return {"filled": False, "reasons": why}
        px = o.price * (1 + self.slip) if o.side == "buy" else o.price * (1 - self.slip)
        fee = abs(o.qty * px) * self.fee
        cur = self.s["positions"].get(o.symbol, 0.0)
        if o.side == "sell":
            if o.qty > cur + 1e-12:
                return {"filled": False, "reasons": ["the paper account does not short: sell at most the position"]}
            self.s["realized"] += o.qty * (px - self.s["avg"][o.symbol]) - fee
            new = cur - o.qty
            self.s["cash"] += o.qty * px - fee
            if new <= 1e-12:
                self.s["positions"].pop(o.symbol, None)
                self.s["avg"].pop(o.symbol, None)
            else:
                self.s["positions"][o.symbol] = new
        else:
            if o.qty * px + fee > self.s["cash"] + 1e-9:
                return {"filled": False, "reasons": ["not enough cash"]}
            self.s["avg"][o.symbol] = (self.s["avg"].get(o.symbol, px) * cur + px * o.qty) / (cur + o.qty)
            self.s["positions"][o.symbol] = cur + o.qty
            self.s["cash"] -= o.qty * px + fee
        self.s["prices"][o.symbol] = o.price
        self.s["orders_today"] += 1
        fill = {"symbol": o.symbol, "side": o.side, "qty": o.qty, "price": round(px, 6), "fee": round(fee, 6), "stop_loss": o.stop_loss}
        self.s["fills"].append(fill)
        self.s["peak"] = max(self.s["peak"], self.equity())
        self._save()
        if self.audit:
            self.audit.append("paper_fill", **fill)
        return {"filled": True, "fill": fill, **self.summary()}

    def summary(self) -> dict:
        eq = self.equity()
        return {"cash": _f(self.s["cash"]), "equity": _f(eq), "positions": {k: _f(v) for k, v in self.s["positions"].items()}, "realized_pnl": _f(self.s["realized"]),
                "drawdown_from_peak": _f((eq - self.s["peak"]) / self.s["peak"]) if self.s["peak"] else 0.0, "fills": len(self.s["fills"]), "mode": "paper (simulated, no real money)"}


# ------------------------------------------------------------------ the dispatcher for the `finance` tool group
def _cols(path: str, ws_root: Path) -> dict[str, np.ndarray]:
    p = (ws_root / path).resolve()
    if p != ws_root and ws_root not in p.parents:
        raise FinanceError("path leaves the workspace")
    return load_ohlcv(p)


def _matrix(paths: list, ws_root: Path) -> tuple[np.ndarray, list[str]]:
    series = [returns_from_prices(_cols(p, ws_root)["close"]) for p in paths]
    n = min(len(s) for s in series)
    return np.column_stack([s[-n:] for s in series]), [Path(p).stem for p in paths]


def run_finance_tool(root: str | Path, name: str, a: dict, audit: AuditLog | None = None, stop: EmergencyStop | None = None, limits_path: str = "finance/limits.json") -> tuple[bool, str]:
    """Run one `finance` tool (already validated). Returns (ok, text). A bad file or argument is a clear failure, never a crash. `trade_live_*` tools only CHECK the order here and
    return the exact connector call to make: the gate is code, the broker connection is the owner's connector."""
    ws = Path(root).resolve()
    try:
        if name == "fin_indicators":
            d = _cols(a["path"], ws)
            tail = int(a.get("tail", 30))
            vals = indicators(d, a["indicators"])
            return True, json.dumps({"rows": len(d["close"]), "last_date": str(d["date"][-1]), "tail": {k: v[-tail:] for k, v in vals.items()}})
        if name == "fin_stats":
            d = _cols(a["path"], ws)
            return True, json.dumps(performance(returns_from_prices(d["close"]), int(a.get("periods", TRADING_DAYS)), float(a.get("risk_free", 0.0))))
        if name == "fin_risk":
            d = _cols(a["path"], ws)
            return True, json.dumps(value_at_risk(returns_from_prices(d["close"]), float(a.get("level", 0.95)), a.get("method", "historical"), int(a.get("horizon", 1))))
        if name == "fin_size":
            kw = {k: a[k] for k in ("stop", "risk_pct", "win_rate", "payoff", "atr_value", "atr_mult", "target_vol", "asset_vol", "max_leverage", "lot") if k in a}
            return True, json.dumps(position_size(a["method"], float(a["equity"]), float(a["entry"]), **kw))
        if name in ("fin_backtest", "fin_backtest_split"):
            d = _cols(a["path"], ws)
            kw = {k: a[k] for k in ("fee_bps", "slippage_bps", "allow_short", "stop_loss_pct") if k in a}
            if name == "fin_backtest":
                r = backtest(d, a["strategy"], a.get("params"), **kw)
                r.pop("_returns")
                return True, json.dumps(r)
            return True, json.dumps(backtest_split(d, a["strategy"], a.get("params"), float(a.get("train_frac", 0.7)), **kw))
        if name == "fin_walk_forward":
            d = _cols(a["path"], ws)
            kw = {k: a[k] for k in ("fee_bps", "slippage_bps", "allow_short", "stop_loss_pct") if k in a}
            return True, json.dumps(walk_forward(d, a["strategy"], a["grid"], int(a.get("train_bars", 500)), int(a.get("test_bars", 125)), **kw))
        if name == "fin_montecarlo":
            d = _cols(a["path"], ws)
            if a.get("strategy"):
                r = backtest(d, a["strategy"], a.get("params"))["_returns"]
            else:
                r = returns_from_prices(d["close"])
            return True, json.dumps(monte_carlo(r, int(a.get("horizon", 252)), int(a.get("paths", 2000)), float(a.get("ruin_drawdown", 0.3)), int(a.get("seed", 0))))
        if name == "fin_portfolio":
            R, names = _matrix(a["paths"], ws)
            r = portfolio_weights(R, a.get("method", "risk_parity"), int(a.get("periods", TRADING_DAYS)), float(a.get("max_weight", 1.0)))
            r["assets"] = names
            r["correlation"] = [[_f(x) for x in row] for row in correlation(R)]
            return True, json.dumps(r)
        if name == "fin_option":
            if a.get("price") is not None:
                return True, json.dumps(implied_vol(float(a["price"]), float(a["spot"]), float(a["strike"]), float(a["t"]), float(a.get("rate", 0.0)), a.get("kind", "call"), float(a.get("div", 0.0))))
            return True, json.dumps(black_scholes(float(a["spot"]), float(a["strike"]), float(a["t"]), float(a.get("rate", 0.0)), float(a["vol"]), a.get("kind", "call"), float(a.get("div", 0.0))))
        if name == "fin_bond":
            return True, json.dumps(bond(float(a["face"]), float(a["coupon_rate"]), float(a["years"]), int(a.get("freq", 2)), a.get("ytm"), a.get("price")))
        if name == "fin_cashflow":
            if a["op"] == "loan":
                return True, json.dumps(loan(float(a["principal"]), float(a["rate"]), float(a["years"]), int(a.get("freq", 12))))
            return True, json.dumps(npv_irr(a["cashflows"], a.get("rate")))
        if name in ("paper_account", "paper_order"):
            lim = RiskLimits.load(ws / limits_path)
            lim.live_trading_enabled = False
            lim.allowed_symbols = []
            br = PaperBroker(ws / a.get("account", "finance/paper.json"), float(a.get("cash", 10_000.0)), lim, audit)
            if name == "paper_account":
                act = a.get("action", "summary")
                if act == "mark":
                    return True, json.dumps(br.mark(a["prices"]))
                if act == "new_day":
                    br.new_day()
                return True, json.dumps(br.summary())
            o = Order(str(a["symbol"]), a["side"], float(a["qty"]), float(a["price"]), a.get("stop_loss"))
            return True, json.dumps(br.order(o, stop))
        if name in ("trade_live_check", "trade_live_order"):
            lim = RiskLimits.load(ws / limits_path)
            acct = a["account_state"]
            st = AccountState(float(acct["equity"]), float(acct.get("start_of_day_equity", acct["equity"])), float(acct.get("peak_equity", acct["equity"])), {k.upper(): float(v) for k, v in acct.get("positions", {}).items()},
                              {k.upper(): float(v) for k, v in acct.get("last_prices", {}).items()}, int(acct.get("orders_today", 0)), float(acct.get("last_order_time", 0.0)))
            o = Order(str(a["symbol"]), a["side"], float(a["qty"]), float(a["price"]), a.get("stop_loss"))
            ok, why = check_order(o, lim, st, live=True, typed=a.get("confirmation", ""), stop=stop)
            if audit:
                audit.append("live_order_check", order=asdict(o), allowed=ok, reasons=why)
            if not ok:
                return False, json.dumps({"allowed": False, "reasons": why, "confirmation_needed": confirmation_phrase(o)})
            return True, json.dumps({"allowed": True, "next": "send this order with the owner's broker connector (mcp_call); report the broker's reply verbatim", "order": asdict(o)})
        return False, f"{name} is not a finance tool"
    except FinanceError as exc:
        return False, str(exc)
    except (KeyError, IndexError, ValueError, TypeError, json.JSONDecodeError, OSError) as exc:
        return False, f"{type(exc).__name__}: {str(exc)[:300]}"
