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
