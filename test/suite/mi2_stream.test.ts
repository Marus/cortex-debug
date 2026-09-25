import * as assert from 'assert';
import { MI2 } from '../../src/backend/mi2/mi2';
import { MINode } from '../../src/backend/mi_parse';

suite('GDB/MI output stream', () => {
    test('keeps a result token split from its record marker', () => {
        const gdb = new MI2('gdb', []);
        const messages: Array<[string, string]> = [];
        let response: MINode = undefined;
        gdb.on('msg', (type: string, message: string) => messages.push([type, message]));
        (gdb as any).handlers[787] = (result: MINode) => {
            response = result;
        };

        (gdb as any).stdout(Buffer.from('787'));
        assert.strictEqual((gdb as any).buffer, '787');
        assert.deepStrictEqual(messages, []);

        (gdb as any).stdout(Buffer.from('^done,changelist=[]\n'));
        assert.strictEqual(response.token, 787);
        assert.strictEqual(response.resultRecords.resultClass, 'done');
        assert.strictEqual((gdb as any).handlers[787], undefined);
        assert.strictEqual((gdb as any).buffer, '');
    });

    test('still forwards a complete numeric output line', () => {
        const gdb = new MI2('gdb', []);
        const messages: Array<[string, string]> = [];
        gdb.on('msg', (type: string, message: string) => messages.push([type, message]));

        (gdb as any).stdout(Buffer.from('787\n'));
        assert.deepStrictEqual(messages, [['stdout', '787\n']]);
    });
});
