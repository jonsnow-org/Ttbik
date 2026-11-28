import json
import math

import numpy as np
import pytest

from qalam import finance as F
from qalam import governance, tools
from qalam.audit import AuditLog, EmergencyStop
from qalam.finance import AccountState, FinanceError, Order, PaperBroker, RiskLimits


def synth(n=900, seed=1, drift=0.0004, vol=0.012, start=100.0):
    rng = np.random.default_rng(seed)
    r = rng.normal(drift, vol, n)
    c = start * np.cumprod(1 + r)
    o = np.concatenate([[start], c[:-1]]) * (1 + rng.normal(0, 0.002, n))
    h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.003, n)))
    lo = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.003, n)))
    return {"date": np.array([f"{i:05d}" for i in range(n)], dtype=object), "open": o, "high": h, "low": lo, "close": c, "volume": rng.uniform(1e5, 2e5, n)}


def write_csv(path, d):
    with open(path, "w") as f:
        f.write("date,open,high,low,close,volume\n")
        for i in range(len(d["close"])):
            f.write(f"{d['date'][i]},{d['open'][i]},{d['high'][i]},{d['low'][i]},{d['close'][i]},{d['volume'][i]}\n")


def test_indicators_known_values():
    x = np.arange(1.0, 11.0)
    assert F.sma(x, 3)[2] == 2.0 and np.isnan(F.sma(x, 3)[1])
    assert F.rsi(np.arange(1.0, 40.0), 14)[-1] == 100.0                  # only gains
    assert F.rsi(np.arange(40.0, 1.0, -1.0), 14)[-1] == 0.0              # only losses
    e = F.ema(x, 3)
    assert e[2] == 2.0 and abs(e[3] - (0.5 * 4 + 0.5 * 2)) < 1e-12
    lw, md, up = F.bollinger(np.full(30, 5.0), 20)
    assert lw[-1] == md[-1] == up[-1] == 5.0
    d = synth(300)
    for nm in F.INDICATORS:
        out = F.indicators(d, [nm])
        assert out and all(len(v) == 300 for v in out.values())


def test_indicator_is_causal():
    d = synth(300)
    full = F.indicators(d, ["rsi", "macd", "atr", "adx", "stochastic"])
    cut = {k: v[:200] for k, v in d.items()}
    part = F.indicators(cut, ["rsi", "macd", "atr", "adx", "stochastic"])
    for k in part:
        assert full[k][:200] == part[k], k                                # tomorrow never changes yesterday's value


def test_loader_rejects_bad_data(tmp_path):
    p = tmp_path / "a.csv"
    p.write_text("date,close\n1,10\n2,abc\n")
    with pytest.raises(FinanceError, match="not a number"):
        F.load_ohlcv(p)
    p.write_text("date,close\n1,10\n2,-5\n")
    with pytest.raises(FinanceError, match="positive"):
        F.load_ohlcv(p)
    p.write_text("date,open,high,low,close\n1,10,9,11,10\n2,10,11,9,10\n")
    with pytest.raises(FinanceError, match="impossible"):
        F.load_ohlcv(p)
    p.write_text("date,price\n2,12\n1,10\n")
    assert list(F.load_ohlcv(p)["close"]) == [10.0, 12.0]               # sorted by date, `price` accepted


def test_performance_and_drawdown():
    r = np.array([0.1, -0.1, 0.05, 0.02, -0.03] * 50)
    p = F.performance(r)
    assert p["max_drawdown"] < 0 and p["sharpe"] is not None
    assert F.max_drawdown(np.array([100, 120, 60, 90.0])) == -0.5
    assert F.performance(np.full(50, 0.001))["sharpe"] is None           # zero volatility: no fake infinite Sharpe


def test_var_matches_normal_theory():
    rng = np.random.default_rng(0)
    r = rng.normal(0, 0.01, 200_000)
    v = F.value_at_risk(r, 0.99, "parametric")
    assert abs(v["var"] - 2.3263 * 0.01) < 5e-4 and v["expected_shortfall"] > v["var"]
    h = F.value_at_risk(r, 0.99, "historical")
    assert abs(h["var"] - v["var"]) < 1e-3
    assert abs(F._norm_ppf(0.975) - 1.959964) < 1e-5
    with pytest.raises(FinanceError):
        F.value_at_risk(r[:10])
    assert "warning" in F.value_at_risk(r[:100])


def test_position_size_respects_budget_and_caps():
    s = F.position_size("fixed_fractional", 10_000, 100.0, stop=95.0, risk_pct=1.0)
    assert s["units"] == 20.0 and s["risk_pct_of_equity"] == 1.0
    capped = F.position_size("fixed_fractional", 10_000, 100.0, stop=99.9, risk_pct=1.0, max_leverage=1.0)
    assert capped["capped_by_leverage"] and capped["notional"] <= 10_000
    with pytest.raises(FinanceError, match="more than 5%"):
        F.position_size("fixed_fractional", 10_000, 100.0, stop=95.0, risk_pct=10)
    with pytest.raises(FinanceError):
        F.position_size("fixed_fractional", 10_000, 100.0)               # no stop, no size
    assert F.position_size("kelly", 10_000, 100.0, win_rate=0.4, payoff=1.0)["units"] == 0   # negative edge: size zero
    assert F.position_size("fixed_fractional", 100.0, 1000.0, stop=990.0)["units"] == 0       # rounds down to zero, with a warning


def test_backtest_has_no_lookahead():
    d = synth(600, seed=3)
    full = F.backtest(d, "sma_cross", {"fast": 10, "slow": 40})
    cut = {k: v[:400] for k, v in d.items()}
    part = F.backtest(cut, "sma_cross", {"fast": 10, "slow": 40})
    assert np.allclose(full["_returns"][:399], part["_returns"])        # the first 399 results do not depend on later prices


def test_backtest_costs_and_benchmark():
    d = synth(700, seed=5)
    free = F.backtest(d, "sma_cross", {"fast": 5, "slow": 20}, fee_bps=0, slippage_bps=0)
    paid = F.backtest(d, "sma_cross", {"fast": 5, "slow": 20}, fee_bps=20, slippage_bps=20)
    assert paid["total_return"] < free["total_return"] and free["trades"] == paid["trades"] > 5
    bh = F.backtest(d, "buy_hold", fee_bps=0, slippage_bps=0)
    assert abs(bh["total_return"] - bh["benchmark_buy_hold"]["total_return"]) < 0.02
    assert "note" in free and free["costs_bps_per_side"] == 0
    few = F.backtest(d, "buy_hold")
    assert any("trades" in w for w in few["warnings"])
    with pytest.raises(FinanceError):
        F.backtest(d, "magic")
    with pytest.raises(FinanceError):
        F.backtest(d, "sma_cross", {"fast": 50, "slow": 10})


def test_stop_loss_limits_a_crash_and_does_not_reenter_at_once():
    n = 120
    c = np.concatenate([np.linspace(100, 110, 60), np.full(10, 110.0), np.linspace(110, 60, 20), np.full(30, 60.0)])
    d = {"date": np.array([str(i) for i in range(n)], dtype=object), "open": c.copy(), "high": c * 1.001, "low": c * 0.999, "close": c, "volume": np.ones(n)}
    no_stop = F.backtest(d, "buy_hold", fee_bps=0, slippage_bps=0)
    stop = F.backtest(d, "buy_hold", fee_bps=0, slippage_bps=0, stop_loss_pct=5)
    assert stop["max_drawdown"] > no_stop["max_drawdown"] and stop["stops_hit"] == 1


def test_split_and_walk_forward_are_out_of_sample_and_honest():
    d = synth(1500, seed=7, drift=0.0)                                   # no edge at all
    s = F.backtest_split(d, "sma_cross", {"fast": 5, "slow": 20})
    assert s["in_sample"]["periods"] + s["out_of_sample"]["periods"] <= 1500 and "verdict" in s
    w = F.walk_forward(d, "sma_cross", {"fast": [5, 10], "slow": [30, 60]}, train_bars=500, test_bars=250)
    assert len(w["steps"]) >= 3 and w["combinations_tested_per_step"] == 4 and "out-of-sample" in w["note"]
    with pytest.raises(FinanceError):
        F.walk_forward(synth(100), "sma_cross", {"fast": [5]}, train_bars=500)


def test_monte_carlo_deterministic_and_ordered():
    r = F.returns_from_prices(synth(800, seed=2)["close"])
    a, b = F.monte_carlo(r, seed=4, paths=500), F.monte_carlo(r, seed=4, paths=500)
    assert a == b
    fr = a["final_return"]
    assert fr["p5"] <= fr["median"] <= fr["p95"] and 0 <= a["prob_ruin"] <= 1 and a["max_drawdown"]["p5_worst"] <= a["max_drawdown"]["median"] <= 0
    with pytest.raises(FinanceError):
        F.monte_carlo(r, paths=10**6)


def test_portfolio_methods():
    rng = np.random.default_rng(0)
    R = np.column_stack([rng.normal(0.0004, 0.01, 1000), rng.normal(0.0003, 0.02, 1000), rng.normal(0.0002, 0.005, 1000)])
    for m in ("equal", "inverse_vol", "min_variance", "risk_parity", "max_sharpe"):
        w = F.portfolio_weights(R, m)
        assert abs(sum(w["weights"]) - 1) < 1e-4 and min(w["weights"]) >= 0
    eq, mv, rp = (F.portfolio_weights(R, m) for m in ("equal", "min_variance", "risk_parity"))
    assert mv["volatility_annual"] <= eq["volatility_annual"]
    assert max(rp["risk_contribution"]) - min(rp["risk_contribution"]) < 0.02          # equal risk contributions
    capped = F.portfolio_weights(R, "min_variance", max_weight=0.5)
    assert max(capped["weights"]) <= 0.5 + 1e-6
    with pytest.raises(FinanceError):
        F.portfolio_weights(R[:, :1])


def test_option_bond_loan_irr():
    c, p = F.black_scholes(100, 100, 1, 0.05, 0.2, "call"), F.black_scholes(100, 100, 1, 0.05, 0.2, "put")
    assert abs(c["price"] - 10.4506) < 1e-3
    assert abs((c["price"] - p["price"]) - (100 - 100 * math.exp(-0.05))) < 1e-4       # put-call parity
    assert abs(F.implied_vol(c["price"], 100, 100, 1, 0.05)["implied_vol"] - 0.2) < 1e-5
    with pytest.raises(FinanceError):
        F.implied_vol(0.0001, 100, 50, 1, 0.0)                                         # below the intrinsic bound
    par = F.bond(1000, 0.05, 10, 2, ytm=0.05)
    assert abs(par["price"] - 1000) < 1e-3 and par["modified_duration"] < par["macaulay_duration"]
    assert abs(F.bond(1000, 0.05, 10, 2, price=par["price"])["ytm"] - 0.05) < 1e-6
    ln = F.loan(200_000, 0.05, 30)
    assert abs(ln["payment"] - 1073.64) < 0.01 and ln["total_interest"] > 180_000
    ir = F.npv_irr([-100, 60, 60], 0.1)
    assert abs(ir["irr"] - 0.1307) < 1e-3 and abs(ir["npv"] - 4.1322) < 1e-3
    with pytest.raises(FinanceError):
        F.npv_irr([100, 100])


def limits(**kw):
    base = dict(live_trading_enabled=True, allowed_symbols=["AAPL"], max_order_notional=1000, max_position_pct=10, max_daily_loss_pct=2, max_drawdown_pct=10, max_orders_per_day=3)
    base.update(kw)
    return RiskLimits(**base)


def state(**kw):
    base = dict(equity=10_000.0, start_of_day_equity=10_000.0, peak_equity=10_000.0, positions={}, last_prices={"AAPL": 100.0}, orders_today=0, last_order_time=0.0)
    base.update(kw)
    return AccountState(**base)


def good_order(**kw):
    base = dict(symbol="AAPL", side="buy", qty=5, price=100.0, stop_loss=95.0)
    base.update(kw)
    return Order(**base)


def test_live_gate_passes_only_when_everything_is_right():
    o = good_order()
    ok, why = F.check_order(o, limits(), state(), live=True, typed=F.confirmation_phrase(o), now=1e9)
    assert ok, why
    assert F.confirmation_phrase(o) == "BUY 5 AAPL"


@pytest.mark.parametrize("lim,st,order,typed,needle", [
    (dict(live_trading_enabled=False), {}, {}, "BUY 5 AAPL", "switched off"),
    (dict(allowed_symbols=[]), {}, {}, "BUY 5 AAPL", "list of tradable symbols"),
    (dict(allowed_symbols=["MSFT"]), {}, {}, "BUY 5 AAPL", "list of tradable symbols"),
    ({}, {}, {}, "yes", "typed confirmation"),
    ({}, {}, {"qty": 50}, "BUY 50 AAPL", "per-order limit"),
    ({}, {}, {"stop_loss": None}, "BUY 5 AAPL", "needs a stop loss"),
    ({}, {}, {"stop_loss": 105.0}, "BUY 5 AAPL", "wrong side"),
    ({}, {}, {"price": 130.0, "stop_loss": 120.0, "qty": 5}, "BUY 5 AAPL", "typo"),
    (dict(max_order_notional=100000), {}, {"qty": 20}, "BUY 20 AAPL", "of equity"),
    ({}, dict(equity=9700.0), {}, "BUY 5 AAPL", "daily loss"),
    ({}, dict(equity=8900.0, start_of_day_equity=8900.0), {}, "BUY 5 AAPL", "drawdown limit"),
    ({}, dict(orders_today=3), {}, "BUY 5 AAPL", "daily order count"),
    ({}, dict(last_order_time=1e9 - 1), {}, "BUY 5 AAPL", "too close"),
])
def test_live_gate_refuses(lim, st, order, typed, needle):
    ok, why = F.check_order(good_order(**order), limits(**lim), state(**st), live=True, typed=typed, now=1e9)
    assert not ok and any(needle in w for w in why), why


def test_live_gate_refuses_nonsense_and_emergency_stop(tmp_path):
    ok, why = F.check_order(good_order(qty=float("nan")), limits(), state(), True, "x")
    assert not ok
    ok, why = F.check_order(good_order(qty=-1), limits(), state(), True, "x")
    assert not ok
    stop = EmergencyStop(tmp_path / "STOP")
    stop.engage("test")
    o = good_order()
    ok, why = F.check_order(o, limits(), state(), True, F.confirmation_phrase(o), stop, now=1e9)
    assert not ok and any("emergency stop" in w for w in why)
    stop.release()
    assert F.check_order(o, limits(), state(), True, F.confirmation_phrase(o), stop, now=1e9)[0]


def test_closing_a_position_is_allowed_even_when_the_loss_budget_is_spent():
    o = good_order(side="sell", qty=5, stop_loss=None)
    ok, why = F.check_order(o, limits(), state(equity=9000.0, positions={"AAPL": 5.0}), True, F.confirmation_phrase(o), now=1e9)
    assert ok, why                                                      # the gate never traps you in a losing position


def test_default_limits_are_closed(tmp_path):
    lim = RiskLimits.load(tmp_path / "missing.json")
    assert not lim.live_trading_enabled and lim.allowed_symbols == [] and lim.require_stop_loss
    lim.save(tmp_path / "l.json")
    assert RiskLimits.load(tmp_path / "l.json") == lim


def test_paper_broker_round_trip_and_rules(tmp_path):
    log = AuditLog(tmp_path / "audit.jsonl")
    lim = RiskLimits(max_order_notional=5000, max_position_pct=50)
    br = PaperBroker(tmp_path / "p.json", 10_000, lim, log, fee_bps=0, slippage_bps=0)
    r = br.order(Order("xyz", "buy", 10, 100.0, 95.0))
    assert r["filled"] and r["positions"] == {"XYZ": 10.0} and r["cash"] == 9000.0
    assert not br.order(Order("XYZ", "buy", 10, 100.0))["filled"]                       # opening order without a stop loss
    assert not br.order(Order("XYZ", "sell", 20, 100.0))["filled"]                       # no shorting on paper
    br.mark({"XYZ": 110.0})
    r = br.order(Order("XYZ", "sell", 10, 110.0))
    assert r["filled"] and r["positions"] == {} and r["realized_pnl"] == 100.0 and r["equity"] == 10_100.0
    assert "paper" in r["mode"]
    again = PaperBroker(tmp_path / "p.json")                                             # state persists
    assert again.summary()["equity"] == 10_100.0
    ok, i = log.verify()
    assert ok and any(e["kind"] == "paper_fill" for e in log.entries())
    assert not br.order(Order("XYZ", "buy", 1000, 100.0, 90.0))["filled"]                # over the position / order limits


def test_tool_dispatch_end_to_end(tmp_path):
    d = synth(800, seed=9)
    (tmp_path / "data").mkdir()
    write_csv(tmp_path / "data" / "x.csv", d)
    loaded = {"finance"}

    def run(name, **a):
        v = tools.validate(name, a, loaded)
        assert v.ok, (name, v.reason)
        return v, F.run_finance_tool(tmp_path, name, a)

    v, (ok, txt) = run("fin_indicators", path="data/x.csv", indicators=["rsi", {"name": "sma", "n": 50}], tail=3)
    assert ok and len(json.loads(txt)["tail"]["rsi_14"]) == 3 and not v.needs_approval
    for name, a in [("fin_stats", {}), ("fin_risk", {}), ("fin_backtest", {"strategy": "sma_cross", "params": {"fast": 10, "slow": 40}}),
                    ("fin_backtest_split", {"strategy": "macd"}), ("fin_montecarlo", {"strategy": "breakout", "paths": 200})]:
        ok, txt = run(name, path="data/x.csv", **a)[1]
        assert ok, (name, txt)
        assert "_returns" not in txt
    ok, txt = run("fin_portfolio", paths=["data/x.csv", "data/x.csv"], method="equal")[1]
    assert ok and json.loads(txt)["assets"] == ["x", "x"]
    assert run("fin_option", spot=100.0, strike=100.0, t=1.0, rate=0.05, vol=0.2)[1][0]
    assert run("fin_cashflow", op="loan", principal=1000.0, rate=0.06, years=1.0)[1][0]
    assert run("fin_size", method="fixed_fractional", equity=10000.0, entry=100.0, stop=98.0)[1][0]
    ok, txt = F.run_finance_tool(tmp_path, "fin_stats", {"path": "../etc/passwd"})
    assert not ok and "leaves the workspace" in txt
    ok, txt = F.run_finance_tool(tmp_path, "fin_stats", {"path": "data/none.csv"})
    assert not ok
    ok, txt = run("paper_order", symbol="X", side="buy", qty=1.0, price=100.0, stop_loss=90.0)[1]
    assert ok and json.loads(txt)["filled"]


def test_live_tools_gate_and_need_a_typed_confirmation(tmp_path):
    (tmp_path / "finance").mkdir()
    base = {"connector": "broker", "symbol": "AAPL", "side": "buy", "qty": 5.0, "price": 100.0, "stop_loss": 95.0,
            "account_state": {"equity": 10_000, "last_prices": {"AAPL": 100.0}}, "confirmation": "BUY 5 AAPL"}
    v = tools.validate("trade_live_order", base, {"finance"})
    assert v.ok and v.needs_approval and v.needs_confirmation and v.risk == "destructive"
    ok, txt = F.run_finance_tool(tmp_path, "trade_live_order", base)
    assert not ok and "switched off" in txt                                      # default: closed
    RiskLimits(live_trading_enabled=True, allowed_symbols=["AAPL"]).save(tmp_path / "finance" / "limits.json")
    log = AuditLog(tmp_path / "a.jsonl")
    ok, txt = F.run_finance_tool(tmp_path, "trade_live_order", {**base, "confirmation": "yes"}, audit=log)
    assert not ok and "BUY 5 AAPL" in txt
    ok, txt = F.run_finance_tool(tmp_path, "trade_live_order", base, audit=log)
    assert ok and json.loads(txt)["allowed"] and "mcp_call" in json.loads(txt)["next"]
    assert [e["allowed"] for e in log.entries()] == [False, True]               # every check is on the record
    chk = tools.validate("trade_live_check", {k: v for k, v in base.items() if k != "connector"}, {"finance"})
    assert chk.ok and not chk.needs_approval                                    # checking never needs a click, sending always does


def test_finance_limits_and_gate_are_protected_from_the_model():
    for p in ("qalam/src/qalam/finance.py", "finance/limits.json", "workspace/finance/limits.json"):
        assert governance.is_protected(p), p
    assert not governance.classify("code_edit_dev", "qalam/src/qalam/finance.py").allowed


def test_finance_registry_shape():
    fin = [n for n, s in tools.REGISTRY.items() if s.group == "finance"]
    assert len(fin) >= 20 and len(tools.REGISTRY) <= 256
    connector_or_web = {"market_data", "trade_live_positions", "trade_live_balance", "trade_live_cancel"}
    for n in fin:
        if n in connector_or_web or n in ("trade_live_order", "trade_live_check"):
            continue
        assert tools.REGISTRY[n].risk in ("read", "exec")                          # analysis never changes anything outside the workspace
    assert tools.REGISTRY["trade_live_order"].risk == "destructive"
