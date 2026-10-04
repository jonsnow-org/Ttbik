// Shared messages and constants for Athar (Edition 1).
// Date index = days since 1950-01-01 (0 .. 36524). The NFT index IS the date index.

const MAX_INDEX: Int = 36524;
const TIER_COMMON: Int = 0;
const TIER_RARE: Int = 1;
const TIER_MYTHIC: Int = 2;

const ITEM_FUND: Int = 80000000;        // 0.08 TON travels with every mint (item deploy + its storage)
const MINTER_GAS: Int = 20000000;       // 0.02 TON kept by the minter per purchase
const OK_VALUE: Int = 10000000;         // 0.01 TON: collection -> minter "mint done" notice
const COLL_GAS: Int = 20000000;         // 0.02 TON kept by the collection per mint
const MINT_FEES: Int = 130000000;       // ITEM_FUND + OK_VALUE + COLL_GAS (collection side)
const BUY_FEES: Int = 150000000;        // MINT_FEES + MINTER_GAS: what a buyer pays on top of the price
const ENGRAVE_FEE: Int = 100000000;     // 0.1 TON per engraving
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
}
message(0x41540002) MintItem {
    index: Int as uint64;
    newOwner: Address;
    season: Int as uint16;
    tier: Int as uint8;
    paid: Int as coins;
}
message(0x41540003) Proceeds { }                         // item -> collection: engraving fee, forwarded to payout at once
message(0x41540005) MintOk { index: Int as uint64; }     // collection -> minter: the token exists
message(0x41540004) Engrave { text: String; }            // owner -> item (value >= ENGRAVE_FEE)

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
