"""The bridge: a worker that runs a real agent loop with a Qalam model for each node of an orchestrated task graph.

  node -> a prompt (the node's task plus the outputs of the nodes it depends on) -> `agent.run_agent` with the model -> real tools through `executors.run_tool` -> a summary

What a worker can do is fixed by its node, in three layers: (1) the model can only EMIT the tool tokens of the node's tools (the others are masked out of decoding), (2) the loop's
validation refuses any tool outside the node's groups, (3) the executor wrapper refuses any tool name outside the node's set. A write/external call needs `approve` and a destructive
one `confirm` (absent = refused), exactly as in a single agent. `delegate` lets a running agent hand a sub-task to a NEW team with an even narrower tool set and a lower depth budget."""
from __future__ import annotations

import json
from typing import Callable

import torch

from . import agent as agent_mod
from . import executors, tools
from .orchestrator import Context, Node, Orchestrator, OrchestrationError

SYSTEM = "You are Qalam, an agent. Use only the tools you were given. Think briefly, act, check the result, and finish with a short answer."


def agent_tokens(cfg, node_tools: frozenset[str]) -> list[int]:
    """Ids the model may produce inside an agent loop: text, the closing/opening markers, and ONLY the tool tokens of its tools."""
    specials = [cfg.special_id(n) for n in ("EOS", "CMD_BEGIN", "CMD_END", "TOOL_BEGIN", "TOOL_END", "THINK_BEGIN", "THINK_END")]
    return list(range(cfg.text_vocab)) + specials + [tools.tool_id(cfg, n) for n in sorted(node_tools | {"load_tools"}) if n in tools.REGISTRY]


def make_worker(model, rt: executors.Runtime, encode: Callable[[str], list[int]], decode: Callable[[list[int]], str], approve: Callable[[str, str], bool] = lambda k, b: False,
                confirm: Callable[[str, str], bool] | None = None, max_steps: int = 10, max_new: int = 200, think_budget: int = 128, temperature: float = 0.0, seed: int = 0,
                generate: Callable | None = None) -> Callable[[Node, Context], str]:
    """`generate(stream_ids, max_new, allowed, stop_ids)` may be supplied (a scripted policy in tests, a remote model); by default the Qalam model decodes."""
    cfg = model.cfg

    def worker(node: Node, ctx: Context) -> str:
        names = set(node.tools)
        groups = {tools.REGISTRY[n].group for n in names} - {tools.CORE_GROUP}
        allowed = agent_tokens(cfg, frozenset(names))
        stops = {cfg.special_id("EOS"), cfg.special_id("CMD_END"), cfg.special_id("TOOL_END")}
        deps = "".join(f"\n[result of {d}]\n{v}" for d, v in ctx.inputs.items())
        system = SYSTEM + " Tools: " + (", ".join(sorted(names)) or "none") + "."
        prompt = [cfg.special_id("BOS"), cfg.special_id("SYSTEM")] + encode(system) + [cfg.special_id("USER")] + encode(node.prompt + deps) + [cfg.special_id("ASSISTANT")]

        def gen(stream: list[int], n: int) -> list[int]:
            ctx.check()                                                    # cancelled / out of time: raises, the scheduler records it
            ids = torch.tensor([stream[-(cfg.max_seq - n - 1):]], device=next(model.parameters()).device)
            if generate is not None:
                return list(generate(ids[0].tolist(), n, allowed, stops))
            out = model.generate(ids, n, temperature=temperature, allowed=allowed, stop_id=stops, seed=seed)
            return out[0].tolist()

        def execute(kind: str, body: str) -> tuple[bool, str]:
            if kind == "command":
                name, args = "computer_run", {"command": body}
            else:
                parsed = tools.parse_call(body)
                if parsed is None:
                    return False, "not `name {json}`"
                name, args = parsed
            if name not in names:
                return False, f"{name} is not one of this agent's tools"
            if name == "delegate" and rt.delegate is None:
                return False, "delegation is not available here"
            return executors.run_tool(rt, name, args, groups | {tools.REGISTRY[name].group})

        steps, _ = agent_mod.run_agent(cfg, gen, decode, encode, prompt, execute, approve, max_steps=max_steps, think_budget=think_budget, max_new=max_new, confirm=confirm,
                                       loaded=set(groups), audit=rt.audit, stop=rt.stop)
        answers = [s.text for s in steps if s.kind == "answer"]
        if answers:
            return answers[-1]
        last = steps[-1] if steps else None
        raise OrchestrationError(f"no answer: the agent ended with {last.kind if last else 'nothing'}" + (f" ({last.result[:160]})" if last and last.result else ""))
    return worker


def make_delegate(model, rt: executors.Runtime, encode, decode, parent_tools: frozenset[str], depth: int, orch: Orchestrator | None = None, **worker_kw) -> Callable[[str, list, int], str]:
    """The function behind the `delegate` tool: run ONE sub-agent on `task` with `tools` (which must be within the parent's) and a step budget; its answer comes back as text.
    Each delegation level lowers the remaining depth (the orchestrator refuses past its limit), so a chain of delegations always ends."""
    orch = orch or Orchestrator(workers=1, audit=rt.audit, stop=rt.stop)

    def delegate(task: str, narrower: list, budget: int = 8) -> str:
        node = Node("sub", task, (), frozenset(narrower), depth=depth + 1)
        worker = make_worker(model, rt, encode, decode, max_steps=max(1, min(int(budget), 20)), **worker_kw)
        res = orch.run([node], worker, parent_tools=parent_tools, parent_depth=depth)["sub"]
        if res.status != "done":
            raise OrchestrationError(f"sub-agent {res.status}: {res.error}")
        return res.output
    return delegate


def run_team(model, rt: executors.Runtime, encode, decode, nodes: list[Node], workers: int = 4, **worker_kw) -> dict:
    """The whole thing: a graph of agents, in parallel where independent, with the model and the real tools. Returns {node id: Outcome}."""
    orch = Orchestrator(workers=workers, audit=rt.audit, stop=rt.stop)
    return orch.run(nodes, make_worker(model, rt, encode, decode, **worker_kw))
