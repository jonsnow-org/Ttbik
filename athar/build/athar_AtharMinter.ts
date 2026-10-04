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
    const _remit = sc_0.loadCoins();
    return { $$type: 'MintItem' as const, index: _index, newOwner: _newOwner, season: _season, tier: _tier, paid: _paid, remit: _remit };
}

export function loadTupleMintItem(source: TupleReader) {
    const _index = source.readBigNumber();
    const _newOwner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _remit = source.readBigNumber();
    return { $$type: 'MintItem' as const, index: _index, newOwner: _newOwner, season: _season, tier: _tier, paid: _paid, remit: _remit };
}

export function loadGetterTupleMintItem(source: TupleReader) {
    const _index = source.readBigNumber();
    const _newOwner = source.readAddress();
    const _season = source.readBigNumber();
    const _tier = source.readBigNumber();
    const _paid = source.readBigNumber();
    const _remit = source.readBigNumber();
    return { $$type: 'MintItem' as const, index: _index, newOwner: _newOwner, season: _season, tier: _tier, paid: _paid, remit: _remit };
}

export function storeTupleMintItem(source: MintItem) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.index);
    builder.writeAddress(source.newOwner);
    builder.writeNumber(source.season);
    builder.writeNumber(source.tier);
    builder.writeNumber(source.paid);
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
    return { $$type: 'SetMystery' as const, commitHash: _commitHash, revealAt: _revealAt, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps };
}

export function loadTupleSetMystery(source: TupleReader) {
    const _commitHash = source.readBigNumber();
    const _revealAt = source.readBigNumber();
    const _startPrice = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    return { $$type: 'SetMystery' as const, commitHash: _commitHash, revealAt: _revealAt, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps };
}

export function loadGetterTupleSetMystery(source: TupleReader) {
    const _commitHash = source.readBigNumber();
    const _revealAt = source.readBigNumber();
    const _startPrice = source.readBigNumber();
    const _floor = source.readBigNumber();
    const _cap = source.readBigNumber();
    const _bumpBps = source.readBigNumber();
    const _decayBps = source.readBigNumber();
    return { $$type: 'SetMystery' as const, commitHash: _commitHash, revealAt: _revealAt, startPrice: _startPrice, floor: _floor, cap: _cap, bumpBps: _bumpBps, decayBps: _decayBps };
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
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, reserved: _reserved, pool: _pool, tickets: _tickets, poolSize: _poolSize, poolLoaded: _poolLoaded, ticketsSold: _ticketsSold, commitHash: _commitHash, revealAt: _revealAt, revealed: _revealed, permA: _permA, permB: _permB, auctions: _auctions, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount };
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
    const _poolLoaded = source.readBigNumber();
    source = source.readTuple();
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
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, reserved: _reserved, pool: _pool, tickets: _tickets, poolSize: _poolSize, poolLoaded: _poolLoaded, ticketsSold: _ticketsSold, commitHash: _commitHash, revealAt: _revealAt, revealed: _revealed, permA: _permA, permB: _permB, auctions: _auctions, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount };
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
    return { $$type: 'AtharMinter$Data' as const, collection: _collection, admin: _admin, seasonId: _seasonId, rangeStart: _rangeStart, rangeEnd: _rangeEnd, tiers: _tiers, special: _special, sold: _sold, pending: _pending, reserved: _reserved, pool: _pool, tickets: _tickets, poolSize: _poolSize, poolLoaded: _poolLoaded, ticketsSold: _ticketsSold, commitHash: _commitHash, revealAt: _revealAt, revealed: _revealed, permA: _permA, permB: _permB, auctions: _auctions, wallets: _wallets, status: _status, startAt: _startAt, walletDailyCap: _walletDailyCap, soldCount: _soldCount };
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
    const __code = Cell.fromHex('b5ee9c7241028b01002aca000228ff008e88f4a413f4bcf2c80bed5320e303ed43d9012902027102130201200311020120040e020148050802f1ac2476a268690000c71b7d207d20408080eb806a00e8408080eb80408080eb801808128812081182e8aa81b6b6b6b6b6b6b6b82a38001038389136b6aa3911107186888c888d088c888c088c888c088b888c088b888b088b888b088a888b088a888a088a888a0889888a0889888908898889088888890888c02a0601281110111111100f11100f550edb3c57105f0f6ca107002c801020561250334133f40e6fa19401d70130925b6de2020120090b0294aa87ed44d0d200018e36fa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d70547000207071226d6d54722220e30ddb3c57105f0f6ca12a0a00022002f0a9f3ed44d0d200018e36fa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d70547000207071226d6d54722220e30d1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211112a0c01541110111111100f11100f550edb3c57105f0f6ca1206e92306d99206ef2d0806f256f05e2206e92306dde0d00608010270259f40f6fa192306ddf206e92306d8e1bd0d200d31ffa00fa00d72c01916d93fa4001e2151443306c156f05e202f1b682fda89a1a400031c6df481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e00040e0e244dadaa8e44441c61a223222342232223022322230222e2230222e222c222e222c222a222c222a2228222a222822262228222622242226222422222224222302a0f01281110111111100f11100f550edb3c57105f0f6ca110005629b3917f932ec000e292306de028801002a828a02fa90821561255204133f40e6fa19401d70130925b6de20295bb4fded44d0d200018e36fa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d70547000207071226d6d54722220e30ddb3c6c886c886ca882a120010547dcb547bcd53dc020120141e020120151b02012016180295b342bb5134348000638dbe903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c00081c1c489b5b551c888838c376cf15c417c3db28602a1700022302f1b103bb5134348000638dbe903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c00081c1c489b5b551c888838c34446444684464446044644460445c4460445c4458445c4458445444584454445044544450444c4450444c4448444c444844444448444602a1901281110111111100f11100f550edb3c57105f0f6ca11a00865613801022714133f40e6fa19401d70030925b6de26eb392307f8e26801056130259f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26eb3e202f1b4481da89a1a400031c6df481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e00040e0e244dadaa8e44441c61a223222342232223022322230222e2230222e222c222e222c222a222c222a2228222a222822262228222622242226222422222224222302a1c01281110111111100f11100f550edb3c57105f0f6ca11d0104db3c810201481f26020162202302efa537da89a1a400031c6df481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e00040e0e244dadaa8e44441c61a223222342232223022322230222e2230222e222c222e222c222a222c222a2228222a22282226222822262224222622242222222422232a2101281110111111100f11100f550edb3c57105f0f6ca1220104db3c6502efa647da89a1a400031c6df481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e00040e0e244dadaa8e44441c61a223222342232223022322230222e2230222e222c222e222c222a222c222a2228222a22282226222822262224222622242222222422232a2401541110111111100f11100f550edb3c57105f0f6ca1206e92306d99206ef2d0806f236f03e2206e92306dde250044801056100259f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e202f1b146fb5134348000638dbe903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c00081c1c489b5b551c888838c34446444684464446044644460445c4460445c4458445c4458445444584454445044544450444c4450444c4448444c444844444448444602a2701281110111111100f11100f550edb3c57105f0f6ca12801727856160259f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206e923070e0206ef2d0806f27db3c7003f83001d072d721d200d200fa4021103450666f04f86102f862ed44d0d200018e36fa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d70547000207071226d6d54722220e30d111b8e9f11198020d7217021d749c21f9430d31f01de821041540002bae3025f0f5f0ce02a2c3301f8fa40fa40d30fd33fd33ff404d401d0f404f404f404d430d0f404f404f404d30fd30fd30fd3ffd31fd200d31fd31fd430d0f404f404d307d31fd30fd31f301114111a1114111411191114111411181114111411171114111411161114111411151114571a1118111911181117111811171116111711161115111611152b00481114111511141113111411131112111311121111111211111110111111100f11100f550e02e0d33f0131561080102259f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e2206e8ebf5b1117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551cdb3ce080106dc8892d03fe216e925b6d8e1701206ef2d0806f24550355305034ce01fa02cb07cb0fc9e2021113025230206e953059f45b30944133f417e25611206ef2d0806f24135f03c001e30f1117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce2e2f3200e057112480102259f40f6fa192306ddf206e92306d8e1bd0d200d31ffa00fa00d72c01916d93fa4001e2151443306c156f05e2206ef2d0806f257f3504431380105025c855405045ca0012cb1f01fa0201fa0201206e9430cf84809201cee2c9103612206e953059f45b30944133f417e202d8315610206ef2d0806f24135f03c0028ed75610206ef2d0806f245f031111206ef2d0806f2410235f037370880411140410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb000ce30d0c033031002000000000617468617220726566756e6400c680105611206ef2d0806f246c312f5959f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e2206ef2d0806f233080101113206ef2d0806f246c315970c855205023ce01fa02ca00c9103f02111202206e953059f45b30944133f417e2012a10bd10ac109b108a1079106810571046443512db3c89046e70561ad74920c21f9731111ad31f111bde21821041540040bae30221821041540041bae30221821041540042bae30221821041540043ba3436383d01d25b1119d307fa00fa00fa00d30fd30f3081557df842561ec705f2f48200b73128c000f2f425c000917f9325c001e2f2e6b28178a924c200935345bb9170e2935353bb9170e2f2f48200c583228107d0bb9521811388bb9170e2f2f478702010671057104710371027c83501f055605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc90311150312206e953059f45b30944133f417e211171119111711161118111611151117111511141116111411131115111311141111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a107910681057104610354403db3c8902ec5b1119f4043081557df8425619c705f2f48200b73123c000f2f42080107859f4866fa520965023d7013058966c216d326d01e2908ae85f031117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551cdb3c378900b481784422c2ff962282008eacbb9170e29321c2ff9170e29321c1039170e2f2f40111140180100156150178216e955b59f45b3098c801cf014133f443e2801022021115784133f47c6fa520965023d7013058966c216d326d01e202de5f041117d31fd30f3081557df8425618c705f2f48200b7311119c00001111901f2f48200dd0a5612787059f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb39170e30df2f481302c53abbaf2f471215613787059f40f6fa192306ddf393a00585612787159f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb301ce206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f27312810465e32157807705027c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc903111603206e953059f45b30944133f417e27854613159f40f6fa192306ddf3b01fa206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f273178280706050443a3c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc910231024206e953059f45b30944133f417e211171119111711161118111611151117111511141116111411131115111311141111111311113c01501110111211100f11110f0e11100e10df10ce10bd10ac109b108a107910681057104610354403db3c8903fe8ef25b1119d2003081557df8425619c705f2f4815eb103c30013f2f40191729171e21117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a107910681057104610354143db3ce021821041540044bae302893e4901f85b1119d33fd72c01916d93fa4001e231f8416f2430321118111b11181117111a11171116111911161115111b11151114111a11141113111911131112111b11121111111a11111110111911100f111b0f0e111a0e0d11190d0c111b0c0b111a0b0a11190a09111b0908111a080711190706111b0605111a05041119043f03fc03111b0302111a0201111901111c816e74111edb3c01111f01f2f48200b858561c82008eacbb8e86111e561cdb3c93111e70e201111f01f2f4815da756128010561e714133f40e6fa19401d70030925b6de26e8e2656118010561e59f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26e9170e26d654001fcf2f4248010561d59f40f6fa192306ddf206e92306d8e1bd0d200d31ffa00fa00d72c01916d93fa4001e2151443306c156f05e26ef2e6498200baab56108010561e714133f40e6fa19401d70030925b6de26ef2f41118111911181117111811171116111711161115111611151114111511141113111411131112111311124102fa1111111211111110111111100f11100f550e111d561bdb3c8200c84521c302f2f45615782259f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f275436545475432b112011271120111f1126111f111e1125111e111d1124111d111c1123111c111b1122111b814202fe111a1121111a1119112711191118112611181117112511171116112411161115112311151114112211141113112111131112112711121111112611111110112511100f11240f0e11230e0d11220d0c11210c0b11270b0a11260a091125090811240807112307db3c8200bb8a21821008f0d180a0562701bef2f4562456236e704302deb39a301122206ef2d0801122925723e222c200e30070561ec20095f823561fbc9170e29c30f823561ea182015180a904de8127105621a05220a8812710a904205623bc93305621de0182015180a801111f01a0111ca405111e0504112204031121030211200201111f0178111d01c8444500eaf82382015180a90420702881010b562959f40b6fa192306ddf206e92306d9ad0d31fd30f596c126f02e2206eb39c20206ef2d0806f22305004ba923370e2995b206ef2d0806f22019132e281274c5325b9f2f401a481010b59c85902cb1fcb0fc91027562601206e953059f45930944133f413e20501f455605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc90211110201111701561801206e953059f45b30944133f417e280105619821007bfa480a0702056225520c855305034ce01fa02cb07cb0fc9102e561f01206e953059f45b30944133f417e25618821007bfa480a0111e71111e56147f111a561c561dc84602f855508210415400025007cb1f15cb3f13cecb0fcb0701fa0201fa02c956150403111f0302111e0211180110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0001111c011115a1821008f0d180a1208208989680bc93305719e30d4748017c73708804111d0410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb007401760e11190e0d11180d0c11170c0b11160b0a11150a0611140608111308071112070b11110b05111005104f103e4dcb102a103910781057035065db3c89044c21821041540005bae30221821041540045bae30221821041540046bae30221821041540047ba4a4c515601f85b1119d33f308200aa5af842561ac705f2f480106dc8216e925b6d8e1701206ef2d0806f24550355305034ce01fa02cb07cb0fc9e202111202561201206e953059f45b30944133f417e20111110180100111117f71216e955b59f45b3098c801cf004133f443e21119a41117111911171116111811161115111711154b01801114111611141113111511131112111411121111111311111111111211110f11110f0e11100e10df10ce10bd10ac109b108a107910681057104610354430db3c8901fe5b1119d33ffa00d31f3081557df842561bc705f2f41118111a11181117111911171116111a11161115111911151114111a11141113111911131112111a11121111111911111110111a11100f11190f0e111a0e0d11190d0c111a0c0b11190b0a111a0a0911190908111a080711190706111a060511190504111a04031119034d04de02111a0201111901111b816e74111ddb3c01111e01f2f48200b858111d561bdb3c01111e01f2f4815e22111d561bdb3cc00201111e01f2f48200baab56108010561d714133f40e6fa19401d70030925b6de26ef2f4815da756128010561d714133f40e6fa19401d70030925b6de26e6d65814e01fa8e2656118010561d59f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26e9170e2f2f48137ae561ac20096561c810e10be9170e298561c8208093a80bb9170e2f2f4248010561c59f40f6fa192306ddf206e92306d8e1bd0d200d31ffa00fa00d72c01916d93fa4001e2151443306c156f05e24f01f6813488216e92317f8e2121206ef2d0806f256c416e8e10f82302206ef2d0806f2510345f0412be923170e2e2f2f480107ff82301111ea002111d0201111b706dc855405045ca0012cb1f01fa0201fa0201206e9430cf84809201cee2c910340211190201111a01206e953059f45b30944133f417e211151119111550018c1114111811141113111711131112111611121111111511111110111411100f11130f0e11120e0d11110d0c11100c10bf10ae109d108c107b106a10591048103746451023db3c8902fe5b1119d33f30f8416f2430322680102459f40f6fa192306ddf206e92306d8e1bd0d200d31ffa00fa00d72c01916d93fa4001e2151443306c156f05e2813ca1216eb39a21206ef2d0806f255f049170e29ff82322206ef2d0806f2510345f04b99170e2f2f4206ef2d0806f2506821008f0d180a153266eb3e300218200afbe5253001430218014a9045220a0a402de02bef2f4266eb38ec806206ef2d08001821008f0d180a073708810246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00923630e2f8235220a181012cb99831f82381012ca001de550280105055c854550020000000006174686172206f757462696401fc55405045ca0012cb1f01fa0201fa0201206e9430cf84809201cee2c9103612206e953059f45b30944133f417e21117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a1079106810571046443512db3c8902fa8ef95b1119d33f302480102259f40f6fa192306ddf206e92306d8e1bd0d200d31ffa00fa00d72c01916d93fa4001e2151443306c156f05e2811494216eb39a21206ef2d0806f255f049170e29ff82322206ef2d0806f2510345f04be9170e2f2f4206ef2d0806f253482009fc1561580102759f40f6fa192306ddfe021575e02fe206e92306d9fd0fa40fa00d307d30f55306c146f04e26e8e165616801027714133f40e6fa19401d70030925b6de26e9170e2f2f4236ee3027001801054143426c855405045ca0012cb1f01fa0201fa0201206e9430cf84809201cee2c924103901206e953059f45b30944133f417e2801022206ef2d08028821008f0d180a0585a01fe70431380105025c855405045ca0012cb1f01fa0201fa0201206e9430cf84809201cee2c9103612206e953059f45b30944133f417e21117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a10791068105759010e1046443512db3c8903fe7170c855305034ce01fa02cb07cb0fc9021114025240206e953059f45b30944133f417e226821007bfa480a0717f04206ef2d080450072561c52b30cc855508210415400025007cb1f15cb3f13cecb0fcb0701fa0201fa02c9561b04483310246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb08a8ae25b5c5d00065bcf81001a58cf8680cf8480f400f400cf8101acf400c901fb00111711191117111611181116111511171115111411161114111311151113111211141112111111131111111011121110031111030e11100e10df10ce10bd10ac109b108a10791068105710465512db3c89044a821041540048bae30221821041540050bae30221821041540051bae30221821041540052ba5f62686a02f45b571981557df8425618c705f2f4820afaf080561aa700a070fb02708100827088561a553010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001117111911171116111811161115111711151114111611141113111511136061001e00000000617468617220737765657001401112111411121111111311111110111211100f11110f0e11100e10df551cdb3c8902ee5b1119f4043081557df8425619c705f2f48200b73123c000f2f4801054510059f4866fa520965023d7013058966c216d326d01e2908ae85f031117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551cdb3c638902ee8200e81c22810fa0b9962182008eacbb9170e28e4d111d01111c0103111b0302111a0203111903021118020311170302111602031115030211140203111303021112020311110302111002103f102e103d102c103b102a1039102810375e32102470e30d01111e01f2f48200dfee801020561159561d01646601fc1119111b11191118111a11181117111b11171116111a11161115111b11151114111a11141113111b11131112111a11121111111b11111110111a11100f111b0f0e111a0e0d111b0d0c111a0c0b111b0b0a111a0a09111b0908111a0807111b0706111a0605111b0504111a0403111b0302111a0201111c01111d561cdb3c65004e205618be94205617bb9170e292307fe08010561502784133f40e6fa19401d70130925b6de26eb301f44133f40e6fa19401d70130925b6de26ef2f48010541f00561b01561e01216e955b59f45b3098c801cf014133f443e20ba41f801001111c7f71216e955b59f45b3098c801cf004133f443e25618a42cbc953b5617a40bde801020561b03111b014133f47c6fa520965023d7013058966c216d326d01e20f111c0f6700ac1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311110c11110c0e11100e10df10de10bd10ac109b108a10791068105710461035103401f85b38381117d3ffd31ffa00fa00fa00d30fd30f3081557df842561dc705f2f48200b731561ec000f2f48178a924c200935345bb9170e2935353bb9170e2f2f47873702010685e3410371028c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc90311150312206e953059f45b30944133f417e211171119111769018c11161118111611151117111511141116111411131115111311141111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b1a1910681057104610354433db3c89043ce30221821041540055bae30221821041540053bae30221821041540056ba6b76787a01fc5b1119d72c01916d93fa4001e231f8416f2430321118111a11181117111911171116111a11161115111911151114111a11141113111911131112111a11121111111911111110111a11100f11190f0e111a0e0d11190d0c111a0c0b11190b0a111a0a0911190908111a080711190706111a060511190504111a04031119036c02e802111a0201111901111b816e74111ddb3c01111e01f2f48200e14c5614787359f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb3932dc2009170e2f2f481513ef8232ab99228b39170e2f2f481767053bdb9f2f45613787359f40f6fa192306ddf6d6e001623c00194f82323be9170e201fe206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f275436545475432b112011251120111f1124111f111e1123111e111d1122111d111c1121111c111b1125111b111a1124111a1119112311191118112211181117112111171116112511161115112411151114112311141113112211136f02fc1112112111121111112511111110112411100f11230f0e11220e0d11210d0c11250c0b11240b0a11230a091122090811210807112907db3c8200bb8a21821008f0d180a0562201bef2f4562256226eb39a301121206ef2d0801121925722e2705624c20095f8235625bc9170e29c30f8235624a182015180a904de81271070710088306c22f82321bc9320c2009170e28e2af82301a182015180a90420c27893308078de8e1481271021a113a8812710a9045301b9923020de02e430915be25cb991319130e201fc561ea05220a8812710a904205620bc9330561ede78730382015180a801112701a01122a416051121050411200403111f0302111e0201112201c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc9031112030211200201111801206e953059f45b30944133f417e28010111c561770c855205023ce01fa02ca00c97201f8102a01111c015270206e953059f45b30944133f417e205a471706f00c8013082104154000301cb1fc95616035619413310246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00011119011115a1821008f0d180a1208208989680bc7302fe8ebe73708804111d0410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0093305719e21110111911100f11180f0e11170e0d11160d0c11150c0e11140e0a11130a091112090811110807111007106f102e104d103c0950ab106810470574750020000000006174686172206368616e6765010a065520db3c8901fa5b1119d30ffa40302e80102359f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e28200b99e216eb39d21206ef2d0806f235bf842c7059170e29b21206ef2d0806f236c21b39170e2f2f4801001206ef2d0806f2330311270c855205023ce01fa02ca00c9103f12206e953059f45b30944133f417e27701a21117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df0e10bd10ac109b108a107910681057104610354403db3c8901fe5b1119d3ff3081557df8425619c705f2f4815c9028b3f2f482009b17f8232abe932ac3009170e2f2f4816259c85220cbffc9d09b9320d74a91d5e868f90400da112bbaf2f41118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f7902420e11100e10df10ce10bd10ac109b108a10791068105710461035443012db3cdb3c7b8904f68f615b5719815c9027b3f2f4820085c92cc20099f823298203f480a0be9170e2f2f41117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551c70db3cdb3ce021821041540054bae302571bc000111ac12101111a01b07b897d8801c6373737f825f815f8446e97f825f8157ff864def810c816cbff15cbffc9d09b9320d74a91d5e868f90400da112b7121c201983020a55220a908a4de708e905312db3cc3019622a6025210b99170e2975112a908a401a4e83002ab3f01a9087f478846167c001091209366a908e83001f25b1119d30f30812f2e28f2f42d80102259f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e28200c552216eb39b21206ef2d0806f236c21b39170e2f2f45371a827a02ea908801020561250334133f40e6fa19401d70130925b6de2206ef2d080813ca5561380102359f40f6fa192306ddf7e01fe206e92306d9fd0fa40fa00d307d30f55306c146f04e26e8e165614801023714133f40e6fa19401d70030925b6de26e9170e2f2f4801022206ef2d0806f235b23206ef2d0806f2330317fc855205023ce01fa02ca00c9021111025240206e953059f45b30944133f417e2801022206ef2d0806f235b821007bfa480587250067f01fcc855305034ce01fa02cb07cb0fc90211130213561001206e953059f45b30944133f417e25619821007bfa480717f5615206ef2d0806f235b561c1119111f11191118111e11181117111d11171116111c11161115111b11151114111a11141113111f11131112111e1112061111061110111c11100f111b0f107e0d111f0d8002f60c111e0c106b0a111c0a09111b09107807111f0706111e0605111e0504111c0403111b0302111f02011120011121561adb3c111e206ef2d0806f23303104111b04031121030211220201111e0170c855508210415400025007cb1f15cb3f13cecb0fcb0701fa0201fa02c904111b04031119030211180201111c01818701465614801022784133f40e6fa19401d70130925b6de2206eb39631206ef2d080e030db3c8203f6db3c2082080f4240a822812710a8a023a0db3c20ab0001a93800c00192307f92c103e2935f0372e05301ba9a20c00b917f9320c016e29170e2935f0372e020c01d9321c0029170e2935f0372e05301ba97228064a90821ba9170e2935f0372e020c0019321c0019170e297028064a908c000923270e2925b72e05c83858601f6811c89a182080afa6ca02082023ab1a9042082023ab1a812a1208105b4a9045210a12182008eaca904a02182023ab0a904a181016da90402810190a85220a081016d23a823ab01a0038064a90413a1a120a705a602810099a90481009921a8a60275a90412a1a421c10a9301a6039301a6f7e220c1039302a402de840002010074207020788e12227aa90820ae13b101a70a58a0027aa90402e43270207a9d5320ad71b0c0019301a401dea4e43031017003ba927132deaa0001a000ceba925b71e021c0019320c0019170e2925b71e021c001917f9321c00ae2917f9321c014e2917f9321c01ee29a20c001917f9320c00ae29170e2925b71e021c00a9320c0019170e2925b71e021c0149320c0029170e2925b71e001c01e92c003923070e29171e07001de10246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001111111911111110111811100f11170f0e11160e0d11150d0c11140c0b11130b0a11120a091111090811100855771067104610354013db3c8901908ebe1117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551cdb3ce05f0f5f0bf2c08289013ac87f01ca00111a111911181117111611151114111311121111111055e08a00c601111901111ace01111701ce01111501cb0f01111301cb3f01111101cb3f1ff4000dc8f4001cf4001af40008c8f40017f40015f40013cb0fcb0fcb0fcbffcb1f12ca0012cb1f13cb1f03c8f40014f40014cb0714cb1f14cb0f14cb1fcd12cdcdc9ed54b46931d6');
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
    9254: { message: "only a real item" },
    10060: { message: "daily limit reached for this wallet" },
    10517: { message: "only the next edition" },
    12078: { message: "not revealed yet" },
    12332: { message: "mystery pool incomplete" },
    12683: { message: "not minted" },
    13448: { message: "auction already exists" },
    14245: { message: "notice period not over" },
    14254: { message: "bad auction" },
    14444: { message: "upgrade already in progress" },
    14617: { message: "upgrade in progress" },
    14653: { message: "already minted" },
    15521: { message: "no live auction" },
    15525: { message: "already issued" },
    20232: { message: "text must be 1..32 bytes" },
    20798: { message: "ticket sale is over" },
    21885: { message: "only admin" },
    22100: { message: "minting closed" },
    23197: { message: "no upgrade pending" },
    23696: { message: "already revealed" },
    23975: { message: "date already taken" },
    24098: { message: "only mythic dates" },
    24241: { message: "not open yet" },
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
    51269: { message: "mythic dates are sold by auction" },
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
    "only a real item": 9254,
    "daily limit reached for this wallet": 10060,
    "only the next edition": 10517,
    "not revealed yet": 12078,
    "mystery pool incomplete": 12332,
    "not minted": 12683,
    "auction already exists": 13448,
    "notice period not over": 14245,
    "bad auction": 14254,
    "upgrade already in progress": 14444,
    "upgrade in progress": 14617,
    "already minted": 14653,
    "no live auction": 15521,
    "already issued": 15525,
    "text must be 1..32 bytes": 20232,
    "ticket sale is over": 20798,
    "only admin": 21885,
    "minting closed": 22100,
    "no upgrade pending": 23197,
    "already revealed": 23696,
    "date already taken": 23975,
    "only mythic dates": 24098,
    "not open yet": 24241,
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
    "mythic dates are sold by auction": 51269,
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
    {"name":"ItemInit","header":1096024065,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"mintedAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
    {"name":"MintItem","header":1096024066,"fields":[{"name":"index","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}},{"name":"season","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"tier","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"paid","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"remit","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
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
    {"name":"AtharCollection$Data","header":null,"fields":[{"name":"admin","type":{"kind":"simple","type":"address","optional":false}},{"name":"collectionUri","type":{"kind":"simple","type":"string","optional":false}},{"name":"delaySec","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"baseUri","type":{"kind":"simple","type":"string","optional":false}},{"name":"payout","type":{"kind":"simple","type":"address","optional":true}},{"name":"royaltyNum","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"royaltyDen","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"minters","type":{"kind":"dict","key":"address","value":"uint","valueFormat":32}},{"name":"pendingPayout","type":{"kind":"simple","type":"address","optional":true}},{"name":"pendingPayoutAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"pendingBaseUri","type":{"kind":"simple","type":"string","optional":true}},{"name":"pendingBaseUriAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"successor","type":{"kind":"simple","type":"address","optional":true}},{"name":"minted","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"firstMinterDone","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"TierState","header":null,"fields":[{"name":"price","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"lastDecayAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"sold","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
    {"name":"WalletCount","header":null,"fields":[{"name":"day","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"count","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"PendingMint","header":null,"fields":[{"name":"buyer","type":{"kind":"simple","type":"address","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"kind","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"ticket","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"Ticket","header":null,"fields":[{"name":"owner","type":{"kind":"simple","type":"address","optional":false}},{"name":"price","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"claimed","type":{"kind":"simple","type":"bool","optional":false}}]},
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
    {"name":"LoadPool","header":1096024144,"fields":[{"name":"items","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":16}}]},
    {"name":"SetMystery","header":1096024145,"fields":[{"name":"commitHash","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"revealAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"startPrice","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"floor","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"cap","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"bumpBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"decayBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"BuyTicket","header":1096024146,"fields":[{"name":"recipient","type":{"kind":"simple","type":"address","optional":true}}]},
    {"name":"Reveal","header":1096024147,"fields":[{"name":"secret","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"ClaimTicket","header":1096024148,"fields":[{"name":"ticket","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"RevealPublic","header":1096024150,"fields":[]},
    {"name":"TransferTicket","header":1096024149,"fields":[{"name":"ticket","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"newOwner","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"AtharMinter$Data","header":null,"fields":[{"name":"collection","type":{"kind":"simple","type":"address","optional":false}},{"name":"admin","type":{"kind":"simple","type":"address","optional":false}},{"name":"seasonId","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"rangeStart","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"rangeEnd","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"tiers","type":{"kind":"dict","key":"uint","keyFormat":8,"value":"TierState","valueFormat":"ref"}},{"name":"special","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":8}},{"name":"sold","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"bool"}},{"name":"pending","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"PendingMint","valueFormat":"ref"}},{"name":"reserved","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"bool"}},{"name":"pool","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"uint","valueFormat":16}},{"name":"tickets","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"Ticket","valueFormat":"ref"}},{"name":"poolSize","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"poolLoaded","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"ticketsSold","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"commitHash","type":{"kind":"simple","type":"uint","optional":false,"format":256}},{"name":"revealAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"revealed","type":{"kind":"simple","type":"bool","optional":false}},{"name":"permA","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"permB","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"auctions","type":{"kind":"dict","key":"uint","keyFormat":16,"value":"Auction","valueFormat":"ref"}},{"name":"wallets","type":{"kind":"dict","key":"address","value":"WalletCount","valueFormat":"ref"}},{"name":"status","type":{"kind":"simple","type":"uint","optional":false,"format":8}},{"name":"startAt","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"walletDailyCap","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"soldCount","type":{"kind":"simple","type":"uint","optional":false,"format":32}}]},
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
}

const AtharMinter_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"empty"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Configure"}},
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
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: null | Configure | AddSpecial | Open | SetPaused | Buy | MintOk | StartAuction | Bid | Settle | Sweep | LoadPool | SetMystery | BuyTicket | TransferTicket | Reveal | RevealPublic | ClaimTicket) {
        
        let body: Cell | null = null;
        if (message === null) {
            body = new Cell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Configure') {
            body = beginCell().store(storeConfigure(message)).endCell();
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
    
}