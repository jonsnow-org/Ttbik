import {
    Cell,
    Slice,
    Address,
    Builder,
    beginCell,
    ComputeError,
    TupleItem,
    TupleReader,
    Dictionary,
    contractAddress,
    address,
    ContractProvider,
    Sender,
    Contract,
    ContractABI,
    ABIType,
    ABIGetter,
    ABIReceiver,
    TupleBuilder,
    DictionaryValue
} from '@ton/core';

export type DataSize = {
    $$type: 'DataSize';
    cells: bigint;
    bits: bigint;
    refs: bigint;
}

export function storeDataSize(src: DataSize) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.cells, 257);
        b_0.storeInt(src.bits, 257);
        b_0.storeInt(src.refs, 257);
    };
}

export function loadDataSize(slice: Slice) {
    const sc_0 = slice;
    const _cells = sc_0.loadIntBig(257);
    const _bits = sc_0.loadIntBig(257);
    const _refs = sc_0.loadIntBig(257);
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadGetterTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function storeTupleDataSize(source: DataSize) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.cells);
    builder.writeNumber(source.bits);
    builder.writeNumber(source.refs);
    return builder.build();
}

export function dictValueParserDataSize(): DictionaryValue<DataSize> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDataSize(src)).endCell());
        },
        parse: (src) => {
            return loadDataSize(src.loadRef().beginParse());
        }
    }
}

export type SignedBundle = {
    $$type: 'SignedBundle';
    signature: Buffer;
    signedData: Slice;
}

export function storeSignedBundle(src: SignedBundle) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBuffer(src.signature);
        b_0.storeBuilder(src.signedData.asBuilder());
    };
}

export function loadSignedBundle(slice: Slice) {
    const sc_0 = slice;
    const _signature = sc_0.loadBuffer(64);
    const _signedData = sc_0;
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadGetterTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function storeTupleSignedBundle(source: SignedBundle) {
    const builder = new TupleBuilder();
    builder.writeBuffer(source.signature);
    builder.writeSlice(source.signedData.asCell());
    return builder.build();
}

export function dictValueParserSignedBundle(): DictionaryValue<SignedBundle> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSignedBundle(src)).endCell());
        },
        parse: (src) => {
            return loadSignedBundle(src.loadRef().beginParse());
        }
    }
}

export type StateInit = {
    $$type: 'StateInit';
    code: Cell;
    data: Cell;
}

export function storeStateInit(src: StateInit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeRef(src.code);
        b_0.storeRef(src.data);
    };
}

export function loadStateInit(slice: Slice) {
    const sc_0 = slice;
    const _code = sc_0.loadRef();
    const _data = sc_0.loadRef();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadGetterTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function storeTupleStateInit(source: StateInit) {
    const builder = new TupleBuilder();
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    return builder.build();
}

export function dictValueParserStateInit(): DictionaryValue<StateInit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStateInit(src)).endCell());
        },
        parse: (src) => {
            return loadStateInit(src.loadRef().beginParse());
        }
    }
}

export type Context = {
    $$type: 'Context';
    bounceable: boolean;
    sender: Address;
    value: bigint;
    raw: Slice;
}

export function storeContext(src: Context) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.bounceable);
        b_0.storeAddress(src.sender);
        b_0.storeInt(src.value, 257);
        b_0.storeRef(src.raw.asCell());
    };
}

export function loadContext(slice: Slice) {
    const sc_0 = slice;
    const _bounceable = sc_0.loadBit();
    const _sender = sc_0.loadAddress();
    const _value = sc_0.loadIntBig(257);
    const _raw = sc_0.loadRef().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadGetterTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function storeTupleContext(source: Context) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.bounceable);
    builder.writeAddress(source.sender);
    builder.writeNumber(source.value);
    builder.writeSlice(source.raw.asCell());
    return builder.build();
}

export function dictValueParserContext(): DictionaryValue<Context> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeContext(src)).endCell());
        },
        parse: (src) => {
            return loadContext(src.loadRef().beginParse());
        }
    }
}

export type SendParameters = {
    $$type: 'SendParameters';
    mode: bigint;
    body: Cell | null;
    code: Cell | null;
    data: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeSendParameters(src: SendParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        if (src.code !== null && src.code !== undefined) { b_0.storeBit(true).storeRef(src.code); } else { b_0.storeBit(false); }
        if (src.data !== null && src.data !== undefined) { b_0.storeBit(true).storeRef(src.data); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadSendParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _code = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _data = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleSendParameters(source: SendParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserSendParameters(): DictionaryValue<SendParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSendParameters(src)).endCell());
        },
        parse: (src) => {
            return loadSendParameters(src.loadRef().beginParse());
        }
    }
}

export type MessageParameters = {
    $$type: 'MessageParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeMessageParameters(src: MessageParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadMessageParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleMessageParameters(source: MessageParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserMessageParameters(): DictionaryValue<MessageParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMessageParameters(src)).endCell());
        },
        parse: (src) => {
            return loadMessageParameters(src.loadRef().beginParse());
        }
    }
}

export type DeployParameters = {
    $$type: 'DeployParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    bounce: boolean;
    init: StateInit;
}

export function storeDeployParameters(src: DeployParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeBit(src.bounce);
        b_0.store(storeStateInit(src.init));
    };
}

export function loadDeployParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _bounce = sc_0.loadBit();
    const _init = loadStateInit(sc_0);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadGetterTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadGetterTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function storeTupleDeployParameters(source: DeployParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeBoolean(source.bounce);
    builder.writeTuple(storeTupleStateInit(source.init));
    return builder.build();
}

export function dictValueParserDeployParameters(): DictionaryValue<DeployParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeployParameters(src)).endCell());
        },
        parse: (src) => {
            return loadDeployParameters(src.loadRef().beginParse());
        }
    }
}

export type StdAddress = {
    $$type: 'StdAddress';
    workchain: bigint;
    address: bigint;
}

export function storeStdAddress(src: StdAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 8);
        b_0.storeUint(src.address, 256);
    };
}

export function loadStdAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(8);
    const _address = sc_0.loadUintBig(256);
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleStdAddress(source: StdAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeNumber(source.address);
    return builder.build();
}

export function dictValueParserStdAddress(): DictionaryValue<StdAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStdAddress(src)).endCell());
        },
        parse: (src) => {
            return loadStdAddress(src.loadRef().beginParse());
        }
    }
}

export type VarAddress = {
    $$type: 'VarAddress';
    workchain: bigint;
    address: Slice;
}

export function storeVarAddress(src: VarAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 32);
        b_0.storeRef(src.address.asCell());
    };
}

export function loadVarAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(32);
    const _address = sc_0.loadRef().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleVarAddress(source: VarAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeSlice(source.address.asCell());
    return builder.build();
}

export function dictValueParserVarAddress(): DictionaryValue<VarAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeVarAddress(src)).endCell());
        },
        parse: (src) => {
            return loadVarAddress(src.loadRef().beginParse());
        }
    }
}

export type BasechainAddress = {
    $$type: 'BasechainAddress';
    hash: bigint | null;
}

export function storeBasechainAddress(src: BasechainAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        if (src.hash !== null && src.hash !== undefined) { b_0.storeBit(true).storeInt(src.hash, 257); } else { b_0.storeBit(false); }
    };
}

export function loadBasechainAddress(slice: Slice) {
    const sc_0 = slice;
    const _hash = sc_0.loadBit() ? sc_0.loadIntBig(257) : null;
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadGetterTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function storeTupleBasechainAddress(source: BasechainAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.hash);
    return builder.build();
}

export function dictValueParserBasechainAddress(): DictionaryValue<BasechainAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBasechainAddress(src)).endCell());
        },
        parse: (src) => {
            return loadBasechainAddress(src.loadRef().beginParse());
        }
    }
}

export type Transfer = {
    $$type: 'Transfer';
    queryId: bigint;
    newOwner: Address;
    responseDestination: Address | null;
    customPayload: Cell | null;
    forwardAmount: bigint;
    forwardPayload: Slice;
}

export function storeTransfer(src: Transfer) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1607220500, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.newOwner);
        b_0.storeAddress(src.responseDestination);
        if (src.customPayload !== null && src.customPayload !== undefined) { b_0.storeBit(true).storeRef(src.customPayload); } else { b_0.storeBit(false); }
        b_0.storeCoins(src.forwardAmount);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadTransfer(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1607220500) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _newOwner = sc_0.loadAddress();
    const _responseDestination = sc_0.loadMaybeAddress();
    const _customPayload = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _forwardAmount = sc_0.loadCoins();
    const _forwardPayload = sc_0;
    return { $$type: 'Transfer' as const, queryId: _queryId, newOwner: _newOwner, responseDestination: _responseDestination, customPayload: _customPayload, forwardAmount: _forwardAmount, forwardPayload: _forwardPayload };
}

export function loadTupleTransfer(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _newOwner = source.readAddress();
    const _responseDestination = source.readAddressOpt();
    const _customPayload = source.readCellOpt();
    const _forwardAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'Transfer' as const, queryId: _queryId, newOwner: _newOwner, responseDestination: _responseDestination, customPayload: _customPayload, forwardAmount: _forwardAmount, forwardPayload: _forwardPayload };
}

export function loadGetterTupleTransfer(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _newOwner = source.readAddress();
    const _responseDestination = source.readAddressOpt();
    const _customPayload = source.readCellOpt();
    const _forwardAmount = source.readBigNumber();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'Transfer' as const, queryId: _queryId, newOwner: _newOwner, responseDestination: _responseDestination, customPayload: _customPayload, forwardAmount: _forwardAmount, forwardPayload: _forwardPayload };
}

export function storeTupleTransfer(source: Transfer) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.newOwner);
    builder.writeAddress(source.responseDestination);
    builder.writeCell(source.customPayload);
    builder.writeNumber(source.forwardAmount);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserTransfer(): DictionaryValue<Transfer> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTransfer(src)).endCell());
        },
        parse: (src) => {
            return loadTransfer(src.loadRef().beginParse());
        }
    }
}

export type OwnershipAssigned = {
    $$type: 'OwnershipAssigned';
    queryId: bigint;
    prevOwner: Address;
    forwardPayload: Slice;
}

export function storeOwnershipAssigned(src: OwnershipAssigned) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(85167505, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.prevOwner);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadOwnershipAssigned(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 85167505) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _prevOwner = sc_0.loadAddress();
    const _forwardPayload = sc_0;
    return { $$type: 'OwnershipAssigned' as const, queryId: _queryId, prevOwner: _prevOwner, forwardPayload: _forwardPayload };
}

export function loadTupleOwnershipAssigned(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _prevOwner = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'OwnershipAssigned' as const, queryId: _queryId, prevOwner: _prevOwner, forwardPayload: _forwardPayload };
}

export function loadGetterTupleOwnershipAssigned(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _prevOwner = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'OwnershipAssigned' as const, queryId: _queryId, prevOwner: _prevOwner, forwardPayload: _forwardPayload };
}

export function storeTupleOwnershipAssigned(source: OwnershipAssigned) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.prevOwner);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserOwnershipAssigned(): DictionaryValue<OwnershipAssigned> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeOwnershipAssigned(src)).endCell());
        },
        parse: (src) => {
            return loadOwnershipAssigned(src.loadRef().beginParse());
        }
    }
}

export type Excesses = {
    $$type: 'Excesses';
    queryId: bigint;
}

export function storeExcesses(src: Excesses) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(3576854235, 32);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadExcesses(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 3576854235) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'Excesses' as const, queryId: _queryId };
}

export function loadTupleExcesses(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'Excesses' as const, queryId: _queryId };
}

export function loadGetterTupleExcesses(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'Excesses' as const, queryId: _queryId };
}

export function storeTupleExcesses(source: Excesses) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserExcesses(): DictionaryValue<Excesses> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeExcesses(src)).endCell());
        },
        parse: (src) => {
            return loadExcesses(src.loadRef().beginParse());
        }
    }
}

export type GetStaticData = {
    $$type: 'GetStaticData';
    queryId: bigint;
}

export function storeGetStaticData(src: GetStaticData) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(801842850, 32);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadGetStaticData(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 801842850) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'GetStaticData' as const, queryId: _queryId };
}

export function loadTupleGetStaticData(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'GetStaticData' as const, queryId: _queryId };
}

export function loadGetterTupleGetStaticData(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'GetStaticData' as const, queryId: _queryId };
}

export function storeTupleGetStaticData(source: GetStaticData) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserGetStaticData(): DictionaryValue<GetStaticData> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeGetStaticData(src)).endCell());
        },
        parse: (src) => {
            return loadGetStaticData(src.loadRef().beginParse());
        }
    }
}

export type ReportStaticData = {
    $$type: 'ReportStaticData';
    queryId: bigint;
    index: bigint;
    collection: Address;
}

export function storeReportStaticData(src: ReportStaticData) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2339837749, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeInt(src.index, 257);
        b_0.storeAddress(src.collection);
    };
}

export function loadReportStaticData(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2339837749) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _index = sc_0.loadIntBig(257);
    const _collection = sc_0.loadAddress();
    return { $$type: 'ReportStaticData' as const, queryId: _queryId, index: _index, collection: _collection };
}

export function loadTupleReportStaticData(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _index = source.readBigNumber();
    const _collection = source.readAddress();
    return { $$type: 'ReportStaticData' as const, queryId: _queryId, index: _index, collection: _collection };
}

export function loadGetterTupleReportStaticData(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _index = source.readBigNumber();
    const _collection = source.readAddress();
    return { $$type: 'ReportStaticData' as const, queryId: _queryId, index: _index, collection: _collection };
}

export function storeTupleReportStaticData(source: ReportStaticData) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.index);
    builder.writeAddress(source.collection);
    return builder.build();
}

export function dictValueParserReportStaticData(): DictionaryValue<ReportStaticData> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeReportStaticData(src)).endCell());
        },
        parse: (src) => {
            return loadReportStaticData(src.loadRef().beginParse());
        }
    }
}

export type NftData = {
    $$type: 'NftData';
    isInitialized: boolean;
    index: bigint;
    collectionAddress: Address;
    ownerAddress: Address;
    individualContent: Cell;
}

export function storeNftData(src: NftData) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.isInitialized);
        b_0.storeInt(src.index, 257);
        b_0.storeAddress(src.collectionAddress);
        b_0.storeAddress(src.ownerAddress);
        b_0.storeRef(src.individualContent);
    };
}

export function loadNftData(slice: Slice) {
    const sc_0 = slice;
    const _isInitialized = sc_0.loadBit();
    const _index = sc_0.loadIntBig(257);
    const _collectionAddress = sc_0.loadAddress();
    const _ownerAddress = sc_0.loadAddress();
    const _individualContent = sc_0.loadRef();
    return { $$type: 'NftData' as const, isInitialized: _isInitialized, index: _index, collectionAddress: _collectionAddress, ownerAddress: _ownerAddress, individualContent: _individualContent };
}

export function loadTupleNftData(source: TupleReader) {
    const _isInitialized = source.readBoolean();
    const _index = source.readBigNumber();
    const _collectionAddress = source.readAddress();
    const _ownerAddress = source.readAddress();
    const _individualContent = source.readCell();
    return { $$type: 'NftData' as const, isInitialized: _isInitialized, index: _index, collectionAddress: _collectionAddress, ownerAddress: _ownerAddress, individualContent: _individualContent };
}

export function loadGetterTupleNftData(source: TupleReader) {
    const _isInitialized = source.readBoolean();
    const _index = source.readBigNumber();
    const _collectionAddress = source.readAddress();
    const _ownerAddress = source.readAddress();
    const _individualContent = source.readCell();
    return { $$type: 'NftData' as const, isInitialized: _isInitialized, index: _index, collectionAddress: _collectionAddress, ownerAddress: _ownerAddress, individualContent: _individualContent };
}

export function storeTupleNftData(source: NftData) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.isInitialized);
    builder.writeNumber(source.index);
    builder.writeAddress(source.collectionAddress);
    builder.writeAddress(source.ownerAddress);
    builder.writeCell(source.individualContent);
    return builder.build();
}

export function dictValueParserNftData(): DictionaryValue<NftData> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeNftData(src)).endCell());
        },
        parse: (src) => {
            return loadNftData(src.loadRef().beginParse());
        }
    }
}

export type CollectionData = {
    $$type: 'CollectionData';
    nextItemIndex: bigint;
    collectionContent: Cell;
    ownerAddress: Address;
}

export function storeCollectionData(src: CollectionData) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.nextItemIndex, 257);
        b_0.storeRef(src.collectionContent);
        b_0.storeAddress(src.ownerAddress);
    };
}

export function loadCollectionData(slice: Slice) {
    const sc_0 = slice;
    const _nextItemIndex = sc_0.loadIntBig(257);
    const _collectionContent = sc_0.loadRef();
    const _ownerAddress = sc_0.loadAddress();
    return { $$type: 'CollectionData' as const, nextItemIndex: _nextItemIndex, collectionContent: _collectionContent, ownerAddress: _ownerAddress };
}

export function loadTupleCollectionData(source: TupleReader) {
    const _nextItemIndex = source.readBigNumber();
    const _collectionContent = source.readCell();
    const _ownerAddress = source.readAddress();
    return { $$type: 'CollectionData' as const, nextItemIndex: _nextItemIndex, collectionContent: _collectionContent, ownerAddress: _ownerAddress };
}

export function loadGetterTupleCollectionData(source: TupleReader) {
    const _nextItemIndex = source.readBigNumber();
    const _collectionContent = source.readCell();
    const _ownerAddress = source.readAddress();
    return { $$type: 'CollectionData' as const, nextItemIndex: _nextItemIndex, collectionContent: _collectionContent, ownerAddress: _ownerAddress };
}

export function storeTupleCollectionData(source: CollectionData) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.nextItemIndex);
    builder.writeCell(source.collectionContent);
    builder.writeAddress(source.ownerAddress);
    return builder.build();
}

export function dictValueParserCollectionData(): DictionaryValue<CollectionData> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeCollectionData(src)).endCell());
        },
        parse: (src) => {
            return loadCollectionData(src.loadRef().beginParse());
        }
    }
}

export type RoyaltyParams = {
    $$type: 'RoyaltyParams';
    numerator: bigint;
    denominator: bigint;
    destination: Address;
}

export function storeRoyaltyParams(src: RoyaltyParams) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.numerator, 257);
        b_0.storeInt(src.denominator, 257);
        b_0.storeAddress(src.destination);
    };
}

export function loadRoyaltyParams(slice: Slice) {
    const sc_0 = slice;
    const _numerator = sc_0.loadIntBig(257);
    const _denominator = sc_0.loadIntBig(257);
    const _destination = sc_0.loadAddress();
    return { $$type: 'RoyaltyParams' as const, numerator: _numerator, denominator: _denominator, destination: _destination };
}

export function loadTupleRoyaltyParams(source: TupleReader) {
    const _numerator = source.readBigNumber();
    const _denominator = source.readBigNumber();
    const _destination = source.readAddress();
    return { $$type: 'RoyaltyParams' as const, numerator: _numerator, denominator: _denominator, destination: _destination };
}

export function loadGetterTupleRoyaltyParams(source: TupleReader) {
    const _numerator = source.readBigNumber();
    const _denominator = source.readBigNumber();
    const _destination = source.readAddress();
    return { $$type: 'RoyaltyParams' as const, numerator: _numerator, denominator: _denominator, destination: _destination };
}

export function storeTupleRoyaltyParams(source: RoyaltyParams) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.numerator);
    builder.writeNumber(source.denominator);
    builder.writeAddress(source.destination);
    return builder.build();
}

export function dictValueParserRoyaltyParams(): DictionaryValue<RoyaltyParams> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRoyaltyParams(src)).endCell());
        },
        parse: (src) => {
            return loadRoyaltyParams(src.loadRef().beginParse());
        }
    }
}

export type ItemInit = {
    $$type: 'ItemInit';
    owner: Address;
    season: bigint;
    tier: bigint;
    paid: bigint;
    mintedAt: bigint;
}

export function storeItemInit(src: ItemInit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024065, 32);
        b_0.storeAddress(src.owner);
        b_0.storeUint(src.season, 16);
        b_0.storeUint(src.tier, 8);
        b_0.storeCoins(src.paid);
        b_0.storeUint(src.mintedAt, 32);
    };
}

export function loadItemInit(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024065) { throw Error('Invalid prefix'); }
    const _owner = sc_0.loadAddress();
    const _season = sc_0.loadUintBig(16);
    const _tier = sc_0.loadUintBig(8);
    const _paid = sc_0.loadCoins();
    const _mintedAt = sc_0.loadUintBig(32);
    return { $$type: 'ItemInit' as const, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt };
}

export function loadTupleItemInit(source: TupleReader) {
    const _owner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    return { $$type: 'ItemInit' as const, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt };
}

export function loadGetterTupleItemInit(source: TupleReader) {
    const _owner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    return { $$type: 'ItemInit' as const, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt };
}

export function storeTupleItemInit(source: ItemInit) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.owner);
    builder.writeNumber(source.season);
    builder.writeNumber(source.tier);
    builder.writeNumber(source.paid);
    builder.writeNumber(source.mintedAt);
    return builder.build();
}

export function dictValueParserItemInit(): DictionaryValue<ItemInit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeItemInit(src)).endCell());
        },
        parse: (src) => {
            return loadItemInit(src.loadRef().beginParse());
        }
    }
}

export type MintItem = {
    $$type: 'MintItem';
    index: bigint;
    newOwner: Address;
    season: bigint;
    tier: bigint;
    paid: bigint;
}

export function storeMintItem(src: MintItem) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024066, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeAddress(src.newOwner);
        b_0.storeUint(src.season, 16);
        b_0.storeUint(src.tier, 8);
        b_0.storeCoins(src.paid);
    };
}

export function loadMintItem(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024066) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _newOwner = sc_0.loadAddress();
    const _season = sc_0.loadUintBig(16);
    const _tier = sc_0.loadUintBig(8);
    const _paid = sc_0.loadCoins();
    return { $$type: 'MintItem' as const, index: _index, newOwner: _newOwner, season: _season, tier: _tier, paid: _paid };
}

export function loadTupleMintItem(source: TupleReader) {
    const _index = source.readBigNumber();
    const _newOwner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    return { $$type: 'MintItem' as const, index: _index, newOwner: _newOwner, season: _season, tier: _tier, paid: _paid };
}

export function loadGetterTupleMintItem(source: TupleReader) {
    const _index = source.readBigNumber();
    const _newOwner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    return { $$type: 'MintItem' as const, index: _index, newOwner: _newOwner, season: _season, tier: _tier, paid: _paid };
}

export function storeTupleMintItem(source: MintItem) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeAddress(source.newOwner);
    builder.writeNumber(source.season);
    builder.writeNumber(source.tier);
    builder.writeNumber(source.paid);
    return builder.build();
}

export function dictValueParserMintItem(): DictionaryValue<MintItem> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMintItem(src)).endCell());
        },
        parse: (src) => {
            return loadMintItem(src.loadRef().beginParse());
        }
    }
}

export type Proceeds = {
    $$type: 'Proceeds';
}

export function storeProceeds(src: Proceeds) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024067, 32);
    };
}

export function loadProceeds(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024067) { throw Error('Invalid prefix'); }
    return { $$type: 'Proceeds' as const };
}

export function loadTupleProceeds(source: TupleReader) {
    return { $$type: 'Proceeds' as const };
}

export function loadGetterTupleProceeds(source: TupleReader) {
    return { $$type: 'Proceeds' as const };
}

export function storeTupleProceeds(source: Proceeds) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserProceeds(): DictionaryValue<Proceeds> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeProceeds(src)).endCell());
        },
        parse: (src) => {
            return loadProceeds(src.loadRef().beginParse());
        }
    }
}

export type MintOk = {
    $$type: 'MintOk';
    index: bigint;
}

export function storeMintOk(src: MintOk) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024069, 32);
        b_0.storeUint(src.index, 64);
    };
}

export function loadMintOk(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024069) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    return { $$type: 'MintOk' as const, index: _index };
}

export function loadTupleMintOk(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'MintOk' as const, index: _index };
}

export function loadGetterTupleMintOk(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'MintOk' as const, index: _index };
}

export function storeTupleMintOk(source: MintOk) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    return builder.build();
}

export function dictValueParserMintOk(): DictionaryValue<MintOk> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMintOk(src)).endCell());
        },
        parse: (src) => {
            return loadMintOk(src.loadRef().beginParse());
        }
    }
}

export type Engrave = {
    $$type: 'Engrave';
    text: string;
}

export function storeEngrave(src: Engrave) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024068, 32);
        b_0.storeStringRefTail(src.text);
    };
}

export function loadEngrave(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024068) { throw Error('Invalid prefix'); }
    const _text = sc_0.loadStringRefTail();
    return { $$type: 'Engrave' as const, text: _text };
}

export function loadTupleEngrave(source: TupleReader) {
    const _text = source.readString();
    return { $$type: 'Engrave' as const, text: _text };
}

export function loadGetterTupleEngrave(source: TupleReader) {
    const _text = source.readString();
    return { $$type: 'Engrave' as const, text: _text };
}

export function storeTupleEngrave(source: Engrave) {
    const builder = new TupleBuilder();
    builder.writeString(source.text);
    return builder.build();
}

export function dictValueParserEngrave(): DictionaryValue<Engrave> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeEngrave(src)).endCell());
        },
        parse: (src) => {
            return loadEngrave(src.loadRef().beginParse());
        }
    }
}

export type UpgradeStart = {
    $$type: 'UpgradeStart';
    queryId: bigint;
}

export function storeUpgradeStart(src: UpgradeStart) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024080, 32);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadUpgradeStart(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024080) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'UpgradeStart' as const, queryId: _queryId };
}

export function loadTupleUpgradeStart(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'UpgradeStart' as const, queryId: _queryId };
}

export function loadGetterTupleUpgradeStart(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'UpgradeStart' as const, queryId: _queryId };
}

export function storeTupleUpgradeStart(source: UpgradeStart) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserUpgradeStart(): DictionaryValue<UpgradeStart> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeUpgradeStart(src)).endCell());
        },
        parse: (src) => {
            return loadUpgradeStart(src.loadRef().beginParse());
        }
    }
}

export type UpgradeRequest = {
    $$type: 'UpgradeRequest';
    index: bigint;
    owner: Address;
    season: bigint;
    tier: bigint;
    paid: bigint;
    mintedAt: bigint;
    hands: bigint;
    engravings: Cell | null;
}

export function storeUpgradeRequest(src: UpgradeRequest) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024081, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeAddress(src.owner);
        b_0.storeUint(src.season, 16);
        b_0.storeUint(src.tier, 8);
        b_0.storeCoins(src.paid);
        b_0.storeUint(src.mintedAt, 32);
        b_0.storeUint(src.hands, 32);
        if (src.engravings !== null && src.engravings !== undefined) { b_0.storeBit(true).storeRef(src.engravings); } else { b_0.storeBit(false); }
    };
}

export function loadUpgradeRequest(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024081) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _owner = sc_0.loadAddress();
    const _season = sc_0.loadUintBig(16);
    const _tier = sc_0.loadUintBig(8);
    const _paid = sc_0.loadCoins();
    const _mintedAt = sc_0.loadUintBig(32);
    const _hands = sc_0.loadUintBig(32);
    const _engravings = sc_0.loadBit() ? sc_0.loadRef() : null;
    return { $$type: 'UpgradeRequest' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings };
}

export function loadTupleUpgradeRequest(source: TupleReader) {
    const _index = source.readBigNumber();
    const _owner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _hands = source.readBigNumber();
    const _engravings = source.readCellOpt();
    return { $$type: 'UpgradeRequest' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings };
}

export function loadGetterTupleUpgradeRequest(source: TupleReader) {
    const _index = source.readBigNumber();
    const _owner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _hands = source.readBigNumber();
    const _engravings = source.readCellOpt();
    return { $$type: 'UpgradeRequest' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings };
}

export function storeTupleUpgradeRequest(source: UpgradeRequest) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeAddress(source.owner);
    builder.writeNumber(source.season);
    builder.writeNumber(source.tier);
    builder.writeNumber(source.paid);
    builder.writeNumber(source.mintedAt);
    builder.writeNumber(source.hands);
    builder.writeCell(source.engravings);
    return builder.build();
}

export function dictValueParserUpgradeRequest(): DictionaryValue<UpgradeRequest> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeUpgradeRequest(src)).endCell());
        },
        parse: (src) => {
            return loadUpgradeRequest(src.loadRef().beginParse());
        }
    }
}

export type UpgradeAccept = {
    $$type: 'UpgradeAccept';
    index: bigint;
    owner: Address;
    season: bigint;
    tier: bigint;
    paid: bigint;
    mintedAt: bigint;
    hands: bigint;
    engravings: Cell | null;
}

export function storeUpgradeAccept(src: UpgradeAccept) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024082, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeAddress(src.owner);
        b_0.storeUint(src.season, 16);
        b_0.storeUint(src.tier, 8);
        b_0.storeCoins(src.paid);
        b_0.storeUint(src.mintedAt, 32);
        b_0.storeUint(src.hands, 32);
        if (src.engravings !== null && src.engravings !== undefined) { b_0.storeBit(true).storeRef(src.engravings); } else { b_0.storeBit(false); }
    };
}

export function loadUpgradeAccept(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024082) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _owner = sc_0.loadAddress();
    const _season = sc_0.loadUintBig(16);
    const _tier = sc_0.loadUintBig(8);
    const _paid = sc_0.loadCoins();
    const _mintedAt = sc_0.loadUintBig(32);
    const _hands = sc_0.loadUintBig(32);
    const _engravings = sc_0.loadBit() ? sc_0.loadRef() : null;
    return { $$type: 'UpgradeAccept' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings };
}

export function loadTupleUpgradeAccept(source: TupleReader) {
    const _index = source.readBigNumber();
    const _owner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _hands = source.readBigNumber();
    const _engravings = source.readCellOpt();
    return { $$type: 'UpgradeAccept' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings };
}

export function loadGetterTupleUpgradeAccept(source: TupleReader) {
    const _index = source.readBigNumber();
    const _owner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _hands = source.readBigNumber();
    const _engravings = source.readCellOpt();
    return { $$type: 'UpgradeAccept' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings };
}

export function storeTupleUpgradeAccept(source: UpgradeAccept) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeAddress(source.owner);
    builder.writeNumber(source.season);
    builder.writeNumber(source.tier);
    builder.writeNumber(source.paid);
    builder.writeNumber(source.mintedAt);
    builder.writeNumber(source.hands);
    builder.writeCell(source.engravings);
    return builder.build();
}

export function dictValueParserUpgradeAccept(): DictionaryValue<UpgradeAccept> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeUpgradeAccept(src)).endCell());
        },
        parse: (src) => {
            return loadUpgradeAccept(src.loadRef().beginParse());
        }
    }
}

export type UpgradeDone = {
    $$type: 'UpgradeDone';
    index: bigint;
}

export function storeUpgradeDone(src: UpgradeDone) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024083, 32);
        b_0.storeUint(src.index, 64);
    };
}

export function loadUpgradeDone(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024083) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    return { $$type: 'UpgradeDone' as const, index: _index };
}

export function loadTupleUpgradeDone(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'UpgradeDone' as const, index: _index };
}

export function loadGetterTupleUpgradeDone(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'UpgradeDone' as const, index: _index };
}

export function storeTupleUpgradeDone(source: UpgradeDone) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    return builder.build();
}

export function dictValueParserUpgradeDone(): DictionaryValue<UpgradeDone> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeUpgradeDone(src)).endCell());
        },
        parse: (src) => {
            return loadUpgradeDone(src.loadRef().beginParse());
        }
    }
}

export type BurnConfirm = {
    $$type: 'BurnConfirm';
}

export function storeBurnConfirm(src: BurnConfirm) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024084, 32);
    };
}

export function loadBurnConfirm(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024084) { throw Error('Invalid prefix'); }
    return { $$type: 'BurnConfirm' as const };
}

export function loadTupleBurnConfirm(source: TupleReader) {
    return { $$type: 'BurnConfirm' as const };
}

export function loadGetterTupleBurnConfirm(source: TupleReader) {
    return { $$type: 'BurnConfirm' as const };
}

export function storeTupleBurnConfirm(source: BurnConfirm) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserBurnConfirm(): DictionaryValue<BurnConfirm> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBurnConfirm(src)).endCell());
        },
        parse: (src) => {
            return loadBurnConfirm(src.loadRef().beginParse());
        }
    }
}

export type UpgradeAbort = {
    $$type: 'UpgradeAbort';
    index: bigint;
}

export function storeUpgradeAbort(src: UpgradeAbort) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024085, 32);
        b_0.storeUint(src.index, 64);
    };
}

export function loadUpgradeAbort(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024085) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    return { $$type: 'UpgradeAbort' as const, index: _index };
}

export function loadTupleUpgradeAbort(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'UpgradeAbort' as const, index: _index };
}

export function loadGetterTupleUpgradeAbort(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'UpgradeAbort' as const, index: _index };
}

export function storeTupleUpgradeAbort(source: UpgradeAbort) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    return builder.build();
}

export function dictValueParserUpgradeAbort(): DictionaryValue<UpgradeAbort> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeUpgradeAbort(src)).endCell());
        },
        parse: (src) => {
            return loadUpgradeAbort(src.loadRef().beginParse());
        }
    }
}

export type ProposeMinter = {
    $$type: 'ProposeMinter';
    minter: Address;
}

export function storeProposeMinter(src: ProposeMinter) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024096, 32);
        b_0.storeAddress(src.minter);
    };
}

export function loadProposeMinter(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024096) { throw Error('Invalid prefix'); }
    const _minter = sc_0.loadAddress();
    return { $$type: 'ProposeMinter' as const, minter: _minter };
}

export function loadTupleProposeMinter(source: TupleReader) {
    const _minter = source.readAddress();
    return { $$type: 'ProposeMinter' as const, minter: _minter };
}

export function loadGetterTupleProposeMinter(source: TupleReader) {
    const _minter = source.readAddress();
    return { $$type: 'ProposeMinter' as const, minter: _minter };
}

export function storeTupleProposeMinter(source: ProposeMinter) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.minter);
    return builder.build();
}

export function dictValueParserProposeMinter(): DictionaryValue<ProposeMinter> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeProposeMinter(src)).endCell());
        },
        parse: (src) => {
            return loadProposeMinter(src.loadRef().beginParse());
        }
    }
}

export type RemoveMinter = {
    $$type: 'RemoveMinter';
    minter: Address;
}

export function storeRemoveMinter(src: RemoveMinter) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024097, 32);
        b_0.storeAddress(src.minter);
    };
}

export function loadRemoveMinter(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024097) { throw Error('Invalid prefix'); }
    const _minter = sc_0.loadAddress();
    return { $$type: 'RemoveMinter' as const, minter: _minter };
}

export function loadTupleRemoveMinter(source: TupleReader) {
    const _minter = source.readAddress();
    return { $$type: 'RemoveMinter' as const, minter: _minter };
}

export function loadGetterTupleRemoveMinter(source: TupleReader) {
    const _minter = source.readAddress();
    return { $$type: 'RemoveMinter' as const, minter: _minter };
}

export function storeTupleRemoveMinter(source: RemoveMinter) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.minter);
    return builder.build();
}

export function dictValueParserRemoveMinter(): DictionaryValue<RemoveMinter> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRemoveMinter(src)).endCell());
        },
        parse: (src) => {
            return loadRemoveMinter(src.loadRef().beginParse());
        }
    }
}

export type ProposePayout = {
    $$type: 'ProposePayout';
    payout: Address;
}

export function storeProposePayout(src: ProposePayout) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024098, 32);
        b_0.storeAddress(src.payout);
    };
}

export function loadProposePayout(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024098) { throw Error('Invalid prefix'); }
    const _payout = sc_0.loadAddress();
    return { $$type: 'ProposePayout' as const, payout: _payout };
}

export function loadTupleProposePayout(source: TupleReader) {
    const _payout = source.readAddress();
    return { $$type: 'ProposePayout' as const, payout: _payout };
}

export function loadGetterTupleProposePayout(source: TupleReader) {
    const _payout = source.readAddress();
    return { $$type: 'ProposePayout' as const, payout: _payout };
}

export function storeTupleProposePayout(source: ProposePayout) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.payout);
    return builder.build();
}

export function dictValueParserProposePayout(): DictionaryValue<ProposePayout> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeProposePayout(src)).endCell());
        },
        parse: (src) => {
            return loadProposePayout(src.loadRef().beginParse());
        }
    }
}

export type ApplyPayout = {
    $$type: 'ApplyPayout';
}

export function storeApplyPayout(src: ApplyPayout) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024099, 32);
    };
}

export function loadApplyPayout(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024099) { throw Error('Invalid prefix'); }
    return { $$type: 'ApplyPayout' as const };
}

export function loadTupleApplyPayout(source: TupleReader) {
    return { $$type: 'ApplyPayout' as const };
}

export function loadGetterTupleApplyPayout(source: TupleReader) {
    return { $$type: 'ApplyPayout' as const };
}

export function storeTupleApplyPayout(source: ApplyPayout) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserApplyPayout(): DictionaryValue<ApplyPayout> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeApplyPayout(src)).endCell());
        },
        parse: (src) => {
            return loadApplyPayout(src.loadRef().beginParse());
        }
    }
}

export type ProposeBaseUri = {
    $$type: 'ProposeBaseUri';
    uri: string;
}

export function storeProposeBaseUri(src: ProposeBaseUri) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024100, 32);
        b_0.storeStringRefTail(src.uri);
    };
}

export function loadProposeBaseUri(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024100) { throw Error('Invalid prefix'); }
    const _uri = sc_0.loadStringRefTail();
    return { $$type: 'ProposeBaseUri' as const, uri: _uri };
}

export function loadTupleProposeBaseUri(source: TupleReader) {
    const _uri = source.readString();
    return { $$type: 'ProposeBaseUri' as const, uri: _uri };
}

export function loadGetterTupleProposeBaseUri(source: TupleReader) {
    const _uri = source.readString();
    return { $$type: 'ProposeBaseUri' as const, uri: _uri };
}

export function storeTupleProposeBaseUri(source: ProposeBaseUri) {
    const builder = new TupleBuilder();
    builder.writeString(source.uri);
    return builder.build();
}

export function dictValueParserProposeBaseUri(): DictionaryValue<ProposeBaseUri> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeProposeBaseUri(src)).endCell());
        },
        parse: (src) => {
            return loadProposeBaseUri(src.loadRef().beginParse());
        }
    }
}

export type ApplyBaseUri = {
    $$type: 'ApplyBaseUri';
}

export function storeApplyBaseUri(src: ApplyBaseUri) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024101, 32);
    };
}

export function loadApplyBaseUri(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024101) { throw Error('Invalid prefix'); }
    return { $$type: 'ApplyBaseUri' as const };
}

export function loadTupleApplyBaseUri(source: TupleReader) {
    return { $$type: 'ApplyBaseUri' as const };
}

export function loadGetterTupleApplyBaseUri(source: TupleReader) {
    return { $$type: 'ApplyBaseUri' as const };
}

export function storeTupleApplyBaseUri(source: ApplyBaseUri) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserApplyBaseUri(): DictionaryValue<ApplyBaseUri> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeApplyBaseUri(src)).endCell());
        },
        parse: (src) => {
            return loadApplyBaseUri(src.loadRef().beginParse());
        }
    }
}

export type SetSuccessor = {
    $$type: 'SetSuccessor';
    successor: Address;
}

export function storeSetSuccessor(src: SetSuccessor) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024102, 32);
        b_0.storeAddress(src.successor);
    };
}

export function loadSetSuccessor(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024102) { throw Error('Invalid prefix'); }
    const _successor = sc_0.loadAddress();
    return { $$type: 'SetSuccessor' as const, successor: _successor };
}

export function loadTupleSetSuccessor(source: TupleReader) {
    const _successor = source.readAddress();
    return { $$type: 'SetSuccessor' as const, successor: _successor };
}

export function loadGetterTupleSetSuccessor(source: TupleReader) {
    const _successor = source.readAddress();
    return { $$type: 'SetSuccessor' as const, successor: _successor };
}

export function storeTupleSetSuccessor(source: SetSuccessor) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.successor);
    return builder.build();
}

export function dictValueParserSetSuccessor(): DictionaryValue<SetSuccessor> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetSuccessor(src)).endCell());
        },
        parse: (src) => {
            return loadSetSuccessor(src.loadRef().beginParse());
        }
    }
}

export type Withdraw = {
    $$type: 'Withdraw';
}

export function storeWithdraw(src: Withdraw) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024103, 32);
    };
}

export function loadWithdraw(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024103) { throw Error('Invalid prefix'); }
    return { $$type: 'Withdraw' as const };
}

export function loadTupleWithdraw(source: TupleReader) {
    return { $$type: 'Withdraw' as const };
}

export function loadGetterTupleWithdraw(source: TupleReader) {
    return { $$type: 'Withdraw' as const };
}

export function storeTupleWithdraw(source: Withdraw) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserWithdraw(): DictionaryValue<Withdraw> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeWithdraw(src)).endCell());
        },
        parse: (src) => {
            return loadWithdraw(src.loadRef().beginParse());
        }
    }
}

export type Ymd = {
    $$type: 'Ymd';
    y: bigint;
    m: bigint;
    d: bigint;
}

export function storeYmd(src: Ymd) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.y, 257);
        b_0.storeInt(src.m, 257);
        b_0.storeInt(src.d, 257);
    };
}

export function loadYmd(slice: Slice) {
    const sc_0 = slice;
    const _y = sc_0.loadIntBig(257);
    const _m = sc_0.loadIntBig(257);
    const _d = sc_0.loadIntBig(257);
    return { $$type: 'Ymd' as const, y: _y, m: _m, d: _d };
}

export function loadTupleYmd(source: TupleReader) {
    const _y = source.readBigNumber();
    const _m = source.readBigNumber();
    const _d = source.readBigNumber();
    return { $$type: 'Ymd' as const, y: _y, m: _m, d: _d };
}

export function loadGetterTupleYmd(source: TupleReader) {
    const _y = source.readBigNumber();
    const _m = source.readBigNumber();
    const _d = source.readBigNumber();
    return { $$type: 'Ymd' as const, y: _y, m: _m, d: _d };
}

export function storeTupleYmd(source: Ymd) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.y);
    builder.writeNumber(source.m);
    builder.writeNumber(source.d);
    return builder.build();
}

export function dictValueParserYmd(): DictionaryValue<Ymd> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeYmd(src)).endCell());
        },
        parse: (src) => {
            return loadYmd(src.loadRef().beginParse());
        }
    }
}

export type AtharItem$Data = {
    $$type: 'AtharItem$Data';
    collection: Address;
    index: bigint;
    owner: Address | null;
    season: bigint;
    tier: bigint;
    paid: bigint;
    mintedAt: bigint;
    lastTransferAt: bigint;
    hands: bigint;
    engravings: Cell | null;
    locked: boolean;
}

export function storeAtharItem$Data(src: AtharItem$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.collection);
        b_0.storeUint(src.index, 64);
        b_0.storeAddress(src.owner);
        b_0.storeUint(src.season, 16);
        b_0.storeUint(src.tier, 8);
        b_0.storeCoins(src.paid);
        b_0.storeUint(src.mintedAt, 32);
        b_0.storeUint(src.lastTransferAt, 32);
        b_0.storeUint(src.hands, 32);
        if (src.engravings !== null && src.engravings !== undefined) { b_0.storeBit(true).storeRef(src.engravings); } else { b_0.storeBit(false); }
        b_0.storeBit(src.locked);
    };
}

export function loadAtharItem$Data(slice: Slice) {
    const sc_0 = slice;
    const _collection = sc_0.loadAddress();
    const _index = sc_0.loadUintBig(64);
    const _owner = sc_0.loadMaybeAddress();
    const _season = sc_0.loadUintBig(16);
    const _tier = sc_0.loadUintBig(8);
    const _paid = sc_0.loadCoins();
    const _mintedAt = sc_0.loadUintBig(32);
    const _lastTransferAt = sc_0.loadUintBig(32);
    const _hands = sc_0.loadUintBig(32);
    const _engravings = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _locked = sc_0.loadBit();
    return { $$type: 'AtharItem$Data' as const, collection: _collection, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, locked: _locked };
}

export function loadTupleAtharItem$Data(source: TupleReader) {
    const _collection = source.readAddress();
    const _index = source.readBigNumber();
    const _owner = source.readAddressOpt();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _lastTransferAt = source.readBigNumber();
    const _hands = source.readBigNumber();
    const _engravings = source.readCellOpt();
    const _locked = source.readBoolean();
    return { $$type: 'AtharItem$Data' as const, collection: _collection, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, locked: _locked };
}

export function loadGetterTupleAtharItem$Data(source: TupleReader) {
    const _collection = source.readAddress();
    const _index = source.readBigNumber();
    const _owner = source.readAddressOpt();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _lastTransferAt = source.readBigNumber();
    const _hands = source.readBigNumber();
    const _engravings = source.readCellOpt();
    const _locked = source.readBoolean();
    return { $$type: 'AtharItem$Data' as const, collection: _collection, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, locked: _locked };
}

export function storeTupleAtharItem$Data(source: AtharItem$Data) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.collection);
    builder.writeNumber(source.index);
    builder.writeAddress(source.owner);
    builder.writeNumber(source.season);
    builder.writeNumber(source.tier);
    builder.writeNumber(source.paid);
    builder.writeNumber(source.mintedAt);
    builder.writeNumber(source.lastTransferAt);
    builder.writeNumber(source.hands);
    builder.writeCell(source.engravings);
    builder.writeBoolean(source.locked);
    return builder.build();
}

export function dictValueParserAtharItem$Data(): DictionaryValue<AtharItem$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeAtharItem$Data(src)).endCell());
        },
        parse: (src) => {
            return loadAtharItem$Data(src.loadRef().beginParse());
        }
    }
}

export type AtharState = {
    $$type: 'AtharState';
    season: bigint;
    tier: bigint;
    paid: bigint;
    mintedAt: bigint;
    lastTransferAt: bigint;
    hands: bigint;
    engravings: Cell | null;
    locked: boolean;
}

export function storeAtharState(src: AtharState) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.season, 257);
        b_0.storeInt(src.tier, 257);
        b_0.storeInt(src.paid, 257);
        const b_1 = new Builder();
        b_1.storeInt(src.mintedAt, 257);
        b_1.storeInt(src.lastTransferAt, 257);
        b_1.storeInt(src.hands, 257);
        if (src.engravings !== null && src.engravings !== undefined) { b_1.storeBit(true).storeRef(src.engravings); } else { b_1.storeBit(false); }
        b_1.storeBit(src.locked);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadAtharState(slice: Slice) {
    const sc_0 = slice;
    const _season = sc_0.loadIntBig(257);
    const _tier = sc_0.loadIntBig(257);
    const _paid = sc_0.loadIntBig(257);
    const sc_1 = sc_0.loadRef().beginParse();
    const _mintedAt = sc_1.loadIntBig(257);
    const _lastTransferAt = sc_1.loadIntBig(257);
    const _hands = sc_1.loadIntBig(257);
    const _engravings = sc_1.loadBit() ? sc_1.loadRef() : null;
    const _locked = sc_1.loadBit();
    return { $$type: 'AtharState' as const, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, locked: _locked };
}

export function loadTupleAtharState(source: TupleReader) {
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _lastTransferAt = source.readBigNumber();
    const _hands = source.readBigNumber();
    const _engravings = source.readCellOpt();
    const _locked = source.readBoolean();
    return { $$type: 'AtharState' as const, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, locked: _locked };
}

export function loadGetterTupleAtharState(source: TupleReader) {
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _lastTransferAt = source.readBigNumber();
    const _hands = source.readBigNumber();
    const _engravings = source.readCellOpt();
    const _locked = source.readBoolean();
    return { $$type: 'AtharState' as const, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, locked: _locked };
}

export function storeTupleAtharState(source: AtharState) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.season);
    builder.writeNumber(source.tier);
    builder.writeNumber(source.paid);
    builder.writeNumber(source.mintedAt);
    builder.writeNumber(source.lastTransferAt);
    builder.writeNumber(source.hands);
    builder.writeCell(source.engravings);
    builder.writeBoolean(source.locked);
    return builder.build();
}

export function dictValueParserAtharState(): DictionaryValue<AtharState> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeAtharState(src)).endCell());
        },
        parse: (src) => {
            return loadAtharState(src.loadRef().beginParse());
        }
    }
}

export type AtharCollection$Data = {
    $$type: 'AtharCollection$Data';
    admin: Address;
    collectionUri: string;
    delaySec: bigint;
    baseUri: string;
    payout: Address | null;
    royaltyNum: bigint;
    royaltyDen: bigint;
    minters: Dictionary<Address, number>;
    pendingPayout: Address | null;
    pendingPayoutAt: bigint;
    pendingBaseUri: string | null;
    pendingBaseUriAt: bigint;
    successor: Address | null;
    minted: bigint;
}

export function storeAtharCollection$Data(src: AtharCollection$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.admin);
        b_0.storeStringRefTail(src.collectionUri);
        b_0.storeUint(src.delaySec, 32);
        b_0.storeStringRefTail(src.baseUri);
        b_0.storeAddress(src.payout);
        b_0.storeUint(src.royaltyNum, 16);
        b_0.storeUint(src.royaltyDen, 16);
        const b_1 = new Builder();
        b_1.storeDict(src.minters, Dictionary.Keys.Address(), Dictionary.Values.Uint(32));
        b_1.storeAddress(src.pendingPayout);
        b_1.storeUint(src.pendingPayoutAt, 32);
        if (src.pendingBaseUri !== null && src.pendingBaseUri !== undefined) { b_1.storeBit(true).storeStringRefTail(src.pendingBaseUri); } else { b_1.storeBit(false); }
        b_1.storeUint(src.pendingBaseUriAt, 32);
        b_1.storeAddress(src.successor);
        b_1.storeUint(src.minted, 32);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadAtharCollection$Data(slice: Slice) {
    const sc_0 = slice;
    const _admin = sc_0.loadAddress();
    const _collectionUri = sc_0.loadStringRefTail();
    const _delaySec = sc_0.loadUintBig(32);
    const _baseUri = sc_0.loadStringRefTail();
    const _payout = sc_0.loadMaybeAddress();
    const _royaltyNum = sc_0.loadUintBig(16);
    const _royaltyDen = sc_0.loadUintBig(16);
    const sc_1 = sc_0.loadRef().beginParse();
    const _minters = Dictionary.load(Dictionary.Keys.Address(), Dictionary.Values.Uint(32), sc_1);
    const _pendingPayout = sc_1.loadMaybeAddress();
    const _pendingPayoutAt = sc_1.loadUintBig(32);
    const _pendingBaseUri = sc_1.loadBit() ? sc_1.loadStringRefTail() : null;
    const _pendingBaseUriAt = sc_1.loadUintBig(32);
    const _successor = sc_1.loadMaybeAddress();
    const _minted = sc_1.loadUintBig(32);
    return { $$type: 'AtharCollection$Data' as const, admin: _admin, collectionUri: _collectionUri, delaySec: _delaySec, baseUri: _baseUri, payout: _payout, royaltyNum: _royaltyNum, royaltyDen: _royaltyDen, minters: _minters, pendingPayout: _pendingPayout, pendingPayoutAt: _pendingPayoutAt, pendingBaseUri: _pendingBaseUri, pendingBaseUriAt: _pendingBaseUriAt, successor: _successor, minted: _minted };
}

export function loadTupleAtharCollection$Data(source: TupleReader) {
    const _admin = source.readAddress();
    const _collectionUri = source.readString();
    const _delaySec = source.readBigNumber();
    const _baseUri = source.readString();
    const _payout = source.readAddressOpt();
    const _royaltyNum = source.readBigNumber();
    const _royaltyDen = source.readBigNumber();
    const _minters = Dictionary.loadDirect(Dictionary.Keys.Address(), Dictionary.Values.Uint(32), source.readCellOpt());
    const _pendingPayout = source.readAddressOpt();
    const _pendingPayoutAt = source.readBigNumber();
    const _pendingBaseUri = source.readStringOpt();
    const _pendingBaseUriAt = source.readBigNumber();
    const _successor = source.readAddressOpt();
    const _minted = source.readBigNumber();
    return { $$type: 'AtharCollection$Data' as const, admin: _admin, collectionUri: _collectionUri, delaySec: _delaySec, baseUri: _baseUri, payout: _payout, royaltyNum: _royaltyNum, royaltyDen: _royaltyDen, minters: _minters, pendingPayout: _pendingPayout, pendingPayoutAt: _pendingPayoutAt, pendingBaseUri: _pendingBaseUri, pendingBaseUriAt: _pendingBaseUriAt, successor: _successor, minted: _minted };
}

export function loadGetterTupleAtharCollection$Data(source: TupleReader) {
    const _admin = source.readAddress();
    const _collectionUri = source.readString();
    const _delaySec = source.readBigNumber();
    const _baseUri = source.readString();
    const _payout = source.readAddressOpt();
    const _royaltyNum = source.readBigNumber();
    const _royaltyDen = source.readBigNumber();
    const _minters = Dictionary.loadDirect(Dictionary.Keys.Address(), Dictionary.Values.Uint(32), source.readCellOpt());
    const _pendingPayout = source.readAddressOpt();
    const _pendingPayoutAt = source.readBigNumber();
    const _pendingBaseUri = source.readStringOpt();
    const _pendingBaseUriAt = source.readBigNumber();
    const _successor = source.readAddressOpt();
    const _minted = source.readBigNumber();
    return { $$type: 'AtharCollection$Data' as const, admin: _admin, collectionUri: _collectionUri, delaySec: _delaySec, baseUri: _baseUri, payout: _payout, royaltyNum: _royaltyNum, royaltyDen: _royaltyDen, minters: _minters, pendingPayout: _pendingPayout, pendingPayoutAt: _pendingPayoutAt, pendingBaseUri: _pendingBaseUri, pendingBaseUriAt: _pendingBaseUriAt, successor: _successor, minted: _minted };
}

export function storeTupleAtharCollection$Data(source: AtharCollection$Data) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.admin);
    builder.writeString(source.collectionUri);
    builder.writeNumber(source.delaySec);
    builder.writeString(source.baseUri);
    builder.writeAddress(source.payout);
    builder.writeNumber(source.royaltyNum);
    builder.writeNumber(source.royaltyDen);
    builder.writeCell(source.minters.size > 0 ? beginCell().storeDictDirect(source.minters, Dictionary.Keys.Address(), Dictionary.Values.Uint(32)).endCell() : null);
    builder.writeAddress(source.pendingPayout);
    builder.writeNumber(source.pendingPayoutAt);
    builder.writeString(source.pendingBaseUri);
    builder.writeNumber(source.pendingBaseUriAt);
    builder.writeAddress(source.successor);
    builder.writeNumber(source.minted);
    return builder.build();
}

export function dictValueParserAtharCollection$Data(): DictionaryValue<AtharCollection$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeAtharCollection$Data(src)).endCell());
        },
        parse: (src) => {
            return loadAtharCollection$Data(src.loadRef().beginParse());
        }
    }
}

export type TierState = {
    $$type: 'TierState';
    price: bigint;
    floor: bigint;
    cap: bigint;
    bumpBps: bigint;
    decayBps: bigint;
    lastDecayAt: bigint;
    sold: bigint;
}

export function storeTierState(src: TierState) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeCoins(src.price);
        b_0.storeCoins(src.floor);
        b_0.storeCoins(src.cap);
        b_0.storeUint(src.bumpBps, 16);
        b_0.storeUint(src.decayBps, 16);
        b_0.storeUint(src.lastDecayAt, 32);
        b_0.storeUint(src.sold, 32);
    };
}

export function loadTierState(slice: Slice) {
    const sc_0 = slice;
    const _price = sc_0.loadCoins();
    const _floor = sc_0.loadCoins();
    const _cap = sc_0.loadCoins();
    const _bumpBps = sc_0.loadUintBig(16);
    const _decayBps = sc_0.loadUintBig(16);
    const _lastDecayAt = sc_0.loadUintBig(32);
    const _sold = sc_0.loadUintBig(32);
    return { $$type: 'TierState' as const, price: _price, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps, lastDecayAt: _lastDecayAt, sold: _sold };
}

export function loadTupleTierState(source: TupleReader) {
    const _price = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    const _lastDecayAt = source.readBigNumber();
    const _sold = source.readBigNumber();
    return { $$type: 'TierState' as const, price: _price, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps, lastDecayAt: _lastDecayAt, sold: _sold };
}

export function loadGetterTupleTierState(source: TupleReader) {
    const _price = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    const _lastDecayAt = source.readBigNumber();
    const _sold = source.readBigNumber();
    return { $$type: 'TierState' as const, price: _price, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps, lastDecayAt: _lastDecayAt, sold: _sold };
}

export function storeTupleTierState(source: TierState) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.price);
    builder.writeNumber(source.floor);
    builder.writeNumber(source.cap);
    builder.writeNumber(source.bumpBps);
    builder.writeNumber(source.decayBps);
    builder.writeNumber(source.lastDecayAt);
    builder.writeNumber(source.sold);
    return builder.build();
}

export function dictValueParserTierState(): DictionaryValue<TierState> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTierState(src)).endCell());
        },
        parse: (src) => {
            return loadTierState(src.loadRef().beginParse());
        }
    }
}

export type WalletCount = {
    $$type: 'WalletCount';
    day: bigint;
    count: bigint;
}

export function storeWalletCount(src: WalletCount) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(src.day, 32);
        b_0.storeUint(src.count, 16);
    };
}

export function loadWalletCount(slice: Slice) {
    const sc_0 = slice;
    const _day = sc_0.loadUintBig(32);
    const _count = sc_0.loadUintBig(16);
    return { $$type: 'WalletCount' as const, day: _day, count: _count };
}

export function loadTupleWalletCount(source: TupleReader) {
    const _day = source.readBigNumber();
    const _count = source.readBigNumber();
    return { $$type: 'WalletCount' as const, day: _day, count: _count };
}

export function loadGetterTupleWalletCount(source: TupleReader) {
    const _day = source.readBigNumber();
    const _count = source.readBigNumber();
    return { $$type: 'WalletCount' as const, day: _day, count: _count };
}

export function storeTupleWalletCount(source: WalletCount) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.day);
    builder.writeNumber(source.count);
    return builder.build();
}

export function dictValueParserWalletCount(): DictionaryValue<WalletCount> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeWalletCount(src)).endCell());
        },
        parse: (src) => {
            return loadWalletCount(src.loadRef().beginParse());
        }
    }
}

export type PendingMint = {
    $$type: 'PendingMint';
    buyer: Address;
    amount: bigint;
    auction: boolean;
}

export function storePendingMint(src: PendingMint) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.buyer);
        b_0.storeCoins(src.amount);
        b_0.storeBit(src.auction);
    };
}

export function loadPendingMint(slice: Slice) {
    const sc_0 = slice;
    const _buyer = sc_0.loadAddress();
    const _amount = sc_0.loadCoins();
    const _auction = sc_0.loadBit();
    return { $$type: 'PendingMint' as const, buyer: _buyer, amount: _amount, auction: _auction };
}

export function loadTuplePendingMint(source: TupleReader) {
    const _buyer = source.readAddress();
    const _amount = source.readBigNumber();
    const _auction = source.readBoolean();
    return { $$type: 'PendingMint' as const, buyer: _buyer, amount: _amount, auction: _auction };
}

export function loadGetterTuplePendingMint(source: TupleReader) {
    const _buyer = source.readAddress();
    const _amount = source.readBigNumber();
    const _auction = source.readBoolean();
    return { $$type: 'PendingMint' as const, buyer: _buyer, amount: _amount, auction: _auction };
}

export function storeTuplePendingMint(source: PendingMint) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.buyer);
    builder.writeNumber(source.amount);
    builder.writeBoolean(source.auction);
    return builder.build();
}

export function dictValueParserPendingMint(): DictionaryValue<PendingMint> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storePendingMint(src)).endCell());
        },
        parse: (src) => {
            return loadPendingMint(src.loadRef().beginParse());
        }
    }
}

export type Auction = {
    $$type: 'Auction';
    started: boolean;
    endAt: bigint;
    reserve: bigint;
    highBid: bigint;
    highBidder: Address | null;
}

export function storeAuction(src: Auction) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.started);
        b_0.storeUint(src.endAt, 32);
        b_0.storeCoins(src.reserve);
        b_0.storeCoins(src.highBid);
        b_0.storeAddress(src.highBidder);
    };
}

export function loadAuction(slice: Slice) {
    const sc_0 = slice;
    const _started = sc_0.loadBit();
    const _endAt = sc_0.loadUintBig(32);
    const _reserve = sc_0.loadCoins();
    const _highBid = sc_0.loadCoins();
    const _highBidder = sc_0.loadMaybeAddress();
    return { $$type: 'Auction' as const, started: _started, endAt: _endAt, reserve: _reserve, highBid: _highBid, highBidder: _highBidder };
}

export function loadTupleAuction(source: TupleReader) {
    const _started = source.readBoolean();
    const _endAt = source.readBigNumber();
    const _reserve = source.readBigNumber();
    const _highBid = source.readBigNumber();
    const _highBidder = source.readAddressOpt();
    return { $$type: 'Auction' as const, started: _started, endAt: _endAt, reserve: _reserve, highBid: _highBid, highBidder: _highBidder };
}

export function loadGetterTupleAuction(source: TupleReader) {
    const _started = source.readBoolean();
    const _endAt = source.readBigNumber();
    const _reserve = source.readBigNumber();
    const _highBid = source.readBigNumber();
    const _highBidder = source.readAddressOpt();
    return { $$type: 'Auction' as const, started: _started, endAt: _endAt, reserve: _reserve, highBid: _highBid, highBidder: _highBidder };
}

export function storeTupleAuction(source: Auction) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.started);
    builder.writeNumber(source.endAt);
    builder.writeNumber(source.reserve);
    builder.writeNumber(source.highBid);
    builder.writeAddress(source.highBidder);
    return builder.build();
}

export function dictValueParserAuction(): DictionaryValue<Auction> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeAuction(src)).endCell());
        },
        parse: (src) => {
            return loadAuction(src.loadRef().beginParse());
        }
    }
}

export type Configure = {
    $$type: 'Configure';
    tier: bigint;
    startPrice: bigint;
    floor: bigint;
    cap: bigint;
    bumpBps: bigint;
    decayBps: bigint;
}

export function storeConfigure(src: Configure) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024128, 32);
        b_0.storeUint(src.tier, 8);
        b_0.storeCoins(src.startPrice);
        b_0.storeCoins(src.floor);
        b_0.storeCoins(src.cap);
        b_0.storeUint(src.bumpBps, 16);
        b_0.storeUint(src.decayBps, 16);
    };
}

export function loadConfigure(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024128) { throw Error('Invalid prefix'); }
    const _tier = sc_0.loadUintBig(8);
    const _startPrice = sc_0.loadCoins();
    const _floor = sc_0.loadCoins();
    const _cap = sc_0.loadCoins();
    const _bumpBps = sc_0.loadUintBig(16);
    const _decayBps = sc_0.loadUintBig(16);
    return { $$type: 'Configure' as const, tier: _tier, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps };
}

export function loadTupleConfigure(source: TupleReader) {
    const _tier = source.readBigNumber();
    const _startPrice = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    return { $$type: 'Configure' as const, tier: _tier, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps };
}

export function loadGetterTupleConfigure(source: TupleReader) {
    const _tier = source.readBigNumber();
    const _startPrice = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    return { $$type: 'Configure' as const, tier: _tier, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps };
}

export function storeTupleConfigure(source: Configure) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.tier);
    builder.writeNumber(source.startPrice);
    builder.writeNumber(source.floor);
    builder.writeNumber(source.cap);
    builder.writeNumber(source.bumpBps);
    builder.writeNumber(source.decayBps);
    return builder.build();
}

export function dictValueParserConfigure(): DictionaryValue<Configure> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeConfigure(src)).endCell());
        },
        parse: (src) => {
            return loadConfigure(src.loadRef().beginParse());
        }
    }
}

export type AddSpecial = {
    $$type: 'AddSpecial';
    items: Dictionary<number, number>;
}

export function storeAddSpecial(src: AddSpecial) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024129, 32);
        b_0.storeDict(src.items, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8));
    };
}

export function loadAddSpecial(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024129) { throw Error('Invalid prefix'); }
    const _items = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8), sc_0);
    return { $$type: 'AddSpecial' as const, items: _items };
}

export function loadTupleAddSpecial(source: TupleReader) {
    const _items = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8), source.readCellOpt());
    return { $$type: 'AddSpecial' as const, items: _items };
}

export function loadGetterTupleAddSpecial(source: TupleReader) {
    const _items = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8), source.readCellOpt());
    return { $$type: 'AddSpecial' as const, items: _items };
}

export function storeTupleAddSpecial(source: AddSpecial) {
    const builder = new TupleBuilder();
    builder.writeCell(source.items.size > 0 ? beginCell().storeDictDirect(source.items, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8)).endCell() : null);
    return builder.build();
}

export function dictValueParserAddSpecial(): DictionaryValue<AddSpecial> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeAddSpecial(src)).endCell());
        },
        parse: (src) => {
            return loadAddSpecial(src.loadRef().beginParse());
        }
    }
}

export type Open = {
    $$type: 'Open';
    startAt: bigint;
    walletDailyCap: bigint;
}

export function storeOpen(src: Open) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024130, 32);
        b_0.storeUint(src.startAt, 32);
        b_0.storeUint(src.walletDailyCap, 16);
    };
}

export function loadOpen(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024130) { throw Error('Invalid prefix'); }
    const _startAt = sc_0.loadUintBig(32);
    const _walletDailyCap = sc_0.loadUintBig(16);
    return { $$type: 'Open' as const, startAt: _startAt, walletDailyCap: _walletDailyCap };
}

export function loadTupleOpen(source: TupleReader) {
    const _startAt = source.readBigNumber();
    const _walletDailyCap = source.readBigNumber();
    return { $$type: 'Open' as const, startAt: _startAt, walletDailyCap: _walletDailyCap };
}

export function loadGetterTupleOpen(source: TupleReader) {
    const _startAt = source.readBigNumber();
    const _walletDailyCap = source.readBigNumber();
    return { $$type: 'Open' as const, startAt: _startAt, walletDailyCap: _walletDailyCap };
}

export function storeTupleOpen(source: Open) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.startAt);
    builder.writeNumber(source.walletDailyCap);
    return builder.build();
}

export function dictValueParserOpen(): DictionaryValue<Open> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeOpen(src)).endCell());
        },
        parse: (src) => {
            return loadOpen(src.loadRef().beginParse());
        }
    }
}

export type SetPaused = {
    $$type: 'SetPaused';
    paused: boolean;
}

export function storeSetPaused(src: SetPaused) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024131, 32);
        b_0.storeBit(src.paused);
    };
}

export function loadSetPaused(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024131) { throw Error('Invalid prefix'); }
    const _paused = sc_0.loadBit();
    return { $$type: 'SetPaused' as const, paused: _paused };
}

export function loadTupleSetPaused(source: TupleReader) {
    const _paused = source.readBoolean();
    return { $$type: 'SetPaused' as const, paused: _paused };
}

export function loadGetterTupleSetPaused(source: TupleReader) {
    const _paused = source.readBoolean();
    return { $$type: 'SetPaused' as const, paused: _paused };
}

export function storeTupleSetPaused(source: SetPaused) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.paused);
    return builder.build();
}

export function dictValueParserSetPaused(): DictionaryValue<SetPaused> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetPaused(src)).endCell());
        },
        parse: (src) => {
            return loadSetPaused(src.loadRef().beginParse());
        }
    }
}

export type Buy = {
    $$type: 'Buy';
    index: bigint;
    recipient: Address | null;
}

export function storeBuy(src: Buy) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024132, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeAddress(src.recipient);
    };
}

export function loadBuy(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024132) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _recipient = sc_0.loadMaybeAddress();
    return { $$type: 'Buy' as const, index: _index, recipient: _recipient };
}

export function loadTupleBuy(source: TupleReader) {
    const _index = source.readBigNumber();
    const _recipient = source.readAddressOpt();
    return { $$type: 'Buy' as const, index: _index, recipient: _recipient };
}

export function loadGetterTupleBuy(source: TupleReader) {
    const _index = source.readBigNumber();
    const _recipient = source.readAddressOpt();
    return { $$type: 'Buy' as const, index: _index, recipient: _recipient };
}

export function storeTupleBuy(source: Buy) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeAddress(source.recipient);
    return builder.build();
}

export function dictValueParserBuy(): DictionaryValue<Buy> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBuy(src)).endCell());
        },
        parse: (src) => {
            return loadBuy(src.loadRef().beginParse());
        }
    }
}

export type StartAuction = {
    $$type: 'StartAuction';
    index: bigint;
    reserve: bigint;
    duration: bigint;
}

export function storeStartAuction(src: StartAuction) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024133, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeCoins(src.reserve);
        b_0.storeUint(src.duration, 32);
    };
}

export function loadStartAuction(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024133) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _reserve = sc_0.loadCoins();
    const _duration = sc_0.loadUintBig(32);
    return { $$type: 'StartAuction' as const, index: _index, reserve: _reserve, duration: _duration };
}

export function loadTupleStartAuction(source: TupleReader) {
    const _index = source.readBigNumber();
    const _reserve = source.readBigNumber();
    const _duration = source.readBigNumber();
    return { $$type: 'StartAuction' as const, index: _index, reserve: _reserve, duration: _duration };
}

export function loadGetterTupleStartAuction(source: TupleReader) {
    const _index = source.readBigNumber();
    const _reserve = source.readBigNumber();
    const _duration = source.readBigNumber();
    return { $$type: 'StartAuction' as const, index: _index, reserve: _reserve, duration: _duration };
}

export function storeTupleStartAuction(source: StartAuction) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeNumber(source.reserve);
    builder.writeNumber(source.duration);
    return builder.build();
}

export function dictValueParserStartAuction(): DictionaryValue<StartAuction> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStartAuction(src)).endCell());
        },
        parse: (src) => {
            return loadStartAuction(src.loadRef().beginParse());
        }
    }
}

export type Bid = {
    $$type: 'Bid';
    index: bigint;
}

export function storeBid(src: Bid) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024134, 32);
        b_0.storeUint(src.index, 64);
    };
}

export function loadBid(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024134) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    return { $$type: 'Bid' as const, index: _index };
}

export function loadTupleBid(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'Bid' as const, index: _index };
}

export function loadGetterTupleBid(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'Bid' as const, index: _index };
}

export function storeTupleBid(source: Bid) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    return builder.build();
}

export function dictValueParserBid(): DictionaryValue<Bid> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBid(src)).endCell());
        },
        parse: (src) => {
            return loadBid(src.loadRef().beginParse());
        }
    }
}

export type Settle = {
    $$type: 'Settle';
    index: bigint;
}

export function storeSettle(src: Settle) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024135, 32);
        b_0.storeUint(src.index, 64);
    };
}

export function loadSettle(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024135) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    return { $$type: 'Settle' as const, index: _index };
}

export function loadTupleSettle(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'Settle' as const, index: _index };
}

export function loadGetterTupleSettle(source: TupleReader) {
    const _index = source.readBigNumber();
    return { $$type: 'Settle' as const, index: _index };
}

export function storeTupleSettle(source: Settle) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    return builder.build();
}

export function dictValueParserSettle(): DictionaryValue<Settle> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSettle(src)).endCell());
        },
        parse: (src) => {
            return loadSettle(src.loadRef().beginParse());
        }
    }
}

export type Sweep = {
    $$type: 'Sweep';
}

export function storeSweep(src: Sweep) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024136, 32);
    };
}

export function loadSweep(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024136) { throw Error('Invalid prefix'); }
    return { $$type: 'Sweep' as const };
}

export function loadTupleSweep(source: TupleReader) {
    return { $$type: 'Sweep' as const };
}

export function loadGetterTupleSweep(source: TupleReader) {
    return { $$type: 'Sweep' as const };
}

export function storeTupleSweep(source: Sweep) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserSweep(): DictionaryValue<Sweep> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSweep(src)).endCell());
        },
        parse: (src) => {
            return loadSweep(src.loadRef().beginParse());
        }
    }
}

export type AtharMinter$Data = {
    $$type: 'AtharMinter$Data';
    collection: Address;
    admin: Address;
    seasonId: bigint;
    rangeStart: bigint;
    rangeEnd: bigint;
    tiers: Dictionary<number, TierState>;
    special: Dictionary<number, number>;
    sold: Dictionary<number, boolean>;
    pending: Dictionary<number, PendingMint>;
    auctions: Dictionary<number, Auction>;
    wallets: Dictionary<Address, WalletCount>;
    status: bigint;
    startAt: bigint;
    walletDailyCap: bigint;
    soldCount: bigint;
}

export function storeAtharMinter$Data(src: AtharMinter$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.collection);
        b_0.storeAddress(src.admin);
        b_0.storeUint(src.seasonId, 16);
        b_0.storeUint(src.rangeStart, 64);
        b_0.storeUint(src.rangeEnd, 64);
        b_0.storeDict(src.tiers, Dictionary.Keys.Uint(8), dictValueParserTierState());
        b_0.storeDict(src.special, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8));
        const b_1 = new Builder();
        b_1.storeDict(src.sold, Dictionary.Keys.Uint(16), Dictionary.Values.Bool());
        b_1.storeDict(src.pending, Dictionary.Keys.Uint(16), dictValueParserPendingMint());
        b_1.storeDict(src.auctions, Dictionary.Keys.Uint(16), dictValueParserAuction());
        b_1.storeDict(src.wallets, Dictionary.Keys.Address(), dictValueParserWalletCount());
        b_1.storeUint(src.status, 8);
        b_1.storeUint(src.startAt, 32);
        b_1.storeUint(src.walletDailyCap, 16);
        b_1.storeUint(src.soldCount, 32);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadAtharMinter$Data(slice: Slice) {
    const sc_0 = slice;
    const _collection = sc_0.loadAddress();
    const _admin = sc_0.loadAddress();
    const _seasonId = sc_0.loadUintBig(16);
    const _rangeStart = sc_0.loadUintBig(64);
    const _rangeEnd = sc_0.loadUintBig(64);
    const _tiers = Dictionary.load(Dictionary.Keys.Uint(8), dictValueParserTierState(), sc_0);
    const _special = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8), sc_0);
    const sc_1 = sc_0.loadRef().beginParse();
    const _sold = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Bool(), sc_1);
    const _pending = Dictionary.load(Dictionary.Keys.Uint(16), dictValueParserPendingMint(), sc_1);
    const _auctions = Dictionary.load(Dictionary.Keys.Uint(16), dictValueParserAuction(), sc_1);
    const _wallets = Dictionary.load(Dictionary.Keys.Address(), dictValueParserWalletCount(), sc_1);
    const _status = sc_1.loadUintBig(8);
    const _startAt = sc_1.loadUintBig(32);
    const _walletDailyCap = sc_1.loadUintBig(16);
    const _soldCount = sc_1.loadUintBig(32);
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, auctions: _auctions, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount };
}

export function loadTupleAtharMinter$Data(source: TupleReader) {
    const _collection = source.readAddress();
    const _admin = source.readAddress();
    const _seasonId = source.readBigNumber();
    const _rangeStart = source.readBigNumber();
    const _rangeEnd = source.readBigNumber();
    const _tiers = Dictionary.loadDirect(Dictionary.Keys.Uint(8), dictValueParserTierState(), source.readCellOpt());
    const _special = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8), source.readCellOpt());
    const _sold = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Bool(), source.readCellOpt());
    const _pending = Dictionary.loadDirect(Dictionary.Keys.Uint(16), dictValueParserPendingMint(), source.readCellOpt());
    const _auctions = Dictionary.loadDirect(Dictionary.Keys.Uint(16), dictValueParserAuction(), source.readCellOpt());
    const _wallets = Dictionary.loadDirect(Dictionary.Keys.Address(), dictValueParserWalletCount(), source.readCellOpt());
    const _status = source.readBigNumber();
    const _startAt = source.readBigNumber();
    const _walletDailyCap = source.readBigNumber();
    const _soldCount = source.readBigNumber();
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, auctions: _auctions, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount };
}

export function loadGetterTupleAtharMinter$Data(source: TupleReader) {
    const _collection = source.readAddress();
    const _admin = source.readAddress();
    const _seasonId = source.readBigNumber();
    const _rangeStart = source.readBigNumber();
    const _rangeEnd = source.readBigNumber();
    const _tiers = Dictionary.loadDirect(Dictionary.Keys.Uint(8), dictValueParserTierState(), source.readCellOpt());
    const _special = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8), source.readCellOpt());
    const _sold = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Bool(), source.readCellOpt());
    const _pending = Dictionary.loadDirect(Dictionary.Keys.Uint(16), dictValueParserPendingMint(), source.readCellOpt());
    const _auctions = Dictionary.loadDirect(Dictionary.Keys.Uint(16), dictValueParserAuction(), source.readCellOpt());
    const _wallets = Dictionary.loadDirect(Dictionary.Keys.Address(), dictValueParserWalletCount(), source.readCellOpt());
    const _status = source.readBigNumber();
    const _startAt = source.readBigNumber();
    const _walletDailyCap = source.readBigNumber();
    const _soldCount = source.readBigNumber();
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, auctions: _auctions, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount };
}

export function storeTupleAtharMinter$Data(source: AtharMinter$Data) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.collection);
    builder.writeAddress(source.admin);
    builder.writeNumber(source.seasonId);
    builder.writeNumber(source.rangeStart);
    builder.writeNumber(source.rangeEnd);
    builder.writeCell(source.tiers.size > 0 ? beginCell().storeDictDirect(source.tiers, Dictionary.Keys.Uint(8), dictValueParserTierState()).endCell() : null);
    builder.writeCell(source.special.size > 0 ? beginCell().storeDictDirect(source.special, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8)).endCell() : null);
    builder.writeCell(source.sold.size > 0 ? beginCell().storeDictDirect(source.sold, Dictionary.Keys.Uint(16), Dictionary.Values.Bool()).endCell() : null);
    builder.writeCell(source.pending.size > 0 ? beginCell().storeDictDirect(source.pending, Dictionary.Keys.Uint(16), dictValueParserPendingMint()).endCell() : null);
    builder.writeCell(source.auctions.size > 0 ? beginCell().storeDictDirect(source.auctions, Dictionary.Keys.Uint(16), dictValueParserAuction()).endCell() : null);
    builder.writeCell(source.wallets.size > 0 ? beginCell().storeDictDirect(source.wallets, Dictionary.Keys.Address(), dictValueParserWalletCount()).endCell() : null);
    builder.writeNumber(source.status);
    builder.writeNumber(source.startAt);
    builder.writeNumber(source.walletDailyCap);
    builder.writeNumber(source.soldCount);
    return builder.build();
}

export function dictValueParserAtharMinter$Data(): DictionaryValue<AtharMinter$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeAtharMinter$Data(src)).endCell());
        },
        parse: (src) => {
            return loadAtharMinter$Data(src.loadRef().beginParse());
        }
    }
}

 type AtharCollection_init_args = {
    $$type: 'AtharCollection_init_args';
    admin: Address;
    collectionUri: string;
    delaySec: bigint;
}

function initAtharCollection_init_args(src: AtharCollection_init_args) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.admin);
        b_0.storeStringRefTail(src.collectionUri);
        b_0.storeInt(src.delaySec, 257);
    };
}

async function AtharCollection_init(admin: Address, collectionUri: string, delaySec: bigint) {
    const __code = Cell.fromHex('b5ee9c724102550100173000025aff008e88f4a413f4bcf2c80bed53208e983001d072d721d200d200fa4021103450666f04f86102f862e1ed43d90120020271020d020120030601fbb8b5ded44d0d200018e50fa40d401d001d31fd401d0d401d001d72c01916d93fa4001e201d30fd30ff404d72c01916d93fa4001e201d31fd2000193d401d0916de201d31fd72c01916d93fa4001e201d31f3010be10bd10bc6c1e8e20fa40d401d001810101d700552003d1588b086d8101f48127106d6d706d216d21e2804010c551ddb3c6ce105001631c87101cb072ccf16ccc9020120070a01fbb5dafda89a1a400031ca1f481a803a003a63fa803a1a803a003ae580322db27f48003c403a61fa61fe809ae580322db27f48003c403a63fa4000327a803a122dbc403a63fae580322db27f48003c403a63e60217c217a2178d83d1c41f481a803a003020203ae00aa4007a2b11610db0203e9024e20dadae0da42da43c50080108db3c6ce309002053d96eb3973029206ef2d080de54699001fbb4f47da89a1a400031ca1f481a803a003a63fa803a1a803a003ae580322db27f48003c403a61fa61fe809ae580322db27f48003c403a63fa4000327a803a122dbc403a63fae580322db27f48003c403a63e60217c217a2178d83d1c41f481a803a003020203ae00aa4007a2b11610db0203e9024e20dadae0da42da43c500b010c550ddb3c6ce10c0104db3c390201200e190201200f16020120101301fbb36bbb513434800063943e903500740074c7f500743500740075cb00645b64fe9000788074c3f4c3fd0135cb00645b64fe9000788074c7f4800064f50074245b788074c7f5cb00645b64fe9000788074c7cc042f842f442f1b07a3883e903500740060404075c0154800f45622c21b60407d2049c41b5b5c1b485b4878a0110108db3c6ce11200022901fbb016fb513434800063943e903500740074c7f500743500740075cb00645b64fe9000788074c3f4c3fd0135cb00645b64fe9000788074c7f4800064f50074245b788074c7f5cb00645b64fe9000788074c7cc042f842f442f1b07a3883e903500740060404075c0154800f45622c21b60407d2049c41b5b5c1b485b4878a0140108db3c6ce3150018c87101cb072dcf16c95461f101fbb593dda89a1a400031ca1f481a803a003a63fa803a1a803a003ae580322db27f48003c403a61fa61fe809ae580322db27f48003c403a63fa4000327a803a122dbc403a63fae580322db27f48003c403a63e60217c217a2178d83d1c41f481a803a003020203ae00aa4007a2b11610db0203e9024e20dadae0da42da43c5017010c550ddb3c6ce118002c81010b280280204133f40a6fa19401d70130925b6de20201201a1d01fbb79cfda89a1a400031ca1f481a803a003a63fa803a1a803a003ae580322db27f48003c403a61fa61fe809ae580322db27f48003c403a63fa4000327a803a122dbc403a63fae580322db27f48003c403a63e60217c217a2178d83d1c41f481a803a003020203ae00aa4007a2b11610db0203e9024e20dadae0da42da43c501b0108db3c6ce11c00022101fbb6cfbda89a1a400031ca1f481a803a003a63fa803a1a803a003ae580322db27f48003c403a61fa61fe809ae580322db27f48003c403a63fa4000327a803a122dbc403a63fae580322db27f48003c403a63e60217c217a2178d83d1c41f481a803a003020203ae00aa4007a2b11610db0203e9024e20dadae0da42da43c501e0108db3c6ce11f00022002feed44d0d200018e50fa40d401d001d31fd401d0d401d001d72c01916d93fa4001e201d30fd30ff404d72c01916d93fa4001e201d31fd2000193d401d0916de201d31fd72c01916d93fa4001e201d31f3010be10bd10bc6c1e8e20fa40d401d001810101d700552003d1588b086d8101f48127106d6d706d216d21e20fe30270212301380d8020d7217021d749c21f9430d31f01de821041540012bae3025f0f2202e4d33f013110cd10bc10ab109a108910781067105610451034413e2edb3c708040701112c80182104154001558cb1fcb3fc9103441300111120110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00550c395304ce2ed74920c21f95310ed31f0fde21821041540022bae30221821041540023ba8eb35b383c81557df8422cc705f2f48200cf3a236eb3f2f48137a5f82323bef2f410ac109b108a107910281057104610356d445503e021821041540024bae30221821041540025ba2453262801fc5b0dfa403081557df8422ec705f2f4286e8e683810bd551ac87f01ca0055d050dece0bc8ce1bcd19cb1fc808c8ce18cd5006206e9430cf84809201cee214cb0f12cb0ff40001206e9430cf84809201cee2cb1f226eb39702c8cec958f40095327058ca00e212cb1f58206e9430cf84809201cee212cb1fcdc9ed54e033332500f6f82329a010bd10ac109b108a107910681057104645444313c87f01ca0055d050dece0bc8ce1bcd19cb1fc808c8ce18cd5006206e9430cf84809201cee214cb0f12cb0ff40001206e9430cf84809201cee2cb1f226eb39702c8cec958f40095327058ca00e212cb1f58206e9430cf84809201cee212cb1fcdc9ed5401fe5b0dd430d081557df8422ec705f2f429d7498e683910bd551ac87f01ca0055d050dece0bc8ce1bcd19cb1fc808c8ce18cd5006206e9430cf84809201cee214cb0f12cb0ff40001206e9430cf84809201cee2cb1f226eb39702c8cec958f40095327058ca00e212cb1f58206e9430cf84809201cee212cb1fcdc9ed54e16c212700d6f82329a010bd551ac87f01ca0055d050dece0bc8ce1bcd19cb1fc808c8ce18cd5006206e9430cf84809201cee214cb0f12cb0ff40001206e9430cf84809201cee2cb1f226eb39702c8cec958f40095327058ca00e212cb1f58206e9430cf84809201cee212cb1fcdc9ed5404ae8eb85b393c81557df8422cc705f2f48200cf3a216eb3f2f48137a5f8232dbef2f4206ef2d08010ac109b108a09106810571046103544306d5023e021821041540020bae30221821041540021bae30221821041540002ba53292a2b018e5b0dfa403081557df8422ec705f2f48117902e6ef2f481010bf8232ca01037128020216e955b59f4593098c801cf014133f441e210bd10ac109b108a10791068105706103544035301785b0dfa403081557df8422ec705f2f41581010b016d8020216e955b59f4593098c801cf014133f441e210bd10ac109b108a10791068105706103544035303fee30221821041540003ba8eeb5b3d10bd551adb3cc87f01ca0055d050dece0bc8ce1bcd19cb1fc808c8ce18cd5006206e9430cf84809201cee214cb0f12cb0ff40001206e9430cf84809201cee2cb1f226eb39702c8cec958f40095327058ca00e212cb1f58206e9430cf84809201cee212cb1fcdc9ed54e0218210415400272c323103fe5b0dd33ffa40d30fd307fa0030f8416f24303281565456146ef2f42b81010b2280204133f40a6fa19401d70130925b6de28200ec42216eb39af82302206ef2d08012be923170e2f2f48179332782008eacbbf2f4816f112f6eb3f2f48200df8223821007bfa480a05230bef2f4f82827db3c1116a424c200e30082089896803a2d2f01885610206ef2d08073708828552010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb002e001c0000000061746861722073616c6501fe73700bc80182104154000558cb1fcb3fc9104541301b10246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00205615705920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400c87401cb0212ca07cbffc9d051233001e4a18208989680a18209312d00a1717ff823104910384760c855408210415400015006cb1f14ce12cb0fcb0701fa02cb1fc916104510344033111410465522c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0010bd551a5303f4ba8eeb5b3d10bd551adb3cc87f01ca0055d050dece0bc8ce1bcd19cb1fc808c8ce18cd5006206e9430cf84809201cee214cb0f12cb0ff40001206e9430cf84809201cee2cb1f226eb39702c8cec958f40095327058ca00e212cb1f58206e9430cf84809201cee212cb1fcdc9ed54e021821041540026bae3022132343501a6816f112a6eb3f2f4820afaf08070fb0229206ef2d08070810082708810246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0033001200000000617468617200fe5b0dfa403081557df8422ec705f2f48200da070e6e1ef2f410bd551ac87f01ca0055d050dece0bc8ce1bcd19cb1fc808c8ce18cd5006206e9430cf84809201cee214cb0f12cb0ff40001206e9430cf84809201cee2cb1f226eb39702c8cec958f40095327058ca00e212cb1f58206e9430cf84809201cee212cb1fcdc9ed540344821041540011bae30221821041540013bae3023fc0000ec1211eb0e3025f0ef2c08236385402fc5b0dd33ffa40d30fd307fa00d31fd31ff40430812426f8420d11150d0c11140c0b11130b0a11120a0911110908111008107f106e051115050411140403111303021112020111160111175611db3c01111801c70501111601f2f48200d11856156eb3f2f45614206ef2d08004111004103f102e11141d701114804011147f393701de1114c855708210415400125009cb1f17cb3f15ce13cb0fcb0701fa02cb1fcb1ff400c904111004103f4ed010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00103d4c1a080644b450090705035302fc5b0dd33f308129152e6eb39af8422f206ef2d080c7059170e2f2f410ce10bd10ac109b108a10791068105710461035443012db3c708040706f00c8013082104154001401cb1fc910246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0039530164f82801db3c705920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400c87401cb0212ca07cbffc9d03a011e88c87001ca005a02ce810101cf00c93b022cff008e88f4a413f4bcf2c80bed53208e8130e1ed43d93c420202713d3f0191bf786f6a268690000c711fd20699feb9600c8b6c9fd2000f100e987e983fd00698fe98fe98ffa0269002ad0360dc70a7d20408080eb802c816880b6b82a3800298036b8716d9e365c43e001054776554776553760191bc7e7f6a268690000c711fd20699feb9600c8b6c9fd2000f100e987e983fd00698fe98fe98ffa0269002ad0360dc70a7d20408080eb802c816880b6b82a3800298036b8716d9e365ac4002c0286eb353b0973029206ef2d080dec86f00016f8c6d6f8c2c8e22c821c10098802d01cb0701a301de019a7aa90ca630541220c000e63068a592cb07e4da11c9d0db3c8b52e6a736f6e8db3c6f2201c993216eb396016f2259ccc9e8312c544e30414100b620d74a21d7499720c20022c200b18e48036f22807f22cf31ab02a105ab025155b60820c2009a20aa0215d71803ce4014de596f025341a1c20099c8016f025044a1aa028e123133c20099d430d020d74a21d749927020e2e2e85f0304f001d072d721d200d200fa4021103450666f04f86102f862ed44d0d200018e23fa40d33fd72c01916d93fa4001e201d30fd307fa00d31fd31fd31ff404d20055a06c1b8e14fa40810101d7005902d1016d7054700053006d70e20ce3020ad70d1ff2e08221821041540001bae3022182105fcc3d14bae302214344454900aa3b098020d7217021d749c21f9430d31f309131e2821041540011ba8e351079551670c87f01ca0055a050abce18cb3f5006206e9430cf84809201cee214cb0f12cb0701fa02cb1fcb1fcb1ff400ca00c9ed54e05f0a00ba6c71fa40d30fd307fa00d31f308200aa5af84229c705f2f481393d066e16f2f424107910681047103655227102c87f01ca0055a050abce18cb3f5006206e9430cf84809201cee214cb0f12cb0701fa02cb1fcb1fcb1ff400ca00c9ed5403fe316c12d33ffa40d72c01916d93fa4001e201f40431fa00f8416f2481318b2f6eb3f2f48200c0802f206ef2d0805240c705f2f48139195613b3f2f443305230fa40fa0071d721fa00fa00306c6170f83a20aa00820afaf080a024c2009424a001a09131e2018200df8202bef2f40a206ef2d08023f82307a423c200e30f206e46474800aa717054485fc85520821005138d915004cb1f12cb3fcecec9104610364d6010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb000006353b5b01beb38e54206ef2d0807080427005c8018210d53276db58cb1fcb3fc9103441301510246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00923031e2108a55175103fe82102fcb26a2ba8ee331d33f30f8427080407f5434cdc8552082108b7717355004cb1f12cb3f810101cf00cec91034413010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00108a5517e021821041540004bae3023020821041540010514a4c01ec31d430d0f8416f2430328200c0802a6eb39a2a206ef2d0805220c7059170e2f2f48139192eb3f2f48200df8202821008f0d180be12f2f401814f0821d749c2009621d7498307bb9170e29521d74ac0009170e2f2f4c822cf16f82301cb1f21d74901cb0801cf161bf400c9821005f5e10071706f00c84b02fe013082104154000301cb1fc92d553010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb007080427022c8018210d53276db58cb1fcb3fc9104e10246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf818ae24e4f03febae30220821041540015ba8ef2303a8200aa5af84229c705f2f470266eb38e5026206ef2d0807080427022c8018210d53276db58cb1fcb3fc910246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00de108a1079106810571046103544304d515002fe30f8416f2410235f038200c080286eb39a28206ef2d0805220c7059170e2f2f481386c0cb31cf2f47f7080402a7f543fa9547a975613c855708210415400115009cb1f17cb3f15ce13cb0fcb0701fa02cb1fcb1ff400c92c0450ff10246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf818ae24e4f001a58cf8680cf8480f400f400cf810074f400c901fb00108a5517c87f01ca0055a050abce18cb3f5006206e9430cf84809201cee214cb0f12cb0701fa02cb1fcb1fcb1ff400ca00c9ed5402fae0821041540014ba8ef08200aa5af8422ac705f2f4815a9d2bf2f406206ef2d080708100a07022c8018210d53276db58cb1fcb3fc910246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00107910686d081057104610354430e05f0b51520060c87f01ca0055a050abce18cb3f5006206e9430cf84809201cee214cb0f12cb0701fa02cb1fcb1fcb1ff400ca00c9ed540006f2c08200c6c87f01ca0055d050dece0bc8ce1bcd19cb1fc808c8ce18cd5006206e9430cf84809201cee214cb0f12cb0ff40001206e9430cf84809201cee2cb1f226eb39702c8cec958f40095327058ca00e212cb1f58206e9430cf84809201cee212cb1fcdc9ed5400ce10bd551ac87f01ca0055d050dece0bc8ce1bcd19cb1fc808c8ce18cd5006206e9430cf84809201cee214cb0f12cb0ff40001206e9430cf84809201cee2cb1f226eb39702c8cec958f40095327058ca00e212cb1f58206e9430cf84809201cee212cb1fcdc9ed5448278025');
    const builder = beginCell();
    builder.storeUint(0, 1);
    initAtharCollection_init_args({ $$type: 'AtharCollection_init_args', admin, collectionUri, delaySec })(builder);
    const __data = builder.endCell();
    return { code: __code, data: __data };
}

export const AtharCollection_errors = {
    2: { message: "Stack underflow" },
    3: { message: "Stack overflow" },
    4: { message: "Integer overflow" },
    5: { message: "Integer out of expected range" },
    6: { message: "Invalid opcode" },
    7: { message: "Type check error" },
    8: { message: "Cell overflow" },
    9: { message: "Cell underflow" },
    10: { message: "Dictionary error" },
    11: { message: "'Unknown' error" },
    12: { message: "Fatal error" },
    13: { message: "Out of gas error" },
    14: { message: "Virtualization error" },
    32: { message: "Action list is invalid" },
    33: { message: "Action list is too long" },
    34: { message: "Action is invalid or not supported" },
    35: { message: "Invalid source address in outbound message" },
    36: { message: "Invalid destination address in outbound message" },
    37: { message: "Not enough Toncoin" },
    38: { message: "Not enough extra currencies" },
    39: { message: "Outbound message does not fit into a cell after rewriting" },
    40: { message: "Cannot process a message" },
    41: { message: "Library reference is null" },
    42: { message: "Library change action error" },
    43: { message: "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree" },
    50: { message: "Account state size exceeded limits" },
    128: { message: "Null reference exception" },
    129: { message: "Invalid serialization prefix" },
    130: { message: "Invalid incoming message" },
    131: { message: "Constraints error" },
    132: { message: "Access denied" },
    133: { message: "Contract stopped" },
    134: { message: "Invalid argument" },
    135: { message: "Code of a contract was not found" },
    136: { message: "Invalid standard address" },
    138: { message: "Not a basechain address" },
    1609: { message: "this date is sold by auction" },
    1714: { message: "tier is priced by curve: common or rare" },
    5268: { message: "auction not finished" },
    6032: { message: "closed" },
    9254: { message: "only a real item" },
    10060: { message: "daily limit reached for this wallet" },
    10517: { message: "only the next edition" },
    12683: { message: "not minted" },
    13448: { message: "auction already exists" },
    14245: { message: "notice period not over" },
    14254: { message: "bad auction" },
    14444: { message: "upgrade already in progress" },
    14617: { message: "upgrade in progress" },
    14653: { message: "already minted" },
    15521: { message: "no live auction" },
    20232: { message: "text must be 1..32 bytes" },
    21885: { message: "only admin" },
    22100: { message: "minting closed" },
    23197: { message: "no upgrade pending" },
    23975: { message: "date already taken" },
    24098: { message: "only mythic dates" },
    24241: { message: "not open yet" },
    28276: { message: "sale is not open" },
    28433: { message: "payout not set" },
    30788: { message: "bad special" },
    30889: { message: "bad price bounds" },
    31027: { message: "date out of range" },
    40897: { message: "already settled" },
    43610: { message: "only collection" },
    44990: { message: "bid too low" },
    46897: { message: "already open" },
    47192: { message: "date not in this season" },
    48010: { message: "send price + fees" },
    49280: { message: "not owner" },
    50563: { message: "bad rates" },
    51269: { message: "mythic dates are sold by auction" },
    53050: { message: "nothing proposed" },
    53528: { message: "no next edition yet" },
    55815: { message: "already set" },
    56586: { message: "configure common and rare first" },
    57218: { message: "not enough value" },
    60482: { message: "minter not authorised" },
} as const

export const AtharCollection_errors_backward = {
    "Stack underflow": 2,
    "Stack overflow": 3,
    "Integer overflow": 4,
    "Integer out of expected range": 5,
    "Invalid opcode": 6,
    "Type check error": 7,
    "Cell overflow": 8,
    "Cell underflow": 9,
    "Dictionary error": 10,
    "'Unknown' error": 11,
    "Fatal error": 12,
    "Out of gas error": 13,
    "Virtualization error": 14,
    "Action list is invalid": 32,
    "Action list is too long": 33,
    "Action is invalid or not supported": 34,
    "Invalid source address in outbound message": 35,
    "Invalid destination address in outbound message": 36,
    "Not enough Toncoin": 37,
    "Not enough extra currencies": 38,
    "Outbound message does not fit into a cell after rewriting": 39,
    "Cannot process a message": 40,
    "Library reference is null": 41,
    "Library change action error": 42,
    "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree": 43,
    "Account state size exceeded limits": 50,
    "Null reference exception": 128,
    "Invalid serialization prefix": 129,
    "Invalid incoming message": 130,
    "Constraints error": 131,
    "Access denied": 132,
    "Contract stopped": 133,
    "Invalid argument": 134,
    "Code of a contract was not found": 135,
    "Invalid standard address": 136,
    "Not a basechain address": 138,
    "this date is sold by auction": 1609,
    "tier is priced by curve: common or rare": 1714,
    "auction not finished": 5268,
    "closed": 6032,
    "only a real item": 9254,
    "daily limit reached for this wallet": 10060,
    "only the next edition": 10517,
    "not minted": 12683,
    "auction already exists": 13448,
    "notice period not over": 14245,
    "bad auction": 14254,
    "upgrade already in progress": 14444,
    "upgrade in progress": 14617,
    "already minted": 14653,
    "no live auction": 15521,
    "text must be 1..32 bytes": 20232,
    "only admin": 21885,
    "minting closed": 22100,
    "no upgrade pending": 23197,
    "date already taken": 23975,
    "only mythic dates": 24098,
    "not open yet": 24241,
    "sale is not open": 28276,
    "payout not set": 28433,
    "bad special": 30788,
    "bad price bounds": 30889,
    "date out of range": 31027,
    "already settled": 40897,
    "only collection": 43610,
    "bid too low": 44990,
    "already open": 46897,
    "date not in this season": 47192,
    "send price + fees": 48010,
    "not owner": 49280,
    "bad rates": 50563,
    "mythic dates are sold by auction": 51269,
    "nothing proposed": 53050,
    "no next edition yet": 53528,
    "already set": 55815,
    "configure common and rare first": 56586,
    "not enough value": 57218,
    "minter not authorised": 60482,
} as const

const AtharCollection_types: ABIType[] = [
    {"name":"DataSize","header":null,"fields":[{"name":"cells","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bits","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"refs","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"SignedBundle","header":null,"fields":[{"name":"signature","type":{"kind":"simple","type":"fixed-bytes","optional":false,"format":64}},{"name":"signedData","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"StateInit","header":null,"fields":[{"name":"code","type":{"kind":"simple","type":"cell","optional":false}},{"name":"data","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"Context","header":null,"fields":[{"name":"bounceable","type":{"kind":"simple","type":"bool","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"raw","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"SendParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"code","type":{"kind":"simple","type":"cell","optional":true}},{"name":"data","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"MessageParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"DeployParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}},{"name":"init","type":{"kind":"simple","type":"StateInit","optional":false}}]},
    {"name":"StdAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":8}},{"name":"address","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"VarAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":32}},{"name":"address","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"BasechainAddress","header":null,"fields":[{"name":"hash","type":{"kind":"simple","type":"int","optional":true,"format":257}}]},
    {"name":"Transfer","header":1607220500,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}},{"name":"responseDestination","type":{"kind":"simple","type":"address","optional":true}},{"name":"customPayload","type":{"kind":"simple","type":"cell","optional":true}},{"name":"forwardAmount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"OwnershipAssigned","header":85167505,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"prevOwner","type":{"kind":"simple","type":"address","optional":false}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"Excesses","header":3576854235,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"GetStaticData","header":801842850,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"ReportStaticData","header":2339837749,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"collection","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"NftData","header":null,"fields":[{"name":"isInitialized","type":{"kind":"simple","type":"bool","optional":false}},{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"collectionAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"ownerAddress","type":{"kind":"simple","type":"address","optional":false}},{"name":"individualContent","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"CollectionData","header":null,"fields":[{"name":"nextItemIndex","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"collectionContent","type":{"kind":"simple","type":"cell","optional":false}},{"name":"ownerAddress","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"RoyaltyParams","header":null,"fields":[{"name":"numerator","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"denominator","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"destination","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"ItemInit","header":1096024065,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
    {"name":"MintItem","header":1096024066,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"Proceeds","header":1096024067,"fields":[]},
    {"name":"MintOk","header":1096024069,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Engrave","header":1096024068,"fields":[{"name":"text","type":{"kind":"simple","type":"string","optional":false}}]},
    {"name":"UpgradeStart","header":1096024080,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"UpgradeRequest","header":1096024081,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"hands","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}}]},
    {"name":"UpgradeAccept","header":1096024082,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"hands","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}}]},
    {"name":"UpgradeDone","header":1096024083,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"BurnConfirm","header":1096024084,"fields":[]},
    {"name":"UpgradeAbort","header":1096024085,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"ProposeMinter","header":1096024096,"fields":[{"name":"minter","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"RemoveMinter","header":1096024097,"fields":[{"name":"minter","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"ProposePayout","header":1096024098,"fields":[{"name":"payout","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"ApplyPayout","header":1096024099,"fields":[]},
    {"name":"ProposeBaseUri","header":1096024100,"fields":[{"name":"uri","type":{"kind":"simple","type":"string","optional":false}}]},
    {"name":"ApplyBaseUri","header":1096024101,"fields":[]},
    {"name":"SetSuccessor","header":1096024102,"fields":[{"name":"successor","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"Withdraw","header":1096024103,"fields":[]},
    {"name":"Ymd","header":null,"fields":[{"name":"y","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"m","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"d","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"AtharItem$Data","header":null,"fields":[{"name":"collection","type":{"kind":"simple","type":"address","optional":false}},{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"owner","type":{"kind":"simple","type":"address","optional":true}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"lastTransferAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"hands","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}},{"name":"locked","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"AtharState","header":null,"fields":[{"name":"season","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"tier","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"paid","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"mintedAt","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"lastTransferAt","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hands","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}},{"name":"locked","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"AtharCollection$Data","header":null,"fields":[{"name":"admin","type":{"kind":"simple","type":"address","optional":false}},{"name":"collectionUri","type":{"kind":"simple","type":"string","optional":false}},{"name":"delaySec","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"baseUri","type":{"kind":"simple","type":"string","optional":false}},{"name":"payout","type":{"kind":"simple","type":"address","optional":true}},{"name":"royaltyNum","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"royaltyDen","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"minters","type":{"kind":"dict","key":"address","value":"uint","valueFormat":32}},{"name":"pendingPayout","type":{"kind":"simple","type":"address","optional":true}},{"name":"pendingPayoutAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"pendingBaseUri","type":{"kind":"simple","type":"string","optional":true}},{"name":"pendingBaseUriAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"successor","type":{"kind":"simple","type":"address","optional":true}},{"name":"minted","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
    {"name":"TierState","header":null,"fields":[{"name":"price","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"lastDecayAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"sold","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
    {"name":"WalletCount","header":null,"fields":[{"name":"day","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"count","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"PendingMint","header":null,"fields":[{"name":"buyer","type":{"kind":"simple","type":"address","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"auction","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"Auction","header":null,"fields":[{"name":"started","type":{"kind":"simple","type":"bool","optional":false}},{"name":"endAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"reserve","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"highBid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"highBidder","type":{"kind":"simple","type":"address","optional":true}}]},
    {"name":"Configure","header":1096024128,"fields":[{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"startPrice","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"AddSpecial","header":1096024129,"fields":[{"name":"items","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":8}}]},
    {"name":"Open","header":1096024130,"fields":[{"name":"startAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"walletDailyCap","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"SetPaused","header":1096024131,"fields":[{"name":"paused","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"Buy","header":1096024132,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"recipient","type":{"kind":"simple","type":"address","optional":true}}]},
    {"name":"StartAuction","header":1096024133,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"reserve","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"duration","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
    {"name":"Bid","header":1096024134,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Settle","header":1096024135,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Sweep","header":1096024136,"fields":[]},
    {"name":"AtharMinter$Data","header":null,"fields":[{"name":"collection","type":{"kind":"simple","type":"address","optional":false}},{"name":"admin","type":{"kind":"simple","type":"address","optional":false}},{"name":"seasonId","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"rangeStart","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"rangeEnd","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"tiers","type":{"kind":"dict","key":"uint","keyFormat":8,"value":"TierState","valueFormat":"ref"}},{"name":"special","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":8}},{"name":"sold","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"bool"}},{"name":"pending","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"PendingMint","valueFormat":"ref"}},{"name":"auctions","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"Auction","valueFormat":"ref"}},{"name":"wallets","type":{"kind":"dict","key":"address","value":"WalletCount","valueFormat":"ref"}},{"name":"status","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"startAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"walletDailyCap","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"soldCount","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
]

const AtharCollection_opcodes = {
    "Transfer": 1607220500,
    "OwnershipAssigned": 85167505,
    "Excesses": 3576854235,
    "GetStaticData": 801842850,
    "ReportStaticData": 2339837749,
    "ItemInit": 1096024065,
    "MintItem": 1096024066,
    "Proceeds": 1096024067,
    "MintOk": 1096024069,
    "Engrave": 1096024068,
    "UpgradeStart": 1096024080,
    "UpgradeRequest": 1096024081,
    "UpgradeAccept": 1096024082,
    "UpgradeDone": 1096024083,
    "BurnConfirm": 1096024084,
    "UpgradeAbort": 1096024085,
    "ProposeMinter": 1096024096,
    "RemoveMinter": 1096024097,
    "ProposePayout": 1096024098,
    "ApplyPayout": 1096024099,
    "ProposeBaseUri": 1096024100,
    "ApplyBaseUri": 1096024101,
    "SetSuccessor": 1096024102,
    "Withdraw": 1096024103,
    "Configure": 1096024128,
    "AddSpecial": 1096024129,
    "Open": 1096024130,
    "SetPaused": 1096024131,
    "Buy": 1096024132,
    "StartAuction": 1096024133,
    "Bid": 1096024134,
    "Settle": 1096024135,
    "Sweep": 1096024136,
}

const AtharCollection_getters: ABIGetter[] = [
    {"name":"get_collection_data","methodId":102491,"arguments":[],"returnType":{"kind":"simple","type":"CollectionData","optional":false}},
    {"name":"get_nft_address_by_index","methodId":92067,"arguments":[{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"address","optional":false}},
    {"name":"get_nft_content","methodId":68445,"arguments":[{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"individualContent","type":{"kind":"simple","type":"cell","optional":false}}],"returnType":{"kind":"simple","type":"cell","optional":false}},
    {"name":"royalty_params","methodId":85719,"arguments":[],"returnType":{"kind":"simple","type":"RoyaltyParams","optional":false}},
    {"name":"payout_address","methodId":101806,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":true}},
    {"name":"successor_address","methodId":122087,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":true}},
    {"name":"minter_active_at","methodId":109726,"arguments":[{"name":"minter","type":{"kind":"simple","type":"address","optional":false}}],"returnType":{"kind":"simple","type":"int","optional":true,"format":257}},
    {"name":"total_minted","methodId":128637,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
]

export const AtharCollection_getterMapping: { [key: string]: string } = {
    'get_collection_data': 'getGetCollectionData',
    'get_nft_address_by_index': 'getGetNftAddressByIndex',
    'get_nft_content': 'getGetNftContent',
    'royalty_params': 'getRoyaltyParams',
    'payout_address': 'getPayoutAddress',
    'successor_address': 'getSuccessorAddress',
    'minter_active_at': 'getMinterActiveAt',
    'total_minted': 'getTotalMinted',
}

const AtharCollection_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"empty"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ProposePayout"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ApplyPayout"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ProposeBaseUri"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ApplyBaseUri"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ProposeMinter"}},
    {"receiver":"internal","message":{"kind":"typed","type":"RemoveMinter"}},
    {"receiver":"internal","message":{"kind":"typed","type":"MintItem"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Proceeds"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Withdraw"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetSuccessor"}},
    {"receiver":"internal","message":{"kind":"typed","type":"UpgradeRequest"}},
    {"receiver":"internal","message":{"kind":"typed","type":"UpgradeDone"}},
]

export const MAX_INDEX = 36524n;
export const TIER_COMMON = 0n;
export const TIER_RARE = 1n;
export const TIER_MYTHIC = 2n;
export const ITEM_FUND = 80000000n;
export const MINTER_GAS = 20000000n;
export const OK_VALUE = 10000000n;
export const COLL_GAS = 20000000n;
export const MINT_FEES = 130000000n;
export const BUY_FEES = 150000000n;
export const ENGRAVE_FEE = 100000000n;
export const MIN_STORAGE = 50000000n;
export const DAY = 86400n;

export class AtharCollection implements Contract {
    
    public static readonly storageReserve = 0n;
    public static readonly errors = AtharCollection_errors_backward;
    public static readonly opcodes = AtharCollection_opcodes;
    
    static async init(admin: Address, collectionUri: string, delaySec: bigint) {
        return await AtharCollection_init(admin, collectionUri, delaySec);
    }
    
    static async fromInit(admin: Address, collectionUri: string, delaySec: bigint) {
        const __gen_init = await AtharCollection_init(admin, collectionUri, delaySec);
        const address = contractAddress(0, __gen_init);
        return new AtharCollection(address, __gen_init);
    }
    
    static fromAddress(address: Address) {
        return new AtharCollection(address);
    }
    
    readonly address: Address; 
    readonly init?: { code: Cell, data: Cell };
    readonly abi: ContractABI = {
        types:  AtharCollection_types,
        getters: AtharCollection_getters,
        receivers: AtharCollection_receivers,
        errors: AtharCollection_errors,
    };
    
    constructor(address: Address, init?: { code: Cell, data: Cell }) {
        this.address = address;
        this.init = init;
    }
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: null | ProposePayout | ApplyPayout | ProposeBaseUri | ApplyBaseUri | ProposeMinter | RemoveMinter | MintItem | Proceeds | Withdraw | SetSuccessor | UpgradeRequest | UpgradeDone) {
        
        let body: Cell | null = null;
        if (message === null) {
            body = new Cell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ProposePayout') {
            body = beginCell().store(storeProposePayout(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ApplyPayout') {
            body = beginCell().store(storeApplyPayout(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ProposeBaseUri') {
            body = beginCell().store(storeProposeBaseUri(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ApplyBaseUri') {
            body = beginCell().store(storeApplyBaseUri(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ProposeMinter') {
            body = beginCell().store(storeProposeMinter(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'RemoveMinter') {
            body = beginCell().store(storeRemoveMinter(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'MintItem') {
            body = beginCell().store(storeMintItem(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Proceeds') {
            body = beginCell().store(storeProceeds(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Withdraw') {
            body = beginCell().store(storeWithdraw(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetSuccessor') {
            body = beginCell().store(storeSetSuccessor(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'UpgradeRequest') {
            body = beginCell().store(storeUpgradeRequest(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'UpgradeDone') {
            body = beginCell().store(storeUpgradeDone(message)).endCell();
        }
        if (body === null) { throw new Error('Invalid message type'); }
        
        await provider.internal(via, { ...args, body: body });
        
    }
    
    async getGetCollectionData(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('get_collection_data', builder.build())).stack;
        const result = loadGetterTupleCollectionData(source);
        return result;
    }
    
    async getGetNftAddressByIndex(provider: ContractProvider, index: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(index);
        const source = (await provider.get('get_nft_address_by_index', builder.build())).stack;
        const result = source.readAddress();
        return result;
    }
    
    async getGetNftContent(provider: ContractProvider, index: bigint, individualContent: Cell) {
        const builder = new TupleBuilder();
        builder.writeNumber(index);
        builder.writeCell(individualContent);
        const source = (await provider.get('get_nft_content', builder.build())).stack;
        const result = source.readCell();
        return result;
    }
    
    async getRoyaltyParams(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('royalty_params', builder.build())).stack;
        const result = loadGetterTupleRoyaltyParams(source);
        return result;
    }
    
    async getPayoutAddress(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('payout_address', builder.build())).stack;
        const result = source.readAddressOpt();
        return result;
    }
    
    async getSuccessorAddress(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('successor_address', builder.build())).stack;
        const result = source.readAddressOpt();
        return result;
    }
    
    async getMinterActiveAt(provider: ContractProvider, minter: Address) {
        const builder = new TupleBuilder();
        builder.writeAddress(minter);
        const source = (await provider.get('minter_active_at', builder.build())).stack;
        const result = source.readBigNumberOpt();
        return result;
    }
    
    async getTotalMinted(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('total_minted', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
}