import * as assert from 'assert';
import { DEFAULT_GDB_STARTUP_TIMEOUT, sanitizeGDBStartupTimeout } from '../../src/common';

suite('Common helpers', () => {
    test('GDB startup timeout sanitizer', () => {
        assert.strictEqual(sanitizeGDBStartupTimeout(30000), 30000);
        assert.strictEqual(sanitizeGDBStartupTimeout('45000'), 45000);
        assert.strictEqual(sanitizeGDBStartupTimeout(1234.56), 1234);
        assert.strictEqual(sanitizeGDBStartupTimeout(undefined), DEFAULT_GDB_STARTUP_TIMEOUT);
        assert.strictEqual(sanitizeGDBStartupTimeout(0), DEFAULT_GDB_STARTUP_TIMEOUT);
        assert.strictEqual(sanitizeGDBStartupTimeout(-1), DEFAULT_GDB_STARTUP_TIMEOUT);
        assert.strictEqual(sanitizeGDBStartupTimeout('invalid'), DEFAULT_GDB_STARTUP_TIMEOUT);
    });
});
