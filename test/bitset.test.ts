import * as assert from 'assert';
import {FixedBitSet} from '../src/frontend/fixedbitset';
import {AddrRange, AddressRangesInUse} from '../src/frontend/addrranges';

FixedBitSet.doAsserts = true;

suite('FixedBitSet and Address Range Tests', () => {
    test('FixedBitSet creation set/clr/inv', () => {
        const bs = new FixedBitSet(1);
        assert.strictEqual(bs.numBits, 1);
        assert.strictEqual(!!bs.getBit(0), false);
        bs.setBit(0);
        assert.strictEqual(!!bs.getBit(0), true);
        bs.clrBit(0);
        assert.strictEqual(!!bs.getBit(0), false);
        bs.invBit(0);
        assert.strictEqual(!!bs.getBit(0), true);
    });
    test('FixedBitSet creation set/clr/inv/itor. various sizes', () => {
        for (let sz = 0; sz < 200; sz++) {
            const bs = new FixedBitSet(sz);
            if (sz > 1) {
                const last = sz - 1;
                const mid = sz >>> 1;
                bs.setBit(last);
                bs.setBit(mid);
                for (let iter = 0; iter < 2; iter++) {
                    for (let ix = 0; ix < sz;  ix++) {
                        const val = bs.getBit(ix);
                        if ((iter === 0) && ((ix === last) || (ix === mid))) {
                            assert.strictEqual(!!val, true, `sz=${sz},ix=${ix},iter=${iter},val=${val}`);
                        } else {
                            assert.strictEqual(!!val, false, `sz=${sz},ix=${ix},iter=${iter},val=${val}`);
                        }
                    }
                    bs.clrBit(last);
                    if (last !== mid) {
                        bs.invBit(mid);
                    }
                }
                bs.setBit(mid);
                bs.setBit(last);
                const indices = bs.findAllBits();
                // console.log(indices);
                const cmp = [mid];
                if (last !== mid) {
                    cmp.push(last);
                }
                assert.deepStrictEqual(cmp, indices, `cmp=${cmp},indices=${indices},sz=${sz}`);

                const cpy = bs.dup();
                assert.deepStrictEqual(bs, cpy, `dup of bitset failed ${bs}`);
            }
        }
    });
    test('AddressRangesInUse creation/methods. various sizes', () => {
        const len = 64;
        const bs = new AddressRangesInUse(len);

        for (let ix = 0; ix < (len - 4); ix += 4) {   // 4 bits represents a word
            bs.setWord(ix);
            const str = bs.toHexString();
            assert.strictEqual(str.length, len / 4);    // each element in the string is a nibble
            let pos =  ix / 4;
            pos = (pos & 1) ? pos - 1 : pos + 1;    // Adjust for nibble swap
            for (let strPos = 0; strPos < str.length; strPos++ ) {
                if (strPos === pos) {
                    assert.strictEqual(str[strPos], 'f', `str=${str}, strPos=${strPos}, ix=${ix}`);
                } else {
                    assert.strictEqual(str[strPos], '0', `str=${str}, strPos=${strPos}, ix=${ix}`);
                }
            }

            bs.setWord(ix + 4);
            const ranges1 = bs.getAddressRangesExact(16, false);
            assert.strictEqual(ranges1.length, 1, 'num-ranges mismatch');
            assert.strictEqual(ranges1[0].base, 16 + ix, 'range base mismatch');
            assert.strictEqual(ranges1[0].length, 8, 'range length mismatch');

            const ranges2 = bs.getAddressRangesExact(16, true);
            assert.deepStrictEqual(ranges1, ranges2, 'ranges are not equal');

            const ranges3 = bs.getAddressRangesOptimized(16, true);
            assert.deepStrictEqual(ranges1, ranges3, 'ranges are not equal');

            if (ix >= 16) {
                bs.setWord(8);
                const newRanges1 = bs.getAddressRangesExact(16, false);
                assert.strictEqual(newRanges1.length, 2, 'num-ranges mismatch');
                assert.deepStrictEqual(newRanges1[0], new AddrRange(16 + 8, 4), 'ranges are not equal');
                assert.deepStrictEqual(newRanges1[1], ranges2[0], 'ranges are not equal');

                const newRanges2 = bs.getAddressRangesExact(16, true);
                assert.deepStrictEqual(newRanges1, newRanges2, 'ranges are not equal');

                for (let iter = 0; iter < 2; iter++) {
                    const newRanges3 = bs.getAddressRangesOptimized(16, iter === 0, 16);
                    if (ix < 32) {
                        assert.strictEqual(newRanges3.length, 1, 'num-ranges mismatch');
                        assert.deepStrictEqual(newRanges3[0], new AddrRange(16 + 8, 16 + (ix - 16)), 'ranges are not equal');
                    } else {
                        assert.deepStrictEqual(newRanges1, newRanges3, 'ranges are not equal');
                    }
                }
            }

            bs.clearAll();
        }
    });
    test('AddressRangesInUse alignment tests', () => {
        for (let alignIter = 0; alignIter < 2 ; alignIter++) {
            const isAligned = (alignIter !== 0) ? true : false;
            const len = 63;
            const bs = new AddressRangesInUse(len);

            bs.setAddrRange(8, 3);
            const ranges1 = bs.getAddressRangesExact(16, isAligned);
            assert.deepStrictEqual(ranges1, [ new AddrRange(16 + 8, isAligned ? 4 : 3) ]);

            bs.setAddrRange(23, 5);
            const ranges2 = bs.getAddressRangesExact(16, isAligned);
            assert.deepStrictEqual(ranges2[0], ranges1[0]);
            // If aligned, the start and end addresses have to be at proper bundaries
            assert.deepStrictEqual(ranges2[1], new AddrRange(16 + 23 - (isAligned ? 3 : 0), isAligned ? 8 : 5));

            if (isAligned) {
                continue;
            }

            // FIXME: see if aligned cases will work with coalescing. Thinking, if unaligned works,
            // so will aligned?
            let gap = 0;
            for (; gap < (23 - 8 - 3); gap++ ) {
                const ranges3 = bs.getAddressRangesOptimized(16, isAligned, gap);
                assert.deepStrictEqual(ranges3, ranges2, `gap=${gap}`);
            }

            const mergedRange = [
                new AddrRange(ranges2[0].base, ranges2[1].nxtAddr() - ranges2[0].base)
            ];
            for (; gap < len; gap++ ) {
                const ranges3 = bs.getAddressRangesOptimized(16, isAligned, gap);
                assert.deepStrictEqual(ranges3, mergedRange, `gap=${gap}`);
            }
        }
    });
});
