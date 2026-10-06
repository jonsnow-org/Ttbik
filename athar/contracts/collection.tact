import "./messages";
import "./item";

// Athar collection. It is the registry of tokens (id = kind * 65536 + date). It knows nothing about prices:
// sales are done by season "minters" that the admin authorises with a public delay.
// Money is never kept here: every sale is forwarded to `payout` immediately.
@name(set_code)
native nativeSetCode(code: Cell);
struct CodeProposal { pending: Bool; applicableAt: Int; }

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
    engraveFee: Int as coins = 100000000;      // 0.1 TON; adjustable by the admin (SetItemFees), never above 5 TON
    mediaFee: Int as coins = 100000000;        // first picture / occasion
    changeFee: Int as coins = 500000000;       // replacing a picture that is already there (both the old and the new one stay in the token's history)
    issued: map<Int as uint32, Bool>;          // which token ids (kind and date) exist (so a request for a missing token is refused at once)
    pendingCode: Cell? = null;                 // proposed new logic of this collection (its address, its tokens and its money stay; see ProposeCode)
    pendingCodeAt: Int as uint32 = 0;
    ext: Cell? = null;                         // spare room: data that a later version may need without changing the layout above

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

    // ---- fixing the collection's own logic in place (owner's decision, 2026-10-05) ----
    // A mistake in the collection can be corrected without a new collection (which would have a new address and lose its history on every
    // market): the admin proposes new code, it waits out the same public notice period as every sensitive change (48h in production), anyone
    // can see the proposal on the chain, and it can be cancelled meanwhile. The tokens themselves are never changed by this: their code is
    // fixed, and a mistake in a token is handled by the opt-in upgrade of its holder (UpgradeStart). The new code must keep the data layout of
    // this one (new data goes into `ext`) and the same token code, so that every token's address stays what it was.
    receive(msg: ProposeCode) {
        require(sender() == self.admin, "only admin");
        self.pendingCode = msg.code;
        self.pendingCodeAt = now() + self.delaySec;
    }
    receive(msg: CancelCode) {
        require(sender() == self.admin, "only admin");
        self.pendingCode = null;
    }
    receive(msg: ApplyCode) {
        require(sender() == self.admin, "only admin");
        require(self.pendingCode != null, "nothing proposed");
        require(now() >= self.pendingCodeAt, "notice period not over");
        let code: Cell = self.pendingCode!!;
        self.pendingCode = null;
        nativeSetCode(code);
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
        require(validId(msg.index), "id out of range");
        require(self.issued.get(msg.index) == null, "already issued");      // whatever minter asks: an id is minted once, and the buyer of a second sale is refunded by the bounce
        require(self.payout != null, "payout not set");
        require(ctx.value >= msg.remit + MINT_FEES, "not enough value");
        let init: StateInit = initOf AtharItem(myAddress(), msg.index);
        self.minted = self.minted + 1;
        self.issued.set(msg.index, true);
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

    // ---- adjustable item fees ----
    receive(msg: SetItemFees) {
        require(sender() == self.admin, "only admin");
        require(msg.engraveFee >= 20000000 && msg.mediaFee >= 20000000 && msg.engraveFee <= 5000000000 && msg.mediaFee <= 5000000000 && msg.changeFee <= 5000000000, "fee out of range");
        require(msg.changeFee >= msg.mediaFee, "a change costs at least a first picture");
        self.engraveFee = msg.engraveFee;
        self.mediaFee = msg.mediaFee;
        self.changeFee = msg.changeFee;
    }
    // the owner asks HERE (the collection knows the current fees); the item checks ownership and applies it
    receive(msg: EngraveReq) {
        let ctx: Context = context();
        require(validId(msg.index) && self.issued.get(msg.index) != null, "no such token");
        require(ctx.value >= self.engraveFee + MIN_STORAGE + REQ_GAS, "not enough value");
        send(SendParameters{ to: self.itemAddress(msg.index), value: 0, mode: SendRemainingValue, bounce: true, body: EngraveFrom{ owner: ctx.sender, text: msg.text, fee: self.engraveFee }.toCell() });
    }
    receive(msg: SetMediaReq) {
        let ctx: Context = context();
        require(validId(msg.index) && self.issued.get(msg.index) != null, "no such token");
        require(ctx.value >= self.mediaFee + MIN_STORAGE + REQ_GAS, "not enough value");
        send(SendParameters{ to: self.itemAddress(msg.index), value: 0, mode: SendRemainingValue, bounce: true, body: SetMediaFrom{ owner: ctx.sender, occasion: msg.occasion, mediaRef: msg.mediaRef, firstFee: self.mediaFee, changeFee: self.changeFee }.toCell() });
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
    get fun item_fees(): ItemFees { return ItemFees{ engrave: self.engraveFee, media: self.mediaFee, change: self.changeFee }; }
    get fun payout_address(): Address? { return self.payout; }
    get fun successor_address(): Address? { return self.successor; }
    get fun minter_active_at(minter: Address): Int? { return self.minters.get(minter); }
    get fun total_minted(): Int { return self.minted; }
    get fun code_proposal(): CodeProposal { return CodeProposal{ pending: self.pendingCode != null, applicableAt: self.pendingCodeAt }; }
    get fun pending_code_hash(): Int? {                     // anyone can compare it with the hash of the code they audited
        if (self.pendingCode == null) { return null; }
        return self.pendingCode!!.hash();
    }
}
