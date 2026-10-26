import pytest
from cart import add_item, total, apply_discount, most_expensive


def test_add_item_accumulates():
    c = {}
    add_item(c, "pen", 2.0, 3)
    add_item(c, "pen", 2.0, 2)
    assert c["pen"]["qty"] == 5


def test_add_item_rejects_zero():
    with pytest.raises(ValueError):
        add_item({}, "pen", 2.0, 0)


def test_total():
    c = {}
    add_item(c, "pen", 2.0, 3)
    add_item(c, "book", 10.0, 1)
    assert total(c) == 16.0


def test_discount():
    assert apply_discount(200, 10) == 180


def test_most_expensive():
    c = {}
    add_item(c, "pen", 2.0)
    add_item(c, "book", 10.0)
    assert most_expensive(c) == "book"
