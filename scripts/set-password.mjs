import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { scryptSync, randomBytes } from 'node:crypto';
const readline = createInterface({ input: stdin, output: stdout, terminal: true });
try {
    const password = await readline.question("New password: ", { signal: AbortSignal.timeout(5 * 60 * 1000) });
    if (password.length < 12)
        throw new Error("Use at least 12 characters.");
    const confirmation = await readline.question("Repeat password: ");
    if (confirmation !== password)
        throw new Error("Passwords do not match.");
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    console.log(`\nNOTESPRIG_PASSWORD_HASH='scrypt$${salt}$${hash}'`);
}
finally {
    readline.close();
}
