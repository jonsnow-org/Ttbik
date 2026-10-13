import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@wrappers/BondingCurveMasterV2.gen"
import "@wrappers/BondingCurveV2.gen"
import "@wrappers/FeeSplitterV2.gen"
import "@wrappers/JettonMinterV2.gen"
import "@wrappers/JettonWallet.gen"
import "@wrappers/JettonWalletV2.gen"
import "@contracts/v1/messages"
import "@contracts/v2/bonding-messages"
import "@contracts/v2/bonding-storage"
import "@contracts/v2/JettonWallet"

const ZNB_T0 = 1800000000

// Stand-in for the on-chain metadata (name, symbol, description, image URL and the animated SVG): about 7.5 KB in a chain of cells.
fun bigMetadata(): cell {
    var c = beginCell().storeUint(0, 8).endCell();
    repeat (60) {
        c = beginCell().storeUint(0, 250).storeUint(0, 250).storeUint(0, 250).storeUint(0, 250).storeRef(c).endCell();
    }
    return c;
}

// The exact launch the owner will pay for: 9B supply, 2% creator fee, 1,000 TON graduation, treasury = creator.
get fun `test zenobia: 9B launch, creator earns 1.5 percent, journey follows buy and sell`() {
    testing.setNow(ZNB_T0);
    val owner = testing.treasury("znbt-owner");
    val buyer = testing.treasury("znbt-buyer");
    val master = BondingCurveMasterV2.fromStorage({ admin: owner.address, nextAdmin: null, treasury: owner.address, totalLaunches: 0, feesBalance: 0 });
    master.deploy(owner.address, { value: ton("2") });
    val options = LaunchOptions {
        supply: 9000000000 * 1000000000,
        creatorFeeBps: 150,
        devBuyAmount: 0,
        minDevTokens: 0,
        graduationThreshold: ton("1000"),
        reserveRatio: 5,
    };
    master.sendCreateLaunch(owner.address, 1, bigMetadata(), 777, options, { value: ton("1"), bounce: true });
    val curve = BondingCurveV2.fromAddress(master.getLaunchAddress(owner.address, 777, options));
    val minter = JettonMinterV2.fromAddress(curve.getCurveData().jettonMinter!);
    expect(minter.getJettonData().totalSupply).toEqual(9000000000 * 1000000000);
    // buy 10 TON
    val quote = curve.getQuoteBuy(ton("10"));
    curve.sendBuyJettons(buyer.address, 2, quote, { value: ton("10.05"), bounce: true });
    val wallet = JettonWallet.fromAddress(minter.getWalletAddress(buyer.address));
    expect(wallet.getWalletData().jettonBalance).toEqual(quote);
    expect(curve.getLaunchProgress().creatorAccrued).toEqual(ton("10") * 150 / 10000);
    val j = JettonWalletV2.fromAddress(wallet.address);
    expect(j.getJourney().stage).toEqual(1);
    testing.setNow(ZNB_T0 + 9 * 86400);
    expect(j.getJourney().stage).toEqual(2);
    // sell everything back: the wallet becomes a captive
    val accrued = curve.getLaunchProgress().creatorAccrued;
    net.send(buyer.address, createMessage({ bounce: true, dest: wallet.address, value: ton("0.5"), body: AskToTransfer {
            queryId: 3, jettonAmount: quote, transferRecipient: curve.address, sendExcessesTo: buyer.address,
            customPayload: null, forwardTonAmount: ton("0.2"),
            forwardPayload: beginCell().storeUint(1, 1).storeRef(SellPayload { queryId: 3, minTonOut: 0 }.toCell()).toSlice(),
        } }));
    val left = wallet.getWalletData().jettonBalance;
    expect(left < 1000000000).toEqual(true);
    expect(j.getJourney().stage).toEqual(4);
    expect(curve.getLaunchProgress().creatorAccrued > accrued).toEqual(true);
    // buying again starts a new journey (the captive is freed)
    curve.sendBuyJettons(buyer.address, 4, 0, { value: ton("1.05"), bounce: true });
    expect(j.getJourney().stage).toEqual(1);
}
