// AUTO-GENERATED, do not edit
// It's a TypeScript wrapper for a BondingCurveV2 contract in Tolk.
/* eslint-disable */

import * as c from '@ton/core';
import { beginCell, ContractProvider, Sender, SendMode } from '@ton/core';

// ————————————————————————————————————————————
//   predefined types and functions
//

type RemainingBitsAndRefs = c.Slice

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

function formatPrefix(prefixNum: number, prefixLen: number): string {
    return prefixLen % 4 ? `0b${prefixNum.toString(2).padStart(prefixLen, '0')}` : `0x${prefixNum.toString(16).padStart(prefixLen / 4, '0')}`;
}

function loadAndCheckPrefix(s: c.Slice, expected: number, prefixLen: number, structName: string): void {
    let prefix = s.loadUint(prefixLen);
    if (prefix !== expected) {
        throw new Error(`Incorrect prefix for '${structName}': expected ${formatPrefix(expected, prefixLen)}, got ${formatPrefix(prefix, prefixLen)}`);
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

function storeTolkRemaining(v: RemainingBitsAndRefs, b: c.Builder): void {
    b.storeSlice(v);
}

function loadTolkRemaining(s: c.Slice): RemainingBitsAndRefs {
    let rest = s.clone();
    s.loadBits(s.remainingBits);
    while (s.remainingRefs) {
        s.loadRef();
    }
    return rest;
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

    readWideNullable<T>(stackW: number, readFn_T: (r: StackReader) => T): T | null {
        const slotTypeId = this.tuple[stackW - 1];
        if (slotTypeId?.type !== 'int') {
            throw new Error(`not 'int' on a stack`);
        }
        if (slotTypeId.value === 0n) {
            this.tuple = this.tuple.slice(stackW);
            return null;
        }
        const valueT = readFn_T(this);
        this.tuple.shift();
        return valueT;
    }

    readCellRef<T>(loadFn_T: LoadCallback<T>): CellRef<T> {
        return { ref: loadFn_T(this.readCell().beginParse()) };
    }
}

// ————————————————————————————————————————————
//   auto-generated serializers to/from cells
//

type coins = bigint

type int32 = bigint

type uint8 = bigint
type uint16 = bigint
type uint64 = bigint

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
 > struct (0xa0a0a011) BuyJettons {
 >     queryId: uint64
 >     minJettonsOut: coins
 > }
 */
export interface BuyJettons {
    readonly $: 'BuyJettons'
    queryId: uint64
    minJettonsOut: coins
}

export const BuyJettons = {
    PREFIX: 0xa0a0a011,

    create(args: {
        queryId: uint64
        minJettonsOut: coins
    }): BuyJettons {
        return {
            $: 'BuyJettons',
            ...args
        }
    },
    fromSlice(s: c.Slice): BuyJettons {
        loadAndCheckPrefix32(s, 0xa0a0a011, 'BuyJettons');
        return {
            $: 'BuyJettons',
            queryId: s.loadUintBig(64),
            minJettonsOut: s.loadCoins(),
        }
    },
    store(self: BuyJettons, b: c.Builder): void {
        b.storeUint(0xa0a0a011, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.minJettonsOut);
    },
    toCell(self: BuyJettons): c.Cell {
        return makeCellFrom<BuyJettons>(self, BuyJettons.store);
    }
}

/**
 > struct (0xa0a0a013) FlushFees {
 >     queryId: uint64
 > }
 */
export interface FlushFees {
    readonly $: 'FlushFees'
    queryId: uint64
}

export const FlushFees = {
    PREFIX: 0xa0a0a013,

    create(args: {
        queryId: uint64
    }): FlushFees {
        return {
            $: 'FlushFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): FlushFees {
        loadAndCheckPrefix32(s, 0xa0a0a013, 'FlushFees');
        return {
            $: 'FlushFees',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: FlushFees, b: c.Builder): void {
        b.storeUint(0xa0a0a013, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: FlushFees): c.Cell {
        return makeCellFrom<FlushFees>(self, FlushFees.store);
    }
}

/**
 > struct (0xa0a0a012) Graduate {
 >     queryId: uint64
 > }
 */
export interface Graduate {
    readonly $: 'Graduate'
    queryId: uint64
}

export const Graduate = {
    PREFIX: 0xa0a0a012,

    create(args: {
        queryId: uint64
    }): Graduate {
        return {
            $: 'Graduate',
            ...args
        }
    },
    fromSlice(s: c.Slice): Graduate {
        loadAndCheckPrefix32(s, 0xa0a0a012, 'Graduate');
        return {
            $: 'Graduate',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: Graduate, b: c.Builder): void {
        b.storeUint(0xa0a0a012, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: Graduate): c.Cell {
        return makeCellFrom<Graduate>(self, Graduate.store);
    }
}

/**
 > struct (0xce185bd7) InitPoolResultMessage {
 >     queryId: uint64
 >     exitCode: int32
 >     customPayload: cell?
 > }
 */
export interface InitPoolResultMessage {
    readonly $: 'InitPoolResultMessage'
    queryId: uint64
    exitCode: int32
    customPayload: c.Cell | null
}

export const InitPoolResultMessage = {
    PREFIX: 0xce185bd7,

    create(args: {
        queryId: uint64
        exitCode: int32
        customPayload: c.Cell | null
    }): InitPoolResultMessage {
        return {
            $: 'InitPoolResultMessage',
            ...args
        }
    },
    fromSlice(s: c.Slice): InitPoolResultMessage {
        loadAndCheckPrefix32(s, 0xce185bd7, 'InitPoolResultMessage');
        return {
            $: 'InitPoolResultMessage',
            queryId: s.loadUintBig(64),
            exitCode: s.loadIntBig(32),
            customPayload: s.loadBoolean() ? s.loadRef() : null,
        }
    },
    store(self: InitPoolResultMessage, b: c.Builder): void {
        b.storeUint(0xce185bd7, 32);
        b.storeUint(self.queryId, 64);
        b.storeInt(self.exitCode, 32);
        storeTolkNullable<c.Cell>(self.customPayload, b,
            (v,b) => b.storeRef(v)
        );
    },
    toCell(self: InitPoolResultMessage): c.Cell {
        return makeCellFrom<InitPoolResultMessage>(self, InitPoolResultMessage.store);
    }
}

/**
 > struct (0xde8402ce) DedustInit {
 >     queryId: uint64
 >     customPayload: cell?
 > }
 */
export interface DedustInit {
    readonly $: 'DedustInit'
    queryId: uint64
    customPayload: c.Cell | null
}

export const DedustInit = {
    PREFIX: 0xde8402ce,

    create(args: {
        queryId: uint64
        customPayload: c.Cell | null
    }): DedustInit {
        return {
            $: 'DedustInit',
            ...args
        }
    },
    fromSlice(s: c.Slice): DedustInit {
        loadAndCheckPrefix32(s, 0xde8402ce, 'DedustInit');
        return {
            $: 'DedustInit',
            queryId: s.loadUintBig(64),
            customPayload: s.loadBoolean() ? s.loadRef() : null,
        }
    },
    store(self: DedustInit, b: c.Builder): void {
        b.storeUint(0xde8402ce, 32);
        b.storeUint(self.queryId, 64);
        storeTolkNullable<c.Cell>(self.customPayload, b,
            (v,b) => b.storeRef(v)
        );
    },
    toCell(self: DedustInit): c.Cell {
        return makeCellFrom<DedustInit>(self, DedustInit.store);
    }
}

/**
 > struct (0xc9a015da) DedustDepositPayload {
 >     amountX: coins
 >     amountY: coins
 >     minimalLiquidity: coins
 >     lockedLiquidityShare: uint16
 > }
 */
export interface DedustDepositPayload {
    readonly $: 'DedustDepositPayload'
    amountX: coins
    amountY: coins
    minimalLiquidity: coins
    lockedLiquidityShare: uint16
}

export const DedustDepositPayload = {
    PREFIX: 0xc9a015da,

    create(args: {
        amountX: coins
        amountY: coins
        minimalLiquidity: coins
        lockedLiquidityShare: uint16
    }): DedustDepositPayload {
        return {
            $: 'DedustDepositPayload',
            ...args
        }
    },
    fromSlice(s: c.Slice): DedustDepositPayload {
        loadAndCheckPrefix32(s, 0xc9a015da, 'DedustDepositPayload');
        return {
            $: 'DedustDepositPayload',
            amountX: s.loadCoins(),
            amountY: s.loadCoins(),
            minimalLiquidity: s.loadCoins(),
            lockedLiquidityShare: s.loadUintBig(16),
        }
    },
    store(self: DedustDepositPayload, b: c.Builder): void {
        b.storeUint(0xc9a015da, 32);
        b.storeCoins(self.amountX);
        b.storeCoins(self.amountY);
        b.storeCoins(self.minimalLiquidity);
        b.storeUint(self.lockedLiquidityShare, 16);
    },
    toCell(self: DedustDepositPayload): c.Cell {
        return makeCellFrom<DedustDepositPayload>(self, DedustDepositPayload.store);
    }
}

/**
 > struct (0xa5a7cbf8) DedustPayNative {
 >     queryId: uint64
 >     amount: coins
 >     paymentPayload: Cell<DedustDepositPayload>
 >     payoutConfig: cell
 > }
 */
export interface DedustPayNative {
    readonly $: 'DedustPayNative'
    queryId: uint64
    amount: coins
    paymentPayload: CellRef<DedustDepositPayload>
    payoutConfig: c.Cell
}

export const DedustPayNative = {
    PREFIX: 0xa5a7cbf8,

    create(args: {
        queryId: uint64
        amount: coins
        paymentPayload: CellRef<DedustDepositPayload>
        payoutConfig: c.Cell
    }): DedustPayNative {
        return {
            $: 'DedustPayNative',
            ...args
        }
    },
    fromSlice(s: c.Slice): DedustPayNative {
        loadAndCheckPrefix32(s, 0xa5a7cbf8, 'DedustPayNative');
        return {
            $: 'DedustPayNative',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
            paymentPayload: loadCellRef<DedustDepositPayload>(s, DedustDepositPayload.fromSlice),
            payoutConfig: s.loadRef(),
        }
    },
    store(self: DedustPayNative, b: c.Builder): void {
        b.storeUint(0xa5a7cbf8, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
        storeCellRef<DedustDepositPayload>(self.paymentPayload, b, DedustDepositPayload.store);
        b.storeRef(self.payoutConfig);
    },
    toCell(self: DedustPayNative): c.Cell {
        return makeCellFrom<DedustPayNative>(self, DedustPayNative.store);
    }
}

/**
 > struct LaunchInitializedEvent {
 >     status: LaunchStatus
 >     realTonReserve: coins
 >     curveJettonBalance: coins
 > }
 */
export interface LaunchInitializedEvent {
    readonly $: 'LaunchInitializedEvent'
    status: LaunchStatus
    realTonReserve: coins
    curveJettonBalance: coins
}

export const LaunchInitializedEvent = {
    create(args: {
        status: LaunchStatus
        realTonReserve: coins
        curveJettonBalance: coins
    }): LaunchInitializedEvent {
        return {
            $: 'LaunchInitializedEvent',
            ...args
        }
    },
    fromSlice(s: c.Slice): LaunchInitializedEvent {
        return {
            $: 'LaunchInitializedEvent',
            status: LaunchStatus.fromSlice(s),
            realTonReserve: s.loadCoins(),
            curveJettonBalance: s.loadCoins(),
        }
    },
    store(self: LaunchInitializedEvent, b: c.Builder): void {
        LaunchStatus.store(self.status, b);
        b.storeCoins(self.realTonReserve);
        b.storeCoins(self.curveJettonBalance);
    },
    toCell(self: LaunchInitializedEvent): c.Cell {
        return makeCellFrom<LaunchInitializedEvent>(self, LaunchInitializedEvent.store);
    }
}

/**
 > struct BuyEvent {
 >     buyer: address
 >     tonInNet: coins
 >     jettonsOut: coins
 >     feeTon: coins
 >     realTonReserve: coins
 >     curveJettonBalance: coins
 >     tonInGross: coins
 >     migrationStarted: bool
 > }
 */
export interface BuyEvent {
    readonly $: 'BuyEvent'
    buyer: c.Address
    tonInNet: coins
    jettonsOut: coins
    feeTon: coins
    realTonReserve: coins
    curveJettonBalance: coins
    tonInGross: coins
    migrationStarted: boolean
}

export const BuyEvent = {
    create(args: {
        buyer: c.Address
        tonInNet: coins
        jettonsOut: coins
        feeTon: coins
        realTonReserve: coins
        curveJettonBalance: coins
        tonInGross: coins
        migrationStarted: boolean
    }): BuyEvent {
        return {
            $: 'BuyEvent',
            ...args
        }
    },
    fromSlice(s: c.Slice): BuyEvent {
        return {
            $: 'BuyEvent',
            buyer: s.loadAddress(),
            tonInNet: s.loadCoins(),
            jettonsOut: s.loadCoins(),
            feeTon: s.loadCoins(),
            realTonReserve: s.loadCoins(),
            curveJettonBalance: s.loadCoins(),
            tonInGross: s.loadCoins(),
            migrationStarted: s.loadBoolean(),
        }
    },
    store(self: BuyEvent, b: c.Builder): void {
        b.storeAddress(self.buyer);
        b.storeCoins(self.tonInNet);
        b.storeCoins(self.jettonsOut);
        b.storeCoins(self.feeTon);
        b.storeCoins(self.realTonReserve);
        b.storeCoins(self.curveJettonBalance);
        b.storeCoins(self.tonInGross);
        b.storeBit(self.migrationStarted);
    },
    toCell(self: BuyEvent): c.Cell {
        return makeCellFrom<BuyEvent>(self, BuyEvent.store);
    }
}

/**
 > struct SellEvent {
 >     seller: address
 >     jettonsIn: coins
 >     tonOutNet: coins
 >     feeTon: coins
 >     realTonReserve: coins
 >     curveJettonBalance: coins
 >     tonOutGross: coins
 > }
 */
export interface SellEvent {
    readonly $: 'SellEvent'
    seller: c.Address
    jettonsIn: coins
    tonOutNet: coins
    feeTon: coins
    realTonReserve: coins
    curveJettonBalance: coins
    tonOutGross: coins
}

export const SellEvent = {
    create(args: {
        seller: c.Address
        jettonsIn: coins
        tonOutNet: coins
        feeTon: coins
        realTonReserve: coins
        curveJettonBalance: coins
        tonOutGross: coins
    }): SellEvent {
        return {
            $: 'SellEvent',
            ...args
        }
    },
    fromSlice(s: c.Slice): SellEvent {
        return {
            $: 'SellEvent',
            seller: s.loadAddress(),
            jettonsIn: s.loadCoins(),
            tonOutNet: s.loadCoins(),
            feeTon: s.loadCoins(),
            realTonReserve: s.loadCoins(),
            curveJettonBalance: s.loadCoins(),
            tonOutGross: s.loadCoins(),
        }
    },
    store(self: SellEvent, b: c.Builder): void {
        b.storeAddress(self.seller);
        b.storeCoins(self.jettonsIn);
        b.storeCoins(self.tonOutNet);
        b.storeCoins(self.feeTon);
        b.storeCoins(self.realTonReserve);
        b.storeCoins(self.curveJettonBalance);
        b.storeCoins(self.tonOutGross);
    },
    toCell(self: SellEvent): c.Cell {
        return makeCellFrom<SellEvent>(self, SellEvent.store);
    }
}

/**
 > struct GraduateEvent {
 >     poolAddress: address
 >     poolSeedTon: coins
 >     poolSeedJettons: coins
 >     migrationFee: coins
 >     strandedJettons: coins
 > }
 */
export interface GraduateEvent {
    readonly $: 'GraduateEvent'
    poolAddress: c.Address
    poolSeedTon: coins
    poolSeedJettons: coins
    migrationFee: coins
    strandedJettons: coins
}

export const GraduateEvent = {
    create(args: {
        poolAddress: c.Address
        poolSeedTon: coins
        poolSeedJettons: coins
        migrationFee: coins
        strandedJettons: coins
    }): GraduateEvent {
        return {
            $: 'GraduateEvent',
            ...args
        }
    },
    fromSlice(s: c.Slice): GraduateEvent {
        return {
            $: 'GraduateEvent',
            poolAddress: s.loadAddress(),
            poolSeedTon: s.loadCoins(),
            poolSeedJettons: s.loadCoins(),
            migrationFee: s.loadCoins(),
            strandedJettons: s.loadCoins(),
        }
    },
    store(self: GraduateEvent, b: c.Builder): void {
        b.storeAddress(self.poolAddress);
        b.storeCoins(self.poolSeedTon);
        b.storeCoins(self.poolSeedJettons);
        b.storeCoins(self.migrationFee);
        b.storeCoins(self.strandedJettons);
    },
    toCell(self: GraduateEvent): c.Cell {
        return makeCellFrom<GraduateEvent>(self, GraduateEvent.store);
    }
}

/**
 > struct SlippageParseFailedEvent {
 >     seller: address
 >     jettonAmount: coins
 > }
 */
export interface SlippageParseFailedEvent {
    readonly $: 'SlippageParseFailedEvent'
    seller: c.Address
    jettonAmount: coins
}

export const SlippageParseFailedEvent = {
    create(args: {
        seller: c.Address
        jettonAmount: coins
    }): SlippageParseFailedEvent {
        return {
            $: 'SlippageParseFailedEvent',
            ...args
        }
    },
    fromSlice(s: c.Slice): SlippageParseFailedEvent {
        return {
            $: 'SlippageParseFailedEvent',
            seller: s.loadAddress(),
            jettonAmount: s.loadCoins(),
        }
    },
    store(self: SlippageParseFailedEvent, b: c.Builder): void {
        b.storeAddress(self.seller);
        b.storeCoins(self.jettonAmount);
    },
    toCell(self: SlippageParseFailedEvent): c.Cell {
        return makeCellFrom<SlippageParseFailedEvent>(self, SlippageParseFailedEvent.store);
    }
}

/**
 > struct (0xa0a0b030) LaunchMintFailed {
 >     queryId: uint64
 > }
 */
export interface LaunchMintFailed {
    readonly $: 'LaunchMintFailed'
    queryId: uint64
}

export const LaunchMintFailed = {
    PREFIX: 0xa0a0b030,

    create(args: {
        queryId: uint64
    }): LaunchMintFailed {
        return {
            $: 'LaunchMintFailed',
            ...args
        }
    },
    fromSlice(s: c.Slice): LaunchMintFailed {
        loadAndCheckPrefix32(s, 0xa0a0b030, 'LaunchMintFailed');
        return {
            $: 'LaunchMintFailed',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: LaunchMintFailed, b: c.Builder): void {
        b.storeUint(0xa0a0b030, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: LaunchMintFailed): c.Cell {
        return makeCellFrom<LaunchMintFailed>(self, LaunchMintFailed.store);
    }
}

/**
 > struct (0xa0a0b031) ClaimCurveCreatorFees {
 >     queryId: uint64
 > }
 */
export interface ClaimCurveCreatorFees {
    readonly $: 'ClaimCurveCreatorFees'
    queryId: uint64
}

export const ClaimCurveCreatorFees = {
    PREFIX: 0xa0a0b031,

    create(args: {
        queryId: uint64
    }): ClaimCurveCreatorFees {
        return {
            $: 'ClaimCurveCreatorFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): ClaimCurveCreatorFees {
        loadAndCheckPrefix32(s, 0xa0a0b031, 'ClaimCurveCreatorFees');
        return {
            $: 'ClaimCurveCreatorFees',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: ClaimCurveCreatorFees, b: c.Builder): void {
        b.storeUint(0xa0a0b031, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: ClaimCurveCreatorFees): c.Cell {
        return makeCellFrom<ClaimCurveCreatorFees>(self, ClaimCurveCreatorFees.store);
    }
}

/**
 > struct (0xa0a0b034) FlushCreatorFees {
 >     queryId: uint64
 > }
 */
export interface FlushCreatorFees {
    readonly $: 'FlushCreatorFees'
    queryId: uint64
}

export const FlushCreatorFees = {
    PREFIX: 0xa0a0b034,

    create(args: {
        queryId: uint64
    }): FlushCreatorFees {
        return {
            $: 'FlushCreatorFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): FlushCreatorFees {
        loadAndCheckPrefix32(s, 0xa0a0b034, 'FlushCreatorFees');
        return {
            $: 'FlushCreatorFees',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: FlushCreatorFees, b: c.Builder): void {
        b.storeUint(0xa0a0b034, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: FlushCreatorFees): c.Cell {
        return makeCellFrom<FlushCreatorFees>(self, FlushCreatorFees.store);
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
 > struct (0xa0a0b060) RetryMigration {
 >     queryId: uint64
 > }
 */
export interface RetryMigration {
    readonly $: 'RetryMigration'
    queryId: uint64
}

export const RetryMigration = {
    PREFIX: 0xa0a0b060,

    create(args: {
        queryId: uint64
    }): RetryMigration {
        return {
            $: 'RetryMigration',
            ...args
        }
    },
    fromSlice(s: c.Slice): RetryMigration {
        loadAndCheckPrefix32(s, 0xa0a0b060, 'RetryMigration');
        return {
            $: 'RetryMigration',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: RetryMigration, b: c.Builder): void {
        b.storeUint(0xa0a0b060, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: RetryMigration): c.Cell {
        return makeCellFrom<RetryMigration>(self, RetryMigration.store);
    }
}

/**
 > struct (0xa0a0b061) ConfirmMigration {
 >     queryId: uint64
 > }
 */
export interface ConfirmMigration {
    readonly $: 'ConfirmMigration'
    queryId: uint64
}

export const ConfirmMigration = {
    PREFIX: 0xa0a0b061,

    create(args: {
        queryId: uint64
    }): ConfirmMigration {
        return {
            $: 'ConfirmMigration',
            ...args
        }
    },
    fromSlice(s: c.Slice): ConfirmMigration {
        loadAndCheckPrefix32(s, 0xa0a0b061, 'ConfirmMigration');
        return {
            $: 'ConfirmMigration',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: ConfirmMigration, b: c.Builder): void {
        b.storeUint(0xa0a0b061, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: ConfirmMigration): c.Cell {
        return makeCellFrom<ConfirmMigration>(self, ConfirmMigration.store);
    }
}

/**
 > struct (0x63554160) DepositNotification {
 >     queryId: uint64
 >     liquidity: coins
 >     lockedLiquidity: coins
 >     payload: cell?
 > }
 */
export interface DepositNotification {
    readonly $: 'DepositNotification'
    queryId: uint64
    liquidity: coins
    lockedLiquidity: coins
    payload: c.Cell | null
}

export const DepositNotification = {
    PREFIX: 0x63554160,

    create(args: {
        queryId: uint64
        liquidity: coins
        lockedLiquidity: coins
        payload: c.Cell | null
    }): DepositNotification {
        return {
            $: 'DepositNotification',
            ...args
        }
    },
    fromSlice(s: c.Slice): DepositNotification {
        loadAndCheckPrefix32(s, 0x63554160, 'DepositNotification');
        return {
            $: 'DepositNotification',
            queryId: s.loadUintBig(64),
            liquidity: s.loadCoins(),
            lockedLiquidity: s.loadCoins(),
            payload: s.loadBoolean() ? s.loadRef() : null,
        }
    },
    store(self: DepositNotification, b: c.Builder): void {
        b.storeUint(0x63554160, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.liquidity);
        b.storeCoins(self.lockedLiquidity);
        storeTolkNullable<c.Cell>(self.payload, b,
            (v,b) => b.storeRef(v)
        );
    },
    toCell(self: DepositNotification): c.Cell {
        return makeCellFrom<DepositNotification>(self, DepositNotification.store);
    }
}

/**
 > struct (0x9e0c2428) ProvidePositionState {
 >     queryId: uint64
 >     includePoolAddress: bool
 >     includeOwnerAddress: bool
 >     includeFees: bool
 >     includeRewards: bool
 > }
 */
export interface ProvidePositionState {
    readonly $: 'ProvidePositionState'
    queryId: uint64
    includePoolAddress: boolean
    includeOwnerAddress: boolean
    includeFees: boolean
    includeRewards: boolean
}

export const ProvidePositionState = {
    PREFIX: 0x9e0c2428,

    create(args: {
        queryId: uint64
        includePoolAddress: boolean
        includeOwnerAddress: boolean
        includeFees: boolean
        includeRewards: boolean
    }): ProvidePositionState {
        return {
            $: 'ProvidePositionState',
            ...args
        }
    },
    fromSlice(s: c.Slice): ProvidePositionState {
        loadAndCheckPrefix32(s, 0x9e0c2428, 'ProvidePositionState');
        return {
            $: 'ProvidePositionState',
            queryId: s.loadUintBig(64),
            includePoolAddress: s.loadBoolean(),
            includeOwnerAddress: s.loadBoolean(),
            includeFees: s.loadBoolean(),
            includeRewards: s.loadBoolean(),
        }
    },
    store(self: ProvidePositionState, b: c.Builder): void {
        b.storeUint(0x9e0c2428, 32);
        b.storeUint(self.queryId, 64);
        b.storeBit(self.includePoolAddress);
        b.storeBit(self.includeOwnerAddress);
        b.storeBit(self.includeFees);
        b.storeBit(self.includeRewards);
    },
    toCell(self: ProvidePositionState): c.Cell {
        return makeCellFrom<ProvidePositionState>(self, ProvidePositionState.store);
    }
}

/**
 > struct (0x52e659c0) TakePositionState {
 >     queryId: uint64
 >     liquidity: coins
 >     lockedLiquidity: coins
 >     rest: RemainingBitsAndRefs
 > }
 */
export interface TakePositionState {
    readonly $: 'TakePositionState'
    queryId: uint64
    liquidity: coins
    lockedLiquidity: coins
    rest: RemainingBitsAndRefs
}

export const TakePositionState = {
    PREFIX: 0x52e659c0,

    create(args: {
        queryId: uint64
        liquidity: coins
        lockedLiquidity: coins
        rest: RemainingBitsAndRefs
    }): TakePositionState {
        return {
            $: 'TakePositionState',
            ...args
        }
    },
    fromSlice(s: c.Slice): TakePositionState {
        loadAndCheckPrefix32(s, 0x52e659c0, 'TakePositionState');
        return {
            $: 'TakePositionState',
            queryId: s.loadUintBig(64),
            liquidity: s.loadCoins(),
            lockedLiquidity: s.loadCoins(),
            rest: loadTolkRemaining(s),
        }
    },
    store(self: TakePositionState, b: c.Builder): void {
        b.storeUint(0x52e659c0, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.liquidity);
        b.storeCoins(self.lockedLiquidity);
        storeTolkRemaining(self.rest, b);
    },
    toCell(self: TakePositionState): c.Cell {
        return makeCellFrom<TakePositionState>(self, TakePositionState.store);
    }
}

/**
 > struct MigrationProgress {
 >     nativeQueryId: uint64
 >     jettonQueryId: uint64
 >     tonAmount: coins
 >     jettonAmount: coins
 >     nativeRetry: bool
 >     jettonRetry: bool
 > }
 */
export interface MigrationProgress {
    readonly $: 'MigrationProgress'
    nativeQueryId: uint64
    jettonQueryId: uint64
    tonAmount: coins
    jettonAmount: coins
    nativeRetry: boolean
    jettonRetry: boolean
}

export const MigrationProgress = {
    create(args: {
        nativeQueryId: uint64
        jettonQueryId: uint64
        tonAmount: coins
        jettonAmount: coins
        nativeRetry: boolean
        jettonRetry: boolean
    }): MigrationProgress {
        return {
            $: 'MigrationProgress',
            ...args
        }
    },
    fromSlice(s: c.Slice): MigrationProgress {
        return {
            $: 'MigrationProgress',
            nativeQueryId: s.loadUintBig(64),
            jettonQueryId: s.loadUintBig(64),
            tonAmount: s.loadCoins(),
            jettonAmount: s.loadCoins(),
            nativeRetry: s.loadBoolean(),
            jettonRetry: s.loadBoolean(),
        }
    },
    store(self: MigrationProgress, b: c.Builder): void {
        b.storeUint(self.nativeQueryId, 64);
        b.storeUint(self.jettonQueryId, 64);
        b.storeCoins(self.tonAmount);
        b.storeCoins(self.jettonAmount);
        b.storeBit(self.nativeRetry);
        b.storeBit(self.jettonRetry);
    },
    toCell(self: MigrationProgress): c.Cell {
        return makeCellFrom<MigrationProgress>(self, MigrationProgress.store);
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
 > struct LaunchProgress {
 >     protocolTreasury: address?
 >     curveReceived: bool
 >     devReceived: bool
 >     devTokens: coins
 >     creatorAccrued: coins
 > }
 */
export interface LaunchProgress {
    readonly $: 'LaunchProgress'
    protocolTreasury: c.Address | null
    curveReceived: boolean
    devReceived: boolean
    devTokens: coins
    creatorAccrued: coins
}

export const LaunchProgress = {
    create(args: {
        protocolTreasury: c.Address | null
        curveReceived: boolean
        devReceived: boolean
        devTokens: coins
        creatorAccrued: coins
    }): LaunchProgress {
        return {
            $: 'LaunchProgress',
            ...args
        }
    },
    fromSlice(s: c.Slice): LaunchProgress {
        return {
            $: 'LaunchProgress',
            protocolTreasury: s.loadMaybeAddress(),
            curveReceived: s.loadBoolean(),
            devReceived: s.loadBoolean(),
            devTokens: s.loadCoins(),
            creatorAccrued: s.loadCoins(),
        }
    },
    store(self: LaunchProgress, b: c.Builder): void {
        b.storeAddress(self.protocolTreasury);
        b.storeBit(self.curveReceived);
        b.storeBit(self.devReceived);
        b.storeCoins(self.devTokens);
        b.storeCoins(self.creatorAccrued);
    },
    toCell(self: LaunchProgress): c.Cell {
        return makeCellFrom<LaunchProgress>(self, LaunchProgress.store);
    }
}

/**
 > enum LaunchStatus { 5 variants }
 */
export type LaunchStatus = bigint

export const LaunchStatus = {
    Initializing: 0n,
    Trading: 1n,
    Migrating: 2n,
    Migrated: 3n,
    Cancelled: 4n,

    fromSlice(s: c.Slice): LaunchStatus {
        return s.loadUintBig(8);
    },
    store(self: LaunchStatus, b: c.Builder): void {
        b.storeUint(self, 8);
    },
    toCell(self: LaunchStatus): c.Cell {
        return makeCellFrom<LaunchStatus>(self, LaunchStatus.store);
    }
}

/**
 > struct LaunchConfig {
 >     master: address
 >     creator: address
 >     salt: uint64
 >     curveSupply: coins
 >     dexReserveSupply: coins
 >     graduationThreshold: coins
 >     options: Cell<LaunchOptions>
 > }
 */
export interface LaunchConfig {
    readonly $: 'LaunchConfig'
    master: c.Address
    creator: c.Address
    salt: uint64
    curveSupply: coins
    dexReserveSupply: coins
    graduationThreshold: coins
    options: CellRef<LaunchOptions>
}

export const LaunchConfig = {
    create(args: {
        master: c.Address
        creator: c.Address
        salt: uint64
        curveSupply: coins
        dexReserveSupply: coins
        graduationThreshold: coins
        options: CellRef<LaunchOptions>
    }): LaunchConfig {
        return {
            $: 'LaunchConfig',
            ...args
        }
    },
    fromSlice(s: c.Slice): LaunchConfig {
        return {
            $: 'LaunchConfig',
            master: s.loadAddress(),
            creator: s.loadAddress(),
            salt: s.loadUintBig(64),
            curveSupply: s.loadCoins(),
            dexReserveSupply: s.loadCoins(),
            graduationThreshold: s.loadCoins(),
            options: loadCellRef<LaunchOptions>(s, LaunchOptions.fromSlice),
        }
    },
    store(self: LaunchConfig, b: c.Builder): void {
        b.storeAddress(self.master);
        b.storeAddress(self.creator);
        b.storeUint(self.salt, 64);
        b.storeCoins(self.curveSupply);
        b.storeCoins(self.dexReserveSupply);
        b.storeCoins(self.graduationThreshold);
        storeCellRef<LaunchOptions>(self.options, b, LaunchOptions.store);
    },
    toCell(self: LaunchConfig): c.Cell {
        return makeCellFrom<LaunchConfig>(self, LaunchConfig.store);
    }
}

/**
 > struct BondingCurveStorage {
 >     state: uint8
 >     jettonMinter: address?
 >     virtualTonReserve: coins
 >     realTonReserve: coins
 >     curveJettonBalance: coins
 >     feeAccrued: coins
 >     migrationReserve: coins
 >     config: Cell<LaunchConfig>
 >     dropAdminPending: bool
 >     pendingBuyTonInNet: coins
 >     progress: Cell<LaunchProgress>
 >     migration: Cell<MigrationProgress>?
 > }
 */
export interface BondingCurveStorage {
    readonly $: 'BondingCurveStorage'
    state: uint8
    jettonMinter: c.Address | null
    virtualTonReserve: coins
    realTonReserve: coins
    curveJettonBalance: coins
    feeAccrued: coins
    migrationReserve: coins
    config: CellRef<LaunchConfig>
    dropAdminPending: boolean
    pendingBuyTonInNet: coins
    progress: CellRef<LaunchProgress>
    migration: CellRef<MigrationProgress> | null /* = null */
}

export const BondingCurveStorage = {
    create(args: {
        state: uint8
        jettonMinter: c.Address | null
        virtualTonReserve: coins
        realTonReserve: coins
        curveJettonBalance: coins
        feeAccrued: coins
        migrationReserve: coins
        config: CellRef<LaunchConfig>
        dropAdminPending: boolean
        pendingBuyTonInNet: coins
        progress: CellRef<LaunchProgress>
        migration?: CellRef<MigrationProgress> | null /* = null */
    }): BondingCurveStorage {
        return {
            $: 'BondingCurveStorage',
            migration: null,
            ...args
        }
    },
    fromSlice(s: c.Slice): BondingCurveStorage {
        return {
            $: 'BondingCurveStorage',
            state: s.loadUintBig(8),
            jettonMinter: s.loadMaybeAddress(),
            virtualTonReserve: s.loadCoins(),
            realTonReserve: s.loadCoins(),
            curveJettonBalance: s.loadCoins(),
            feeAccrued: s.loadCoins(),
            migrationReserve: s.loadCoins(),
            config: loadCellRef<LaunchConfig>(s, LaunchConfig.fromSlice),
            dropAdminPending: s.loadBoolean(),
            pendingBuyTonInNet: s.loadCoins(),
            progress: loadCellRef<LaunchProgress>(s, LaunchProgress.fromSlice),
            migration: s.loadBoolean() ? loadCellRef<MigrationProgress>(s, MigrationProgress.fromSlice) : null,
        }
    },
    store(self: BondingCurveStorage, b: c.Builder): void {
        b.storeUint(self.state, 8);
        b.storeAddress(self.jettonMinter);
        b.storeCoins(self.virtualTonReserve);
        b.storeCoins(self.realTonReserve);
        b.storeCoins(self.curveJettonBalance);
        b.storeCoins(self.feeAccrued);
        b.storeCoins(self.migrationReserve);
        storeCellRef<LaunchConfig>(self.config, b, LaunchConfig.store);
        b.storeBit(self.dropAdminPending);
        b.storeCoins(self.pendingBuyTonInNet);
        storeCellRef<LaunchProgress>(self.progress, b, LaunchProgress.store);
        storeTolkNullable<CellRef<MigrationProgress>>(self.migration, b,
            (v,b) => storeCellRef<MigrationProgress>(v, b, MigrationProgress.store)
        );
    },
    toCell(self: BondingCurveStorage): c.Cell {
        return makeCellFrom<BondingCurveStorage>(self, BondingCurveStorage.store);
    }
}

/**
 > struct BondingCurveDataReply {
 >     state: uint8
 >     creator: address
 >     salt: uint64
 >     jettonMinter: address?
 >     virtualTonReserve: coins
 >     realTonReserve: coins
 >     curveJettonBalance: coins
 >     curveSupply: coins
 >     dexReserveSupply: coins
 >     graduationThreshold: coins
 >     feeAccrued: coins
 >     migrationReserve: coins
 >     dropAdminPending: bool
 >     pendingBuyTonInNet: coins
 > }
 */
export interface BondingCurveDataReply {
    readonly $: 'BondingCurveDataReply'
    state: uint8
    creator: c.Address
    salt: uint64
    jettonMinter: c.Address | null
    virtualTonReserve: coins
    realTonReserve: coins
    curveJettonBalance: coins
    curveSupply: coins
    dexReserveSupply: coins
    graduationThreshold: coins
    feeAccrued: coins
    migrationReserve: coins
    dropAdminPending: boolean
    pendingBuyTonInNet: coins
}

export const BondingCurveDataReply = {
    create(args: {
        state: uint8
        creator: c.Address
        salt: uint64
        jettonMinter: c.Address | null
        virtualTonReserve: coins
        realTonReserve: coins
        curveJettonBalance: coins
        curveSupply: coins
        dexReserveSupply: coins
        graduationThreshold: coins
        feeAccrued: coins
        migrationReserve: coins
        dropAdminPending: boolean
        pendingBuyTonInNet: coins
    }): BondingCurveDataReply {
        return {
            $: 'BondingCurveDataReply',
            ...args
        }
    },
    fromSlice(s: c.Slice): BondingCurveDataReply {
        return {
            $: 'BondingCurveDataReply',
            state: s.loadUintBig(8),
            creator: s.loadAddress(),
            salt: s.loadUintBig(64),
            jettonMinter: s.loadMaybeAddress(),
            virtualTonReserve: s.loadCoins(),
            realTonReserve: s.loadCoins(),
            curveJettonBalance: s.loadCoins(),
            curveSupply: s.loadCoins(),
            dexReserveSupply: s.loadCoins(),
            graduationThreshold: s.loadCoins(),
            feeAccrued: s.loadCoins(),
            migrationReserve: s.loadCoins(),
            dropAdminPending: s.loadBoolean(),
            pendingBuyTonInNet: s.loadCoins(),
        }
    },
    store(self: BondingCurveDataReply, b: c.Builder): void {
        b.storeUint(self.state, 8);
        b.storeAddress(self.creator);
        b.storeUint(self.salt, 64);
        b.storeAddress(self.jettonMinter);
        b.storeCoins(self.virtualTonReserve);
        b.storeCoins(self.realTonReserve);
        b.storeCoins(self.curveJettonBalance);
        b.storeCoins(self.curveSupply);
        b.storeCoins(self.dexReserveSupply);
        b.storeCoins(self.graduationThreshold);
        b.storeCoins(self.feeAccrued);
        b.storeCoins(self.migrationReserve);
        b.storeBit(self.dropAdminPending);
        b.storeCoins(self.pendingBuyTonInNet);
    },
    toCell(self: BondingCurveDataReply): c.Cell {
        return makeCellFrom<BondingCurveDataReply>(self, BondingCurveDataReply.store);
    }
}

/**
 > struct FeeRatesReply {
 >     curveProtocolBps: int
 >     curveCreatorBps: int
 >     poolBaseFeeBps: int
 >     poolCreatorAllocationBps: int
 >     poolProtocolPpb: int
 >     poolCreatorPpb: int
 >     poolLpPpb: int
 >     dedustPpb: int
 > }
 */
export interface FeeRatesReply {
    readonly $: 'FeeRatesReply'
    curveProtocolBps: bigint
    curveCreatorBps: bigint
    poolBaseFeeBps: bigint
    poolCreatorAllocationBps: bigint
    poolProtocolPpb: bigint
    poolCreatorPpb: bigint
    poolLpPpb: bigint
    dedustPpb: bigint
}

export const FeeRatesReply = {
    create(args: {
        curveProtocolBps: bigint
        curveCreatorBps: bigint
        poolBaseFeeBps: bigint
        poolCreatorAllocationBps: bigint
        poolProtocolPpb: bigint
        poolCreatorPpb: bigint
        poolLpPpb: bigint
        dedustPpb: bigint
    }): FeeRatesReply {
        return {
            $: 'FeeRatesReply',
            ...args
        }
    },
    fromSlice(s: c.Slice): FeeRatesReply {
        throw new Error(`Can't unpack 'FeeRatesReply' from cell, because 'FeeRatesReply.curveProtocolBps' is 'int' (not int32/uint64/etc.)`);
    },
    store(self: FeeRatesReply, b: c.Builder): void {
        throw new Error(`Can't pack 'FeeRatesReply' to cell, because 'self.curveProtocolBps' is 'int' (not int32/uint64/etc.)`);
    },
    toCell(self: FeeRatesReply): c.Cell {
        return makeCellFrom<FeeRatesReply>(self, FeeRatesReply.store);
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
 > struct (0xa0a0b060) InitBuyback {
 >     queryId: uint64
 >     config: Cell<BuybackConfig>
 >     active: bool
 > }
 */
export interface InitBuyback {
    readonly $: 'InitBuyback'
    queryId: uint64
    config: CellRef<BuybackConfig>
    active: boolean
}

export const InitBuyback = {
    PREFIX: 0xa0a0b060,

    create(args: {
        queryId: uint64
        config: CellRef<BuybackConfig>
        active: boolean
    }): InitBuyback {
        return {
            $: 'InitBuyback',
            ...args
        }
    },
    fromSlice(s: c.Slice): InitBuyback {
        loadAndCheckPrefix32(s, 0xa0a0b060, 'InitBuyback');
        return {
            $: 'InitBuyback',
            queryId: s.loadUintBig(64),
            config: loadCellRef<BuybackConfig>(s, BuybackConfig.fromSlice),
            active: s.loadBoolean(),
        }
    },
    store(self: InitBuyback, b: c.Builder): void {
        b.storeUint(0xa0a0b060, 32);
        b.storeUint(self.queryId, 64);
        storeCellRef<BuybackConfig>(self.config, b, BuybackConfig.store);
        b.storeBit(self.active);
    },
    toCell(self: InitBuyback): c.Cell {
        return makeCellFrom<InitBuyback>(self, InitBuyback.store);
    }
}

/**
 > struct (0xa0a0b065) PrepareBuyback {
 >     queryId: uint64
 > }
 */
export interface PrepareBuyback {
    readonly $: 'PrepareBuyback'
    queryId: uint64
}

export const PrepareBuyback = {
    PREFIX: 0xa0a0b065,

    create(args: {
        queryId: uint64
    }): PrepareBuyback {
        return {
            $: 'PrepareBuyback',
            ...args
        }
    },
    fromSlice(s: c.Slice): PrepareBuyback {
        loadAndCheckPrefix32(s, 0xa0a0b065, 'PrepareBuyback');
        return {
            $: 'PrepareBuyback',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: PrepareBuyback, b: c.Builder): void {
        b.storeUint(0xa0a0b065, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: PrepareBuyback): c.Cell {
        return makeCellFrom<PrepareBuyback>(self, PrepareBuyback.store);
    }
}

/**
 > struct BuybackConfig {
 >     minter: address
 >     collector: address
 >     splitter: address
 >     creatorFeeBps: uint16
 > }
 */
export interface BuybackConfig {
    readonly $: 'BuybackConfig'
    minter: c.Address
    collector: c.Address
    splitter: c.Address
    creatorFeeBps: uint16
}

export const BuybackConfig = {
    create(args: {
        minter: c.Address
        collector: c.Address
        splitter: c.Address
        creatorFeeBps: uint16
    }): BuybackConfig {
        return {
            $: 'BuybackConfig',
            ...args
        }
    },
    fromSlice(s: c.Slice): BuybackConfig {
        return {
            $: 'BuybackConfig',
            minter: s.loadAddress(),
            collector: s.loadAddress(),
            splitter: s.loadAddress(),
            creatorFeeBps: s.loadUintBig(16),
        }
    },
    store(self: BuybackConfig, b: c.Builder): void {
        b.storeAddress(self.minter);
        b.storeAddress(self.collector);
        b.storeAddress(self.splitter);
        b.storeUint(self.creatorFeeBps, 16);
    },
    toCell(self: BuybackConfig): c.Cell {
        return makeCellFrom<BuybackConfig>(self, BuybackConfig.store);
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

/**
 > struct (0xa0a0b044) CreditCurveFees {
 >     queryId: uint64
 >     amount: coins
 > }
 */
export interface CreditCurveFees {
    readonly $: 'CreditCurveFees'
    queryId: uint64
    amount: coins
}

export const CreditCurveFees = {
    PREFIX: 0xa0a0b044,

    create(args: {
        queryId: uint64
        amount: coins
    }): CreditCurveFees {
        return {
            $: 'CreditCurveFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): CreditCurveFees {
        loadAndCheckPrefix32(s, 0xa0a0b044, 'CreditCurveFees');
        return {
            $: 'CreditCurveFees',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
        }
    },
    store(self: CreditCurveFees, b: c.Builder): void {
        b.storeUint(0xa0a0b044, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
    },
    toCell(self: CreditCurveFees): c.Cell {
        return makeCellFrom<CreditCurveFees>(self, CreditCurveFees.store);
    }
}

/**
 > struct (0xa0a0b055) MintCurveWallet {
 >     queryId: uint64
 >     jettonAmount: coins
 >     tonAmount: coins
 > }
 */
export interface MintCurveWallet {
    readonly $: 'MintCurveWallet'
    queryId: uint64
    jettonAmount: coins
    tonAmount: coins
}

export const MintCurveWallet = {
    PREFIX: 0xa0a0b055,

    create(args: {
        queryId: uint64
        jettonAmount: coins
        tonAmount: coins
    }): MintCurveWallet {
        return {
            $: 'MintCurveWallet',
            ...args
        }
    },
    fromSlice(s: c.Slice): MintCurveWallet {
        loadAndCheckPrefix32(s, 0xa0a0b055, 'MintCurveWallet');
        return {
            $: 'MintCurveWallet',
            queryId: s.loadUintBig(64),
            jettonAmount: s.loadCoins(),
            tonAmount: s.loadCoins(),
        }
    },
    store(self: MintCurveWallet, b: c.Builder): void {
        b.storeUint(0xa0a0b055, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.jettonAmount);
        b.storeCoins(self.tonAmount);
    },
    toCell(self: MintCurveWallet): c.Cell {
        return makeCellFrom<MintCurveWallet>(self, MintCurveWallet.store);
    }
}

/**
 > struct (0xa0a0b050) MintDelivered {
 >     queryId: uint64
 >     amount: coins
 > }
 */
export interface MintDelivered {
    readonly $: 'MintDelivered'
    queryId: uint64
    amount: coins
}

export const MintDelivered = {
    PREFIX: 0xa0a0b050,

    create(args: {
        queryId: uint64
        amount: coins
    }): MintDelivered {
        return {
            $: 'MintDelivered',
            ...args
        }
    },
    fromSlice(s: c.Slice): MintDelivered {
        loadAndCheckPrefix32(s, 0xa0a0b050, 'MintDelivered');
        return {
            $: 'MintDelivered',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
        }
    },
    store(self: MintDelivered, b: c.Builder): void {
        b.storeUint(0xa0a0b050, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
    },
    toCell(self: MintDelivered): c.Cell {
        return makeCellFrom<MintDelivered>(self, MintDelivered.store);
    }
}

/**
 > struct (0xa0a0b051) TransferDelivered {
 >     queryId: uint64
 >     amount: coins
 > }
 */
export interface TransferDelivered {
    readonly $: 'TransferDelivered'
    queryId: uint64
    amount: coins
}

export const TransferDelivered = {
    PREFIX: 0xa0a0b051,

    create(args: {
        queryId: uint64
        amount: coins
    }): TransferDelivered {
        return {
            $: 'TransferDelivered',
            ...args
        }
    },
    fromSlice(s: c.Slice): TransferDelivered {
        loadAndCheckPrefix32(s, 0xa0a0b051, 'TransferDelivered');
        return {
            $: 'TransferDelivered',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
        }
    },
    store(self: TransferDelivered, b: c.Builder): void {
        b.storeUint(0xa0a0b051, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
    },
    toCell(self: TransferDelivered): c.Cell {
        return makeCellFrom<TransferDelivered>(self, TransferDelivered.store);
    }
}

/**
 > struct (0xa0a0b052) TransferFailed {
 >     queryId: uint64
 >     amount: coins
 > }
 */
export interface TransferFailed {
    readonly $: 'TransferFailed'
    queryId: uint64
    amount: coins
}

export const TransferFailed = {
    PREFIX: 0xa0a0b052,

    create(args: {
        queryId: uint64
        amount: coins
    }): TransferFailed {
        return {
            $: 'TransferFailed',
            ...args
        }
    },
    fromSlice(s: c.Slice): TransferFailed {
        loadAndCheckPrefix32(s, 0xa0a0b052, 'TransferFailed');
        return {
            $: 'TransferFailed',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
        }
    },
    store(self: TransferFailed, b: c.Builder): void {
        b.storeUint(0xa0a0b052, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
    },
    toCell(self: TransferFailed): c.Cell {
        return makeCellFrom<TransferFailed>(self, TransferFailed.store);
    }
}

/**
 > struct (0xa0a0b053) AskToTransferTracked {
 >     queryId: uint64
 >     jettonAmount: coins
 >     transferRecipient: address
 >     sendExcessesTo: address?
 >     customPayload: cell?
 >     forwardTonAmount: coins
 >     forwardPayload: ForwardPayloadRemainder
 > }
 */
export interface AskToTransferTracked {
    readonly $: 'AskToTransferTracked'
    queryId: uint64
    jettonAmount: coins
    transferRecipient: c.Address
    sendExcessesTo: c.Address | null
    customPayload: c.Cell | null
    forwardTonAmount: coins
    forwardPayload: ForwardPayloadRemainder
}

export const AskToTransferTracked = {
    PREFIX: 0xa0a0b053,

    create(args: {
        queryId: uint64
        jettonAmount: coins
        transferRecipient: c.Address
        sendExcessesTo: c.Address | null
        customPayload: c.Cell | null
        forwardTonAmount: coins
        forwardPayload: ForwardPayloadRemainder
    }): AskToTransferTracked {
        return {
            $: 'AskToTransferTracked',
            ...args
        }
    },
    fromSlice(s: c.Slice): AskToTransferTracked {
        loadAndCheckPrefix32(s, 0xa0a0b053, 'AskToTransferTracked');
        return {
            $: 'AskToTransferTracked',
            queryId: s.loadUintBig(64),
            jettonAmount: s.loadCoins(),
            transferRecipient: s.loadAddress(),
            sendExcessesTo: s.loadMaybeAddress(),
            customPayload: s.loadBoolean() ? s.loadRef() : null,
            forwardTonAmount: s.loadCoins(),
            forwardPayload: ForwardPayloadRemainder.fromSlice(s),
        }
    },
    store(self: AskToTransferTracked, b: c.Builder): void {
        b.storeUint(0xa0a0b053, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.jettonAmount);
        b.storeAddress(self.transferRecipient);
        b.storeAddress(self.sendExcessesTo);
        storeTolkNullable<c.Cell>(self.customPayload, b,
            (v,b) => b.storeRef(v)
        );
        b.storeCoins(self.forwardTonAmount);
        ForwardPayloadRemainder.store(self.forwardPayload, b);
    },
    toCell(self: AskToTransferTracked): c.Cell {
        return makeCellFrom<AskToTransferTracked>(self, AskToTransferTracked.store);
    }
}

/**
 > struct (0xa0a0b05b) MinterAdminDropped {
 >     queryId: uint64
 > }
 */
export interface MinterAdminDropped {
    readonly $: 'MinterAdminDropped'
    queryId: uint64
}

export const MinterAdminDropped = {
    PREFIX: 0xa0a0b05b,

    create(args: {
        queryId: uint64
    }): MinterAdminDropped {
        return {
            $: 'MinterAdminDropped',
            ...args
        }
    },
    fromSlice(s: c.Slice): MinterAdminDropped {
        loadAndCheckPrefix32(s, 0xa0a0b05b, 'MinterAdminDropped');
        return {
            $: 'MinterAdminDropped',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: MinterAdminDropped, b: c.Builder): void {
        b.storeUint(0xa0a0b05b, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: MinterAdminDropped): c.Cell {
        return makeCellFrom<MinterAdminDropped>(self, MinterAdminDropped.store);
    }
}

/**
 > type ForwardPayloadRemainder = RemainingBitsAndRefs
 */
export type ForwardPayloadRemainder = RemainingBitsAndRefs

export const ForwardPayloadRemainder = {
    fromSlice(s: c.Slice): ForwardPayloadRemainder {
        return loadTolkRemaining(s);
    },
    store(self: ForwardPayloadRemainder, b: c.Builder): void {
        storeTolkRemaining(self, b);
    },
    toCell(self: ForwardPayloadRemainder): c.Cell {
        return makeCellFrom<ForwardPayloadRemainder>(self, ForwardPayloadRemainder.store);
    }
}

/**
 > struct (0b0) PayloadInline {
 >     value: RemainingBitsAndRefs
 > }
 */
export interface PayloadInline {
    readonly $: 'PayloadInline'
    value: RemainingBitsAndRefs
}

export const PayloadInline = {
    PREFIX: 0b0,

    create(args: {
        value: RemainingBitsAndRefs
    }): PayloadInline {
        return {
            $: 'PayloadInline',
            ...args
        }
    },
    fromSlice(s: c.Slice): PayloadInline {
        loadAndCheckPrefix(s, 0b0, 1, 'PayloadInline');
        return {
            $: 'PayloadInline',
            value: loadTolkRemaining(s),
        }
    },
    store(self: PayloadInline, b: c.Builder): void {
        b.storeUint(0b0, 1);
        storeTolkRemaining(self.value, b);
    },
    toCell(self: PayloadInline): c.Cell {
        return makeCellFrom<PayloadInline>(self, PayloadInline.store);
    }
}

/**
 > struct (0b1) PayloadInRef {
 >     value: Cell<RemainingBitsAndRefs>
 > }
 */
export interface PayloadInRef {
    readonly $: 'PayloadInRef'
    value: CellRef<RemainingBitsAndRefs>
}

export const PayloadInRef = {
    PREFIX: 0b1,

    create(args: {
        value: CellRef<RemainingBitsAndRefs>
    }): PayloadInRef {
        return {
            $: 'PayloadInRef',
            ...args
        }
    },
    fromSlice(s: c.Slice): PayloadInRef {
        loadAndCheckPrefix(s, 0b1, 1, 'PayloadInRef');
        return {
            $: 'PayloadInRef',
            value: loadCellRef<RemainingBitsAndRefs>(s, loadTolkRemaining),
        }
    },
    store(self: PayloadInRef, b: c.Builder): void {
        b.storeUint(0b1, 1);
        storeCellRef<RemainingBitsAndRefs>(self.value, b, storeTolkRemaining);
    },
    toCell(self: PayloadInRef): c.Cell {
        return makeCellFrom<PayloadInRef>(self, PayloadInRef.store);
    }
}

/**
 > struct (0x0f8a7ea5) AskToTransfer {
 >     queryId: uint64
 >     jettonAmount: coins
 >     transferRecipient: address
 >     sendExcessesTo: address?
 >     customPayload: cell?
 >     forwardTonAmount: coins
 >     forwardPayload: ForwardPayloadRemainder
 > }
 */
export interface AskToTransfer {
    readonly $: 'AskToTransfer'
    queryId: uint64
    jettonAmount: coins
    transferRecipient: c.Address
    sendExcessesTo: c.Address | null
    customPayload: c.Cell | null
    forwardTonAmount: coins
    forwardPayload: PayloadInline | PayloadInRef
}

export const AskToTransfer = {
    PREFIX: 0x0f8a7ea5,

    create(args: {
        queryId: uint64
        jettonAmount: coins
        transferRecipient: c.Address
        sendExcessesTo: c.Address | null
        customPayload: c.Cell | null
        forwardTonAmount: coins
        forwardPayload: PayloadInline | PayloadInRef
    }): AskToTransfer {
        return {
            $: 'AskToTransfer',
            ...args
        }
    },
    fromSlice(s: c.Slice): AskToTransfer {
        loadAndCheckPrefix32(s, 0x0f8a7ea5, 'AskToTransfer');
        return {
            $: 'AskToTransfer',
            queryId: s.loadUintBig(64),
            jettonAmount: s.loadCoins(),
            transferRecipient: s.loadAddress(),
            sendExcessesTo: s.loadMaybeAddress(),
            customPayload: s.loadBoolean() ? s.loadRef() : null,
            forwardTonAmount: s.loadCoins(),
            forwardPayload: lookupPrefix(s, 0b0, 1) ? PayloadInline.fromSlice(s) :
                lookupPrefix(s, 0b1, 1) ? PayloadInRef.fromSlice(s) :
                throwNonePrefixMatch('AskToTransfer.forwardPayload'),
        }
    },
    store(self: AskToTransfer, b: c.Builder): void {
        b.storeUint(0x0f8a7ea5, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.jettonAmount);
        b.storeAddress(self.transferRecipient);
        b.storeAddress(self.sendExcessesTo);
        storeTolkNullable<c.Cell>(self.customPayload, b,
            (v,b) => b.storeRef(v)
        );
        b.storeCoins(self.forwardTonAmount);
        switch (self.forwardPayload.$) {
            case 'PayloadInline':
                PayloadInline.store(self.forwardPayload, b);
                break;
            case 'PayloadInRef':
                PayloadInRef.store(self.forwardPayload, b);
                break;
        }
    },
    toCell(self: AskToTransfer): c.Cell {
        return makeCellFrom<AskToTransfer>(self, AskToTransfer.store);
    }
}

/**
 > struct (0x7362d09c) TransferNotificationForRecipient {
 >     queryId: uint64
 >     jettonAmount: coins
 >     transferInitiator: address?
 >     forwardPayload: ForwardPayloadRemainder
 > }
 */
export interface TransferNotificationForRecipient {
    readonly $: 'TransferNotificationForRecipient'
    queryId: uint64
    jettonAmount: coins
    transferInitiator: c.Address | null
    forwardPayload: PayloadInline | PayloadInRef
}

export const TransferNotificationForRecipient = {
    PREFIX: 0x7362d09c,

    create(args: {
        queryId: uint64
        jettonAmount: coins
        transferInitiator: c.Address | null
        forwardPayload: PayloadInline | PayloadInRef
    }): TransferNotificationForRecipient {
        return {
            $: 'TransferNotificationForRecipient',
            ...args
        }
    },
    fromSlice(s: c.Slice): TransferNotificationForRecipient {
        loadAndCheckPrefix32(s, 0x7362d09c, 'TransferNotificationForRecipient');
        return {
            $: 'TransferNotificationForRecipient',
            queryId: s.loadUintBig(64),
            jettonAmount: s.loadCoins(),
            transferInitiator: s.loadMaybeAddress(),
            forwardPayload: lookupPrefix(s, 0b0, 1) ? PayloadInline.fromSlice(s) :
                lookupPrefix(s, 0b1, 1) ? PayloadInRef.fromSlice(s) :
                throwNonePrefixMatch('TransferNotificationForRecipient.forwardPayload'),
        }
    },
    store(self: TransferNotificationForRecipient, b: c.Builder): void {
        b.storeUint(0x7362d09c, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.jettonAmount);
        b.storeAddress(self.transferInitiator);
        switch (self.forwardPayload.$) {
            case 'PayloadInline':
                PayloadInline.store(self.forwardPayload, b);
                break;
            case 'PayloadInRef':
                PayloadInRef.store(self.forwardPayload, b);
                break;
        }
    },
    toCell(self: TransferNotificationForRecipient): c.Cell {
        return makeCellFrom<TransferNotificationForRecipient>(self, TransferNotificationForRecipient.store);
    }
}

/**
 > struct (0x178d4519) InternalTransferStep {
 >     queryId: uint64
 >     jettonAmount: coins
 >     transferInitiator: address?
 >     sendExcessesTo: address?
 >     forwardTonAmount: coins
 >     forwardPayload: ForwardPayloadRemainder
 > }
 */
export interface InternalTransferStep {
    readonly $: 'InternalTransferStep'
    queryId: uint64
    jettonAmount: coins
    transferInitiator: c.Address | null
    sendExcessesTo: c.Address | null
    forwardTonAmount: coins
    forwardPayload: PayloadInline | PayloadInRef
}

export const InternalTransferStep = {
    PREFIX: 0x178d4519,

    create(args: {
        queryId: uint64
        jettonAmount: coins
        transferInitiator: c.Address | null
        sendExcessesTo: c.Address | null
        forwardTonAmount: coins
        forwardPayload: PayloadInline | PayloadInRef
    }): InternalTransferStep {
        return {
            $: 'InternalTransferStep',
            ...args
        }
    },
    fromSlice(s: c.Slice): InternalTransferStep {
        loadAndCheckPrefix32(s, 0x178d4519, 'InternalTransferStep');
        return {
            $: 'InternalTransferStep',
            queryId: s.loadUintBig(64),
            jettonAmount: s.loadCoins(),
            transferInitiator: s.loadMaybeAddress(),
            sendExcessesTo: s.loadMaybeAddress(),
            forwardTonAmount: s.loadCoins(),
            forwardPayload: lookupPrefix(s, 0b0, 1) ? PayloadInline.fromSlice(s) :
                lookupPrefix(s, 0b1, 1) ? PayloadInRef.fromSlice(s) :
                throwNonePrefixMatch('InternalTransferStep.forwardPayload'),
        }
    },
    store(self: InternalTransferStep, b: c.Builder): void {
        b.storeUint(0x178d4519, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.jettonAmount);
        b.storeAddress(self.transferInitiator);
        b.storeAddress(self.sendExcessesTo);
        b.storeCoins(self.forwardTonAmount);
        switch (self.forwardPayload.$) {
            case 'PayloadInline':
                PayloadInline.store(self.forwardPayload, b);
                break;
            case 'PayloadInRef':
                PayloadInRef.store(self.forwardPayload, b);
                break;
        }
    },
    toCell(self: InternalTransferStep): c.Cell {
        return makeCellFrom<InternalTransferStep>(self, InternalTransferStep.store);
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
 > struct (0x642b7d07) MintNewJettons {
 >     queryId: uint64
 >     mintRecipient: address
 >     tonAmount: coins
 >     internalTransferMsg: Cell<InternalTransferStep>
 > }
 */
export interface MintNewJettons {
    readonly $: 'MintNewJettons'
    queryId: uint64
    mintRecipient: c.Address
    tonAmount: coins
    internalTransferMsg: CellRef<InternalTransferStep>
}

export const MintNewJettons = {
    PREFIX: 0x642b7d07,

    create(args: {
        queryId: uint64
        mintRecipient: c.Address
        tonAmount: coins
        internalTransferMsg: CellRef<InternalTransferStep>
    }): MintNewJettons {
        return {
            $: 'MintNewJettons',
            ...args
        }
    },
    fromSlice(s: c.Slice): MintNewJettons {
        loadAndCheckPrefix32(s, 0x642b7d07, 'MintNewJettons');
        return {
            $: 'MintNewJettons',
            queryId: s.loadUintBig(64),
            mintRecipient: s.loadAddress(),
            tonAmount: s.loadCoins(),
            internalTransferMsg: loadCellRef<InternalTransferStep>(s, InternalTransferStep.fromSlice),
        }
    },
    store(self: MintNewJettons, b: c.Builder): void {
        b.storeUint(0x642b7d07, 32);
        b.storeUint(self.queryId, 64);
        b.storeAddress(self.mintRecipient);
        b.storeCoins(self.tonAmount);
        storeCellRef<InternalTransferStep>(self.internalTransferMsg, b, InternalTransferStep.store);
    },
    toCell(self: MintNewJettons): c.Cell {
        return makeCellFrom<MintNewJettons>(self, MintNewJettons.store);
    }
}

/**
 > struct (0x7431f221) DropMinterAdmin {
 >     queryId: uint64
 > }
 */
export interface DropMinterAdmin {
    readonly $: 'DropMinterAdmin'
    queryId: uint64
}

export const DropMinterAdmin = {
    PREFIX: 0x7431f221,

    create(args: {
        queryId: uint64
    }): DropMinterAdmin {
        return {
            $: 'DropMinterAdmin',
            ...args
        }
    },
    fromSlice(s: c.Slice): DropMinterAdmin {
        loadAndCheckPrefix32(s, 0x7431f221, 'DropMinterAdmin');
        return {
            $: 'DropMinterAdmin',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: DropMinterAdmin, b: c.Builder): void {
        b.storeUint(0x7431f221, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: DropMinterAdmin): c.Cell {
        return makeCellFrom<DropMinterAdmin>(self, DropMinterAdmin.store);
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

// ————————————————————————————————————————————
//    class BondingCurveV2
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

export class BondingCurveV2 implements c.Contract {
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
        return new BondingCurveV2(address);
    }

    static fromStorage(emptyStorage: {
        state: uint8
        jettonMinter: c.Address | null
        virtualTonReserve: coins
        realTonReserve: coins
        curveJettonBalance: coins
        feeAccrued: coins
        migrationReserve: coins
        config: CellRef<LaunchConfig>
        dropAdminPending: boolean
        pendingBuyTonInNet: coins
        progress: CellRef<LaunchProgress>
        migration?: CellRef<MigrationProgress> | null /* = null */
    }, deployedOptions?: DeployedAddrOptions) {
        const initialState = {
            code: deployedOptions?.overrideContractCode ?? BondingCurveV2.CodeCell,
            data: BondingCurveStorage.toCell(BondingCurveStorage.create(emptyStorage)),
        };
        const address = calculateDeployedAddress(initialState.code, initialState.data, deployedOptions ?? {});
        return new BondingCurveV2(address, initialState);
    }

    static createCellOfInitializeCurve(body: {
        queryId: uint64
        jettonMinter: c.Address
        refundTo: c.Address | null
        protocolTreasury: c.Address
    }) {
        return InitializeCurve.toCell(InitializeCurve.create(body));
    }

    static createCellOfMintDelivered(body: {
        queryId: uint64
        amount: coins
    }) {
        return MintDelivered.toCell(MintDelivered.create(body));
    }

    static createCellOfMinterAdminDropped(body: {
        queryId: uint64
    }) {
        return MinterAdminDropped.toCell(MinterAdminDropped.create(body));
    }

    static createCellOfReturnExcessesBack(body: {
        queryId: uint64
    }) {
        return ReturnExcessesBack.toCell(ReturnExcessesBack.create(body));
    }

    static createCellOfLaunchMintFailed(body: {
        queryId: uint64
    }) {
        return LaunchMintFailed.toCell(LaunchMintFailed.create(body));
    }

    static createCellOfClaimCurveCreatorFees(body: {
        queryId: uint64
    }) {
        return ClaimCurveCreatorFees.toCell(ClaimCurveCreatorFees.create(body));
    }

    static createCellOfFlushCreatorFees(body: {
        queryId: uint64
    }) {
        return FlushCreatorFees.toCell(FlushCreatorFees.create(body));
    }

    static createCellOfBuyJettons(body: {
        queryId: uint64
        minJettonsOut: coins
    }) {
        return BuyJettons.toCell(BuyJettons.create(body));
    }

    static createCellOfFlushFees(body: {
        queryId: uint64
    }) {
        return FlushFees.toCell(FlushFees.create(body));
    }

    static createCellOfGraduate(body: {
        queryId: uint64
    }) {
        return Graduate.toCell(Graduate.create(body));
    }

    static createCellOfRetryMigration(body: {
        queryId: uint64
    }) {
        return RetryMigration.toCell(RetryMigration.create(body));
    }

    static createCellOfConfirmMigration(body: {
        queryId: uint64
    }) {
        return ConfirmMigration.toCell(ConfirmMigration.create(body));
    }

    static createCellOfPrepareBuyback(body: {
        queryId: uint64
    }) {
        return PrepareBuyback.toCell(PrepareBuyback.create(body));
    }

    static createCellOfDepositNotification(body: {
        queryId: uint64
        liquidity: coins
        lockedLiquidity: coins
        payload: c.Cell | null
    }) {
        return DepositNotification.toCell(DepositNotification.create(body));
    }

    static createCellOfTakePositionState(body: {
        queryId: uint64
        liquidity: coins
        lockedLiquidity: coins
        rest: RemainingBitsAndRefs
    }) {
        return TakePositionState.toCell(TakePositionState.create(body));
    }

    static createCellOfTransferFailed(body: {
        queryId: uint64
        amount: coins
    }) {
        return TransferFailed.toCell(TransferFailed.create(body));
    }

    static createCellOfTransferDelivered(body: {
        queryId: uint64
        amount: coins
    }) {
        return TransferDelivered.toCell(TransferDelivered.create(body));
    }

    static createCellOfInitPoolResultMessage(body: {
        queryId: uint64
        exitCode: int32
        customPayload: c.Cell | null
    }) {
        return InitPoolResultMessage.toCell(InitPoolResultMessage.create(body));
    }

    static createCellOfTransferNotificationForRecipient(body: {
        queryId: uint64
        jettonAmount: coins
        transferInitiator: c.Address | null
        forwardPayload: PayloadInline | PayloadInRef
    }) {
        return TransferNotificationForRecipient.toCell(TransferNotificationForRecipient.create(body));
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

    async sendInitializeCurve(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        jettonMinter: c.Address
        refundTo: c.Address | null
        protocolTreasury: c.Address
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: InitializeCurve.toCell(InitializeCurve.create(body)),
            ...extraOptions
        });
    }

    async sendMintDelivered(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        amount: coins
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: MintDelivered.toCell(MintDelivered.create(body)),
            ...extraOptions
        });
    }

    async sendMinterAdminDropped(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: MinterAdminDropped.toCell(MinterAdminDropped.create(body)),
            ...extraOptions
        });
    }

    async sendReturnExcessesBack(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: ReturnExcessesBack.toCell(ReturnExcessesBack.create(body)),
            ...extraOptions
        });
    }

    async sendLaunchMintFailed(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: LaunchMintFailed.toCell(LaunchMintFailed.create(body)),
            ...extraOptions
        });
    }

    async sendClaimCurveCreatorFees(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: ClaimCurveCreatorFees.toCell(ClaimCurveCreatorFees.create(body)),
            ...extraOptions
        });
    }

    async sendFlushCreatorFees(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: FlushCreatorFees.toCell(FlushCreatorFees.create(body)),
            ...extraOptions
        });
    }

    async sendBuyJettons(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        minJettonsOut: coins
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: BuyJettons.toCell(BuyJettons.create(body)),
            ...extraOptions
        });
    }

    async sendFlushFees(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: FlushFees.toCell(FlushFees.create(body)),
            ...extraOptions
        });
    }

    async sendGraduate(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: Graduate.toCell(Graduate.create(body)),
            ...extraOptions
        });
    }

    async sendRetryMigration(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: RetryMigration.toCell(RetryMigration.create(body)),
            ...extraOptions
        });
    }

    async sendConfirmMigration(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: ConfirmMigration.toCell(ConfirmMigration.create(body)),
            ...extraOptions
        });
    }

    async sendPrepareBuyback(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: PrepareBuyback.toCell(PrepareBuyback.create(body)),
            ...extraOptions
        });
    }

    async sendDepositNotification(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        liquidity: coins
        lockedLiquidity: coins
        payload: c.Cell | null
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: DepositNotification.toCell(DepositNotification.create(body)),
            ...extraOptions
        });
    }

    async sendTakePositionState(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        liquidity: coins
        lockedLiquidity: coins
        rest: RemainingBitsAndRefs
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: TakePositionState.toCell(TakePositionState.create(body)),
            ...extraOptions
        });
    }

    async sendTransferFailed(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        amount: coins
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: TransferFailed.toCell(TransferFailed.create(body)),
            ...extraOptions
        });
    }

    async sendTransferDelivered(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        amount: coins
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: TransferDelivered.toCell(TransferDelivered.create(body)),
            ...extraOptions
        });
    }

    async sendInitPoolResultMessage(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        exitCode: int32
        customPayload: c.Cell | null
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: InitPoolResultMessage.toCell(InitPoolResultMessage.create(body)),
            ...extraOptions
        });
    }

    async sendTransferNotificationForRecipient(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        jettonAmount: coins
        transferInitiator: c.Address | null
        forwardPayload: PayloadInline | PayloadInRef
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: TransferNotificationForRecipient.toCell(TransferNotificationForRecipient.create(body)),
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

    async getCurveData(provider: ContractProvider): Promise<BondingCurveDataReply> {
        const r = StackReader.fromGetMethod(14, await provider.get('get_curve_data', []));
        return ({
            $: 'BondingCurveDataReply',
            state: r.readBigInt(),
            creator: r.readSlice().loadAddress(),
            salt: r.readBigInt(),
            jettonMinter: r.readNullable<c.Address>(
                (r) => r.readSlice().loadAddress()
            ),
            virtualTonReserve: r.readBigInt(),
            realTonReserve: r.readBigInt(),
            curveJettonBalance: r.readBigInt(),
            curveSupply: r.readBigInt(),
            dexReserveSupply: r.readBigInt(),
            graduationThreshold: r.readBigInt(),
            feeAccrued: r.readBigInt(),
            migrationReserve: r.readBigInt(),
            dropAdminPending: r.readBoolean(),
            pendingBuyTonInNet: r.readBigInt(),
        });
    }

    async getState(provider: ContractProvider): Promise<uint8> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_state', []));
        return r.readBigInt();
    }

    async getLaunchStatus(provider: ContractProvider): Promise<LaunchStatus> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_launch_status', []));
        return r.readBigInt();
    }

    async getQuoteBuy(provider: ContractProvider, tonIn: coins): Promise<coins> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_quote_buy', [
            { type: 'int', value: tonIn },
        ]));
        return r.readBigInt();
    }

    async getQuoteSell(provider: ContractProvider, jettonIn: coins): Promise<coins> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_quote_sell', [
            { type: 'int', value: jettonIn },
        ]));
        return r.readBigInt();
    }

    async getMaxSafeSell(provider: ContractProvider): Promise<coins> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_max_safe_sell', []));
        return r.readBigInt();
    }

    async getVersion(provider: ContractProvider): Promise<bigint> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_version', []));
        return r.readBigInt();
    }

    async getProgressBps(provider: ContractProvider): Promise<bigint> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_progress_bps', []));
        return r.readBigInt();
    }

    async getLaunchOptions(provider: ContractProvider): Promise<LaunchOptions> {
        const r = StackReader.fromGetMethod(10, await provider.get('get_launch_options', []));
        return ({
            $: 'LaunchOptions',
            supply: r.readBigInt(),
            creatorFeeBps: r.readBigInt(),
            devBuyAmount: r.readBigInt(),
            minDevTokens: r.readBigInt(),
            graduationThreshold: r.readBigInt(),
            reserveRatio: r.readBigInt(),
            minBuyBps: r.readBigInt(),
            maxBuyBps: r.readBigInt(),
            beneficiaries: r.readNullable<CellRef<FeeBeneficiaries>>(
                (r) => r.readCellRef<FeeBeneficiaries>(FeeBeneficiaries.fromSlice)
            ),
            buybackBurn: r.readBoolean(),
        });
    }

    async getLaunchProgress(provider: ContractProvider): Promise<LaunchProgress> {
        const r = StackReader.fromGetMethod(5, await provider.get('get_launch_progress', []));
        return ({
            $: 'LaunchProgress',
            protocolTreasury: r.readNullable<c.Address>(
                (r) => r.readSlice().loadAddress()
            ),
            curveReceived: r.readBoolean(),
            devReceived: r.readBoolean(),
            devTokens: r.readBigInt(),
            creatorAccrued: r.readBigInt(),
        });
    }

    async getCollectorAddress(provider: ContractProvider): Promise<c.Address> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_collector_address', []));
        return r.readSlice().loadAddress();
    }

    async getFeeManagerAddress(provider: ContractProvider): Promise<c.Address> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_fee_manager_address', []));
        return r.readSlice().loadAddress();
    }

    async getLaunchPreview(provider: ContractProvider): Promise<LaunchPreview> {
        const r = StackReader.fromGetMethod(10, await provider.get('get_launch_preview', []));
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

    async getPoolAddress(provider: ContractProvider): Promise<c.Address> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_pool_address', []));
        return r.readSlice().loadAddress();
    }

    async getFeeRates(provider: ContractProvider): Promise<FeeRatesReply> {
        const r = StackReader.fromGetMethod(8, await provider.get('get_fee_rates', []));
        return ({
            $: 'FeeRatesReply',
            curveProtocolBps: r.readBigInt(),
            curveCreatorBps: r.readBigInt(),
            poolBaseFeeBps: r.readBigInt(),
            poolCreatorAllocationBps: r.readBigInt(),
            poolProtocolPpb: r.readBigInt(),
            poolCreatorPpb: r.readBigInt(),
            poolLpPpb: r.readBigInt(),
            dedustPpb: r.readBigInt(),
        });
    }

    async getMigrationData(provider: ContractProvider): Promise<MigrationProgress | null> {
        const r = StackReader.fromGetMethod(7, await provider.get('get_migration_data', []));
        return r.readWideNullable<MigrationProgress>(7,
            (r) => ({
                $: 'MigrationProgress',
                nativeQueryId: r.readBigInt(),
                jettonQueryId: r.readBigInt(),
                tonAmount: r.readBigInt(),
                jettonAmount: r.readBigInt(),
                nativeRetry: r.readBoolean(),
                jettonRetry: r.readBoolean(),
            })
        );
    }

    async getBuybackAddress(provider: ContractProvider): Promise<c.Address | null> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_buyback_address', []));
        return r.readNullable<c.Address>(
            (r) => r.readSlice().loadAddress()
        );
    }
}
