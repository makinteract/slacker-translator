import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// --------------------------------------------------
// Per-space (per-workspace) OpenAI API key storage, encrypted at rest.
//
// Keys are stored in data/space-keys.json, keyed by Slack team/workspace ID.
// Each value is AES-256-GCM ciphertext, encrypted with a key derived
// from KEY_STORE_SECRET (set in .env).
// --------------------------------------------------

const STORE_PATH = path.join(process.cwd(), 'data', 'space-keys.json');
const ALGORITHM = 'aes-256-gcm';
const SALT = 'slack-translator-key-store';

function getEncryptionKey() {
  const passphrase = process.env.KEY_STORE_SECRET;

  if (!passphrase) {
    throw new Error(
      'KEY_STORE_SECRET is not set. Add it to your .env to enable per-space OpenAI keys.'
    );
  }

  return scryptSync(passphrase, SALT, 32);
}

function loadStore() {
  if (!existsSync(STORE_PATH)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  } catch (error) {
    console.error('Failed to read space key store:', error);
    return {};
  }
}

function saveStore(store) {
  mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function encrypt(plainText) {
  const key = getEncryptionKey();
  const iv = randomBytes(12);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  return {
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decrypt(record) {
  const key = getEncryptionKey();

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(record.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.data, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

// --------------------------------------------------
// PUBLIC API
// --------------------------------------------------

export function setSpaceApiKey(teamId, apiKey) {
  const store = loadStore();
  store[teamId] = encrypt(apiKey);
  saveStore(store);
}

export function getSpaceApiKey(teamId) {
  const store = loadStore();
  const record = store[teamId];

  if (!record) {
    return null;
  }

  try {
    return decrypt(record);
  } catch (error) {
    console.error(`Failed to decrypt API key for space ${teamId}:`, error);
    return null;
  }
}

export function deleteSpaceApiKey(teamId) {
  const store = loadStore();

  if (!(teamId in store)) {
    return false;
  }

  delete store[teamId];
  saveStore(store);

  return true;
}
