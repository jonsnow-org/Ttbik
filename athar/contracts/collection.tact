import "./messages";
import "./item";

// Athar collection (Edition 1). It is the registry of tokens. It knows nothing about prices:
// sales are done by season "minters" that the admin authorises with a public delay.
// Money is never kept here: every sale is forwarded to `payout` immediately.
contract AtharCollection {
    admin: Address;
    collectionUri: String;         // collection metadata URL (name, image, description)
    delaySec: Int as uint32;       // public notice period for sensitive changes (48h in production)
    init(admin: Address, collectionUri: String, delaySec: Int) {
        self.admin = admin;
        self.collectionUri = collectionUri;
        self.delaySec = delaySec;
    }
    baseUri: String = "";          // item metadata prefix, e.g. https://.../m/
    payout: Address? = null;
    royaltyNum: Int as uint16 = 500;           // 5%
    royaltyDen: Int as uint16 = 10000;
    minters: map<Address, Int as uint32>;      // minter -> time from which it is active
    pendingPayout: Address? = null;
    pendingPayoutAt: Int as uint32 = 0;
    pendingBaseUri: String? = null;
    pendingBaseUriAt: Int as uint32 = 0;
    successor: Address? = null;                // next edition, set once; closes minting
    minted: Int as uint32 = 0;
    firstMinterDone: Bool = false;

    receive() { }                                // plain TON (not expected): forwarded by Withdraw

    // ---- first set-up (before anything is sold) ----
    receive(msg: ProposePayout) {
        require(sender() == self.admin, "only admin");
        if (self.payout == null) {                // very first payout address applies at once
            self.payout = msg.payout;
            return;
        }
        self.pendingPayout = msg.payout;
        self.pendingPayoutAt = now() + self.delaySec;
    }
    receive(msg: ApplyPayout) {
        require(sender() == self.admin, "only admin");
        require(self.pendingPayout != null, "nothing proposed");
        require(now() >= self.pendingPayoutAt, "notice period not over");
        self.payout = self.pendingPayout;
        self.pendingPayout = null;
    }
    receive(msg: ProposeBaseUri) {
        require(sender() == self.admin, "only admin");
        if (self.baseUri.asSlice().bits() == 0) { self.baseUri = msg.uri; return; }
        self.pendingBaseUri = msg.uri;
        self.pendingBaseUriAt = now() + self.delaySec;
    }
    receive(msg: ApplyBaseUri) {
        require(sender() == self.admin, "only admin");
        require(self.pendingBaseUri != null, "nothing proposed");
        require(now() >= self.pendingBaseUriAt, "notice period not over");
        self.baseUri = self.pendingBaseUri!!;
        self.pendingBaseUri = null;
    }

    receive(msg: ProposeMinter) {
        require(sender() == self.admin, "only admin");
        require(self.successor == null, "closed");
        // the very first minter is active at once (nothing is sold yet, so there is nobody to warn);
        // every later one waits out the public notice period
        if (!self.firstMinterDone) {
            self.firstMinterDone = true;
            self.minters.set(msg.minter, now());
        } else {
            self.minters.set(msg.minter, now() + self.delaySec);
        }
    }
    receive(msg: RemoveMinter) {
        require(sender() == self.admin, "only admin");
        self.minters.set(msg.minter, null);
    }

    // ---- minting (only authorised, active minters) ----
    receive(msg: MintItem) {
        let ctx: Context = context();
        require(self.successor == null, "minting closed");
        let from: Int? = self.minters.get(ctx.sender);
        require(from != null && now() >= from!!, "minter not authorised");
        require(msg.index >= 0 && msg.index <= MAX_INDEX, "date out of range");
        require(self.payout != null, "payout not set");
        require(ctx.value >= msg.remit + MINT_FEES, "not enough value");
        let init: StateInit = initOf AtharItem(myAddress(), msg.index);
        self.minted = self.minted + 1;
        // the sale money goes to the owner's wallet in the same transaction
        if (msg.remit > 0) {
            send(SendParameters{ to: self.payout!!, value: msg.remit, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false, body: "athar sale".asComment() });
        }
        send(SendParameters{ to: ctx.sender, value: OK_VALUE, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false, body: MintOk{ index: msg.index }.toCell() });
        send(SendParameters{
            to: contractAddress(init), value: ctx.value - msg.remit - OK_VALUE - COLL_GAS, mode: SendPayGasSeparately, bounce: true,
            body: ItemInit{ owner: msg.newOwner, season: msg.season, tier: msg.tier, paid: msg.paid, mintedAt: now(), occasion: msg.occasion, mediaRef: msg.mediaRef }.toCell(),
            code: init.code, data: init.data
        });
    }

    // sale money and engraving fees come here and leave at once
    receive(msg: Proceeds) {
        self.payoutNow();
    }

    // anyone may push any stuck balance to the payout address
    receive(msg: Withdraw) {
        self.payoutNow();
    }

    fun payoutNow() {
        require(self.payout != null, "payout not set");
        nativeReserve(MIN_STORAGE, 0);
        send(SendParameters{ to: self.payout!!, value: 0, mode: SendRemainingBalance | SendIgnoreErrors, bounce: false, body: "athar".asComment() });
    }

    // ---- upgrade to the next edition ----
    receive(msg: SetSuccessor) {
        require(sender() == self.admin, "only admin");
        require(self.successor == null, "already set");
        self.successor = msg.successor;          // one-shot: also closes minting
    }
    receive(msg: UpgradeRequest) {
        require(sender() == self.itemAddress(msg.index), "only a real item");
        require(self.successor != null, "no next edition yet");
        send(SendParameters{
            to: self.successor!!, value: 0, mode: SendRemainingValue, bounce: true,
            body: UpgradeAccept{
                index: msg.index, owner: msg.owner, season: msg.season, tier: msg.tier, paid: msg.paid,
                mintedAt: msg.mintedAt, hands: msg.hands, engravings: msg.engravings,
                occasion: msg.occasion, mediaRef: msg.mediaRef, mediaLog: msg.mediaLog
            }.toCell()
        });
    }
    // successor refused (e.g. not enough money): unlock the item, nothing is lost
    bounced(msg: bounced<UpgradeAccept>) {
        send(SendParameters{ to: self.itemAddress(msg.index), value: 0, mode: SendRemainingValue, bounce: false, body: UpgradeAbort{ index: msg.index }.toCell() });
    }
    receive(msg: UpgradeDone) {
        require(self.successor != null && sender() == self.successor!!, "only the next edition");
        send(SendParameters{ to: self.itemAddress(msg.index), value: 0, mode: SendRemainingValue, bounce: false, body: BurnConfirm{}.toCell() });
    }

    fun itemAddress(index: Int): Address {
        return contractAddress(initOf AtharItem(myAddress(), index));
    }

    // ---- TEP-62 / TEP-66 getters ----
    get fun get_collection_data(): CollectionData {
        return CollectionData{
            nextItemIndex: self.minted,
            collectionContent: beginCell().storeUint(1, 8).storeSlice(self.collectionUri.asSlice()).endCell(),
            ownerAddress: self.admin
        };
    }
    get fun get_nft_address_by_index(index: Int): Address {
        return self.itemAddress(index);
    }
    get fun get_nft_content(index: Int, individualContent: Cell): Cell {
        return beginCell().storeUint(1, 8).storeSlice(self.baseUri.asSlice()).storeRef(individualContent).endCell();
    }
    get fun royalty_params(): RoyaltyParams {
        let dest: Address = self.admin;
        if (self.payout != null) { dest = self.payout!!; }
        return RoyaltyParams{ numerator: self.royaltyNum, denominator: self.royaltyDen, destination: dest };
    }
    get fun payout_address(): Address? { return self.payout; }
    get fun successor_address(): Address? { return self.successor; }
    get fun minter_active_at(minter: Address): Int? { return self.minters.get(minter); }
    get fun total_minted(): Int { return self.minted; }
}
