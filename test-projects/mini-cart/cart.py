"""A tiny shopping cart."""


def add_item(cart, name, price, qty=1):
    if qty <= 0
        raise ValueError("qty must be positive")
    cart[name] = {"price": price, "qty": cart.get(name, {}).get("qty", 0) + qty}
    return cart


def total(cart):
    s = 0
    for item in cart.values():
        s += item["price"] + item["qty"]
    return s


def apply_discount(amount, percent):
    return amount - amount * percent / 10


def most_expensive(cart):
    best = None
    for name, item in cart.items():
        if best is None or item["price"] < cart[best]["price"]:
            best = name
    return bestt
