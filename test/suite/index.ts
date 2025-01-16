import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd'
    });

    (mocha.options as any).color = true;

    const testsRoot = path.resolve(__dirname, '..');

    const files = await glob.glob('**/**.test.js', { cwd: testsRoot });

    // Add files to the test suite
    files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

    try {
        // Run the mocha test
        await new Promise<void>((c, e) => {
            mocha.run((failures) => {
                if (failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            });
        });
    } catch (err) {
        console.error(err);
        throw err;
    }
}
