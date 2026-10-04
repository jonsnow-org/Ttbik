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

export type SetPrice = {
    $$type: 'SetPrice';
    price: bigint;
}

export function storeSetPrice(src: SetPrice) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1096024208, 32);
        b_0.storeCoins(src.price);
    };
}

export function loadSetPrice(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1096024208) { throw Error('Invalid prefix'); }
    const _price = sc_0.loadCoins();
    return { $$type: 'SetPrice' as const, price: _price };
}

export function loadTupleSetPrice(source: TupleReader) {
    const _price = source.readBigNumber();
    return { $$type: 'SetPrice' as const, price: _price };
}

export function loadGetterTupleSetPrice(source: TupleReader) {
    const _price = source.readBigNumber();
    return { $$type: 'SetPrice' as const, price: _price };
}

export function storeTupleSetPrice(source: SetPrice) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.price);
    return builder.build();
}

export function dictValueParserSetPrice(): DictionaryValue<SetPrice> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSetPrice(src)).endCell());
        },
        parse: (src) => {
            return loadSetPrice(src.loadRef().beginParse());
        }
    }
}

export type MockSuccessor$Data = {
    $$type: 'MockSuccessor$Data';
    price: bigint;
}

export function storeMockSuccessor$Data(src: MockSuccessor$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeCoins(src.price);
    };
}

export function loadMockSuccessor$Data(slice: Slice) {
    const sc_0 = slice;
    const _price = sc_0.loadCoins();
    return { $$type: 'MockSuccessor$Data' as const, price: _price };
}

export function loadTupleMockSuccessor$Data(source: TupleReader) {
    const _price = source.readBigNumber();
    return { $$type: 'MockSuccessor$Data' as const, price: _price };
}

export function loadGetterTupleMockSuccessor$Data(source: TupleReader) {
    const _price = source.readBigNumber();
    return { $$type: 'MockSuccessor$Data' as const, price: _price };
}

export function storeTupleMockSuccessor$Data(source: MockSuccessor$Data) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.price);
    return builder.build();
}

export function dictValueParserMockSuccessor$Data(): DictionaryValue<MockSuccessor$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMockSuccessor$Data(src)).endCell());
        },
        parse: (src) => {
            return loadMockSuccessor$Data(src.loadRef().beginParse());
        }
    }
}

 type MockSuccessor_init_args = {
    $$type: 'MockSuccessor_init_args';
}

function initMockSuccessor_init_args(src: MockSuccessor_init_args) {
    return (builder: Builder) => {
        const b_0 = builder;
    };
}

async function MockSuccessor_init() {
    const __code = Cell.fromHex('b5ee9c724101020100d40001c6ff00208eda3001d072d721d200d200fa4021103450666f04f86102f862ed44d0d2000194fa000131923070e202915be0d70d1ff2e08221821041540090ba8e106c21fa0030c87f01ca0001fa02c9ed54e001821041540012bae3025bf2c082e1f2c80b0100d8d33f30814679f8416f24135f0323bef2f4f8427080407004c80182104154001358cb1fcb3fc91034413010246d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb00c87f01ca0001fa02c9ed54629bdf85');
    const builder = beginCell();
    builder.storeUint(0, 1);
    initMockSuccessor_init_args({ $$type: 'MockSuccessor_init_args' })(builder);
    const __data = builder.endCell();
    return { code: __code, data: __data };
}

export const MockSuccessor_errors = {
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
    18041: { message: "not enough for the upgrade" },
} as const

export const MockSuccessor_errors_backward = {
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
    "not enough for the upgrade": 18041,
} as const

const MockSuccessor_types: ABIType[] = [
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
    {"name":"SetPrice","header":1096024208,"fields":[{"name":"price","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
    {"name":"MockSuccessor$Data","header":null,"fields":[{"name":"price","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}}]},
]

const MockSuccessor_opcodes = {
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
    "SetPrice": 1096024208,
}

const MockSuccessor_getters: ABIGetter[] = [
]

export const MockSuccessor_getterMapping: { [key: string]: string } = {
}

const MockSuccessor_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"typed","type":"SetPrice"}},
    {"receiver":"internal","message":{"kind":"typed","type":"UpgradeAccept"}},
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

export class MockSuccessor implements Contract {
    
    public static readonly storageReserve = 0n;
    public static readonly errors = MockSuccessor_errors_backward;
    public static readonly opcodes = MockSuccessor_opcodes;
    
    static async init() {
        return await MockSuccessor_init();
    }
    
    static async fromInit() {
        const __gen_init = await MockSuccessor_init();
        const address = contractAddress(0, __gen_init);
        return new MockSuccessor(address, __gen_init);
    }
    
    static fromAddress(address: Address) {
        return new MockSuccessor(address);
    }
    
    readonly address: Address; 
    readonly init?: { code: Cell, data: Cell };
    readonly abi: ContractABI = {
        types:  MockSuccessor_types,
        getters: MockSuccessor_getters,
        receivers: MockSuccessor_receivers,
        errors: MockSuccessor_errors,
    };
    
    constructor(address: Address, init?: { code: Cell, data: Cell }) {
        this.address = address;
        this.init = init;
    }
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: SetPrice | UpgradeAccept) {
        
        let body: Cell | null = null;
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'SetPrice') {
            body = beginCell().store(storeSetPrice(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'UpgradeAccept') {
            body = beginCell().store(storeUpgradeAccept(message)).endCell();
        }
        if (body === null) { throw new Error('Invalid message type'); }
        
        await provider.internal(via, { ...args, body: body });
        
    }
    
}