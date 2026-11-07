import { spawn, execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, link, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { stdin, stdout } from 'node:process';
import { environment, legacy } from '../server/legacy.mjs';
const exec = promisify(execFile);
const magic = Buffer.from('NSPRIG01');
const args = process.argv.slice(2);
const action = args.shift();
function option(name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
async function secret() {
    if (environment('BACKUP_PASSWORD'))
        return environment('BACKUP_PASSWORD');
    if (!stdin.isTTY)
        throw new Error("Set NOTESPRIG_BACKUP_PASSWORD in the environment for noninteractive execution.");
    stdout.write("Backup password (at least 16 characters): ");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    return new Promise((resolve, reject) => {
        let value = '';
        const read = (chunk) => {
            for (const character of chunk) {
                if (character === '\u0003') {
                    finish();
                    reject(new Error("Operation canceled."));
                    return;
                }
                if (character === '\r' || character === '\n') {
                    finish();
                    resolve(value);
                    return;
                }
                if (character === '\u007f')
                    value = value.slice(0, -1);
                else
                    value += character;
            }
        };
        const finish = () => { stdin.off('data', read); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
        stdin.on('data', read);
    });
}
async function checkedRoot(value) {
    if (!value)
        throw new Error("Provide --vault with the vault path.");
    return path.resolve(value);
}
async function rejectLinks(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        const info = await lstat(file);
        if (info.isSymbolicLink() || info.isFile() && info.nlink > 1)
            throw new Error("The backup contains disallowed links.");
        if (entry.isDirectory())
            await rejectLinks(file);
    }
}
async function createBackup() {
    const root = await realpath(await checkedRoot(option('--vault')));
    const output = path.resolve(option('--output') || `backups/notesprig-${new Date().toISOString().replace(/[:.]/g, '-')}.obak`);
    const relative = path.relative(root, output);
    if (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
        throw new Error("Store the backup outside the vault directory.");
    const password = await secret();
    if (password.length < 16)
        throw new Error("Use a password of at least 16 characters.");
    await mkdir(path.dirname(output), { recursive: true });
    const temporary = `${output}.${randomBytes(8).toString('hex')}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    const salt = randomBytes(16), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
    const process = spawn('tar', ['-czf', '-', '-C', root, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = '';
    process.stderr.on('data', (chunk) => {
        if (diagnostic.length < 4096)
            diagnostic += chunk;
    });
    const completion = new Promise((resolve, reject) => { process.once('error', reject); process.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Could not read the vault for backup: ${diagnostic.trim()}`))); });
    // Register a rejection handler immediately, while the stream and process complete together.
    completion.catch(() => { });
    try {
        await handle.write(Buffer.concat([magic, salt, iv, Buffer.alloc(16)]), 0, 52, 0);
        await Promise.all([pipeline(process.stdout, cipher, createWriteStream(temporary, { start: 52, flags: 'r+', mode: 0o600 })), completion]);
        const tag = cipher.getAuthTag();
        await handle.write(tag, 0, tag.length, 36);
        await handle.sync();
        await handle.close();
        await link(temporary, output);
        await unlink(temporary);
        console.log(`Encrypted backup created: ${output}`);
    }
    catch (error) {
        process.kill('SIGTERM');
        await handle.close().catch(() => { });
        await unlink(temporary).catch(() => { });
        throw error;
    }
}
async function restoreBackup() {
    const input = path.resolve(option('--input') || '');
    if (!option('--input'))
        throw new Error("Provide --input with the .obak file.");
    const target = await checkedRoot(option('--vault'));
    await mkdir(path.dirname(target), { recursive: true });
    const exists = await lstat(target).then((info) => info, (error) => {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    });
    if (exists && (!exists.isDirectory() || exists.isSymbolicLink() || (await readdir(target)).length))
        throw new Error("The restoration directory must be empty.");
    const password = await secret();
    const work = await mkdtemp(path.join(path.dirname(target), '.notesprig-restore-'));
    await chmod(work, 0o700);
    const archive = path.join(work, 'verified.tar.gz'), stage = path.join(work, 'vault');
    try {
        const handle = await open(input, 'r');
        const header = Buffer.alloc(52);
        try {
            await handle.read(header, 0, 52, 0);
        }
        finally {
            await handle.close();
        }
        if (!header.subarray(0, 8).equals(magic) && !header.subarray(0, 8).equals(Buffer.from(legacy.backupMagic)))
            throw new Error("Unknown backup format.");
        const decipher = createDecipheriv('aes-256-gcm', scryptSync(password, header.subarray(8, 24), 32), header.subarray(24, 36));
        decipher.setAuthTag(header.subarray(36, 52));
        try {
            await pipeline(createReadStream(input, { start: 52 }), decipher, createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
        }
        catch {
            throw new Error("Incorrect password or corrupted backup. No target files were changed.");
        }
        const { stdout: listing } = await exec('tar', ['-tzf', archive], { maxBuffer: 16 * 1024 * 1024 });
        if (listing.split('\n').filter(Boolean).some((name) => name.startsWith('/') || name.split('/').includes('..')))
            throw new Error("The backup contains invalid paths.");
        const { stdout: verbose } = await exec('tar', ['-tvzf', archive], { maxBuffer: 32 * 1024 * 1024 });
        if (verbose.split('\n').some((line) => /^[lhbcps]/.test(line)))
            throw new Error("The backup contains links or disallowed special files.");
        await mkdir(stage, { mode: 0o700 });
        await exec('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', stage], { maxBuffer: 8 * 1024 * 1024 });
        await rejectLinks(stage);
        if (exists)
            await rmdir(target);
        await rename(stage, target);
        console.log(`Backup verified and restored: ${target}`);
    }
    finally {
        await rm(work, { recursive: true, force: true });
    }
}
try {
    if (action === 'create')
        await createBackup();
    else if (action === 'restore')
        await restoreBackup();
    else
        throw new Error('Usage: node scripts/backup.mjs create --vault PATH --output FILE.obak | restore --input FILE.obak --vault EMPTY_DIRECTORY');
}
catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
