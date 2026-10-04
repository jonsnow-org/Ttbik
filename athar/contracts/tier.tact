import "./messages";

// Deterministic date maths and rarity rules. Everything here is public and fixed in the code:
// nobody (including the owner) can change which date is rare after deployment.

struct Ymd { y: Int; m: Int; d: Int; }

// days since 1950-01-01  ->  civil date (Howard Hinnant's algorithm)
fun civil(index: Int): Ymd {
    let z: Int = index - 7305 + 719468;            // 7305 days from 1950-01-01 to 1970-01-01
    let era: Int = z / 146097;
    let doe: Int = z - era * 146097;
    let yoe: Int = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y: Int = yoe + era * 400;
    let doy: Int = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp: Int = (5 * doy + 2) / 153;
    let d: Int = doy - (153 * mp + 2) / 5 + 1;
    let m: Int = mp;
    if (mp < 10) { m = mp + 3; } else { m = mp - 9; }
    if (m <= 2) { y = y + 1; }
    return Ymd { y: y, m: m, d: d };
}

// number of distinct decimal digits in DDMMYYYY and whether it reads the same backwards
fun digitInfo(n: Int): Int {                        // returns distinct*2 + palindromeFlag
    let x: Int = n;
    let mask: Int = 0;
    let rev: Int = 0;
    repeat (8) {
        let dg: Int = x % 10;
        mask = mask | (1 << dg);
        rev = rev * 10 + dg;
        x = x / 10;
    }
    let distinct: Int = 0;
    let i: Int = 0;
    repeat (10) {
        if ((((mask >> i) & 1)) == 1) { distinct = distinct + 1; }
        i = i + 1;
    }
    let pal: Int = 0;
    if (rev == n) { pal = 1; }
    return distinct * 2 + pal;
}

fun ruleTier(index: Int): Int {
    let c: Ymd = civil(index);
    let n: Int = c.d * 1000000 + c.m * 10000 + c.y;
    let info: Int = digitInfo(n);
    let distinct: Int = info / 2;
    let pal: Int = info % 2;
    // MYTHIC
    if (pal == 1 || distinct <= 2) { return TIER_MYTHIC; }
    if (c.d == c.m && (c.d == 11 || c.d == 22)) { return TIER_MYTHIC; }
    if (c.d == 29 && c.m == 2) { return TIER_MYTHIC; }
    if (c.d == c.m && c.y % 100 == c.d) { return TIER_MYTHIC; }
    if (c.d == 1 && c.m == 1 && c.y % 100 == 0) { return TIER_MYTHIC; }
    // RARE
    if (c.d == c.m) { return TIER_RARE; }
    if (c.d == 1 && c.m == 1) { return TIER_RARE; }
    if ((c.d == 1 || c.d == 10 || c.d == 20 || c.d == 30) && (c.m == 1 || c.m == 10)) { return TIER_RARE; }
    if (c.d == 10 && c.m == 1) { return TIER_RARE; }
    if (c.d == 20 && c.m == 2) { return TIER_RARE; }
    if (c.d == 30 && c.m == 3) { return TIER_RARE; }
    return TIER_COMMON;
}
