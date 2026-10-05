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
    occasion: bigint;
    mediaRef: bigint;
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
        b_0.storeUint(src.occasion, 8);
        b_0.storeUint(src.mediaRef, 256);
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
    const _occasion = sc_0.loadUintBig(8);
    const _mediaRef = sc_0.loadUintBig(256);
    return { $$type: 'ItemInit' as const, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, occasion: _occasion, mediaRef: _mediaRef };
}

export function loadTupleItemInit(source: TupleReader) {
    const _owner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'ItemInit' as const, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, occasion: _occasion, mediaRef: _mediaRef };
}

export function loadGetterTupleItemInit(source: TupleReader) {
    const _owner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _mintedAt = source.readBigNumber();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'ItemInit' as const, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, occasion: _occasion, mediaRef: _mediaRef };
}

export function storeTupleItemInit(source: ItemInit) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.owner);
    builder.writeNumber(source.season);
    builder.writeNumber(source.tier);
    builder.writeNumber(source.paid);
    builder.writeNumber(source.mintedAt);
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
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
    occasion: bigint;
    mediaRef: bigint;
    remit: bigint;
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
        b_0.storeUint(src.occasion, 8);
        b_0.storeUint(src.mediaRef, 256);
        b_0.storeCoins(src.remit);
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
    const _occasion = sc_0.loadUintBig(8);
    const _mediaRef = sc_0.loadUintBig(256);
    const _remit = sc_0.loadCoins();
    return { $$type: 'MintItem' as const, index: _index, newOwner: _newOwner, season: _season, tier: _tier, paid: _paid, occasion: _occasion, mediaRef: _mediaRef, remit: _remit };
}

export function loadTupleMintItem(source: TupleReader) {
    const _index = source.readBigNumber();
    const _newOwner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _remit = source.readBigNumber();
    return { $$type: 'MintItem' as const, index: _index, newOwner: _newOwner, season: _season, tier: _tier, paid: _paid, occasion: _occasion, mediaRef: _mediaRef, remit: _remit };
}

export function loadGetterTupleMintItem(source: TupleReader) {
    const _index = source.readBigNumber();
    const _newOwner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _remit = source.readBigNumber();
    return { $$type: 'MintItem' as const, index: _index, newOwner: _newOwner, season: _season, tier: _tier, paid: _paid, occasion: _occasion, mediaRef: _mediaRef, remit: _remit };
}

export function storeTupleMintItem(source: MintItem) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeAddress(source.newOwner);
    builder.writeNumber(source.season);
    builder.writeNumber(source.tier);
    builder.writeNumber(source.paid);
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    builder.writeNumber(source.remit);
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
    occasion: bigint;
    mediaRef: bigint;
    mediaLog: Cell | null;
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
        b_0.storeUint(src.occasion, 8);
        b_0.storeUint(src.mediaRef, 256);
        if (src.mediaLog !== null && src.mediaLog !== undefined) { b_0.storeBit(true).storeRef(src.mediaLog); } else { b_0.storeBit(false); }
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
    const _occasion = sc_0.loadUintBig(8);
    const _mediaRef = sc_0.loadUintBig(256);
    const _mediaLog = sc_0.loadBit() ? sc_0.loadRef() : null;
    return { $$type: 'UpgradeRequest' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog };
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
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _mediaLog = source.readCellOpt();
    return { $$type: 'UpgradeRequest' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog };
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
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _mediaLog = source.readCellOpt();
    return { $$type: 'UpgradeRequest' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog };
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
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    builder.writeCell(source.mediaLog);
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
    occasion: bigint;
    mediaRef: bigint;
    mediaLog: Cell | null;
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
        b_0.storeUint(src.occasion, 8);
        b_0.storeUint(src.mediaRef, 256);
        if (src.mediaLog !== null && src.mediaLog !== undefined) { b_0.storeBit(true).storeRef(src.mediaLog); } else { b_0.storeBit(false); }
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
    const _occasion = sc_0.loadUintBig(8);
    const _mediaRef = sc_0.loadUintBig(256);
    const _mediaLog = sc_0.loadBit() ? sc_0.loadRef() : null;
    return { $$type: 'UpgradeAccept' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog };
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
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _mediaLog = source.readCellOpt();
    return { $$type: 'UpgradeAccept' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog };
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
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _mediaLog = source.readCellOpt();
    return { $$type: 'UpgradeAccept' as const, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, hands: _hands, engravings: _engravings, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog };
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
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    builder.writeCell(source.mediaLog);
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

export type ProposeCode = {
    $$type: 'ProposeCode';
    code: Cell;
}

export function storeProposeCode(src: ProposeCode) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024104, 32);
        b_0.storeRef(src.code);
    };
}

export function loadProposeCode(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024104) { throw Error('Invalid prefix'); }
    const _code = sc_0.loadRef();
    return { $$type: 'ProposeCode' as const, code: _code };
}

export function loadTupleProposeCode(source: TupleReader) {
    const _code = source.readCell();
    return { $$type: 'ProposeCode' as const, code: _code };
}

export function loadGetterTupleProposeCode(source: TupleReader) {
    const _code = source.readCell();
    return { $$type: 'ProposeCode' as const, code: _code };
}

export function storeTupleProposeCode(source: ProposeCode) {
    const builder = new TupleBuilder();
    builder.writeCell(source.code);
    return builder.build();
}

export function dictValueParserProposeCode(): DictionaryValue<ProposeCode> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeProposeCode(src)).endCell());
        },
        parse: (src) => {
            return loadProposeCode(src.loadRef().beginParse());
        }
    }
}

export type ApplyCode = {
    $$type: 'ApplyCode';
}

export function storeApplyCode(src: ApplyCode) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024105, 32);
    };
}

export function loadApplyCode(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024105) { throw Error('Invalid prefix'); }
    return { $$type: 'ApplyCode' as const };
}

export function loadTupleApplyCode(source: TupleReader) {
    return { $$type: 'ApplyCode' as const };
}

export function loadGetterTupleApplyCode(source: TupleReader) {
    return { $$type: 'ApplyCode' as const };
}

export function storeTupleApplyCode(source: ApplyCode) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserApplyCode(): DictionaryValue<ApplyCode> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeApplyCode(src)).endCell());
        },
        parse: (src) => {
            return loadApplyCode(src.loadRef().beginParse());
        }
    }
}

export type CancelCode = {
    $$type: 'CancelCode';
}

export function storeCancelCode(src: CancelCode) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024106, 32);
    };
}

export function loadCancelCode(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024106) { throw Error('Invalid prefix'); }
    return { $$type: 'CancelCode' as const };
}

export function loadTupleCancelCode(source: TupleReader) {
    return { $$type: 'CancelCode' as const };
}

export function loadGetterTupleCancelCode(source: TupleReader) {
    return { $$type: 'CancelCode' as const };
}

export function storeTupleCancelCode(source: CancelCode) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserCancelCode(): DictionaryValue<CancelCode> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeCancelCode(src)).endCell());
        },
        parse: (src) => {
            return loadCancelCode(src.loadRef().beginParse());
        }
    }
}

export type EngraveReq = {
    $$type: 'EngraveReq';
    index: bigint;
    text: string;
}

export function storeEngraveReq(src: EngraveReq) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024176, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeStringRefTail(src.text);
    };
}

export function loadEngraveReq(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024176) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _text = sc_0.loadStringRefTail();
    return { $$type: 'EngraveReq' as const, index: _index, text: _text };
}

export function loadTupleEngraveReq(source: TupleReader) {
    const _index = source.readBigNumber();
    const _text = source.readString();
    return { $$type: 'EngraveReq' as const, index: _index, text: _text };
}

export function loadGetterTupleEngraveReq(source: TupleReader) {
    const _index = source.readBigNumber();
    const _text = source.readString();
    return { $$type: 'EngraveReq' as const, index: _index, text: _text };
}

export function storeTupleEngraveReq(source: EngraveReq) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeString(source.text);
    return builder.build();
}

export function dictValueParserEngraveReq(): DictionaryValue<EngraveReq> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeEngraveReq(src)).endCell());
        },
        parse: (src) => {
            return loadEngraveReq(src.loadRef().beginParse());
        }
    }
}

export type EngraveFrom = {
    $$type: 'EngraveFrom';
    owner: Address;
    text: string;
    fee: bigint;
}

export function storeEngraveFrom(src: EngraveFrom) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024177, 32);
        b_0.storeAddress(src.owner);
        b_0.storeStringRefTail(src.text);
        b_0.storeCoins(src.fee);
    };
}

export function loadEngraveFrom(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024177) { throw Error('Invalid prefix'); }
    const _owner = sc_0.loadAddress();
    const _text = sc_0.loadStringRefTail();
    const _fee = sc_0.loadCoins();
    return { $$type: 'EngraveFrom' as const, owner: _owner, text: _text, fee: _fee };
}

export function loadTupleEngraveFrom(source: TupleReader) {
    const _owner = source.readAddress();
    const _text = source.readString();
    const _fee = source.readBigNumber();
    return { $$type: 'EngraveFrom' as const, owner: _owner, text: _text, fee: _fee };
}

export function loadGetterTupleEngraveFrom(source: TupleReader) {
    const _owner = source.readAddress();
    const _text = source.readString();
    const _fee = source.readBigNumber();
    return { $$type: 'EngraveFrom' as const, owner: _owner, text: _text, fee: _fee };
}

export function storeTupleEngraveFrom(source: EngraveFrom) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.owner);
    builder.writeString(source.text);
    builder.writeNumber(source.fee);
    return builder.build();
}

export function dictValueParserEngraveFrom(): DictionaryValue<EngraveFrom> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeEngraveFrom(src)).endCell());
        },
        parse: (src) => {
            return loadEngraveFrom(src.loadRef().beginParse());
        }
    }
}

export type SetMediaReq = {
    $$type: 'SetMediaReq';
    index: bigint;
    occasion: bigint;
    mediaRef: bigint;
}

export function storeSetMediaReq(src: SetMediaReq) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024178, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeUint(src.occasion, 8);
        b_0.storeUint(src.mediaRef, 256);
    };
}

export function loadSetMediaReq(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024178) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _occasion = sc_0.loadUintBig(8);
    const _mediaRef = sc_0.loadUintBig(256);
    return { $$type: 'SetMediaReq' as const, index: _index, occasion: _occasion, mediaRef: _mediaRef };
}

export function loadTupleSetMediaReq(source: TupleReader) {
    const _index = source.readBigNumber();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'SetMediaReq' as const, index: _index, occasion: _occasion, mediaRef: _mediaRef };
}

export function loadGetterTupleSetMediaReq(source: TupleReader) {
    const _index = source.readBigNumber();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'SetMediaReq' as const, index: _index, occasion: _occasion, mediaRef: _mediaRef };
}

export function storeTupleSetMediaReq(source: SetMediaReq) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    return builder.build();
}

export function dictValueParserSetMediaReq(): DictionaryValue<SetMediaReq> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetMediaReq(src)).endCell());
        },
        parse: (src) => {
            return loadSetMediaReq(src.loadRef().beginParse());
        }
    }
}

export type SetMediaFrom = {
    $$type: 'SetMediaFrom';
    owner: Address;
    occasion: bigint;
    mediaRef: bigint;
    firstFee: bigint;
    changeFee: bigint;
}

export function storeSetMediaFrom(src: SetMediaFrom) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024179, 32);
        b_0.storeAddress(src.owner);
        b_0.storeUint(src.occasion, 8);
        b_0.storeUint(src.mediaRef, 256);
        b_0.storeCoins(src.firstFee);
        b_0.storeCoins(src.changeFee);
    };
}

export function loadSetMediaFrom(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024179) { throw Error('Invalid prefix'); }
    const _owner = sc_0.loadAddress();
    const _occasion = sc_0.loadUintBig(8);
    const _mediaRef = sc_0.loadUintBig(256);
    const _firstFee = sc_0.loadCoins();
    const _changeFee = sc_0.loadCoins();
    return { $$type: 'SetMediaFrom' as const, owner: _owner, occasion: _occasion, mediaRef: _mediaRef, firstFee: _firstFee, changeFee: _changeFee };
}

export function loadTupleSetMediaFrom(source: TupleReader) {
    const _owner = source.readAddress();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _firstFee = source.readBigNumber();
    const _changeFee = source.readBigNumber();
    return { $$type: 'SetMediaFrom' as const, owner: _owner, occasion: _occasion, mediaRef: _mediaRef, firstFee: _firstFee, changeFee: _changeFee };
}

export function loadGetterTupleSetMediaFrom(source: TupleReader) {
    const _owner = source.readAddress();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _firstFee = source.readBigNumber();
    const _changeFee = source.readBigNumber();
    return { $$type: 'SetMediaFrom' as const, owner: _owner, occasion: _occasion, mediaRef: _mediaRef, firstFee: _firstFee, changeFee: _changeFee };
}

export function storeTupleSetMediaFrom(source: SetMediaFrom) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.owner);
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    builder.writeNumber(source.firstFee);
    builder.writeNumber(source.changeFee);
    return builder.build();
}

export function dictValueParserSetMediaFrom(): DictionaryValue<SetMediaFrom> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetMediaFrom(src)).endCell());
        },
        parse: (src) => {
            return loadSetMediaFrom(src.loadRef().beginParse());
        }
    }
}

export type SetItemFees = {
    $$type: 'SetItemFees';
    engraveFee: bigint;
    mediaFee: bigint;
    changeFee: bigint;
}

export function storeSetItemFees(src: SetItemFees) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024180, 32);
        b_0.storeCoins(src.engraveFee);
        b_0.storeCoins(src.mediaFee);
        b_0.storeCoins(src.changeFee);
    };
}

export function loadSetItemFees(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024180) { throw Error('Invalid prefix'); }
    const _engraveFee = sc_0.loadCoins();
    const _mediaFee = sc_0.loadCoins();
    const _changeFee = sc_0.loadCoins();
    return { $$type: 'SetItemFees' as const, engraveFee: _engraveFee, mediaFee: _mediaFee, changeFee: _changeFee };
}

export function loadTupleSetItemFees(source: TupleReader) {
    const _engraveFee = source.readBigNumber();
    const _mediaFee = source.readBigNumber();
    const _changeFee = source.readBigNumber();
    return { $$type: 'SetItemFees' as const, engraveFee: _engraveFee, mediaFee: _mediaFee, changeFee: _changeFee };
}

export function loadGetterTupleSetItemFees(source: TupleReader) {
    const _engraveFee = source.readBigNumber();
    const _mediaFee = source.readBigNumber();
    const _changeFee = source.readBigNumber();
    return { $$type: 'SetItemFees' as const, engraveFee: _engraveFee, mediaFee: _mediaFee, changeFee: _changeFee };
}

export function storeTupleSetItemFees(source: SetItemFees) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.engraveFee);
    builder.writeNumber(source.mediaFee);
    builder.writeNumber(source.changeFee);
    return builder.build();
}

export function dictValueParserSetItemFees(): DictionaryValue<SetItemFees> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetItemFees(src)).endCell());
        },
        parse: (src) => {
            return loadSetItemFees(src.loadRef().beginParse());
        }
    }
}

export type ItemFees = {
    $$type: 'ItemFees';
    engrave: bigint;
    media: bigint;
    change: bigint;
}

export function storeItemFees(src: ItemFees) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.engrave, 257);
        b_0.storeInt(src.media, 257);
        b_0.storeInt(src.change, 257);
    };
}

export function loadItemFees(slice: Slice) {
    const sc_0 = slice;
    const _engrave = sc_0.loadIntBig(257);
    const _media = sc_0.loadIntBig(257);
    const _change = sc_0.loadIntBig(257);
    return { $$type: 'ItemFees' as const, engrave: _engrave, media: _media, change: _change };
}

export function loadTupleItemFees(source: TupleReader) {
    const _engrave = source.readBigNumber();
    const _media = source.readBigNumber();
    const _change = source.readBigNumber();
    return { $$type: 'ItemFees' as const, engrave: _engrave, media: _media, change: _change };
}

export function loadGetterTupleItemFees(source: TupleReader) {
    const _engrave = source.readBigNumber();
    const _media = source.readBigNumber();
    const _change = source.readBigNumber();
    return { $$type: 'ItemFees' as const, engrave: _engrave, media: _media, change: _change };
}

export function storeTupleItemFees(source: ItemFees) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.engrave);
    builder.writeNumber(source.media);
    builder.writeNumber(source.change);
    return builder.build();
}

export function dictValueParserItemFees(): DictionaryValue<ItemFees> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeItemFees(src)).endCell());
        },
        parse: (src) => {
            return loadItemFees(src.loadRef().beginParse());
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
    occasion: bigint;
    mediaRef: bigint;
    mediaLog: Cell | null;
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
        b_0.storeUint(src.occasion, 8);
        const b_1 = new Builder();
        b_1.storeUint(src.mediaRef, 256);
        if (src.mediaLog !== null && src.mediaLog !== undefined) { b_1.storeBit(true).storeRef(src.mediaLog); } else { b_1.storeBit(false); }
        b_1.storeBit(src.locked);
        b_0.storeRef(b_1.endCell());
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
    const _occasion = sc_0.loadUintBig(8);
    const sc_1 = sc_0.loadRef().beginParse();
    const _mediaRef = sc_1.loadUintBig(256);
    const _mediaLog = sc_1.loadBit() ? sc_1.loadRef() : null;
    const _locked = sc_1.loadBit();
    return { $$type: 'AtharItem$Data' as const, collection: _collection, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog, locked: _locked };
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
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _mediaLog = source.readCellOpt();
    const _locked = source.readBoolean();
    return { $$type: 'AtharItem$Data' as const, collection: _collection, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog, locked: _locked };
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
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _mediaLog = source.readCellOpt();
    const _locked = source.readBoolean();
    return { $$type: 'AtharItem$Data' as const, collection: _collection, index: _index, owner: _owner, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog, locked: _locked };
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
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    builder.writeCell(source.mediaLog);
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
    occasion: bigint;
    mediaRef: bigint;
    mediaLog: Cell | null;
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
        const b_2 = new Builder();
        b_2.storeInt(src.occasion, 257);
        b_2.storeInt(src.mediaRef, 257);
        if (src.mediaLog !== null && src.mediaLog !== undefined) { b_2.storeBit(true).storeRef(src.mediaLog); } else { b_2.storeBit(false); }
        b_1.storeRef(b_2.endCell());
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
    const sc_2 = sc_1.loadRef().beginParse();
    const _occasion = sc_2.loadIntBig(257);
    const _mediaRef = sc_2.loadIntBig(257);
    const _mediaLog = sc_2.loadBit() ? sc_2.loadRef() : null;
    return { $$type: 'AtharState' as const, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, locked: _locked, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog };
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
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _mediaLog = source.readCellOpt();
    return { $$type: 'AtharState' as const, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, locked: _locked, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog };
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
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _mediaLog = source.readCellOpt();
    return { $$type: 'AtharState' as const, season: _season, tier: _tier, paid: _paid, mintedAt: _mintedAt, lastTransferAt: _lastTransferAt, hands: _hands, engravings: _engravings, locked: _locked, occasion: _occasion, mediaRef: _mediaRef, mediaLog: _mediaLog };
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
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    builder.writeCell(source.mediaLog);
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

export type CodeProposal = {
    $$type: 'CodeProposal';
    pending: boolean;
    applicableAt: bigint;
}

export function storeCodeProposal(src: CodeProposal) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.pending);
        b_0.storeInt(src.applicableAt, 257);
    };
}

export function loadCodeProposal(slice: Slice) {
    const sc_0 = slice;
    const _pending = sc_0.loadBit();
    const _applicableAt = sc_0.loadIntBig(257);
    return { $$type: 'CodeProposal' as const, pending: _pending, applicableAt: _applicableAt };
}

export function loadTupleCodeProposal(source: TupleReader) {
    const _pending = source.readBoolean();
    const _applicableAt = source.readBigNumber();
    return { $$type: 'CodeProposal' as const, pending: _pending, applicableAt: _applicableAt };
}

export function loadGetterTupleCodeProposal(source: TupleReader) {
    const _pending = source.readBoolean();
    const _applicableAt = source.readBigNumber();
    return { $$type: 'CodeProposal' as const, pending: _pending, applicableAt: _applicableAt };
}

export function storeTupleCodeProposal(source: CodeProposal) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.pending);
    builder.writeNumber(source.applicableAt);
    return builder.build();
}

export function dictValueParserCodeProposal(): DictionaryValue<CodeProposal> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeCodeProposal(src)).endCell());
        },
        parse: (src) => {
            return loadCodeProposal(src.loadRef().beginParse());
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
    firstMinterDone: boolean;
    engraveFee: bigint;
    mediaFee: bigint;
    changeFee: bigint;
    issued: Dictionary<number, boolean>;
    pendingCode: Cell | null;
    pendingCodeAt: bigint;
    ext: Cell | null;
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
        b_1.storeBit(src.firstMinterDone);
        b_1.storeCoins(src.engraveFee);
        b_1.storeCoins(src.mediaFee);
        b_1.storeCoins(src.changeFee);
        b_1.storeDict(src.issued, Dictionary.Keys.Uint(32), Dictionary.Values.Bool());
        const b_2 = new Builder();
        if (src.pendingCode !== null && src.pendingCode !== undefined) { b_2.storeBit(true).storeRef(src.pendingCode); } else { b_2.storeBit(false); }
        b_2.storeUint(src.pendingCodeAt, 32);
        if (src.ext !== null && src.ext !== undefined) { b_2.storeBit(true).storeRef(src.ext); } else { b_2.storeBit(false); }
        b_1.storeRef(b_2.endCell());
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
    const _firstMinterDone = sc_1.loadBit();
    const _engraveFee = sc_1.loadCoins();
    const _mediaFee = sc_1.loadCoins();
    const _changeFee = sc_1.loadCoins();
    const _issued = Dictionary.load(Dictionary.Keys.Uint(32), Dictionary.Values.Bool(), sc_1);
    const sc_2 = sc_1.loadRef().beginParse();
    const _pendingCode = sc_2.loadBit() ? sc_2.loadRef() : null;
    const _pendingCodeAt = sc_2.loadUintBig(32);
    const _ext = sc_2.loadBit() ? sc_2.loadRef() : null;
    return { $$type: 'AtharCollection$Data' as const, admin: _admin, collectionUri: _collectionUri, delaySec: _delaySec, baseUri: _baseUri, payout: _payout, royaltyNum: _royaltyNum, royaltyDen: _royaltyDen, minters: _minters, pendingPayout: _pendingPayout, pendingPayoutAt: _pendingPayoutAt, pendingBaseUri: _pendingBaseUri, pendingBaseUriAt: _pendingBaseUriAt, successor: _successor, minted: _minted, firstMinterDone: _firstMinterDone, engraveFee: _engraveFee, mediaFee: _mediaFee, changeFee: _changeFee, issued: _issued, pendingCode: _pendingCode, pendingCodeAt: _pendingCodeAt, ext: _ext };
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
    source = source.readTuple();
    const _firstMinterDone = source.readBoolean();
    const _engraveFee = source.readBigNumber();
    const _mediaFee = source.readBigNumber();
    const _changeFee = source.readBigNumber();
    const _issued = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Bool(), source.readCellOpt());
    const _pendingCode = source.readCellOpt();
    const _pendingCodeAt = source.readBigNumber();
    const _ext = source.readCellOpt();
    return { $$type: 'AtharCollection$Data' as const, admin: _admin, collectionUri: _collectionUri, delaySec: _delaySec, baseUri: _baseUri, payout: _payout, royaltyNum: _royaltyNum, royaltyDen: _royaltyDen, minters: _minters, pendingPayout: _pendingPayout, pendingPayoutAt: _pendingPayoutAt, pendingBaseUri: _pendingBaseUri, pendingBaseUriAt: _pendingBaseUriAt, successor: _successor, minted: _minted, firstMinterDone: _firstMinterDone, engraveFee: _engraveFee, mediaFee: _mediaFee, changeFee: _changeFee, issued: _issued, pendingCode: _pendingCode, pendingCodeAt: _pendingCodeAt, ext: _ext };
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
    const _firstMinterDone = source.readBoolean();
    const _engraveFee = source.readBigNumber();
    const _mediaFee = source.readBigNumber();
    const _changeFee = source.readBigNumber();
    const _issued = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Bool(), source.readCellOpt());
    const _pendingCode = source.readCellOpt();
    const _pendingCodeAt = source.readBigNumber();
    const _ext = source.readCellOpt();
    return { $$type: 'AtharCollection$Data' as const, admin: _admin, collectionUri: _collectionUri, delaySec: _delaySec, baseUri: _baseUri, payout: _payout, royaltyNum: _royaltyNum, royaltyDen: _royaltyDen, minters: _minters, pendingPayout: _pendingPayout, pendingPayoutAt: _pendingPayoutAt, pendingBaseUri: _pendingBaseUri, pendingBaseUriAt: _pendingBaseUriAt, successor: _successor, minted: _minted, firstMinterDone: _firstMinterDone, engraveFee: _engraveFee, mediaFee: _mediaFee, changeFee: _changeFee, issued: _issued, pendingCode: _pendingCode, pendingCodeAt: _pendingCodeAt, ext: _ext };
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
    builder.writeBoolean(source.firstMinterDone);
    builder.writeNumber(source.engraveFee);
    builder.writeNumber(source.mediaFee);
    builder.writeNumber(source.changeFee);
    builder.writeCell(source.issued.size > 0 ? beginCell().storeDictDirect(source.issued, Dictionary.Keys.Uint(32), Dictionary.Values.Bool()).endCell() : null);
    builder.writeCell(source.pendingCode);
    builder.writeNumber(source.pendingCodeAt);
    builder.writeCell(source.ext);
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
    k0: bigint;
    k1: bigint;
    k2: bigint;
}

export function storeWalletCount(src: WalletCount) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(src.day, 32);
        b_0.storeUint(src.count, 16);
        b_0.storeUint(src.k0, 16);
        b_0.storeUint(src.k1, 16);
        b_0.storeUint(src.k2, 16);
    };
}

export function loadWalletCount(slice: Slice) {
    const sc_0 = slice;
    const _day = sc_0.loadUintBig(32);
    const _count = sc_0.loadUintBig(16);
    const _k0 = sc_0.loadUintBig(16);
    const _k1 = sc_0.loadUintBig(16);
    const _k2 = sc_0.loadUintBig(16);
    return { $$type: 'WalletCount' as const, day: _day, count: _count, k0: _k0, k1: _k1, k2: _k2 };
}

export function loadTupleWalletCount(source: TupleReader) {
    const _day = source.readBigNumber();
    const _count = source.readBigNumber();
    const _k0 = source.readBigNumber();
    const _k1 = source.readBigNumber();
    const _k2 = source.readBigNumber();
    return { $$type: 'WalletCount' as const, day: _day, count: _count, k0: _k0, k1: _k1, k2: _k2 };
}

export function loadGetterTupleWalletCount(source: TupleReader) {
    const _day = source.readBigNumber();
    const _count = source.readBigNumber();
    const _k0 = source.readBigNumber();
    const _k1 = source.readBigNumber();
    const _k2 = source.readBigNumber();
    return { $$type: 'WalletCount' as const, day: _day, count: _count, k0: _k0, k1: _k1, k2: _k2 };
}

export function storeTupleWalletCount(source: WalletCount) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.day);
    builder.writeNumber(source.count);
    builder.writeNumber(source.k0);
    builder.writeNumber(source.k1);
    builder.writeNumber(source.k2);
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
    kind: bigint;
    ticket: bigint;
}

export function storePendingMint(src: PendingMint) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.buyer);
        b_0.storeCoins(src.amount);
        b_0.storeUint(src.kind, 8);
        b_0.storeUint(src.ticket, 16);
    };
}

export function loadPendingMint(slice: Slice) {
    const sc_0 = slice;
    const _buyer = sc_0.loadAddress();
    const _amount = sc_0.loadCoins();
    const _kind = sc_0.loadUintBig(8);
    const _ticket = sc_0.loadUintBig(16);
    return { $$type: 'PendingMint' as const, buyer: _buyer, amount: _amount, kind: _kind, ticket: _ticket };
}

export function loadTuplePendingMint(source: TupleReader) {
    const _buyer = source.readAddress();
    const _amount = source.readBigNumber();
    const _kind = source.readBigNumber();
    const _ticket = source.readBigNumber();
    return { $$type: 'PendingMint' as const, buyer: _buyer, amount: _amount, kind: _kind, ticket: _ticket };
}

export function loadGetterTuplePendingMint(source: TupleReader) {
    const _buyer = source.readAddress();
    const _amount = source.readBigNumber();
    const _kind = source.readBigNumber();
    const _ticket = source.readBigNumber();
    return { $$type: 'PendingMint' as const, buyer: _buyer, amount: _amount, kind: _kind, ticket: _ticket };
}

export function storeTuplePendingMint(source: PendingMint) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.buyer);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.kind);
    builder.writeNumber(source.ticket);
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

export type Ticket = {
    $$type: 'Ticket';
    owner: Address;
    price: bigint;
    claimed: boolean;
}

export function storeTicket(src: Ticket) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.owner);
        b_0.storeCoins(src.price);
        b_0.storeBit(src.claimed);
    };
}

export function loadTicket(slice: Slice) {
    const sc_0 = slice;
    const _owner = sc_0.loadAddress();
    const _price = sc_0.loadCoins();
    const _claimed = sc_0.loadBit();
    return { $$type: 'Ticket' as const, owner: _owner, price: _price, claimed: _claimed };
}

export function loadTupleTicket(source: TupleReader) {
    const _owner = source.readAddress();
    const _price = source.readBigNumber();
    const _claimed = source.readBoolean();
    return { $$type: 'Ticket' as const, owner: _owner, price: _price, claimed: _claimed };
}

export function loadGetterTupleTicket(source: TupleReader) {
    const _owner = source.readAddress();
    const _price = source.readBigNumber();
    const _claimed = source.readBoolean();
    return { $$type: 'Ticket' as const, owner: _owner, price: _price, claimed: _claimed };
}

export function storeTupleTicket(source: Ticket) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.owner);
    builder.writeNumber(source.price);
    builder.writeBoolean(source.claimed);
    return builder.build();
}

export function dictValueParserTicket(): DictionaryValue<Ticket> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTicket(src)).endCell());
        },
        parse: (src) => {
            return loadTicket(src.loadRef().beginParse());
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
    mediaRef: bigint;
}

export function storeAuction(src: Auction) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.started);
        b_0.storeUint(src.endAt, 32);
        b_0.storeCoins(src.reserve);
        b_0.storeCoins(src.highBid);
        b_0.storeAddress(src.highBidder);
        b_0.storeUint(src.mediaRef, 256);
    };
}

export function loadAuction(slice: Slice) {
    const sc_0 = slice;
    const _started = sc_0.loadBit();
    const _endAt = sc_0.loadUintBig(32);
    const _reserve = sc_0.loadCoins();
    const _highBid = sc_0.loadCoins();
    const _highBidder = sc_0.loadMaybeAddress();
    const _mediaRef = sc_0.loadUintBig(256);
    return { $$type: 'Auction' as const, started: _started, endAt: _endAt, reserve: _reserve, highBid: _highBid, highBidder: _highBidder, mediaRef: _mediaRef };
}

export function loadTupleAuction(source: TupleReader) {
    const _started = source.readBoolean();
    const _endAt = source.readBigNumber();
    const _reserve = source.readBigNumber();
    const _highBid = source.readBigNumber();
    const _highBidder = source.readAddressOpt();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'Auction' as const, started: _started, endAt: _endAt, reserve: _reserve, highBid: _highBid, highBidder: _highBidder, mediaRef: _mediaRef };
}

export function loadGetterTupleAuction(source: TupleReader) {
    const _started = source.readBoolean();
    const _endAt = source.readBigNumber();
    const _reserve = source.readBigNumber();
    const _highBid = source.readBigNumber();
    const _highBidder = source.readAddressOpt();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'Auction' as const, started: _started, endAt: _endAt, reserve: _reserve, highBid: _highBid, highBidder: _highBidder, mediaRef: _mediaRef };
}

export function storeTupleAuction(source: Auction) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.started);
    builder.writeNumber(source.endAt);
    builder.writeNumber(source.reserve);
    builder.writeNumber(source.highBid);
    builder.writeAddress(source.highBidder);
    builder.writeNumber(source.mediaRef);
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
    kind: bigint;
    startPrice: bigint;
    floor: bigint;
    cap: bigint;
    bumpBps: bigint;
    decayBps: bigint;
    maxSupply: bigint;
    specialFee: bigint;
    photoFee: bigint;
    walletMax: bigint;
}

export function storeConfigure(src: Configure) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024128, 32);
        b_0.storeUint(src.kind, 8);
        b_0.storeCoins(src.startPrice);
        b_0.storeCoins(src.floor);
        b_0.storeCoins(src.cap);
        b_0.storeUint(src.bumpBps, 16);
        b_0.storeUint(src.decayBps, 16);
        b_0.storeUint(src.maxSupply, 32);
        b_0.storeCoins(src.specialFee);
        b_0.storeCoins(src.photoFee);
        b_0.storeUint(src.walletMax, 16);
    };
}

export function loadConfigure(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024128) { throw Error('Invalid prefix'); }
    const _kind = sc_0.loadUintBig(8);
    const _startPrice = sc_0.loadCoins();
    const _floor = sc_0.loadCoins();
    const _cap = sc_0.loadCoins();
    const _bumpBps = sc_0.loadUintBig(16);
    const _decayBps = sc_0.loadUintBig(16);
    const _maxSupply = sc_0.loadUintBig(32);
    const _specialFee = sc_0.loadCoins();
    const _photoFee = sc_0.loadCoins();
    const _walletMax = sc_0.loadUintBig(16);
    return { $$type: 'Configure' as const, kind: _kind, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps, maxSupply: _maxSupply, specialFee: _specialFee, photoFee: _photoFee, walletMax: _walletMax };
}

export function loadTupleConfigure(source: TupleReader) {
    const _kind = source.readBigNumber();
    const _startPrice = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    const _maxSupply = source.readBigNumber();
    const _specialFee = source.readBigNumber();
    const _photoFee = source.readBigNumber();
    const _walletMax = source.readBigNumber();
    return { $$type: 'Configure' as const, kind: _kind, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps, maxSupply: _maxSupply, specialFee: _specialFee, photoFee: _photoFee, walletMax: _walletMax };
}

export function loadGetterTupleConfigure(source: TupleReader) {
    const _kind = source.readBigNumber();
    const _startPrice = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    const _maxSupply = source.readBigNumber();
    const _specialFee = source.readBigNumber();
    const _photoFee = source.readBigNumber();
    const _walletMax = source.readBigNumber();
    return { $$type: 'Configure' as const, kind: _kind, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps, maxSupply: _maxSupply, specialFee: _specialFee, photoFee: _photoFee, walletMax: _walletMax };
}

export function storeTupleConfigure(source: Configure) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.kind);
    builder.writeNumber(source.startPrice);
    builder.writeNumber(source.floor);
    builder.writeNumber(source.cap);
    builder.writeNumber(source.bumpBps);
    builder.writeNumber(source.decayBps);
    builder.writeNumber(source.maxSupply);
    builder.writeNumber(source.specialFee);
    builder.writeNumber(source.photoFee);
    builder.writeNumber(source.walletMax);
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
    occasion: bigint;
    mediaRef: bigint;
    style: bigint;
}

export function storeBuy(src: Buy) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024132, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeAddress(src.recipient);
        b_0.storeUint(src.occasion, 8);
        b_0.storeUint(src.mediaRef, 256);
        b_0.storeUint(src.style, 8);
    };
}

export function loadBuy(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024132) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _recipient = sc_0.loadMaybeAddress();
    const _occasion = sc_0.loadUintBig(8);
    const _mediaRef = sc_0.loadUintBig(256);
    const _style = sc_0.loadUintBig(8);
    return { $$type: 'Buy' as const, index: _index, recipient: _recipient, occasion: _occasion, mediaRef: _mediaRef, style: _style };
}

export function loadTupleBuy(source: TupleReader) {
    const _index = source.readBigNumber();
    const _recipient = source.readAddressOpt();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _style = source.readBigNumber();
    return { $$type: 'Buy' as const, index: _index, recipient: _recipient, occasion: _occasion, mediaRef: _mediaRef, style: _style };
}

export function loadGetterTupleBuy(source: TupleReader) {
    const _index = source.readBigNumber();
    const _recipient = source.readAddressOpt();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    const _style = source.readBigNumber();
    return { $$type: 'Buy' as const, index: _index, recipient: _recipient, occasion: _occasion, mediaRef: _mediaRef, style: _style };
}

export function storeTupleBuy(source: Buy) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeAddress(source.recipient);
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    builder.writeNumber(source.style);
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
    mediaRef: bigint;
}

export function storeStartAuction(src: StartAuction) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024133, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeCoins(src.reserve);
        b_0.storeUint(src.duration, 32);
        b_0.storeUint(src.mediaRef, 256);
    };
}

export function loadStartAuction(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024133) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _reserve = sc_0.loadCoins();
    const _duration = sc_0.loadUintBig(32);
    const _mediaRef = sc_0.loadUintBig(256);
    return { $$type: 'StartAuction' as const, index: _index, reserve: _reserve, duration: _duration, mediaRef: _mediaRef };
}

export function loadTupleStartAuction(source: TupleReader) {
    const _index = source.readBigNumber();
    const _reserve = source.readBigNumber();
    const _duration = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'StartAuction' as const, index: _index, reserve: _reserve, duration: _duration, mediaRef: _mediaRef };
}

export function loadGetterTupleStartAuction(source: TupleReader) {
    const _index = source.readBigNumber();
    const _reserve = source.readBigNumber();
    const _duration = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'StartAuction' as const, index: _index, reserve: _reserve, duration: _duration, mediaRef: _mediaRef };
}

export function storeTupleStartAuction(source: StartAuction) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeNumber(source.reserve);
    builder.writeNumber(source.duration);
    builder.writeNumber(source.mediaRef);
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

export type SetKindFees = {
    $$type: 'SetKindFees';
    kind: bigint;
    photoFee: bigint;
    specialFee: bigint;
}

export function storeSetKindFees(src: SetKindFees) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024137, 32);
        b_0.storeUint(src.kind, 8);
        b_0.storeCoins(src.photoFee);
        b_0.storeCoins(src.specialFee);
    };
}

export function loadSetKindFees(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024137) { throw Error('Invalid prefix'); }
    const _kind = sc_0.loadUintBig(8);
    const _photoFee = sc_0.loadCoins();
    const _specialFee = sc_0.loadCoins();
    return { $$type: 'SetKindFees' as const, kind: _kind, photoFee: _photoFee, specialFee: _specialFee };
}

export function loadTupleSetKindFees(source: TupleReader) {
    const _kind = source.readBigNumber();
    const _photoFee = source.readBigNumber();
    const _specialFee = source.readBigNumber();
    return { $$type: 'SetKindFees' as const, kind: _kind, photoFee: _photoFee, specialFee: _specialFee };
}

export function loadGetterTupleSetKindFees(source: TupleReader) {
    const _kind = source.readBigNumber();
    const _photoFee = source.readBigNumber();
    const _specialFee = source.readBigNumber();
    return { $$type: 'SetKindFees' as const, kind: _kind, photoFee: _photoFee, specialFee: _specialFee };
}

export function storeTupleSetKindFees(source: SetKindFees) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.kind);
    builder.writeNumber(source.photoFee);
    builder.writeNumber(source.specialFee);
    return builder.build();
}

export function dictValueParserSetKindFees(): DictionaryValue<SetKindFees> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetKindFees(src)).endCell());
        },
        parse: (src) => {
            return loadSetKindFees(src.loadRef().beginParse());
        }
    }
}

export type SetCap = {
    $$type: 'SetCap';
    kind: bigint;
    cap: bigint;
}

export function storeSetCap(src: SetCap) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024138, 32);
        b_0.storeUint(src.kind, 8);
        b_0.storeUint(src.cap, 32);
    };
}

export function loadSetCap(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024138) { throw Error('Invalid prefix'); }
    const _kind = sc_0.loadUintBig(8);
    const _cap = sc_0.loadUintBig(32);
    return { $$type: 'SetCap' as const, kind: _kind, cap: _cap };
}

export function loadTupleSetCap(source: TupleReader) {
    const _kind = source.readBigNumber();
    const _cap = source.readBigNumber();
    return { $$type: 'SetCap' as const, kind: _kind, cap: _cap };
}

export function loadGetterTupleSetCap(source: TupleReader) {
    const _kind = source.readBigNumber();
    const _cap = source.readBigNumber();
    return { $$type: 'SetCap' as const, kind: _kind, cap: _cap };
}

export function storeTupleSetCap(source: SetCap) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.kind);
    builder.writeNumber(source.cap);
    return builder.build();
}

export function dictValueParserSetCap(): DictionaryValue<SetCap> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetCap(src)).endCell());
        },
        parse: (src) => {
            return loadSetCap(src.loadRef().beginParse());
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

export type Reprice = {
    $$type: 'Reprice';
    kind: bigint;
    floor: bigint;
    cap: bigint;
}

export function storeReprice(src: Reprice) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024165, 32);
        b_0.storeUint(src.kind, 8);
        b_0.storeCoins(src.floor);
        b_0.storeCoins(src.cap);
    };
}

export function loadReprice(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024165) { throw Error('Invalid prefix'); }
    const _kind = sc_0.loadUintBig(8);
    const _floor = sc_0.loadCoins();
    const _cap = sc_0.loadCoins();
    return { $$type: 'Reprice' as const, kind: _kind, floor: _floor, cap: _cap };
}

export function loadTupleReprice(source: TupleReader) {
    const _kind = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    return { $$type: 'Reprice' as const, kind: _kind, floor: _floor, cap: _cap };
}

export function loadGetterTupleReprice(source: TupleReader) {
    const _kind = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    return { $$type: 'Reprice' as const, kind: _kind, floor: _floor, cap: _cap };
}

export function storeTupleReprice(source: Reprice) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.kind);
    builder.writeNumber(source.floor);
    builder.writeNumber(source.cap);
    return builder.build();
}

export function dictValueParserReprice(): DictionaryValue<Reprice> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeReprice(src)).endCell());
        },
        parse: (src) => {
            return loadReprice(src.loadRef().beginParse());
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

export type LoadPool = {
    $$type: 'LoadPool';
    items: Dictionary<number, number>;
}

export function storeLoadPool(src: LoadPool) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024144, 32);
        b_0.storeDict(src.items, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32));
    };
}

export function loadLoadPool(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024144) { throw Error('Invalid prefix'); }
    const _items = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32), sc_0);
    return { $$type: 'LoadPool' as const, items: _items };
}

export function loadTupleLoadPool(source: TupleReader) {
    const _items = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32), source.readCellOpt());
    return { $$type: 'LoadPool' as const, items: _items };
}

export function loadGetterTupleLoadPool(source: TupleReader) {
    const _items = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32), source.readCellOpt());
    return { $$type: 'LoadPool' as const, items: _items };
}

export function storeTupleLoadPool(source: LoadPool) {
    const builder = new TupleBuilder();
    builder.writeCell(source.items.size > 0 ? beginCell().storeDictDirect(source.items, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32)).endCell() : null);
    return builder.build();
}

export function dictValueParserLoadPool(): DictionaryValue<LoadPool> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeLoadPool(src)).endCell());
        },
        parse: (src) => {
            return loadLoadPool(src.loadRef().beginParse());
        }
    }
}

export type SetMystery = {
    $$type: 'SetMystery';
    commitHash: bigint;
    revealAt: bigint;
    startPrice: bigint;
    floor: bigint;
    cap: bigint;
    bumpBps: bigint;
    decayBps: bigint;
    poolExpected: bigint;
}

export function storeSetMystery(src: SetMystery) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024145, 32);
        b_0.storeUint(src.commitHash, 256);
        b_0.storeUint(src.revealAt, 32);
        b_0.storeCoins(src.startPrice);
        b_0.storeCoins(src.floor);
        b_0.storeCoins(src.cap);
        b_0.storeUint(src.bumpBps, 16);
        b_0.storeUint(src.decayBps, 16);
        b_0.storeUint(src.poolExpected, 16);
    };
}

export function loadSetMystery(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024145) { throw Error('Invalid prefix'); }
    const _commitHash = sc_0.loadUintBig(256);
    const _revealAt = sc_0.loadUintBig(32);
    const _startPrice = sc_0.loadCoins();
    const _floor = sc_0.loadCoins();
    const _cap = sc_0.loadCoins();
    const _bumpBps = sc_0.loadUintBig(16);
    const _decayBps = sc_0.loadUintBig(16);
    const _poolExpected = sc_0.loadUintBig(16);
    return { $$type: 'SetMystery' as const, commitHash: _commitHash, revealAt: _revealAt, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps, poolExpected: _poolExpected };
}

export function loadTupleSetMystery(source: TupleReader) {
    const _commitHash = source.readBigNumber();
    const _revealAt = source.readBigNumber();
    const _startPrice = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    const _poolExpected = source.readBigNumber();
    return { $$type: 'SetMystery' as const, commitHash: _commitHash, revealAt: _revealAt, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps, poolExpected: _poolExpected };
}

export function loadGetterTupleSetMystery(source: TupleReader) {
    const _commitHash = source.readBigNumber();
    const _revealAt = source.readBigNumber();
    const _startPrice = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    const _poolExpected = source.readBigNumber();
    return { $$type: 'SetMystery' as const, commitHash: _commitHash, revealAt: _revealAt, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps, poolExpected: _poolExpected };
}

export function storeTupleSetMystery(source: SetMystery) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.commitHash);
    builder.writeNumber(source.revealAt);
    builder.writeNumber(source.startPrice);
    builder.writeNumber(source.floor);
    builder.writeNumber(source.cap);
    builder.writeNumber(source.bumpBps);
    builder.writeNumber(source.decayBps);
    builder.writeNumber(source.poolExpected);
    return builder.build();
}

export function dictValueParserSetMystery(): DictionaryValue<SetMystery> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetMystery(src)).endCell());
        },
        parse: (src) => {
            return loadSetMystery(src.loadRef().beginParse());
        }
    }
}

export type BuyTicket = {
    $$type: 'BuyTicket';
    recipient: Address | null;
}

export function storeBuyTicket(src: BuyTicket) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024146, 32);
        b_0.storeAddress(src.recipient);
    };
}

export function loadBuyTicket(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024146) { throw Error('Invalid prefix'); }
    const _recipient = sc_0.loadMaybeAddress();
    return { $$type: 'BuyTicket' as const, recipient: _recipient };
}

export function loadTupleBuyTicket(source: TupleReader) {
    const _recipient = source.readAddressOpt();
    return { $$type: 'BuyTicket' as const, recipient: _recipient };
}

export function loadGetterTupleBuyTicket(source: TupleReader) {
    const _recipient = source.readAddressOpt();
    return { $$type: 'BuyTicket' as const, recipient: _recipient };
}

export function storeTupleBuyTicket(source: BuyTicket) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.recipient);
    return builder.build();
}

export function dictValueParserBuyTicket(): DictionaryValue<BuyTicket> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBuyTicket(src)).endCell());
        },
        parse: (src) => {
            return loadBuyTicket(src.loadRef().beginParse());
        }
    }
}

export type Reveal = {
    $$type: 'Reveal';
    secret: bigint;
}

export function storeReveal(src: Reveal) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024147, 32);
        b_0.storeUint(src.secret, 256);
    };
}

export function loadReveal(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024147) { throw Error('Invalid prefix'); }
    const _secret = sc_0.loadUintBig(256);
    return { $$type: 'Reveal' as const, secret: _secret };
}

export function loadTupleReveal(source: TupleReader) {
    const _secret = source.readBigNumber();
    return { $$type: 'Reveal' as const, secret: _secret };
}

export function loadGetterTupleReveal(source: TupleReader) {
    const _secret = source.readBigNumber();
    return { $$type: 'Reveal' as const, secret: _secret };
}

export function storeTupleReveal(source: Reveal) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.secret);
    return builder.build();
}

export function dictValueParserReveal(): DictionaryValue<Reveal> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeReveal(src)).endCell());
        },
        parse: (src) => {
            return loadReveal(src.loadRef().beginParse());
        }
    }
}

export type ClaimTicket = {
    $$type: 'ClaimTicket';
    ticket: bigint;
}

export function storeClaimTicket(src: ClaimTicket) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024148, 32);
        b_0.storeUint(src.ticket, 16);
    };
}

export function loadClaimTicket(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024148) { throw Error('Invalid prefix'); }
    const _ticket = sc_0.loadUintBig(16);
    return { $$type: 'ClaimTicket' as const, ticket: _ticket };
}

export function loadTupleClaimTicket(source: TupleReader) {
    const _ticket = source.readBigNumber();
    return { $$type: 'ClaimTicket' as const, ticket: _ticket };
}

export function loadGetterTupleClaimTicket(source: TupleReader) {
    const _ticket = source.readBigNumber();
    return { $$type: 'ClaimTicket' as const, ticket: _ticket };
}

export function storeTupleClaimTicket(source: ClaimTicket) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.ticket);
    return builder.build();
}

export function dictValueParserClaimTicket(): DictionaryValue<ClaimTicket> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeClaimTicket(src)).endCell());
        },
        parse: (src) => {
            return loadClaimTicket(src.loadRef().beginParse());
        }
    }
}

export type RevealPublic = {
    $$type: 'RevealPublic';
}

export function storeRevealPublic(src: RevealPublic) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024150, 32);
    };
}

export function loadRevealPublic(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024150) { throw Error('Invalid prefix'); }
    return { $$type: 'RevealPublic' as const };
}

export function loadTupleRevealPublic(source: TupleReader) {
    return { $$type: 'RevealPublic' as const };
}

export function loadGetterTupleRevealPublic(source: TupleReader) {
    return { $$type: 'RevealPublic' as const };
}

export function storeTupleRevealPublic(source: RevealPublic) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserRevealPublic(): DictionaryValue<RevealPublic> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRevealPublic(src)).endCell());
        },
        parse: (src) => {
            return loadRevealPublic(src.loadRef().beginParse());
        }
    }
}

export type AdminMint = {
    $$type: 'AdminMint';
    index: bigint;
    recipient: Address | null;
    occasion: bigint;
    mediaRef: bigint;
}

export function storeAdminMint(src: AdminMint) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024151, 32);
        b_0.storeUint(src.index, 64);
        b_0.storeAddress(src.recipient);
        b_0.storeUint(src.occasion, 8);
        b_0.storeUint(src.mediaRef, 256);
    };
}

export function loadAdminMint(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024151) { throw Error('Invalid prefix'); }
    const _index = sc_0.loadUintBig(64);
    const _recipient = sc_0.loadMaybeAddress();
    const _occasion = sc_0.loadUintBig(8);
    const _mediaRef = sc_0.loadUintBig(256);
    return { $$type: 'AdminMint' as const, index: _index, recipient: _recipient, occasion: _occasion, mediaRef: _mediaRef };
}

export function loadTupleAdminMint(source: TupleReader) {
    const _index = source.readBigNumber();
    const _recipient = source.readAddressOpt();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'AdminMint' as const, index: _index, recipient: _recipient, occasion: _occasion, mediaRef: _mediaRef };
}

export function loadGetterTupleAdminMint(source: TupleReader) {
    const _index = source.readBigNumber();
    const _recipient = source.readAddressOpt();
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'AdminMint' as const, index: _index, recipient: _recipient, occasion: _occasion, mediaRef: _mediaRef };
}

export function storeTupleAdminMint(source: AdminMint) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeAddress(source.recipient);
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    return builder.build();
}

export function dictValueParserAdminMint(): DictionaryValue<AdminMint> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeAdminMint(src)).endCell());
        },
        parse: (src) => {
            return loadAdminMint(src.loadRef().beginParse());
        }
    }
}

export type TransferTicket = {
    $$type: 'TransferTicket';
    ticket: bigint;
    newOwner: Address;
}

export function storeTransferTicket(src: TransferTicket) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024149, 32);
        b_0.storeUint(src.ticket, 16);
        b_0.storeAddress(src.newOwner);
    };
}

export function loadTransferTicket(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024149) { throw Error('Invalid prefix'); }
    const _ticket = sc_0.loadUintBig(16);
    const _newOwner = sc_0.loadAddress();
    return { $$type: 'TransferTicket' as const, ticket: _ticket, newOwner: _newOwner };
}

export function loadTupleTransferTicket(source: TupleReader) {
    const _ticket = source.readBigNumber();
    const _newOwner = source.readAddress();
    return { $$type: 'TransferTicket' as const, ticket: _ticket, newOwner: _newOwner };
}

export function loadGetterTupleTransferTicket(source: TupleReader) {
    const _ticket = source.readBigNumber();
    const _newOwner = source.readAddress();
    return { $$type: 'TransferTicket' as const, ticket: _ticket, newOwner: _newOwner };
}

export function storeTupleTransferTicket(source: TransferTicket) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.ticket);
    builder.writeAddress(source.newOwner);
    return builder.build();
}

export function dictValueParserTransferTicket(): DictionaryValue<TransferTicket> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTransferTicket(src)).endCell());
        },
        parse: (src) => {
            return loadTransferTicket(src.loadRef().beginParse());
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
    reserved: Dictionary<number, boolean>;
    pool: Dictionary<number, number>;
    tickets: Dictionary<number, Ticket>;
    poolSize: bigint;
    poolExpected: bigint;
    poolLoaded: bigint;
    ticketsSold: bigint;
    commitHash: bigint;
    revealAt: bigint;
    revealed: boolean;
    permA: bigint;
    permB: bigint;
    auctions: Dictionary<number, Auction>;
    auctionIds: Dictionary<number, number>;
    auctionCount: bigint;
    wallets: Dictionary<Address, WalletCount>;
    status: bigint;
    startAt: bigint;
    walletDailyCap: bigint;
    soldCount: bigint;
    caps: Dictionary<number, number>;
    issuedBy: Dictionary<number, number>;
    photoFees: Dictionary<number, bigint>;
    specialFees: Dictionary<number, bigint>;
    walletMax: Dictionary<number, number>;
    lockedBids: bigint;
    ticketsOpen: bigint;
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
        b_1.storeDict(src.sold, Dictionary.Keys.Uint(32), Dictionary.Values.Bool());
        b_1.storeDict(src.pending, Dictionary.Keys.Uint(32), dictValueParserPendingMint());
        b_1.storeDict(src.reserved, Dictionary.Keys.Uint(32), Dictionary.Values.Bool());
        const b_2 = new Builder();
        b_2.storeDict(src.pool, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32));
        b_2.storeDict(src.tickets, Dictionary.Keys.Uint(16), dictValueParserTicket());
        b_2.storeUint(src.poolSize, 16);
        b_2.storeUint(src.poolExpected, 16);
        b_2.storeUint(src.poolLoaded, 16);
        b_2.storeUint(src.ticketsSold, 16);
        b_2.storeUint(src.commitHash, 256);
        b_2.storeUint(src.revealAt, 32);
        b_2.storeBit(src.revealed);
        b_2.storeUint(src.permA, 32);
        b_2.storeUint(src.permB, 32);
        b_2.storeDict(src.auctions, Dictionary.Keys.Uint(32), dictValueParserAuction());
        const b_3 = new Builder();
        b_3.storeDict(src.auctionIds, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32));
        b_3.storeUint(src.auctionCount, 16);
        b_3.storeDict(src.wallets, Dictionary.Keys.Address(), dictValueParserWalletCount());
        b_3.storeUint(src.status, 8);
        b_3.storeUint(src.startAt, 32);
        b_3.storeUint(src.walletDailyCap, 16);
        b_3.storeUint(src.soldCount, 32);
        b_3.storeDict(src.caps, Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32));
        const b_4 = new Builder();
        b_4.storeDict(src.issuedBy, Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32));
        b_4.storeDict(src.photoFees, Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4));
        b_4.storeDict(src.specialFees, Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4));
        b_4.storeDict(src.walletMax, Dictionary.Keys.Uint(8), Dictionary.Values.Uint(16));
        b_4.storeCoins(src.lockedBids);
        b_4.storeUint(src.ticketsOpen, 16);
        b_3.storeRef(b_4.endCell());
        b_2.storeRef(b_3.endCell());
        b_1.storeRef(b_2.endCell());
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
    const _sold = Dictionary.load(Dictionary.Keys.Uint(32), Dictionary.Values.Bool(), sc_1);
    const _pending = Dictionary.load(Dictionary.Keys.Uint(32), dictValueParserPendingMint(), sc_1);
    const _reserved = Dictionary.load(Dictionary.Keys.Uint(32), Dictionary.Values.Bool(), sc_1);
    const sc_2 = sc_1.loadRef().beginParse();
    const _pool = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32), sc_2);
    const _tickets = Dictionary.load(Dictionary.Keys.Uint(16), dictValueParserTicket(), sc_2);
    const _poolSize = sc_2.loadUintBig(16);
    const _poolExpected = sc_2.loadUintBig(16);
    const _poolLoaded = sc_2.loadUintBig(16);
    const _ticketsSold = sc_2.loadUintBig(16);
    const _commitHash = sc_2.loadUintBig(256);
    const _revealAt = sc_2.loadUintBig(32);
    const _revealed = sc_2.loadBit();
    const _permA = sc_2.loadUintBig(32);
    const _permB = sc_2.loadUintBig(32);
    const _auctions = Dictionary.load(Dictionary.Keys.Uint(32), dictValueParserAuction(), sc_2);
    const sc_3 = sc_2.loadRef().beginParse();
    const _auctionIds = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32), sc_3);
    const _auctionCount = sc_3.loadUintBig(16);
    const _wallets = Dictionary.load(Dictionary.Keys.Address(), dictValueParserWalletCount(), sc_3);
    const _status = sc_3.loadUintBig(8);
    const _startAt = sc_3.loadUintBig(32);
    const _walletDailyCap = sc_3.loadUintBig(16);
    const _soldCount = sc_3.loadUintBig(32);
    const _caps = Dictionary.load(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32), sc_3);
    const sc_4 = sc_3.loadRef().beginParse();
    const _issuedBy = Dictionary.load(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32), sc_4);
    const _photoFees = Dictionary.load(Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4), sc_4);
    const _specialFees = Dictionary.load(Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4), sc_4);
    const _walletMax = Dictionary.load(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(16), sc_4);
    const _lockedBids = sc_4.loadCoins();
    const _ticketsOpen = sc_4.loadUintBig(16);
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, reserved: _reserved, pool: _pool, tickets: _tickets, poolSize: _poolSize, poolExpected: _poolExpected, poolLoaded: _poolLoaded, ticketsSold: _ticketsSold, commitHash: _commitHash, revealAt: _revealAt, revealed: _revealed, permA: _permA, permB: _permB, auctions: _auctions, auctionIds: _auctionIds, auctionCount: _auctionCount, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount, caps: _caps, issuedBy: _issuedBy, photoFees: _photoFees, specialFees: _specialFees, walletMax: _walletMax, lockedBids: _lockedBids, ticketsOpen: _ticketsOpen };
}

export function loadTupleAtharMinter$Data(source: TupleReader) {
    const _collection = source.readAddress();
    const _admin = source.readAddress();
    const _seasonId = source.readBigNumber();
    const _rangeStart = source.readBigNumber();
    const _rangeEnd = source.readBigNumber();
    const _tiers = Dictionary.loadDirect(Dictionary.Keys.Uint(8), dictValueParserTierState(), source.readCellOpt());
    const _special = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8), source.readCellOpt());
    const _sold = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Bool(), source.readCellOpt());
    const _pending = Dictionary.loadDirect(Dictionary.Keys.Uint(32), dictValueParserPendingMint(), source.readCellOpt());
    const _reserved = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Bool(), source.readCellOpt());
    const _pool = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32), source.readCellOpt());
    const _tickets = Dictionary.loadDirect(Dictionary.Keys.Uint(16), dictValueParserTicket(), source.readCellOpt());
    const _poolSize = source.readBigNumber();
    const _poolExpected = source.readBigNumber();
    source = source.readTuple();
    const _poolLoaded = source.readBigNumber();
    const _ticketsSold = source.readBigNumber();
    const _commitHash = source.readBigNumber();
    const _revealAt = source.readBigNumber();
    const _revealed = source.readBoolean();
    const _permA = source.readBigNumber();
    const _permB = source.readBigNumber();
    const _auctions = Dictionary.loadDirect(Dictionary.Keys.Uint(32), dictValueParserAuction(), source.readCellOpt());
    const _auctionIds = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32), source.readCellOpt());
    const _auctionCount = source.readBigNumber();
    const _wallets = Dictionary.loadDirect(Dictionary.Keys.Address(), dictValueParserWalletCount(), source.readCellOpt());
    const _status = source.readBigNumber();
    const _startAt = source.readBigNumber();
    const _walletDailyCap = source.readBigNumber();
    source = source.readTuple();
    const _soldCount = source.readBigNumber();
    const _caps = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32), source.readCellOpt());
    const _issuedBy = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32), source.readCellOpt());
    const _photoFees = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4), source.readCellOpt());
    const _specialFees = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4), source.readCellOpt());
    const _walletMax = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(16), source.readCellOpt());
    const _lockedBids = source.readBigNumber();
    const _ticketsOpen = source.readBigNumber();
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, reserved: _reserved, pool: _pool, tickets: _tickets, poolSize: _poolSize, poolExpected: _poolExpected, poolLoaded: _poolLoaded, ticketsSold: _ticketsSold, commitHash: _commitHash, revealAt: _revealAt, revealed: _revealed, permA: _permA, permB: _permB, auctions: _auctions, auctionIds: _auctionIds, auctionCount: _auctionCount, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount, caps: _caps, issuedBy: _issuedBy, photoFees: _photoFees, specialFees: _specialFees, walletMax: _walletMax, lockedBids: _lockedBids, ticketsOpen: _ticketsOpen };
}

export function loadGetterTupleAtharMinter$Data(source: TupleReader) {
    const _collection = source.readAddress();
    const _admin = source.readAddress();
    const _seasonId = source.readBigNumber();
    const _rangeStart = source.readBigNumber();
    const _rangeEnd = source.readBigNumber();
    const _tiers = Dictionary.loadDirect(Dictionary.Keys.Uint(8), dictValueParserTierState(), source.readCellOpt());
    const _special = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(8), source.readCellOpt());
    const _sold = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Bool(), source.readCellOpt());
    const _pending = Dictionary.loadDirect(Dictionary.Keys.Uint(32), dictValueParserPendingMint(), source.readCellOpt());
    const _reserved = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Bool(), source.readCellOpt());
    const _pool = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32), source.readCellOpt());
    const _tickets = Dictionary.loadDirect(Dictionary.Keys.Uint(16), dictValueParserTicket(), source.readCellOpt());
    const _poolSize = source.readBigNumber();
    const _poolExpected = source.readBigNumber();
    const _poolLoaded = source.readBigNumber();
    const _ticketsSold = source.readBigNumber();
    const _commitHash = source.readBigNumber();
    const _revealAt = source.readBigNumber();
    const _revealed = source.readBoolean();
    const _permA = source.readBigNumber();
    const _permB = source.readBigNumber();
    const _auctions = Dictionary.loadDirect(Dictionary.Keys.Uint(32), dictValueParserAuction(), source.readCellOpt());
    const _auctionIds = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32), source.readCellOpt());
    const _auctionCount = source.readBigNumber();
    const _wallets = Dictionary.loadDirect(Dictionary.Keys.Address(), dictValueParserWalletCount(), source.readCellOpt());
    const _status = source.readBigNumber();
    const _startAt = source.readBigNumber();
    const _walletDailyCap = source.readBigNumber();
    const _soldCount = source.readBigNumber();
    const _caps = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32), source.readCellOpt());
    const _issuedBy = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32), source.readCellOpt());
    const _photoFees = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4), source.readCellOpt());
    const _specialFees = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4), source.readCellOpt());
    const _walletMax = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Uint(16), source.readCellOpt());
    const _lockedBids = source.readBigNumber();
    const _ticketsOpen = source.readBigNumber();
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, reserved: _reserved, pool: _pool, tickets: _tickets, poolSize: _poolSize, poolExpected: _poolExpected, poolLoaded: _poolLoaded, ticketsSold: _ticketsSold, commitHash: _commitHash, revealAt: _revealAt, revealed: _revealed, permA: _permA, permB: _permB, auctions: _auctions, auctionIds: _auctionIds, auctionCount: _auctionCount, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount, caps: _caps, issuedBy: _issuedBy, photoFees: _photoFees, specialFees: _specialFees, walletMax: _walletMax, lockedBids: _lockedBids, ticketsOpen: _ticketsOpen };
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
    builder.writeCell(source.sold.size > 0 ? beginCell().storeDictDirect(source.sold, Dictionary.Keys.Uint(32), Dictionary.Values.Bool()).endCell() : null);
    builder.writeCell(source.pending.size > 0 ? beginCell().storeDictDirect(source.pending, Dictionary.Keys.Uint(32), dictValueParserPendingMint()).endCell() : null);
    builder.writeCell(source.reserved.size > 0 ? beginCell().storeDictDirect(source.reserved, Dictionary.Keys.Uint(32), Dictionary.Values.Bool()).endCell() : null);
    builder.writeCell(source.pool.size > 0 ? beginCell().storeDictDirect(source.pool, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32)).endCell() : null);
    builder.writeCell(source.tickets.size > 0 ? beginCell().storeDictDirect(source.tickets, Dictionary.Keys.Uint(16), dictValueParserTicket()).endCell() : null);
    builder.writeNumber(source.poolSize);
    builder.writeNumber(source.poolExpected);
    builder.writeNumber(source.poolLoaded);
    builder.writeNumber(source.ticketsSold);
    builder.writeNumber(source.commitHash);
    builder.writeNumber(source.revealAt);
    builder.writeBoolean(source.revealed);
    builder.writeNumber(source.permA);
    builder.writeNumber(source.permB);
    builder.writeCell(source.auctions.size > 0 ? beginCell().storeDictDirect(source.auctions, Dictionary.Keys.Uint(32), dictValueParserAuction()).endCell() : null);
    builder.writeCell(source.auctionIds.size > 0 ? beginCell().storeDictDirect(source.auctionIds, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(32)).endCell() : null);
    builder.writeNumber(source.auctionCount);
    builder.writeCell(source.wallets.size > 0 ? beginCell().storeDictDirect(source.wallets, Dictionary.Keys.Address(), dictValueParserWalletCount()).endCell() : null);
    builder.writeNumber(source.status);
    builder.writeNumber(source.startAt);
    builder.writeNumber(source.walletDailyCap);
    builder.writeNumber(source.soldCount);
    builder.writeCell(source.caps.size > 0 ? beginCell().storeDictDirect(source.caps, Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32)).endCell() : null);
    builder.writeCell(source.issuedBy.size > 0 ? beginCell().storeDictDirect(source.issuedBy, Dictionary.Keys.Uint(8), Dictionary.Values.Uint(32)).endCell() : null);
    builder.writeCell(source.photoFees.size > 0 ? beginCell().storeDictDirect(source.photoFees, Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4)).endCell() : null);
    builder.writeCell(source.specialFees.size > 0 ? beginCell().storeDictDirect(source.specialFees, Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4)).endCell() : null);
    builder.writeCell(source.walletMax.size > 0 ? beginCell().storeDictDirect(source.walletMax, Dictionary.Keys.Uint(8), Dictionary.Values.Uint(16)).endCell() : null);
    builder.writeNumber(source.lockedBids);
    builder.writeNumber(source.ticketsOpen);
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

export type DateView = {
    $$type: 'DateView';
    taken: bigint;
    auction: bigint;
    reserved: bigint;
    p0: bigint;
    p1: bigint;
    p2: bigint;
    special: boolean;
}

export function storeDateView(src: DateView) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.taken, 257);
        b_0.storeInt(src.auction, 257);
        b_0.storeInt(src.reserved, 257);
        const b_1 = new Builder();
        b_1.storeInt(src.p0, 257);
        b_1.storeInt(src.p1, 257);
        b_1.storeInt(src.p2, 257);
        b_1.storeBit(src.special);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadDateView(slice: Slice) {
    const sc_0 = slice;
    const _taken = sc_0.loadIntBig(257);
    const _auction = sc_0.loadIntBig(257);
    const _reserved = sc_0.loadIntBig(257);
    const sc_1 = sc_0.loadRef().beginParse();
    const _p0 = sc_1.loadIntBig(257);
    const _p1 = sc_1.loadIntBig(257);
    const _p2 = sc_1.loadIntBig(257);
    const _special = sc_1.loadBit();
    return { $$type: 'DateView' as const, taken: _taken, auction: _auction, reserved: _reserved, p0: _p0, p1: _p1, p2: _p2, special: _special };
}

export function loadTupleDateView(source: TupleReader) {
    const _taken = source.readBigNumber();
    const _auction = source.readBigNumber();
    const _reserved = source.readBigNumber();
    const _p0 = source.readBigNumber();
    const _p1 = source.readBigNumber();
    const _p2 = source.readBigNumber();
    const _special = source.readBoolean();
    return { $$type: 'DateView' as const, taken: _taken, auction: _auction, reserved: _reserved, p0: _p0, p1: _p1, p2: _p2, special: _special };
}

export function loadGetterTupleDateView(source: TupleReader) {
    const _taken = source.readBigNumber();
    const _auction = source.readBigNumber();
    const _reserved = source.readBigNumber();
    const _p0 = source.readBigNumber();
    const _p1 = source.readBigNumber();
    const _p2 = source.readBigNumber();
    const _special = source.readBoolean();
    return { $$type: 'DateView' as const, taken: _taken, auction: _auction, reserved: _reserved, p0: _p0, p1: _p1, p2: _p2, special: _special };
}

export function storeTupleDateView(source: DateView) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.taken);
    builder.writeNumber(source.auction);
    builder.writeNumber(source.reserved);
    builder.writeNumber(source.p0);
    builder.writeNumber(source.p1);
    builder.writeNumber(source.p2);
    builder.writeBoolean(source.special);
    return builder.build();
}

export function dictValueParserDateView(): DictionaryValue<DateView> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDateView(src)).endCell());
        },
        parse: (src) => {
            return loadDateView(src.loadRef().beginParse());
        }
    }
}

export type KindInfo = {
    $$type: 'KindInfo';
    cap: bigint;
    issued: bigint;
    photo: bigint;
    special: bigint;
    walletMax: bigint;
}

export function storeKindInfo(src: KindInfo) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.cap, 257);
        b_0.storeInt(src.issued, 257);
        b_0.storeInt(src.photo, 257);
        const b_1 = new Builder();
        b_1.storeInt(src.special, 257);
        b_1.storeInt(src.walletMax, 257);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadKindInfo(slice: Slice) {
    const sc_0 = slice;
    const _cap = sc_0.loadIntBig(257);
    const _issued = sc_0.loadIntBig(257);
    const _photo = sc_0.loadIntBig(257);
    const sc_1 = sc_0.loadRef().beginParse();
    const _special = sc_1.loadIntBig(257);
    const _walletMax = sc_1.loadIntBig(257);
    return { $$type: 'KindInfo' as const, cap: _cap, issued: _issued, photo: _photo, special: _special, walletMax: _walletMax };
}

export function loadTupleKindInfo(source: TupleReader) {
    const _cap = source.readBigNumber();
    const _issued = source.readBigNumber();
    const _photo = source.readBigNumber();
    const _special = source.readBigNumber();
    const _walletMax = source.readBigNumber();
    return { $$type: 'KindInfo' as const, cap: _cap, issued: _issued, photo: _photo, special: _special, walletMax: _walletMax };
}

export function loadGetterTupleKindInfo(source: TupleReader) {
    const _cap = source.readBigNumber();
    const _issued = source.readBigNumber();
    const _photo = source.readBigNumber();
    const _special = source.readBigNumber();
    const _walletMax = source.readBigNumber();
    return { $$type: 'KindInfo' as const, cap: _cap, issued: _issued, photo: _photo, special: _special, walletMax: _walletMax };
}

export function storeTupleKindInfo(source: KindInfo) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.cap);
    builder.writeNumber(source.issued);
    builder.writeNumber(source.photo);
    builder.writeNumber(source.special);
    builder.writeNumber(source.walletMax);
    return builder.build();
}

export function dictValueParserKindInfo(): DictionaryValue<KindInfo> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeKindInfo(src)).endCell());
        },
        parse: (src) => {
            return loadKindInfo(src.loadRef().beginParse());
        }
    }
}

export type WalletInfo = {
    $$type: 'WalletInfo';
    today: bigint;
    k0: bigint;
    k1: bigint;
    k2: bigint;
}

export function storeWalletInfo(src: WalletInfo) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.today, 257);
        b_0.storeInt(src.k0, 257);
        b_0.storeInt(src.k1, 257);
        const b_1 = new Builder();
        b_1.storeInt(src.k2, 257);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadWalletInfo(slice: Slice) {
    const sc_0 = slice;
    const _today = sc_0.loadIntBig(257);
    const _k0 = sc_0.loadIntBig(257);
    const _k1 = sc_0.loadIntBig(257);
    const sc_1 = sc_0.loadRef().beginParse();
    const _k2 = sc_1.loadIntBig(257);
    return { $$type: 'WalletInfo' as const, today: _today, k0: _k0, k1: _k1, k2: _k2 };
}

export function loadTupleWalletInfo(source: TupleReader) {
    const _today = source.readBigNumber();
    const _k0 = source.readBigNumber();
    const _k1 = source.readBigNumber();
    const _k2 = source.readBigNumber();
    return { $$type: 'WalletInfo' as const, today: _today, k0: _k0, k1: _k1, k2: _k2 };
}

export function loadGetterTupleWalletInfo(source: TupleReader) {
    const _today = source.readBigNumber();
    const _k0 = source.readBigNumber();
    const _k1 = source.readBigNumber();
    const _k2 = source.readBigNumber();
    return { $$type: 'WalletInfo' as const, today: _today, k0: _k0, k1: _k1, k2: _k2 };
}

export function storeTupleWalletInfo(source: WalletInfo) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.today);
    builder.writeNumber(source.k0);
    builder.writeNumber(source.k1);
    builder.writeNumber(source.k2);
    return builder.build();
}

export function dictValueParserWalletInfo(): DictionaryValue<WalletInfo> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeWalletInfo(src)).endCell());
        },
        parse: (src) => {
            return loadWalletInfo(src.loadRef().beginParse());
        }
    }
}

export type MysteryInfo = {
    $$type: 'MysteryInfo';
    poolSize: bigint;
    loaded: bigint;
    ticketsSold: bigint;
    revealed: boolean;
    revealAt: bigint;
    commitHash: bigint;
    a: bigint;
    b: bigint;
}

export function storeMysteryInfo(src: MysteryInfo) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.poolSize, 257);
        b_0.storeInt(src.loaded, 257);
        b_0.storeInt(src.ticketsSold, 257);
        b_0.storeBit(src.revealed);
        const b_1 = new Builder();
        b_1.storeInt(src.revealAt, 257);
        b_1.storeInt(src.commitHash, 257);
        b_1.storeInt(src.a, 257);
        const b_2 = new Builder();
        b_2.storeInt(src.b, 257);
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

export function loadMysteryInfo(slice: Slice) {
    const sc_0 = slice;
    const _poolSize = sc_0.loadIntBig(257);
    const _loaded = sc_0.loadIntBig(257);
    const _ticketsSold = sc_0.loadIntBig(257);
    const _revealed = sc_0.loadBit();
    const sc_1 = sc_0.loadRef().beginParse();
    const _revealAt = sc_1.loadIntBig(257);
    const _commitHash = sc_1.loadIntBig(257);
    const _a = sc_1.loadIntBig(257);
    const sc_2 = sc_1.loadRef().beginParse();
    const _b = sc_2.loadIntBig(257);
    return { $$type: 'MysteryInfo' as const, poolSize: _poolSize, loaded: _loaded, ticketsSold: _ticketsSold, revealed: _revealed, revealAt: _revealAt, commitHash: _commitHash, a: _a, b: _b };
}

export function loadTupleMysteryInfo(source: TupleReader) {
    const _poolSize = source.readBigNumber();
    const _loaded = source.readBigNumber();
    const _ticketsSold = source.readBigNumber();
    const _revealed = source.readBoolean();
    const _revealAt = source.readBigNumber();
    const _commitHash = source.readBigNumber();
    const _a = source.readBigNumber();
    const _b = source.readBigNumber();
    return { $$type: 'MysteryInfo' as const, poolSize: _poolSize, loaded: _loaded, ticketsSold: _ticketsSold, revealed: _revealed, revealAt: _revealAt, commitHash: _commitHash, a: _a, b: _b };
}

export function loadGetterTupleMysteryInfo(source: TupleReader) {
    const _poolSize = source.readBigNumber();
    const _loaded = source.readBigNumber();
    const _ticketsSold = source.readBigNumber();
    const _revealed = source.readBoolean();
    const _revealAt = source.readBigNumber();
    const _commitHash = source.readBigNumber();
    const _a = source.readBigNumber();
    const _b = source.readBigNumber();
    return { $$type: 'MysteryInfo' as const, poolSize: _poolSize, loaded: _loaded, ticketsSold: _ticketsSold, revealed: _revealed, revealAt: _revealAt, commitHash: _commitHash, a: _a, b: _b };
}

export function storeTupleMysteryInfo(source: MysteryInfo) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.poolSize);
    builder.writeNumber(source.loaded);
    builder.writeNumber(source.ticketsSold);
    builder.writeBoolean(source.revealed);
    builder.writeNumber(source.revealAt);
    builder.writeNumber(source.commitHash);
    builder.writeNumber(source.a);
    builder.writeNumber(source.b);
    return builder.build();
}

export function dictValueParserMysteryInfo(): DictionaryValue<MysteryInfo> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMysteryInfo(src)).endCell());
        },
        parse: (src) => {
            return loadMysteryInfo(src.loadRef().beginParse());
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
    const __code = Cell.fromHex('b5ee9c7241027401002159000228ff008e88f4a413f4bcf2c80bed5320e303ed43d90121020271020d02012003080201620406028daf8476a268690000c7197d206a00e800c08080eb802a9001e8ac458436c080fa40938836b6b83690b690b8410802faf0801041080ee6b28036b69336f186ed9e2b882f87b630c02205001a226e916de022206ef2d080f90002e9adaef6a268690000c7197d206a00e800c08080eb802a9001e8ac458436c080fa40938836b6b83690b690b8410802faf0801041080ee6b28036b69336f186888a888b888a888a088b088a0889888a88898889088a088908888889888888880889088807888887870888072a8eed9e2b882f87b630c02207001831c87101cb075614cf16ccc9020120090b0289b5dafda89a1a400031c65f481a803a003020203ae00aa4007a2b11610db0203e9024e20dadae0da42da42e104200bebc2004104203b9aca00dada4cdbc61bb678d9e6d8e70220a002c561556126eb398305611206ef2d080de56110156110102e1b4f47da89a1a400031c65f481a803a003020203ae00aa4007a2b11610db0203e9024e20dadae0da42da42e104200bebc2004104203b9aca00dada4cdbc61a222a222c222a2228222a22282226222822262224222622242222222422222220222222201e22201eaa1db678ae20be1ed8c30220c0104db3c4d0201200e190201200f170201201012028db36bbb5134348000638cbe903500740060404075c0154800f45622c21b60407d2049c41b5b5c1b485b485c2084017d7840082084077359401b5b499b78c376cf15c417c3db186022110004561102012013150289ac2df6a268690000c7197d206a00e800c08080eb802a9001e8ac458436c080fa40938836b6b83690b690b8410802faf0801041080ee6b28036b69336f186ed9e3679b639c02214001cc87101cb075615cf16c9529056170289ad2776a268690000c7197d206a00e800c08080eb802a9001e8ac458436c080fa40938836b6b83690b690b8410802faf0801041080ee6b28036b69336f186ed9e3679b639c02216000654765402e1b593dda89a1a400031c65f481a803a003020203ae00aa4007a2b11610db0203e9024e20dadae0da42da42e104200bebc2004104203b9aca00dada4cdbc61a222a222c222a2228222a22282226222822262224222622242222222422222220222222201e22201eaa1db678ae20be1ed8c302218002e81010b56100280204133f40a6fa19401d70130925b6de20201201a1c028db79cfda89a1a400031c65f481a803a003020203ae00aa4007a2b11610db0203e9024e20dadae0da42da42e104200bebc2004104203b9aca00dada4cdbc61bb678ae20be1ed8c30221b00022902016a1d1f0294a8a4ed44d0d200018e32fa40d401d001810101d700552003d1588b086d8101f48127106d6d706d216d2170821005f5e1002082101dcd65006d6d266de30ddb3c571257105f0f50565f05221e0008226eb322028caa7ded44d0d200018e32fa40d401d001810101d700552003d1588b086d8101f48127106d6d706d216d2170821005f5e1002082101dcd65006d6d266de30ddb3c57105f0f6c61222000022803f63001d072d721d200d200fa4021103450666f04f86102f862ed44d0d200018e32fa40d401d001810101d700552003d1588b086d8101f48127106d6d706d216d2170821005f5e1002082101dcd65006d6d266de30d11178e9f11158020d7217021d749c21f9430d31f01de821041540012bae3025f0f5f08e070561622242601f6fa40d401d001d31fd401d0d401d001d72c01916d93fa4001e201d30fd30ff404d72c01916d93fa4001e201d31fd2000193d401d0916de201d31fd72c01916d93fa4001e201d31fd200d430d0fa00fa00fa00f404f404d31ff4043011131116111311131115111311131114111357161114111511141113111411132300301112111311121111111211111110111111100f11100f550e02fed33f01311114111511141113111411131112111311121111111211111110111111100f11100f10ef10de10cd10bc10ab109a108910781067105610451034111641305616db3c70804070111ac80182104154001558cb1fcb3fc91034413001111a0110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016e4d2501b0b0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001114111511141113111411131112111311121111111211111110111111100f11100f550ec87f01ca00111611151114111311121111111055e0db3cc9ed54720468d74920c21f97311116d31f1117de21821041540022bae30221821041540023bae30221821041540024bae30221821041540025ba27292a2c02fc5b1115fa403081557df8425616c705f2f456106e8ec057101113111511131112111411121111111311111110111211100f11110f0e11100e10df551cc87f01ca00111611151114111311121111111055e0db3cc9ed54e03b3bf8235611a01113111511131112111411121111111311111110111211100f11110f0e11100e7228016410df10ce10ad0c109b108a10791068105710461035440302c87f01ca00111611151114111311121111111055e0db3cc9ed547201e05b5710571481557df8425614c705f2f48200cf3a2b6eb3f2f48137a5f8232bbef2f41112111411121111111311111110111211100f11110f0a11100a10df10ce10bd6d0d10ac109b108a107910681057104610354403c87f01ca00111611151114111311121111111055e0db3cc9ed547202fe5b1115d430d081557df8425616c705f2f45611d7498ec057111113111511131112111411121111111311111110111211100f11110f0e11100e10df551cc87f01ca00111611151114111311121111111055e0db3cc9ed54e13939f8235611a01113111511131112111411121111111311111110111211100f11110f0e11100e722b016410df10ce10bd10ac108b0a10791068105710461035440302c87f01ca00111611151114111311121111111055e0db3cc9ed547202fe8ef45b5711571481557df8425614c705f2f48200cf3a296eb3f2f48137a5f82329bef2f408206ef2d08011121114111211111113111111101112111011110e11100e10df10ce10bd10ac109b6d0b108a107910681057104610354140c87f01ca00111611151114111311121111111055e0db3cc9ed54e021821041540028ba722d03fc8ee95f041113d43081557df8425614c705f2f4f8235611a01113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a10791068105710461035410403c87f01ca00111611151114111311121111111055e0db3cc9ed54e02182104154002abae30221821041540029ba722e2f019210235f03571481557df8425614c705f2f41112111411121111111311111110111211100f11110f0e11100e551d6d59c87f01ca00111611151114111311121111111055e0db3cc9ed547204fe8ee85b571581557df8425615c705f2f48200cf3a216eb3f2f48137a5f8235616bef2f4206ef2d0806d01fb041113111511131112111411121111111311111110111211100f11110f0e11100e10df551cc87f01ca00111611151114111311121111111055e0db3cc9ed54e021821041540020bae30221821041540021bae3027230323301fe5b1115fa403081557df8425616c705f2f4811790296ef2f4268e1f81010bf8235614a0103f128020216e955b59f4593098c801cf014133f441e28e1f367f81010bf823103f41808020216e955b59f4593098c801cf014133f441e2e21113111511131112111411121111111311111110111211100f11110f0e11100e10df0e31015c10bd10ac109b108a107910681057104610354403c87f01ca00111611151114111311121111111055e0db3cc9ed547201f85b1115fa403081557df8425616c705f2f41d81010b016d8020216e955b59f4593098c801cf014133f441e21113111511131112111411121111111311111110111211100f11110f0e11100e10df0e10bd10ac109b108a107910681057104610354403c87f01ca00111611151114111311121111111055e0db3cc9ed5472044c21821041540002bae30221821041540074bae30221821041540070bae30221821041540072ba343a3c3e03fe5b1115d33ffa40d30fd307fa00d307d3fffa0030f8416f24303281565456126ef2f4561681010b2280204133f40a6fa19401d70130925b6de28200ec42216eb39af82302206ef2d08012be923170e2f2f4820081ab2adb3cf2f4816f11561a6eb3f2f48200df8223820b938700a05230bef2f4f8282adb3c1112a40d80202c404e3502f27f71216e955b59f45b3098c801cf004133f443e224c2008ec4561b206ef2d08073708828552010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00de820898968073700ec80182104154000558cb1fcb3fc9104541301e3637001c0000000061746861722073616c6501fc10246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00205611705920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400c87401cb0212ca07cbffc9d05023a18208989680a18209312d00a1717ff823106b105a3801f810491038407bc855608210415400015008cb1f16ce14cb0f12cb0701fa02cb1fcb07cbffc91046401504503d10465522c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001113111511131112111411121111111311111110111211100f11110f39016c0e11100e10df10ce10bd10ac109b108a107918105710461035401403c87f01ca00111611151114111311121111111055e0db3cc9ed547201fc5b6c331112fa00fa00fa003081557df8425615c705f2f4814127238209312d00be97228209312d00be9170e2982382112a05f200bb9170e2982282112a05f200bb9170e2982182112a05f200bb9170e2f2f4815e995312bef2f41113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce3b015a10bd10ac109b108a1079106810574614552005c87f01ca00111611151114111311121111111055e0db3cc9ed547203fa5b1115d33fd430d0f8416f243032810a6824db3c8e1626802026714133f40e6fa19401d70030925b6de26eb39170e2f2f48200df8229820afaf080a0820b938700a013be12f2f402111702011118011117db3c70804011197f111b2ac855208210415400715004cb1f12ce01c8cecd01fa02c944300211190201111a01404d3d01ea10246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001113111511131112111411121111111311111110111211100f11110f0e11100e10df551cc87f01ca00111611151114111311121111111055e0db3cc9ed547204b0e30221821041540003ba8f435b57151113111511131112111411121111111311111110111211100f11110f0e11100e10df551cdb3cc87f01ca00111611151114111311121111111055e0db3cc9ed54e021821041540027ba3f44724302fe5b1115d33fd307d3ff30f8416f243032810a6825db3c8e1627802027714133f40e6fa19401d70030925b6de26eb39170e2f2f48200df8229820afaf080a0820b938700a013be12f2f41116111711161115111711151114111711141113111711131112111711121111111711111110111711100f11170f0e11170e0d11170d4041003620c2ff97208208078eacbb9170e298a9380f82008eacbb923070e202fc0c11170c0b11170b0a11170a0911170908111708071117070611170605111705041117040311170302111802011119011117db3c7011188040111a7f111c5398c855408210415400735006cb1f14ce12cb07cbff01fa0201fa02c914031118030211190201111a0110246d50436d03c8cf8580ca00cf8440ce01fa0280694d4201e2cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001112111511121111111411111110111311100f11120f0e11110e0d11100d10cf10be10ad109c108b107a106910581047103645135042c87f01ca00111611151114111311121111111055e0db3cc9ed547204b08f435b57151113111511131112111411121111111311111110111211100f11110f0e11100e10df551cdb3cc87f01ca00111611151114111311121111111055e0db3cc9ed54e021821041540026bae30221821041540011ba4472464701aa816f1156126eb3f2f4820afaf08070fb025611206ef2d08070810082708810246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0045001200000000617468617201b05b1115fa403081557df8425616c705f2f48200da07096e19f2f41113111511131112111411121111111311111110111211100f11110f0e11100e10df551cc87f01ca00111611151114111311121111111055e0db3cc9ed547203c2e30221821041540013bae3025717c0001116c12101111601b08ebe1113111511131112111411121111111311111110111211100f11110f0e11100e10df551cc87f01ca00111611151114111311121111111055e0db3cc9ed54e05f0f5f07f2c082484c7201fe5b1115d33ffa40d30fd307fa00d31fd31ff404d307d3fff40430812426f8421115112011151114111f11141113111e11131112111d11121111111c11111110111b11100f111a0f0e11190e0d11180d0c11170c0b11160b0a11200a09111f0908111e0807111d0706111c0605111b0504111a040311190302111802011121014904fc11225617db3c01112301c70501112101f2f48200d118286eb3f2f427206ef2d080071116070611150605111f0504111e0403111d0302111c0201111b01111a70111a8040111a7f111ac855a0db3cc90411130403111203021111020111100110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb08a4d4a604b0048821041540012500ccb1f1acb3f18ce16cb0f14cb0758fa02cb1fcb1ff400cb07cbfff40002888ae2f400c901fb000811150807111407061113060511120504111104031110034f1d0b0950770e0c0a08c87f01ca00111611151114111311121111111055e0db3cc9ed54687203fc5b1115d33f30812915296eb39af8422a206ef2d080c7059170e2f2f41114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a10791068105710461035443012db3c708040706f00c8013082104154001401cb1fc910246d50436d03c8cf8580ca00894d70710164f82801db3c705920f90022f9005ad76501d76582020134c8cb17cb0fcb0fcbffcbff71f90400c87401cb0212ca07cbffc9d04e011e88c87001ca005a02ce810101cf00c94f0228ff008e88f4a413f4bcf2c80bed5320e303ed43d95056020271515301d7bf786f6a268690000c720fd20699feb9600c8b6c9fd2000f100e987e983fd00698fe98fe98ffa026983ea00e869fffa02690018081f081e881e081d881d081c881c081b881b081a881a360f470bfd20408080eb802c816880b6b82a3800298036a988b6b8716d9e365db61dc520016547a98547a98547a6953ba01d3bc7e7f6a268690000c720fd20699feb9600c8b6c9fd2000f100e987e983fd00698fe98fe98ffa026983ea00e869fffa02690018081f081e881e081d881d081c881c081b881b081a881a360f470bfd20408080eb802c816880b6b82a3800298036a988b6b8716d9e3672c5402c22b6eb353e097302c206ef2d080dec86f00016f8c6d6f8c2f8e22c821c10098802d01cb0701a301de019a7aa90ca630541220c000e63068a592cb07e4da11c9d0db3c8b52e6a736f6e8db3c6f2201c993216eb396016f2259ccc9e8312f02561102555500b620d74a21d7499720c20022c200b18e48036f22807f22cf31ab02a105ab025155b60820c2009a20aa0215d71803ce4014de596f025341a1c20099c8016f025044a1aa028e123133c20099d430d020d74a21d749927020e2e2e85f0301f83001d072d721d200d200fa4021103450666f04f86102f862ed44d0d200018e41fa40d33fd72c01916d93fa4001e201d30fd307fa00d31fd31fd31ff404d307d401d0d3fff404d20030103e103d103c103b103a1039103810371036103510346c1e8e17fa40810101d7005902d1016d7054700053006d53116d70e20f5703fe8e613e0c8020d7217021d749c21f9430d31f309131e2821041540011ba8e4110ac551970c87f01ca0055d050dece1bcb3f5009206e9430cf84809201cee217cb0f15cb075003fa02cb1fcb1fcb1ff400cb0701c8cbff12f40012ca00cdc9ed54e05f0de00dd70d1ff2e08221821041540001bae3022182105fcc3d14bae30258595c02d6355f0350565f05fa40d30fd307fa00d31fd307d3ff308200aa5af8422cc705f2f481393d096e19f2f45475117153bb8ea40e11100e10df104e109d108c107b103a491544861023db3c320d50cb1a10695e3416430595102c363930e210bd10ac1b106a1059104807054366666f01f8313504d33ffa40d72c01916d93fa4001e201f40431fa00f8416f2481318b56126eb3f2f48200c0805612206ef2d0805240c705f2f48139195616b3f2f443305230fa40fa0071d721fa00fa00306c6170f83a20aa00820afaf080a024c2009424a021a0de028200df8203be12f2f40e206ef2d08024f8230aa424c2005a02f28e577170544956c85520821005138d915004cb1f12cb3fcecec92510484513508810246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb000393366c21e2226eb394103d6c41e30d10bd10ac0b108a107910681057103644305b6f00e8f8276f10820afaf080a122c2009558a1500da192323de220c2008e5101206ef2d080737005c8018210d53276db58cb1fcb3fc941401510246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb009410235f03e20903f42182102fcb26a2ba8ee431d33f30f8427080407f514f5611c8552082108b7717355004cb1f12cb3f810101cf00cec91034413010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0010bd551ae021821041540071bae302216f5d6102fc31fa40d401d001fa0030f8416f2430328200aa5a015611c705f2f4702e6eb38e3f2e206ef2d0805250c705935612b39170e29922820afaf080a012be923170e28e1d5322d749c2009620d7498307bb9170e294d74ac000923070e292307fdede9131e2e30301c823cf16f82301cb1f21d74901cb0801cf1615f400c971705e5f01fa5b708042708810246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0010bd551ac87f01ca0055d050dece1bcb3f5009206e9430cf84809201cee217cb0f15cb075003fa02cb1fcb1fcb1ff400cb0701c8cbff12f40012ca00cdc9ed546403fe6f00c8013082104154000301cb1fc956100408552010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb007080427022c8018210d53276db58cb1fcb3fc910246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb08a8a60686900065bcf81044a821041540073bae3023020821041540010bae30220821041540015bae302821041540014ba626a6d6e03fa31fa40d307d3fffa00fa0030f8416f2430328200aa5a015613c705f2f426c3009323c3009170e2935336bd9170e2926c129131e2702f6eb38e2a2f206ef2d0805260c705935613b39170e29324c10a9170e29922820afaf080a012be923170e292307fde9131e2e3033520c300935303bd9170e29130e30d71706f00c863656701fc5f03708042708810246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0010bd551ac87f01ca0055d050dece1bcb3f5009206e9430cf84809201cee217cb0f15cb075003fa02cb1fcb1fcb1ff400cb0701c8cbff12f40012ca00cdc9ed5464002000000000617468617220726566756e64012e3322f82345400311100302111102561059db3c320f50e366001ec85003cf1612cb1fcbff5220f400c902fe013082104154000301cb1fc956100407552010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb007080427022c8018210d53276db58cb1fcb3fc910246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf818a6869001a58cf8680cf8480f400f400cf81008ee2f400c901fb0010bd551ac87f01ca0055d050dece1bcb3f5009206e9430cf84809201cee217cb0f15cb075003fa02cb1fcb1fcb1ff400cb0701c8cbff12f40012ca00cdc9ed5402fc30f8416f2410235f038200c0802b6eb39a2b206ef2d0805220c7059170e2f2f481386c0fb31ff2f47f7080402d7f1112547dcb547dba53cb5619c855a0db3cc92f0411120110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0010bd6b6c0048821041540011500ccb1f1acb3f18ce16cb0f14cb0758fa02cb1fcb1ff400cb07cbfff400007c551ac87f01ca0055d050dece1bcb3f5009206e9430cf84809201cee217cb0f15cb075003fa02cb1fcb1fcb1ff400cb0701c8cbff12f40012ca00cdc9ed5401f2303d8200aa5af8422cc705f2f470296eb38e5029206ef2d0807080427022c8018210d53276db58cb1fcb3fc910246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00de10bd10ac109b108a107910681057104610354430126f01fe8ef78200aa5af8422dc705f2f4815a9d2ef2f409206ef2d080708100a07022c8018210d53276db58cb1fcb3fc910246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0010ac109b6d0b108a10791068105710461035443012e05f0ef2c0826f0078c87f01ca0055d050dece1bcb3f5009206e9430cf84809201cee217cb0f15cb075003fa02cb1fcb1fcb1ff400cb0701c8cbff12f40012ca00cdc9ed540001100186cf16ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00c87f01ca00111611151114111311121111111055e0db3cc9ed547201f6011115011116ce1113c8ce01111301cd01111101cb1fc81110c8ce01111001cd500e206e9430cf84809201cee21ccb0f1acb0f18f4005006206e9430cf84809201cee214cb1f226eb39702c8cec958f40095327058ca00e2cb1f01206e9430cf84809201cee2cb1fca00c858fa0258fa0258fa0213f40013f4001373000ecb1f13f400cdcdd84d39a6');
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
    2547: { message: "a picture of your own costs its fee: style 1 with a picture, style 0 without" },
    2664: { message: "no such token" },
    3766: { message: "only the classes (bronze to legendary) are auctioned" },
    4643: { message: "limit of this kind reached for this wallet" },
    5268: { message: "auction not finished" },
    6032: { message: "closed" },
    6434: { message: "bad occasion" },
    9254: { message: "only a real item" },
    9457: { message: "send the fees" },
    10060: { message: "daily limit reached for this wallet" },
    10517: { message: "only the next edition" },
    12078: { message: "not revealed yet" },
    12332: { message: "mystery pool incomplete" },
    12683: { message: "not minted" },
    12950: { message: "bad token id" },
    13448: { message: "auction already exists" },
    13916: { message: "bad style" },
    14245: { message: "notice period not over" },
    14254: { message: "bad auction" },
    14444: { message: "upgrade already in progress" },
    14617: { message: "upgrade in progress" },
    14653: { message: "already minted" },
    15521: { message: "no live auction" },
    15525: { message: "already issued" },
    15981: { message: "direct kinds only" },
    16679: { message: "fee out of range" },
    17529: { message: "bad pool size" },
    20798: { message: "ticket sale is over" },
    20964: { message: "direct kinds are 0 normal, 1 silver, 2 gold" },
    21885: { message: "only admin" },
    22001: { message: "bad kind" },
    22100: { message: "minting closed" },
    22822: { message: "below what is already issued" },
    23197: { message: "no upgrade pending" },
    23696: { message: "already revealed" },
    23975: { message: "date already taken" },
    24217: { message: "a change costs at least a first picture" },
    24241: { message: "not open yet" },
    25177: { message: "wrong secret" },
    28276: { message: "sale is not open" },
    28433: { message: "payout not set" },
    29357: { message: "kind not set" },
    30320: { message: "all tickets sold" },
    30788: { message: "bad special" },
    30889: { message: "bad price bounds" },
    32956: { message: "set the prices before opening with Configure" },
    33195: { message: "id out of range" },
    34249: { message: "too early for the public reveal" },
    35069: { message: "every kind needs a supply cap" },
    36080: { message: "this token is inside the mystery boxes" },
    39512: { message: "token already in the pool" },
    39703: { message: "too early" },
    40897: { message: "already settled" },
    42803: { message: "this kind is sold out" },
    43610: { message: "only collection" },
    44480: { message: "a supply cap is required" },
    44990: { message: "bid too low" },
    46897: { message: "already open" },
    47192: { message: "date not in this season" },
    47518: { message: "not your open ticket" },
    47787: { message: "this date is inside the mystery boxes" },
    48010: { message: "send price + fees" },
    49171: { message: "configure normal, silver and gold first" },
    49280: { message: "not owner" },
    49724: { message: "bad cap" },
    50514: { message: "no open ticket" },
    50563: { message: "bad rates" },
    51432: { message: "this token is sold by auction" },
    52369: { message: "a cap can only be lowered" },
    52892: { message: "fee too high" },
    53050: { message: "nothing proposed" },
    53528: { message: "no next edition yet" },
    53752: { message: "this kind is not sold directly" },
    54334: { message: "no supply cap for this kind" },
    55815: { message: "already set" },
    57218: { message: "not enough value" },
    57326: { message: "position already loaded" },
    57676: { message: "mystery boxes not configured" },
    59420: { message: "bad pool entry" },
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
    "a picture of your own costs its fee: style 1 with a picture, style 0 without": 2547,
    "no such token": 2664,
    "only the classes (bronze to legendary) are auctioned": 3766,
    "limit of this kind reached for this wallet": 4643,
    "auction not finished": 5268,
    "closed": 6032,
    "bad occasion": 6434,
    "only a real item": 9254,
    "send the fees": 9457,
    "daily limit reached for this wallet": 10060,
    "only the next edition": 10517,
    "not revealed yet": 12078,
    "mystery pool incomplete": 12332,
    "not minted": 12683,
    "bad token id": 12950,
    "auction already exists": 13448,
    "bad style": 13916,
    "notice period not over": 14245,
    "bad auction": 14254,
    "upgrade already in progress": 14444,
    "upgrade in progress": 14617,
    "already minted": 14653,
    "no live auction": 15521,
    "already issued": 15525,
    "direct kinds only": 15981,
    "fee out of range": 16679,
    "bad pool size": 17529,
    "ticket sale is over": 20798,
    "direct kinds are 0 normal, 1 silver, 2 gold": 20964,
    "only admin": 21885,
    "bad kind": 22001,
    "minting closed": 22100,
    "below what is already issued": 22822,
    "no upgrade pending": 23197,
    "already revealed": 23696,
    "date already taken": 23975,
    "a change costs at least a first picture": 24217,
    "not open yet": 24241,
    "wrong secret": 25177,
    "sale is not open": 28276,
    "payout not set": 28433,
    "kind not set": 29357,
    "all tickets sold": 30320,
    "bad special": 30788,
    "bad price bounds": 30889,
    "set the prices before opening with Configure": 32956,
    "id out of range": 33195,
    "too early for the public reveal": 34249,
    "every kind needs a supply cap": 35069,
    "this token is inside the mystery boxes": 36080,
    "token already in the pool": 39512,
    "too early": 39703,
    "already settled": 40897,
    "this kind is sold out": 42803,
    "only collection": 43610,
    "a supply cap is required": 44480,
    "bid too low": 44990,
    "already open": 46897,
    "date not in this season": 47192,
    "not your open ticket": 47518,
    "this date is inside the mystery boxes": 47787,
    "send price + fees": 48010,
    "configure normal, silver and gold first": 49171,
    "not owner": 49280,
    "bad cap": 49724,
    "no open ticket": 50514,
    "bad rates": 50563,
    "this token is sold by auction": 51432,
    "a cap can only be lowered": 52369,
    "fee too high": 52892,
    "nothing proposed": 53050,
    "no next edition yet": 53528,
    "this kind is not sold directly": 53752,
    "no supply cap for this kind": 54334,
    "already set": 55815,
    "not enough value": 57218,
    "position already loaded": 57326,
    "mystery boxes not configured": 57676,
    "bad pool entry": 59420,
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
    {"name":"ItemInit","header":1096024065,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"MintItem","header":1096024066,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"remit","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"Proceeds","header":1096024067,"fields":[]},
    {"name":"MintOk","header":1096024069,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"UpgradeStart","header":1096024080,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"UpgradeRequest","header":1096024081,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"hands","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"mediaLog","type":{"kind":"simple","type":"cell","optional":true}}]},
    {"name":"UpgradeAccept","header":1096024082,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"hands","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"mediaLog","type":{"kind":"simple","type":"cell","optional":true}}]},
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
    {"name":"ProposeCode","header":1096024104,"fields":[{"name":"code","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"ApplyCode","header":1096024105,"fields":[]},
    {"name":"CancelCode","header":1096024106,"fields":[]},
    {"name":"EngraveReq","header":1096024176,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"text","type":{"kind":"simple","type":"string","optional":false}}]},
    {"name":"EngraveFrom","header":1096024177,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"text","type":{"kind":"simple","type":"string","optional":false}},{"name":"fee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"SetMediaReq","header":1096024178,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"SetMediaFrom","header":1096024179,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"firstFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"changeFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"SetItemFees","header":1096024180,"fields":[{"name":"engraveFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mediaFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"changeFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"ItemFees","header":null,"fields":[{"name":"engrave","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"media","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"change","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"Ymd","header":null,"fields":[{"name":"y","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"m","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"d","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"AtharItem$Data","header":null,"fields":[{"name":"collection","type":{"kind":"simple","type":"address","optional":false}},{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"owner","type":{"kind":"simple","type":"address","optional":true}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"lastTransferAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"hands","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"mediaLog","type":{"kind":"simple","type":"cell","optional":true}},{"name":"locked","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"AtharState","header":null,"fields":[{"name":"season","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"tier","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"paid","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"mintedAt","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"lastTransferAt","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hands","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}},{"name":"locked","type":{"kind":"simple","type":"bool","optional":false}},{"name":"occasion","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"mediaRef","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"mediaLog","type":{"kind":"simple","type":"cell","optional":true}}]},
    {"name":"CodeProposal","header":null,"fields":[{"name":"pending","type":{"kind":"simple","type":"bool","optional":false}},{"name":"applicableAt","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"AtharCollection$Data","header":null,"fields":[{"name":"admin","type":{"kind":"simple","type":"address","optional":false}},{"name":"collectionUri","type":{"kind":"simple","type":"string","optional":false}},{"name":"delaySec","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"baseUri","type":{"kind":"simple","type":"string","optional":false}},{"name":"payout","type":{"kind":"simple","type":"address","optional":true}},{"name":"royaltyNum","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"royaltyDen","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"minters","type":{"kind":"dict","key":"address","value":"uint","valueFormat":32}},{"name":"pendingPayout","type":{"kind":"simple","type":"address","optional":true}},{"name":"pendingPayoutAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"pendingBaseUri","type":{"kind":"simple","type":"string","optional":true}},{"name":"pendingBaseUriAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"successor","type":{"kind":"simple","type":"address","optional":true}},{"name":"minted","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"firstMinterDone","type":{"kind":"simple","type":"bool","optional":false}},{"name":"engraveFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mediaFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"changeFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"issued","type":{"kind":"dict","key":"uint","keyFormat":32,"value":"bool"}},{"name":"pendingCode","type":{"kind":"simple","type":"cell","optional":true}},{"name":"pendingCodeAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"ext","type":{"kind":"simple","type":"cell","optional":true}}]},
    {"name":"TierState","header":null,"fields":[{"name":"price","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"lastDecayAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"sold","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
    {"name":"WalletCount","header":null,"fields":[{"name":"day","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"count","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"k0","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"k1","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"k2","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"PendingMint","header":null,"fields":[{"name":"buyer","type":{"kind":"simple","type":"address","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"kind","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"ticket","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"Ticket","header":null,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"price","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"claimed","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"Auction","header":null,"fields":[{"name":"started","type":{"kind":"simple","type":"bool","optional":false}},{"name":"endAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"reserve","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"highBid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"highBidder","type":{"kind":"simple","type":"address","optional":true}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"Configure","header":1096024128,"fields":[{"name":"kind","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"startPrice","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"maxSupply","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"specialFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"photoFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"walletMax","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"AddSpecial","header":1096024129,"fields":[{"name":"items","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":8}}]},
    {"name":"Open","header":1096024130,"fields":[{"name":"startAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"walletDailyCap","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"SetPaused","header":1096024131,"fields":[{"name":"paused","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"Buy","header":1096024132,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"recipient","type":{"kind":"simple","type":"address","optional":true}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"style","type":{"kind":"simple","type":"uint","optional":false,"format":8}}]},
    {"name":"StartAuction","header":1096024133,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"reserve","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"duration","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"SetKindFees","header":1096024137,"fields":[{"name":"kind","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"photoFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"specialFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"SetCap","header":1096024138,"fields":[{"name":"kind","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
    {"name":"Bid","header":1096024134,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Reprice","header":1096024165,"fields":[{"name":"kind","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"Settle","header":1096024135,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Sweep","header":1096024136,"fields":[]},
    {"name":"LoadPool","header":1096024144,"fields":[{"name":"items","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":32}}]},
    {"name":"SetMystery","header":1096024145,"fields":[{"name":"commitHash","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"revealAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"startPrice","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"poolExpected","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"BuyTicket","header":1096024146,"fields":[{"name":"recipient","type":{"kind":"simple","type":"address","optional":true}}]},
    {"name":"Reveal","header":1096024147,"fields":[{"name":"secret","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"ClaimTicket","header":1096024148,"fields":[{"name":"ticket","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"RevealPublic","header":1096024150,"fields":[]},
    {"name":"AdminMint","header":1096024151,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"recipient","type":{"kind":"simple","type":"address","optional":true}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"TransferTicket","header":1096024149,"fields":[{"name":"ticket","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"AtharMinter$Data","header":null,"fields":[{"name":"collection","type":{"kind":"simple","type":"address","optional":false}},{"name":"admin","type":{"kind":"simple","type":"address","optional":false}},{"name":"seasonId","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"rangeStart","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"rangeEnd","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"tiers","type":{"kind":"dict","key":"uint","keyFormat":8,"value":"TierState","valueFormat":"ref"}},{"name":"special","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":8}},{"name":"sold","type":{"kind":"dict","key":"uint","keyFormat":32,"value":"bool"}},{"name":"pending","type":{"kind":"dict","key":"uint","keyFormat":32,"value":"PendingMint","valueFormat":"ref"}},{"name":"reserved","type":{"kind":"dict","key":"uint","keyFormat":32,"value":"bool"}},{"name":"pool","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":32}},{"name":"tickets","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"Ticket","valueFormat":"ref"}},{"name":"poolSize","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"poolExpected","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"poolLoaded","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"ticketsSold","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"commitHash","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"revealAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"revealed","type":{"kind":"simple","type":"bool","optional":false}},{"name":"permA","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"permB","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"auctions","type":{"kind":"dict","key":"uint","keyFormat":32,"value":"Auction","valueFormat":"ref"}},{"name":"auctionIds","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":32}},{"name":"auctionCount","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"wallets","type":{"kind":"dict","key":"address","value":"WalletCount","valueFormat":"ref"}},{"name":"status","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"startAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"walletDailyCap","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"soldCount","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"caps","type":{"kind":"dict","key":"uint","keyFormat":8,"value":"uint","valueFormat":32}},{"name":"issuedBy","type":{"kind":"dict","key":"uint","keyFormat":8,"value":"uint","valueFormat":32}},{"name":"photoFees","type":{"kind":"dict","key":"uint","keyFormat":8,"value":"uint","valueFormat":"coins"}},{"name":"specialFees","type":{"kind":"dict","key":"uint","keyFormat":8,"value":"uint","valueFormat":"coins"}},{"name":"walletMax","type":{"kind":"dict","key":"uint","keyFormat":8,"value":"uint","valueFormat":16}},{"name":"lockedBids","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"ticketsOpen","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"DateView","header":null,"fields":[{"name":"taken","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"auction","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"reserved","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"p0","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"p1","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"p2","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"special","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"KindInfo","header":null,"fields":[{"name":"cap","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"issued","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"photo","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"special","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"walletMax","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"WalletInfo","header":null,"fields":[{"name":"today","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"k0","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"k1","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"k2","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"MysteryInfo","header":null,"fields":[{"name":"poolSize","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"loaded","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"ticketsSold","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"revealed","type":{"kind":"simple","type":"bool","optional":false}},{"name":"revealAt","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"commitHash","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"a","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"b","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
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
    "ProposeCode": 1096024104,
    "ApplyCode": 1096024105,
    "CancelCode": 1096024106,
    "EngraveReq": 1096024176,
    "EngraveFrom": 1096024177,
    "SetMediaReq": 1096024178,
    "SetMediaFrom": 1096024179,
    "SetItemFees": 1096024180,
    "Configure": 1096024128,
    "AddSpecial": 1096024129,
    "Open": 1096024130,
    "SetPaused": 1096024131,
    "Buy": 1096024132,
    "StartAuction": 1096024133,
    "SetKindFees": 1096024137,
    "SetCap": 1096024138,
    "Bid": 1096024134,
    "Reprice": 1096024165,
    "Settle": 1096024135,
    "Sweep": 1096024136,
    "LoadPool": 1096024144,
    "SetMystery": 1096024145,
    "BuyTicket": 1096024146,
    "Reveal": 1096024147,
    "ClaimTicket": 1096024148,
    "RevealPublic": 1096024150,
    "AdminMint": 1096024151,
    "TransferTicket": 1096024149,
}

const AtharCollection_getters: ABIGetter[] = [
    {"name":"get_collection_data","methodId":102491,"arguments":[],"returnType":{"kind":"simple","type":"CollectionData","optional":false}},
    {"name":"get_nft_address_by_index","methodId":92067,"arguments":[{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"address","optional":false}},
    {"name":"get_nft_content","methodId":68445,"arguments":[{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"individualContent","type":{"kind":"simple","type":"cell","optional":false}}],"returnType":{"kind":"simple","type":"cell","optional":false}},
    {"name":"royalty_params","methodId":85719,"arguments":[],"returnType":{"kind":"simple","type":"RoyaltyParams","optional":false}},
    {"name":"item_fees","methodId":105038,"arguments":[],"returnType":{"kind":"simple","type":"ItemFees","optional":false}},
    {"name":"payout_address","methodId":101806,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":true}},
    {"name":"successor_address","methodId":122087,"arguments":[],"returnType":{"kind":"simple","type":"address","optional":true}},
    {"name":"minter_active_at","methodId":109726,"arguments":[{"name":"minter","type":{"kind":"simple","type":"address","optional":false}}],"returnType":{"kind":"simple","type":"int","optional":true,"format":257}},
    {"name":"total_minted","methodId":128637,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"code_proposal","methodId":127140,"arguments":[],"returnType":{"kind":"simple","type":"CodeProposal","optional":false}},
    {"name":"pending_code_hash","methodId":67336,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":true,"format":257}},
]

export const AtharCollection_getterMapping: { [key: string]: string } = {
    'get_collection_data': 'getGetCollectionData',
    'get_nft_address_by_index': 'getGetNftAddressByIndex',
    'get_nft_content': 'getGetNftContent',
    'royalty_params': 'getRoyaltyParams',
    'item_fees': 'getItemFees',
    'payout_address': 'getPayoutAddress',
    'successor_address': 'getSuccessorAddress',
    'minter_active_at': 'getMinterActiveAt',
    'total_minted': 'getTotalMinted',
    'code_proposal': 'getCodeProposal',
    'pending_code_hash': 'getPendingCodeHash',
}

const AtharCollection_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"empty"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ProposePayout"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ApplyPayout"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ProposeBaseUri"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ApplyBaseUri"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ProposeCode"}},
    {"receiver":"internal","message":{"kind":"typed","type":"CancelCode"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ApplyCode"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ProposeMinter"}},
    {"receiver":"internal","message":{"kind":"typed","type":"RemoveMinter"}},
    {"receiver":"internal","message":{"kind":"typed","type":"MintItem"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetItemFees"}},
    {"receiver":"internal","message":{"kind":"typed","type":"EngraveReq"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetMediaReq"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Proceeds"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Withdraw"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetSuccessor"}},
    {"receiver":"internal","message":{"kind":"typed","type":"UpgradeRequest"}},
    {"receiver":"internal","message":{"kind":"typed","type":"UpgradeDone"}},
]

export const MAX_INDEX = 36524n;
export const ID_SHIFT = 65536n;
export const MAX_KIND = 7n;
export const MAX_ID = 495276n;
export const KIND_NORMAL = 0n;
export const KIND_SILVER = 1n;
export const KIND_GOLD = 2n;
export const KIND_BRONZE = 3n;
export const KIND_LEGENDARY = 7n;
export const KEY_TICKETS = 15n;
export const TIER_COMMON = 0n;
export const TIER_RARE = 1n;
export const TIER_MYTHIC = 2n;
export const ITEM_FUND = 30000000n;
export const MINTER_GAS = 20000000n;
export const OK_VALUE = 10000000n;
export const COLL_GAS = 20000000n;
export const MINT_FEES = 60000000n;
export const BUY_FEES = 80000000n;
export const ENGRAVE_FEE = 100000000n;
export const MEDIA_FEE = 100000000n;
export const MIN_STORAGE = 50000000n;
export const DAY = 86400n;
export const REQ_GAS = 60000000n;

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
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: null | ProposePayout | ApplyPayout | ProposeBaseUri | ApplyBaseUri | ProposeCode | CancelCode | ApplyCode | ProposeMinter | RemoveMinter | MintItem | SetItemFees | EngraveReq | SetMediaReq | Proceeds | Withdraw | SetSuccessor | UpgradeRequest | UpgradeDone) {
        
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
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ProposeCode') {
            body = beginCell().store(storeProposeCode(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'CancelCode') {
            body = beginCell().store(storeCancelCode(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ApplyCode') {
            body = beginCell().store(storeApplyCode(message)).endCell();
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
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetItemFees') {
            body = beginCell().store(storeSetItemFees(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'EngraveReq') {
            body = beginCell().store(storeEngraveReq(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetMediaReq') {
            body = beginCell().store(storeSetMediaReq(message)).endCell();
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
    
    async getItemFees(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('item_fees', builder.build())).stack;
        const result = loadGetterTupleItemFees(source);
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
    
    async getCodeProposal(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('code_proposal', builder.build())).stack;
        const result = loadGetterTupleCodeProposal(source);
        return result;
    }
    
    async getPendingCodeHash(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('pending_code_hash', builder.build())).stack;
        const result = source.readBigNumberOpt();
        return result;
    }
    
}