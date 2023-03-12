
const fs = require('fs');
const child_process = require('child_process');

let prog = '??';
let tagName = '';
let isDryRun = false;

function errExit(...args) {
    console.error(`${prog}: Error:`, ...args);
    process.exit(1);
}

function ensureGitClean() {
    const gitStatus = child_process
        .execSync('git status --short')
        .toString()
        .trim();
    if (gitStatus) {
        errExit('Uncommitted changes exist. exiting. Cannot continue');
    }
}

function isPreRelease() {
    let obj;
    const path = './package.json';
    try {
        const txt = fs.readFileSync(path);
        obj = JSON.parse(txt.toString());
    }
    catch (e) {
        errExit(`Could not open/read file ${path}`, e);
    }
    const version = obj.version;
    if (!version) {
        errExit(`"version" property not found in ${path}`);
    }
    const parts = version.split('.');
    const minor = parseInt(parts[1]);
    tagName = 'v' + version;
    return (minor % 2) === 1;
}

function vsceRun(pkgOnly) {
    const args = ["vsce", (pkgOnly ? 'package' : 'release')];
    if (isPreRelease()) {
        args.push('--pre-release');
    }
    if (!isDryRun && !pkgOnly) {
        ensureGitClean();
    }
    runProg(args, (code) => {
        if (!pkgOnly && (code === 0)) {
            let gitCmd = ['git', 'tag', tagName];
            runProg(gitCmd, (code) => {
                if (code === 0) {
                    gitCmd = ['git', 'push', 'origin', tagName];
                    runProg(gitCmd, (code) => {
                        if (code !== 0) {
                            errExit(`Failed '${gitCmd}'`);
                        }
                    });
                } else {
                    errExit(`Failed '${gitCmd}'`);
                }
            });
        }
    });
}

function runProg(args, cb) {
    if (isDryRun) {
        args.unshift('echo');
    }
    // console.log('Executing ' + args.join(' '));
    const arg0 = args.shift();
    const prog = child_process.spawn(arg0, args, {
        stdio:'inherit'
    });
    prog.on('error', (error) => {
        console.error(`error: ${error.message}`);
        if (cb) {
            cb(-1);
        }
    });
    prog.on("close", (code) => {
        if (!isDryRun) {
            console.log(`${arg0} exited with code ${code}`);
        }
        if (cb) {
            cb(code);
        }
    });
}

function run() {
    let isPkg = true;
    const argv = [...process.argv];
    prog = argv[1];
    argv.shift() ; argv.shift();
    while (argv.length) {
        switch (argv[0]) {
            case '-h':
            case '--help': {
                console.log(`Usage: node ${prog} [--dryrun] [--package] [--publish]`);
                console.log('\t--package is by default true');
                process.exit(0);
            }
            case '--dryrun': {
                isDryRun = true;
                console.log(`${prog}: This is a dryrun`);
                break;
            }
            case '--package': {
                isPkg = true;
                break;
            }
            case '--publish': {
                isPkg = false;
                break;
            }
            default: {
                errExit(`Unknown argument '${argv[0]}'`);
                process.exit(1);
            }
        }
        argv.shift();
    }
    vsceRun(isPkg);
}

run();
