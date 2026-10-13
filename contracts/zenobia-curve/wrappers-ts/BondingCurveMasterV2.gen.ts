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
