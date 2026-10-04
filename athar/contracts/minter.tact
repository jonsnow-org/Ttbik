import "./messages";
import "./tier";

// A season "minter": the sale logic of one season (price curve, wallet limits, mythic auctions).
// The collection never changes: a new season is a new minter that the admin authorises with a public delay.

struct TierState {
    price: Int as coins;       // price right now (before time decay)
    floor: Int as coins;       // never below
    cap: Int as coins;         // never above
    bumpBps: Int as uint16;    // price goes up by this many basis points with every sale
    decayBps: Int as uint16;   // and falls by this many for every full day (24h) without enough sales
    lastDecayAt: Int as uint32;
    sold: Int as uint32;
}
struct WalletCount { day: Int as uint32; count: Int as uint16; }
struct PendingMint { buyer: Address; amount: Int as coins; kind: Int as uint8; ticket: Int as uint16; }   // kind: 0 buy, 1 auction, 2 ticket claim
struct Ticket { owner: Address; price: Int as coins; claimed: Bool; }
struct Auction {
    started: Bool;
    endAt: Int as uint32;
    reserve: Int as coins;
    highBid: Int as coins;
    highBidder: Address?;
    mediaRef: Int as uint256;  // the permanent picture of a special date, chosen by the admin and shown to bidders (0 = none)
}

message(0x41540040) Configure {
    tier: Int as uint8;
    startPrice: Int as coins;
    floor: Int as coins;
    cap: Int as coins;
    bumpBps: Int as uint16;
    decayBps: Int as uint16;
}
message(0x41540041) AddSpecial { items: map<Int as uint16, Int as uint8>; }
message(0x41540042) Open { startAt: Int as uint32; walletDailyCap: Int as uint16; }
message(0x41540043) SetPaused { paused: Bool; }
message(0x41540044) Buy { index: Int as uint64; recipient: Address?; occasion: Int as uint8; mediaRef: Int as uint256; style: Int as uint8; }   // style: 0 generated art (free), 1 own photo, 2 own photo in waxed silver
message(0x41540045) StartAuction { index: Int as uint64; reserve: Int as coins; duration: Int as uint32; mediaRef: Int as uint256; }
message(0x41540049) SetFees { photoFee: Int as coins; silverFee: Int as coins; }
message(0x41540046) Bid { index: Int as uint64; }
message(0x41540047) Settle { index: Int as uint64; }
message(0x41540048) Sweep { }
message(0x41540050) LoadPool { items: map<Int as uint16, Int as uint16>; }
message(0x41540051) SetMystery { commitHash: Int as uint256; revealAt: Int as uint32; startPrice: Int as coins; floor: Int as coins; cap: Int as coins; bumpBps: Int as uint16; decayBps: Int as uint16; }
message(0x41540052) BuyTicket { recipient: Address?; }
message(0x41540053) Reveal { secret: Int as uint256; }
message(0x41540054) ClaimTicket { ticket: Int as uint16; }
message(0x41540056) RevealPublic { }
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
    tiers: map<Int as uint8, TierState>;
    special: map<Int as uint16, Int as uint8>;     // historic dates etc.: index -> tier override
    sold: map<Int as uint16, Bool>;
    pending: map<Int as uint16, PendingMint>;
    reserved: map<Int as uint16, Bool>;            // dates held back for mystery boxes
    pool: map<Int as uint16, Int as uint16>;       // position -> date index (the published composition)
    tickets: map<Int as uint16, Ticket>;
    poolSize: Int as uint16 = 0;
    poolLoaded: Int as uint16 = 0;                 // how many pool entries really arrived (must equal poolSize before opening)
    ticketsSold: Int as uint16 = 0;
    commitHash: Int as uint256 = 0;                // sha256(secret), published before the first ticket is sold
    revealAt: Int as uint32 = 0;
    revealed: Bool = false;
    permA: Int as uint32 = 1;
    permB: Int as uint32 = 0;
    auctions: map<Int as uint16, Auction>;
    wallets: map<Address, WalletCount>;
    status: Int as uint8 = 0;                      // 0 draft, 1 open, 2 paused
    startAt: Int as uint32 = 0;
    walletDailyCap: Int as uint16 = 0;
    soldCount: Int as uint32 = 0;
    photoFee: Int as coins = 0;                    // extra price of putting your own photo on the token
    silverFee: Int as coins = 0;                   // extra price of the waxed-silver treatment of that photo

    receive() { }

    // ---------- set-up (admin, before opening) ----------
    receive(msg: Configure) {
        require(sender() == self.admin, "only admin");
        require(self.status == 0, "already open");
        require(msg.tier == TIER_COMMON || msg.tier == TIER_RARE, "tier is priced by curve: common or rare");
        require(msg.floor > 0 && msg.floor <= msg.startPrice && msg.startPrice <= msg.cap, "bad price bounds");
        require(msg.bumpBps <= 2000 && msg.decayBps <= 5000, "bad rates");
        self.tiers.set(msg.tier, TierState{ price: msg.startPrice, floor: msg.floor, cap: msg.cap, bumpBps: msg.bumpBps, decayBps: msg.decayBps, lastDecayAt: 0, sold: 0 });
    }
    receive(msg: SetFees) {
        require(sender() == self.admin, "only admin");
        require(msg.photoFee <= 2000000000 && msg.silverFee <= 2000000000, "fee too high");   // never above 2 TON each
        require(msg.silverFee >= msg.photoFee, "silver includes the photo");
        self.photoFee = msg.photoFee;
        self.silverFee = msg.silverFee;
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
        require(self.tiers.get(TIER_COMMON) != null && self.tiers.get(TIER_RARE) != null, "configure common and rare first");
        require(self.poolLoaded == self.poolSize, "mystery pool incomplete");
        self.status = 1;
        self.startAt = msg.startAt;
        self.walletDailyCap = msg.walletDailyCap;
        let c: TierState = self.tiers.get(TIER_COMMON)!!;
        c.lastDecayAt = msg.startAt;
        self.tiers.set(TIER_COMMON, c);
        let r: TierState = self.tiers.get(TIER_RARE)!!;
        r.lastDecayAt = msg.startAt;
        self.tiers.set(TIER_RARE, r);
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

    fun tierOfIndex(index: Int): Int {
        let s: Int? = self.special.get(index);
        if (s != null) { return s!!; }
        return ruleTier(index);
    }

    fun inSeason(index: Int): Bool {
        if (index >= self.rangeStart && index <= self.rangeEnd) { return true; }
        return self.special.get(index) != null;
    }

    fun isOpenNow(): Bool {
        return self.status == 1 && now() >= self.startAt;
    }

    // ---------- direct purchase (common and rare) ----------
    receive(msg: Buy) {
        let ctx: Context = context();
        require(self.isOpenNow(), "sale is not open");
        require(msg.index >= 0 && msg.index <= MAX_INDEX && self.inSeason(msg.index), "date not in this season");
        require(self.sold.get(msg.index) == null && self.pending.get(msg.index) == null, "date already taken");
        require(self.auctions.get(msg.index) == null, "this date is sold by auction");
        require(self.reserved.get(msg.index) == null, "this date is inside the mystery boxes");
        let tier: Int = self.tierOfIndex(msg.index);
        require(tier != TIER_MYTHIC && self.special.get(msg.index) == null, "mythic and special dates are sold by auction");
        require(msg.style <= 2, "bad style");
        let t: TierState = self.tiers.get(tier)!!;
        let price: Int = self.priceNow(t);
        let extra: Int = 0;
        if (msg.style == 1) { extra = self.photoFee; }
        if (msg.style == 2) { extra = self.silverFee; }
        require(ctx.value >= price + extra + BUY_FEES, "send price + fees");

        let buyer: Address = ctx.sender;
        let recipient: Address = buyer;
        if (msg.recipient != null) { recipient = msg.recipient!!; }

        // per-wallet daily limit (anti-bot, first days)
        if (self.walletDailyCap > 0) {
            let today: Int = now() / DAY;
            let w: WalletCount = WalletCount{ day: today, count: 0 };
            let cur: WalletCount? = self.wallets.get(buyer);
            if (cur != null && cur!!.day == today) { w = cur!!; }
            require(w.count < self.walletDailyCap, "daily limit reached for this wallet");
            w.count = w.count + 1;
            self.wallets.set(buyer, w);
        }

        // move the price: decay is applied for whole days elapsed, then this sale bumps it
        let days: Int = 0;
        if (t.lastDecayAt > 0 && now() > t.lastDecayAt) { days = (now() - t.lastDecayAt) / DAY; }
        let np: Int = price * (10000 + t.bumpBps) / 10000;
        if (np > t.cap) { np = t.cap; }
        t.price = np;
        t.lastDecayAt = t.lastDecayAt + days * DAY;
        t.sold = t.sold + 1;
        self.tiers.set(tier, t);

        self.pending.set(msg.index, PendingMint{ buyer: buyer, amount: price + extra + MINT_FEES, kind: 0, ticket: 0 });
        send(SendParameters{
            to: self.collection, value: price + extra + MINT_FEES, mode: SendPayGasSeparately, bounce: true,
            body: MintItem{ index: msg.index, newOwner: recipient, season: self.seasonId, tier: tier, paid: price, occasion: msg.occasion, mediaRef: msg.mediaRef, remit: price + extra }.toCell()
        });
        let refund: Int = ctx.value - price - extra - BUY_FEES;
        if (refund > 10000000) {
            send(SendParameters{ to: buyer, value: refund, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false, body: "athar change".asComment() });
        }
    }

    receive(msg: MintOk) {
        require(sender() == self.collection, "only collection");
        self.pending.set(msg.index, null);
        self.sold.set(msg.index, true);
        self.soldCount = self.soldCount + 1;
    }

    // the collection refused the mint: give the money back and free the date
    bounced(msg: bounced<MintItem>) {
        let p: PendingMint? = self.pending.get(msg.index);
        if (p == null) { return; }
        self.pending.set(msg.index, null);
        if (p!!.kind == 1) {
            // settlement failed: the auction stays open to settle again once the cause is fixed
            let a: Auction = self.auctions.get(msg.index)!!;
            let a2: Auction = Auction{ started: true, endAt: a.endAt, reserve: a.reserve, highBid: a.highBid, highBidder: a.highBidder, mediaRef: a.mediaRef };
            self.auctions.set(msg.index, a2);
        } else if (p!!.kind == 2) {
            // claim failed: the ticket can be claimed again
            let tk: Ticket = self.tickets.get(p!!.ticket)!!;
            self.tickets.set(p!!.ticket, Ticket{ owner: tk.owner, price: tk.price, claimed: false });
        } else {
            send(SendParameters{ to: p!!.buyer, value: p!!.amount, mode: SendPayGasSeparately | SendIgnoreErrors, bounce: false, body: "athar refund".asComment() });
        }
    }

    // ---------- mythic dates: English auction with anti-sniping ----------
    receive(msg: StartAuction) {
        require(sender() == self.admin, "only admin");
        require(self.isOpenNow(), "sale is not open");
        require(self.inSeason(msg.index), "date not in this season");
        require(self.tierOfIndex(msg.index) == TIER_MYTHIC || self.special.get(msg.index) != null, "only mythic or special dates");
        require(self.reserved.get(msg.index) == null, "this date is inside the mystery boxes");
        require(self.sold.get(msg.index) == null && self.pending.get(msg.index) == null, "date already taken");
        require(msg.reserve > 0 && msg.duration >= 3600 && msg.duration <= 365 * DAY, "bad auction");
        let cur: Auction? = self.auctions.get(msg.index);
        require(cur == null || (cur!!.highBidder == null && now() >= cur!!.endAt), "auction already exists");
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
        self.pending.set(msg.index, PendingMint{ buyer: au.highBidder!!, amount: au.highBid + BUY_FEES, kind: 1, ticket: 0 });
        send(SendParameters{
            to: self.collection, value: au.highBid + MINT_FEES, mode: SendPayGasSeparately, bounce: true,
            body: MintItem{ index: msg.index, newOwner: au.highBidder!!, season: self.seasonId, tier: self.tierOfIndex(msg.index), paid: au.highBid, occasion: 0, mediaRef: au.mediaRef, remit: au.highBid }.toCell()
        });
    }

    // dust left by gas margins goes to the admin
    receive(msg: Sweep) {
        require(sender() == self.admin, "only admin");
        nativeReserve(MIN_STORAGE + self.soldCount * 0, 0);
        send(SendParameters{ to: self.admin, value: 0, mode: SendRemainingBalance | SendIgnoreErrors, bounce: false, body: "athar sweep".asComment() });
    }


    // ---------- mystery boxes (fair reveal) ----------
    // 1) before selling, the admin publishes the pool (which dates, hence the exact odds) and sha256(secret)
    // 2) tickets are sold along the same rising/falling price curve
    // 3) after revealAt the admin reveals `secret`; it is mixed with the chain's own random seed at that moment,
    //    so nobody (including the admin) can know or steer which ticket gets which date
    // 4) a ticket maps to pool[(a*ticket + b) mod size]; anyone may trigger the claim, the token goes to the ticket owner
    receive(msg: LoadPool) {
        require(sender() == self.admin, "only admin");
        require(self.status == 0, "already open");
        foreach (pos, date in msg.items) {
            require(pos < 4000 && date <= MAX_INDEX && self.inSeason(date), "bad pool entry");
            require(self.pool.get(pos) == null, "position already loaded");
            self.pool.set(pos, date);
            self.poolLoaded = self.poolLoaded + 1;
            self.reserved.set(date, true);
            if (pos + 1 > self.poolSize) { self.poolSize = pos + 1; }
        }
    }
    receive(msg: SetMystery) {
        require(sender() == self.admin, "only admin");
        require(self.status == 0, "already open");
        require(msg.floor > 0 && msg.floor <= msg.startPrice && msg.startPrice <= msg.cap, "bad price bounds");
        self.commitHash = msg.commitHash;
        self.revealAt = msg.revealAt;
        self.tiers.set(3, TierState{ price: msg.startPrice, floor: msg.floor, cap: msg.cap, bumpBps: msg.bumpBps, decayBps: msg.decayBps, lastDecayAt: 0, sold: 0 });
    }
    receive(msg: BuyTicket) {
        let ctx: Context = context();
        require(self.isOpenNow(), "sale is not open");
        require(self.tiers.get(3) != null && self.poolSize > 0, "mystery boxes not configured");
        require(now() < self.revealAt && !self.revealed, "ticket sale is over");
        require(self.ticketsSold < self.poolSize, "all tickets sold");
        let t: TierState = self.tiers.get(3)!!;
        let price: Int = self.priceNow(t);
        require(ctx.value >= price + BUY_FEES, "send price + fees");
        let owner: Address = ctx.sender;
        if (msg.recipient != null) { owner = msg.recipient!!; }
        let days: Int = 0;
        if (t.lastDecayAt > 0 && now() > t.lastDecayAt) { days = (now() - t.lastDecayAt) / DAY; }
        let np: Int = price * (10000 + t.bumpBps) / 10000;
        let capped: Int = np;
        if (capped > t.cap) { capped = t.cap; }
        self.tiers.set(3, TierState{ price: capped, floor: t.floor, cap: t.cap, bumpBps: t.bumpBps, decayBps: t.decayBps, lastDecayAt: t.lastDecayAt + days * DAY, sold: t.sold + 1 });
        self.tickets.set(self.ticketsSold, Ticket{ owner: owner, price: price, claimed: false });
        self.ticketsSold = self.ticketsSold + 1;
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
        let date: Int = self.pool.get(pos)!!;
        require(self.pending.get(date) == null && self.sold.get(date) == null, "already issued");
        self.tickets.set(msg.ticket, Ticket{ owner: tk!!.owner, price: tk!!.price, claimed: true });
        self.pending.set(date, PendingMint{ buyer: tk!!.owner, amount: MINT_FEES, kind: 2, ticket: msg.ticket });
        send(SendParameters{
            to: self.collection, value: MINT_FEES, mode: SendPayGasSeparately, bounce: true,
            body: MintItem{ index: date, newOwner: tk!!.owner, season: self.seasonId, tier: self.tierOfIndex(date), paid: tk!!.price, occasion: 0, mediaRef: 0, remit: 0 }.toCell()
        });
    }

    // ---------- getters ----------
    get fun status(): Int { return self.status; }
    get fun mystery_info(): MysteryInfo { return MysteryInfo{ poolSize: self.poolSize, loaded: self.poolLoaded, ticketsSold: self.ticketsSold, revealed: self.revealed, revealAt: self.revealAt, commitHash: self.commitHash, a: self.permA, b: self.permB }; }
    get fun pool_at(pos: Int): Int? { return self.pool.get(pos); }
    get fun ticket_of(ticket: Int): Ticket? { return self.tickets.get(ticket); }
    get fun ticket_date(ticket: Int): Int? {
        if (!self.revealed || self.poolSize == 0) { return null; }
        return self.pool.get((self.permA * ticket + self.permB) % self.poolSize);
    }
    get fun sold_count(): Int { return self.soldCount; }
    get fun tier_of(index: Int): Int { return self.tierOfIndex(index); }
    get fun is_taken(index: Int): Bool { return self.sold.get(index) != null || self.pending.get(index) != null; }
    get fun in_season(index: Int): Bool { return self.inSeason(index); }
    get fun price(tier: Int): Int {
        let t: TierState? = self.tiers.get(tier);
        if (t == null) { return 0; }
        return self.priceNow(t!!);
    }
    get fun auction_of(index: Int): Auction? { return self.auctions.get(index); }
    get fun fees(): FeeInfo { return FeeInfo{ photo: self.photoFee, silver: self.silverFee }; }
}

struct FeeInfo { photo: Int; silver: Int; }
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
