import "../../contracts/messages";

// Test double for the next edition: accepts an upgrade only if enough money is attached.
message(0x41540090) SetPrice { price: Int as coins; }
contract MockSuccessor {
    price: Int as coins = 0;
    init() { }
    receive(msg: SetPrice) { self.price = msg.price; }
    receive(msg: UpgradeAccept) {
        require(context().value >= self.price, "not enough for the upgrade");
        send(SendParameters{ to: sender(), value: 0, mode: SendRemainingValue, bounce: false, body: UpgradeDone{ index: msg.index }.toCell() });
    }
}
