import "./messages";

// One Athar token. The token index is the date (days since 1950-01-01).
// The token remembers: who minted it, what was paid, how many hands it passed through,
// the last transfer time (drives the visual "age" stages off-chain) and every owner's engraving.
contract AtharItem {
    collection: Address;
    index: Int as uint64;
    init(collection: Address, index: Int) {
        self.collection = collection;
        self.index = index;
    }
    owner: Address? = null;
    season: Int as uint16 = 0;
    tier: Int as uint8 = 0;
    paid: Int as coins = 0;
    mintedAt: Int as uint32 = 0;
    lastTransferAt: Int as uint32 = 0;
    hands: Int as uint32 = 0;
    engravings: Cell? = null;     // linked chain: each cell = owner, time, text, ref to previous
    occasion: Int as uint8 = 0;
    mediaRef: Int as uint256 = 0;
    mediaLog: Cell? = null;       // linked chain of every picture the token ever had: owner, time, ref, ref to previous
    locked: Bool = false;         // true while an upgrade is in flight

    receive(msg: ItemInit) {
        require(sender() == self.collection, "only collection");
        require(self.owner == null, "already minted");
        self.owner = msg.owner;
        self.season = msg.season;
        self.tier = msg.tier;
        self.paid = msg.paid;
        self.mintedAt = msg.mintedAt;
        self.lastTransferAt = msg.mintedAt;
        self.hands = 1;
        self.occasion = msg.occasion;
        self.mediaRef = msg.mediaRef;
        if (msg.mediaRef != 0) { self.mediaLog = self.logMedia(msg.owner, msg.mediaRef, msg.mintedAt); }
    }

    receive(msg: Transfer) {
        let ctx: Context = context();
        require(self.owner != null, "not minted");
        require(ctx.sender == self.owner!!, "not owner");
        require(!self.locked, "upgrade in progress");
        let fwd: Int = ctx.readForwardFee();
        let needed: Int = fwd * 2 + MIN_STORAGE;
        if (msg.forwardAmount > 0) { needed = needed + msg.forwardAmount + fwd; }
        require(ctx.value >= needed, "not enough value");
        let prev: Address = self.owner!!;
        self.owner = msg.newOwner;
        self.lastTransferAt = now();
        self.hands = self.hands + 1;
        if (msg.forwardAmount > 0) {
            send(SendParameters{
                to: msg.newOwner, value: msg.forwardAmount, mode: SendPayGasSeparately, bounce: false,
                body: OwnershipAssigned{ queryId: msg.queryId, prevOwner: prev, forwardPayload: msg.forwardPayload }.toCell()
            });
        }
        // TEP-62: what is left of the incoming value goes back to the response destination, whatever the forward amount was. It is counted
        // from the balance (as the reference implementation does): "send the remaining incoming value" would count the forwarded part
        // twice, fail silently, and marketplaces (which always forward) would refuse the token for sending nothing back to its owner.
        if (msg.responseDestination != null) {
            let rest: Int = myBalance() - MIN_STORAGE;
            if (msg.forwardAmount > 0) { rest = rest - msg.forwardAmount - fwd; }
            if (rest > 0) {
                send(SendParameters{
                    to: msg.responseDestination!!, value: rest, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false,
                    body: Excesses{ queryId: msg.queryId }.toCell()
                });
            }
        }
    }

    receive(msg: GetStaticData) {
        send(SendParameters{
            to: sender(), value: 0, mode: SendRemainingValue, bounce: true,
            body: ReportStaticData{ queryId: msg.queryId, index: self.index, collection: self.collection }.toCell()
        });
    }

    // The owner leaves a short note (<= 32 bytes) that stays with the token for good. Arrives from the collection (which holds the
    // current fee). Any refusal sends the whole value back to the owner instead of failing: the money already left their wallet.
    receive(msg: EngraveFrom) {
        let ctx: Context = context();
        require(ctx.sender == self.collection, "only collection");
        let ok: Bool = false;
        if (self.owner != null) {
            if (msg.owner == self.owner!! && !self.locked && ctx.value >= msg.fee + MIN_STORAGE) {
                let s0: Slice = msg.text.asSlice();
                if (s0.bits() > 0 && s0.bits() <= 256 && s0.refs() == 0) { ok = true; }
            }
        }
        if (!ok) {
            send(SendParameters{ to: msg.owner, value: 0, mode: SendRemainingValue | SendIgnoreErrors, bounce: false, body: "athar refund".asComment() });
            return;
        }
        let s: Slice = msg.text.asSlice();
        self.engravings = beginCell()
            .storeAddress(msg.owner)
            .storeUint(now(), 32)
            .storeUint(s.bits(), 9)
            .storeSlice(s)
            .storeMaybeRef(self.engravings)
            .endCell();
        send(SendParameters{ to: self.collection, value: msg.fee, mode: SendPayGasSeparately, bounce: false, body: Proceeds{}.toCell() });
        send(SendParameters{ to: msg.owner, value: 0, mode: SendRemainingValue | SendIgnoreErrors, bounce: false, body: Excesses{ queryId: 0 }.toCell() });
    }

    fun logMedia(owner: Address, ref: Int, at: Int): Cell {
        return beginCell().storeAddress(owner).storeUint(at, 32).storeUint(ref, 256).storeMaybeRef(self.mediaLog).endCell();
    }

    // The owner sets the occasion and/or a picture (an Arweave id). Every earlier picture stays in the history. A first picture or an
    // occasion costs firstFee; replacing a picture that is already there costs changeFee (the old and the new one are both kept).
    receive(msg: SetMediaFrom) {
        let ctx: Context = context();
        require(ctx.sender == self.collection, "only collection");
        let isChange: Bool = self.mediaRef != 0 && msg.mediaRef != 0 && msg.mediaRef != self.mediaRef;
        let fee: Int = msg.firstFee;
        if (isChange) { fee = msg.changeFee; }
        let ok: Bool = false;
        if (self.owner != null) {
            if (msg.owner == self.owner!! && !self.locked && msg.occasion <= 9 && ctx.value >= fee + MIN_STORAGE) { ok = true; }
        }
        if (!ok) {
            send(SendParameters{ to: msg.owner, value: 0, mode: SendRemainingValue | SendIgnoreErrors, bounce: false, body: "athar refund".asComment() });
            return;
        }
        self.occasion = msg.occasion;
        if (msg.mediaRef != 0 && msg.mediaRef != self.mediaRef) {
            self.mediaRef = msg.mediaRef;
            self.mediaLog = self.logMedia(msg.owner, msg.mediaRef, now());
        }
        send(SendParameters{ to: self.collection, value: fee, mode: SendPayGasSeparately, bounce: false, body: Proceeds{}.toCell() });
        send(SendParameters{ to: msg.owner, value: 0, mode: SendRemainingValue | SendIgnoreErrors, bounce: false, body: Excesses{ queryId: 0 }.toCell() });
    }

    // ---- upgrade: phase 1 (lock, ask the collection). Nothing is destroyed yet. ----
    receive(msg: UpgradeStart) {
        let ctx: Context = context();
        require(self.owner != null && ctx.sender == self.owner!!, "not owner");
        require(!self.locked, "upgrade already in progress");
        self.locked = true;
        send(SendParameters{
            to: self.collection, value: 0, mode: SendRemainingValue, bounce: true,
            body: UpgradeRequest{
                index: self.index, owner: ctx.sender, season: self.season, tier: self.tier, paid: self.paid,
                mintedAt: self.mintedAt, hands: self.hands, engravings: self.engravings,
                occasion: self.occasion, mediaRef: self.mediaRef, mediaLog: self.mediaLog
            }.toCell()
        });
    }

    // the collection refused (no successor yet, ...) or the successor refused: unlock, token untouched
    bounced(msg: bounced<UpgradeRequest>) {
        self.locked = false;
    }
    receive(msg: UpgradeAbort) {
        require(sender() == self.collection, "only collection");
        self.locked = false;
        if (self.owner != null) {
            send(SendParameters{ to: self.owner!!, value: 0, mode: SendRemainingValue | SendIgnoreErrors, bounce: false, body: Excesses{ queryId: 0 }.toCell() });
        }
    }

    // ---- upgrade: phase 2 (the higher edition issued the new token): burn this one ----
    receive(msg: BurnConfirm) {
        require(sender() == self.collection, "only collection");
        require(self.locked, "no upgrade pending");
        send(SendParameters{
            to: self.owner!!, value: 0, mode: SendRemainingBalance | SendDestroyIfZero, bounce: false,
            body: Excesses{ queryId: 0 }.toCell()
        });
        self.owner = null;
    }

    get fun get_nft_data(): NftData {
        let initialized: Bool = self.owner != null;
        let ownerAddr: Address = self.collection;
        if (initialized) { ownerAddr = self.owner!!; }
        let sb: StringBuilder = beginString();
        sb.append(self.index.toString());
        sb.append(".json");
        return NftData{
            isInitialized: initialized,
            index: self.index,
            collectionAddress: self.collection,
            ownerAddress: ownerAddr,
            individualContent: sb.toCell()
        };
    }

    get fun athar(): AtharState {
        return AtharState{
            season: self.season, tier: self.tier, paid: self.paid, mintedAt: self.mintedAt,
            lastTransferAt: self.lastTransferAt, hands: self.hands, engravings: self.engravings, locked: self.locked,
            occasion: self.occasion, mediaRef: self.mediaRef, mediaLog: self.mediaLog
        };
    }
}

struct AtharState {
    season: Int;
    tier: Int;
    paid: Int;
    mintedAt: Int;
    lastTransferAt: Int;
    hands: Int;
    engravings: Cell?;
    locked: Bool;
    occasion: Int;
    mediaRef: Int;
    mediaLog: Cell?;
}
