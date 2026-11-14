"""Leakage-resistant train/dev/test splitting by provenance group."""
from __future__ import annotations

import hashlib
from collections import defaultdict
from .schema import Example


def split_by_group(examples: list[Example], *, seed: int=17, train: float=.90, dev: float=.05) -> dict[str,list[Example]]:
    if not (0 < train < 1 and 0 <= dev < 1 and train+dev < 1):
        raise ValueError("invalid split fractions")
    groups: dict[str,list[Example]]=defaultdict(list)
    for ex in examples: groups[ex.split_group].append(ex)
    # Rank provenance groups by a seeded hash, then reserve at least one whole group
    # for each split when there are enough groups. This prevents accidental empty TEST
    # output on small but useful smoke builds while keeping group-level isolation.
    ranked=sorted(groups, key=lambda group: hashlib.sha256(f"{seed}:{group}".encode()).digest())
    n=len(ranked)
    if n >= 3:
        n_test=max(1, round(n*(1.0-train-dev)))
        n_dev=max(1, round(n*dev))
        while n_test+n_dev >= n:
            if n_test > 1: n_test -= 1
            else: n_dev -= 1
        n_train=n-n_dev-n_test
    elif n == 2:
        n_train, n_dev, n_test = 1, 1, 0
    else:
        n_train, n_dev, n_test = n, 0, 0
    assign={}
    for i,group in enumerate(ranked):
        assign[group]="train" if i<n_train else "dev" if i<n_train+n_dev else "test"
    result={"train":[],"dev":[],"test":[]}
    for group,rows in groups.items(): result[assign[group]].extend(rows)
    return result


def assert_no_group_leakage(parts: dict[str,list[Example]]) -> None:
    seen={}
    for split,rows in parts.items():
        for ex in rows:
            prior=seen.get(ex.split_group)
            if prior and prior!=split:
                raise ValueError(f"split_group leaked across {prior} and {split}: {ex.split_group}")
            seen[ex.split_group]=split
