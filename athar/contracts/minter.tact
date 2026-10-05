import "./messages";
import "./tier";

// The sale logic of Athar. A token is a date in a kind (see messages.tact: id = kind * 65536 + date).
//   direct kinds 0..2 (normal, silver, gold): bought by anyone along their own price curve, with a supply cap, a price premium for patterned
//     dates and an extra fee for the designed (special) dates;
//   class kinds 3..7 (bronze, rare, purple, diamond, legendary): minted by the owner, sold by auction or inside mystery boxes.
// Every kind has a supply cap that can only be lowered once the sale is open. The collection never changes: a new minter is authorised there
// with a public delay.

struct TierState {
    price: Int as coins;       // price right now (before time decay)
    floor: Int as coins;       // never below
    cap: Int as coins;         // never above
    bumpBps: Int as uint16;    // price goes up by this many basis points with every sale
    decayBps: Int as uint16;   // and falls by this many for every full day (24h) without enough sales
    lastDecayAt: Int as uint32;
    sold: Int as uint32;
}
struct WalletCount { day: Int as uint32; count: Int as uint16; k0: Int as uint16; k1: Int as uint16; k2: Int as uint16; }   // today's purchases, and the totals per direct kind
struct PendingMint { buyer: Address; amount: Int as coins; kind: Int as uint8; ticket: Int as uint16; }   // kind: 0 buy / owner mint, 1 auction, 2 ticket claim
struct Ticket { owner: Address; price: Int as coins; claimed: Bool; }
struct Auction {
    started: Bool;
    endAt: Int as uint32;
    reserve: Int as coins;
    highBid: Int as coins;
    highBidder: Address?;
    mediaRef: Int as uint256;  // the permanent picture chosen by the admin and shown to bidders (0 = none)
}

message(0x41540040) Configure {
    kind: Int as uint8;                // 0 normal, 1 silver, 2 gold
    startPrice: Int as coins;
    floor: Int as coins;
    cap: Int as coins;
    bumpBps: Int as uint16;
    decayBps: Int as uint16;
    maxSupply: Int as uint32;          // supply cap of this kind (afterwards only lowered)
    specialFee: Int as coins;          // extra price of a designed (special) date in this kind
    photoFee: Int as coins;            // extra price of putting your own photo on the token
    walletMax: Int as uint16;          // most tokens of this kind one wallet may buy from us (0 = no limit)
}
message(0x41540041) AddSpecial { items: map<Int as uint16, Int as uint8>; }
message(0x41540042) Open { startAt: Int as uint32; walletDailyCap: Int as uint16; }
message(0x41540043) SetPaused { paused: Bool; }
message(0x41540044) Buy { index: Int as uint64; recipient: Address?; occasion: Int as uint8; mediaRef: Int as uint256; style: Int as uint8; }   // index = token id; style: 0 generated art (free), 1 own photo (its kind's photo fee)
message(0x41540045) StartAuction { index: Int as uint64; reserve: Int as coins; duration: Int as uint32; mediaRef: Int as uint256; }
message(0x41540049) SetKindFees { kind: Int as uint8; photoFee: Int as coins; specialFee: Int as coins; }
message(0x4154004a) SetCap { kind: Int as uint8; cap: Int as uint32; }   // admin: the supply cap of a kind; before opening any value, afterwards only a lower one
message(0x41540046) Bid { index: Int as uint64; }
message(0x41540065) Reprice { kind: Int as uint8; floor: Int as coins; cap: Int as coins; }   // admin, any time after opening: move the price band of a kind (15 = mystery tickets)
message(0x41540047) Settle { index: Int as uint64; }
message(0x41540048) Sweep { }
message(0x41540050) LoadPool { items: map<Int as uint16, Int as uint32>; }   // position -> token id
message(0x41540051) SetMystery { commitHash: Int as uint256; revealAt: Int as uint32; startPrice: Int as coins; floor: Int as coins; cap: Int as coins; bumpBps: Int as uint16; decayBps: Int as uint16; poolExpected: Int as uint16; }   // poolExpected: how many pool entries MUST arrive before the sale may open
message(0x41540052) BuyTicket { recipient: Address?; }
message(0x41540053) Reveal { secret: Int as uint256; }
message(0x41540054) ClaimTicket { ticket: Int as uint16; }
message(0x41540056) RevealPublic { }
message(0x41540057) AdminMint { index: Int as uint64; recipient: Address?; occasion: Int as uint8; mediaRef: Int as uint256; }   // admin: any kind of any date straight to a wallet (his stock for a market), no sale price; counts against the supply cap
message(0x41540055) TransferTicket { ticket: Int as uint16; newOwner: Address; }

contract AtharMinter {
    collection: Address;
    admin: Address;
    seasonId: Int as uint16;
    rangeStart: Int as uint64;
    rangeEnd: Int as uint64;
    init(collection: Address, admin: Address, seasonId: Int, rangeStart: Int, rangeEnd: Int) {
        self.collection = collection;
        self.admin = admin;
        self.seasonId = seasonId;
        self.rangeStart = rangeStart;
        self.rangeEnd = rangeEnd;
    }
    tiers: map<Int as uint8, TierState>;           // price curve per direct kind (0..2) and for the mystery tickets (KEY_TICKETS)
    special: map<Int as uint16, Int as uint8>;     // designed dates (by date): they cost the kind's special fee on top
    sold: map<Int as uint32, Bool>;                // by token id
    pending: map<Int as uint32, PendingMint>;
    reserved: map<Int as uint32, Bool>;            // token ids held back for mystery boxes
    pool: map<Int as uint16, Int as uint32>;       // position -> token id (the published composition)
    tickets: map<Int as uint16, Ticket>;
    poolSize: Int as uint16 = 0;
    poolExpected: Int as uint16 = 0;               // declared by the admin with the commitment; Open refuses a smaller (partly loaded) pool
    poolLoaded: Int as uint16 = 0;                 // how many pool entries really arrived (must equal poolSize before opening)
    ticketsSold: Int as uint16 = 0;
    commitHash: Int as uint256 = 0;                // sha256(secret), published before the first ticket is sold
    revealAt: Int as uint32 = 0;
    revealed: Bool = false;
    permA: Int as uint32 = 1;
    permB: Int as uint32 = 0;
    auctions: map<Int as uint32, Auction>;
    auctionIds: map<Int as uint16, Int as uint32>; // every token id that ever had an auction, in order (so the app can list them without guessing)
    auctionCount: Int as uint16 = 0;
    wallets: map<Address, WalletCount>;
    status: Int as uint8 = 0;                      // 0 draft, 1 open, 2 paused
    startAt: Int as uint32 = 0;
    walletDailyCap: Int as uint16 = 0;
    soldCount: Int as uint32 = 0;
    caps: map<Int as uint8, Int as uint32>;        // supply cap per kind: lowered only once open
    issuedBy: map<Int as uint8, Int as uint32>;    // tokens of the kind sold, in flight, reserved for boxes or under auction
    photoFees: map<Int as uint8, Int as coins>;    // extra price of an own photo, per direct kind
    specialFees: map<Int as uint8, Int as coins>;  // extra price of a designed date, per direct kind
    walletMax: map<Int as uint8, Int as uint16>;   // most tokens of a direct kind one wallet may buy from us
    lockedBids: Int as coins = 0;                  // money of live auction bids that Sweep must never touch (high bid + fee margin of every unsettled auction)
    ticketsOpen: Int as uint16 = 0;                // sold tickets not yet claimed: each needs MINT_FEES kept here for its claim

    receive() { }

    // ---------- set-up (admin, before opening) ----------
    receive(msg: Configure) {
        require(sender() == self.admin, "only admin");
        require(self.status == 0, "already open");
        require(msg.kind <= KIND_GOLD, "direct kinds are 0 normal, 1 silver, 2 gold");
        require(msg.floor > 0 && msg.floor <= msg.startPrice && msg.startPrice <= msg.cap, "bad price bounds");
        require(msg.bumpBps <= 2000 && msg.decayBps <= 5000, "bad rates");
        require(msg.maxSupply > 0, "a supply cap is required");
        require(msg.photoFee <= 2000000000 && msg.specialFee <= 100000000000, "fee too high");
        self.tiers.set(msg.kind, TierState{ price: msg.startPrice, floor: msg.floor, cap: msg.cap, bumpBps: msg.bumpBps, decayBps: msg.decayBps, lastDecayAt: 0, sold: 0 });
        self.caps.set(msg.kind, msg.maxSupply);
        self.photoFees.set(msg.kind, msg.photoFee);
        self.specialFees.set(msg.kind, msg.specialFee);
        self.walletMax.set(msg.kind, msg.walletMax);
    }
    receive(msg: SetKindFees) {
        require(sender() == self.admin, "only admin");
        require(msg.kind <= KIND_GOLD, "direct kinds only");
        require(msg.photoFee <= 2000000000 && msg.specialFee <= 100000000000, "fee too high");   // photo never above 2 TON, special never above 100 TON
        self.photoFees.set(msg.kind, msg.photoFee);
        self.specialFees.set(msg.kind, msg.specialFee);
    }
    // The supply cap of a kind. Before opening: any value (every kind must have one). After opening: only a LOWER value, never below what is
    // already issued, so a cap that was announced can never be raised, not even by the owner.
    receive(msg: SetCap) {
        require(sender() == self.admin, "only admin");
        require(msg.kind <= MAX_KIND && msg.cap > 0, "bad cap");
        let cur: Int? = self.caps.get(msg.kind);
        if (self.status != 0) {
            require(cur != null && msg.cap < cur!!, "a cap can only be lowered");
        }
        let used: Int? = self.issuedBy.get(msg.kind);
        if (used != null) { require(msg.cap >= used!!, "below what is already issued"); }
        self.caps.set(msg.kind, msg.cap);
    }
    // The price band can follow the market after opening: new floor and cap (never below 0.05 TON or above 2000 TON); the current
    // price is pulled inside the new band. Kinds: 0 normal, 1 silver, 2 gold, 15 mystery tickets.
    receive(msg: Reprice) {
        require(sender() == self.admin, "only admin");
        require(self.status != 0, "set the prices before opening with Configure");
        require(msg.kind <= KIND_GOLD || msg.kind == KEY_TICKETS, "bad kind");
        require(msg.floor >= 50000000 && msg.floor <= msg.cap && msg.cap <= 2000000000000, "bad price bounds");
        let t: TierState? = self.tiers.get(msg.kind);
        require(t != null, "kind not set");
        let u: TierState = t!!;
        u.floor = msg.floor;
        u.cap = msg.cap;
        if (u.price < u.floor) { u.price = u.floor; }
        if (u.price > u.cap) { u.price = u.cap; }
        self.tiers.set(msg.kind, u);
    }
    receive(msg: AddSpecial) {
        require(sender() == self.admin, "only admin");
        require(self.status == 0, "already open");
        foreach (k, v in msg.items) {
            require(k >= 0 && k <= MAX_INDEX && v >= 0 && v <= TIER_MYTHIC, "bad special");
            self.special.set(k, v);
        }
    }
    receive(msg: Open) {
        require(sender() == self.admin, "only admin");
        require(self.status == 0, "already open");
        require(self.tiers.get(KIND_NORMAL) != null && self.tiers.get(KIND_SILVER) != null && self.tiers.get(KIND_GOLD) != null, "configure normal, silver and gold first");
        let k: Int = 0;
        repeat (8) {
            require(self.caps.get(k) != null, "every kind needs a supply cap");
            k = k + 1;
        }
        require(self.poolLoaded == self.poolSize && self.poolLoaded == self.poolExpected, "mystery pool incomplete");
        self.status = 1;
        self.startAt = msg.startAt;
        self.walletDailyCap = msg.walletDailyCap;
        let j: Int = 0;
        repeat (3) {
            let c: TierState = self.tiers.get(j)!!;
            c.lastDecayAt = msg.startAt;
            self.tiers.set(j, c);
            j = j + 1;
        }
    }
    receive(msg: SetPaused) {
        require(sender() == self.admin, "only admin");
        require(self.status != 0, "not open yet");
        if (msg.paused) { self.status = 2; } else { self.status = 1; }
    }

    // ---------- price curve ----------
    // Price rises with every sale and falls every full day: it settles where demand matches the target pace.
    fun priceNow(t: TierState): Int {
        let p: Int = t.price;
        if (now() > t.lastDecayAt && t.lastDecayAt > 0) {
            let days: Int = (now() - t.lastDecayAt) / DAY;
            if (days > 120) { days = 120; }
            repeat (days) {
                p = p * (10000 - t.decayBps) / 10000;
                if (p < t.floor) { p = t.floor; }
            }
        }
        if (p < t.floor) { p = t.floor; }
        return p;
    }

    // What a direct token costs: the kind's curve price, times the premium of a patterned date (rare pattern x1.5, mythic pattern x2),
    // plus the kind's special fee when the date is a designed one.
    fun priceFor(id: Int, base: Int): Int {
        let kind: Int = idKind(id);
        let date: Int = idDate(id);
        let p: Int = base;
        let r: Int = ruleTier(date);
        if (r == TIER_MYTHIC) { p = base * 2; }
        if (r == TIER_RARE) { p = base * 3 / 2; }
        if (self.special.get(date) != null) {
            let f: Int? = self.specialFees.get(kind);
            if (f != null) { p = p + f!!; }
        }
        return p;
    }

    fun inSeason(date: Int): Bool {
        if (date >= self.rangeStart && date <= self.rangeEnd) { return true; }
        return self.special.get(date) != null;
    }

    fun isOpenNow(): Bool {
        return self.status == 1 && now() >= self.startAt;
    }

    // one more token of the kind: refused above the cap
    fun takeSupply(kind: Int) {
        let cap: Int? = self.caps.get(kind);
        require(cap != null, "no supply cap for this kind");
        let used: Int = 0;
        let u: Int? = self.issuedBy.get(kind);
        if (u != null) { used = u!!; }
        require(used < cap!!, "this kind is sold out");
        self.issuedBy.set(kind, used + 1);
    }
    fun giveSupply(kind: Int) {
        let u: Int? = self.issuedBy.get(kind);
        if (u != null && u!! > 0) { self.issuedBy.set(kind, u!! - 1); }
    }

    // ---------- direct purchase (normal, silver, gold) ----------
    receive(msg: Buy) {
        let ctx: Context = context();
        require(self.isOpenNow(), "sale is not open");
        require(validId(msg.index), "bad token id");
        let kind: Int = idKind(msg.index);
        let date: Int = idDate(msg.index);
        require(kind <= KIND_GOLD, "this kind is not sold directly");
        require(self.inSeason(date), "date not in this season");
        require(self.sold.get(msg.index) == null && self.pending.get(msg.index) == null, "date already taken");
        require(self.reserved.get(msg.index) == null, "this date is inside the mystery boxes");
        require(msg.style <= 1, "bad style");
        require((msg.mediaRef != 0) == (msg.style == 1), "a picture of your own costs its fee: style 1 with a picture, style 0 without");   // so a picture can never be bound for free
        require(msg.occasion <= 9, "bad occasion");
        let t: TierState = self.tiers.get(kind)!!;
        let base: Int = self.priceNow(t);
        let price: Int = self.priceFor(msg.index, base);
        let extra: Int = 0;
        if (msg.style == 1) { extra = self.photoFees.get(kind)!!; }
        require(ctx.value >= price + extra + BUY_FEES, "send price + fees");

        let buyer: Address = ctx.sender;
        let recipient: Address = buyer;
        if (msg.recipient != null) { recipient = msg.recipient!!; }

        // per-wallet limits (anti-bot, anti-hoarding): a daily limit and a total per kind
        let today: Int = now() / DAY;
        let w: WalletCount = WalletCount{ day: today, count: 0, k0: 0, k1: 0, k2: 0 };
        let cur: WalletCount? = self.wallets.get(buyer);
        if (cur != null) {
            w = cur!!;
            if (w.day != today) { w.day = today; w.count = 0; }
        }
        if (self.walletDailyCap > 0) { require(w.count < self.walletDailyCap, "daily limit reached for this wallet"); }
        let wm: Int = 0;
        let wmv: Int? = self.walletMax.get(kind);
        if (wmv != null) { wm = wmv!!; }
        if (kind == 0) { if (wm > 0) { require(w.k0 < wm, "limit of this kind reached for this wallet"); } w.k0 = w.k0 + 1; }
        if (kind == 1) { if (wm > 0) { require(w.k1 < wm, "limit of this kind reached for this wallet"); } w.k1 = w.k1 + 1; }
        if (kind == 2) { if (wm > 0) { require(w.k2 < wm, "limit of this kind reached for this wallet"); } w.k2 = w.k2 + 1; }
        w.count = w.count + 1;
        self.wallets.set(buyer, w);
        self.takeSupply(kind);

        // move the price: decay is applied for whole days elapsed, then this sale bumps it
        let days: Int = 0;
        if (t.lastDecayAt > 0 && now() > t.lastDecayAt) { days = (now() - t.lastDecayAt) / DAY; }
        let np: Int = base * (10000 + t.bumpBps) / 10000;
        if (np > t.cap) { np = t.cap; }
        t.price = np;
        t.lastDecayAt = t.lastDecayAt + days * DAY;
        t.sold = t.sold + 1;
        self.tiers.set(kind, t);

        self.pending.set(msg.index, PendingMint{ buyer: buyer, amount: price + extra + MINT_FEES, kind: 0, ticket: 0 });
        send(SendParameters{
            to: self.collection, value: price + extra + MINT_FEES, mode: SendPayGasSeparately, bounce: true,
            body: MintItem{ index: msg.index, newOwner: recipient, season: self.seasonId, tier: kind, paid: price, occasion: msg.occasion, mediaRef: msg.mediaRef, remit: price + extra }.toCell()
        });
        let refund: Int = ctx.value - price - extra - BUY_FEES;
        if (refund > 10000000) {
            send(SendParameters{ to: buyer, value: refund, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false, body: "athar change".asComment() });
        }
    }

    // ---------- the owner's own mints ----------
    // Any kind of any date straight to a wallet of the admin's choice (normally his own, to list on a market, or a class token for an auction
    // he runs elsewhere) without paying a sale price: it does not move a price curve and does not count against a wallet limit, but it DOES count
    // against the kind's supply cap. The same availability rules as everywhere (not taken, not inside the mystery boxes, not under auction).
    // The admin pays only the network fees (BUY_FEES; what is not used comes back).
    receive(msg: AdminMint) {
        let ctx: Context = context();
        require(sender() == self.admin, "only admin");
        require(self.isOpenNow(), "sale is not open");
        require(validId(msg.index), "bad token id");
        let kind: Int = idKind(msg.index);
        require(self.inSeason(idDate(msg.index)), "date not in this season");
        require(self.sold.get(msg.index) == null && self.pending.get(msg.index) == null, "date already taken");
        require(self.auctions.get(msg.index) == null, "this token is sold by auction");
        require(self.reserved.get(msg.index) == null, "this token is inside the mystery boxes");
        require(msg.occasion <= 9, "bad occasion");
        require(ctx.value >= BUY_FEES, "send the fees");
        self.takeSupply(kind);
        let recipient: Address = ctx.sender;
        if (msg.recipient != null) { recipient = msg.recipient!!; }
        self.pending.set(msg.index, PendingMint{ buyer: ctx.sender, amount: MINT_FEES, kind: 0, ticket: 0 });
        send(SendParameters{
            to: self.collection, value: MINT_FEES, mode: SendPayGasSeparately, bounce: true,
            body: MintItem{ index: msg.index, newOwner: recipient, season: self.seasonId, tier: kind, paid: 0, occasion: msg.occasion, mediaRef: msg.mediaRef, remit: 0 }.toCell()
        });
        let refund: Int = ctx.value - BUY_FEES;
        if (refund > 10000000) {
            send(SendParameters{ to: ctx.sender, value: refund, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false, body: "athar change".asComment() });
        }
    }

    receive(msg: MintOk) {
        require(sender() == self.collection, "only collection");
        self.pending.set(msg.index, null);
        self.sold.set(msg.index, true);
        self.soldCount = self.soldCount + 1;
    }

    // the collection refused the mint: give the money back and free the token
    bounced(msg: bounced<MintItem>) {
        let p: PendingMint? = self.pending.get(msg.index);
        if (p == null) { return; }
        self.pending.set(msg.index, null);
        if (p!!.kind == 1) {
            // settlement failed: the auction stays open to settle again once the cause is fixed
            let a: Auction = self.auctions.get(msg.index)!!;
            let a2: Auction = Auction{ started: true, endAt: a.endAt, reserve: a.reserve, highBid: a.highBid, highBidder: a.highBidder, mediaRef: a.mediaRef };
            self.auctions.set(msg.index, a2);
            self.lockedBids = self.lockedBids + a.highBid + BUY_FEES;   // the money came back with the bounce: protect it again
        } else if (p!!.kind == 2) {
            // claim failed: the ticket can be claimed again
            let tk: Ticket = self.tickets.get(p!!.ticket)!!;
            self.tickets.set(p!!.ticket, Ticket{ owner: tk.owner, price: tk.price, claimed: false });
            self.ticketsOpen = self.ticketsOpen + 1;
        } else {
            self.giveSupply(idKind(msg.index));
            send(SendParameters{ to: p!!.buyer, value: p!!.amount, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false, body: "athar refund".asComment() });
        }
    }

    // ---------- the owner's classes: English auction with anti-sniping ----------
    receive(msg: StartAuction) {
        require(sender() == self.admin, "only admin");
        require(self.isOpenNow(), "sale is not open");
        require(validId(msg.index), "bad token id");
        require(idKind(msg.index) >= KIND_BRONZE, "only the classes (bronze to legendary) are auctioned");
        require(self.inSeason(idDate(msg.index)), "date not in this season");
        require(self.reserved.get(msg.index) == null, "this token is inside the mystery boxes");
        require(self.sold.get(msg.index) == null && self.pending.get(msg.index) == null, "date already taken");
        require(msg.reserve > 0 && msg.duration >= 3600 && msg.duration <= 365 * DAY, "bad auction");
        let cur: Auction? = self.auctions.get(msg.index);
        require(cur == null || (cur!!.highBidder == null && now() >= cur!!.endAt), "auction already exists");
        if (cur == null) {                                           // a voided auction that is restarted keeps its place under the cap
            self.takeSupply(idKind(msg.index));
            self.auctionIds.set(self.auctionCount, msg.index);
            self.auctionCount = self.auctionCount + 1;
        }
        self.auctions.set(msg.index, Auction{ started: true, endAt: now() + msg.duration, reserve: msg.reserve, highBid: 0, highBidder: null, mediaRef: msg.mediaRef });
    }

    receive(msg: Bid) {
        let ctx: Context = context();
        let a: Auction? = self.auctions.get(msg.index);
        require(a != null && a!!.started && now() < a!!.endAt, "no live auction");
        let au: Auction = a!!;
        let bid: Int = ctx.value - BUY_FEES;
        let minBid: Int = au.reserve;
        if (au.highBidder != null) { minBid = au.highBid + au.highBid / 20 + 1; }   // +5%
        require(bid >= minBid, "bid too low");
        if (au.highBidder != null) {
            send(SendParameters{ to: au.highBidder!!, value: au.highBid + BUY_FEES, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false, body: "athar outbid".asComment() });
        }
        let prevLocked: Int = 0;
        if (au.highBidder != null) { prevLocked = au.highBid + BUY_FEES; }
        self.lockedBids = self.lockedBids + ctx.value - prevLocked;
        au.highBid = bid;
        au.highBidder = ctx.sender;
        if (au.endAt - now() < 300) { au.endAt = now() + 300; }       // anti-sniping extension
        self.auctions.set(msg.index, au);
    }

    receive(msg: Settle) {
        let a: Auction? = self.auctions.get(msg.index);
        require(a != null && a!!.started && now() >= a!!.endAt, "auction not finished");
        let au: Auction = a!!;
        require(self.pending.get(msg.index) == null && self.sold.get(msg.index) == null, "already settled");
        if (au.highBidder == null) {                // nobody bid: auction is void, can be restarted
            au.started = false;
            self.auctions.set(msg.index, au);
            return;
        }
        au.started = false;                         // blocks a second settle until MintOk / bounce
        self.auctions.set(msg.index, au);
        self.lockedBids = self.lockedBids - (au.highBid + BUY_FEES);
        self.pending.set(msg.index, PendingMint{ buyer: au.highBidder!!, amount: au.highBid + BUY_FEES, kind: 1, ticket: 0 });
        send(SendParameters{
            to: self.collection, value: au.highBid + MINT_FEES, mode: SendPayGasSeparately, bounce: true,
            body: MintItem{ index: msg.index, newOwner: au.highBidder!!, season: self.seasonId, tier: idKind(msg.index), paid: au.highBid, occasion: 0, mediaRef: au.mediaRef, remit: au.highBid }.toCell()
        });
    }

    // dust left by gas margins goes to the admin
    receive(msg: Sweep) {
        require(sender() == self.admin, "only admin");
        // keep what is owed: every live bid (so outbid refunds and the winner's mint still work) and the mint fee of every unclaimed ticket
        nativeReserve(MIN_STORAGE + self.lockedBids + self.ticketsOpen * MINT_FEES, 2);
        send(SendParameters{ to: self.admin, value: 0, mode: SendRemainingBalance | SendIgnoreErrors, bounce: false, body: "athar sweep".asComment() });
    }


    // ---------- mystery boxes (fair reveal) ----------
    // 1) before selling, the admin publishes the pool (which tokens, of any kind, hence the exact odds) and sha256(secret)
    // 2) tickets are sold along the same rising/falling price curve
    // 3) after revealAt the admin reveals `secret`; it is mixed with the chain's own random seed at that moment,
    //    so nobody (including the admin) can know or steer which ticket gets which token
    // 4) a ticket maps to pool[(a*ticket + b) mod size]; anyone may trigger the claim, the token goes to the ticket owner
    // Pool entries are counted against their kind's supply cap when they are loaded.
    receive(msg: LoadPool) {
        require(sender() == self.admin, "only admin");
        require(self.status == 0, "already open");
        foreach (pos, id in msg.items) {
            require(pos < 4000 && validId(id) && self.inSeason(idDate(id)), "bad pool entry");
            require(self.pool.get(pos) == null, "position already loaded");
            require(self.reserved.get(id) == null, "token already in the pool");
            self.takeSupply(idKind(id));
            self.pool.set(pos, id);
            self.poolLoaded = self.poolLoaded + 1;
            self.reserved.set(id, true);
            if (pos + 1 > self.poolSize) { self.poolSize = pos + 1; }
        }
    }
    receive(msg: SetMystery) {
        require(sender() == self.admin, "only admin");
        require(self.status == 0, "already open");
        require(msg.floor > 0 && msg.floor <= msg.startPrice && msg.startPrice <= msg.cap, "bad price bounds");
        require(msg.poolExpected > 0 && msg.poolExpected <= 4000, "bad pool size");
        self.commitHash = msg.commitHash;
        self.revealAt = msg.revealAt;
        self.poolExpected = msg.poolExpected;
        self.tiers.set(KEY_TICKETS, TierState{ price: msg.startPrice, floor: msg.floor, cap: msg.cap, bumpBps: msg.bumpBps, decayBps: msg.decayBps, lastDecayAt: 0, sold: 0 });
    }
    receive(msg: BuyTicket) {
        let ctx: Context = context();
        require(self.isOpenNow(), "sale is not open");
        require(self.tiers.get(KEY_TICKETS) != null && self.poolSize > 0, "mystery boxes not configured");
        require(now() < self.revealAt && !self.revealed, "ticket sale is over");
        require(self.ticketsSold < self.poolSize, "all tickets sold");
        let t: TierState = self.tiers.get(KEY_TICKETS)!!;
        let price: Int = self.priceNow(t);
        require(ctx.value >= price + BUY_FEES, "send price + fees");
        let owner: Address = ctx.sender;
        if (msg.recipient != null) { owner = msg.recipient!!; }
        let days: Int = 0;
        if (t.lastDecayAt > 0 && now() > t.lastDecayAt) { days = (now() - t.lastDecayAt) / DAY; }
        let np: Int = price * (10000 + t.bumpBps) / 10000;
        let capped: Int = np;
        if (capped > t.cap) { capped = t.cap; }
        self.tiers.set(KEY_TICKETS, TierState{ price: capped, floor: t.floor, cap: t.cap, bumpBps: t.bumpBps, decayBps: t.decayBps, lastDecayAt: t.lastDecayAt + days * DAY, sold: t.sold + 1 });
        self.tickets.set(self.ticketsSold, Ticket{ owner: owner, price: price, claimed: false });
        self.ticketsSold = self.ticketsSold + 1;
        self.ticketsOpen = self.ticketsOpen + 1;
        // the price goes to the owner's wallet through the collection; the mint fees stay here until the claim
        send(SendParameters{ to: self.collection, value: price, mode: SendPayGasSeparately, bounce: false, body: Proceeds{}.toCell() });
        let refund: Int = ctx.value - price - BUY_FEES;
        if (refund > 10000000) {
            send(SendParameters{ to: ctx.sender, value: refund, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false, body: "athar change".asComment() });
        }
    }
    receive(msg: TransferTicket) {
        let tk: Ticket? = self.tickets.get(msg.ticket);
        require(tk != null && tk!!.owner == sender() && !tk!!.claimed, "not your open ticket");
        self.tickets.set(msg.ticket, Ticket{ owner: msg.newOwner, price: tk!!.price, claimed: false });
    }
    receive(msg: Reveal) {
        require(sender() == self.admin, "only admin");
        require(!self.revealed, "already revealed");
        require(now() >= self.revealAt && self.commitHash != 0, "too early");
        require(sha256(beginCell().storeUint(msg.secret, 256).endCell().asSlice()) == self.commitHash, "wrong secret");
        self.doReveal(msg.secret);
    }
    // Safety net: if the admin never reveals (lost secret, absent), after 3 days ANYONE can trigger the reveal.
    // It then uses only the chain's own random seed: still fair, and the boxes can never be stuck.
    receive(msg: RevealPublic) {
        require(!self.revealed, "already revealed");
        require(self.poolSize > 0 && now() >= self.revealAt + 3 * DAY, "too early for the public reveal");
        self.doReveal(0);
    }
    fun doReveal(secret: Int) {
        nativeRandomizeLt();
        let r: Int = randomInt();
        let seed: Int = sha256(beginCell().storeUint(secret, 256).storeUint(r, 256).endCell().asSlice());
        let n: Int = self.poolSize;
        let a: Int = 1;
        if (n > 1) { a = 1 + seed % (n - 1); }
        let guard: Int = 0;
        while (gcd(a, n) != 1 && guard < n + 2) { a = a % n + 1; guard = guard + 1; }
        self.permA = a;
        self.permB = (seed / 18446744073709551616) % n;
        self.revealed = true;
    }
    receive(msg: ClaimTicket) {
        require(self.revealed, "not revealed yet");
        let tk: Ticket? = self.tickets.get(msg.ticket);
        require(tk != null && !tk!!.claimed, "no open ticket");
        let pos: Int = (self.permA * msg.ticket + self.permB) % self.poolSize;
        let id: Int = self.pool.get(pos)!!;
        require(self.pending.get(id) == null && self.sold.get(id) == null, "already issued");
        self.tickets.set(msg.ticket, Ticket{ owner: tk!!.owner, price: tk!!.price, claimed: true });
        self.ticketsOpen = self.ticketsOpen - 1;
        self.pending.set(id, PendingMint{ buyer: tk!!.owner, amount: MINT_FEES, kind: 2, ticket: msg.ticket });
        send(SendParameters{
            to: self.collection, value: MINT_FEES, mode: SendPayGasSeparately, bounce: true,
            body: MintItem{ index: id, newOwner: tk!!.owner, season: self.seasonId, tier: idKind(id), paid: tk!!.price, occasion: 0, mediaRef: 0, remit: 0 }.toCell()
        });
    }

    // ---------- getters ----------
    get fun status(): Int { return self.status; }
    get fun mystery_info(): MysteryInfo { return MysteryInfo{ poolSize: self.poolSize, loaded: self.poolLoaded, ticketsSold: self.ticketsSold, revealed: self.revealed, revealAt: self.revealAt, commitHash: self.commitHash, a: self.permA, b: self.permB }; }
    get fun pool_at(pos: Int): Int? { return self.pool.get(pos); }
    get fun ticket_of(ticket: Int): Ticket? { return self.tickets.get(ticket); }
    get fun ticket_date(ticket: Int): Int? {         // the token id this ticket will receive (after the reveal)
        if (!self.revealed || self.poolSize == 0) { return null; }
        return self.pool.get((self.permA * ticket + self.permB) % self.poolSize);
    }
    get fun sold_count(): Int { return self.soldCount; }
    get fun is_taken(id: Int): Bool { return self.sold.get(id) != null || self.pending.get(id) != null; }
    get fun in_season(date: Int): Bool { return self.inSeason(date); }
    get fun is_special(date: Int): Bool { return self.special.get(date) != null; }
    get fun price(kind: Int): Int {                  // the kind's curve price right now (before any premium)
        let t: TierState? = self.tiers.get(kind);
        if (t == null) { return 0; }
        return self.priceNow(t!!);
    }
    get fun price_of(id: Int): Int {                 // what this token costs now, premium and special fee included (0 = not for direct sale)
        if (!validId(id) || idKind(id) > KIND_GOLD) { return 0; }
        let t: TierState? = self.tiers.get(idKind(id));
        if (t == null) { return 0; }
        return self.priceFor(id, self.priceNow(t!!));
    }
    get fun auction_of(id: Int): Auction? { return self.auctions.get(id); }
    get fun auction_count(): Int { return self.auctionCount; }
    get fun auction_id_at(pos: Int): Int? { return self.auctionIds.get(pos); }
    // Everything the app needs to draw one date, in a single read: which kinds of this date are taken / under a live auction / inside the boxes
    // (bit k = kind k), and what the three direct kinds cost right now (0 = not for direct sale).
    get fun date_view(date: Int): DateView {
        let taken: Int = 0;
        let auction: Int = 0;
        let reserved: Int = 0;
        let k: Int = 0;
        repeat (8) {
            let id: Int = k * 65536 + date;
            if (self.sold.get(id) != null || self.pending.get(id) != null) { taken = taken | (1 << k); }
            let a: Auction? = self.auctions.get(id);
            if (a != null && a!!.started) { auction = auction | (1 << k); }
            if (self.reserved.get(id) != null) { reserved = reserved | (1 << k); }
            k = k + 1;
        }
        return DateView{ taken: taken, auction: auction, reserved: reserved, p0: self.price_of(date), p1: self.price_of(65536 + date), p2: self.price_of(131072 + date), special: self.special.get(date) != null };
    }
    get fun kind_info(kind: Int): KindInfo {
        let cap: Int = 0;
        let c: Int? = self.caps.get(kind);
        if (c != null) { cap = c!!; }
        let used: Int = 0;
        let u: Int? = self.issuedBy.get(kind);
        if (u != null) { used = u!!; }
        let photo: Int = 0;
        let pf: Int? = self.photoFees.get(kind);
        if (pf != null) { photo = pf!!; }
        let spec: Int = 0;
        let sf: Int? = self.specialFees.get(kind);
        if (sf != null) { spec = sf!!; }
        let wm: Int = 0;
        let wv: Int? = self.walletMax.get(kind);
        if (wv != null) { wm = wv!!; }
        return KindInfo{ cap: cap, issued: used, photo: photo, special: spec, walletMax: wm };
    }
    get fun wallet_info(who: Address): WalletInfo {
        let w: WalletCount? = self.wallets.get(who);
        if (w == null) { return WalletInfo{ today: 0, k0: 0, k1: 0, k2: 0 }; }
        let today: Int = w!!.count;
        if (w!!.day != now() / DAY) { today = 0; }
        return WalletInfo{ today: today, k0: w!!.k0, k1: w!!.k1, k2: w!!.k2 };
    }
}

struct DateView { taken: Int; auction: Int; reserved: Int; p0: Int; p1: Int; p2: Int; special: Bool; }
struct KindInfo { cap: Int; issued: Int; photo: Int; special: Int; walletMax: Int; }
struct WalletInfo { today: Int; k0: Int; k1: Int; k2: Int; }
struct MysteryInfo { poolSize: Int; loaded: Int; ticketsSold: Int; revealed: Bool; revealAt: Int; commitHash: Int; a: Int; b: Int; }

fun gcd(a: Int, b: Int): Int {
    let x: Int = a;
    let y: Int = b;
    while (y != 0) {
        let t: Int = x % y;
        x = y;
        y = t;
    }
    return x;
}
