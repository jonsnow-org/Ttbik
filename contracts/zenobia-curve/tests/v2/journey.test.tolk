import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@wrappers/JettonMinterV2.gen"
import "@wrappers/JettonWalletV2.gen"
import "@contracts/v1/messages"
import "@contracts/v2/wallet-messages"
import "@contracts/v2/JettonWallet"

const T0 = 1800000000
const DAY = 86400

fun journeyOf(minter: JettonMinterV2, who: address): JourneyReply {
    return JettonWalletV2.fromAddress(minter.getWalletAddress(who)).getJourney();
}

get fun `test zenobia: holding journey child, queen, warrior, captive, legend`() {
    testing.setNow(T0);
    val owner = testing.treasury("journey-owner");
    val alice = testing.treasury("journey-alice");
    val bob = testing.treasury("journey-bob");
    val minter = JettonMinterV2.fromStorage({ totalSupply: 0, adminAddress: owner.address, nextAdminAddress: null, metadata: beginCell().endCell() });
    net.send(owner.address, createMessage({ bounce: false, dest: {
            stateInit: minter.stateInit!,
        }, value: ton("1"), body: TopUpTons {} }));
    minter.sendMintNewJettons(
        owner.address, 1, alice.address, ton("0.2"),
        InternalTransferStep {
            queryId: 1, jettonAmount: 1000, transferInitiator: null, sendExcessesTo: null,
            forwardTonAmount: 0, forwardPayload: beginCell().storeUint(0, 1).toSlice(),
        },
        { value: ton("0.3") },
    );
    expect(journeyOf(minter, alice.address).stage).toEqual(1);
    testing.setNow(T0 + 8 * DAY);
    expect(journeyOf(minter, alice.address).stage).toEqual(2);
    testing.setNow(T0 + 22 * DAY);
    expect(journeyOf(minter, alice.address).stage).toEqual(3);
    // send everything to bob: alice is a captive, bob starts as a child
    net.send(alice.address, createMessage({ bounce: true, dest: minter.getWalletAddress(alice.address), value: ton("0.4"), body: AskToTransfer {
            queryId: 2, jettonAmount: 1000, transferRecipient: bob.address, sendExcessesTo: alice.address,
            customPayload: null, forwardTonAmount: 0, forwardPayload: beginCell().storeUint(0, 1).toSlice(),
        } }));
    expect(journeyOf(minter, alice.address).stage).toEqual(4);
    expect(journeyOf(minter, bob.address).stage).toEqual(1);
    // bob burns everything: legend
    net.send(bob.address, createMessage({ bounce: true, dest: minter.getWalletAddress(bob.address), value: ton("0.4"), body: AskToBurn {
            queryId: 3, jettonAmount: 1000, sendExcessesTo: bob.address, customPayload: null,
        } }));
    expect(journeyOf(minter, bob.address).stage).toEqual(5);
}
