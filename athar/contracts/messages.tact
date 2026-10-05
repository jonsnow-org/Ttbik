// Shared messages and constants for Athar (Edition 1).
// Date index = days since 1950-01-01 (0 .. 36524). The NFT index IS the date index.

const MAX_INDEX: Int = 36524;
const TIER_COMMON: Int = 0;
const TIER_RARE: Int = 1;
const TIER_MYTHIC: Int = 2;

const ITEM_FUND: Int = 30000000;        // 0.03 TON travels with every mint (item deploy + its storage: about 0.0025 TON a year, and every transfer tops it up)
const MINTER_GAS: Int = 20000000;       // 0.02 TON kept by the minter per purchase
const OK_VALUE: Int = 10000000;         // 0.01 TON: collection -> minter "mint done" notice
const COLL_GAS: Int = 20000000;         // 0.02 TON kept by the collection per mint
const MINT_FEES: Int = 60000000;        // ITEM_FUND + OK_VALUE + COLL_GAS (collection side)
const BUY_FEES: Int = 80000000;         // MINT_FEES + MINTER_GAS: what a buyer pays on top of the price
const ENGRAVE_FEE: Int = 100000000;     // 0.1 TON per engraving
const MEDIA_FEE: Int = 100000000;       // 0.1 TON to attach or change the token's picture / occasion
const MIN_STORAGE: Int = 50000000;      // 0.05 TON stays in contracts for storage
const DAY: Int = 86400;

// ---- TEP-62 ----
message(0x5fcc3d14) Transfer {
    queryId: Int as uint64;
    newOwner: Address;
    responseDestination: Address?;
    customPayload: Cell?;
    forwardAmount: Int as coins;
    forwardPayload: Slice as remaining;
}
message(0x05138d91) OwnershipAssigned {
    queryId: Int as uint64;
    prevOwner: Address;
    forwardPayload: Slice as remaining;
}
message(0xd53276db) Excesses { queryId: Int as uint64; }
message(0x2fcb26a2) GetStaticData { queryId: Int as uint64; }
message(0x8b771735) ReportStaticData {
    queryId: Int as uint64;
    index: Int;
    collection: Address;
}

struct NftData {
    isInitialized: Bool;
    index: Int;
    collectionAddress: Address;
    ownerAddress: Address;
    individualContent: Cell;
}
struct CollectionData {
    nextItemIndex: Int;
    collectionContent: Cell;
    ownerAddress: Address;
}
struct RoyaltyParams {
    numerator: Int;
    denominator: Int;
    destination: Address;
}

// ---- Athar: collection <-> item ----
message(0x41540001) ItemInit {
    owner: Address;
    season: Int as uint16;
    tier: Int as uint8;
    paid: Int as coins;
    mintedAt: Int as uint32;
    occasion: Int as uint8;        // 0 none, 1 birthday, 2 wedding, 3 newborn, 4 graduation, 5 anniversary, 6 memorial, ... (meaning lives in the app)
    mediaRef: Int as uint256;      // permanent picture: the Arweave transaction id (32 bytes), 0 = the generated art
}
message(0x41540002) MintItem {
    index: Int as uint64;
    newOwner: Address;
    season: Int as uint16;
    tier: Int as uint8;
    paid: Int as coins;       // what the buyer paid, recorded in the token
    occasion: Int as uint8;
    mediaRef: Int as uint256;
    remit: Int as coins;      // money forwarded to the payout wallet now (0 when the money was taken earlier, e.g. mystery tickets)
}
message(0x41540003) Proceeds { }                         // item -> collection: engraving fee, forwarded to payout at once
message(0x41540005) MintOk { index: Int as uint64; }     // collection -> minter: the token exists

// ---- upgrade (burn to a higher edition). Two phases so a token is never lost ----
message(0x41540010) UpgradeStart { queryId: Int as uint64; }          // owner -> item (carries the upgrade price + gas)
message(0x41540011) UpgradeRequest {                                   // item -> collection
    index: Int as uint64;
    owner: Address;
    season: Int as uint16;
    tier: Int as uint8;
    paid: Int as coins;
    mintedAt: Int as uint32;
    hands: Int as uint32;
    engravings: Cell?;
    occasion: Int as uint8;
    mediaRef: Int as uint256;
    mediaLog: Cell?;
}
message(0x41540012) UpgradeAccept {                                    // collection -> successor edition
    index: Int as uint64;
    owner: Address;
    season: Int as uint16;
    tier: Int as uint8;
    paid: Int as coins;
    mintedAt: Int as uint32;
    hands: Int as uint32;
    engravings: Cell?;
    occasion: Int as uint8;
    mediaRef: Int as uint256;
    mediaLog: Cell?;
}
message(0x41540013) UpgradeDone { index: Int as uint64; }              // successor -> collection (new token issued)
message(0x41540014) BurnConfirm { }                                    // collection -> item
message(0x41540015) UpgradeAbort { index: Int as uint64; }             // collection -> item (unlock)

// ---- admin on collection ----
message(0x41540020) ProposeMinter { minter: Address; }
message(0x41540021) RemoveMinter { minter: Address; }
message(0x41540022) ProposePayout { payout: Address; }
message(0x41540023) ApplyPayout { }
message(0x41540024) ProposeBaseUri { uri: String; }
message(0x41540025) ApplyBaseUri { }
message(0x41540026) SetSuccessor { successor: Address; }
message(0x41540027) Withdraw { }
message(0x41540028) ProposeCode { code: Cell; }      // admin: new logic for the collection (same data layout); applies only after the public notice period
message(0x41540029) ApplyCode { }
message(0x4154002a) CancelCode { }

// ---- engraving and picture changes go through the collection, which holds the (adjustable) fees ----
message(0x41540070) EngraveReq { index: Int as uint64; text: String; }                                    // owner -> collection (value >= engraveFee + gas)
message(0x41540071) EngraveFrom { owner: Address; text: String; fee: Int as coins; }                      // collection -> item
message(0x41540072) SetMediaReq { index: Int as uint64; occasion: Int as uint8; mediaRef: Int as uint256; }   // owner -> collection
message(0x41540073) SetMediaFrom { owner: Address; occasion: Int as uint8; mediaRef: Int as uint256; firstFee: Int as coins; changeFee: Int as coins; }   // collection -> item: replacing an existing picture costs changeFee
message(0x41540074) SetItemFees { engraveFee: Int as coins; mediaFee: Int as coins; changeFee: Int as coins; }   // admin -> collection (each at most 5 TON)
struct ItemFees { engrave: Int; media: Int; change: Int; }
const REQ_GAS: Int = 60000000;          // 0.06 TON: gas of the two hops of an engraving / picture change (the rest comes back)
