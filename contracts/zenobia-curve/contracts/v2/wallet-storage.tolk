// Zenobia: each holder's wallet keeps its own holding clock INSIDE the coin (no server, no oracle).
// It lives in the optional tail after the standard fields, so the standard StateInit (and every wallet address) is unchanged:
//   tail = [curve flag: 1 bit][since: uint32][prev: uint32][mark: uint2]      (a curve wallet keeps only the 1-bit flag)
//   since = when the current holding began (0 = not holding), prev = kept to undo a bounced transfer,
//   mark  = 0 never emptied, 1 sold everything (Captive), 2 burned everything (Legend).
const HOLD_TAIL_BITS = 1 + 32 + 32 + 2
// Less than one whole token left counts as empty: a curve sell leaves a few nano-tokens of rounding dust.
const HOLD_DUST = 1000000000

struct WalletStorageV2 {
    jettonBalance: coins
    ownerAddress: address
    minterAddress: address
    // Empty in the standard StateInit; set by the authenticated curve mint.
    protection: RemainingBitsAndRefs
}

fun WalletStorageV2.load(): WalletStorageV2 {
    return WalletStorageV2.fromCell(contract.getData());
}

fun WalletStorageV2.save(self) {
    contract.setData(self.toCell());
}

fun WalletStorageV2.isCurveWallet(self): bool {
    return !self.protection.isEmpty() && self.protection.preloadUint(1) != 0;
}

fun WalletStorageV2.holdSince(self): int {
    var t = self.protection;
    if (t.remainingBitsCount() < HOLD_TAIL_BITS) {
        return 0;
    }
    t.skipBits(1);
    return t.loadUint(32);
}
fun WalletStorageV2.holdPrev(self): int {
    var t = self.protection;
    if (t.remainingBitsCount() < HOLD_TAIL_BITS) {
        return 0;
    }
    t.skipBits(33);
    return t.loadUint(32);
}
fun WalletStorageV2.holdMark(self): int {
    var t = self.protection;
    if (t.remainingBitsCount() < HOLD_TAIL_BITS) {
        return 0;
    }
    t.skipBits(65);
    return t.loadUint(2);
}

fun WalletStorageV2.setHold(mutate self, since: int, prev: int, mark: int) {
    self.protection = beginCell().storeBool(false).storeUint(since, 32).storeUint(prev, 32).storeUint(mark, 2).toSlice();
}

// Called with the balance BEFORE tokens are added: a new holding starts when the balance goes from zero to something.
fun WalletStorageV2.holdOnCredit(mutate self, amount: coins) {
    if (self.isCurveWallet() || amount < HOLD_DUST || self.jettonBalance >= HOLD_DUST) {
        return;
    }
    self.setHold(blockchain.now(), 0, 0);
}

// A transfer that emptied this wallet bounced back: the original clock is restored (called with the balance BEFORE it is restored).
fun WalletStorageV2.holdOnBounce(mutate self, amount: coins) {
    if (self.isCurveWallet() || amount == 0 || self.jettonBalance >= HOLD_DUST) {
        return;
    }
    if (self.holdMark() != 0 && self.holdSince() == 0 && self.holdPrev() != 0) {
        self.setHold(self.holdPrev(), 0, 0);
    }
}

// Called with the balance BEFORE tokens leave: the clock stops when the balance reaches zero.
fun WalletStorageV2.holdOnDebit(mutate self, amount: coins, burned: bool) {
    if (self.isCurveWallet() || amount == 0 || self.jettonBalance < amount ||
        self.jettonBalance - amount >= HOLD_DUST || self.holdSince() == 0) {
        return;
    }
    self.setHold(0, self.holdSince(), burned ? 2 : 1);
}
