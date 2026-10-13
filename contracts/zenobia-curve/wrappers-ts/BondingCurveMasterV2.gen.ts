// AUTO-GENERATED, do not edit
// It's a TypeScript wrapper for a BondingCurveMasterV2 contract in Tolk.
/* eslint-disable */

import * as c from '@ton/core';
import { beginCell, ContractProvider, Sender, SendMode } from '@ton/core';

// ————————————————————————————————————————————
//   predefined types and functions
//

type StoreCallback<T> = (obj: T, b: c.Builder) => void
type LoadCallback<T> = (s: c.Slice) => T

export type CellRef<T> = {
    ref: T
}

function makeCellFrom<T>(self: T, storeFn_T: StoreCallback<T>): c.Cell {
    let b = beginCell();
    storeFn_T(self, b);
    return b.endCell();
}

function loadAndCheckPrefix32(s: c.Slice, expected: number, structName: string): void {
    let prefix = s.loadUint(32);
    if (prefix !== expected) {
        throw new Error(`Incorrect prefix for '${structName}': expected 0x${expected.toString(16).padStart(8, '0')}, got 0x${prefix.toString(16).padStart(8, '0')}`);
    }
}

function lookupPrefix(s: c.Slice, expected: number, prefixLen: number): boolean {
    return s.remainingBits >= prefixLen && s.preloadUint(prefixLen) === expected;
}

function throwNonePrefixMatch(fieldPath: string): never {
    throw new Error(`Incorrect prefix for '${fieldPath}': none of variants matched`);
}

function storeCellRef<T>(cell: CellRef<T>, b: c.Builder, storeFn_T: StoreCallback<T>): void {
    let b_ref = c.beginCell();
    storeFn_T(cell.ref, b_ref);
    b.storeRef(b_ref.endCell());
}

function loadCellRef<T>(s: c.Slice, loadFn_T: LoadCallback<T>): CellRef<T> {
    let s_ref = s.loadRef().beginParse();
    return { ref: loadFn_T(s_ref) };
}

function storeTolkNullable<T>(v: T | null, b: c.Builder, storeFn_T: StoreCallback<T>): void {
    if (v === null) {
        b.storeUint(0, 1);
    } else {
        b.storeUint(1, 1);
        storeFn_T(v, b);
    }
}

// ————————————————————————————————————————————
//   parse get methods result from a TVM stack
//

class StackReader {
    constructor(private tuple: c.TupleItem[]) {
    }

    static fromGetMethod(expectedN: number, getMethodResult: { stack: c.TupleReader }): StackReader {
        let tuple = [] as c.TupleItem[];
        while (getMethodResult.stack.remaining) {
            tuple.push(getMethodResult.stack.pop());
        }
        if (tuple.length !== expectedN) {
            throw new Error(`expected ${expectedN} stack width, got ${tuple.length}`);
        }
        return new StackReader(tuple);
    }

    private popExpecting<ItemT>(itemType: string): ItemT {
        const item = this.tuple.shift();
        if (item?.type === itemType) {
            return item as ItemT;
        }
        throw new Error(`not '${itemType}' on a stack`);
    }

    private popCellLike(): c.Cell {
        const item = this.tuple.shift();
        if (item && (item.type === 'cell' || item.type === 'slice' || item.type === 'builder')) {
            return item.cell;
        }
        throw new Error(`not cell/slice on a stack`);
    }

    readBigInt(): bigint {
        return this.popExpecting<c.TupleItemInt>('int').value;
    }

    readBoolean(): boolean {
        return this.popExpecting<c.TupleItemInt>('int').value !== 0n;
    }

    readCell(): c.Cell {
        return this.popCellLike();
    }

    readSlice(): c.Slice {
        return this.popCellLike().beginParse();
    }

    readNullable<T>(readFn_T: (r: StackReader) => T): T | null {
        if (this.tuple[0].type === 'null') {
            this.tuple.shift();
            return null;
        }
        return readFn_T(this);
    }
}

// ————————————————————————————————————————————
//   auto-generated serializers to/from cells
//

type coins = bigint

type uint2 = bigint
type uint8 = bigint
type uint16 = bigint
type uint64 = bigint
type uint256 = bigint

/**
 > struct (0xa0a0b001) CreateLaunch {
 >     queryId: uint64
 >     metadata: cell
 >     salt: uint64
 >     options: Cell<LaunchOptions>
 > }
 */
export interface CreateLaunch {
    readonly $: 'CreateLaunch'
    queryId: uint64
    metadata: c.Cell
    salt: uint64
    options: CellRef<LaunchOptions>
}

export const CreateLaunch = {
    PREFIX: 0xa0a0b001,

    create(args: {
        queryId: uint64
        metadata: c.Cell
        salt: uint64
        options: CellRef<LaunchOptions>
    }): CreateLaunch {
        return {
            $: 'CreateLaunch',
            ...args
        }
    },
    fromSlice(s: c.Slice): CreateLaunch {
        loadAndCheckPrefix32(s, 0xa0a0b001, 'CreateLaunch');
        return {
            $: 'CreateLaunch',
            queryId: s.loadUintBig(64),
            metadata: s.loadRef(),
            salt: s.loadUintBig(64),
            options: loadCellRef<LaunchOptions>(s, LaunchOptions.fromSlice),
        }
    },
    store(self: CreateLaunch, b: c.Builder): void {
        b.storeUint(0xa0a0b001, 32);
        b.storeUint(self.queryId, 64);
        b.storeRef(self.metadata);
        b.storeUint(self.salt, 64);
        storeCellRef<LaunchOptions>(self.options, b, LaunchOptions.store);
    },
    toCell(self: CreateLaunch): c.Cell {
        return makeCellFrom<CreateLaunch>(self, CreateLaunch.store);
    }
}

/**
 > struct (0xa0a0a002) ChangeMasterAdmin {
 >     queryId: uint64
 >     newAdmin: address
 > }
 */
export interface ChangeMasterAdmin {
    readonly $: 'ChangeMasterAdmin'
    queryId: uint64
    newAdmin: c.Address
}

export const ChangeMasterAdmin = {
    PREFIX: 0xa0a0a002,

    create(args: {
        queryId: uint64
        newAdmin: c.Address
    }): ChangeMasterAdmin {
        return {
            $: 'ChangeMasterAdmin',
            ...args
        }
    },
    fromSlice(s: c.Slice): ChangeMasterAdmin {
        loadAndCheckPrefix32(s, 0xa0a0a002, 'ChangeMasterAdmin');
        return {
            $: 'ChangeMasterAdmin',
            queryId: s.loadUintBig(64),
            newAdmin: s.loadAddress(),
        }
    },
    store(self: ChangeMasterAdmin, b: c.Builder): void {
        b.storeUint(0xa0a0a002, 32);
        b.storeUint(self.queryId, 64);
        b.storeAddress(self.newAdmin);
    },
    toCell(self: ChangeMasterAdmin): c.Cell {
        return makeCellFrom<ChangeMasterAdmin>(self, ChangeMasterAdmin.store);
    }
}

/**
 > struct (0xa0a0a003) ClaimMasterAdmin {
 >     queryId: uint64
 > }
 */
export interface ClaimMasterAdmin {
    readonly $: 'ClaimMasterAdmin'
    queryId: uint64
}

export const ClaimMasterAdmin = {
    PREFIX: 0xa0a0a003,

    create(args: {
        queryId: uint64
    }): ClaimMasterAdmin {
        return {
            $: 'ClaimMasterAdmin',
            ...args
        }
    },
    fromSlice(s: c.Slice): ClaimMasterAdmin {
        loadAndCheckPrefix32(s, 0xa0a0a003, 'ClaimMasterAdmin');
        return {
            $: 'ClaimMasterAdmin',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: ClaimMasterAdmin, b: c.Builder): void {
        b.storeUint(0xa0a0a003, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: ClaimMasterAdmin): c.Cell {
        return makeCellFrom<ClaimMasterAdmin>(self, ClaimMasterAdmin.store);
    }
}

/**
 > struct (0xa0a0a004) ChangeTreasury {
 >     queryId: uint64
 >     newTreasury: address
 > }
 */
export interface ChangeTreasury {
    readonly $: 'ChangeTreasury'
    queryId: uint64
    newTreasury: c.Address
}

export const ChangeTreasury = {
    PREFIX: 0xa0a0a004,

    create(args: {
        queryId: uint64
        newTreasury: c.Address
    }): ChangeTreasury {
        return {
            $: 'ChangeTreasury',
            ...args
        }
    },
    fromSlice(s: c.Slice): ChangeTreasury {
        loadAndCheckPrefix32(s, 0xa0a0a004, 'ChangeTreasury');
        return {
            $: 'ChangeTreasury',
            queryId: s.loadUintBig(64),
            newTreasury: s.loadAddress(),
        }
    },
    store(self: ChangeTreasury, b: c.Builder): void {
        b.storeUint(0xa0a0a004, 32);
        b.storeUint(self.queryId, 64);
        b.storeAddress(self.newTreasury);
    },
    toCell(self: ChangeTreasury): c.Cell {
        return makeCellFrom<ChangeTreasury>(self, ChangeTreasury.store);
    }
}

/**
 > struct (0xa0a0a005) WithdrawProtocolFees {
 >     queryId: uint64
 >     amount: coins
 > }
 */
export interface WithdrawProtocolFees {
    readonly $: 'WithdrawProtocolFees'
    queryId: uint64
    amount: coins
}

export const WithdrawProtocolFees = {
    PREFIX: 0xa0a0a005,

    create(args: {
        queryId: uint64
        amount: coins
    }): WithdrawProtocolFees {
        return {
            $: 'WithdrawProtocolFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): WithdrawProtocolFees {
        loadAndCheckPrefix32(s, 0xa0a0a005, 'WithdrawProtocolFees');
        return {
            $: 'WithdrawProtocolFees',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
        }
    },
    store(self: WithdrawProtocolFees, b: c.Builder): void {
        b.storeUint(0xa0a0a005, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
    },
    toCell(self: WithdrawProtocolFees): c.Cell {
        return makeCellFrom<WithdrawProtocolFees>(self, WithdrawProtocolFees.store);
    }
}

/**
 > struct (0xa0a0b006) DepositProtocolFees {
 >     queryId: uint64
 >     amount: coins
 >     creator: address
 >     salt: uint64
 >     options: Cell<LaunchOptions>
 > }
 */
export interface DepositProtocolFees {
    readonly $: 'DepositProtocolFees'
    queryId: uint64
    amount: coins
    creator: c.Address
    salt: uint64
    options: CellRef<LaunchOptions>
}

export const DepositProtocolFees = {
    PREFIX: 0xa0a0b006,

    create(args: {
        queryId: uint64
        amount: coins
        creator: c.Address
        salt: uint64
        options: CellRef<LaunchOptions>
    }): DepositProtocolFees {
        return {
            $: 'DepositProtocolFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): DepositProtocolFees {
        loadAndCheckPrefix32(s, 0xa0a0b006, 'DepositProtocolFees');
        return {
            $: 'DepositProtocolFees',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
            creator: s.loadAddress(),
            salt: s.loadUintBig(64),
            options: loadCellRef<LaunchOptions>(s, LaunchOptions.fromSlice),
        }
    },
    store(self: DepositProtocolFees, b: c.Builder): void {
        b.storeUint(0xa0a0b006, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
        b.storeAddress(self.creator);
        b.storeUint(self.salt, 64);
        storeCellRef<LaunchOptions>(self.options, b, LaunchOptions.store);
    },
    toCell(self: DepositProtocolFees): c.Cell {
        return makeCellFrom<DepositProtocolFees>(self, DepositProtocolFees.store);
    }
}

/**
 > struct (0xa0a0a014) ReinitializeCurve {
 >     queryId: uint64
 >     creator: address
 >     salt: uint64
 >     metadata: cell
 >     options: Cell<LaunchOptions>
 > }
 */
export interface ReinitializeCurve {
    readonly $: 'ReinitializeCurve'
    queryId: uint64
    creator: c.Address
    salt: uint64
    metadata: c.Cell
    options: CellRef<LaunchOptions>
}

export const ReinitializeCurve = {
    PREFIX: 0xa0a0a014,

    create(args: {
        queryId: uint64
        creator: c.Address
        salt: uint64
        metadata: c.Cell
        options: CellRef<LaunchOptions>
    }): ReinitializeCurve {
        return {
            $: 'ReinitializeCurve',
            ...args
        }
    },
    fromSlice(s: c.Slice): ReinitializeCurve {
        loadAndCheckPrefix32(s, 0xa0a0a014, 'ReinitializeCurve');
        return {
            $: 'ReinitializeCurve',
            queryId: s.loadUintBig(64),
            creator: s.loadAddress(),
            salt: s.loadUintBig(64),
            metadata: s.loadRef(),
            options: loadCellRef<LaunchOptions>(s, LaunchOptions.fromSlice),
        }
    },
    store(self: ReinitializeCurve, b: c.Builder): void {
        b.storeUint(0xa0a0a014, 32);
        b.storeUint(self.queryId, 64);
        b.storeAddress(self.creator);
        b.storeUint(self.salt, 64);
        b.storeRef(self.metadata);
        storeCellRef<LaunchOptions>(self.options, b, LaunchOptions.store);
    },
    toCell(self: ReinitializeCurve): c.Cell {
        return makeCellFrom<ReinitializeCurve>(self, ReinitializeCurve.store);
    }
}

/**
 > struct (0xa0a0a015) TreasuryPayout {
 >     queryId: uint64
 >     amount: coins
 > }
 */
export interface TreasuryPayout {
    readonly $: 'TreasuryPayout'
    queryId: uint64
    amount: coins
}

export const TreasuryPayout = {
    PREFIX: 0xa0a0a015,

    create(args: {
        queryId: uint64
        amount: coins
    }): TreasuryPayout {
        return {
            $: 'TreasuryPayout',
            ...args
        }
    },
    fromSlice(s: c.Slice): TreasuryPayout {
        loadAndCheckPrefix32(s, 0xa0a0a015, 'TreasuryPayout');
        return {
            $: 'TreasuryPayout',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
        }
    },
    store(self: TreasuryPayout, b: c.Builder): void {
        b.storeUint(0xa0a0a015, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
    },
    toCell(self: TreasuryPayout): c.Cell {
        return makeCellFrom<TreasuryPayout>(self, TreasuryPayout.store);
    }
}

/**
 > struct (0xa0a0a010) InitializeCurve {
 >     queryId: uint64
 >     jettonMinter: address
 >     refundTo: address?
 >     protocolTreasury: address
 > }
 */
export interface InitializeCurve {
    readonly $: 'InitializeCurve'
    queryId: uint64
    jettonMinter: c.Address
    refundTo: c.Address | null
    protocolTreasury: c.Address
}

export const InitializeCurve = {
    PREFIX: 0xa0a0a010,

    create(args: {
        queryId: uint64
        jettonMinter: c.Address
        refundTo: c.Address | null
        protocolTreasury: c.Address
    }): InitializeCurve {
        return {
            $: 'InitializeCurve',
            ...args
        }
    },
    fromSlice(s: c.Slice): InitializeCurve {
        loadAndCheckPrefix32(s, 0xa0a0a010, 'InitializeCurve');
        return {
            $: 'InitializeCurve',
            queryId: s.loadUintBig(64),
            jettonMinter: s.loadAddress(),
            refundTo: s.loadMaybeAddress(),
            protocolTreasury: s.loadAddress(),
        }
    },
    store(self: InitializeCurve, b: c.Builder): void {
        b.storeUint(0xa0a0a010, 32);
        b.storeUint(self.queryId, 64);
        b.storeAddress(self.jettonMinter);
        b.storeAddress(self.refundTo);
        b.storeAddress(self.protocolTreasury);
    },
    toCell(self: InitializeCurve): c.Cell {
        return makeCellFrom<InitializeCurve>(self, InitializeCurve.store);
    }
}

/**
 > struct LaunchCreatedEvent {
 >     creator: address
 >     salt: uint64
 >     curveAddress: address
 >     minterAddress: address
 >     virtualTonReserve: coins
 > }
 */
export interface LaunchCreatedEvent {
    readonly $: 'LaunchCreatedEvent'
    creator: c.Address
    salt: uint64
    curveAddress: c.Address
    minterAddress: c.Address
    virtualTonReserve: coins
}

export const LaunchCreatedEvent = {
    create(args: {
        creator: c.Address
        salt: uint64
        curveAddress: c.Address
        minterAddress: c.Address
        virtualTonReserve: coins
    }): LaunchCreatedEvent {
        return {
            $: 'LaunchCreatedEvent',
            ...args
        }
    },
    fromSlice(s: c.Slice): LaunchCreatedEvent {
        return {
            $: 'LaunchCreatedEvent',
            creator: s.loadAddress(),
            salt: s.loadUintBig(64),
            curveAddress: s.loadAddress(),
            minterAddress: s.loadAddress(),
            virtualTonReserve: s.loadCoins(),
        }
    },
    store(self: LaunchCreatedEvent, b: c.Builder): void {
        b.storeAddress(self.creator);
        b.storeUint(self.salt, 64);
        b.storeAddress(self.curveAddress);
        b.storeAddress(self.minterAddress);
        b.storeCoins(self.virtualTonReserve);
    },
    toCell(self: LaunchCreatedEvent): c.Cell {
        return makeCellFrom<LaunchCreatedEvent>(self, LaunchCreatedEvent.store);
    }
}

/**
 > struct LaunchRolledBackEvent {
 >     refundTo: address
 >     curveAddress: address
 >     refundSent: bool
 >     refundAmount: coins
 > }
 */
export interface LaunchRolledBackEvent {
    readonly $: 'LaunchRolledBackEvent'
    refundTo: c.Address
    curveAddress: c.Address
    refundSent: boolean
    refundAmount: coins
}

export const LaunchRolledBackEvent = {
    create(args: {
        refundTo: c.Address
        curveAddress: c.Address
        refundSent: boolean
        refundAmount: coins
    }): LaunchRolledBackEvent {
        return {
            $: 'LaunchRolledBackEvent',
            ...args
        }
    },
    fromSlice(s: c.Slice): LaunchRolledBackEvent {
        return {
            $: 'LaunchRolledBackEvent',
            refundTo: s.loadAddress(),
            curveAddress: s.loadAddress(),
            refundSent: s.loadBoolean(),
            refundAmount: s.loadCoins(),
        }
    },
    store(self: LaunchRolledBackEvent, b: c.Builder): void {
        b.storeAddress(self.refundTo);
        b.storeAddress(self.curveAddress);
        b.storeBit(self.refundSent);
        b.storeCoins(self.refundAmount);
    },
    toCell(self: LaunchRolledBackEvent): c.Cell {
        return makeCellFrom<LaunchRolledBackEvent>(self, LaunchRolledBackEvent.store);
    }
}

/**
 > struct (0xa0a0b032) CancelLaunchFees {
 >     queryId: uint64
 >     creator: address
 >     salt: uint64
 >     options: Cell<LaunchOptions>
 > }
 */
export interface CancelLaunchFees {
    readonly $: 'CancelLaunchFees'
    queryId: uint64
    creator: c.Address
    salt: uint64
    options: CellRef<LaunchOptions>
}

export const CancelLaunchFees = {
    PREFIX: 0xa0a0b032,

    create(args: {
        queryId: uint64
        creator: c.Address
        salt: uint64
        options: CellRef<LaunchOptions>
    }): CancelLaunchFees {
        return {
            $: 'CancelLaunchFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): CancelLaunchFees {
        loadAndCheckPrefix32(s, 0xa0a0b032, 'CancelLaunchFees');
        return {
            $: 'CancelLaunchFees',
            queryId: s.loadUintBig(64),
            creator: s.loadAddress(),
            salt: s.loadUintBig(64),
            options: loadCellRef<LaunchOptions>(s, LaunchOptions.fromSlice),
        }
    },
    store(self: CancelLaunchFees, b: c.Builder): void {
        b.storeUint(0xa0a0b032, 32);
        b.storeUint(self.queryId, 64);
        b.storeAddress(self.creator);
        b.storeUint(self.salt, 64);
        storeCellRef<LaunchOptions>(self.options, b, LaunchOptions.store);
    },
    toCell(self: CancelLaunchFees): c.Cell {
        return makeCellFrom<CancelLaunchFees>(self, CancelLaunchFees.store);
    }
}

/**
 > struct (0xa0a0b033) ConfirmLaunch {
 >     queryId: uint64
 >     creator: address
 >     salt: uint64
 >     options: Cell<LaunchOptions>
 > }
 */
export interface ConfirmLaunch {
    readonly $: 'ConfirmLaunch'
    queryId: uint64
    creator: c.Address
    salt: uint64
    options: CellRef<LaunchOptions>
}

export const ConfirmLaunch = {
    PREFIX: 0xa0a0b033,

    create(args: {
        queryId: uint64
        creator: c.Address
        salt: uint64
        options: CellRef<LaunchOptions>
    }): ConfirmLaunch {
        return {
            $: 'ConfirmLaunch',
            ...args
        }
    },
    fromSlice(s: c.Slice): ConfirmLaunch {
        loadAndCheckPrefix32(s, 0xa0a0b033, 'ConfirmLaunch');
        return {
            $: 'ConfirmLaunch',
            queryId: s.loadUintBig(64),
            creator: s.loadAddress(),
            salt: s.loadUintBig(64),
            options: loadCellRef<LaunchOptions>(s, LaunchOptions.fromSlice),
        }
    },
    store(self: ConfirmLaunch, b: c.Builder): void {
        b.storeUint(0xa0a0b033, 32);
        b.storeUint(self.queryId, 64);
        b.storeAddress(self.creator);
        b.storeUint(self.salt, 64);
        storeCellRef<LaunchOptions>(self.options, b, LaunchOptions.store);
    },
    toCell(self: ConfirmLaunch): c.Cell {
        return makeCellFrom<ConfirmLaunch>(self, ConfirmLaunch.store);
    }
}

/**
 > struct LaunchOptions {
 >     supply: coins
 >     creatorFeeBps: uint16
 >     devBuyAmount: coins
 >     minDevTokens: coins
 >     graduationThreshold: coins
 >     reserveRatio: uint8
 >     minBuyBps: uint16
 >     maxBuyBps: uint16
 >     beneficiaries: Cell<FeeBeneficiaries>?
 >     buybackBurn: bool
 > }
 */
export interface LaunchOptions {
    readonly $: 'LaunchOptions'
    supply: coins
    creatorFeeBps: uint16
    devBuyAmount: coins
    minDevTokens: coins
    graduationThreshold: coins /* = 2000000000000 as coins */
    reserveRatio: uint8 /* = 5 */
    minBuyBps: uint16 /* = 0 */
    maxBuyBps: uint16 /* = 0 */
    beneficiaries: CellRef<FeeBeneficiaries> | null /* = null */
    buybackBurn: boolean /* = false */
}

export const LaunchOptions = {
    create(args: {
        supply: coins
        creatorFeeBps: uint16
        devBuyAmount: coins
        minDevTokens: coins
        graduationThreshold?: coins /* = 2000000000000 as coins */
        reserveRatio?: uint8 /* = 5 */
        minBuyBps?: uint16 /* = 0 */
        maxBuyBps?: uint16 /* = 0 */
        beneficiaries?: CellRef<FeeBeneficiaries> | null /* = null */
        buybackBurn?: boolean /* = false */
    }): LaunchOptions {
        return {
            $: 'LaunchOptions',
            graduationThreshold: 2000000000000n,
            reserveRatio: 5n,
            minBuyBps: 0n,
            maxBuyBps: 0n,
            beneficiaries: null,
            buybackBurn: false,
            ...args
        }
    },
    fromSlice(s: c.Slice): LaunchOptions {
        return {
            $: 'LaunchOptions',
            supply: s.loadCoins(),
            creatorFeeBps: s.loadUintBig(16),
            devBuyAmount: s.loadCoins(),
            minDevTokens: s.loadCoins(),
            graduationThreshold: s.loadCoins(),
            reserveRatio: s.loadUintBig(8),
            minBuyBps: s.loadUintBig(16),
            maxBuyBps: s.loadUintBig(16),
            beneficiaries: s.loadBoolean() ? loadCellRef<FeeBeneficiaries>(s, FeeBeneficiaries.fromSlice) : null,
            buybackBurn: s.loadBoolean(),
        }
    },
    store(self: LaunchOptions, b: c.Builder): void {
        b.storeCoins(self.supply);
        b.storeUint(self.creatorFeeBps, 16);
        b.storeCoins(self.devBuyAmount);
        b.storeCoins(self.minDevTokens);
        b.storeCoins(self.graduationThreshold);
        b.storeUint(self.reserveRatio, 8);
        b.storeUint(self.minBuyBps, 16);
        b.storeUint(self.maxBuyBps, 16);
        storeTolkNullable<CellRef<FeeBeneficiaries>>(self.beneficiaries, b,
            (v,b) => storeCellRef<FeeBeneficiaries>(v, b, FeeBeneficiaries.store)
        );
        b.storeBit(self.buybackBurn);
    },
    toCell(self: LaunchOptions): c.Cell {
        return makeCellFrom<LaunchOptions>(self, LaunchOptions.store);
    }
}

/**
 > struct MasterStorage {
 >     admin: address
 >     nextAdmin: address?
 >     treasury: address
 >     totalLaunches: uint64
 >     feesBalance: coins
 >     launches: map<uint256, uint2>
 > }
 */
export interface MasterStorage {
    readonly $: 'MasterStorage'
    admin: c.Address
    nextAdmin: c.Address | null
    treasury: c.Address
    totalLaunches: uint64
    feesBalance: coins
    launches: c.Dictionary<uint256, uint2> /* = [] as map<uint256, uint2> */
}

export const MasterStorage = {
    create(args: {
        admin: c.Address
        nextAdmin: c.Address | null
        treasury: c.Address
        totalLaunches: uint64
        feesBalance: coins
        launches: c.Dictionary<uint256, uint2> /* = [] as map<uint256, uint2> */
    }): MasterStorage {
        return {
            $: 'MasterStorage',
            ...args
        }
    },
    fromSlice(s: c.Slice): MasterStorage {
        return {
            $: 'MasterStorage',
            admin: s.loadAddress(),
            nextAdmin: s.loadMaybeAddress(),
            treasury: s.loadAddress(),
            totalLaunches: s.loadUintBig(64),
            feesBalance: s.loadCoins(),
            launches: c.Dictionary.load<uint256, uint2>(c.Dictionary.Keys.BigUint(256), c.Dictionary.Values.BigUint(2), s),
        }
    },
    store(self: MasterStorage, b: c.Builder): void {
        b.storeAddress(self.admin);
        b.storeAddress(self.nextAdmin);
        b.storeAddress(self.treasury);
        b.storeUint(self.totalLaunches, 64);
        b.storeCoins(self.feesBalance);
        b.storeDict<uint256, uint2>(self.launches, c.Dictionary.Keys.BigUint(256), c.Dictionary.Values.BigUint(2));
    },
    toCell(self: MasterStorage): c.Cell {
        return makeCellFrom<MasterStorage>(self, MasterStorage.store);
    }
}

/**
 > struct MasterDataReply {
 >     admin: address
 >     nextAdmin: address?
 >     treasury: address
 >     totalLaunches: uint64
 >     feesBalance: coins
 > }
 */
export interface MasterDataReply {
    readonly $: 'MasterDataReply'
    admin: c.Address
    nextAdmin: c.Address | null
    treasury: c.Address
    totalLaunches: uint64
    feesBalance: coins
}

export const MasterDataReply = {
    create(args: {
        admin: c.Address
        nextAdmin: c.Address | null
        treasury: c.Address
        totalLaunches: uint64
        feesBalance: coins
    }): MasterDataReply {
        return {
            $: 'MasterDataReply',
            ...args
        }
    },
    fromSlice(s: c.Slice): MasterDataReply {
        return {
            $: 'MasterDataReply',
            admin: s.loadAddress(),
            nextAdmin: s.loadMaybeAddress(),
            treasury: s.loadAddress(),
            totalLaunches: s.loadUintBig(64),
            feesBalance: s.loadCoins(),
        }
    },
    store(self: MasterDataReply, b: c.Builder): void {
        b.storeAddress(self.admin);
        b.storeAddress(self.nextAdmin);
        b.storeAddress(self.treasury);
        b.storeUint(self.totalLaunches, 64);
        b.storeCoins(self.feesBalance);
    },
    toCell(self: MasterDataReply): c.Cell {
        return makeCellFrom<MasterDataReply>(self, MasterDataReply.store);
    }
}

/**
 > struct LaunchPreview {
 >     minBuyTokens: coins
 >     maxBuyTokens: coins
 >     virtualTonReserve: coins
 >     graduationThreshold: coins
 >     soldTokens: coins
 >     poolTon: coins
 >     poolTokens: coins
 >     remainingTokens: coins
 >     initialPriceNanoPerBillion: int
 >     graduationPriceNanoPerBillion: int
 > }
 */
export interface LaunchPreview {
    readonly $: 'LaunchPreview'
    minBuyTokens: coins
    maxBuyTokens: coins
    virtualTonReserve: coins
    graduationThreshold: coins
    soldTokens: coins
    poolTon: coins
    poolTokens: coins
    remainingTokens: coins
    initialPriceNanoPerBillion: bigint
    graduationPriceNanoPerBillion: bigint
}

export const LaunchPreview = {
    create(args: {
        minBuyTokens: coins
        maxBuyTokens: coins
        virtualTonReserve: coins
        graduationThreshold: coins
        soldTokens: coins
        poolTon: coins
        poolTokens: coins
        remainingTokens: coins
        initialPriceNanoPerBillion: bigint
        graduationPriceNanoPerBillion: bigint
    }): LaunchPreview {
        return {
            $: 'LaunchPreview',
            ...args
        }
    },
    fromSlice(s: c.Slice): LaunchPreview {
        throw new Error(`Can't unpack 'LaunchPreview' from cell, because 'LaunchPreview.initialPriceNanoPerBillion' is 'int' (not int32/uint64/etc.)`);
    },
    store(self: LaunchPreview, b: c.Builder): void {
        throw new Error(`Can't pack 'LaunchPreview' to cell, because 'self.initialPriceNanoPerBillion' is 'int' (not int32/uint64/etc.)`);
    },
    toCell(self: LaunchPreview): c.Cell {
        return makeCellFrom<LaunchPreview>(self, LaunchPreview.store);
    }
}

/**
 > struct (0xd53276db) ReturnExcessesBack {
 >     queryId: uint64
 > }
 */
export interface ReturnExcessesBack {
    readonly $: 'ReturnExcessesBack'
    queryId: uint64
}

export const ReturnExcessesBack = {
    PREFIX: 0xd53276db,

    create(args: {
        queryId: uint64
    }): ReturnExcessesBack {
        return {
            $: 'ReturnExcessesBack',
            ...args
        }
    },
    fromSlice(s: c.Slice): ReturnExcessesBack {
        loadAndCheckPrefix32(s, 0xd53276db, 'ReturnExcessesBack');
        return {
            $: 'ReturnExcessesBack',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: ReturnExcessesBack, b: c.Builder): void {
        b.storeUint(0xd53276db, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: ReturnExcessesBack): c.Cell {
        return makeCellFrom<ReturnExcessesBack>(self, ReturnExcessesBack.store);
    }
}

/**
 > struct (0xd372158c) TopUpTons {
 > }
 */
export interface TopUpTons {
    readonly $: 'TopUpTons'
}

export const TopUpTons = {
    PREFIX: 0xd372158c,

    create(): TopUpTons {
        return {
            $: 'TopUpTons',
        }
    },
    fromSlice(s: c.Slice): TopUpTons {
        loadAndCheckPrefix32(s, 0xd372158c, 'TopUpTons');
        return {
            $: 'TopUpTons',
        }
    },
    store(self: TopUpTons, b: c.Builder): void {
        b.storeUint(0xd372158c, 32);
    },
    toCell(self: TopUpTons): c.Cell {
        return makeCellFrom<TopUpTons>(self, TopUpTons.store);
    }
}

/**
 > struct FeeBeneficiaries {
 >     shares: map<address, uint16>
 > }
 */
export interface FeeBeneficiaries {
    readonly $: 'FeeBeneficiaries'
    shares: c.Dictionary<c.Address, uint16>
}

export const FeeBeneficiaries = {
    create(args: {
        shares: c.Dictionary<c.Address, uint16>
    }): FeeBeneficiaries {
        return {
            $: 'FeeBeneficiaries',
            ...args
        }
    },
    fromSlice(s: c.Slice): FeeBeneficiaries {
        return {
            $: 'FeeBeneficiaries',
            shares: c.Dictionary.load<c.Address, uint16>(c.Dictionary.Keys.Address(), c.Dictionary.Values.BigUint(16), s),
        }
    },
    store(self: FeeBeneficiaries, b: c.Builder): void {
        b.storeDict<c.Address, uint16>(self.shares, c.Dictionary.Keys.Address(), c.Dictionary.Values.BigUint(16));
    },
    toCell(self: FeeBeneficiaries): c.Cell {
        return makeCellFrom<FeeBeneficiaries>(self, FeeBeneficiaries.store);
    }
}

// ————————————————————————————————————————————
//    class BondingCurveMasterV2
//

interface ExtraSendOptions {
    bounce?: boolean                    // default: false
    sendMode?: SendMode                 // default: SendMode.PAY_GAS_SEPARATELY
    extraCurrencies?: c.ExtraCurrency   // default: empty dict
}

interface DeployedAddrOptions {
    workchain?: number                  // default: 0 (basechain)
    toShard?: { fixedPrefixLength: number; closeTo: c.Address }
    overrideContractCode?: c.Cell
}

function calculateDeployedAddress(code: c.Cell, data: c.Cell, options: DeployedAddrOptions): c.Address {
    const stateInitCell = beginCell().store(c.storeStateInit({
        code,
        data,
        splitDepth: options.toShard?.fixedPrefixLength,
        special: null,
        libraries: null,
    })).endCell();

    let addrHash = stateInitCell.hash();
    if (options.toShard) {
        const shardDepth = options.toShard.fixedPrefixLength;
        addrHash = beginCell()
            .storeBits(new c.BitString(options.toShard.closeTo.hash, 0, shardDepth))
            .storeBits(new c.BitString(stateInitCell.hash(), shardDepth, 256 - shardDepth))
            .endCell()
            .beginParse().loadBuffer(32);
    }

    return new c.Address(options.workchain ?? 0, addrHash);
}

export class BondingCurveMasterV2 implements c.Contract {
    static CodeCell = c.Cell.fromBase64('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');

    static Errors = {
        'Errors.BalanceError': 47,
        'Errors.NotEnoughGas': 48,
        'Errors.InvalidMessage': 49,
        'Errors.InvalidOp': 72,
        'Errors.NotOwner': 73,
        'Errors.NotValidWallet': 74,
        'Errors.WrongWorkchain': 333,
    }

    readonly address: c.Address
    readonly init: { code: c.Cell, data: c.Cell } | undefined

    protected constructor(address: c.Address, init?: { code: c.Cell, data: c.Cell }) {
        this.address = address;
        this.init = init;
    }

    static fromAddress(address: c.Address) {
        return new BondingCurveMasterV2(address);
    }

    static fromStorage(emptyStorage: {
        admin: c.Address
        nextAdmin: c.Address | null
        treasury: c.Address
        totalLaunches: uint64
        feesBalance: coins
        launches: c.Dictionary<uint256, uint2> /* = [] as map<uint256, uint2> */
    }, deployedOptions?: DeployedAddrOptions) {
        const initialState = {
            code: deployedOptions?.overrideContractCode ?? BondingCurveMasterV2.CodeCell,
            data: MasterStorage.toCell(MasterStorage.create(emptyStorage)),
        };
        const address = calculateDeployedAddress(initialState.code, initialState.data, deployedOptions ?? {});
        return new BondingCurveMasterV2(address, initialState);
    }

    static createCellOfCreateLaunch(body: {
        queryId: uint64
        metadata: c.Cell
        salt: uint64
        options: CellRef<LaunchOptions>
    }) {
        return CreateLaunch.toCell(CreateLaunch.create(body));
    }

    static createCellOfConfirmLaunch(body: {
        queryId: uint64
        creator: c.Address
        salt: uint64
        options: CellRef<LaunchOptions>
    }) {
        return ConfirmLaunch.toCell(ConfirmLaunch.create(body));
    }

    static createCellOfCancelLaunchFees(body: {
        queryId: uint64
        creator: c.Address
        salt: uint64
        options: CellRef<LaunchOptions>
    }) {
        return CancelLaunchFees.toCell(CancelLaunchFees.create(body));
    }

    static createCellOfChangeMasterAdmin(body: {
        queryId: uint64
        newAdmin: c.Address
    }) {
        return ChangeMasterAdmin.toCell(ChangeMasterAdmin.create(body));
    }

    static createCellOfClaimMasterAdmin(body: {
        queryId: uint64
    }) {
        return ClaimMasterAdmin.toCell(ClaimMasterAdmin.create(body));
    }

    static createCellOfChangeTreasury(body: {
        queryId: uint64
        newTreasury: c.Address
    }) {
        return ChangeTreasury.toCell(ChangeTreasury.create(body));
    }

    static createCellOfWithdrawProtocolFees(body: {
        queryId: uint64
        amount: coins
    }) {
        return WithdrawProtocolFees.toCell(WithdrawProtocolFees.create(body));
    }

    static createCellOfDepositProtocolFees(body: {
        queryId: uint64
        amount: coins
        creator: c.Address
        salt: uint64
        options: CellRef<LaunchOptions>
    }) {
        return DepositProtocolFees.toCell(DepositProtocolFees.create(body));
    }

    static createCellOfReinitializeCurve(body: {
        queryId: uint64
        creator: c.Address
        salt: uint64
        metadata: c.Cell
        options: CellRef<LaunchOptions>
    }) {
        return ReinitializeCurve.toCell(ReinitializeCurve.create(body));
    }

    static createCellOfTopUpTons(body: {
    }) {
        return TopUpTons.toCell(TopUpTons.create());
    }

    async sendDeploy(provider: ContractProvider, via: Sender, msgValue: coins, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: c.Cell.EMPTY,
            ...extraOptions
        });
    }

    async sendCreateLaunch(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        metadata: c.Cell
        salt: uint64
        options: CellRef<LaunchOptions>
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: CreateLaunch.toCell(CreateLaunch.create(body)),
            ...extraOptions
        });
    }

    async sendConfirmLaunch(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        creator: c.Address
        salt: uint64
        options: CellRef<LaunchOptions>
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: ConfirmLaunch.toCell(ConfirmLaunch.create(body)),
            ...extraOptions
        });
    }

    async sendCancelLaunchFees(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        creator: c.Address
        salt: uint64
        options: CellRef<LaunchOptions>
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: CancelLaunchFees.toCell(CancelLaunchFees.create(body)),
            ...extraOptions
        });
    }

    async sendChangeMasterAdmin(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        newAdmin: c.Address
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: ChangeMasterAdmin.toCell(ChangeMasterAdmin.create(body)),
            ...extraOptions
        });
    }

    async sendClaimMasterAdmin(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: ClaimMasterAdmin.toCell(ClaimMasterAdmin.create(body)),
            ...extraOptions
        });
    }

    async sendChangeTreasury(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        newTreasury: c.Address
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: ChangeTreasury.toCell(ChangeTreasury.create(body)),
            ...extraOptions
        });
    }

    async sendWithdrawProtocolFees(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        amount: coins
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: WithdrawProtocolFees.toCell(WithdrawProtocolFees.create(body)),
            ...extraOptions
        });
    }

    async sendDepositProtocolFees(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        amount: coins
        creator: c.Address
        salt: uint64
        options: CellRef<LaunchOptions>
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: DepositProtocolFees.toCell(DepositProtocolFees.create(body)),
            ...extraOptions
        });
    }

    async sendReinitializeCurve(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        creator: c.Address
        salt: uint64
        metadata: c.Cell
        options: CellRef<LaunchOptions>
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: ReinitializeCurve.toCell(ReinitializeCurve.create(body)),
            ...extraOptions
        });
    }

    async sendTopUpTons(provider: ContractProvider, via: Sender, msgValue: coins, body: {
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: TopUpTons.toCell(TopUpTons.create()),
            ...extraOptions
        });
    }

    async getMasterData(provider: ContractProvider): Promise<MasterDataReply> {
        const r = StackReader.fromGetMethod(5, await provider.get('get_master_data', []));
        return ({
            $: 'MasterDataReply',
            admin: r.readSlice().loadAddress(),
            nextAdmin: r.readNullable<c.Address>(
                (r) => r.readSlice().loadAddress()
            ),
            treasury: r.readSlice().loadAddress(),
            totalLaunches: r.readBigInt(),
            feesBalance: r.readBigInt(),
        });
    }

    async getLaunchAddress(provider: ContractProvider, creator: c.Address, salt: uint64, options: CellRef<LaunchOptions>): Promise<c.Address> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_launch_address', [
            { type: 'slice', cell: makeCellFrom<c.Address>(creator,
                (v,b) => b.storeAddress(v)
            ) },
            { type: 'int', value: salt },
            { type: 'cell', cell: LaunchOptions.toCell(options.ref) },
        ]));
        return r.readSlice().loadAddress();
    }

    async getStorageReserve(provider: ContractProvider): Promise<coins> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_storage_reserve', []));
        return r.readBigInt();
    }

    async getLaunchPreview(provider: ContractProvider, options: CellRef<LaunchOptions>): Promise<LaunchPreview> {
        const r = StackReader.fromGetMethod(10, await provider.get('get_launch_preview', [
            { type: 'cell', cell: LaunchOptions.toCell(options.ref) },
        ]));
        return ({
            $: 'LaunchPreview',
            minBuyTokens: r.readBigInt(),
            maxBuyTokens: r.readBigInt(),
            virtualTonReserve: r.readBigInt(),
            graduationThreshold: r.readBigInt(),
            soldTokens: r.readBigInt(),
            poolTon: r.readBigInt(),
            poolTokens: r.readBigInt(),
            remainingTokens: r.readBigInt(),
            initialPriceNanoPerBillion: r.readBigInt(),
            graduationPriceNanoPerBillion: r.readBigInt(),
        });
    }

    async getVersion(provider: ContractProvider): Promise<bigint> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_version', []));
        return r.readBigInt();
    }
}
