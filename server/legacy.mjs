// Identifiers from earlier installations are isolated here for data compatibility.
import { lstat, rename } from 'node:fs/promises';
import path from 'node:path';
export const legacy = Object.freeze({
    slug: 'obsdian',
    metadataDirectory: '.obsdian',
    sessionCookie: 'obsdian_session',
    envPrefix: 'OBSDIAN',
    backupMagic: 'OBSDIAN1',
});
export const metadataDirectory = '.notesprig';
export function environment(name, source = process.env) {
    return source[`NOTESPRIG_${name}`] ?? source[`${legacy.envPrefix}_${name}`];
}
export async function migrateVaultMetadata(root) {
    const previous = path.join(root, legacy.metadataDirectory), current = path.join(root, metadataDirectory);
    const inspect = (file) => lstat(file).catch((error) => { if (error.code === 'ENOENT')
        return null; throw error; });
    const oldInfo = await inspect(previous);
    if (!oldInfo)
        return;
    if (!oldInfo.isDirectory() || oldInfo.isSymbolicLink())
        throw new Error("Invalid legacy metadata directory.");
    if (await inspect(current))
        throw new Error("Two metadata directories exist. Preserve both copies and review the migration before starting.");
    await rename(previous, current);
}
