// AUTO-GENERATED, do not edit
// It's a TypeScript wrapper for a FeeCollectorV2 contract in Tolk.
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
}

// ————————————————————————————————————————————
//   auto-generated serializers to/from cells
//

type coins = bigint

type uint16 = bigint
type uint64 = bigint

/**
 > struct (0xbe3e3179) DedustClaimCreatorFees {
 >     queryId: uint64
 >     to: address
 >     excessesTo: address
 > }
 */
export interface DedustClaimCreatorFees {
    readonly $: 'DedustClaimCreatorFees'
    queryId: uint64
    to: c.Address
    excessesTo: c.Address
}

export const DedustClaimCreatorFees = {
    PREFIX: 0xbe3e3179,

    create(args: {
        queryId: uint64
        to: c.Address
        excessesTo: c.Address
    }): DedustClaimCreatorFees {
        return {
            $: 'DedustClaimCreatorFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): DedustClaimCreatorFees {
        loadAndCheckPrefix32(s, 0xbe3e3179, 'DedustClaimCreatorFees');
        return {
            $: 'DedustClaimCreatorFees',
            queryId: s.loadUintBig(64),
            to: s.loadAddress(),
            excessesTo: s.loadAddress(),
        }
    },
    store(self: DedustClaimCreatorFees, b: c.Builder): void {
        b.storeUint(0xbe3e3179, 32);
        b.storeUint(self.queryId, 64);
        b.storeAddress(self.to);
        b.storeAddress(self.excessesTo);
    },
    toCell(self: DedustClaimCreatorFees): c.Cell {
        return makeCellFrom<DedustClaimCreatorFees>(self, DedustClaimCreatorFees.store);
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
 > struct FeeRecipients {
 >     creator: address
 >     protocol: address
 >     creatorBps: uint16
 >     curve: address?
 >     beneficiaries: Cell<FeeBeneficiaries>?
 >     buybackBurn: bool
 > }
 */
export interface FeeRecipients {
    readonly $: 'FeeRecipients'
    creator: c.Address
    protocol: c.Address
    creatorBps: uint16
    curve: c.Address | null /* = null */
    beneficiaries: CellRef<FeeBeneficiaries> | null /* = null */
    buybackBurn: boolean /* = false */
}

export const FeeRecipients = {
    create(args: {
        creator: c.Address
        protocol: c.Address
        creatorBps: uint16
        curve?: c.Address | null /* = null */
        beneficiaries?: CellRef<FeeBeneficiaries> | null /* = null */
        buybackBurn?: boolean /* = false */
    }): FeeRecipients {
        return {
            $: 'FeeRecipients',
            curve: null,
            beneficiaries: null,
            buybackBurn: false,
            ...args
        }
    },
    fromSlice(s: c.Slice): FeeRecipients {
        return {
            $: 'FeeRecipients',
            creator: s.loadAddress(),
            protocol: s.loadAddress(),
            creatorBps: s.loadUintBig(16),
            curve: s.loadMaybeAddress(),
            beneficiaries: s.loadBoolean() ? loadCellRef<FeeBeneficiaries>(s, FeeBeneficiaries.fromSlice) : null,
            buybackBurn: s.loadBoolean(),
        }
    },
    store(self: FeeRecipients, b: c.Builder): void {
        b.storeAddress(self.creator);
        b.storeAddress(self.protocol);
        b.storeUint(self.creatorBps, 16);
        b.storeAddress(self.curve);
        storeTolkNullable<CellRef<FeeBeneficiaries>>(self.beneficiaries, b,
            (v,b) => storeCellRef<FeeBeneficiaries>(v, b, FeeBeneficiaries.store)
        );
        b.storeBit(self.buybackBurn);
    },
    toCell(self: FeeRecipients): c.Cell {
        return makeCellFrom<FeeRecipients>(self, FeeRecipients.store);
    }
}

/**
 > struct CollectorStorage {
 >     minter: address
 >     recipients: Cell<FeeRecipients>
 >     initialized: bool
 >     nextId: uint64
 >     nativeAccrued: coins
 > }
 */
export interface CollectorStorage {
    readonly $: 'CollectorStorage'
    minter: c.Address
    recipients: CellRef<FeeRecipients>
    initialized: boolean
    nextId: uint64
    nativeAccrued: coins /* = 0 */
}

export const CollectorStorage = {
    create(args: {
        minter: c.Address
        recipients: CellRef<FeeRecipients>
        initialized: boolean
        nextId: uint64
        nativeAccrued?: coins /* = 0 */
    }): CollectorStorage {
        return {
            $: 'CollectorStorage',
            nativeAccrued: 0n,
            ...args
        }
    },
    fromSlice(s: c.Slice): CollectorStorage {
        return {
            $: 'CollectorStorage',
            minter: s.loadAddress(),
            recipients: loadCellRef<FeeRecipients>(s, FeeRecipients.fromSlice),
            initialized: s.loadBoolean(),
            nextId: s.loadUintBig(64),
            nativeAccrued: s.loadCoins(),
        }
    },
    store(self: CollectorStorage, b: c.Builder): void {
        b.storeAddress(self.minter);
        storeCellRef<FeeRecipients>(self.recipients, b, FeeRecipients.store);
        b.storeBit(self.initialized);
        b.storeUint(self.nextId, 64);
        b.storeCoins(self.nativeAccrued);
    },
    toCell(self: CollectorStorage): c.Cell {
        return makeCellFrom<CollectorStorage>(self, CollectorStorage.store);
    }
}

/**
 > struct (0xa0a0b040) CollectPoolFees {
 >     queryId: uint64
 > }
 */
export interface CollectPoolFees {
    readonly $: 'CollectPoolFees'
    queryId: uint64
}

export const CollectPoolFees = {
    PREFIX: 0xa0a0b040,

    create(args: {
        queryId: uint64
    }): CollectPoolFees {
        return {
            $: 'CollectPoolFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): CollectPoolFees {
        loadAndCheckPrefix32(s, 0xa0a0b040, 'CollectPoolFees');
        return {
            $: 'CollectPoolFees',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: CollectPoolFees, b: c.Builder): void {
        b.storeUint(0xa0a0b040, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: CollectPoolFees): c.Cell {
        return makeCellFrom<CollectPoolFees>(self, CollectPoolFees.store);
    }
}

/**
 > struct (0xa0a0b041) SweepCollectedTokens {
 >     queryId: uint64
 >     amount: coins
 > }
 */
export interface SweepCollectedTokens {
    readonly $: 'SweepCollectedTokens'
    queryId: uint64
    amount: coins
}

export const SweepCollectedTokens = {
    PREFIX: 0xa0a0b041,

    create(args: {
        queryId: uint64
        amount: coins
    }): SweepCollectedTokens {
        return {
            $: 'SweepCollectedTokens',
            ...args
        }
    },
    fromSlice(s: c.Slice): SweepCollectedTokens {
        loadAndCheckPrefix32(s, 0xa0a0b041, 'SweepCollectedTokens');
        return {
            $: 'SweepCollectedTokens',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
        }
    },
    store(self: SweepCollectedTokens, b: c.Builder): void {
        b.storeUint(0xa0a0b041, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
    },
    toCell(self: SweepCollectedTokens): c.Cell {
        return makeCellFrom<SweepCollectedTokens>(self, SweepCollectedTokens.store);
    }
}

/**
 > struct (0xa0a0b042) CreditNativeFees {
 >     queryId: uint64
 >     amount: coins
 > }
 */
export interface CreditNativeFees {
    readonly $: 'CreditNativeFees'
    queryId: uint64
    amount: coins
}

export const CreditNativeFees = {
    PREFIX: 0xa0a0b042,

    create(args: {
        queryId: uint64
        amount: coins
    }): CreditNativeFees {
        return {
            $: 'CreditNativeFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): CreditNativeFees {
        loadAndCheckPrefix32(s, 0xa0a0b042, 'CreditNativeFees');
        return {
            $: 'CreditNativeFees',
            queryId: s.loadUintBig(64),
            amount: s.loadCoins(),
        }
    },
    store(self: CreditNativeFees, b: c.Builder): void {
        b.storeUint(0xa0a0b042, 32);
        b.storeUint(self.queryId, 64);
        b.storeCoins(self.amount);
    },
    toCell(self: CreditNativeFees): c.Cell {
        return makeCellFrom<CreditNativeFees>(self, CreditNativeFees.store);
    }
}

/**
 > struct (0x3216ca09) DedustNativePayout {
 >     queryId: uint64
 >     rest: RemainingBitsAndRefs
 > }
 */
export interface DedustNativePayout {
    readonly $: 'DedustNativePayout'
    queryId: uint64
    rest: RemainingBitsAndRefs
}

export const DedustNativePayout = {
    PREFIX: 0x3216ca09,

    create(args: {
        queryId: uint64
        rest: RemainingBitsAndRefs
    }): DedustNativePayout {
        return {
            $: 'DedustNativePayout',
            ...args
        }
    },
    fromSlice(s: c.Slice): DedustNativePayout {
        loadAndCheckPrefix32(s, 0x3216ca09, 'DedustNativePayout');
        return {
            $: 'DedustNativePayout',
            queryId: s.loadUintBig(64),
            rest: loadTolkRemaining(s),
        }
    },
    store(self: DedustNativePayout, b: c.Builder): void {
        b.storeUint(0x3216ca09, 32);
        b.storeUint(self.queryId, 64);
        storeTolkRemaining(self.rest, b);
    },
    toCell(self: DedustNativePayout): c.Cell {
        return makeCellFrom<DedustNativePayout>(self, DedustNativePayout.store);
    }
}

/**
 > struct (0xa0a0b045) RetryCollectedFees {
 >     queryId: uint64
 > }
 */
export interface RetryCollectedFees {
    readonly $: 'RetryCollectedFees'
    queryId: uint64
}

export const RetryCollectedFees = {
    PREFIX: 0xa0a0b045,

    create(args: {
        queryId: uint64
    }): RetryCollectedFees {
        return {
            $: 'RetryCollectedFees',
            ...args
        }
    },
    fromSlice(s: c.Slice): RetryCollectedFees {
        loadAndCheckPrefix32(s, 0xa0a0b045, 'RetryCollectedFees');
        return {
            $: 'RetryCollectedFees',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: RetryCollectedFees, b: c.Builder): void {
        b.storeUint(0xa0a0b045, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: RetryCollectedFees): c.Cell {
        return makeCellFrom<RetryCollectedFees>(self, RetryCollectedFees.store);
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

// ————————————————————————————————————————————
//    class FeeCollectorV2
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

export class FeeCollectorV2 implements c.Contract {
    static CodeCell = c.Cell.fromBase64('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');

    static Errors = {
    }

    readonly address: c.Address
    readonly init: { code: c.Cell, data: c.Cell } | undefined

    protected constructor(address: c.Address, init?: { code: c.Cell, data: c.Cell }) {
        this.address = address;
        this.init = init;
    }

    static fromAddress(address: c.Address) {
        return new FeeCollectorV2(address);
    }

    static fromStorage(emptyStorage: {
        minter: c.Address
        recipients: CellRef<FeeRecipients>
        initialized: boolean
        nextId: uint64
        nativeAccrued?: coins /* = 0 */
    }, deployedOptions?: DeployedAddrOptions) {
        const initialState = {
            code: deployedOptions?.overrideContractCode ?? FeeCollectorV2.CodeCell,
            data: CollectorStorage.toCell(CollectorStorage.create(emptyStorage)),
        };
        const address = calculateDeployedAddress(initialState.code, initialState.data, deployedOptions ?? {});
        return new FeeCollectorV2(address, initialState);
    }

    static createCellOfCollectPoolFees(body: {
        queryId: uint64
    }) {
        return CollectPoolFees.toCell(CollectPoolFees.create(body));
    }

    static createCellOfSweepCollectedTokens(body: {
        queryId: uint64
        amount: coins
    }) {
        return SweepCollectedTokens.toCell(SweepCollectedTokens.create(body));
    }

    static createCellOfDedustNativePayout(body: {
        queryId: uint64
        rest: RemainingBitsAndRefs
    }) {
        return DedustNativePayout.toCell(DedustNativePayout.create(body));
    }

    static createCellOfReturnExcessesBack(body: {
        queryId: uint64
    }) {
        return ReturnExcessesBack.toCell(ReturnExcessesBack.create(body));
    }

    static createCellOfTopUpTons(body: {
    }) {
        return TopUpTons.toCell(TopUpTons.create());
    }

    static createCellOfRetryCollectedFees(body: {
        queryId: uint64
    }) {
        return RetryCollectedFees.toCell(RetryCollectedFees.create(body));
    }

    async sendDeploy(provider: ContractProvider, via: Sender, msgValue: coins, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: c.Cell.EMPTY,
            ...extraOptions
        });
    }

    async sendCollectPoolFees(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: CollectPoolFees.toCell(CollectPoolFees.create(body)),
            ...extraOptions
        });
    }

    async sendSweepCollectedTokens(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        amount: coins
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: SweepCollectedTokens.toCell(SweepCollectedTokens.create(body)),
            ...extraOptions
        });
    }

    async sendDedustNativePayout(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        rest: RemainingBitsAndRefs
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: DedustNativePayout.toCell(DedustNativePayout.create(body)),
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

    async sendTopUpTons(provider: ContractProvider, via: Sender, msgValue: coins, body: {
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: TopUpTons.toCell(TopUpTons.create()),
            ...extraOptions
        });
    }

    async sendRetryCollectedFees(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: RetryCollectedFees.toCell(RetryCollectedFees.create(body)),
            ...extraOptions
        });
    }

    async getSplitterAddress(provider: ContractProvider): Promise<c.Address> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_splitter_address', []));
        return r.readSlice().loadAddress();
    }

    async getPoolAddress(provider: ContractProvider): Promise<c.Address> {
        const r = StackReader.fromGetMethod(1, await provider.get('get_pool_address', []));
        return r.readSlice().loadAddress();
    }
}
