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
    const __code = Cell.fromHex('b5ee9c724102f101005366000228ff008e88f4a413f4bcf2c80bed5320e303ed43d9014e020271022e0201200325020120041a020120050f020120060902f9ac2476a268690000c7207d207d20408080eb806a00e8408080eb80408080eb801808128812081182e8aa81b6b6b6b6b6b6b6b82a3800298038389136b69136aa38889036b6b6b6b6a9aaf186889188920891889108918891089088910890889008908890088f8890088f888f088f888f088e888f088e888e088e888e404f0701b4111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c4108002c8010561b0280204133f40e6fa19401d70130925b6de20201200a0c02b0aa87ed44d0d200018e40fa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d7054700053007071226d6d226d547111206d6d6d6d6d5355e30ddb3c57105f0f57105f0f6c414f0b00022702f8a9f3ed44d0d200018e40fa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d7054700053007071226d6d226d547111206d6d6d6d6d5355e30d112311241123112211231122112111221121112011211120111f1120111f111e111f111e111d111e111d111c111d111c4f0d01e0111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c41206e92306d99206ef2d0806f266f06e2206e92306dde0e0064802056100259f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e202f9b35b7b513434800063903e903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c0014c01c1c489b5b489b551c44481b5b5b5b5b54d578c34448c4490448c4488448c4488448444884484448044844480447c4480447c4478447c447844744478447444704474447204f1001ac111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c6ce76ce76c871102ee70547000788edc20aa0f25a05622802022714133f40e6fa19401d70030925b6de26eb3917f8e26562180202259f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26eb3e29521ae15b104de561480202259f40f6fa192306ddfe430112311271123112211261122112111251121121300b6206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e2206eb399206ef2d0806f265f05923070e29521ae14b103de8020562102714133f40e6fa19401d70030925b6de26eb39520ae12b101dea401fc112011241120111f1127111f111e1126111e111d1125111d111c1124111c111b1127111b111a1126111a1119112511191118112411181117112711171116112611161115112511151114112411141113112711131112112611121111112511111110112411100f11270f0e11260e0d11250d0c11240c0b11270b0a11260a1402fa09112509081124080711270706112606051125050411240403112703021126020111250111245627db3c830f5629a0112411251124112311251123112211251122112111251121112011251120111f1125111f111e1125111e111d1125111d111c1125111c111b1125111b111a1125111a111911251119111811251118201502fe1117112511171116112511161115112511151114112511141113112511131112112511121111112511111110112511100f11250f0e11250e0d11250d0c11250c0b11250b0a11250a091125090811250807112507061125060511250504112504031125030211250201112501db3c8310562aa0112411251124112311251123201601fc112211251122112111251121112011251120111f1125111f111e1125111e111d1125111d111c1125111c111b1125111b111a1125111a1119112511191118112511181117112511171116112511161115112511151114112511141113112511131112112511121111112511111110112511100f11250f0e11250e0d11250d1702f60c11250c0b11250b0a11250a091125090811250807112507061125060511250504112504031125030211250201112501db3c8010561f02112c784133f40e6fa19401d70130925b6de26eb3061129060511280504112704031126030211250201112a011124112a1124112311291123112211281122112111271121201801fc112011261120111f1125111f111e1124111e111d1123111d111c1122111c111b1121111b111a1120111a1119111f11191118111e11181117111d11171116111c11161115111b11151114111a11141113111911131112111811121111111711111110111611100f11150f0e11140e0d11130d0c11120c0b11110b0a11100a190020109f108e107d10bc10ab109a1089107802039a881b1e02f7b2fda89a1a400031c81f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dada44daa8e22240dadadadadaa6abc61a224622482246224422462244224222442242224022422240223e2240223e223c223e223c223a223c223a2238223a223904f1c01b4111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c411d00605612b3917f945618c000e292306de05611801002a85611a05619a908561b5980204133f40e6fa19401d70130925b6de202f7b4dda89a1a400031c81f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dada44daa8e22240dadadadadaa6abc61a224622482246224422462244224222442242224022422240223e2240223e223c223e223c223a223c223a2238223a223904f1f01b4111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c412004f620db3cb3917f8e8520db3cc202e2923070e07821db3c56215959f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206e925b70e0562556255625562556255625562556255625562556255625562556255625562556255625562556255625562556255625562556255625bee9e92101f65625562556255625562556255625562556251124206ef2d0806f27112a114f112a1129114e11291128114d11281127114c11271126114b11261125114a1125112411491124112311481123112211471122112111461121112011451120111f1144111f111e1143111e111d1142111d111c1141111c111b1140111b2202fc111a113f111a1119113e11191118113d11181117113c11171116113b11161115113a11151114113911141113113811131112113711121111113611111110113511100f11340f0e11330e0d11320d0c11310c0b11300b0a112f0a09112e0908112d0807112c07db3c57105f0f57105f0f6c41112411251124112311241123d42301fc112211231122112111221121112011211120111f1120111f111e111f111e111d111e111d111c111d111c111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f10ef10de10cd10bc24012810ab109a1089107810671056104510341023db3c83020120262c020158272a02f9ac6cf6a268690000c7207d207d20408080eb806a00e8408080eb80408080eb801808128812081182e8aa81b6b6b6b6b6b6b6b82a3800298038389136b69136aa38889036b6b6b6b6a9aaf186889188920891889108918891089088910890889008908890088f8890088f888f088f888f088e888f088e888e088e888e404f2801b4111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c4129002a80102f0280204133f40e6fa19401d70130925b6de202b1aca8f6a268690000c7207d207d20408080eb806a00e8408080eb80408080eb801808128812081182e8aa81b6b6b6b6b6b6b6b82a3800298038389136b69136aa38889036b6b6b6b6a9aaf186ed9e2b882f87ab882f87b620c04f2b00022c02adb69fbda89a1a400031c81f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dada44daa8e22240dadadadadaa6abc61bb678d910d910d910d99104f2d0020561756165616561456165618561656160201202f43020148303a0201583138020120323502f7a40dda89a1a400031c81f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dada44daa8e22240dadadadadaa6abc61a224622482246224422462244224222442242224022422240223e2240223e223c223e223c223a223c223a2238223a22394f3301ac111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c6cc46cc46cc43400ec81010b2d0259f40b6fa192306ddf206e92306d8e11d0d31fd30fd30fd30fd30f55406c156f05e2206e953070547000e020206ef2d0806f2510345f0421206ef2d0806f255f04f82382015180a904bd923070de21206ef2d0806f2510245f0422206ef2d0806f25145f0403206ef2d0806f256c41413002f7a623da89a1a400031c81f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dada44daa8e22240dadadadadaa6abc61a224622482246224422462244224222442242224022422240223e2240223e223c223e223c223a223c223a2238223a22394f3601b4111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c4137002e8010561f02784133f40e6fa19401d70130925b6de26eb302b0a90aed44d0d200018e40fa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d7054700053007071226d6d226d547111206d6d6d6d6d5355e30ddb3c57105f0f57105f0f6c414f3900022a0201663b3e02f7a41dda89a1a400031c81f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dada44daa8e22240dadadadadaa6abc61a224622482246224422462244224222442242224022422240223e2240223e223c223e223c223a223c223a2238223a22394f3c01b4111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c413d0086561d802022714133f40e6fa19401d70030925b6de26eb392307f8e268020561d0259f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26eb3e202f7a58bda89a1a400031c81f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dada44daa8e22240dadadadadaa6abc61a224622482246224422462244224222442242224022422240223e2240223e223c223e223c223a223c223a2238223a22394f3f01ac111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c6cf56cf56c654002f67028782380204133f40e6fa19401d70130925b6de2206eb39631206ef2d0809130e27028782480204133f40e6fa19401d70130925b6de2206eb39631206ef2d0809130e27028782559f40e6fa193fa003092306de2206eb39631206ef2d0809130e27028782659f40e6fa193fa003092306de2206eb39130e30d704142000c31206ef2d080004c7854491780104133f40e6fa19401d70130925b6de2206eb3983504206ef2d080049130e25503020148444b020162454802f7a537da89a1a400031c81f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dada44daa8e22240dadadadadaa6abc61a224622482246224422462244224222442242224022422240223e2240223e223c223e223c223a223c223a2238223a22394f4601b4111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c41470104db3cc202f7a647da89a1a400031c81f481f481020203ae01a803a1020203ae01020203ae0060204a204820460ba2aa06dadadadadadadae0a8e000a600e0e244dada44daa8e22240dadadadadaa6abc61a224622482246224422462244224222442242224022422240223e2240223e223c223e223c223a223c223a2238223a22394f4901e0111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c41206e92306d99206ef2d0806f236f03e2206e92306dde4a00448010561a0259f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e202f9b146fb513434800063903e903e9020404075c035007420404075c020404075c00c040944090408c1745540db5b5b5b5b5b5b5c151c0014c01c1c489b5b489b551c44481b5b5b5b5b54d578c34448c4490448c4488448c4488448444884484448044844480447c4480447c4478447c447844744478447444704474447204f4c01b4111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550edb3c57105f0f57105f0f6c414d01727856200259f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206e923070e0206ef2d0806f27db3cd403f03001d072d721d200d200fa4021103450666f04f86102f862ed44d0d200018e40fa40fa40810101d700d401d0810101d700810101d7003010251024102305d155036d6d6d6d6d6d6d7054700053007071226d6d226d547111206d6d6d6d6d5355e30d1125e302705624d74920c21f97311124d31f1125de214f526001f8db3c5724112211231122112111221121112011211120111f1120111f111e111f111e111d111e111d111c111d111c111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550e5001ecfa40fa40d30fd33fd33ff404d401d0f404f404f404d430d0f404f404f404d30fd30fd30fd30fd3ffd31fd200d31fd31fd430d0f404f404d30ff404d307d31fd30fd31fd430d0f404f404f404d430d0f404f404fa00d30f30111e1124111e111e1123111e111e1122111e111e1121111e111e1120111e51000c111e111f111e014211238020d7217021d749c21f9430d31f01de821041540002bae3025f0f5f0f5f075304fed33f0131561a80202259f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e2206ee30280206dc8216e925b6d8e1701206ef2d0806f24550355305034ce01fa02cb07cb0fc9e202111d025230206e953059f45b30944133f417e2561b206ef2d0806f24135f03c001e30f1121112311211120112211205455575e01f25b112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551ced01fe571b2d80202259f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e2206ef2d0806f26357f04431366060504431380205026c855505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc9031110031201111001206e953059f45b30944133f417e256001a011123010da0821004c4b400a002fc561b206ef2d0806f24135f03c0028e6a318010561b206ef2d0806f246c3156195959f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e2206ef2d0806f23308010111d206ef2d0806f246c315970c855205023ce01fa02ca00c90311190302111c02206e953059f45b30944133f417e21123a4e30e1123585d02fe01db3c112311241123112211231122112111221121112011211120111f1120111f111e111f111e111d111e111d111c111d111c01111c01111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f10efe95903fc10de10cd10bc10ab109a108910781067105610451034413001112501db3c5624206ef2d0806f245f031125206ef2d0806f2410235f037370880411280410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00111711231117112211215a5b5c009026782280204133f40e6fa19401d70130925b6de2206eb39820206ef2d080c2009170e28e207801206ef2d080a51038128020216e955b59f45b3098c801cf014133f443e205915be2002000000000617468617220726566756e64007c1120111f111e111d111c111b111a111911181117011116010111150101111401011113010111120101111101011110011f1e1d1c1b1a191817161514433000081116112201fc111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a107910681057104610355f01704403c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee044a821041540040bae30221821041540049bae3022182104154004abae30221821041540065ba6166686b02fe5b1123d307fa00fa00fa00d30fd30fd31ffa00fa00d30f3081557df842562cc705f2f48200b7315613c000f2f48151e42ac103f2f48178a928c200935389bb9170e2935397bb9170e2f2f48200c583268107d0bb9525811388bb9170e2f2f48200adc024c200f2f48200ce9c22821077359400bb9170e30df2f4787020106b62630012238218174876e800bb01fe105a104910381027c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc9021123025260206e953059f45b30944133f417e219785420558020216e955b59f45b3098c801cf014133f443e2167854204a206e953059f45b3098c801fa024133f443e21478542037206e953059f45b3098c801fa024133f443e27859111f6401fc8010216e955b59f45b3098c801cf014133f443e2112111231121112011221120111f1121111f111e1120111e111d111f111d01111e01111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211106501ae0f11110f0e11100e10df10ce10bd10ac109b108a10791068105710461035401403c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee01fc5b1123d307fa00fa003081557df8425625c705f2f4813e6d23c103f2f48200ce9c22821077359400bb99218218174876e800bb9170e2f2f41578542037206e953059f45b3098c801fa024133f443e21023784005206e953059f45b3098c801fa024133f443e2112111231121112011221120111f1121111f111e1120111e6701e8111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a107910681057104610354143ed01fe5b1123d307d31f3081557df8425624c705f2f48200c23c22c1089321c2009170e2f2f426782380204133f40e6fa19401d70130925b6de22b8e178200cc91216eb39901206ef2d0805220b9923170e2f2f49130e225782380204133f40e6fa19401d70130925b6de2206eb39e81592601206ef2d0805220bef2f49130e210266901f878598020216e955b59f45b3098c801cf014133f443e2112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311116a01b61110111211100f11110f0e11100e10df10ce10bd10ac109b108a1079106810570610354403c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee043ce30221821041540041bae30221821041540042bae30221821041540043ba6c6f717701fe5b1123d307fa00fa003081557df8425625c705f2f4820080bc2cc300f2f48155f123c103917f9323c00fe2f2f48178a922820afaf080be935321bb9170e299218219d1a94a2000bb9170e2f2f4561f782459f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e28172ad216eb3f2f46d01f4206ef2d0806f2734345346b993342504de5345bc93342404de10451046103658785077c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc903111f0312206e953059f45b30944133f417e2112111231121112011221120111f1121111f111e1120111e111d111f111d111e111b111d111b111a111c111a6e01b81119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a107910681057104610354403ed02f45b1123f4043081557df8425623c705f2f48200b7312ac000f2f42080107859f4866fa520965023d7013058966c216d326d01e2908ae85f03112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a111811171119111770c900b481784422c2ff962282008eacbb9170e29321c2ff9170e29321c1039170e2f2f401111e01801001561f0178216e955b59f45b3098c801cf014133f443e280102202111f784133f47c6fa520965023d7013058966c216d326d01e203fe5b37371121d31fd30f3081557df8425622c705f2f48200b73109c00019f2f48200c013561c787059f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb39170e30d9170e30df2f470788e1d820088fd25782380204133f40e6fa19401d70130925b6de26eb3f2f4a4e43081302c7273740058561c787159f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb30058561c787259f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb302fc56135616ba9556135615ba9170e2f2f4712170738ae43032112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a1118111711191117111611181116111511171115111411161114111311151113111211141112111111131111757600dc561e782259f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f2731291056104610361026784717c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc902112002562001206e953059f45b30944133f417e2111ea401b21110111211100f11110f0e11100e10df10ce10bd10ac109b509a105710461035441359c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee02fc8efa5b1123d2003081557df8425623c705f2f4815eb10ac3001af2f40891729171e2112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a1118111711191117111611181116111511171115111411161114111311151113e021787901ce1112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b0a107910681057104610354403c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee044a821041540044bae30221821041540057bae30221821041540005bae30221821041540045ba7a939ea001fa5b1123d33fd72c01916d93fa4001e201d307d3ffd30730f8416f243032112211281122112111271121112011261120111f1125111f111e1124111e111d1123111d111c1128111c111b1127111b111a1126111a1119112511191118112411181117112311171116112811161115112711151114112611141113112511137b04d81112112411121111112311111110112811100f11270f0e11260e0d11250d0c11240c0b11230b0a11280a0911270908112608071125070611240605112305041128040311270302112602011125011129816e74112bdb3c01112c01f2f48132965625db3cf2f45624db3c5625d0bee97c02fadb3c8200d1f822c103f2f4112311241123112211241122112111241121112011241120111f1124111f111e1124111e111d1124111d111c1124111c111b1124111b111a1124111a111911241119111811241118111711241117111611241116111511241115111411241114111311241113111211241112111111241111c07d03fa1110112411100f11240f0e11240e0d11240d0c11240c0b11240b0a11240a091124090811240807112407061124060511240504112404031124030211240201112401112c8200b858112ddb3c01112d01f2f4815da7561c80205628714133f40e6fa19401d70030925b6de26e9170e30df2f48200baab561a8020562871c27e7f004c561b8020562859f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26e01f64133f40e6fa19401d70030925b6de26ef2f481365c5628c102f2f4811922562ac10af2f4561d78562559f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f275436545475432b112a112f112a1129112e11291128112d11281127112c11271126112b11268001fc1125112f11251124112e11241123112d11231122112c11221121112b11211120112f1120111f112e111f111e112d111e111d112c111d111c112b111c111b112f111b111a112e111a1119112d11191118112c11181117112b11171116112f11161115112e11151114112d11141113112c11131112112b11121111112f11118102f41110112e11100f112d0f0e112c0e0d112b0d0c112f0c0b112e0b0a112d0a09112c0908112b0807113807db3c112311241123112211241122112111241121112011241120111f1124111f111e1124111e111d1124111d111c1124111c111b1124111b111a1124111a111911241119111811241118111711241117d48202fa1116112411161115112411151114112411141113112411131112112411121111112411111110112411100f11240f0e11240e0d11240d0c11240c0b11240b0a11240a0911240911240807065540562c5625db3c701130c0018e1a572f2478562c59f40e6fa193fa003092306de2206ef2d080112fde8200bb8a215631a0838903b421db3c02db3c5cdb3c20c002953122aa0001dec001973001a703ab00019132e28010562102784133f40e6fa19401d70130925b6de26eb38e1e7854461359f40e6fa193fa003092306de2206eb396206ef2d080a09130e29131e2e9c08403f6db3c2082080f4240a822812710a8a023a0db3c20ab0001a93800c00192307f92c103e2935f0372e05301ba9a20c00b917f9320c016e29170e2935f0372e020c01d9321c0029170e2935f0372e05301ba97228064a90821ba9170e2935f0372e020c0019321c0019170e297028064a908c000923270e2925b72e05c85878801f6811c89a182080afa6ca02082023ab1a9042082023ab1a812a1208105b4a9045210a12182008eaca904a02182023ab0a904a181016da90402810190a85220a081016d23a823ab01a0038064a90413a1a120a705a602810099a90481009921a8a60275a90412a1a421c10a9301a6039301a6f7e220c1039302a402de860002010074207020788e12227aa90820ae13b101a70a58a0027aa90402e43270207a9d5320ad71b0c0019301a401dea4e43031017003ba927132deaa0001a000ceba925b71e021c0019320c0019170e2925b71e021c001917f9321c00ae2917f9321c014e2917f9321c01ee29a20c001917f9320c00ae29170e2925b71e021c00a9320c0019170e2925b71e021c0149320c0029170e2925b71e001c01e92c003923070e29171e07002fe821004c4b400a0563001bef2f45632562d6eb39a30112c206ef2d080112c92572de2f82382015180a90470547000245530561281010b563a59f40b6fa192306ddf206e92306d8e11d0d31fd30fd30fd30fd30f55406c156f05e2206eb38e166c51206ef2d0806f255345bd963333433070029135e2923035e22ec200e300708a8b001081274c533fb9f2f401e22978563380104133f40e6fa19401d70130925b6de2206eb39631206ef2d0809130e256318e1020c200988112235331b9f2f4de02a402df5631c0018e1020c200988112235321b9f2f4de01a401de5631c0028e1220c200982581122302b9f2f49130e204a4049130e202a481010b5035c88c01fa55405045cb1f12cb0fcb0fcb0fcb0fc9102e563401206e953059f45930944133f413e2112311241123112211241122112111241121112011241120111f1124111f111e1124111e111d1124111d111c1124111c111b1124111b111a1124111a1119112411191118112411181117112411171116112411161115112411158d02f81114112411141113112411131112112411121111112411111110112411100f11240f0e11240e0d11240d0c11240c55a0562bdb3c705634c20095f8235635bc9170e29c30f8235634a182015180a904de8127105629a001112701a8812710a90420562abc93305628de112682015180a801113401a0112aa405112505c68e01fe0411290403112803021127020111260178112b01c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc90211190201112501562601206e953059f45b30944133f417e28020561e562aa0820b938700a07020562f5520c855305034ce01fa02cb07cb0fc902111602562801206e953059f45b30944133f417e2561d56298f02fca0820b938700a0717f5620562ca005112a0504112904561e04031129035622030211300201112f011130c855708210415400025009cb1f17cb3f15ce13cb0fcb0701fa02cb07cbff01fa02c9561b040311290302112402112a0110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf818ae29091001a58cf8680cf8480f400f400cf8102f8f400c901fb00011122011118a1011122a1821004c4b400a1208208989680bc8ebe7370880411270410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0093305723e2111311231113111211221112111111211111111011201110da92019c0f111f0f0b111e0b0d111d0d0c111c0c0c111b0c0a111a0a0911190908111808071117070611160605111505041114040311130302111202011111011110102f102e10bd104c50ba104947865003ed01f45b1123d33fd72c01916d93fa4001e201d307d3ff30f8416f24303281557df8425628c705f2f4112211271122112111261121112011251120111f1124111f111e1123111e111d1127111d111c1126111c111b1125111b111a1124111a1119112311191118112711181117112611171116112511161115112411159404f81114112311141113112711131112112611121111112511111110112411100f11230f0e11270e0d11260d0c11250c0b11240b0a11230a0911270908112608071125070611240605112305041127040311260302112502011124011128816e74112adb3c01112b01f2f48132965624db3cf2f45623db3c8200b8585625d0bee99502f4db3c112411251124112311251123112211251122112111251121112011251120111f1125111f111e1125111e111d1125111d111c1125111c111b1125111b111a1125111a111911251119111811251118111711251117111611251116111511251115111411251114111311251113111211251112111111251111c09603f81110112511100f11250f0e11250e0d11250d0c11250c0b11250b0a11250a091125090811250807112507061125060511250504112504031125030211250201112c01db3c01112c01f2f4815da7561c80205627714133f40e6fa19401d70030925b6de26e9170e30df2f48200c8e82e8020562759f40f6fa192306ddfc29798004c561b8020562759f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26e01fe206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e26ef2f482008cf0561a80205627714133f40e6fa19401d70030925b6de26ef2f48119225628c10af2f48124f15626821004c4b400bef2f4112211231122112111221121112011211120111f1120111f111e111f111e111d111e111d9902fa111c111d111c111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100f550e112a562adb3c562956296eb39a301128206ef2d0801128925729e28020820b9387007020562d5520c8c69a01fc55305034ce01fa02cb07cb0fc902111d02562601206e953059f45b30944133f417e2820b938700717f70200611290605112d0556260504113004102302112d02112c01c855708210415400025009cb1f17cb3f15ce13cb0fcb0701fa02cb07cbff01fa02c95622040311260302112a0211270110246d50436d03c8cf85809b02fcca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb001120821004c4b400a1208208989680bc93305723e30d111c1123111c111b1122111b111a1121111a1119112011191118111f11181117111e11171116111d11161115111c1115111a111b111a1113111a11139c9d017c7370880411270410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00da01dc1112111911121111111811111110111711100f11160f0e11150e0d11140d0c11130c0b11120b0a11110a09111009108f107e556610564015c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee01f65b1123d33f308200aa5af8425624c705f2f480206dc8216e925b6d8e1701206ef2d0806f24550355305034ce01fa02cb07cb0fc9e202111c02561c01206e953059f45b30944133f417e201111b01802001111b7f71216e955b59f45b3098c801cf004133f443e205a4112111231121112011221120111f1121111f9f01ee111e1120111e111d111f111d111c111e111c111b111d111b05111c051119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a1079106807104610354430ed02fe8efd5b1123d33ffa00d31fd3ff3081557df8425626c705f2f4112211251122112111241121112011231120111f1125111f111e1124111e111d1123111d111c1125111c111b1124111b111a1123111a111911251119111811241118111711231117111611251116111511241115111411231114111311251113111211241112a1aa04e21111112311111110112511100f11240f0e11230e0d11250d0c11240c0b11230b0a11250a0911240908112308071125070611240605112305041125040311240302112302011125011126816e741128db3c01112901f2f48132965625db3cf2f4810eb65625db3cc202f2f48200b8585625d0bee9a204fadb3c01112901db3c01112901f2f482008cf0561a80205627714133f40e6fa19401d70030925b6de26ef2f4815da7561c80205627714133f40e6fa19401d70030925b6de26e8e26561b8020562759f40f6fa192306ddf206e92306d9fd0fa40fa00d307d30f55306c146f04e26e9170e2f2f48137ae5624c2009170e30dc0c2a3a4000c5626810e10be02f89856268209e13380bb9170e2f2f42d8020562659f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e2813488216e917f8e1f21206ef2d0806f26155f056e9ff82322206ef2d0806f2610455f05be9170e2e2f2f46ee30080207ff823011128a00311270302a5a802f85624db3c112311241123112211231122112111221121112011211120111f1120111f111e111f111e111d111e111d111c111d111c111b111c111b111a111b111a1119111a1119111811191118111711181117111611171116111511161115111411151114111311141113111211131112111111121111111011111110e9a602f80f11100f10ef10de10cd10bc10ab109a108910781067105610451034413001112801db3c0d80102d56268020216e955b59f45b3098c801cf014133f443e20ca40d11270d0d11230d0d11220d0d11210d0d11200d0d111f0d0d111e0d0d111d0d0d111c0d0d111b0d0d111a0d0d11190d0d11180d0d11170d0d11160dc6a7003c0d11150d0d11140d0d11130d0d11120d0d11110d0d11100d10df10de55a001f801112501706d58112ac855505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc9103c0211220201112301206e953059f45b30944133f417e2111e1123111e111d1122111d111c1121111c111b1120111b111a111f111a1119111e11191118111d11181117111c11171116111b11161115111a1115a901f81114111911141113111811131112111711121111111611111110111511100f11140f0e11130e0d11120d0c11110c0b11100b10af0e108d107c106b105a104910384760144305c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee044ee021821041540046bae30221821041540047bae30221821041540048bae30221821041540050baabb2b9bc02f85b1123d33f30f8416f2430322f80202459f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e2813ca1216eb39a21206ef2d0806f265f059170e29ff82322206ef2d0806f2610455f05b99170e2f2f4206ef2d0806f2627821004c4b400a153426eb3e30021acad001430238014a9045240a0a403fe8200afbe02bef2f4226eb38ec822206ef2d08024821004c4b400a073708810246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00de70036eb39a3202821004c4b400a0589133e201112b0107a001112aa1f8235230a181012cb9e3001034aeafb00020000000006174686172206f7574626964001032f82381012ca00201fe11295502802006c855505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc9103f12206e953059f45b30944133f417e2112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a1118111711191117111611181116b101f21115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df0e10bd10ac109b108a107910681057104610354403c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee01f45b1123d33f302d80202259f40f6fa192306ddf206e92306d8e1cd0d200d31ffa00fa00d72c01916d93fa4001e201d3ff55506c166f06e2811494216eb39a21206ef2d0806f265f059170e29ff82322206ef2d0806f2610455f05be9170e2f2f4206ef2d0806f263582009fc1562080202859f40f6fa192306ddfb302f4206e92306d9fd0fa40fa00d307d30f55306c146f04e26e8e165621802028714133f40e6fa19401d70030925b6de26e9170e2f2f4206ee302700180205415435367c855505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc902111202011112015250206e953059f45b30944133f417e25610b4b601f47004431380205026c855505056ca0013cb1f01fa0201fa0201206e9430cf84809201cee2cbffc9103f12206e953059f45b30944133f417e2112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a1118111711191117b501fe1116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df0e10bd10ac109b108a107910681057104610354403c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee02c6821004c4b400a001112701a1802022206ef2d0805612821004c4b400a07170c855305034ce01fa02cb07cb0fc902111f025250206e953059f45b30944133f417e25610820b938700a0717f04206ef2d08026db3c1047137056284314561603111719c8e9b701fa55708210415400025009cb1f17cb3f15ce13cb0fcb0701fa02cb07cbff01fa02c95625041111552010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00112111231121112011221120111f1121111f111e1120111e111d111f111db801b0111c111e111c111b111d111b111a111c111a0c111b0c1118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551bed02f65b572381557df8425622c705f2f4820afaf0805623a05624820b938700a8a072fb027081008270885624553010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00112111231121112011221120111f1121111f111e1120111ebabb001e00000000617468617220737765657001c0111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551ced03fe8f7b5b1123f4043081557df8425623c705f2f48200b7312ac000f2f4208010802059f4866fa520965023d7013058966c216d326d01e2908ae85f03112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a1118111711191117e021bdc9ca04ac8200e81c22810fa0b98e8321db3c9170e2e30f01112801f2f48200dfee56198010562680204133f40e6fa19401d70130925b6de26ef2f482009a58561a80205628714133f40e6fa19401d70030925b6de26ef2f45625bebfc3c4003620c2ff97208208078eacbb9170e298a9380f82008eacbb923070e202f621db3c112411261124112311251123112211261122112111251121112011261120111f1125111f111e1126111e111d1125111d111c1126111c111b1125111b111a1126111a111911251119111811261118111711251117111611261116111511251115111411261114111311251113111211261112111111251111c0c10006a9380f01881110112611100f11250f0e11260e0d11250d0c11260c0b11250b0a11260a091125090811260807112507061126060511250504112604031125030211270201112801db3cc2004e205622be94205621bb9170e292307fe08010561f02784133f40e6fa19401d70130925b6de26eb300ea11270111260103112503021124020311230302112202031121030211200203111f0302111e0203111d0302111c0203111b0302111a0203111903021118020311170302111602031115030211140203111303021112020311110302111002103f102e103d102c103b102a1039102810375e3210247002fcdb3c112311241123112211231122112111221121112011211120111f1120111f111e111f111e111d111e111d111c111d111c111b111c111b111a111b111a1119111a11191118111911181117111811171116111711161115111611151114111511141113111411131112111311121111111211111110111111100f11100fe9c502e810ef10de10cd10bc10ab109a108910781067105610451034413001112701db3c11198010562756278020216e955b59f45b3098c801cf014133f443e21115a401111a0180200111267f71216e955b59f45b3098c801cf004133f443e25625a45617bc9757165624a41116de801056240211278020c6c700d427782280204133f40e6fa19401d70130925b6de28200d43e216eb3f2f47028782480204133f40e6fa19401d70130925b6de2206eb39631206ef2d0809130e28200a73302206ef2d0805210b912f2f47801a41038128020216e955b59f45b3098c801cf014133f443e20501f84133f47c6fa520965023d7013058966c216d326d01e2111a1127111a111b1126111b112411251124112311241123112211231122112111221121112011211120111f1120111f111e111f111e111d111e111d111c111d111c111a111c111a1116111b11161119111a1119111811191118111711181117111611171116c800801115111611151114111511141113111411131112111311121111111211111110111111100f11100f10ef10de10cd10bc10ab109a10891078106710561045103401d81116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551cc87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee044a821041540051bae30221821041540052bae30221821041540055bae30221821041540053bacbcedcdf01f85b5711571157131120d3ffd31ffa00fa00fa00d30fd30fd30f3081557df8425627c705f2f48200b7312ec000f2f48178a925c200935356bb9170e2935364bb9170e2f2f481447921c2009521810fa0bb9170e2f2f478800f702010691058104710391028c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc9cc01f803111f0302111f0201111f01206e953059f45b30944133f417e2112111231121112011221120111f1121111f111e1120111e111d111f111d111e111b111d111b111a111c111a1119111b11191118111a111811171119111711161118111611151117111511131115111311121114111202111302011112010f11110fcd01a80e11100e10df10ce10bd10ac109b108a1079106810571046103550444313c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee01f45b1123d72c01916d93fa4001e231f8416f243032112211241122112111231121112011241120111f1123111f111e1124111e111d1123111d111c1124111c111b1123111b111a1124111a111911231119111811241118111711231117111611241116111511231115111411241114111311231113111211241112cf02d21111112311111110112411100f11230f0e11240e0d11230d0c11240c0b11230b0a11240a0911230908112408071123070611240605112305041124040311230302112402011123011125816e741127db3c01112801f2f48200e14c561e78800f59f40f6fa192306ddfd0d100162ac00194f8232abe9170e201fa206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e26eb3945617c2009170e2f2f481513ef8235613b9935611b39170e2f2f481767056145618b9f2f4561d78800f59f40f6fa192306ddf206e92306d8e15d0fa00fa00fa00d30fd30fd31fd31f55606c176f07e2206ef2d0806f275436545475432bd201fc112a112f112a1129112e11291128112d11281127112c11271126112b11261125112f11251124112e11241123112d11231122112c11221121112b11211120112f1120111f112e111f111e112d111e111d112c111d111c112b111c111b112f111b111a112e111a1119112d11191118112c11181117112b11171116112f1116d304fe1115112e11151114112d11141113112c11131112112b11121111112f11111110112e11100f112d0f0e112c0e0d112b0d0c112f0c0b112e0b0a112d0a09112c0908112b0807113307db3c8200bb8a21821004c4b400a0562c01bef2f4562c562c6eb39a30112b206ef2d080112b92572ce270562ec2009170e30de300812710d4d5d6d70088306c22f82321bc9320c2009170e28e2af82301a182015180a90420c27893308078de8e1481271021a113a8812710a9045301b9923020de02e430915be25cb991319130e2000af823562fbc001830f823562ea182015180a90401fe5628a05220a8812710a90420562abc93305628de78800f0382015180a801113101a0112ca41605112b0504112a04031129030211280201112c01c855605076fa025004fa0258fa02cb0fcb0f12cb1fcb1fc903111c0302112a0201112201206e953059f45b30944133f417e280101126562170c855205023ce01fa02ca00c9d801f80211140201112601561001206e953059f45b30944133f417e20ea41120a471706f00c8013082104154000301cb1fc95620035623413310246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0001112301111fa1821004c4b400a120d902f68208989680bc8ebe7370880411270410246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0093305723e2111a1123111a1119112211191118112111181117112011171116111f11161118111e11181114111d11141113111c1113dadb0020000000006174686172206368616e676501f41112111b11121111111a11111110111911100b11180b0e11170e0d11160d0c11150c0a11130a091112090811110807111007106f105e104d103c4ba91078105703054444c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee01e45b1123d30ffa4030561880102359f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e28200b99e216eb39d21206ef2d0806f235bf842c7059170e29b21206ef2d0806f236c21b39170e2f2f4801001206ef2d0806f2330311270c855205023ce01fa02ca00c90311190312dd01fc206e953059f45b30944133f417e2112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a111811171119111711181115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100ede019c10df10ce10bd10ac109b108a107910681057104610354403c87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee0446e30221821041540056bae30221821041540054bae3025725c0001124c12101112401b0e0e2e6ec01fe5b1123d3ff3081557df8425623c705f2f4815c905611b3f2f482009b17f8235613be945613c3009170e2f2f4816259c85220cbffc9d09b9320d74a91d5e868f90400da115614baf2f4112211241122112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111ae102be1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df10ce10bd10ac109b108a10791068105710461035443012db3ce4ed01fa5b5723815c905610b3f2f4820085c95616c2009af82356128203f480a0be9170e2f2f4112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a1118111711191117111611181116111511171115111411161114111311151113e302ae1112111411121111111311111110111211100f11110f0e11100e10df551c70db3cc87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54e4ee01d6571057105710f825f815f8446e97f825f8157ff864def810c81fcbff1ecbffc9d09b9320d74a91d5e868f90400da1156157121c201983020a55220a908a4de708e905312db3cc3019622a6025210b99170e2975112a908a401a4e83002ab3f01a9087f1111021110024f0fe5001091209366a908e83001fc5b1123d30f30812f2e5611f2f4561780102259f40f6fa192306ddf206e92306d9dd0fa40fa00d20055206c136f03e28200c552216eb39b21206ef2d0806f236c21b39170e2f2f4561022a85610a05618a9088010561b0280204133f40e6fa19401d70130925b6de2206ef2d080813ca5561d80202359f40f6fa192306ddfe701fe206e92306d9fd0fa40fa00d307d30f55306c146f04e26e8e16561e802023714133f40e6fa19401d70030925b6de26e9170e2f2f4801022206ef2d0806f235b23206ef2d0806f2330317fc855205023ce01fa02ca00c902111b025240206e953059f45b30944133f417e21126a5802022206ef2d0806f235b820b9387005872e802f85006c855305034ce01fa02cb07cb0fc902111d0213561a01206e953059f45b30944133f417e2820b938700717f561e206ef2d0806f235b561cdb3c1120206ef2d0806f23303170530006112006104556290511245530c855708210415400025009cb1f17cb3f15ce13cb0fcb0701fa02cb07cbff01fa02c956254314e9ea0004ab0f01f402111b02111e0110246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1116111b11161118111a1118eb01e41117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551cc87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee02fe8ef8112111231121112011221120111f1121111f111e1120111e111d111f111d111c111e111c111b111d111b111a111c111a1119111b11191118111a11181117111911171116111811161115111711151114111611141113111511131112111411121111111311111110111211100f11110f0e11100e10df551ce05f0f5f0fedf0016cc87f01ca0011241123112211211120111f111e111d111c111b111a111911181117111611151114111311121111111055e0db3cc9ed54ee01f6011123011124ce01112101ce01111f01cb0f01111d01cb3f01111b01cb3f01111901f4001117c8f40001111601f40001111401f4001112c8f40001111101f4001ff4001dcb0f1bcb0f19cb0f17cb0f15cbff13cb1fca00cb1fcb1f01c8f40012f40012cb0f12f40012cb0712cb1f13cb0f13cb1f04c8f40015f400ef003215f40005c8f40016f4005006fa0216cb0f12cd13cd13cdcdcd000a5f06f2c0828100ef3e');
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

const AtharMinter_getters: ABIGetter[] = [
    {"name":"status","methodId":101642,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"mystery_info","methodId":95485,"arguments":[],"returnType":{"kind":"simple","type":"MysteryInfo","optional":false}},
    {"name":"pool_at","methodId":65608,"arguments":[{"name":"pos","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"int","optional":true,"format":257}},
    {"name":"ticket_of","methodId":115491,"arguments":[{"name":"ticket","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"Ticket","optional":true}},
    {"name":"ticket_date","methodId":78871,"arguments":[{"name":"ticket","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"int","optional":true,"format":257}},
    {"name":"sold_count","methodId":68231,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"is_taken","methodId":103438,"arguments":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"bool","optional":false}},
    {"name":"in_season","methodId":114843,"arguments":[{"name":"date","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"bool","optional":false}},
    {"name":"is_special","methodId":101137,"arguments":[{"name":"date","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"bool","optional":false}},
    {"name":"price","methodId":120091,"arguments":[{"name":"kind","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"price_of","methodId":78950,"arguments":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"auction_of","methodId":69107,"arguments":[{"name":"id","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"Auction","optional":true}},
    {"name":"auction_count","methodId":88401,"arguments":[],"returnType":{"kind":"simple","type":"int","optional":false,"format":257}},
    {"name":"auction_id_at","methodId":86233,"arguments":[{"name":"pos","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"int","optional":true,"format":257}},
    {"name":"date_view","methodId":73069,"arguments":[{"name":"date","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"DateView","optional":false}},
    {"name":"kind_info","methodId":104133,"arguments":[{"name":"kind","type":{"kind":"simple","type":"int","optional":false,"format":257}}],"returnType":{"kind":"simple","type":"KindInfo","optional":false}},
    {"name":"wallet_info","methodId":100358,"arguments":[{"name":"who","type":{"kind":"simple","type":"address","optional":false}}],"returnType":{"kind":"simple","type":"WalletInfo","optional":false}},
]

export const AtharMinter_getterMapping: { [key: string]: string } = {
    'status': 'getStatus',
    'mystery_info': 'getMysteryInfo',
    'pool_at': 'getPoolAt',
    'ticket_of': 'getTicketOf',
    'ticket_date': 'getTicketDate',
    'sold_count': 'getSoldCount',
    'is_taken': 'getIsTaken',
    'in_season': 'getInSeason',
    'is_special': 'getIsSpecial',
    'price': 'getPrice',
    'price_of': 'getPriceOf',
    'auction_of': 'getAuctionOf',
    'auction_count': 'getAuctionCount',
    'auction_id_at': 'getAuctionIdAt',
    'date_view': 'getDateView',
    'kind_info': 'getKindInfo',
    'wallet_info': 'getWalletInfo',
}

const AtharMinter_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"empty"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Configure"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetKindFees"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetCap"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Reprice"}},
    {"receiver":"internal","message":{"kind":"typed","type":"AddSpecial"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Open"}},
    {"receiver":"internal","message":{"kind":"typed","type":"SetPaused"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Buy"}},
    {"receiver":"internal","message":{"kind":"typed","type":"AdminMint"}},
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
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: null | Configure | SetKindFees | SetCap | Reprice | AddSpecial | Open | SetPaused | Buy | AdminMint | MintOk | StartAuction | Bid | Settle | Sweep | LoadPool | SetMystery | BuyTicket | TransferTicket | Reveal | RevealPublic | ClaimTicket) {
        
        let body: Cell | null = null;
        if (message === null) {
            body = new Cell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Configure') {
            body = beginCell().store(storeConfigure(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetKindFees') {
            body = beginCell().store(storeSetKindFees(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetCap') {
            body = beginCell().store(storeSetCap(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Reprice') {
            body = beginCell().store(storeReprice(message)).endCell();
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
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'AdminMint') {
            body = beginCell().store(storeAdminMint(message)).endCell();
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
    
    async getIsTaken(provider: ContractProvider, id: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(id);
        const source = (await provider.get('is_taken', builder.build())).stack;
        const result = source.readBoolean();
        return result;
    }
    
    async getInSeason(provider: ContractProvider, date: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(date);
        const source = (await provider.get('in_season', builder.build())).stack;
        const result = source.readBoolean();
        return result;
    }
    
    async getIsSpecial(provider: ContractProvider, date: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(date);
        const source = (await provider.get('is_special', builder.build())).stack;
        const result = source.readBoolean();
        return result;
    }
    
    async getPrice(provider: ContractProvider, kind: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(kind);
        const source = (await provider.get('price', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getPriceOf(provider: ContractProvider, id: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(id);
        const source = (await provider.get('price_of', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getAuctionOf(provider: ContractProvider, id: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(id);
        const source = (await provider.get('auction_of', builder.build())).stack;
        const result_p = source.readTupleOpt();
        const result = result_p ? loadTupleAuction(result_p) : null;
        return result;
    }
    
    async getAuctionCount(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('auction_count', builder.build())).stack;
        const result = source.readBigNumber();
        return result;
    }
    
    async getAuctionIdAt(provider: ContractProvider, pos: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(pos);
        const source = (await provider.get('auction_id_at', builder.build())).stack;
        const result = source.readBigNumberOpt();
        return result;
    }
    
    async getDateView(provider: ContractProvider, date: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(date);
        const source = (await provider.get('date_view', builder.build())).stack;
        const result = loadGetterTupleDateView(source);
        return result;
    }
    
    async getKindInfo(provider: ContractProvider, kind: bigint) {
        const builder = new TupleBuilder();
        builder.writeNumber(kind);
        const source = (await provider.get('kind_info', builder.build())).stack;
        const result = loadGetterTupleKindInfo(source);
        return result;
    }
    
    async getWalletInfo(provider: ContractProvider, who: Address) {
        const builder = new TupleBuilder();
        builder.writeAddress(who);
        const source = (await provider.get('wallet_info', builder.build())).stack;
        const result = loadGetterTupleWalletInfo(source);
        return result;
    }
    
}