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

export type SetMedia = {
    $$type: 'SetMedia';
    occasion: bigint;
    mediaRef: bigint;
}

export function storeSetMedia(src: SetMedia) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024071, 32);
        b_0.storeUint(src.occasion, 8);
        b_0.storeUint(src.mediaRef, 256);
    };
}

export function loadSetMedia(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024071) { throw Error('Invalid prefix'); }
    const _occasion = sc_0.loadUintBig(8);
    const _mediaRef = sc_0.loadUintBig(256);
    return { $$type: 'SetMedia' as const, occasion: _occasion, mediaRef: _mediaRef };
}

export function loadTupleSetMedia(source: TupleReader) {
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'SetMedia' as const, occasion: _occasion, mediaRef: _mediaRef };
}

export function loadGetterTupleSetMedia(source: TupleReader) {
    const _occasion = source.readBigNumber();
    const _mediaRef = source.readBigNumber();
    return { $$type: 'SetMedia' as const, occasion: _occasion, mediaRef: _mediaRef };
}

export function storeTupleSetMedia(source: SetMedia) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.occasion);
    builder.writeNumber(source.mediaRef);
    return builder.build();
}

export function dictValueParserSetMedia(): DictionaryValue<SetMedia> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetMedia(src)).endCell());
        },
        parse: (src) => {
            return loadSetMedia(src.loadRef().beginParse());
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
    return { $$type: 'AtharCollection$Data' as const, admin: _admin, collectionUri: _collectionUri, delaySec: _delaySec, baseUri: _baseUri, payout: _payout, royaltyNum: _royaltyNum, royaltyDen: _royaltyDen, minters: _minters, pendingPayout: _pendingPayout, pendingPayoutAt: _pendingPayoutAt, pendingBaseUri: _pendingBaseUri, pendingBaseUriAt: _pendingBaseUriAt, successor: _successor, minted: _minted, firstMinterDone: _firstMinterDone };
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
    const _firstMinterDone = source.readBoolean();
    return { $$type: 'AtharCollection$Data' as const, admin: _admin, collectionUri: _collectionUri, delaySec: _delaySec, baseUri: _baseUri, payout: _payout, royaltyNum: _royaltyNum, royaltyDen: _royaltyDen, minters: _minters, pendingPayout: _pendingPayout, pendingPayoutAt: _pendingPayoutAt, pendingBaseUri: _pendingBaseUri, pendingBaseUriAt: _pendingBaseUriAt, successor: _successor, minted: _minted, firstMinterDone: _firstMinterDone };
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
    return { $$type: 'AtharCollection$Data' as const, admin: _admin, collectionUri: _collectionUri, delaySec: _delaySec, baseUri: _baseUri, payout: _payout, royaltyNum: _royaltyNum, royaltyDen: _royaltyDen, minters: _minters, pendingPayout: _pendingPayout, pendingPayoutAt: _pendingPayoutAt, pendingBaseUri: _pendingBaseUri, pendingBaseUriAt: _pendingBaseUriAt, successor: _successor, minted: _minted, firstMinterDone: _firstMinterDone };
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

export type SetFees = {
    $$type: 'SetFees';
    photoFee: bigint;
    silverFee: bigint;
}

export function storeSetFees(src: SetFees) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024137, 32);
        b_0.storeCoins(src.photoFee);
        b_0.storeCoins(src.silverFee);
    };
}

export function loadSetFees(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024137) { throw Error('Invalid prefix'); }
    const _photoFee = sc_0.loadCoins();
    const _silverFee = sc_0.loadCoins();
    return { $$type: 'SetFees' as const, photoFee: _photoFee, silverFee: _silverFee };
}

export function loadTupleSetFees(source: TupleReader) {
    const _photoFee = source.readBigNumber();
    const _silverFee = source.readBigNumber();
    return { $$type: 'SetFees' as const, photoFee: _photoFee, silverFee: _silverFee };
}

export function loadGetterTupleSetFees(source: TupleReader) {
    const _photoFee = source.readBigNumber();
    const _silverFee = source.readBigNumber();
    return { $$type: 'SetFees' as const, photoFee: _photoFee, silverFee: _silverFee };
}

export function storeTupleSetFees(source: SetFees) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.photoFee);
    builder.writeNumber(source.silverFee);
    return builder.build();
}

export function dictValueParserSetFees(): DictionaryValue<SetFees> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetFees(src)).endCell());
        },
        parse: (src) => {
            return loadSetFees(src.loadRef().beginParse());
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

export type LoadPool = {
    $$type: 'LoadPool';
    items: Dictionary<number, number>;
}

export function storeLoadPool(src: LoadPool) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024144, 32);
        b_0.storeDict(src.items, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16));
    };
}

export function loadLoadPool(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024144) { throw Error('Invalid prefix'); }
    const _items = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16), sc_0);
    return { $$type: 'LoadPool' as const, items: _items };
}

export function loadTupleLoadPool(source: TupleReader) {
    const _items = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16), source.readCellOpt());
    return { $$type: 'LoadPool' as const, items: _items };
}

export function loadGetterTupleLoadPool(source: TupleReader) {
    const _items = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16), source.readCellOpt());
    return { $$type: 'LoadPool' as const, items: _items };
}

export function storeTupleLoadPool(source: LoadPool) {
    const builder = new TupleBuilder();
    builder.writeCell(source.items.size > 0 ? beginCell().storeDictDirect(source.items, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16)).endCell() : null);
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
    wallets: Dictionary<Address, WalletCount>;
    status: bigint;
    startAt: bigint;
    walletDailyCap: bigint;
    soldCount: bigint;
    photoFee: bigint;
    silverFee: bigint;
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
        b_1.storeDict(src.sold, Dictionary.Keys.Uint(16), Dictionary.Values.Bool());
        b_1.storeDict(src.pending, Dictionary.Keys.Uint(16), dictValueParserPendingMint());
        b_1.storeDict(src.reserved, Dictionary.Keys.Uint(16), Dictionary.Values.Bool());
        const b_2 = new Builder();
        b_2.storeDict(src.pool, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16));
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
        b_2.storeDict(src.auctions, Dictionary.Keys.Uint(16), dictValueParserAuction());
        b_2.storeDict(src.wallets, Dictionary.Keys.Address(), dictValueParserWalletCount());
        b_2.storeUint(src.status, 8);
        b_2.storeUint(src.startAt, 32);
        b_2.storeUint(src.walletDailyCap, 16);
        b_2.storeUint(src.soldCount, 32);
        b_2.storeCoins(src.photoFee);
        b_2.storeCoins(src.silverFee);
        b_2.storeCoins(src.lockedBids);
        b_2.storeUint(src.ticketsOpen, 16);
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
    const _sold = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Bool(), sc_1);
    const _pending = Dictionary.load(Dictionary.Keys.Uint(16), dictValueParserPendingMint(), sc_1);
    const _reserved = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Bool(), sc_1);
    const sc_2 = sc_1.loadRef().beginParse();
    const _pool = Dictionary.load(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16), sc_2);
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
    const _auctions = Dictionary.load(Dictionary.Keys.Uint(16), dictValueParserAuction(), sc_2);
    const _wallets = Dictionary.load(Dictionary.Keys.Address(), dictValueParserWalletCount(), sc_2);
    const _status = sc_2.loadUintBig(8);
    const _startAt = sc_2.loadUintBig(32);
    const _walletDailyCap = sc_2.loadUintBig(16);
    const _soldCount = sc_2.loadUintBig(32);
    const _photoFee = sc_2.loadCoins();
    const _silverFee = sc_2.loadCoins();
    const _lockedBids = sc_2.loadCoins();
    const _ticketsOpen = sc_2.loadUintBig(16);
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, reserved: _reserved, pool: _pool, tickets: _tickets, poolSize: _poolSize, poolExpected: _poolExpected, poolLoaded: _poolLoaded, ticketsSold: _ticketsSold, commitHash: _commitHash, revealAt: _revealAt, revealed: _revealed, permA: _permA, permB: _permB, auctions: _auctions, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount, photoFee: _photoFee, silverFee: _silverFee, lockedBids: _lockedBids, ticketsOpen: _ticketsOpen };
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
    const _reserved = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Bool(), source.readCellOpt());
    const _pool = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16), source.readCellOpt());
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
    const _auctions = Dictionary.loadDirect(Dictionary.Keys.Uint(16), dictValueParserAuction(), source.readCellOpt());
    const _wallets = Dictionary.loadDirect(Dictionary.Keys.Address(), dictValueParserWalletCount(), source.readCellOpt());
    const _status = source.readBigNumber();
    const _startAt = source.readBigNumber();
    const _walletDailyCap = source.readBigNumber();
    const _soldCount = source.readBigNumber();
    const _photoFee = source.readBigNumber();
    source = source.readTuple();
    const _silverFee = source.readBigNumber();
    const _lockedBids = source.readBigNumber();
    const _ticketsOpen = source.readBigNumber();
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, reserved: _reserved, pool: _pool, tickets: _tickets, poolSize: _poolSize, poolExpected: _poolExpected, poolLoaded: _poolLoaded, ticketsSold: _ticketsSold, commitHash: _commitHash, revealAt: _revealAt, revealed: _revealed, permA: _permA, permB: _permB, auctions: _auctions, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount, photoFee: _photoFee, silverFee: _silverFee, lockedBids: _lockedBids, ticketsOpen: _ticketsOpen };
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
    const _reserved = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Bool(), source.readCellOpt());
    const _pool = Dictionary.loadDirect(Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16), source.readCellOpt());
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
    const _auctions = Dictionary.loadDirect(Dictionary.Keys.Uint(16), dictValueParserAuction(), source.readCellOpt());
    const _wallets = Dictionary.loadDirect(Dictionary.Keys.Address(), dictValueParserWalletCount(), source.readCellOpt());
    const _status = source.readBigNumber();
    const _startAt = source.readBigNumber();
    const _walletDailyCap = source.readBigNumber();
    const _soldCount = source.readBigNumber();
    const _photoFee = source.readBigNumber();
    const _silverFee = source.readBigNumber();
    const _lockedBids = source.readBigNumber();
    const _ticketsOpen = source.readBigNumber();
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, reserved: _reserved, pool: _pool, tickets: _tickets, poolSize: _poolSize, poolExpected: _poolExpected, poolLoaded: _poolLoaded, ticketsSold: _ticketsSold, commitHash: _commitHash, revealAt: _revealAt, revealed: _revealed, permA: _permA, permB: _permB, auctions: _auctions, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount, photoFee: _photoFee, silverFee: _silverFee, lockedBids: _lockedBids, ticketsOpen: _ticketsOpen };
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
    builder.writeCell(source.reserved.size > 0 ? beginCell().storeDictDirect(source.reserved, Dictionary.Keys.Uint(16), Dictionary.Values.Bool()).endCell() : null);
    builder.writeCell(source.pool.size > 0 ? beginCell().storeDictDirect(source.pool, Dictionary.Keys.Uint(16), Dictionary.Values.Uint(16)).endCell() : null);
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
    builder.writeCell(source.auctions.size > 0 ? beginCell().storeDictDirect(source.auctions, Dictionary.Keys.Uint(16), dictValueParserAuction()).endCell() : null);
    builder.writeCell(source.wallets.size > 0 ? beginCell().storeDictDirect(source.wallets, Dictionary.Keys.Address(), dictValueParserWalletCount()).endCell() : null);
    builder.writeNumber(source.status);
    builder.writeNumber(source.startAt);
    builder.writeNumber(source.walletDailyCap);
    builder.writeNumber(source.soldCount);
    builder.writeNumber(source.photoFee);
    builder.writeNumber(source.silverFee);
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

export type FeeInfo = {
    $$type: 'FeeInfo';
    photo: bigint;
    silver: bigint;
}

export function storeFeeInfo(src: FeeInfo) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.photo, 257);
        b_0.storeInt(src.silver, 257);
    };
}

export function loadFeeInfo(slice: Slice) {
    const sc_0 = slice;
    const _photo = sc_0.loadIntBig(257);
    const _silver = sc_0.loadIntBig(257);
    return { $$type: 'FeeInfo' as const, photo: _photo, silver: _silver };
}

export function loadTupleFeeInfo(source: TupleReader) {
    const _photo = source.readBigNumber();
    const _silver = source.readBigNumber();
    return { $$type: 'FeeInfo' as const, photo: _photo, silver: _silver };
}

export function loadGetterTupleFeeInfo(source: TupleReader) {
    const _photo = source.readBigNumber();
    const _silver = source.readBigNumber();
    return { $$type: 'FeeInfo' as const, photo: _photo, silver: _silver };
}

export function storeTupleFeeInfo(source: FeeInfo) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.photo);
    builder.writeNumber(source.silver);
    return builder.build();
}

export function dictValueParserFeeInfo(): DictionaryValue<FeeInfo> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeFeeInfo(src)).endCell());
        },
        parse: (src) => {
            return loadFeeInfo(src.loadRef().beginParse());
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

 type AtharMinter_init_args = {
    $$type: 'AtharMinter_init_args';
    collection: Address;
    admin: Address;
    seasonId: bigint;
    rangeStart: bigint;
    rangeEnd: bigint;
}

function initAtharMinter_init_args(src: AtharMinter_init_args) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.collection);
        b_0.storeAddress(src.admin);
        b_0.storeInt(src.seasonId, 257);
        const b_1 = new Builder();
        b_1.storeInt(src.rangeStart, 257);
        b_1.storeInt(src.rangeEnd, 257);
        b_0.storeRef(b_1.endCell());
    };
}

async function AtharMinter_init(collection: Address, admin: Address, seasonId: bigint, rangeStart: bigint, rangeEnd: bigint) {
    const __code = Cell.fromHex('b5ee9c7241029f010032a800022cff008e88f4a413f4bcf2c80bed53208e8130e1ed43d9012c02027102130201200311020120040e020148050802fbac2476a268690000c71dfd207d20408080eb806a00e8408080eb80408080eb801808128812081182e8aa81b6b6b6b6b6b6b6b82a3800298038389136b6aa39112a380029807186888f088f888f088e888f088e888e088e888e088d888e088d888d088d888d088c888d088c888c088c888c088b888c088b888b088b888b402d0601641115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f6cf107002c801020561750334133f40e6fa19401d70130925b6de2020120090b029eaa87ed44d0d200018e3bfa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d7054700053007071226d6d5472225470005300e30ddb3c57105f0f6cf12d0a00022402faa9f3ed44d0d200018e3bfa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d7054700053007071226d6d5472225470005300e30d111e111f111e111d111e111d111c111d111c111b111c111b111a111b111a1119111a11191118111911181117111811171116111711162d0c01901115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f6cf1206e92306d99206ef2d0806f266f06e2206e92306dde0d006280102b0259f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e202fbb682fda89a1a400031c77f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dadaa8e444a8e000a601c61a223c223e223c223a223c223a2238223a2238223622382236223422362234223222342232223022322230222e2230222e222c222e222d02d0f01641115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f6cf110005a2db3917f945613c000e292306de02c801002a82ca05614a90821561755204133f40e6fa19401d70130925b6de202a3bb4fded44d0d200018e3bfa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d7054700053007071226d6d5472225470005300e30ddb3c6c886c886c886c7882d12001e5612561156112f56115613561156110201201421020120151b0201201618029fb342bb5134348000638efe903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c0014c01c1c489b5b551c88951c0014c038c376cf15c417c3db3c602d1700022702fbb103bb5134348000638efe903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c0014c01c1c489b5b551c88951c0014c038c344478447c4478447444784474447044744470446c4470446c4468446c4468446444684464446044644460445c4460445c4458445c445a02d1901641115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f6cf11a00865618801022714133f40e6fa19401d70030925b6de26eb392307f8e26801056180259f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26eb3e20201201c1f02fbb0903b5134348000638efe903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c0014c01c1c489b5b551c88951c0014c038c344478447c4478447444784474447044744470446c4470446c4468446c4468446444684464446044644460445c4460445c4458445c445a02d1d01641115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f6cf11e0104db3c9402a7b13efb5134348000638efe903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c0014c01c1c489b5b551c88951c0014c038c376cf15c495c417c3d43bd7c3a02d2000025d0201482229020162232602f9a537da89a1a400031c77f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dadaa8e444a8e000a601c61a223c223e223c223a223c223a2238223a2238223622382236223422362234223222342232223022322230222e2230222e222c222e222d2d2401641115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f6cf1250104db3c7402f9a647da89a1a400031c77f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dadaa8e444a8e000a601c61a223c223e223c223a223c223a2238223a2238223622382236223422362234223222342232223022322230222e2230222e222c222e222d2d2701901115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f6cf1206e92306d99206ef2d0806f236f03e2206e92306dde280044801056150259f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e202fbb146fb5134348000638efe903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c0014c01c1c489b5b551c88951c0014c038c344478447c4478447444784474447044744470446c4470446c4468446c4468446444684464446044644460445c4460445c4458445c445a02d2a01641115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f6cf12b017278561b0259f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206e923070e0206ef2d0806f27db3c8004f601d072d721d200d200fa4021103450666f04f86102f862ed44d0d200018e3bfa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d7054700053007071226d6d5472225470005300e30d1120e30270561fd74920c21f9731111fd31f1120de21821041540040bae3022d2f383b01f4fa40fa40d30fd33fd33ff404d401d0f404f404f404d430d0f404f404f404d30fd30fd30fd30fd3ffd31fd200d31fd31fd430d0f404f404d307d31fd30fd31ffa00fa00fa00d30f301119111f11191119111e11191119111d11191119111c11191119111b11191119111a1119571f111d111e111d111c111d111c2e009c111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550e0140111e8020d7217021d749c21f9430d31f01de821041540002bae3025f0f5f0f5b3004fed33f0131561580102259f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e2206ee30280106dc8216e925b6d8e1701206ef2d0806f24550355305034ce01fa02cb07cb0fc9e2021118025230206e953059f45b30944133f417e25616206ef2d0806f24135f03c001e30f111c111e111c111b111d111b3132343701b65b111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e551ddb3c9c01fe57162880102259f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e2206ef2d0806f26357f04431366060504431380105026c855505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc9103b41b0206e953059f45b30944133f417e201111e0108330010a0821008f0d180a002e6315615206ef2d0806f24135f03c0028eda5615206ef2d0806f245f031116206ef2d0806f2410235f037370880411190410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001111111ee30d111e1111111d3536002000000000617468617220726566756e6400d280105616206ef2d0806f246c3156145959f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e2206ef2d0806f233080101118206ef2d0806f246c315970c855205023ce01fa02ca00c90311140302111702206e953059f45b30944133f417e2111ea401ca111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a10791068105710461035440302db3c9c01d25b111ed307fa00fa00fa00d30fd30f3081557df8425623c705f2f48200b7312cc000f2f425c000917f9325c001e2f2e6b28178a924c200935345bb9170e2935353bb9170e2f2f48200c583228107d0bb9521811388bb9170e2f2f478702010671057104710371027c83901fc55605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc903111a0312206e953059f45b30944133f417e2111c111e111c111b111d111b111a111c111a1119111b11191118111a111811191116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df3a013210ce10bd10ac109b108a10791068105710461035440302db3c9c044c21821041540049bae30221821041540041bae30221821041540042bae30221821041540043ba3c3d3f4401f410245f04111cfa00fa003081557df842561dc705f2f48200ce9c22821077359400bb9821821077359400bb9170e2f2f48126145312bef2f4111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411127802f45b111ef4043081557df842561ec705f2f48200b73127c000f2f42080107859f4866fa520965023d7013058966c216d326d01e2908ae85f03111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411123e7800b481784422c2ff962282008eacbb9170e29321c2ff9170e29321c1039170e2f2f401111901801001561a0178216e955b59f45b3098c801cf014133f443e280102202111a784133f47c6fa520965023d7013058966c216d326d01e202e85b3434111cd31fd30f3081557df842561dc705f2f48200b73106c00016f2f48200dd0a5617787059f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb39170e30df2f481302c2e5611ba9353efba9170e2f2f471215618787059f40f6fa192306ddf404100585617787159f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb301ce206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f27312810465e32157807705027c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc903111b03206e953059f45b30944133f417e27854613159f40f6fa192306ddf4201fa206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f273178280706050443a3c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc910231024206e953059f45b30944133f417e2111c111e111c111b111d111b111a111c111a1119111b11191118111a111811191116111811164301841115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a1079106817446301db3c9c043ce30221821041540044bae30221821041540005bae30221821041540045ba4547545601fc5b111ed2003081557df842561ec705f2f4815eb107c30017f2f40591729171e2111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac460124109b108a107910680710461035440302db3c9c01fa5b111ed33fd72c01916d93fa4001e201d307d3ffd30730f8416f243032111d1123111d111c1122111c111b1121111b111a1120111a1119111f11191118111e11181117112311171116112211161115112111151114112011141113111f11131112111e11121111112311111110112211100f11210f0e11200e0d111f0d4804fc0c111e0c0b11230b0a11220a091121090811200807111f0706111e060511230504112204031121030211200201111f011124816e741126db3c01112701f2f48200b858561f82008eacbb8e861126561fdb3c93112670e201112701f2f4815da7561780105621714133f40e6fa19401d70030925b6de26e9170e30df2f4287d74494a004c56168010562159f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26e01f88010562059f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e26ef2e6498200baab561580105621714133f40e6fa19401d70030925b6de26ef2f4111d111e111d111c111d111c111b111c111b111a111b111a1119111a11191118111911181117111811174b02f21116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550e11255625db3c815fb921c3028e17561a80105629784133f40e6fa19401d70130925b6de26e9170e2f2f481365c5622c103f2f48119225624c10af2f4561a782259f40f6fa192306ddf944c01fe206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f275436545475432b1125112c11251124112b11241123112a1123112211291122112111281121112011271120111f1126111f111e112c111e111d112b111d111c112a111c111b1129111b111a1128111a1119112711191118112611184d02fe1117112c11171116112b11161115112a11151114112911141113112811131112112711121111112611111110112c11100f112b0f0e112a0e0d11290d0c11280c0b11270b0a11260a09112c0908112b0807112a07db3c705629c001923024de1129c002955728221128de8200bb8a21562aa0821008f0d180a0562901bef2f4804e02e8562c562c6eb39a30112b206ef2d080112b92572ce226c200e300705625c20095f8235626bc9170e29c30f8235625a182015180a904de8127105628a05220a8812710a904205623bc93305621de0182015180a801112601a01123a4051125050411220403112103021127020111260178112401c84f5000eaf82382015180a90420702c81010b563159f40b6fa192306ddf206e92306d9ad0d31fd30f596c126f02e2206eb39c20206ef2d0806f22305004ba923370e2995b206ef2d0806f22019132e281274c5329b9f2f401a481010b59c85902cb1fcb0fc9102b562e01206e953059f45930944133f413e20901fc55605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc90211160201111e01561f01206e953059f45b30944133f417e2801056205624a0821007bfa480a07020562a5520c855305034ce01fa02cb07cb0fc902111302562901206e953059f45b30944133f417e2561f5623a0821007bfa480a0717f56225626a005112b055101fe04112904561b040311220356240302112a0201112901112ac855708210415400025009cb1f17cb3f15ce13cb0fcb0701fa02cb07cbff01fa02c95618040311230302111d0211240110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb005202f801111c01111aa101111ca1821008f0d180a1208208989680bc8ebe7370880411220410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb009330571ee21110111e11100f111d0f0e111c0e0d111b0d0c111a0c081119080a11180a86530164091117090e11160e07111507061114060511130504111204031111030211100250fe1d108c0a509b1067461544145033db3c9c01f65b111ed33f308200aa5af842561fc705f2f480106dc8216e925b6d8e1701206ef2d0806f24550355305034ce01fa02cb07cb0fc9e202111702561701206e953059f45b30944133f417e20111160180100111167f71216e955b59f45b3098c801cf004133f443e202a4111c111e111c111b111d111b111a111c111a5501b81119111b11191118111a1118111711191117111611181116021117021114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a107910681057104610354334db3c9c043ce30221821041540046bae30221821041540047bae30221821041540048ba575d646c01fe5b111ed33ffa00d31fd3ff3081557df8425621c705f2f4111d1120111d111c111f111c111b111e111b111a1120111a1119111f11191118111e11181117112011171116111f11161115111e11151114112011141113111f11131112111e11121111112011111110111f11100f111e0f0e11200e0d111f0d0c111e0c0b11200b5804fe0a111f0a09111e090811200807111f0706111e060511200504111f0403111e030211200201111f011121816e741123db3c01112401f2f48200b8581123561fdb3c01112401f2f48132661123561fdb3cc002917f8e18561880105621784133f40e6fa19401d70130925b6de26eb3e201112401f2f48200baab5615801056217d74945901fc714133f40e6fa19401d70030925b6de26ef2f4815da7561780105621714133f40e6fa19401d70030925b6de26e8e2656168010562159f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26e9170e2f2f48137ae5621c200965620810e10be9170e29856208209e13380bb9170e2f2f428801056205a01e859f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e2813488216e92317f8e2221206ef2d0806f26155f056e8e10f82302206ef2d0806f2610455f0512be923170e2e2f2f480107ff823011122a0031121030201112201706d581125c85b01fc55505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc9103702111f0201111d01206e953059f45b30944133f417e21119111e11191118111d11181117111c11171116111b11161115111a11151114111911141113111811131112111711121111111611111110111511100f11140f0e11130e0d11120d5c01400c11110c0b11100b10af109e108d107c106b105a09103847601045500304db3c9c02f85b111ed33f30f8416f2430322a80102459f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e2813ca1216eb39a21206ef2d0806f265f059170e29ff82322206ef2d0806f2610455f05b99170e2f2f4206ef2d0806f2627821008f0d180a153426eb3e300215e5f001430238014a9045240a0a403fe8200afbe02bef2f4226eb38ec822206ef2d08024821008f0d180a073708810246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00de70036eb39a3202821008f0d180a0589133e20111260107a0011125a1f8235230a181012cb9e30010346061620020000000006174686172206f7574626964001032f82381012ca00201fe11245502801006c855505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc9103a12206e953059f45b30944133f417e2111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311116301501110111211100f11110f0e11100e10df10ce10bd10ac109b108a091068105710461035440302db3c9c01f45b111ed33f302880102259f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e2811494216eb39a21206ef2d0806f265f059170e29ff82322206ef2d0806f2610455f05be9170e2f2f4206ef2d0806f263582009fc1561b80102859f40f6fa192306ddf6502fe206e92306d9fd0fa40fa00d307d30f55306c146f04e26e8e16561c801028714133f40e6fa19401d70030925b6de26e9170e2f2f4206ee302700180105415435367c855505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc94dd05250206e953059f45b30944133f417e22b821008f0d180a001112201a1666801f47004431380105026c855505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc9103a12206e953059f45b30944133f417e2111c111e111c111b111d111b111a111c111a1119111b11191118111a111811171119111711161118111611151117111511141116111411131115111311121114111267015c1111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a091068105710461035440302db3c9c01f8801022206ef2d0802d821008f0d180a07170c855305034ce01fa02cb07cb0fc902111a025250206e953059f45b30944133f417e256202c821007bfa480a0717f05206ef2d0805622111e1125111e111d1124111d111c1123111c111b1122111b111a1121111a1119112011191118111f1118111711251117051116056902f61115112311151114112211141113112111131112112011121111111f1111111011251110105f0e11230e0d11220d0c11210c0b11200b0a111f0a0911260910580711230706112206051121050411200403111f03021126020111240111275621db3c051122050411250403112803027056275023011126011128c8946a01f455708210415400025009cb1f17cb3f15ce13cb0fcb0701fa02cb07cbff01fa02c904111c0403111b030211220201111e0110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001115111e11151114111d11141113111c11136b019a1112111b11121111111a11111110111911100f11180f0e11170e0d11160d0c11150c0b11140b0a11130a091112090811110807111007106f105e104d103c4ba91058104710261045441359db3c9c03fe8f7c5b571e81557df842561dc705f2f4820afaf080561ea0561f821007bfa480a8a072fb02708100827088561f553010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00111c111e111c111b111d111b111a111c111a1119111b1119e06d6e6f001e00000000617468617220737765657001841118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e551ddb3c9c044c21821041540050bae30221821041540051bae30221821041540052bae30221821041540055ba70797b8802f65b111ef4043081557df842561ec705f2f48200b73127c000f2f4801054510059f4866fa520965023d7013058966c216d326d01e2908ae85f03111c111e111c111b111d111b111a111c111a1119111b11191118111a1118111711191117111611181116111511171115111411161114111311151113111211141112717802fc8200e81c22810fa0b9962182008eacbb9170e28e611122011121010211200203111f0302111e0203111d0302111c0203111b0302111a0203111903021118020311170302111602031115030211140203111303021112020311110302111002103f102e103d102c103b102a1039102810375e32102470e30d01112301f2f4727501fc111e1120111e111d111f111d111c1120111c111b111f111b111a1120111a1119111f11191118112011181117111f11171116112011161115111f11151114112011141113111f11131112112011121111111f11111110112011100f111f0f0e11200e0d111f0d0c11200c0b111f0b0a11200a09111f090811200807111f0773013c0611200605111f050411200403111f03021120020111210111225621db3c74004e20561dbe9420561cbb9170e292307fe08010561a02784133f40e6fa19401d70130925b6de26eb301ea8200dfee8010205616595623014133f40e6fa19401d70130925b6de26ef2f480102002111502562101562301216e955b59f45b3098c801cf014133f443e20fa40111140180100111217f71216e955b59f45b3098c801cf004133f443e2561ea45611bc975710561da41110de801020561f031121017601fc4133f47c6fa520965023d7013058966c216d326d01e2111411211114111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161116111711161110111611101113111511131112111411121111111311110f11110f0e11100e10df10ce10bd77002410ac109b108a10791068105710461035103401301111111311111110111211100f11110f0e11100e551ddb3c9c01f85b3c3c3e111bd3ffd31ffa00fa00fa00d30fd30fd30f3081557df8425622c705f2f48200b7312bc000f2f48178a925c200935356bb9170e2935364bb9170e2f2f481447921c2009521810fa0bb9170e2f2f47873702010691058104710391028c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc903111a037a01f802111a0201111a01206e953059f45b30944133f417e2111c111e111c111b111d111b111a111c111a1119111b11191118111a111811191116111811161115111711151114111611141113111511131112111411121111111311111110111211100e11100e10df4ed010ac109b108a107910681057104610354434db3c9c01f85b111ed72c01916d93fa4001e231f8416f243032111d111f111d111c111e111c111b111f111b111a111e111a1119111f11191118111e11181117111f11171116111e11161115111f11151114111e11141113111f11131112111e11121111111f11111110111e11100f111f0f0e111e0e0d111f0d0c111e0c0b111f0b7c02fc0a111e0a09111f0908111e0807111f0706111e0605111f0504111e0403111f0302111e0201111f011120816e741122db3c01112301f2f48200e14c5619787359f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb3945612c2009170e2f2f481513ef8232eb9922cb39170e27d7e001627c00194f82327be9170e201fef2f48176702f5613b9f2f45618787359f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f275436545475432b1125112a11251124112911241123112811231122112711221121112611211120112a1120111f1129111f111e1128111e111d1127111d111c1126111c7f02fc111b112a111b111a1129111a1119112811191118112711181117112611171116112a11161115112911151114112811141113112711131112112611121111112a11111110112911100f11280f0e11270e0d11260d0c112a0c0b11290b0a11280a091127090811260807112e07db3c8200bb8a21821008f0d180a0562801be80810088306c22f82321bc9320c2009170e28e2af82301a182015180a90420c27893308078de8e1481271021a113a8812710a9045301b9923020de02e430915be25cb991319130e201e0f2f4562756266eb39a301125206ef2d0801125925726e2705629c20095f823562abc9170e29c30f8235629a182015180a904de8127105623a05220a8812710a904205625bc93305623de78730382015180a801112c01a01127a4160511260504112504031124030211230201112701c88201fe55605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc9031117030211250201111d01206e953059f45b30944133f417e280101120561c70c855205023ce01fa02ca00c9102f0111200152b0206e953059f45b30944133f417e209a4111ba471706f00c8013082104154000301cb1fc9561b03561e413310246d50436d03c88303fc89cf16ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0001111f01111aa1821008f0d180a1208208989680bc9330571ee30d1115111e11151114111d11141113111c11131112111b11121111111a11111112111911120f11180f0e11170e0d11160d0c11150c848587000160017c7370880411220410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00860020000000006174686172206368616e6765014a0b11140b06111306091112090811110807111007105e104d103c4ba948601715103401db3c9c03fe8ef25b111ed30ffa4030561380102359f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e28200b99e216eb39d21206ef2d0806f235bf842c7059170e29b21206ef2d0806f236c21b39170e2f2f4801001206ef2d0806f2330311270c855205023ce01fa02ca00c90311140312e021821041540053bae302898a8c01f6206e953059f45b30944133f417e2111c111e111c111b111d111b111a111c111a1119111b11191118111a111811171119111711161118111611151117111511141116111411131115111311121114111211131110111211100f11110f0e11100e10df10ce10bd10ac109b108a10791068105710461035440302db3c9c01f65b111ed3ff3081557df842561ec705f2f4815c902cb3f2f482009b17f8232ebe932ec3009170e2f2f4816259c85220cbffc9d09b9320d74a91d5e868f90400da112fbaf2f4111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711158b02841114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a107910681057104610354430db3cdb3c8e9c04fc21821041540056bae30221821041540054bae3025720c000111fc12101111f01b08eda111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e551ddb3ce08d909c9e02fc5b571e815c902bb3f2f4820085c95611c20099f8232d8203f480a0be9170e2f2f4111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e551d70db3cdb3c8e9c01c83b3b3bf825f815f8446e97f825f8157ff864def810c81acbff19cbffc9d09b9320d74a91d5e868f90400da1156107121c201983020a55220a908a4de708e905312db3cc3019622a6025210b99170e2975112a908a401a4e83002ab3f01a9087f4bcc4a1a8f001091209366a908e83001f65b111ed30f30812f2e2cf2f4561280102259f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e28200c552216eb39b21206ef2d0806f236c21b39170e2f2f453b1a82ba05613a908801020561750334133f40e6fa19401d70130925b6de2206ef2d080813ca5561880102359f40f6fa192306ddf9101fe206e92306d9fd0fa40fa00d307d30f55306c146f04e26e8e165619801023714133f40e6fa19401d70030925b6de26e9170e2f2f4801022206ef2d0806f235b23206ef2d0806f2330317fc855205023ce01fa02ca00c9021116025240206e953059f45b30944133f417e21121a5801022206ef2d0806f235b821007bfa480589201fa725006c855305034ce01fa02cb07cb0fc90211180213561501206e953059f45b30944133f417e2561e821007bfa480717f561a206ef2d0806f235b5621111e1124111e111d1123111d111c1122111c111b1121111b111a1120111a1119111f1119111811241118111711231117061116061115112111151114112011149302ea111311261113111211241112111111231111061110060f11210f0e11200e0d11260d0c11240c0b11230b106a0911210908112008071126070611240605112305041124040311210302112002011125011126561fdb3c1123206ef2d0806f233031705300071123070611290605112a0504112604c8949a01465619801022784133f40e6fa19401d70130925b6de2206eb39631206ef2d080e030db3c9503f6db3c2082080f4240a822812710a8a023a0db3c20ab0001a93800c00192307f92c103e2935f0372e05301ba9a20c00b917f9320c016e29170e2935f0372e020c01d9321c0029170e2935f0372e05301ba97228064a90821ba9170e2935f0372e020c0019321c0019170e297028064a908c000923270e2925b72e05c96989901f6811c89a182080afa6ca02082023ab1a9042082023ab1a812a1208105b4a9045210a12182008eaca904a02182023ab0a904a181016da90402810190a85220a081016d23a823ab01a0038064a90413a1a120a705a602810099a90481009921a8a60275a90412a1a421c10a9301a6039301a6f7e220c1039302a402de970002010074207020788e12227aa90820ae13b101a70a58a0027aa90402e43270207a9d5320ad71b0c0019301a401dea4e43031017003ba927132deaa0001a000ceba925b71e021c0019320c0019170e2925b71e021c001917f9321c00ae2917f9321c014e2917f9321c01ee29a20c001917f9320c00ae29170e2925b71e021c00a9320c0019170e2925b71e021c0149320c0029170e2925b71e001c01e92c003923070e29171e07001f455708210415400025009cb1f17cb3f15ce13cb0fcb0701fa02cb07cbff01fa02c9041120040311210302111e0201111d0110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001116111e11161115111d11151114111c11149b01861113111b11131112111a11121111111911111110111811100f11170f0e11160e0d11150d0c11140c0b11130b0a11120a0911110908111008557710370450664515db3c9c014ec87f01ca00111f111e111d111c111b111a111911181117111611151114111311121111111055e09d00f801111e01111fce01111c01ce01111a01cb0f01111801cb3f01111601cb3f01111401f4001112c8f40001111101f4001ff4000dc8f4001cf4001af40018cb0f16cb0f14cb0f12cb0fcbffcb1fca00cb1fcb1f01c8f40013f40013cb0714cb1f14cb0f14cb1f5004fa025004fa025004fa0214cb0f13cd12cdcdc9ed5400105f0f5f0f30f2c0822237e179');
    const builder = beginCell();
    builder.storeUint(0, 1);
    initAtharMinter_init_args({ $$type: 'AtharMinter_init_args', collection, admin, seasonId, rangeStart, rangeEnd })(builder);
    const __data = builder.endCell();
    return { code: __code, data: __data };
}

export const AtharMinter_errors = {
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
    6434: { message: "bad occasion" },
    9254: { message: "only a real item" },
    9748: { message: "silver includes the photo" },
    10060: { message: "daily limit reached for this wallet" },
    10517: { message: "only the next edition" },
    12078: { message: "not revealed yet" },
    12332: { message: "mystery pool incomplete" },
    12683: { message: "not minted" },
    12902: { message: "only mythic or special dates" },
    13448: { message: "auction already exists" },
    13916: { message: "bad style" },
    14245: { message: "notice period not over" },
    14254: { message: "bad auction" },
    14444: { message: "upgrade already in progress" },
    14617: { message: "upgrade in progress" },
    14653: { message: "already minted" },
    15521: { message: "no live auction" },
    15525: { message: "already issued" },
    17529: { message: "bad pool size" },
    20232: { message: "text must be 1..32 bytes" },
    20798: { message: "ticket sale is over" },
    21885: { message: "only admin" },
    22100: { message: "minting closed" },
    23197: { message: "no upgrade pending" },
    23696: { message: "already revealed" },
    23975: { message: "date already taken" },
    24241: { message: "not open yet" },
    24505: { message: "mythic and special dates are sold by auction" },
    25177: { message: "wrong secret" },
    28276: { message: "sale is not open" },
    28433: { message: "payout not set" },
    30320: { message: "all tickets sold" },
    30788: { message: "bad special" },
    30889: { message: "bad price bounds" },
    31027: { message: "date out of range" },
    34249: { message: "too early for the public reveal" },
    39703: { message: "too early" },
    40897: { message: "already settled" },
    43610: { message: "only collection" },
    44990: { message: "bid too low" },
    46897: { message: "already open" },
    47192: { message: "date not in this season" },
    47518: { message: "not your open ticket" },
    47787: { message: "this date is inside the mystery boxes" },
    48010: { message: "send price + fees" },
    49280: { message: "not owner" },
    50514: { message: "no open ticket" },
    50563: { message: "bad rates" },
    52892: { message: "fee too high" },
    53050: { message: "nothing proposed" },
    53528: { message: "no next edition yet" },
    55815: { message: "already set" },
    56586: { message: "configure common and rare first" },
    57218: { message: "not enough value" },
    57326: { message: "position already loaded" },
    57676: { message: "mystery boxes not configured" },
    59420: { message: "bad pool entry" },
    60482: { message: "minter not authorised" },
} as const

export const AtharMinter_errors_backward = {
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
    "bad occasion": 6434,
    "only a real item": 9254,
    "silver includes the photo": 9748,
    "daily limit reached for this wallet": 10060,
    "only the next edition": 10517,
    "not revealed yet": 12078,
    "mystery pool incomplete": 12332,
    "not minted": 12683,
    "only mythic or special dates": 12902,
    "auction already exists": 13448,
    "bad style": 13916,
    "notice period not over": 14245,
    "bad auction": 14254,
    "upgrade already in progress": 14444,
    "upgrade in progress": 14617,
    "already minted": 14653,
    "no live auction": 15521,
    "already issued": 15525,
    "bad pool size": 17529,
    "text must be 1..32 bytes": 20232,
    "ticket sale is over": 20798,
    "only admin": 21885,
    "minting closed": 22100,
    "no upgrade pending": 23197,
    "already revealed": 23696,
    "date already taken": 23975,
    "not open yet": 24241,
    "mythic and special dates are sold by auction": 24505,
    "wrong secret": 25177,
    "sale is not open": 28276,
    "payout not set": 28433,
    "all tickets sold": 30320,
    "bad special": 30788,
    "bad price bounds": 30889,
    "date out of range": 31027,
    "too early for the public reveal": 34249,
    "too early": 39703,
    "already settled": 40897,
    "only collection": 43610,
    "bid too low": 44990,
    "already open": 46897,
    "date not in this season": 47192,
    "not your open ticket": 47518,
    "this date is inside the mystery boxes": 47787,
    "send price + fees": 48010,
    "not owner": 49280,
    "no open ticket": 50514,
    "bad rates": 50563,
    "fee too high": 52892,
    "nothing proposed": 53050,
    "no next edition yet": 53528,
    "already set": 55815,
    "configure common and rare first": 56586,
    "not enough value": 57218,
    "position already loaded": 57326,
    "mystery boxes not configured": 57676,
    "bad pool entry": 59420,
    "minter not authorised": 60482,
} as const

const AtharMinter_types: ABIType[] = [
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
    {"name":"Engrave","header":1096024068,"fields":[{"name":"text","type":{"kind":"simple","type":"string","optional":false}}]},
    {"name":"SetMedia","header":1096024071,"fields":[{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
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
    {"name":"Ymd","header":null,"fields":[{"name":"y","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"m","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"d","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"AtharItem$Data","header":null,"fields":[{"name":"collection","type":{"kind":"simple","type":"address","optional":false}},{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"owner","type":{"kind":"simple","type":"address","optional":true}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"lastTransferAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"hands","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"mediaLog","type":{"kind":"simple","type":"cell","optional":true}},{"name":"locked","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"AtharState","header":null,"fields":[{"name":"season","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"tier","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"paid","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"mintedAt","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"lastTransferAt","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"hands","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"engravings","type":{"kind":"simple","type":"cell","optional":true}},{"name":"locked","type":{"kind":"simple","type":"bool","optional":false}},{"name":"occasion","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"mediaRef","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"mediaLog","type":{"kind":"simple","type":"cell","optional":true}}]},
    {"name":"AtharCollection$Data","header":null,"fields":[{"name":"admin","type":{"kind":"simple","type":"address","optional":false}},{"name":"collectionUri","type":{"kind":"simple","type":"string","optional":false}},{"name":"delaySec","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"baseUri","type":{"kind":"simple","type":"string","optional":false}},{"name":"payout","type":{"kind":"simple","type":"address","optional":true}},{"name":"royaltyNum","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"royaltyDen","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"minters","type":{"kind":"dict","key":"address","value":"uint","valueFormat":32}},{"name":"pendingPayout","type":{"kind":"simple","type":"address","optional":true}},{"name":"pendingPayoutAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"pendingBaseUri","type":{"kind":"simple","type":"string","optional":true}},{"name":"pendingBaseUriAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"successor","type":{"kind":"simple","type":"address","optional":true}},{"name":"minted","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"firstMinterDone","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"TierState","header":null,"fields":[{"name":"price","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"lastDecayAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"sold","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
    {"name":"WalletCount","header":null,"fields":[{"name":"day","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"count","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"PendingMint","header":null,"fields":[{"name":"buyer","type":{"kind":"simple","type":"address","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"kind","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"ticket","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"Ticket","header":null,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"price","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"claimed","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"Auction","header":null,"fields":[{"name":"started","type":{"kind":"simple","type":"bool","optional":false}},{"name":"endAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"reserve","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"highBid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"highBidder","type":{"kind":"simple","type":"address","optional":true}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"Configure","header":1096024128,"fields":[{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"startPrice","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"AddSpecial","header":1096024129,"fields":[{"name":"items","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":8}}]},
    {"name":"Open","header":1096024130,"fields":[{"name":"startAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"walletDailyCap","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"SetPaused","header":1096024131,"fields":[{"name":"paused","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"Buy","header":1096024132,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"recipient","type":{"kind":"simple","type":"address","optional":true}},{"name":"occasion","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"style","type":{"kind":"simple","type":"uint","optional":false,"format":8}}]},
    {"name":"StartAuction","header":1096024133,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"reserve","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"duration","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"mediaRef","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"SetFees","header":1096024137,"fields":[{"name":"photoFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"silverFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"Bid","header":1096024134,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Settle","header":1096024135,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Sweep","header":1096024136,"fields":[]},
    {"name":"LoadPool","header":1096024144,"fields":[{"name":"items","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":16}}]},
    {"name":"SetMystery","header":1096024145,"fields":[{"name":"commitHash","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"revealAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"startPrice","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"poolExpected","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"BuyTicket","header":1096024146,"fields":[{"name":"recipient","type":{"kind":"simple","type":"address","optional":true}}]},
    {"name":"Reveal","header":1096024147,"fields":[{"name":"secret","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"ClaimTicket","header":1096024148,"fields":[{"name":"ticket","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"RevealPublic","header":1096024150,"fields":[]},
    {"name":"TransferTicket","header":1096024149,"fields":[{"name":"ticket","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"AtharMinter$Data","header":null,"fields":[{"name":"collection","type":{"kind":"simple","type":"address","optional":false}},{"name":"admin","type":{"kind":"simple","type":"address","optional":false}},{"name":"seasonId","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"rangeStart","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"rangeEnd","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"tiers","type":{"kind":"dict","key":"uint","keyFormat":8,"value":"TierState","valueFormat":"ref"}},{"name":"special","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":8}},{"name":"sold","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"bool"}},{"name":"pending","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"PendingMint","valueFormat":"ref"}},{"name":"reserved","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"bool"}},{"name":"pool","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":16}},{"name":"tickets","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"Ticket","valueFormat":"ref"}},{"name":"poolSize","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"poolExpected","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"poolLoaded","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"ticketsSold","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"commitHash","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"revealAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"revealed","type":{"kind":"simple","type":"bool","optional":false}},{"name":"permA","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"permB","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"auctions","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"Auction","valueFormat":"ref"}},{"name":"wallets","type":{"kind":"dict","key":"address","value":"WalletCount","valueFormat":"ref"}},{"name":"status","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"startAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"walletDailyCap","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"soldCount","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"photoFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"silverFee","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"lockedBids","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"ticketsOpen","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"FeeInfo","header":null,"fields":[{"name":"photo","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"silver","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"MysteryInfo","header":null,"fields":[{"name":"poolSize","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"loaded","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"ticketsSold","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"revealed","type":{"kind":"simple","type":"bool","optional":false}},{"name":"revealAt","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"commitHash","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"a","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"b","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
]

const AtharMinter_opcodes = {
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
    "SetMedia": 1096024071,
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
    "SetFees": 1096024137,
    "Bid": 1096024134,
    "Settle": 1096024135,
    "Sweep": 1096024136,
    "LoadPool": 1096024144,
    "SetMystery": 1096024145,
    "BuyTicket": 1096024146,
    "Reveal": 1096024147,
    "ClaimTicket": 1096024148,
    "RevealPublic": 1096024150,
    "TransferTicket": 1096024149,
}

const AtharMinter_getters: ABIGetter[] = [
    {"name":"status","methodId":101642,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"mystery_info","methodId":95485,"arguments":[],"returnType":{"kind":"simple","type":"MysteryInfo","optional":false}},
    {"name":"pool_at","methodId":65608,"arguments":[{"name":"pos","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"int","optional":true,"format":257}},
    {"name":"ticket_of","methodId":115491,"arguments":[{"name":"ticket","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"Ticket","optional":true}},
    {"name":"ticket_date","methodId":78871,"arguments":[{"name":"ticket","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"int","optional":true,"format":257}},
    {"name":"sold_count","methodId":68231,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"tier_of","methodId":107072,"arguments":[{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"is_taken","methodId":103438,"arguments":[{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"bool","optional":false}},
    {"name":"in_season","methodId":114843,"arguments":[{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"bool","optional":false}},
    {"name":"price","methodId":120091,"arguments":[{"name":"tier","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"auction_of","methodId":69107,"arguments":[{"name":"index","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"Auction","optional":true}},
    {"name":"fees","methodId":111867,"arguments":[],"returnType":{"kind":"simple","type":"FeeInfo","optional":false}},
]

export const AtharMinter_getterMapping: { [key: string]: string } = {
    'status': 'getStatus',
    'mystery_info': 'getMysteryInfo',
    'pool_at': 'getPoolAt',
    'ticket_of': 'getTicketOf',
    'ticket_date': 'getTicketDate',
    'sold_count': 'getSoldCount',
    'tier_of': 'getTierOf',
    'is_taken': 'getIsTaken',
    'in_season': 'getInSeason',
    'price': 'getPrice',
    'auction_of': 'getAuctionOf',
    'fees': 'getFees',
}

const AtharMinter_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"empty"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Configure"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetFees"}},
    {"receiver":"internal","message":{"kind":"typed","type":"AddSpecial"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Open"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetPaused"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Buy"}},
    {"receiver":"internal","message":{"kind":"typed","type":"MintOk"}},
    {"receiver":"internal","message":{"kind":"typed","type":"StartAuction"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Bid"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Settle"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Sweep"}},
    {"receiver":"internal","message":{"kind":"typed","type":"LoadPool"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetMystery"}},
    {"receiver":"internal","message":{"kind":"typed","type":"BuyTicket"}},
    {"receiver":"internal","message":{"kind":"typed","type":"TransferTicket"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Reveal"}},
    {"receiver":"internal","message":{"kind":"typed","type":"RevealPublic"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ClaimTicket"}},
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
export const MEDIA_FEE = 100000000n;
export const MIN_STORAGE = 50000000n;
export const DAY = 86400n;

export class AtharMinter implements Contract {
    
    public static readonly storageReserve = 0n;
    public static readonly errors = AtharMinter_errors_backward;
    public static readonly opcodes = AtharMinter_opcodes;
    
    static async init(collection: Address, admin: Address, seasonId: bigint, rangeStart: bigint, rangeEnd: bigint) {
        return await AtharMinter_init(collection, admin, seasonId, rangeStart, rangeEnd);
    }
    
    static async fromInit(collection: Address, admin: Address, seasonId: bigint, rangeStart: bigint, rangeEnd: bigint) {
        const __gen_init = await AtharMinter_init(collection, admin, seasonId, rangeStart, rangeEnd);
        const address = contractAddress(0, __gen_init);
        return new AtharMinter(address, __gen_init);
    }
    
    static fromAddress(address: Address) {
        return new AtharMinter(address);
    }
    
    readonly address: Address; 
    readonly init?: { code: Cell, data: Cell };
    readonly abi: ContractABI = {
        types:  AtharMinter_types,
        getters: AtharMinter_getters,
        receivers: AtharMinter_receivers,
        errors: AtharMinter_errors,
    };
    
    constructor(address: Address, init?: { code: Cell, data: Cell }) {
        this.address = address;
        this.init = init;
    }
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: null | Configure | SetFees | AddSpecial | Open | SetPaused | Buy | MintOk | StartAuction | Bid | Settle | Sweep | LoadPool | SetMystery | BuyTicket | TransferTicket | Reveal | RevealPublic | ClaimTicket) {
        
        let body: Cell | null = null;
        if (message === null) {
            body = new Cell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Configure') {
            body = beginCell().store(storeConfigure(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetFees') {
            body = beginCell().store(storeSetFees(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'AddSpecial') {
            body = beginCell().store(storeAddSpecial(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Open') {
            body = beginCell().store(storeOpen(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetPaused') {
            body = beginCell().store(storeSetPaused(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Buy') {
            body = beginCell().store(storeBuy(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'MintOk') {
            body = beginCell().store(storeMintOk(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'StartAuction') {
            body = beginCell().store(storeStartAuction(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Bid') {
            body = beginCell().store(storeBid(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Settle') {
            body = beginCell().store(storeSettle(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Sweep') {
            body = beginCell().store(storeSweep(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'LoadPool') {
            body = beginCell().store(storeLoadPool(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetMystery') {
            body = beginCell().store(storeSetMystery(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'BuyTicket') {
            body = beginCell().store(storeBuyTicket(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'TransferTicket') {
            body = beginCell().store(storeTransferTicket(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Reveal') {
            body = beginCell().store(storeReveal(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'RevealPublic') {
            body = beginCell().store(storeRevealPublic(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ClaimTicket') {
            body = beginCell().store(storeClaimTicket(message)).endCell();
        }
        if (body === null) { throw new Error('Invalid message type'); }
        
        await provider.internal(via, { ...args, body: body });
        
    }
    
    async getStatus(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('status', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getMysteryInfo(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('mystery_info', builder.build())).stack;
        const result = loadGetterTupleMysteryInfo(source);
        return result;
    }
    
    async getPoolAt(provider: ContractProvider, pos: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(pos);
        const source = (await provider.get('pool_at', builder.build())).stack;
        const result = source.readBigNumberOpt();
        return result;
    }
    
    async getTicketOf(provider: ContractProvider, ticket: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(ticket);
        const source = (await provider.get('ticket_of', builder.build())).stack;
        const result_p = source.readTupleOpt();
        const result = result_p ? loadTupleTicket(result_p) : null;
        return result;
    }
    
    async getTicketDate(provider: ContractProvider, ticket: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(ticket);
        const source = (await provider.get('ticket_date', builder.build())).stack;
        const result = source.readBigNumberOpt();
        return result;
    }
    
    async getSoldCount(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('sold_count', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getTierOf(provider: ContractProvider, index: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(index);
        const source = (await provider.get('tier_of', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getIsTaken(provider: ContractProvider, index: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(index);
        const source = (await provider.get('is_taken', builder.build())).stack;
        const result = source.readBoolean();
        return result;
    }
    
    async getInSeason(provider: ContractProvider, index: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(index);
        const source = (await provider.get('in_season', builder.build())).stack;
        const result = source.readBoolean();
        return result;
    }
    
    async getPrice(provider: ContractProvider, tier: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(tier);
        const source = (await provider.get('price', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getAuctionOf(provider: ContractProvider, index: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(index);
        const source = (await provider.get('auction_of', builder.build())).stack;
        const result_p = source.readTupleOpt();
        const result = result_p ? loadTupleAuction(result_p) : null;
        return result;
    }
    
    async getFees(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('fees', builder.build())).stack;
        const result = loadGetterTupleFeeInfo(source);
        return result;
    }
    
}